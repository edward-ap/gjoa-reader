//! Diagnostic-only search. Normal V2 retains its fixed constants and normal_window.
use super::*;
use serde_json::{Value, json};
use std::io::{BufWriter, Write};

#[derive(Clone, Copy, Debug, Serialize)]
pub struct SearchLimits {
    pub plan_beam: usize,
    pub diversity: bool,
    pub page_replays: usize,
    pub window_beam: usize,
    pub endpoints: usize,
}
impl SearchLimits {
    pub fn normal() -> Self {
        Self {
            plan_beam: IMAGE_BEAM,
            diversity: false,
            page_replays: IMAGE_BUDGET,
            window_beam: BEAM,
            endpoints: PAGE_BREAKS,
        }
    }
    pub fn diverse() -> Self {
        Self {
            diversity: true,
            page_replays: 61,
            ..Self::normal()
        }
    }
    pub fn oracle() -> Self {
        Self {
            plan_beam: 16,
            diversity: false,
            page_replays: 1000,
            window_beam: 16,
            endpoints: 16,
        }
    }
    fn validate(self) -> Result<()> {
        if self.plan_beam == 0
            || self.plan_beam > 32
            || self.page_replays == 0
            || self.page_replays > 5000
            || self.window_beam == 0
            || self.window_beam > 64
            || self.endpoints == 0
            || self.endpoints > 64
        {
            return Err("diagnostic limits outside bounded range".into());
        }
        Ok(())
    }
}
fn hash(value: &impl Serialize) -> Result<String> {
    crate::library::store::hash_reader(serde_json::to_vec(value)?.as_slice())
}
fn page_hash(d: &Draft) -> Result<String> {
    hash(&d.page)
}
fn draft_id(d: &Draft) -> Result<String> {
    hash(&(page_hash(d)?, d.after.key()))
}
fn describe(d: &Draft) -> Result<Value> {
    Ok(
        json!({"id":draft_id(d)?,"page_hash":page_hash(d)?,"after":d.after.key(),"cost":d.cost,"score":d.cost.total(),"images":d.decisions,"notes":d.note_slices,"continuation":d.continuation}),
    )
}

/// All valid row endpoints and their first removal by the rolling endpoint cap.
#[derive(Default)]
pub(super) struct EndpointAudit {
    valid: BTreeMap<String, Value>,
    step: usize,
}
impl EndpointAudit {
    pub(super) fn accept(&mut self, d: &Draft) -> Result<()> {
        let id = draft_id(d)?;
        self.valid.entry(id).or_insert(describe(d)?);
        Ok(())
    }
    pub(super) fn retain(&mut self, kept: &[Draft]) -> Result<()> {
        self.step += 1;
        let ids = kept.iter().map(draft_id).collect::<Result<BTreeSet<_>>>()?;
        for (id, record) in &mut self.valid {
            if !ids.contains(id) && record.get("first_endpoint_cap_drop").is_none() {
                record["first_endpoint_cap_drop"] = json!(self.step);
            }
        }
        Ok(())
    }
}
struct Recorder {
    file: Option<BufWriter<std::fs::File>>,
    seq: usize,
}
impl Recorder {
    fn new(path: &Path) -> Result<Self> {
        Ok(Self {
            file: Some(BufWriter::new(
                std::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(path)?,
            )),
            seq: 0,
        })
    }
    fn silent() -> Self {
        Self { file: None, seq: 0 }
    }
    fn emit(&mut self, mut v: Value) -> Result<()> {
        if self.file.is_none() {
            return Ok(());
        }
        self.seq += 1;
        if self.seq > 500_000 {
            return Err("diagnostic trace event limit reached; no silent truncation".into());
        }
        v["event"] = json!(self.seq);
        serde_json::to_writer(self.file.as_mut().unwrap(), &v)?;
        self.file.as_mut().unwrap().write_all(b"\n")?;
        Ok(())
    }
    fn flush(&mut self) -> Result<()> {
        if let Some(f) = &mut self.file {
            f.flush()?;
        }
        Ok(())
    }
}
#[derive(Default, Serialize)]
struct SearchStats {
    page_replays: usize,
    invalid_trials: usize,
    endpoint_candidates: usize,
    plan_beam_drops: usize,
    budget_drops: usize,
    window_beam_drops: usize,
    duplicates: usize,
    elapsed_ms: f64,
}
struct DebugResult {
    beam: Vec<Candidate>,
    first_pool: Vec<Rc<Draft>>,
    stats: SearchStats,
}

impl Engine<'_, '_> {
    #[allow(clippy::too_many_arguments)]
    fn debug_variants(
        &mut self,
        initial: &Boundary,
        limits: SearchLimits,
        depth: usize,
        mode: &str,
        log: &mut Recorder,
        stats: &mut SearchStats,
    ) -> Result<Vec<Draft>> {
        let boundary = hash(&initial.key())?;
        let mut frontier = vec![ImagePlan::default()];
        let mut seen = BTreeSet::new();
        let mut spent = 0;
        let mut output = vec![];
        let mut generation = 0;
        while !frontier.is_empty() && spent < limits.page_replays {
            let mut ranked = vec![];
            for plan in frontier {
                if spent >= limits.page_replays {
                    stats.budget_drops += 1;
                    log.emit(json!({"stage":"plan_budget","mode":mode,"depth":depth,"boundary":boundary,"plan":plan.key(),"limit":limits.page_replays}))?;
                    continue;
                }
                if !seen.insert(plan.key()) {
                    continue;
                }
                spent += 1;
                stats.page_replays += 1;
                let mut encountered = BTreeSet::new();
                let mut audit = EndpointAudit::default();
                let result = self.page_with_limits(
                    initial,
                    &plan,
                    &mut encountered,
                    limits.endpoints,
                    if log.file.is_some() {
                        Some(&mut audit)
                    } else {
                        None
                    },
                );
                let next = encountered
                    .iter()
                    .copied()
                    .find(|b| !plan.0.contains_key(b));
                match result {
                    Ok(drafts) => {
                        stats.endpoint_candidates += drafts.len();
                        log.emit(json!({"stage":"page_trial","mode":mode,"depth":depth,"boundary":boundary,"generation":generation,"plan":plan.key(),"encountered":encountered,"next_anchor":next,"valid":true,"endpoints":audit.valid,"retained":drafts.iter().map(draft_id).collect::<Result<Vec<_>>>()?}))?;
                        ranked.push((drafts[0].cost.total(), plan.clone(), next));
                        output.extend(drafts);
                    }
                    Err(e) => {
                        stats.invalid_trials += 1;
                        log.emit(json!({"stage":"page_trial","mode":mode,"depth":depth,"boundary":boundary,"generation":generation,"plan":plan.key(),"encountered":encountered,"next_anchor":next,"valid":false,"reason":e.to_string(),"endpoints":audit.valid}))?;
                        if next.is_some() {
                            ranked.push((f64::INFINITY, plan, next));
                        }
                    }
                }
            }
            ranked.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.key().cmp(&b.1.key())));
            let mut next_frontier = vec![];
            let mut expandable_rank = 0;
            let slots = expansion_slots(&ranked, limits.plan_beam, limits.diversity);
            for (index, (score, plan, anchor)) in ranked.into_iter().enumerate() {
                let expand = if anchor.is_some() {
                    expandable_rank += 1;
                    slots.contains(&index)
                } else {
                    false
                };
                if anchor.is_some() && !expand {
                    stats.plan_beam_drops += 1;
                }
                log.emit(json!({"stage":"plan_expansion","mode":mode,"depth":depth,"boundary":boundary,"generation":generation,"plan":plan.key(),"next_anchor":anchor,"rank":if anchor.is_some(){Some(expandable_rank)}else{None},"score":if score.is_finite(){Some(score)}else{None},"selection":if expand && expandable_rank > limits.plan_beam {"diversity"} else {"score"},"family":plan_family(&plan),"status":if anchor.is_none(){"complete"}else if expand{"expanded"}else{"plan_beam_drop"}}))?;
                if expand {
                    for p in policies().into_iter().filter(|p| p.reserve == 0) {
                        let mut branch = plan.clone();
                        branch.0.insert(anchor.unwrap(), p);
                        next_frontier.push(branch);
                    }
                }
            }
            frontier = next_frontier;
            generation += 1;
        }
        for plan in frontier {
            stats.budget_drops += 1;
            log.emit(json!({"stage":"plan_budget","mode":mode,"depth":depth,"boundary":boundary,"plan":plan.key(),"limit":limits.page_replays}))?;
        }
        output.sort_by(|a, b| {
            a.cost
                .total()
                .total_cmp(&b.cost.total())
                .then(a.image_plan.cmp(&b.image_plan))
        });
        Ok(output)
    }
    fn debug_search(
        &mut self,
        initial: &Boundary,
        limits: SearchLimits,
        mode: &str,
        log: &mut Recorder,
        forced: Option<Rc<Draft>>,
    ) -> Result<DebugResult> {
        let timer = std::time::Instant::now();
        let mut stats = SearchStats::default();
        let start = usize::from(forced.is_some());
        let mut beam = if let Some(d) = forced {
            vec![Candidate {
                state: d.after.clone(),
                score: d.cost.total(),
                ids: vec![0],
                pages: vec![d],
            }]
        } else {
            vec![Candidate {
                pages: vec![],
                state: initial.clone(),
                ids: vec![],
                score: 0.,
            }]
        };
        let mut pool: BTreeMap<Vec<(usize, usize)>, Rc<Draft>> = BTreeMap::new();
        for depth in start..WINDOW {
            let mut next = vec![];
            for candidate in &beam {
                if candidate.state.finished(self.model) {
                    next.push(candidate.clone());
                    continue;
                }
                for (id, draft) in self
                    .debug_variants(&candidate.state, limits, depth, mode, log, &mut stats)?
                    .into_iter()
                    .enumerate()
                {
                    let d = Rc::new(draft);
                    if depth == 0 {
                        let key = d.image_plan.clone();
                        if pool
                            .get(&key)
                            .is_none_or(|old| d.cost.total() < old.cost.total())
                        {
                            pool.insert(key, d.clone());
                        }
                        // Bounded raster-evidence pool; full metadata remains in the event stream.
                        if pool.len() > 256 {
                            let worst = pool
                                .iter()
                                .max_by(|a, b| {
                                    a.1.cost
                                        .side_void
                                        .total_cmp(&b.1.cost.side_void)
                                        .then(a.1.cost.total().total_cmp(&b.1.cost.total()))
                                })
                                .unwrap()
                                .0
                                .clone();
                            pool.remove(&worst);
                        }
                    }
                    let mut c = candidate.clone();
                    c.state = d.after.clone();
                    c.ids.push(id);
                    c.score += scoring::WINDOW_WEIGHTS[depth] * d.cost.total();
                    c.pages.push(d);
                    next.push(c);
                }
            }
            next.sort_by(|a, b| a.score.total_cmp(&b.score).then(a.ids.cmp(&b.ids)));
            let mut unique = BTreeSet::new();
            let mut survivors = vec![];
            for (rank, c) in next.into_iter().enumerate() {
                let duplicate = !unique.insert((c.state.key(), c.score.to_bits()));
                let keep = !duplicate && survivors.len() < limits.window_beam;
                if duplicate {
                    stats.duplicates += 1;
                } else if !keep {
                    stats.window_beam_drops += 1;
                }
                log.emit(json!({"stage":"window_beam","mode":mode,"depth":depth,"rank":rank+1,"status":if duplicate{"duplicate"}else if keep{"kept"}else{"window_beam_drop"},"score":c.score,"ids":c.ids,"first":draft_id(&c.pages[0])?,"pages":c.pages.iter().map(|d|describe(d)).collect::<Result<Vec<_>>>()?,"plans":c.pages.iter().map(|d|&d.image_plan).collect::<Vec<_>>()}))?;
                if keep {
                    survivors.push(c);
                }
            }
            if survivors.is_empty() {
                return Err("diagnostic search has no feasible candidate".into());
            }
            beam = survivors;
        }
        beam.sort_by(|a, b| a.score.total_cmp(&b.score).then(a.ids.cmp(&b.ids)));
        stats.elapsed_ms = timer.elapsed().as_secs_f64() * 1000.;
        Ok(DebugResult {
            beam,
            first_pool: pool.into_values().collect(),
            stats,
        })
    }
}
fn candidate_hashes(c: &Candidate) -> Result<Vec<String>> {
    c.pages.iter().map(|d| page_hash(d)).collect()
}
fn candidate_info(c: &Candidate) -> Result<Value> {
    Ok(
        json!({"score":c.score,"page_hashes":candidate_hashes(c)?,"pages":c.pages.iter().map(|d|describe(d)).collect::<Result<Vec<_>>>()?,"plans":c.pages.iter().map(|d|&d.image_plan).collect::<Vec<_>>() }),
    )
}
fn verify_window(model: &Publication, initial: &Boundary, c: &Candidate) -> Result<()> {
    let mut coverage = BTreeMap::<usize, usize>::new();
    for d in &c.pages {
        validate_geometry(&d.page)?;
        for i in &d.page.items {
            let range = match i {
                Item::GlyphRun {
                    source_start,
                    source_end,
                    ..
                }
                | Item::RasterGlyph {
                    source_start,
                    source_end,
                    ..
                } => Some(*source_start..*source_end),
                _ => None,
            };
            if let Some(r) = range {
                for x in r {
                    *coverage.entry(x).or_default() += 1;
                }
            }
        }
    }
    for (block, b) in model
        .blocks
        .iter()
        .enumerate()
        .take(c.state.cursor.block + 1)
        .skip(initial.cursor.block)
    {
        if let Block::Paragraph { start, end, .. } = b {
            let lo = if block == initial.cursor.block {
                initial.cursor.offset.max(*start)
            } else {
                *start
            };
            let hi = if block == c.state.cursor.block {
                c.state.cursor.offset.max(*start).min(*end)
            } else {
                *end
            };
            for (n, ch) in model.text[lo..hi].char_indices() {
                let x = lo + n;
                if ch.is_alphanumeric()
                    && !model
                        .note_references
                        .iter()
                        .any(|r| r.start <= x && x < r.end)
                    && coverage.get(&x) != Some(&1)
                {
                    return Err(format!("diagnostic main text coverage at {x}").into());
                }
            }
        }
    }
    let placed = c
        .state
        .placed
        .difference(&initial.placed)
        .copied()
        .collect::<BTreeSet<_>>();
    let decisions = c
        .pages
        .iter()
        .flat_map(|p| p.decisions.iter().map(|d| d.block))
        .collect::<Vec<_>>();
    if placed != decisions.iter().copied().collect() || decisions.len() != placed.len() {
        return Err("diagnostic image state/occurrence mismatch".into());
    }
    Ok(())
}
fn emit_candidate(common: &Path, base: &Manifest, out: &Path, c: &Candidate) -> Result<()> {
    use crate::reader::document::{Document, RenderRequest};
    std::fs::create_dir(out)?;
    let mut m = base.clone();
    m.pages.clear();
    m.page_files.clear();
    for r in &base.assets {
        write_file(
            out,
            &r.path,
            &crate::publication::read_file(common, r, 64 * 1024 * 1024)?,
        )?;
    }
    for (i, d) in c.pages.iter().enumerate() {
        m.page_files.push(write_file(
            out,
            &format!("pages/{:06}.json", i + 1),
            &serde_json::to_vec(&d.page)?,
        )?);
        m.pages.push(PageInfo {
            width: WIDTH,
            height: HEIGHT,
            dpi: None,
        });
    }
    m.page_count = m.pages.len();
    m.importer_id = Some("diagnostic-oracle-window-only".into());
    m.edition_id = crate::publication::identity_manifest(&m);
    std::fs::write(out.join("manifest.json"), serde_json::to_vec_pretty(&m)?)?;
    let doc = crate::publication::generated::GeneratedDocument::open(out, &m)?;
    for i in 0..m.page_count {
        let r = doc.render_page(
            i,
            RenderRequest {
                width: WIDTH,
                height: HEIGHT,
            },
        )?;
        image::save_buffer(
            out.join(format!("page-{}.png", i + 1)),
            &r.rgba,
            WIDTH,
            HEIGHT,
            image::ColorType::Rgba8,
        )?;
    }
    Ok(())
}

/// Diagnose selected *normal V2* page boundaries only; never changes normal publication.
/// `common` is owned staging with parsed model assets; `out` must be a fresh directory.
pub fn diagnose(
    model: &Publication,
    common: &Path,
    manifest: &mut Manifest,
    out: &Path,
    targets: &[usize],
    oracle: SearchLimits,
    repeat: bool,
) -> Result<Value> {
    oracle.validate()?;
    if targets.is_empty()
        || targets.len() > 8
        || targets.contains(&0)
        || targets.iter().any(|p| *p > MAX_PAGES)
    {
        return Err("select 1..8 valid diagnostic page numbers".into());
    }
    std::fs::create_dir(out)?;
    for (i, font) in CURRENT_FONTS.iter().enumerate() {
        manifest
            .assets
            .push(write_file(common, &format!("assets/fonts/{i}.ttf"), font)?);
    }
    manifest.assets.push(write_file(
        common,
        "assets/fonts/OFL.txt",
        include_bytes!("../../../assets/fonts/Literata-OFL.txt"),
    )?);
    manifest.assets.push(write_file(
        common,
        "publication.json",
        &serde_json::to_vec(model)?,
    )?);
    let faces = CURRENT_FONTS
        .iter()
        .map(|b| rustybuzz::Face::from_slice(b, 0).ok_or("Invalid font"))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut engine = make_engine(model, &faces, common, manifest)?;
    let mut state = Boundary::default();
    let mut prefix_hashes = vec![];
    let mut cases = vec![];
    let mut renders = vec![];
    for page in 1..=*targets.iter().max().unwrap() {
        if state.finished(model) {
            return Err("diagnostic target is past end of publication".into());
        }
        let production = engine.normal_window(&state)?;
        let selected = &production.beam[0];
        prefix_hashes.push(page_hash(&selected.pages[0])?);
        if targets.contains(&page) {
            let dir = out.join(format!("page-{page:03}"));
            std::fs::create_dir(&dir)?;
            let mut normal_log = Recorder::new(&dir.join("normal.jsonl"))?;
            let normal = engine.debug_search(
                &state,
                SearchLimits::normal(),
                "normal",
                &mut normal_log,
                None,
            )?;
            normal_log.flush()?;
            if candidate_hashes(selected)? != candidate_hashes(&normal.beam[0])? {
                return Err("diagnostic normal search differs from unchanged V2".into());
            }
            let mut oracle_log = Recorder::new(&dir.join("oracle.jsonl"))?;
            let wide = engine.debug_search(&state, oracle, "oracle", &mut oracle_log, None)?;
            oracle_log.flush()?;
            let mut diversity_log = Recorder::new(&dir.join("diversity.jsonl"))?;
            let diverse = engine.debug_search(
                &state,
                SearchLimits::diverse(),
                "diversity",
                &mut diversity_log,
                None,
            )?;
            diversity_log.flush()?;
            engine.diversity = true;
            let actual_diverse = engine.normal_window(&state)?;
            engine.diversity = false;
            if candidate_hashes(&actual_diverse.beam[0])? != candidate_hashes(&diverse.beam[0])? {
                return Err("diagnostic diversity differs from V2.2 search".into());
            }
            let mut control_log = Recorder::new(&dir.join("budget-control.jsonl"))?;
            let control = engine.debug_search(
                &state,
                SearchLimits {
                    page_replays: 61,
                    ..SearchLimits::normal()
                },
                "budget-control",
                &mut control_log,
                None,
            )?;
            control_log.flush()?;

            if repeat {
                let again = engine.debug_search(
                    &state,
                    SearchLimits::diverse(),
                    "diversity-repeat",
                    &mut Recorder::silent(),
                    None,
                )?;
                if candidate_hashes(&diverse.beam[0])? != candidate_hashes(&again.beam[0])? {
                    return Err("diversity repeat changed hashes".into());
                }
            }
            let mut snapshots = vec![
                ("normal".to_owned(), normal.beam[0].clone()),
                ("oracle".to_owned(), wide.beam[0].clone()),
            ];
            let mut seen = BTreeSet::new();
            seen.insert(page_hash(&normal.beam[0].pages[0])?);
            seen.insert(page_hash(&wide.beam[0].pages[0])?);
            let mut alternatives = wide.first_pool.clone();
            alternatives.sort_by(|a, b| {
                a.cost
                    .side_void
                    .total_cmp(&b.cost.side_void)
                    .then(a.cost.total().total_cmp(&b.cost.total()))
                    .then(a.image_plan.cmp(&b.image_plan))
            });
            let mut forced_log = Recorder::new(&dir.join("forced.jsonl"))?;
            // Render distinct lower-side-void witnesses even when the scorer dislikes them.
            for first in alternatives.into_iter().filter(|d| !d.decisions.is_empty()) {
                if snapshots.len() >= 5 {
                    break;
                }
                if !seen.insert(page_hash(&first)?) {
                    continue;
                }
                let name = format!("witness-{}", snapshots.len() - 1);
                let completed =
                    engine.debug_search(&state, oracle, &name, &mut forced_log, Some(first))?;
                snapshots.push((name, completed.beam[0].clone()));
            }
            forced_log.flush()?;
            snapshots.push(("diversity".to_owned(), diverse.beam[0].clone()));
            snapshots.push(("budget-control".to_owned(), control.beam[0].clone()));
            let deterministic = if repeat {
                let again =
                    engine.debug_search(&state, oracle, "repeat", &mut Recorder::silent(), None)?;
                if candidate_hashes(&wide.beam[0])? != candidate_hashes(&again.beam[0])? {
                    return Err("oracle repeat changed page hashes".into());
                }
                true
            } else {
                false
            };
            let mut evidence = vec![];
            for (name, c) in snapshots {
                verify_window(model, &state, &c)?;
                evidence.push(json!({"name":name,"candidate":candidate_info(&c)?}));
                renders.push((dir.join(&name), c));
            }
            cases.push(json!({"page":page,"boundary":state.key(),"boundary_hash":hash(&state.key())?,"normal":normal.stats,"diversity":diverse.stats,"budget_control":control.stats,"diversity_matches_v22":true,"oracle":wide.stats,"normal_matches_unchanged_v2":true,"oracle_repeat":deterministic,"evidence":evidence}));
            println!(
                "page {page}: normal {:.5}, oracle {:.5}; {} vs {} page replays",
                normal.beam[0].score,
                wide.beam[0].score,
                normal.stats.page_replays,
                wide.stats.page_replays
            );
        }
        state = selected.pages[0].after.clone();
    }
    engine.resolver.finish(common, manifest)?;
    for (dir, candidate) in renders {
        emit_candidate(common, manifest, &dir, &candidate)?;
    }
    let summary = json!({"normal_limits":SearchLimits::normal(),"oracle_limits":oracle,"diversity_limits":SearchLimits::diverse(),"normal_prefix_hashes":prefix_hashes,"cases":cases,"scope":"bounded diagnostic search, not an exhaustive oracle or automatic beauty judge"});
    std::fs::write(
        out.join("summary.json"),
        serde_json::to_vec_pretty(&summary)?,
    )?;
    Ok(summary)
}
