//! Deterministic, source-neutral page allocation. Shaped lines are immutable.
use super::{
    model::Publication,
    typography::{HEIGHT, Item, PageLayout, WIDTH},
};
use crate::library::Result;
use serde::Serialize;
const TOP: f32 = 72.;
const BOTTOM: f32 = 1032.;
const CAPACITY: f32 = BOTTOM - TOP;
// A text row may extend slightly into the bottom margin; never scale its glyphs.
const TEXT_EDGE_TOLERANCE: f32 = 3.;
pub const SCALES: [f32; 5] = [1., 0.9, 0.8, 0.7, 0.6];
pub const WINDOW_BLOCKS: usize = 5;
pub const MAX_WINDOW_LINES: usize = 200;
pub const MAX_CANDIDATES: usize = 15;
const MIN_LINES: usize = 2;
const ILLUSTRATION_CONTEXT_LINES: usize = 3;
const MAX_TRACE_CANDIDATES: usize = 100_000;

#[derive(Clone)]
pub(crate) struct Line {
    pub items: Vec<Item>,
    pub height: f32,
}
pub(crate) enum Measured {
    Table {
        lines: Vec<Line>,
    },
    Text {
        lines: Vec<Line>,
        gap: f32,
        heading: bool,
        movable: bool,
    },
    Image {
        asset: String,
        width: f32,
        height: f32,
        cover: bool,
    },
    Space,
}
#[derive(Clone, Serialize)]
pub struct Placement {
    pub block: usize,
    pub line: Option<usize>,
    pub y: f32,
    pub scale: f32,
    pub anchor_delta: i32,
}
#[derive(Clone, Default)]
struct Draft {
    entries: Vec<Placement>,
    used: f32,
    cover: bool,
}
#[derive(Clone, Default)]
struct State {
    done: Vec<Draft>,
    page: Draft,
}
impl State {
    fn next(&mut self) {
        if !self.page.entries.is_empty() {
            self.done.push(std::mem::take(&mut self.page));
        } else {
            self.page.used = 0.;
        }
    }
}
#[derive(Clone, Default, Serialize)]
pub struct Penalties {
    pub whitespace: f64,
    pub widow: f64,
    pub orphan: f64,
    pub stranded_heading: f64,
    pub isolated_illustration: f64,
    pub image_scale: f64,
    pub anchor_move: f64,
    pub page: f64,
}
impl Penalties {
    pub fn total(&self) -> f64 {
        self.whitespace
            + self.widow
            + self.orphan
            + self.stranded_heading
            + self.isolated_illustration
            + self.image_scale
            + self.anchor_move
            + self.page
    }
}
/// Centralized soft costs. Chapter endings/covers are exempt from whitespace costs.
pub fn soft_cost(
    unused: f64,
    chapter_end: bool,
    widow: bool,
    orphan: bool,
    isolated: bool,
    scale: f64,
    displacement: i32,
) -> Penalties {
    Penalties {
        whitespace: if chapter_end {
            0.
        } else {
            120. * unused.clamp(0., 1.).powi(2)
        },
        widow: if widow { 80. } else { 0. },
        orphan: if orphan { 80. } else { 0. },
        isolated_illustration: if isolated { 90. } else { 0. },
        image_scale: 100. * (1. - scale).powi(2),
        anchor_move: 12. * f64::from(displacement.abs()).powi(2),
        page: 4.,
        ..Default::default()
    }
}
fn page_cost(page: &Draft, blocks: &[Measured], end: bool) -> Penalties {
    let text: Vec<_> = page.entries.iter().filter(|p| p.line.is_some()).collect();
    let images: Vec<_> = page
        .entries
        .iter()
        .filter(|p| matches!(blocks[p.block], Measured::Image { cover: false, .. }))
        .collect();
    let widow = text.first().is_some_and(|p| match &blocks[p.block] {
        Measured::Text { lines, .. } => p.line == Some(lines.len() - 1) && lines.len() > 1,
        _ => false,
    });
    let orphan = text.last().is_some_and(
        |p| matches!(&blocks[p.block],Measured::Text{lines,..} if p.line==Some(0) && lines.len()>1),
    );
    // A measured float band is one indivisible placement, but contains many
    // visual text rows. Count those rows when judging illustration context.
    let context_rows: usize = text
        .iter()
        .map(|p| {
            let (Measured::Text { lines, .. } | Measured::Table { lines }) = &blocks[p.block]
            else {
                return 0;
            };
            let line = &lines[p.line.unwrap()];
            let mut baselines: Vec<f32> = line
                .items
                .iter()
                .filter_map(|item| match item {
                    Item::GlyphRun { glyphs, .. } => glyphs.first().map(|g| g.2),
                    Item::RasterGlyph { baseline, .. } => Some(baseline[1]),
                    _ => None,
                })
                .collect();
            baselines.sort_by(f32::total_cmp);
            let mut previous = None;
            baselines
                .into_iter()
                .filter(|y| {
                    if previous.is_none_or(|at: f32| *y - at > 14.) {
                        previous = Some(*y);
                        true
                    } else {
                        false
                    }
                })
                .count()
        })
        .sum();
    let mut cost = soft_cost(
        f64::from((CAPACITY - page.used).max(0.) / CAPACITY),
        end || page.cover,
        widow,
        orphan,
        !images.is_empty() && context_rows < ILLUSTRATION_CONTEXT_LINES,
        1.,
        0,
    );
    if text
        .last()
        .is_some_and(|p| matches!(blocks[p.block], Measured::Text { heading: true, .. }))
    {
        cost.stranded_heading = 120.;
    }
    for p in images {
        let c = soft_cost(
            0.,
            true,
            false,
            false,
            false,
            f64::from(p.scale),
            p.anchor_delta,
        );
        cost.image_scale += c.image_scale;
        cost.anchor_move += c.anchor_move;
    }
    cost
}
fn state_cost(state: &State, blocks: &[Measured]) -> f64 {
    state
        .done
        .iter()
        .map(|p| page_cost(p, blocks, false).total())
        .sum::<f64>()
        + if state.page.entries.is_empty() {
            0.
        } else {
            page_cost(&state.page, blocks, true).total()
        }
}
#[derive(Default, Serialize)]
pub struct Trace {
    pub note_pages: Vec<footnotes::NotePageTrace>,
    pub measurement_ms: f64,
    pub optimization_ms: f64,
    pub peak_candidates: usize,
    pub fallbacks: usize,
    pub truncated: bool,
    pub candidates: Vec<CandidateTrace>,
    pub pages: Vec<PageTrace>,
}
#[derive(Serialize)]
pub struct CandidateTrace {
    pub from: usize,
    pub to: usize,
    pub image: usize,
    pub scale: f32,
    pub anchor_delta: i32,
    pub pages: usize,
    pub score: f64,
    pub selected: bool,
}
#[derive(Serialize)]
pub struct PageTrace {
    pub page: usize,
    pub used_height: f32,
    pub unused_ratio: f32,
    pub chapter_end: bool,
    pub placements: Vec<Placement>,
    pub penalties: Penalties,
    pub total: f64,
}
thread_local! {
    static CAPTURE: std::cell::Cell<bool> = const {std::cell::Cell::new(false)};
    static TRACE: std::cell::RefCell<Option<Trace>> = const {std::cell::RefCell::new(None)};
}
pub fn capture_trace(enabled: bool) {
    CAPTURE.with(|c| c.set(enabled));
    TRACE.with(|t| *t.borrow_mut() = None);
}
pub fn take_trace() -> Option<Trace> {
    TRACE.with(|t| t.borrow_mut().take())
}
pub(crate) fn set_trace(trace: Trace) {
    if CAPTURE.with(|c| c.get()) {
        TRACE.with(|t| *t.borrow_mut() = Some(trace));
    }
}

fn following_height(blocks: &[Measured], at: usize, end: usize) -> f32 {
    let mut height = 0.;
    for block in blocks.iter().take(end).skip(at + 1).take(4) {
        match block {
            Measured::Text {
                lines,
                gap,
                heading,
                ..
            } => {
                if *heading {
                    height += lines.iter().map(|l| l.height).sum::<f32>() + gap;
                } else {
                    height += lines.iter().take(MIN_LINES).map(|l| l.height).sum::<f32>();
                    break;
                }
            }
            Measured::Table { lines } => {
                height += lines.first().map_or(0., |l| l.height);
                break;
            }
            Measured::Space => height += 28.,
            Measured::Image { height: h, .. } => {
                height += h * SCALES[SCALES.len() - 1] + 14.;
                break;
            }
        }
    }
    height
}
fn place(state: &mut State, blocks: &[Measured], index: usize, end: usize, scale: f32, delta: i32) {
    match &blocks[index] {
        Measured::Table { lines } => {
            for (line, measured) in lines.iter().enumerate() {
                if state.page.used + measured.height
                    > CAPACITY
                        + if measured.height <= 36. {
                            TEXT_EDGE_TOLERANCE
                        } else {
                            0.
                        }
                {
                    state.next();
                }
                state.page.entries.push(Placement {
                    block: index,
                    line: Some(line),
                    y: TOP + state.page.used,
                    scale: 1.,
                    anchor_delta: 0,
                });
                state.page.used += measured.height;
            }
            state.page.used = (state.page.used + 6.).min(CAPACITY);
        }

        Measured::Space => {
            if !state.page.entries.is_empty() {
                state.page.used = (state.page.used + 28.).min(CAPACITY);
            }
        }
        Measured::Image { height, cover, .. } => {
            let h = height * scale;
            if *cover || state.page.used + h > CAPACITY {
                state.next();
            }
            state.page.entries.push(Placement {
                block: index,
                line: None,
                y: TOP + state.page.used,
                scale,
                anchor_delta: delta,
            });
            state.page.used = (state.page.used + h + 14.).min(CAPACITY);
            state.page.cover = *cover;
            if *cover {
                state.next();
            }
        }
        Measured::Text {
            lines,
            gap,
            heading,
            ..
        } => {
            if *heading {
                let required = lines.iter().map(|l| l.height).sum::<f32>()
                    + gap
                    + following_height(blocks, index, end);
                if state.page.used + required.min(CAPACITY) > CAPACITY {
                    state.next();
                }
            }
            let mut line = 0;
            while line < lines.len() {
                let remaining = lines.len() - line;
                let mut used = state.page.used;
                let mut count = 0;
                for measured in &lines[line..] {
                    let tolerance = if measured.height <= 36. {
                        TEXT_EDGE_TOLERANCE
                    } else {
                        0.
                    };
                    if used + measured.height > CAPACITY + tolerance {
                        break;
                    }
                    used += measured.height;
                    count += 1;
                }
                let ordinary_chunk = lines[line..line + count].iter().all(|l| l.height <= 36.);
                let single_text_tail =
                    remaining - count == 1 && lines.last().is_some_and(|l| l.height <= 36.);
                if count < remaining
                    && ordinary_chunk
                    && (count < MIN_LINES || (single_text_tail && count == MIN_LINES))
                    && !state.page.entries.is_empty()
                {
                    state.next();
                    continue;
                }
                if remaining > count && single_text_tail && count > MIN_LINES {
                    count -= 1;
                }
                if count == 0 {
                    state.next();
                    count = 1;
                }
                for (n, measured) in lines.iter().enumerate().skip(line).take(count) {
                    state.page.entries.push(Placement {
                        block: index,
                        line: Some(n),
                        y: TOP + state.page.used,
                        scale: 1.,
                        anchor_delta: 0,
                    });
                    state.page.used += measured.height;
                }
                line += count;
                if line < lines.len() {
                    state.next();
                }
            }
            state.page.used = (state.page.used + gap).min(CAPACITY);
        }
    }
}
fn movable(block: &Measured) -> bool {
    matches!(
        block,
        Measured::Text {
            movable: true,
            heading: false,
            ..
        }
    )
}
pub(crate) fn paginate(
    model: &Publication,
    blocks: &[Measured],
) -> Result<(Vec<PageLayout>, Trace)> {
    let started = std::time::Instant::now();
    let capture = CAPTURE.with(|c| c.get());
    let mut trace = Trace::default();
    if blocks.len() > 100_000 {
        return Err("Optimizer block limit exceeded".into());
    }
    let mut boundaries = vec![0, blocks.len()];
    for s in &model.structure {
        if s.block > blocks.len() {
            return Err("Invalid structural anchor".into());
        }
        if s.chapter {
            boundaries.push(s.block);
        }
    }
    boundaries.sort_unstable();
    boundaries.dedup();
    let strong: std::collections::BTreeSet<_> = model.structure.iter().map(|s| s.block).collect();
    let mut pages = vec![];
    for chapter in boundaries.windows(2) {
        let end = chapter[1];
        let mut i = chapter[0];
        let mut state = State::default();
        while i < end {
            let image = (i..end.min(i + 3)).find(|&n| {
                matches!(blocks[n], Measured::Image { cover: false, .. })
                    && !(i..=n).any(|k| k != i && strong.contains(&k))
            });
            if let Some(image) = image {
                let to = (image + 2).min(end).min(i + WINDOW_BLOCKS);
                let line_count: usize = blocks[i..to]
                    .iter()
                    .map(|b| match b {
                        Measured::Text { lines, .. } | Measured::Table { lines } => lines.len(),
                        _ => 0,
                    })
                    .sum();
                if line_count > MAX_WINDOW_LINES {
                    trace.fallbacks += 1;
                    place(&mut state, blocks, i, end, 1., 0);
                    i += 1;
                    continue;
                }
                let mut best: Option<(f64, State, usize, usize)> = None;
                let mut count = 0;
                for scale in SCALES {
                    for delta in [0, -1, 1] {
                        let target = image as isize + delta as isize;
                        if target < i as isize || target >= to as isize {
                            continue;
                        }
                        if delta != 0
                            && (!movable(&blocks[target as usize])
                                || strong.contains(&image)
                                || strong.contains(&(target as usize)))
                        {
                            continue;
                        }
                        let mut order: Vec<usize> = (i..to).collect();
                        order.swap(image - i, target as usize - i);
                        let mut candidate = State {
                            page: state.page.clone(),
                            done: vec![],
                        };
                        let commit_to = image + 1 + usize::from(delta == 1);
                        let mut prefix = None;
                        for (position, n) in order.into_iter().enumerate() {
                            place(
                                &mut candidate,
                                blocks,
                                n,
                                end,
                                if n == image { scale } else { 1. },
                                if n == image { delta } else { 0 },
                            );
                            if position + 1 == commit_to - i {
                                prefix = Some(candidate.clone());
                            }
                        }
                        let score = state_cost(&candidate, blocks);
                        count += 1;
                        let ti = trace.candidates.len();
                        if capture && ti < MAX_TRACE_CANDIDATES {
                            trace.candidates.push(CandidateTrace {
                                from: i,
                                to,
                                image,
                                scale,
                                anchor_delta: delta,
                                pages: candidate.done.len()
                                    + usize::from(!candidate.page.entries.is_empty()),
                                score,
                                selected: false,
                            });
                        } else if capture {
                            trace.truncated = true;
                        }
                        // Stable enumeration: original anchor and larger size win equal costs.
                        if best.as_ref().is_none_or(|b| score.total_cmp(&b.0).is_lt()) {
                            best = Some((
                                score,
                                prefix.expect("complete candidate prefix"),
                                ti,
                                commit_to,
                            ));
                        }
                    }
                }
                trace.peak_candidates = trace.peak_candidates.max(count);
                if count > MAX_CANDIDATES {
                    return Err("Optimizer candidate bound exceeded".into());
                }
                let (_, chosen, ti, commit_to) = best.ok_or("No valid page candidate")?;
                if let Some(t) = trace.candidates.get_mut(ti) {
                    t.selected = true;
                }
                state.done.extend(chosen.done);
                state.page = chosen.page;
                // Keep following text provisional so it can participate in the next
                // illustration's lookahead. Only the chosen anchor decision commits.
                i = commit_to;
            } else {
                place(&mut state, blocks, i, end, 1., 0);
                i += 1;
            }
            if state.done.len() + pages.len() > 20_000 {
                return Err("Too many generated pages".into());
            }
        }
        state.next();
        let last = state.done.len().saturating_sub(1);
        for (index, draft) in state.done.into_iter().enumerate() {
            let page = render_draft(&draft, blocks);
            if capture {
                let penalties = page_cost(&draft, blocks, index == last);
                let total = penalties.total();
                trace.pages.push(PageTrace {
                    page: pages.len() + 1,
                    used_height: draft.used,
                    unused_ratio: (CAPACITY - draft.used).max(0.) / CAPACITY,
                    chapter_end: index == last,
                    placements: draft.entries,
                    penalties,
                    total,
                });
            }
            pages.push(page);
        }
    }
    trace.optimization_ms = started.elapsed().as_secs_f64() * 1000.;
    Ok((pages, trace))
}

#[cfg(test)]
#[path = "optimizer_tests.rs"]
mod tests;

pub(crate) mod footnotes;
fn render_draft(draft: &Draft, blocks: &[Measured]) -> PageLayout {
    let mut items = vec![];
    for p in &draft.entries {
        match &blocks[p.block] {
            Measured::Text { lines, .. } | Measured::Table { lines } => {
                for item in &lines[p.line.expect("text line")].items {
                    let mut item = item.clone();
                    if let Item::GlyphRun { glyphs, bounds, .. } = &mut item {
                        for g in glyphs {
                            g.2 = ((g.2 + p.y) * 64.).round() / 64.;
                        }
                        bounds[1] = ((bounds[1] + p.y) * 64.).round() / 64.;
                    }
                    if let Item::RasterGlyph {
                        baseline, bounds, ..
                    } = &mut item
                    {
                        baseline[1] = ((baseline[1] + p.y) * 64.).round() / 64.;
                        bounds[1] = ((bounds[1] + p.y) * 64.).round() / 64.;
                    }
                    if let Item::Image { bounds, .. } = &mut item {
                        bounds[1] += p.y;
                    }
                    items.push(item);
                }
            }
            Measured::Image {
                asset,
                width,
                height,
                ..
            } => {
                let w = width * p.scale;
                items.push(Item::Image {
                    asset: asset.clone(),
                    bounds: [(WIDTH as f32 - w) / 2., p.y, w, height * p.scale],
                });
            }
            Measured::Space => {}
        }
    }
    PageLayout {
        width: WIDTH,
        height: HEIGHT,
        items,
    }
}
pub(crate) fn translate(item: &mut Item, x: f32, y: f32) {
    let q = |v: f32| (v * 64.).round() / 64.;
    match item {
        Item::GlyphRun { glyphs, bounds, .. } => {
            for g in glyphs {
                g.1 = q(g.1 + x);
                g.2 = q(g.2 + y);
            }
            bounds[0] = q(bounds[0] + x);
            bounds[1] = q(bounds[1] + y);
        }
        Item::RasterGlyph {
            baseline, bounds, ..
        } => {
            baseline[0] = q(baseline[0] + x);
            baseline[1] = q(baseline[1] + y);
            bounds[0] = q(bounds[0] + x);
            bounds[1] = q(bounds[1] + y);
        }
        Item::Image { bounds, .. } | Item::Rule { bounds } => {
            bounds[0] = q(bounds[0] + x);
            bounds[1] = q(bounds[1] + y);
        }
    }
}
