//! Bounded composer with frozen experimental modes and Publisher 17 production policy.
use super::*;
use crate::publication::optimizer::{self, footnotes as note_layout};
use std::{
    collections::{BTreeMap, BTreeSet, VecDeque},
    rc::Rc,
};
mod gallery;
mod notes;
mod paragraph;
mod scoring;
pub mod search_diagnostics;
#[cfg(test)]
mod tests;
const TOP: f32 = 72.;
const CAPACITY: f32 = BOTTOM - TOP;
const BEAM: usize = 4;
const PAGE_BREAKS: usize = 4;
const TEXT_EDGE_TOLERANCE: f32 = 3.;
const WINDOW: usize = 3;
const MAX_OBJECTS: usize = 256;
const MAX_PAGES: usize = 20_000;
#[derive(Clone, Copy, Debug, Serialize)]
pub enum CompositionStrategy {
    Legacy,
    SlidingWindowV2,
    SlidingWindowV22,
    ProductionV22,
}
#[derive(Clone, Default, Debug, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct Cursor {
    pub block: usize,
    pub offset: usize,
}
#[derive(Clone, Serialize)]
struct Carried {
    block: usize,
    age: u8,
}
#[derive(Clone, Default)]
struct Boundary {
    wrap_count: usize,
    cursor: Cursor,
    carried: Vec<Carried>,
    placed: BTreeSet<usize>,
    pending: VecDeque<note_layout::Pending>,
}
#[derive(Serialize, PartialEq, Eq, PartialOrd, Ord)]
struct BoundaryKey {
    wrap_count: usize,
    cursor: Cursor,
    placed: Vec<usize>,
    carried: Vec<(usize, u8)>,
    pending: Vec<(usize, usize)>,
}
impl Boundary {
    fn key(&self) -> BoundaryKey {
        BoundaryKey {
            wrap_count: self.wrap_count,
            cursor: self.cursor.clone(),
            placed: self.placed.iter().copied().collect(),
            carried: self.carried.iter().map(|c| (c.block, c.age)).collect(),
            pending: self.pending.iter().map(|n| (n.note, n.offset)).collect(),
        }
    }
    fn finished(&self, model: &Publication) -> bool {
        self.cursor.block >= model.blocks.len()
            && self.carried.is_empty()
            && self.pending.is_empty()
    }
}
#[derive(Clone, Copy, Debug, Serialize)]
enum FlowBehavior {
    Splittable,
    KeepWithNext,
    Occupancy,
    Spacing,
}
#[derive(Clone, Debug, Serialize)]
struct LayoutBox {
    anchor: usize,
    behavior: FlowBehavior,
    preferred: [f32; 2],
    minimum: [f32; 2],
}
fn flow_boxes(model: &Publication) -> Vec<LayoutBox> {
    model
        .blocks
        .iter()
        .enumerate()
        .map(|(anchor, b)| LayoutBox {
            anchor,
            behavior: match b {
                Block::Paragraph {
                    style: ParagraphKind::Heading | ParagraphKind::Subtitle,
                    ..
                } => FlowBehavior::KeepWithNext,
                Block::Paragraph { .. } => FlowBehavior::Splittable,
                Block::Image { .. } => FlowBehavior::Occupancy,
                _ => FlowBehavior::Spacing,
            },
            preferred: [RIGHT - LEFT, 0.],
            minimum: [220., 28.],
        })
        .collect()
}
#[derive(Clone)]
struct ImageBox {
    layout: LayoutBox,
    asset: String,
    cover: bool,
    intrinsic: [f32; 2],
}
#[derive(Clone, Copy, Debug, Serialize)]
struct Policy {
    id: usize,
    side: i8,
    scale: f32,
    delay: u8,
    bottom: bool,
    defer: bool,
    full: bool,
    backward: bool,
    reserve: u8,
}
// Diversity uses semantic policy families, never book/page IDs or score weights.
// Side/delay variants share a family; reduced wrapping preserves a different
// text-column width even when its provisional page has more bottom whitespace.
fn plan_family(plan: &ImagePlan) -> Vec<(usize, u8, bool)> {
    plan.0
        .iter()
        .map(|(anchor, p)| {
            (
                *anchor,
                if p.id >= 14 {
                    p.id as u8
                } else if p.defer {
                    2
                } else if p.full {
                    1
                } else {
                    0
                },
                !p.full && !p.defer && p.scale < 1.,
            )
        })
        .collect()
}
fn expansion_slots(
    ranked: &[(f64, ImagePlan, Option<usize>)],
    beam: usize,
    diversity: bool,
) -> BTreeSet<usize> {
    let mut chosen = ranked
        .iter()
        .enumerate()
        .filter(|(_, r)| r.2.is_some())
        .take(beam)
        .map(|(i, _)| i)
        .collect::<BTreeSet<_>>();
    if diversity {
        let mut families = chosen
            .iter()
            .map(|i| plan_family(&ranked[*i].1))
            .collect::<BTreeSet<_>>();
        let mut extra = 0;
        for (i, r) in ranked.iter().enumerate() {
            if r.2.is_some() && r.0.is_finite() && families.insert(plan_family(&r.1)) {
                chosen.insert(i);
                extra += 1;
                if extra == 2 {
                    break;
                }
            }
        }
    }
    chosen
}
fn policies() -> Vec<Policy> {
    let base = Policy {
        id: 0,
        side: 0,
        scale: 1.,
        delay: 0,
        bottom: false,
        defer: false,
        full: false,
        backward: false,
        reserve: 0,
    };
    let mut p = vec![
        base,
        Policy { side: 1, ..base },
        Policy {
            scale: 0.85,
            ..base
        },
        Policy { scale: 0.7, ..base },
        Policy { delay: 2, ..base },
        Policy {
            delay: 4,
            scale: 0.85,
            ..base
        },
        Policy {
            bottom: true,
            ..base
        },
        Policy {
            defer: true,
            ..base
        },
        Policy { full: true, ..base },
        Policy {
            full: true,
            scale: 0.7,
            ..base
        },
        Policy {
            backward: true,
            ..base
        },
        Policy {
            backward: true,
            side: 1,
            ..base
        },
        Policy { reserve: 2, ..base },
        Policy { reserve: 4, ..base },
    ];
    for (id, v) in p.iter_mut().enumerate() {
        v.id = id;
    }
    p
}
const IMAGE_BEAM: usize = 2;
const IMAGE_BUDGET: usize = 36;
#[derive(Clone, Default)]
struct ImagePlan(BTreeMap<usize, Policy>);
impl ImagePlan {
    fn policy(&self, block: usize) -> Policy {
        self.0.get(&block).copied().unwrap_or_else(|| policies()[0])
    }
    fn key(&self) -> Vec<(usize, usize)> {
        self.0.iter().map(|(b, p)| (*b, p.id)).collect()
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct ImageDecision {
    pub block: usize,
    pub bounds: [f32; 4],
    pub scale: f32,
    pub side: String,
    pub anchor_distance: f32,
    pub policy: usize,
    pub intentional_side_space: bool,
}
#[derive(Clone)]
struct Draft {
    page: PageLayout,
    after: Boundary,
    decisions: Vec<ImageDecision>,
    cost: scoring::Cost,
    note_slices: Vec<note_layout::Slice>,
    continuation: bool,
    image_plan: Vec<(usize, usize)>,
}
#[derive(Default, Serialize)]
pub struct Diagnostics {
    pub windows: Vec<WindowTrace>,
    pub paragraph_cache_hits: usize,
    pub paragraph_cache_misses: usize,
    pub shaped_tokens: usize,
    pub image_geometry_cache_hits: usize,
    pub footnote_layout_cache_hits: usize,
    pub elapsed_ms: f64,
    pub note_measurement_ms: f64,
    pub composition_ms: f64,
    pub storage_ms: f64,
    pub candidates: usize,
    pub rejected: usize,
    pub short_tail_rejections: usize,
}
#[derive(Serialize)]
pub struct WindowTrace {
    pub page: usize,
    pub cursor: Cursor,
    pub generated: usize,
    pub pruned: usize,
    pub chosen: Vec<usize>,
    pub score: f64,
    pub components: Vec<scoring::Cost>,
    pub continuation: bool,
    pub next_cursor: Cursor,
    pub images: Vec<ImageDecision>,
    pub notes: Vec<note_layout::Slice>,
    pub provisional_cursors: Vec<Cursor>,
    pub pending_notes: Vec<(usize, usize)>,
    pub carried_images: Vec<usize>,
    pub provisional_images: Vec<Vec<ImageDecision>>,
    pub image_plans: Vec<Vec<(usize, usize)>>,
    pub alternatives: Vec<(Vec<usize>, f64)>,
    pub alternative_components: Vec<Vec<scoring::Cost>>,
    pub rejections: BTreeMap<String, usize>,
}
#[derive(Clone)]
struct Candidate {
    pages: Vec<Rc<Draft>>,
    state: Boundary,
    ids: Vec<usize>,
    score: f64,
}
struct WindowSearch {
    beam: Vec<Candidate>,
    generated: usize,
    pruned: usize,
    rejected: BTreeMap<String, usize>,
}
struct Engine<'a, 'b> {
    image_groups: bool,
    wrap_tail_space: bool,
    alternating_wraps: bool,
    interior_gaps: bool,
    production: bool,
    diversity: bool,
    model: &'a Publication,
    faces: &'a [rustybuzz::Face<'b>],
    resolver: FontResolver<'a>,
    paragraphs: paragraph::ParagraphComposer,
    images: BTreeMap<usize, ImageBox>,
    flow: Vec<LayoutBox>,
    notes: Vec<note_layout::MeasuredNote>,
    lookup: BTreeMap<&'a str, usize>,
    diagnostics: Diagnostics,
}
impl Engine<'_, '_> {
    fn image(
        &mut self,
        block: usize,
        y: f32,
        policy: Policy,
        oldest: bool,
        regions: &[[f32; 4]],
        wrap_count: usize,
    ) -> Result<(Item, ImageDecision)> {
        self.diagnostics.image_geometry_cache_hits += 1;
        let image = &self.images[&block];
        let mut w = image.layout.preferred[0];
        let mut h = image.layout.preferred[1];
        if policy.full || image.cover {
            let s = ((RIGHT - LEFT) / w)
                .min(CAPACITY / h)
                .min(image.intrinsic[0] / w);
            w *= s;
            h *= s;
        }
        let scale = if image.cover { 1. } else { policy.scale };
        w *= scale;
        h *= scale;
        if w + 0.01 < image.layout.minimum[0] || h + 0.01 < image.layout.minimum[1] {
            return Err("image below minimum size".into());
        }
        let mut top = if policy.bottom && !oldest && !image.cover {
            BOTTOM - h
        } else {
            y + if oldest || image.cover {
                0.
            } else {
                f32::from(policy.delay) * 28.
            }
        };
        for r in regions {
            top = top.max(r[1] + r[3] + 56.);
        }
        let centered = image.cover
            || policy.full
            || w >= (RIGHT - LEFT) * 0.7
            || (self.alternating_wraps && RIGHT - LEFT - w - 12. < 220.);
        let left = if centered {
            (LEFT + RIGHT - w) / 2.
        } else if self.alternating_wraps {
            if wrap_count.is_multiple_of(2) {
                RIGHT - w
            } else {
                LEFT
            }
        } else if block.is_multiple_of(2) ^ (policy.side == 1) {
            LEFT
        } else {
            RIGHT - w
        };
        let b = [left, top, w, h];
        if top < TOP || top + h > BOTTOM + 0.01 {
            return Err("image outside content bounds".into());
        }
        let side = if centered {
            "full"
        } else if left == LEFT {
            "left"
        } else {
            "right"
        };
        Ok((
            Item::Image {
                asset: image.asset.clone(),
                bounds: b,
            },
            ImageDecision {
                block,
                bounds: b,
                scale: w / image.layout.preferred[0],
                side: side.into(),
                policy: policy.id,
                intentional_side_space: image.cover || image.intrinsic[0] >= image.intrinsic[1],
                anchor_distance: ((top - y) / CAPACITY).abs() + if oldest { 1. } else { 0. },
            },
        ))
    }
    #[allow(clippy::collapsible_if)] // Keep speculative pre-anchor placement separate from eligibility.
    fn page(
        &mut self,
        initial: &Boundary,
        plan: &ImagePlan,
        encountered: &mut BTreeSet<usize>,
    ) -> Result<Vec<Draft>> {
        self.page_with_limits(initial, plan, encountered, PAGE_BREAKS, None)
    }
    #[allow(clippy::collapsible_if)] // Keep endpoint feasibility separate from diagnostic observation.
    fn page_with_limits(
        &mut self,
        initial: &Boundary,
        plan: &ImagePlan,
        encountered: &mut BTreeSet<usize>,
        endpoint_limit: usize,
        mut audit: Option<&mut search_diagnostics::EndpointAudit>,
    ) -> Result<Vec<Draft>> {
        let mut endpoints = vec![];
        let mut state = initial.clone();
        let mut page = PageLayout {
            width: WIDTH,
            height: HEIGHT,
            items: vec![],
        };
        if !state.pending.is_empty() {
            let a = note_layout::allocate_with_policy(
                state.pending.clone(),
                &self.notes,
                CAPACITY,
                self.paragraphs.editorial,
            );
            if a.slices.is_empty() {
                return Err("note continuation makes no progress".into());
            }
            note_layout::compose(&mut page, &a, &self.notes, true);
            state.pending = a.pending;
            self.diagnostics.footnote_layout_cache_hits += a.slices.len();
            return Ok(vec![Draft {
                page,
                after: state,
                decisions: vec![],
                cost: scoring::Cost::default(),
                note_slices: a.slices,
                continuation: true,
                image_plan: plan.key(),
            }]);
        }
        let mut y = TOP;
        let mut last_gap = 0.;
        let mut occupied = vec![];
        let mut decisions = vec![];
        let mut refs = vec![];
        let mut row_bands = vec![];
        let mut narrow = 0.;
        let mut heading_pending = false;
        let mut paragraph_rows = 0usize;
        let mut orphan = 0.;
        let mut intentional = false;
        let carried = std::mem::take(&mut state.carried);
        for carry in carried {
            if carry.age > 1 {
                return Err("image exceeded carry limit".into());
            }
            encountered.insert(carry.block);
            let (item, d) = self.image(
                carry.block,
                y,
                plan.policy(carry.block),
                true,
                &occupied,
                state.wrap_count,
            )?;
            if self.alternating_wraps && d.side != "full" {
                state.wrap_count += 1;
            }
            occupied.push(d.bounds);
            page.items.push(item);
            decisions.push(d);
            state.placed.insert(carry.block);
        }
        for _ in 0..MAX_OBJECTS * 40 {
            crate::import_cancel::check()?;
            if state.cursor.block >= self.model.blocks.len() {
                intentional = true;
                break;
            }
            let block = state.cursor.block;
            if block > initial.cursor.block + MAX_OBJECTS {
                break;
            }
            let chapter = self
                .model
                .structure
                .iter()
                .any(|s| s.chapter && s.block == block)
                && state.cursor.offset == 0;
            if chapter && !page.items.is_empty() {
                // Explicit chapter boundary outranks keep-with-next (part/title pages).
                heading_pending = false;
                intentional = true;
                break;
            }
            match &self.model.blocks[block] {
                Block::Table { .. } => {
                    return Err("tables outside SlidingWindowV2 experiment scope".into());
                }
                Block::EmptyLine => {
                    state.cursor = Cursor {
                        block: block + 1,
                        offset: 0,
                    };
                    y += 14.;
                    last_gap = 0.;
                }
                Block::Image { cover, .. } => {
                    if state.placed.contains(&block)
                        || state.carried.iter().any(|c| c.block == block)
                    {
                        state.cursor = Cursor {
                            block: block + 1,
                            offset: 0,
                        };
                        continue;
                    }
                    if *cover && !page.items.is_empty() {
                        intentional = true;
                        break;
                    }
                    encountered.insert(block);
                    let policy = plan.policy(block);
                    if self.image_groups && policy.id >= 14 {
                        let group = self.image_group(block, policy.id - 12, y, &occupied, &state);
                        match group {
                            Ok(group) => {
                                for (item, d) in group {
                                    y = y.max(d.bounds[1] + d.bounds[3] + 6.);
                                    occupied.push(d.bounds);
                                    state.placed.insert(d.block);
                                    state.cursor.block = d.block + 1;
                                    page.items.push(item);
                                    decisions.push(d);
                                }
                                state.cursor.offset = 0;
                                last_gap = 6.;
                            }
                            Err(e) => {
                                if page.items.is_empty() {
                                    return Err(e);
                                }
                                break;
                            }
                        }
                    } else {
                        let sequence = self.image_groups && self.in_image_sequence(block);
                        if policy.defer
                            && !sequence
                            && !*cover
                            && state.carried.is_empty()
                            && !heading_pending
                        {
                            state.carried.push(Carried { block, age: 0 });
                            state.cursor = Cursor {
                                block: block + 1,
                                offset: 0,
                            };
                            continue;
                        }
                        // A picture sequence has no prose to fill a delayed/bottom placement.
                        let policy = if sequence {
                            Policy {
                                bottom: false,
                                delay: 0,
                                ..policy
                            }
                        } else {
                            policy
                        };
                        match self.image(block, y, policy, false, &occupied, state.wrap_count) {
                            Ok((item, d)) => {
                                if self.alternating_wraps && d.side != "full" {
                                    state.wrap_count += 1;
                                }
                                occupied.push(d.bounds);
                                page.items.push(item);
                                decisions.push(d);
                                state.placed.insert(block);
                                state.cursor = Cursor {
                                    block: block + 1,
                                    offset: 0,
                                };
                                if *cover {
                                    intentional = true;
                                    break;
                                }
                            }
                            Err(e) => {
                                if page.items.is_empty() {
                                    return Err(e);
                                }
                                break;
                            }
                        }
                    }
                }
                Block::Paragraph {
                    start, end, style, ..
                } => {
                    let heading = matches!(self.flow[block].behavior, FlowBehavior::KeepWithNext);
                    if heading && state.cursor.offset == 0 {
                        let bottom = occupied.iter().map(|r| r[1] + r[3]).fold(y, f32::max);
                        if bottom > y {
                            y = bottom + 6.;
                        }
                        if y + 108. > BOTTOM && !page.items.is_empty() {
                            break;
                        }
                        heading_pending = true;
                    }
                    let policy = plan.policy(block + 1);
                    if policy.backward && state.cursor.offset == 0 && *style == ParagraphKind::Body
                    {
                        let next = block + 1;
                        let independent = !self.image_groups || !self.in_image_sequence(next);
                        if self.images.get(&next).is_some_and(|b| !b.cover)
                            && independent
                            && !state.placed.contains(&next)
                            && !state.carried.iter().any(|c| c.block == next)
                            && !self
                                .model
                                .structure
                                .iter()
                                .any(|s| s.chapter && s.block == next)
                        {
                            encountered.insert(next);
                            if let Ok((item, d)) =
                                self.image(next, y, policy, false, &occupied, state.wrap_count)
                            {
                                if self.alternating_wraps && d.side != "full" {
                                    state.wrap_count += 1;
                                }
                                occupied.push(d.bounds);
                                page.items.push(item);
                                decisions.push(d);
                                state.placed.insert(next);
                            }
                        }
                    }
                    let height = if self.paragraphs.editorial {
                        super::editorial::metrics(self.model, *start, *style).1
                    } else if *style == ParagraphKind::Heading {
                        36.
                    } else {
                        28.
                    };
                    let (mut left, mut right) = (LEFT, RIGHT);
                    let mut obstacle_bottom = y;
                    for r in &occupied {
                        if y + height > r[1] && y < r[1] + r[3] {
                            obstacle_bottom = obstacle_bottom.max(r[1] + r[3]);
                            if r[0] + r[2] / 2. < (LEFT + RIGHT) / 2. {
                                left = left.max(r[0] + r[2] + 12.);
                            } else {
                                right = right.min(r[0] - 12.);
                            }
                        }
                    }
                    if right - left < self.flow[block].minimum[0] {
                        y = obstacle_bottom + 6.;
                        continue;
                    }
                    let offset = state.cursor.offset.max(*start);
                    let row = self.paragraphs.row(
                        self.model,
                        block,
                        offset,
                        left,
                        right,
                        self.faces,
                        &mut self.resolver,
                    )?;
                    let mut new_refs = refs.clone();
                    for n in note_layout::refs_for(&row.items, self.model, &self.lookup) {
                        if !new_refs.contains(&n) {
                            new_refs.push(n);
                        }
                    }
                    if new_refs.len() > 64 {
                        return Err("too many notes on a page".into());
                    }
                    let main_bottom = occupied
                        .iter()
                        .map(|r| r[1] + r[3])
                        .fold(y + row.height, f32::max);
                    let allocation = note_layout::allocate_with_policy(
                        new_refs
                            .iter()
                            .map(|&note| note_layout::Pending { note, offset: 0 })
                            .collect(),
                        &self.notes,
                        (CAPACITY * FOOTNOTE_STYLE.max_fraction).min(BOTTOM - main_bottom),
                        self.paragraphs.editorial,
                    );
                    let required = allocation.height;
                    if y + row.height > BOTTOM - required + TEXT_EDGE_TOLERANCE
                        || main_bottom + required
                            > BOTTOM
                                + if occupied.is_empty() {
                                    TEXT_EDGE_TOLERANCE
                                } else {
                                    0.001
                                }
                        || (!new_refs.is_empty() && allocation.slices.is_empty())
                    {
                        break;
                    }
                    refs = new_refs;
                    for item in &row.items {
                        let mut item = item.clone();
                        optimizer::translate(&mut item, 0., y);
                        page.items.push(item);
                    }
                    if right - left < RIGHT - LEFT - 1. && row.chars < 16 {
                        narrow += (16 - row.chars) as f64 / 16.;
                    }
                    row_bands.push([left, y, right - left, row.height + row.gap]);
                    paragraph_rows += 1;
                    y += row.height + row.gap;
                    last_gap = row.gap;
                    if !heading {
                        heading_pending = false;
                    }
                    if row.last || row.end >= *end {
                        if paragraph_rows == 1 && offset > *start {
                            orphan += 1.;
                        }
                        paragraph_rows = 0;
                        state.cursor = Cursor {
                            block: block + 1,
                            offset: 0,
                        };
                    } else {
                        state.cursor.offset = row.end;
                    }
                }
            }
            if !heading_pending
                && (!refs.is_empty() || y >= BOTTOM - 140.)
                && !page.items.is_empty()
            {
                if let Ok(draft) = self.finish(
                    initial,
                    state.clone(),
                    page.clone(),
                    y - last_gap,
                    decisions.clone(),
                    &refs,
                    &row_bands,
                    narrow,
                    orphan,
                    paragraph_rows,
                    false,
                    heading_pending,
                ) {
                    if let Some(a) = audit.as_deref_mut() {
                        a.accept(&draft)?;
                    }
                    endpoints.push(draft);
                    endpoints.sort_by(|a, b| {
                        a.cost
                            .total()
                            .total_cmp(&b.cost.total())
                            .then(b.after.cursor.block.cmp(&a.after.cursor.block))
                            .then(b.after.cursor.offset.cmp(&a.after.cursor.offset))
                    });
                    endpoints.dedup_by(|a, b| a.after.key() == b.after.key());
                    endpoints.truncate(endpoint_limit);
                    if let Some(a) = audit.as_deref_mut() {
                        a.retain(&endpoints)?;
                    }
                }
            }
            if y >= BOTTOM {
                break;
            }
        }
        if let Ok(draft) = self.finish(
            initial,
            state,
            page,
            y - last_gap,
            decisions,
            &refs,
            &row_bands,
            narrow,
            orphan,
            paragraph_rows,
            intentional,
            heading_pending,
        ) {
            if let Some(a) = audit.as_deref_mut() {
                a.accept(&draft)?;
            }
            endpoints.push(draft);
        }
        endpoints.sort_by(|a, b| {
            a.cost
                .total()
                .total_cmp(&b.cost.total())
                .then(b.after.cursor.block.cmp(&a.after.cursor.block))
                .then(b.after.cursor.offset.cmp(&a.after.cursor.offset))
        });
        endpoints.dedup_by(|a, b| a.after.key() == b.after.key());
        endpoints.truncate(endpoint_limit);
        if let Some(a) = audit {
            a.retain(&endpoints)?;
        }
        if endpoints.is_empty() {
            return Err("no valid page endpoint".into());
        }
        for d in &mut endpoints {
            d.image_plan = plan.key();
        }
        Ok(endpoints)
    }
    #[allow(clippy::too_many_arguments)]
    fn finish(
        &mut self,
        initial: &Boundary,
        mut state: Boundary,
        mut page: PageLayout,
        y: f32,
        mut decisions: Vec<ImageDecision>,
        refs: &[usize],
        row_bands: &[[f32; 4]],
        narrow: f64,
        orphan: f64,
        paragraph_rows: usize,
        intentional: bool,
        heading_pending: bool,
    ) -> Result<Draft> {
        let intentional =
            intentional
                || state.finished(self.model)
                || self.model.structure.iter().any(|b| {
                    b.chapter && b.block == state.cursor.block && state.cursor.offset == 0
                });
        if heading_pending {
            return Err("stranded hard-keep heading".into());
        }
        if page.items.is_empty() {
            return Err("empty/no-progress candidate".into());
        }
        if self.alternating_wraps {
            state.wrap_count = initial.wrap_count;
            for d in &mut decisions {
                if d.side == "full" || d.side == "group" {
                    continue;
                }
                let wrapped = page
                    .items
                    .iter()
                    .filter(|item| matches!(item, Item::GlyphRun { .. } | Item::RasterGlyph { .. }))
                    .any(|item| {
                        let r = bounds(item);
                        r[1] < d.bounds[1] + d.bounds[3]
                            && r[1] + r[3] > d.bounds[1]
                            && (r[0] + r[2] <= d.bounds[0] || r[0] >= d.bounds[0] + d.bounds[2])
                    });
                if !wrapped {
                    let old = d.bounds;
                    d.bounds[0] = (LEFT + RIGHT - d.bounds[2]) / 2.;
                    d.side = "full".into();
                    for item in &mut page.items {
                        if let Item::Image { bounds, .. } = item
                            && *bounds == old
                        {
                            *bounds = d.bounds;
                            break;
                        }
                    }
                } else {
                    let expected = if state.wrap_count.is_multiple_of(2) {
                        "right"
                    } else {
                        "left"
                    };
                    if d.side != expected {
                        return Err("non-alternating wrapped illustrations".into());
                    }
                    state.wrap_count += 1;
                }
            }
        }
        if state.carried.iter().any(|c| {
            self.model
                .structure
                .iter()
                .any(|s| s.chapter && s.block > c.block && s.block <= state.cursor.block)
        }) {
            return Err("image carry crosses chapter".into());
        }
        // Once carried, the next main page must place it before consuming more text.
        for c in &mut state.carried {
            c.age += 1;
        }
        let main_bottom = page
            .items
            .iter()
            .map(bounds)
            .map(|b| b[1] + b[3])
            .fold(y.min(BOTTOM), f32::max);
        let a = note_layout::allocate_with_policy(
            refs.iter()
                .map(|&note| note_layout::Pending { note, offset: 0 })
                .collect(),
            &self.notes,
            (CAPACITY * FOOTNOTE_STYLE.max_fraction).min(BOTTOM - main_bottom),
            self.paragraphs.editorial,
        );
        if !refs.is_empty() && a.slices.is_empty() {
            return Err("notes displaced by image".into());
        }
        if !a.slices.is_empty() {
            note_layout::compose(&mut page, &a, &self.notes, false);
        }
        self.diagnostics.footnote_layout_cache_hits += a.slices.len();
        state.pending = a.pending;
        if !state.pending.is_empty() && !state.carried.is_empty() {
            return Err("image carry conflicts with long note continuation".into());
        }
        if state.key() == initial.key() {
            return Err("candidate did not advance semantic or continuation state".into());
        }
        validate_geometry(&page)?;
        let image_bottom = decisions
            .iter()
            .map(|d| d.bounds[1] + d.bounds[3])
            .fold(0f32, f32::max);
        let below = if decisions.is_empty() {
            0
        } else {
            row_bands.iter().filter(|r| r[1] >= image_bottom).count()
        };
        if below == 1
            && !self.wrap_tail_space
            && !intentional
            && decisions
                .iter()
                .any(|d| !d.intentional_side_space && d.side != "full")
        {
            self.diagnostics.short_tail_rejections += 1;
            return Err("single-row tail below a wrapping portrait".into());
        }
        let mut cost = scoring::score(
            main_bottom + a.height,
            intentional,
            narrow,
            orphan,
            paragraph_rows == 1,
            row_bands.len(),
            &decisions,
            !state.pending.is_empty(),
            a.height,
            below,
            scoring::side_void_fraction(&decisions, row_bands),
        );
        if self.production && !intentional {
            // Two empty line slots cost more than a single continuation line.
            cost.whitespace = 2. * f64::from(((BOTTOM - main_bottom - a.height) / 28.).max(0.));
            cost.widow_orphan /= 18.;
        }
        if self.production && self.interior_gaps {
            cost.whitespace +=
                2. * f64::from(scoring::interior_gap_height(&decisions, row_bands) / 28.);
        }
        if self.wrap_tail_space && !intentional {
            cost.whitespace += 2. * f64::from(scoring::wrap_tail_height(&decisions, y) / 28.);
            // A lone full-width row below a float is preferable to unused line slots.
            cost.short_below_image = f64::from(below == 1);
        }
        Ok(Draft {
            page,
            after: state,
            decisions,
            cost,
            note_slices: a.slices,
            continuation: false,
            image_plan: vec![],
        })
    }
    fn page_variants(
        &mut self,
        initial: &Boundary,
        generated: &mut usize,
        rejected: &mut BTreeMap<String, usize>,
    ) -> Vec<Draft> {
        // Replay a semantic boundary with independently assigned image policies.
        // Unassigned images use preferred placement; only encountered anchors branch.
        let mut frontier = vec![ImagePlan::default()];
        let mut spent = 0;
        let mut output = vec![];
        let mut seen = BTreeSet::new();
        let budget = if self.diversity { 61 } else { IMAGE_BUDGET };
        while !frontier.is_empty() && spent < budget {
            if crate::import_cancel::check().is_err() {
                return vec![];
            }
            let mut ranked = vec![];
            for plan in frontier {
                if spent >= budget || !seen.insert(plan.key()) {
                    continue;
                }
                spent += 1;
                *generated += 1;
                let mut encountered = BTreeSet::new();
                match self.page(initial, &plan, &mut encountered) {
                    Ok(drafts) => {
                        let score = drafts[0].cost.total();
                        let next = encountered.into_iter().find(|b| !plan.0.contains_key(b));
                        ranked.push((score, plan.clone(), next));
                        output.extend(drafts);
                    }
                    Err(e) => {
                        *rejected
                            .entry(format!(
                                "images {:?} at block {}: {}",
                                plan.key(),
                                initial.cursor.block,
                                e
                            ))
                            .or_insert(0) += 1;
                        // A failed preferred placement must still allow scale/defer alternatives.
                        if let Some(next) =
                            encountered.into_iter().find(|b| !plan.0.contains_key(b))
                        {
                            ranked.push((f64::INFINITY, plan, Some(next)));
                        }
                    }
                }
            }
            ranked.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.key().cmp(&b.1.key())));
            let mut next = vec![];
            let slots = expansion_slots(&ranked, IMAGE_BEAM, self.diversity);
            for (index, (_, plan, anchor)) in ranked.into_iter().enumerate() {
                if !slots.contains(&index) {
                    continue;
                }
                for policy in self.image_policies(anchor.unwrap()) {
                    let mut branch = plan.clone();
                    branch.0.insert(anchor.unwrap(), policy);
                    next.push(branch);
                }
            }
            frontier = next;
        }
        output.sort_by(|a, b| {
            a.cost
                .total()
                .total_cmp(&b.cost.total())
                .then(a.image_plan.cmp(&b.image_plan))
        });
        output
    }
    fn normal_window(&mut self, state: &Boundary) -> Result<WindowSearch> {
        let mut beam = vec![Candidate {
            pages: vec![],
            state: state.clone(),
            ids: vec![],
            score: 0.,
        }];
        let mut generated = 0;
        let mut pruned = 0;
        let mut rejected = BTreeMap::new();
        for depth in 0..WINDOW {
            crate::import_cancel::check()?;
            let mut next = vec![];
            for candidate in &beam {
                if candidate.state.finished(self.model) {
                    next.push(candidate.clone());
                    continue;
                }
                for (id, draft) in self
                    .page_variants(&candidate.state, &mut generated, &mut rejected)
                    .into_iter()
                    .enumerate()
                {
                    let score =
                        candidate.score + scoring::WINDOW_WEIGHTS[depth] * draft.cost.total();
                    let mut c = candidate.clone();
                    c.state = draft.after.clone();
                    c.ids.push(id);
                    c.pages.push(Rc::new(draft));
                    c.score = score;
                    next.push(c);
                }
            }
            next.sort_by(|a, b| a.score.total_cmp(&b.score).then(a.ids.cmp(&b.ids)));
            // Identical boundaries with identical score do not occupy the beam twice.
            let before_pruning = next.len();
            let mut unique = BTreeSet::new();
            next.retain(|a| unique.insert((a.state.key(), a.score.to_bits())));
            pruned += before_pruning - next.len().min(BEAM);
            next.truncate(BEAM);
            if next.is_empty() {
                return Err(format!(
                    "SlidingWindowV2 no candidate at {:?}: {:?}",
                    state.cursor, rejected
                )
                .into());
            }
            beam = next;
        }
        beam.sort_by(|a, b| a.score.total_cmp(&b.score).then(a.ids.cmp(&b.ids)));
        Ok(WindowSearch {
            beam,
            generated,
            pruned,
            rejected,
        })
    }
    fn run(&mut self, mut commit: impl FnMut(usize, &PageLayout) -> Result<()>) -> Result<usize> {
        let mut state = Boundary::default();
        let mut committed = 0;
        while !state.finished(self.model) {
            crate::import_cancel::check()?;
            if committed >= MAX_PAGES {
                return Err("sliding window page limit".into());
            }
            let WindowSearch {
                beam,
                generated,
                pruned,
                rejected,
            } = self.normal_window(&state)?;
            let best = &beam[0];
            let first = &best.pages[0];
            if first.after.key() == state.key() {
                return Err("commit did not advance".into());
            }
            self.diagnostics.candidates += generated;
            self.diagnostics.rejected += rejected.values().sum::<usize>();
            self.diagnostics.windows.push(WindowTrace {
                page: committed + 1,
                cursor: state.cursor.clone(),
                generated,
                pruned,
                chosen: best.ids.clone(),
                score: best.score,
                components: best.pages.iter().map(|d| d.cost.clone()).collect(),
                continuation: first.continuation,
                next_cursor: first.after.cursor.clone(),
                images: first.decisions.clone(),
                notes: first.note_slices.clone(),
                provisional_cursors: best.pages.iter().map(|d| d.after.cursor.clone()).collect(),
                pending_notes: first
                    .after
                    .pending
                    .iter()
                    .map(|n| (n.note, n.offset))
                    .collect(),
                carried_images: first.after.carried.iter().map(|c| c.block).collect(),
                provisional_images: best.pages.iter().map(|d| d.decisions.clone()).collect(),
                image_plans: best.pages.iter().map(|d| d.image_plan.clone()).collect(),
                alternative_components: beam
                    .iter()
                    .skip(1)
                    .map(|c| c.pages.iter().map(|d| d.cost.clone()).collect())
                    .collect(),
                alternatives: beam
                    .iter()
                    .skip(1)
                    .map(|c| (c.ids.clone(), c.score))
                    .collect(),
                rejections: rejected,
            });
            state = first.after.clone();
            commit(committed, &first.page)?;
            committed += 1;
        }
        Ok(committed)
    }
}
fn bounds(item: &Item) -> [f32; 4] {
    match item {
        Item::GlyphRun { bounds, .. }
        | Item::RasterGlyph { bounds, .. }
        | Item::Image { bounds, .. }
        | Item::Rule { bounds } => *bounds,
    }
}
pub fn validate_geometry(page: &PageLayout) -> Result<()> {
    let images = page
        .items
        .iter()
        .filter_map(|i| {
            if let Item::Image { bounds, .. } = i {
                Some(*bounds)
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    for item in &page.items {
        let b = bounds(item);
        if b.iter().any(|v| !v.is_finite())
            || b[2] < 0.
            || b[3] < 0.
            || b[0] < LEFT - 1.
            || b[0] + b[2] > RIGHT + 1.
            || b[1] < TOP - 1.
            || b[1] + b[3]
                > BOTTOM
                    + if matches!(item, Item::Image { .. }) {
                        1.
                    } else {
                        TEXT_EDGE_TOLERANCE + 1.
                    }
        {
            return Err("item outside content bounds".into());
        }
        if matches!(item, Item::GlyphRun { .. } | Item::RasterGlyph { .. })
            && images.iter().any(|r| {
                b[0] < r[0] + r[2] - 0.5
                    && b[0] + b[2] > r[0] + 0.5
                    && b[1] < r[1] + r[3] - 0.5
                    && b[1] + b[3] > r[1] + 0.5
            })
        {
            return Err("text/image overlap".into());
        }
    }
    for (i, a) in images.iter().enumerate() {
        if images[i + 1..].iter().any(|b| {
            a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1]
        }) {
            return Err("image/image overlap".into());
        }
    }
    Ok(())
}
fn make_engine<'a, 'b>(
    model: &'a Publication,
    faces: &'a [rustybuzz::Face<'b>],
    root: &Path,
    manifest: &mut Manifest,
) -> Result<Engine<'a, 'b>> {
    let mut resolver =
        FontResolver::with_provider(faces, crate::publication::system_fallback::provider());
    let note_timer = std::time::Instant::now();
    let notes = notes::measure(model, root, manifest, faces, &mut resolver)?;
    let note_measurement_ms = note_timer.elapsed().as_secs_f64() * 1000.;
    let mut images = BTreeMap::new();
    for (i, b) in model.blocks.iter().enumerate() {
        crate::import_cancel::check()?;
        if let Block::Image { asset, cover } = b {
            let record = manifest
                .assets
                .iter()
                .find(|r| &r.path == asset)
                .ok_or("missing image asset")?;
            let (w, h) = crate::publication::images::dimensions(&crate::publication::read_file(
                root,
                record,
                crate::publication::images::MAX_IMAGE_BYTES,
            )?)?;
            let max_width = if h > w && !cover {
                (RIGHT - LEFT) / 2.
            } else {
                RIGHT - LEFT
            };
            let s = (max_width / w as f32).min(CAPACITY / h as f32).min(1.);
            let preferred = [w as f32 * s, h as f32 * s];
            images.insert(
                i,
                ImageBox {
                    layout: LayoutBox {
                        anchor: i,
                        behavior: FlowBehavior::Occupancy,
                        preferred,
                        minimum: [preferred[0] * 0.7, preferred[1] * 0.7],
                    },
                    asset: asset.clone(),
                    cover: *cover,
                    intrinsic: [w as f32, h as f32],
                },
            );
        }
    }
    let mut engine = Engine {
        image_groups: false,
        wrap_tail_space: false,
        alternating_wraps: false,
        interior_gaps: false,
        production: false,
        diversity: false,
        model,
        faces,
        resolver,
        paragraphs: paragraph::ParagraphComposer::new(manifest.publisher_version >= 26),
        images,
        flow: flow_boxes(model),
        notes,
        lookup: model
            .notes
            .iter()
            .enumerate()
            .map(|(i, n)| (n.id.as_str(), i))
            .collect(),
        diagnostics: Default::default(),
    };
    engine.diagnostics.note_measurement_ms = note_measurement_ms;
    Ok(engine)
}
pub fn publish(
    model: &Publication,
    root: &Path,
    manifest: &mut Manifest,
    strategy: CompositionStrategy,
) -> Result<Diagnostics> {
    if matches!(strategy, CompositionStrategy::Legacy) {
        let now = std::time::Instant::now();
        super::publish(model, root, manifest)?;
        return Ok(Diagnostics {
            elapsed_ms: now.elapsed().as_secs_f64() * 1000.,
            ..Default::default()
        });
    }
    if model
        .blocks
        .iter()
        .any(|b| matches!(b, Block::Table { .. }))
    {
        return Err("SlidingWindowV2: tables are explicitly outside experiment scope".into());
    }
    let started = std::time::Instant::now();
    for (i, font) in CURRENT_FONTS.iter().enumerate() {
        manifest
            .assets
            .push(write_file(root, &format!("assets/fonts/{i}.ttf"), font)?);
    }
    manifest.assets.push(write_file(
        root,
        "assets/fonts/OFL.txt",
        include_bytes!("../../../assets/fonts/Literata-OFL.txt"),
    )?);
    let faces = CURRENT_FONTS
        .iter()
        .map(|b| rustybuzz::Face::from_slice(b, 0).ok_or("Invalid font"))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut engine = make_engine(model, &faces, root, manifest)?;
    engine.interior_gaps = manifest.publisher_version >= 18;
    engine.production = matches!(strategy, CompositionStrategy::ProductionV22);
    engine.image_groups = engine.production && manifest.publisher_version >= 27;
    engine.alternating_wraps = engine.production && manifest.publisher_version >= 19;
    engine.wrap_tail_space = engine.production && manifest.publisher_version >= 20;
    engine.diversity = matches!(
        strategy,
        CompositionStrategy::SlidingWindowV22 | CompositionStrategy::ProductionV22
    );
    let note_measurement_ms = engine.diagnostics.note_measurement_ms;
    let compose_timer = std::time::Instant::now();
    let mut storage_ms = 0.;
    let fit_cover = engine.production && manifest.publisher_version >= 22;
    let renumber = engine.production && manifest.publisher_version >= 21;
    let mut numbers = super::page_numbers::PageNumbers::default();
    numbers.delicate = manifest.publisher_version >= 26;
    let editorial = manifest.publisher_version >= 26;
    let page_count = engine.run(|i, page| {
        let mut numbered;
        let page = if renumber {
            numbered = page.clone();
            numbers.apply(&mut numbered, model)?;
            if editorial {
                super::editorial::finish_page(&mut numbered);
            }
            if fit_cover {
                super::cover::fit(&mut numbered, i);
            }
            &numbered
        } else {
            page
        };
        let timer = std::time::Instant::now();
        manifest.page_files.push(write_file(
            root,
            &format!("pages/{:06}.json", i + 1),
            &serde_json::to_vec(page)?,
        )?);
        manifest.pages.push(PageInfo {
            width: WIDTH,
            height: HEIGHT,
            dpi: None,
        });
        storage_ms += timer.elapsed().as_secs_f64() * 1000.;
        Ok(())
    })?;
    engine.diagnostics.composition_ms = compose_timer.elapsed().as_secs_f64() * 1000. - storage_ms;
    engine.diagnostics.storage_ms = storage_ms;
    engine.diagnostics.note_measurement_ms = note_measurement_ms;
    engine.resolver.finish(root, manifest)?;
    engine.diagnostics.paragraph_cache_hits = engine.paragraphs.hits;
    engine.diagnostics.paragraph_cache_misses = engine.paragraphs.misses;
    engine.diagnostics.shaped_tokens = engine.paragraphs.shapes;
    manifest.page_count = page_count;
    // Historical A/B outputs retain explicit provenance; production uses publisher version.
    manifest.importer_id = if engine.production {
        None
    } else {
        Some(
            if engine.diversity {
                "experimental-sliding-window-v22-diversity"
            } else {
                "experimental-sliding-window-v2-2"
            }
            .into(),
        )
    };
    manifest.edition_id = crate::publication::identity_manifest(manifest);
    engine.diagnostics.elapsed_ms = started.elapsed().as_secs_f64() * 1000.;
    Ok(engine.diagnostics)
}

/// Diagnostic comparison of full-width paragraph rows, before pagination or image search.
pub fn audit_paragraphs(
    model: &Publication,
    root: &Path,
    manifest: &Manifest,
) -> Result<serde_json::Value> {
    let faces = CURRENT_FONTS
        .iter()
        .map(|b| rustybuzz::Face::from_slice(b, 0).unwrap())
        .collect::<Vec<_>>();
    let mut resolver =
        FontResolver::with_provider(&faces, crate::publication::system_fallback::provider());
    let mut composer = paragraph::ParagraphComposer::new(manifest.publisher_version >= 26);
    let mut differences = vec![];
    let (mut legacy_rows, mut v2_rows, mut paragraphs) = (0, 0, 0);
    for (block, b) in model.blocks.iter().enumerate() {
        let Block::Paragraph { start, end, .. } = b else {
            continue;
        };
        let measured = measure_blocks(
            model,
            std::slice::from_ref(b),
            None,
            &faces,
            &mut resolver,
            root,
            manifest,
        )?;
        let optimizer::Measured::Text { lines, .. } = &measured[0] else {
            continue;
        };
        let mut rows = vec![];
        let mut offset = *start;
        while offset < *end {
            let r = composer.row(model, block, offset, LEFT, RIGHT, &faces, &mut resolver)?;
            offset = r.end;
            rows.push(r);
        }
        paragraphs += 1;
        legacy_rows += lines.len();
        v2_rows += rows.len();
        let equal = lines.len() == rows.len()
            && lines.iter().zip(&rows).all(|(a, b)| {
                serde_json::to_vec(&a.items).unwrap() == serde_json::to_vec(&b.items).unwrap()
            });
        if !equal {
            differences.push(serde_json::json!({"block":block,"legacy":lines.len(),"v2":rows.len(),"sample":model.text[*start..*end].chars().take(120).collect::<String>()}));
        }
    }
    Ok(
        serde_json::json!({"paragraphs":paragraphs,"legacy_rows":legacy_rows,"v2_rows":v2_rows,"differences":differences}),
    )
}
