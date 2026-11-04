//! Smart PDF import. Physical geometry is evidence, not body pagination.
use super::{
    model::*,
    pdf_reconstruction as deep,
    typography::{FloatSpec, LayoutPlan},
};
use crate::{
    library::Result,
    reader::{
        document::{Document, RenderRequest},
        pdf,
    },
};
use serde_json::json;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};
pub const IMPORTER: &str = "pdf-smart-v4;model1";
struct Paragraph {
    raw: Vec<RawSpan>,
    kind: ParagraphKind,
    page: usize,
    last: bool,
}
fn plain(raw: &[RawSpan]) -> String {
    raw.iter().map(|s| s.0.as_str()).collect()
}
fn flush(model: &mut Publication, pending: &mut Option<Paragraph>) -> Result<()> {
    if let Some(p) = pending.take() {
        let at = model.blocks.len();
        model.append_paragraph(
            p.raw
                .into_iter()
                .map(|(s, style, link)| (s.replace('\u{2}', ""), style, link))
                .collect(),
            p.kind,
            None,
            None,
        )?;
        if p.kind == ParagraphKind::Heading {
            model.mark(at, true, Some(1));
        }
    }
    Ok(())
}
pub fn prepare(
    source: &str,
    path: &Path,
    staging: &Path,
    diagnostics: &Path,
) -> Result<Option<super::Prepared>> {
    Ok(prepare_impl(source, path, staging, diagnostics)?.1)
}
pub fn prepare_reader(
    source: &str,
    path: &Path,
    staging: &Path,
    experimental: bool,
) -> Result<(deep::PdfReconstructionAssessment, Option<super::Prepared>)> {
    // Bounded, distributed sample: no image decoding or full manuscript creation.
    let evidence = pdf::sample_evidence(path)?;
    let mut assessment = deep::reconstruct(&evidence)?.assessment;
    assessment.importer = IMPORTER.into();
    if assessment.scan_pages > 0 {
        if assessment.confidence == deep::Confidence::High {
            assessment.confidence = deep::Confidence::Medium;
        }
        assessment.reasons.push("OCR over scanned pages: character substitutions and missing note markers cannot be verified from embedded text".into());
    }
    if assessment.source_chars == 0
        || (!experimental && assessment.confidence != deep::Confidence::High)
    {
        return Ok((assessment, None));
    }
    drop(evidence);
    let diagnostics = tempfile::Builder::new()
        .prefix("smart-diagnostics-")
        .tempdir_in(staging)?;
    prepare_impl(source, path, staging, diagnostics.path())
}
fn prepare_impl(
    source: &str,
    path: &Path,
    staging: &Path,
    diagnostics: &Path,
) -> Result<(deep::PdfReconstructionAssessment, Option<super::Prepared>)> {
    let directory = tempfile::Builder::new()
        .prefix("publication-")
        .tempdir_in(staging)?;
    eprintln!("smart: extracting glyph/image evidence");
    let evidence = pdf::extract_evidence(path, &directory.path().join("assets/pdf"))?;
    eprintln!("smart: extracting logical paragraphs");
    let semantics = pdf::extract_semantics(path)?;
    eprintln!("smart: assessing folios and notes");
    let old = deep::reconstruct(&evidence)?;
    let source_doc = pdf::PdfSourceDocument::open(path)?;
    let mut model = Publication {
        schema_version: 3,
        text: String::new(),
        blocks: vec![],
        metadata: evidence.metadata.clone(),
        structure: vec![],
        notes: vec![],
        note_references: vec![],
    };
    let mut plan = LayoutPlan::default();
    let mut report = vec![];
    let mut pending: Option<Paragraph> = None;
    let mut body_started = false;
    let mut merges = 0;
    let mut tagged = 0;
    let mut fallbacks = 0;
    let mut image_hints = BTreeMap::new();
    let mut inferred_notes: Vec<(String, Vec<RawSpan>)> = vec![];
    let mut image_text_removals = vec![];
    let mut verse_report = vec![];
    let note_ids: BTreeSet<_> = old.model.notes.iter().map(|n| n.id.clone()).collect();
    for (pi, page) in evidence.pages.iter().enumerate() {
        let d = &old.assessment.page_diagnostics[pi];
        let sem = &semantics[pi];
        if sem.char_mcids.len() != page.chars.len() {
            return Err("PDF structure/glyph index mismatch".into());
        }
        let count = page
            .chars
            .iter()
            .filter(|c| !c.text.trim().is_empty() && !c.text.chars().all(char::is_control))
            .count();
        let dense = count > 1000 && d.lines.len() > 15;
        if dense {
            body_started = true;
        }
        // Title leaves recur between parts, not only before body prose.
        let page_letters: Vec<_> = page
            .chars
            .iter()
            .flat_map(|c| c.text.chars())
            .filter(|c| c.is_alphabetic())
            .collect();
        let title_leaf = count < 600
            && (3..=15).contains(&d.lines.len())
            && page_letters.len() >= 25
            && page_letters.iter().all(|c| c.is_uppercase());
        let sparse = title_leaf
            || !body_started
            || (count < 500 && d.lines.len() < 12 && {
                let mut ys: Vec<_> = d.lines.iter().map(|l| l.baseline).collect();
                ys.sort_by(f32::total_cmp);
                ys.windows(2).any(|w| w[1] - w[0] > page.height * 0.35)
            });
        let full = (pi == 0 && count <= 500) || count == 0 || sparse;
        if full {
            flush(&mut model, &mut pending)?;
            let info = source_doc.page_info(pi)?;
            let width = 1000;
            let height = (width as f64 * info.height as f64 / info.width as f64).round() as u32;
            let raster = source_doc.render_page(pi, RenderRequest { width, height })?;
            let asset = format!("assets/pdf/smart-page-{pi}.png");
            image::save_buffer(
                directory.path().join(&asset),
                &raster.rgba,
                width,
                height,
                image::ColorType::Rgba8,
            )?;
            model.blocks.push(Block::Image {
                asset: asset.clone(),
                cover: true,
            });
            plan.full_pages.push(asset);
            report.push(json!({"page":pi+1,"kind":if count==0{"graphic"}else{"designed"},"text_chars":count}));
            continue;
        }
        let mut excluded = BTreeSet::new();
        let mut styles = BTreeMap::new();
        let mut links = BTreeMap::new();
        for removal in &old.assessment.removals {
            if removal.page == pi && removal.reason == "duplicate overlapping glyph" {
                excluded.extend(removal.indices.iter().copied());
            }
        }
        for line in &d.lines {
            for s in &line.spans {
                for &i in &s.indices {
                    if line.removed.is_some() || line.note.is_some() {
                        excluded.insert(i);
                    }
                    styles.insert(i, s.style);
                }
                let label = s.text.trim().trim_matches(|c: char| "[]().".contains(c));
                let id = format!("pdf-note-{pi}-{label}");
                if s.style.superscript && note_ids.contains(&id) {
                    for &i in &s.indices {
                        links.insert(i, format!("#{id}"));
                    }
                }
            }
        }
        // Short symbol-heavy OCR entirely inside a retained illustration must
        // not become separate prose. Captions outside images and note links stay.
        for line in &d.lines {
            let indices: Vec<_> = line
                .spans
                .iter()
                .flat_map(|s| s.indices.iter().copied())
                .collect();
            let text: String = indices
                .iter()
                .map(|&i| page.chars[i].text.as_str())
                .collect();
            let visible: Vec<_> = text
                .chars()
                .filter(|c| !c.is_whitespace() && !c.is_control())
                .collect();
            let letters = visible.iter().filter(|c| c.is_alphabetic()).count();
            let covered = page.images.iter().any(|im| {
                !im.background
                    && im.asset.is_some()
                    && indices
                        .iter()
                        .filter(|&&i| !page.chars[i].text.trim().is_empty())
                        .all(|&i| {
                            let b = page.chars[i].bounds;
                            b[0] >= im.bounds[0]
                                && b[1] >= im.bounds[1]
                                && b[2] <= im.bounds[2]
                                && b[3] <= im.bounds[3]
                        })
            });
            if visible.len() >= 8
                && visible.len() <= 80
                && letters * 5 < visible.len() * 3
                && covered
                && !indices.iter().any(|i| links.contains_key(i))
                && line.note.is_none()
            {
                excluded.extend(indices.iter().copied());
                image_text_removals.push(json!({"page":pi+1,"text":text,"indices":indices,"reason":"short symbol-heavy OCR inside retained illustration"}));
            }
        }
        // Unmarked editorial notes: bottom position, tighter line pitch and a
        // hyphenated body word interrupted immediately before the note.
        let mut synthetic_anchor = None;
        let semantic_text: Vec<Vec<usize>> = sem
            .groups
            .iter()
            .filter(|g| g.role == "P")
            .map(|g| {
                page.chars
                    .iter()
                    .filter(|c| {
                        g.mcids.contains(&sem.char_mcids[c.index]) && !excluded.contains(&c.index)
                    })
                    .map(|c| c.index)
                    .collect()
            })
            .filter(|g: &Vec<usize>| !g.is_empty())
            .collect();
        if semantic_text.len() >= 3 {
            let last = semantic_text.last().unwrap();
            let preceding = &semantic_text[semantic_text.len() - 2];
            let pitch = |indices: &[usize]| {
                let mut ys: Vec<f32> = indices.iter().map(|&i| page.chars[i].baseline).collect();
                ys.sort_by(f32::total_cmp);
                ys.dedup_by(|a, b| (*a - *b).abs() < 1.);
                let mut diffs: Vec<f32> = ys
                    .windows(2)
                    .map(|w| w[1] - w[0])
                    .filter(|v| *v > 4. && *v < 30.)
                    .collect();
                diffs.sort_by(f32::total_cmp);
                diffs.get(diffs.len() / 2).copied().unwrap_or(0.)
            };
            let prev_text: String = preceding
                .iter()
                .map(|&i| page.chars[i].text.as_str())
                .collect();
            let top = last
                .iter()
                .map(|&i| page.chars[i].bounds[1])
                .fold(f32::INFINITY, f32::min);
            let (np, bp) = (pitch(last), pitch(preceding));
            if top > page.height * 0.72
                && last.len() > 100
                && np > 0.
                && np < bp * 0.88
                && prev_text.trim_end().ends_with(['-', '\u{2}'])
            {
                let id = format!("pdf-editorial-{pi}");
                let raw = last
                    .iter()
                    .map(|&i| {
                        (
                            page.chars[i].text.replace('\u{2}', ""),
                            Style::default(),
                            None,
                        )
                    })
                    .collect();
                inferred_notes.push((id.clone(), raw));
                excluded.extend(last.iter().copied());
                if let Some(&anchor) = semantic_text[0].last() {
                    synthetic_anchor = Some((anchor, id));
                }
            }
        }
        let mut groups: Vec<Vec<usize>> = vec![];
        let mut used: BTreeSet<usize> = BTreeSet::new();
        for g in &sem.groups {
            if g.role == "Figure" {
                continue;
            }
            let ids: BTreeSet<_> = g.mcids.iter().copied().collect();
            let indices: Vec<_> = page
                .chars
                .iter()
                .filter(|c| {
                    ids.contains(&sem.char_mcids[c.index])
                        && !excluded.contains(&c.index)
                        && !used.contains(&c.index)
                })
                .map(|c| c.index)
                .collect();
            if !indices.is_empty() {
                used.extend(&indices);
                groups.push(indices);
                tagged += 1;
            }
        }
        // Preserve untagged content, except explicitly identified folios/notes.
        for line in &d.lines {
            if line.removed.is_some() || line.note.is_some() {
                continue;
            }
            let indices: Vec<_> = line
                .spans
                .iter()
                .flat_map(|s| s.indices.iter().copied())
                .filter(|i| !used.contains(i) && !excluded.contains(i))
                .collect();
            if !indices.is_empty() {
                used.extend(&indices);
                groups.push(indices);
                fallbacks += 1;
            }
        }
        // Preserve runs of inset short italic lines, even across coarse P tags.
        let mut verse_indices = BTreeSet::new();
        let mut run: Vec<&deep::PdfLine> = vec![];
        let mut verse_groups = vec![];
        let finish_run = |run: &mut Vec<&deep::PdfLine>, output: &mut Vec<Vec<usize>>| {
            if run.len() >= 4 {
                for line in run.iter() {
                    let indices: Vec<_> = line
                        .spans
                        .iter()
                        .flat_map(|s| s.indices.iter().copied())
                        .filter(|i| !excluded.contains(i))
                        .collect();
                    if !indices.is_empty() {
                        output.push(indices);
                    }
                }
            }
            run.clear();
        };
        for line in &d.lines {
            let chars: Vec<_> = line
                .spans
                .iter()
                .flat_map(|s| s.indices.iter())
                .map(|&i| &page.chars[i])
                .filter(|c| !c.text.trim().is_empty())
                .collect();
            let candidate = line.removed.is_none()
                && line.note.is_none()
                && chars.len() >= 12
                && chars.len() <= 90
                && chars.iter().filter(|c| c.italic).count() * 5 >= chars.len() * 4
                && line.bounds[0] > page.width * 0.22
                && line.bounds[2] - line.bounds[0] < page.width * 0.65;
            let contiguous = run.last().is_none_or(|previous| {
                (previous.bounds[0] - line.bounds[0]).abs() < page.width * 0.025
                    && line.baseline - previous.baseline > 0.
                    && line.baseline - previous.baseline < line.size * 2.
            });
            if !candidate || !contiguous {
                finish_run(&mut run, &mut verse_groups);
            }
            if candidate {
                run.push(line);
            }
        }
        finish_run(&mut run, &mut verse_groups);
        if !verse_groups.is_empty() {
            verse_report.push(json!({"page":pi+1,"lines":verse_groups.len()}));
            verse_indices.extend(verse_groups.iter().flatten().copied());
            for group in &mut groups {
                group.retain(|i| !verse_indices.contains(i));
            }
            groups.retain(|g| !g.is_empty());
            groups.extend(verse_groups);
        }
        groups.sort_by_key(|g| *g.iter().min().unwrap());
        let mut images: Vec<_> = page
            .images
            .iter()
            .filter(|i| !i.background && i.asset.is_some())
            .collect();
        images.sort_by(|a, b| a.bounds[1].total_cmp(&b.bounds[1]));
        let mut image_at = 0;
        let group_len = groups.len();
        for (gi, mut indices) in groups.into_iter().enumerate() {
            indices.sort_unstable();
            indices.dedup();
            let top = indices
                .iter()
                .map(|&i| page.chars[i].bounds[1])
                .fold(f32::INFINITY, f32::min);
            while image_at < images.len() && images[image_at].bounds[1] <= top {
                flush(&mut model, &mut pending)?;
                let im = images[image_at];
                let asset = format!("assets/pdf/{}", im.asset.as_ref().unwrap());
                image_hints.insert(model.blocks.len(), (asset.clone(), im.bounds, page.width));
                model.blocks.push(Block::Image {
                    asset,
                    cover: false,
                });
                image_at += 1;
            }
            let mut raw: Vec<RawSpan> = vec![];
            let mut previous = None;
            for &i in &indices {
                let c = &page.chars[i];
                if let Some(prev) = previous {
                    let between = &page.chars[prev + 1..i];
                    if between
                        .iter()
                        .any(|c| c.text.chars().any(char::is_whitespace))
                        && !raw.last().is_some_and(|s| s.0.ends_with(['-', '\u{2}']))
                    {
                        raw.push((" ".into(), Style::default(), None));
                    }
                }
                let text = c.text.clone();
                let style = styles.get(&i).copied().unwrap_or(Style {
                    italic: c.italic,
                    ..Style::default()
                });
                raw.push((text, style, links.get(&i).cloned()));
                if let Some((anchor, id)) = &synthetic_anchor
                    && i == *anchor
                {
                    raw.push((
                        "*".into(),
                        Style {
                            superscript: true,
                            ..Style::default()
                        },
                        Some(format!("#{id}")),
                    ));
                }
                previous = Some(i);
            }
            let text = plain(&raw);
            if text.trim().is_empty() {
                continue;
            }
            let letters: String = text.chars().filter(|c| c.is_alphabetic()).collect();
            let compact = letters.to_lowercase();
            let (l, r) = (
                indices
                    .iter()
                    .map(|&i| page.chars[i].bounds[0])
                    .fold(f32::INFINITY, f32::min),
                indices
                    .iter()
                    .map(|&i| page.chars[i].bounds[2])
                    .fold(0., f32::max),
            );
            let centered = ((l + r) / 2. - page.width / 2.).abs() < page.width * 0.08;
            let heading = text.chars().count() < 120
                && letters.chars().count() >= 3
                && centered
                && (["глава", "книга", "часть", "эпизод", "chapter"]
                    .iter()
                    .any(|s| compact.starts_with(s))
                    || letters.chars().filter(|c| c.is_uppercase()).count() * 10
                        >= letters.chars().count() * 9);
            let kind = if indices.iter().any(|i| verse_indices.contains(i)) {
                ParagraphKind::Verse
            } else if heading {
                ParagraphKind::Heading
            } else {
                ParagraphKind::Body
            };
            let can_merge = pending.as_ref().is_some_and(|p| {
                p.last
                    && gi == 0
                    && p.page + 1 == pi
                    && p.kind == ParagraphKind::Body
                    && kind == ParagraphKind::Body
                    && !plain(&p.raw)
                        .trim_end()
                        .ends_with(['.', '!', '?', ':', ';', '»'])
                    && text
                        .trim_start()
                        .chars()
                        .next()
                        .is_some_and(char::is_lowercase)
            });
            if can_merge {
                let p = pending.as_mut().unwrap();
                let hyphen = plain(&p.raw).trim_end().ends_with(['-', '\u{2}']);
                if hyphen {
                    while p.raw.last().is_some_and(|s| s.0.trim().is_empty()) {
                        p.raw.pop();
                    }
                    if let Some(s) = p.raw.last_mut() {
                        s.0.pop();
                    }
                } else {
                    p.raw.push((" ".into(), Style::default(), None));
                }
                p.raw.extend(raw);
                p.page = pi;
                p.last = gi + 1 == group_len;
                merges += 1;
            } else {
                flush(&mut model, &mut pending)?;
                pending = Some(Paragraph {
                    raw,
                    kind,
                    page: pi,
                    last: gi + 1 == group_len,
                });
            }
        }
        while image_at < images.len() {
            flush(&mut model, &mut pending)?;
            let im = images[image_at];
            let asset = format!("assets/pdf/{}", im.asset.as_ref().unwrap());
            image_hints.insert(model.blocks.len(), (asset.clone(), im.bounds, page.width));
            model.blocks.push(Block::Image {
                asset,
                cover: false,
            });
            image_at += 1;
        }
        report.push(json!({"page":pi+1,"kind":"flow","text_chars":count,"paragraphs":group_len}));
    }
    flush(&mut model, &mut pending)?;
    for b in &model.blocks {
        if let Block::Paragraph { spans, .. } = b {
            for s in spans {
                if let Some(id) = s.link.as_deref().and_then(|s| s.strip_prefix('#')) {
                    let raw = &model.text[s.start..s.end];
                    let start = s.start + raw.len() - raw.trim_start().len();
                    model.note_references.push(NoteReference {
                        note_id: id.into(),
                        label: raw.trim().into(),
                        start,
                        end: s.end,
                    });
                }
            }
        }
    }
    for note in &old.model.notes {
        let at = model.blocks.len();
        for b in &note.blocks {
            if let Block::Paragraph { spans, style, .. } = b {
                model.append_paragraph(
                    spans
                        .iter()
                        .map(|s| (old.model.text[s.start..s.end].to_owned(), s.style, None))
                        .collect(),
                    *style,
                    None,
                    None,
                )?;
            }
        }
        model.notes.push(Note {
            id: note.id.clone(),
            label: note.label.clone(),
            blocks: model.blocks.drain(at..).collect(),
        });
    }
    for (id, raw) in &inferred_notes {
        let at = model.blocks.len();
        model.append_paragraph(raw.clone(), ParagraphKind::Body, None, None)?;
        model.notes.push(Note {
            id: id.clone(),
            label: "*".into(),
            blocks: model.blocks.drain(at..).collect(),
        });
    }
    for (i, (asset, bounds, pw)) in image_hints {
        if matches!(
            model.blocks.get(i + 1),
            Some(Block::Paragraph {
                style: ParagraphKind::Body,
                ..
            })
        ) {
            let (w, h) = (bounds[2] - bounds[0], bounds[3] - bounds[1]);
            if w < pw * 0.95 && h > 0. && w > 0. {
                let width = (w / pw * 656.).clamp(80., 240.);
                let height = width * h / w;
                if height <= 400. {
                    plan.floats.push(FloatSpec {
                        image_block: i,
                        paragraph_block: i + 1,
                        asset,
                        left: bounds[0] + bounds[2] < pw,
                        width,
                        height,
                    });
                }
            }
        }
    }
    let mut manifest = super::manifest(source, &deep::ReaderHandler)?;
    manifest.importer_id = Some(IMPORTER.into());
    manifest.metadata = Some(model.metadata.clone());
    manifest.edition_id = super::identity_manifest(&manifest);
    let mut assets = BTreeSet::new();
    for b in &model.blocks {
        if let Block::Image { asset, .. } = b {
            assets.insert(asset.clone());
        }
    }
    for asset in assets {
        let bytes = std::fs::read(directory.path().join(&asset))?;
        manifest.assets.push(super::FileRecord {
            path: asset,
            sha256: crate::library::store::hash_reader(bytes.as_slice())?,
            bytes: bytes.len() as u64,
        });
    }
    manifest.assets.push(super::write_file(
        directory.path(),
        "publication.json",
        &serde_json::to_vec(&model)?,
    )?);
    std::fs::write(
        diagnostics.join("plan.json"),
        serde_json::to_vec_pretty(&plan)?,
    )?;
    std::fs::write(
        diagnostics.join("diagnostics.json"),
        serde_json::to_vec_pretty(
            &json!({"verse_blocks":verse_report,"image_text_removals":image_text_removals,"pages":report,"tagged_paragraphs":tagged,"fallback_groups":fallbacks,"cross_page_merges":merges,"notes":model.notes.len(),"inferred_editorial_notes":inferred_notes.len(),"references":model.note_references.len(),"removed_folios":old.assessment.removed_page_numbers,"floats":plan.floats.len()}),
        )?,
    )?;
    std::fs::write(
        diagnostics.join("removals.json"),
        serde_json::to_vec(&old.assessment.removals)?,
    )?;
    eprintln!(
        "smart: publishing {} paragraphs; {} notes; {} floats",
        model.blocks.len(),
        model.notes.len(),
        plan.floats.len()
    );
    super::typography::publish_planned(&model, directory.path(), &mut manifest, &plan)?;
    manifest.page_count = manifest.pages.len();
    let doc = super::open_payload(directory.path(), &manifest)?;
    let thumbnail = crate::library::thumbnail::render(doc.as_ref())?;
    super::write_file(
        directory.path(),
        "manifest.json",
        &serde_json::to_vec_pretty(&manifest)?,
    )?;
    let mut assessment = old.assessment;
    assessment.importer = IMPORTER.into();
    assessment.paragraphs = model
        .blocks
        .iter()
        .filter(|b| matches!(b, Block::Paragraph { .. }))
        .count();
    assessment.footnotes = model.notes.len();
    Ok((
        assessment,
        Some(super::Prepared {
            manifest,
            thumbnail,
            directory: Some(directory),
            installed_fonts: vec![],
        }),
    ))
}
