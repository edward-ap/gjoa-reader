//! Footnote-aware candidates in the canonical optimizer. Uses the same measured
//! lines, placements, soft costs and page renderer as ordinary page allocation.
use super::*;
use crate::publication::typography::FOOTNOTE_STYLE as STYLE;
use std::collections::{BTreeMap, BTreeSet, VecDeque};
pub(crate) struct MeasuredNote {
    pub lines: Vec<Line>,
    pub label: Vec<Item>,
    pub continued: Vec<Item>,
}
#[derive(Clone)]
pub(crate) struct Pending {
    pub(crate) note: usize,
    pub(crate) offset: usize,
}
#[derive(Clone, Serialize)]
pub struct Slice {
    pub note: usize,
    pub start: usize,
    pub end: usize,
}
#[derive(Serialize)]
pub struct NotePageTrace {
    pub page: usize,
    pub continuation: bool,
    pub visible_refs: Vec<String>,
    pub height: f32,
    pub separator_y: f32,
    pub slices: Vec<Slice>,
    pub pending: Vec<(String, usize)>,
    pub main_placements: Vec<Placement>,
}
#[derive(Clone)]
pub(crate) struct Allocation {
    separator_gap: f32,
    pub(crate) slices: Vec<Slice>,
    pub(crate) pending: VecDeque<Pending>,
    pub(crate) height: f32,
}
struct Unit {
    placement: Placement,
    height: f32,
    gap: f32,
    refs: Vec<usize>,
    chapter: bool,
    cover: bool,
}
const MAX_PAGE_REFS: usize = 64;
const MAX_CONTINUATIONS: usize = 1000;

pub(crate) fn allocate_with_policy(
    mut pending: VecDeque<Pending>,
    notes: &[MeasuredNote],
    limit: f32,
    editorial: bool,
) -> Allocation {
    let separator_gap = if editorial { 20. } else { STYLE.separator_gap };
    let mut height = separator_gap;
    let mut slices = vec![];
    while let Some(p) = pending.front().cloned() {
        let note = &notes[p.note];
        let marker = if p.offset > 0 { STYLE.line_height } else { 0. };
        let mut end = p.offset;
        let mut used = marker;
        while end < note.lines.len() && height + used + note.lines[end].height <= limit + 0.001 {
            used += note.lines[end].height;
            end += 1;
        }
        if end < note.lines.len()
            && note.lines.len() - end == 1
            && end - p.offset > STYLE.minimum_lines
        {
            end -= 1;
            used -= note.lines[end].height;
        }
        let minimum = STYLE.minimum_lines.min(note.lines.len() - p.offset);
        if end - p.offset < minimum {
            break;
        }
        slices.push(Slice {
            note: p.note,
            start: p.offset,
            end,
        });
        height += used;
        pending.pop_front();
        if end < note.lines.len() {
            pending.push_front(Pending {
                note: p.note,
                offset: end,
            });
            break;
        }
    }
    Allocation {
        separator_gap,
        slices,
        pending,
        height: if height == separator_gap { 0. } else { height },
    }
}
pub(crate) fn refs_for(
    items: &[Item],
    model: &Publication,
    lookup: &BTreeMap<&str, usize>,
) -> Vec<usize> {
    let mut found = BTreeSet::new();
    for item in items {
        let (start, end) = match item {
            Item::GlyphRun {
                source_start,
                source_end,
                ..
            }
            | Item::RasterGlyph {
                source_start,
                source_end,
                ..
            } => (*source_start, *source_end),
            _ => continue,
        };
        let first = model.note_references.partition_point(|r| r.end <= start);
        for r in model.note_references[first..]
            .iter()
            .take_while(|r| r.start < end)
        {
            if let Some(&note) = lookup.get(r.note_id.as_str()) {
                found.insert((r.start, note));
            }
        }
    }
    found.into_iter().map(|(_, n)| n).collect()
}
pub(crate) fn compose(
    page: &mut PageLayout,
    allocation: &Allocation,
    notes: &[MeasuredNote],
    continuation: bool,
) -> f32 {
    let separator = if continuation {
        TOP
    } else {
        BOTTOM - allocation.height
    };
    page.items.push(Item::Rule {
        bounds: [72., separator, STYLE.separator_width, 0.75],
    });
    let mut y = separator + allocation.separator_gap;
    for s in &allocation.slices {
        let n = &notes[s.note];
        let label = if s.start > 0 { &n.continued } else { &n.label };
        for item in label {
            let mut item = item.clone();
            translate(&mut item, 0., y);
            page.items.push(item);
        }
        if s.start > 0 {
            y += STYLE.line_height;
        }
        for line in &n.lines[s.start..s.end] {
            for item in &line.items {
                let mut item = item.clone();
                translate(&mut item, 0., y);
                page.items.push(item);
            }
            y += line.height;
        }
    }
    separator
}
#[allow(clippy::too_many_arguments)] // Diagnostic snapshot of a committed candidate.
fn record(
    trace: &mut Trace,
    model: &Publication,
    page: usize,
    continuation: bool,
    refs: &[usize],
    draft: &Draft,
    a: &Allocation,
    separator: f32,
) {
    if CAPTURE.with(|c| c.get()) {
        trace.note_pages.push(NotePageTrace {
            page,
            continuation,
            visible_refs: refs.iter().map(|&i| model.notes[i].id.clone()).collect(),
            height: a.height,
            separator_y: separator,
            slices: a.slices.clone(),
            pending: a
                .pending
                .iter()
                .map(|p| (model.notes[p.note].id.clone(), p.offset))
                .collect(),
            main_placements: draft.entries.clone(),
        });
    }
}
pub(crate) fn paginate(
    model: &Publication,
    blocks: &[Measured],
    notes: &[MeasuredNote],
) -> Result<(Vec<PageLayout>, Trace)> {
    paginate_with_policy(model, blocks, notes, false)
}
pub(crate) fn paginate_with_policy(
    model: &Publication,
    blocks: &[Measured],
    notes: &[MeasuredNote],
    editorial: bool,
) -> Result<(Vec<PageLayout>, Trace)> {
    let started = std::time::Instant::now();
    let mut trace = Trace::default();
    let lookup: BTreeMap<_, _> = model
        .notes
        .iter()
        .enumerate()
        .map(|(i, n)| (n.id.as_str(), i))
        .collect();
    let chapters: BTreeSet<_> = model
        .structure
        .iter()
        .filter(|s| s.chapter)
        .map(|s| s.block)
        .collect();
    let mut units = vec![];
    for (block, b) in blocks.iter().enumerate() {
        match b {
            Measured::Text { lines, .. } | Measured::Table { lines } => {
                let gap = if let Measured::Text { gap, .. } = b {
                    *gap
                } else {
                    6.
                };
                for (line, l) in lines.iter().enumerate() {
                    units.push(Unit {
                        placement: Placement {
                            block,
                            line: Some(line),
                            y: 0.,
                            scale: 1.,
                            anchor_delta: 0,
                        },
                        height: l.height,
                        gap: if line + 1 == lines.len() { gap } else { 0. },
                        refs: refs_for(&l.items, model, &lookup),
                        chapter: line == 0 && chapters.contains(&block),
                        cover: false,
                    });
                }
            }
            Measured::Image { height, cover, .. } => units.push(Unit {
                placement: Placement {
                    block,
                    line: None,
                    y: 0.,
                    scale: 1.,
                    anchor_delta: 0,
                },
                height: *height,
                gap: 14.,
                refs: vec![],
                chapter: chapters.contains(&block),
                cover: *cover,
            }),
            Measured::Space => {
                if let Some(last) = units.last_mut() {
                    last.gap += 28.;
                }
            }
        }
        if units.len() > 1_000_000 {
            return Err("Main measured line limit exceeded".into());
        }
    }
    let mut pages = vec![];
    let mut at = 0;
    while at < units.len() {
        let mut draft = Draft::default();
        let mut refs = vec![];
        let mut seen = BTreeSet::new();
        let mut best: Option<(f64, usize, Draft, Vec<usize>, Allocation)> = None;
        // Explicit break candidates: notes cannot appear/disappear in a fitting loop.
        for (index, u) in units.iter().enumerate().skip(at).take(MAX_WINDOW_LINES) {
            if index > at && (u.chapter || u.cover || draft.cover) {
                break;
            }
            let mut p = u.placement.clone();
            let mut h = u.height;
            if p.line.is_none() && !u.cover {
                p.scale = SCALES
                    .into_iter()
                    .find(|s| draft.used + h * s <= CAPACITY)
                    .unwrap_or(1.);
                h *= p.scale;
            }
            let tolerance = if p.line.is_some() && h <= 36. {
                TEXT_EDGE_TOLERANCE
            } else {
                0.001
            };
            if draft.used + h > CAPACITY + tolerance {
                break;
            }
            p.y = TOP + draft.used;
            draft.entries.push(p);
            draft.used += h;
            draft.cover = u.cover;
            for &n in &u.refs {
                if seen.insert(n) {
                    refs.push(n);
                }
            }
            if refs.len() > MAX_PAGE_REFS {
                if index == at {
                    return Err("More than 64 distinct footnotes on one main line".into());
                }
                break;
            }
            let limit = (CAPACITY * STYLE.max_fraction).min(CAPACITY - draft.used);
            let pending = refs
                .iter()
                .map(|&note| Pending { note, offset: 0 })
                .collect();
            let allocation = allocate_with_policy(pending, notes, limit, editorial);
            // Later references join the pending queue even when an earlier
            // long note occupies this page's entire note region. Requiring
            // every note to start here strands otherwise fitting main text.
            if refs.is_empty() || !allocation.slices.is_empty() {
                let chapter_end = index + 1 == units.len() || units[index + 1].chapter;
                let mut cost_draft = draft.clone();
                cost_draft.used += allocation.height;
                let score = page_cost(&cost_draft, blocks, chapter_end).total()
                    + if allocation.pending.is_empty() {
                        0.
                    } else {
                        3. + 8.
                            * f64::from(
                                (1. - allocation.height / (CAPACITY * STYLE.max_fraction)).max(0.),
                            )
                    };
                if best.as_ref().is_none_or(|b| score <= b.0) {
                    best = Some((score, index + 1, draft.clone(), refs.clone(), allocation));
                }
            }
            draft.used = (draft.used + u.gap).min(CAPACITY);
            if u.cover {
                break;
            }
        }
        let (_,next,draft,refs,allocation)=best.ok_or("No valid main/footnote page candidate: indivisible line or note start exceeds page limits")?;
        if next <= at {
            return Err("Footnote main cursor did not advance".into());
        }
        let mut page = render_draft(&draft, blocks);
        if !allocation.slices.is_empty() {
            let separator = compose(&mut page, &allocation, notes, false);
            record(
                &mut trace,
                model,
                pages.len() + 1,
                false,
                &refs,
                &draft,
                &allocation,
                separator,
            );
        }
        pages.push(page);
        at = next;
        let mut pending = allocation.pending;
        let mut continuation_count = 0;
        // A continuation owns its entire page, including the final short tail.
        // Resume the main cursor only in the outer loop, on a fresh page.
        while !pending.is_empty() {
            continuation_count += 1;
            if continuation_count > MAX_CONTINUATIONS {
                return Err("Footnote exceeds 1000 continuation pages".into());
            }
            let allocation = allocate_with_policy(pending, notes, CAPACITY, editorial);
            if allocation.slices.is_empty() || allocation.slices.iter().any(|s| s.end <= s.start) {
                return Err("Footnote continuation cannot advance within page geometry".into());
            }
            let mut page = PageLayout {
                width: WIDTH,
                height: HEIGHT,
                items: vec![],
            };
            let separator = compose(&mut page, &allocation, notes, true);
            record(
                &mut trace,
                model,
                pages.len() + 1,
                true,
                &[],
                &Draft::default(),
                &allocation,
                separator,
            );
            pages.push(page);
            pending = allocation.pending;
            if pages.len() > 20_000 {
                return Err("Too many generated pages".into());
            }
        }
        if pages.len() > 20_000 {
            return Err("Too many generated pages".into());
        }
    }
    trace.optimization_ms = started.elapsed().as_secs_f64() * 1000.;
    Ok((pages, trace))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::publication::model::{Note, NoteReference};

    #[test]
    fn one_line_final_continuation_never_shares_a_page_with_main_text() {
        fn line(start: usize, height: f32) -> Line {
            Line {
                height,
                items: vec![Item::GlyphRun {
                    font: 0,
                    size: 15.,
                    glyphs: vec![],
                    source_start: start,
                    source_end: start + 1,
                    bounds: [72., 0., 10., 15.],
                }],
            }
        }
        let model = Publication {
            schema_version: 3,
            text: "1Mabc".into(),
            blocks: vec![],
            metadata: Default::default(),
            structure: vec![],
            notes: vec![Note {
                id: "note".into(),
                label: "1".into(),
                blocks: vec![],
            }],
            note_references: vec![NoteReference {
                note_id: "note".into(),
                label: "1".into(),
                start: 0,
                end: 1,
            }],
        };
        // Force exactly two note lines onto the reference page. The last
        // note line leaves ample room for main text on its continuation page.
        let main = [Measured::Text {
            lines: vec![line(0, CAPACITY - STYLE.separator_gap - 40.), line(1, 28.)],
            gap: 0.,
            heading: false,
            movable: false,
        }];
        let notes = [MeasuredNote {
            lines: vec![line(2, 20.), line(3, 20.), line(4, 20.)],
            label: vec![],
            continued: vec![],
        }];
        capture_trace(true);
        let (pages, trace) = paginate(&model, &main, &notes).unwrap();
        capture_trace(false);
        assert_eq!(pages.len(), 3);
        let tail = &trace.note_pages[1];
        assert!(tail.continuation);
        assert!(tail.main_placements.is_empty());
        assert!(tail.pending.is_empty());
        assert_eq!(tail.slices.len(), 1);
        assert_eq!(tail.slices[0].end - tail.slices[0].start, 1);
        assert_eq!(tail.height, STYLE.separator_gap + STYLE.line_height + 20.);
        let starts = |page: &PageLayout| {
            page.items
                .iter()
                .filter_map(|item| {
                    if let Item::GlyphRun { source_start, .. } = item {
                        Some(*source_start)
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(starts(&pages[0]), [0, 2, 3]);
        assert_eq!(starts(&pages[1]), [4]);
        assert_eq!(starts(&pages[2]), [1]);
    }
}
