//! PDF evidence -> source-neutral manuscript. No layout/raster policy lives here.
use super::model::{Block, Note, NoteReference, ParagraphKind, Publication, RawSpan, Style};
use crate::{
    library::Result,
    reader::pdf::extraction::{PdfChar, PdfEvidence, PdfPageEvidence},
};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
pub const IMPORTER: &str = "pdf-reconstruction-v2;model1";
pub const MAX_BLOCKS: usize = 100_000;
pub const MAX_NOTES: usize = 10_000;
/// Central policy: categorical, deliberately not a calibrated probability.
pub struct Thresholds;
impl Thresholds {
    pub const BASELINE: f32 = 0.24;
    pub const SPACE: f32 = 0.18;
    pub const GUTTER: f32 = 2.4;
    pub const NOTE_SIZE: f32 = 0.96;
    pub const VALID_GEOMETRY: f64 = 0.98;
    pub const BAD_UNICODE: f64 = 0.002;
    pub const DUPLICATES: f64 = 0.20;
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Confidence {
    High,
    Medium,
    Low,
    Unsupported,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PdfSpan {
    pub text: String,
    pub style: Style,
    pub bounds: [f32; 4],
    pub indices: Vec<usize>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PdfLine {
    pub spans: Vec<PdfSpan>,
    pub bounds: [f32; 4],
    pub baseline: f32,
    pub size: f32,
    pub column: usize,
    pub heading: bool,
    pub chapter: bool,
    pub removed: Option<String>,
    pub note: Option<String>,
}
impl PdfLine {
    pub fn text(&self) -> String {
        self.spans.iter().map(|s| s.text.as_str()).collect()
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PdfPageStructure {
    pub page: usize,
    pub category: String,
    pub source_chars: usize,
    pub invalid_chars: usize,
    pub invalid_geometry: usize,
    pub duplicates: usize,
    pub columns: usize,
    pub reading_order: Confidence,
    pub lines: Vec<PdfLine>,
    pub images: usize,
    pub scans: usize,
    pub unrecoverable_visuals: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Removal {
    pub page: usize,
    pub reason: String,
    pub text: String,
    pub indices: Vec<usize>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PdfReconstructionAssessment {
    #[serde(default)]
    pub extraction_ms: f64,
    #[serde(default)]
    pub reconstruction_ms: f64,
    #[serde(default)]
    pub image_ms: f64,
    #[serde(default)]
    pub publication_ms: f64,
    pub importer: String,
    pub confidence: Confidence,
    pub reasons: Vec<String>,
    pub pages: usize,
    pub text_pages: usize,
    pub source_chars: usize,
    pub average_chars_per_text_page: f64,
    pub invalid_unicode_ratio: f64,
    pub valid_geometry_ratio: f64,
    pub duplicate_ratio: f64,
    pub single_column_pages: usize,
    pub two_column_pages: usize,
    pub scan_pages: usize,
    pub discrete_images: usize,
    pub unrecoverable_visuals: usize,
    pub chapters: usize,
    pub paragraphs: usize,
    pub footnotes: usize,
    pub removed_headers: usize,
    pub removed_page_numbers: usize,
    pub dehyphenations: usize,
    pub source_nonspace: usize,
    pub published_nonspace: usize,
    pub removed_nonspace: usize,
    pub unexplained_difference: usize,
    pub footnote_chars: usize,
    pub removals: Vec<Removal>,
    pub page_diagnostics: Vec<PdfPageStructure>,
}
pub struct Reconstruction {
    pub assessment: PdfReconstructionAssessment,
    pub model: Publication,
}
impl PdfReconstructionAssessment {
    pub fn summary(&self) -> Self {
        let mut a = self.clone();
        for p in &mut a.page_diagnostics {
            p.lines.clear();
        }
        a.removals.clear();
        a
    }
}
fn median(mut values: Vec<f32>) -> f32 {
    values.retain(|v| v.is_finite() && *v > 0.);
    values.sort_by(f32::total_cmp);
    values.get(values.len() / 2).copied().unwrap_or(12.)
}
fn valid(c: &PdfChar) -> bool {
    c.bounds
        .iter()
        .chain([&c.size, &c.baseline])
        .all(|v| v.is_finite())
        && c.size > 0.
        && c.size < 1000.
        && c.bounds[2] > c.bounds[0]
        && c.bounds[3] > c.bounds[1]
}
fn union(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    [
        a[0].min(b[0]),
        a[1].min(b[1]),
        a[2].max(b[2]),
        a[3].max(b[3]),
    ]
}
fn printable(c: &PdfChar) -> bool {
    c.text
        .chars()
        .any(|c| !c.is_whitespace() && !c.is_control())
}
fn normalize(c: char) -> char {
    if c == '●' { '•' } else { c }
}
fn content(s: &str) -> impl Iterator<Item = char> + '_ {
    s.chars()
        .filter(|c| !c.is_whitespace() && !c.is_control())
        .map(normalize)
}
fn marker(s: &str) -> String {
    s.trim_matches(|c: char| c.is_whitespace() || "[]().".contains(c))
        .chars()
        .map(|c| match c {
            '¹' => '1',
            '²' => '2',
            '³' => '3',
            c => c,
        })
        .collect()
}
fn is_marker(s: &str) -> bool {
    let s = marker(s);
    !s.is_empty()
        && s.chars().count() <= 5
        && (s.chars().all(|c| c.is_ascii_digit()) || matches!(s.as_str(), "*" | "**" | "†" | "‡"))
}

pub fn lines(page: &PdfPageEvidence) -> (Vec<PdfLine>, Vec<Removal>, usize) {
    let mut removed = vec![];
    let mut seen = BTreeSet::new();
    let mut chars = vec![];
    let mut invalid = 0;
    for c in &page.chars {
        if !printable(c) {
            continue;
        }
        if !valid(c) {
            invalid += 1;
        }
        let key = (
            c.text.clone(),
            (c.bounds[0] * 5.).round() as i32,
            (c.bounds[1] * 5.).round() as i32,
            (c.bounds[2] * 5.).round() as i32,
            (c.bounds[3] * 5.).round() as i32,
        );
        if !seen.insert(key) {
            removed.push(Removal {
                page: page.index,
                reason: "duplicate overlapping glyph".into(),
                text: c.text.clone(),
                indices: vec![c.index],
            });
            continue;
        }
        chars.push(c);
    }
    // Large body glyphs establish baselines before smaller raised references.
    chars.sort_by(|a, b| {
        b.size
            .total_cmp(&a.size)
            .then(a.baseline.total_cmp(&b.baseline))
            .then(a.bounds[0].total_cmp(&b.bounds[0]))
            .then(a.index.cmp(&b.index))
    });
    let mut bands: BTreeMap<i32, Vec<Vec<&PdfChar>>> = BTreeMap::new();
    for c in chars {
        let bin = (c.baseline / 4.).floor() as i32;
        let radius = ((c.size * 0.8 / 4.).ceil() as i32).max(1);
        let mut best = None;
        for (&key, groups) in bands.range((bin - radius)..=(bin + radius)) {
            for (i, g) in groups.iter().enumerate() {
                let base = g[0];
                let delta = (base.baseline - c.baseline).abs();
                let raised = c.size < base.size * 0.86
                    && c.baseline < base.baseline
                    && delta < base.size * 0.65
                    && c.bounds[3] > base.bounds[1];
                if (delta < base.size * Thresholds::BASELINE || raised)
                    && best.is_none_or(|(_, _, d)| delta < d)
                {
                    best = Some((key, i, delta));
                }
            }
        }
        if let Some((key, i, _)) = best {
            bands.get_mut(&key).unwrap()[i].push(c);
        } else {
            bands.entry(bin).or_default().push(vec![c]);
        }
    }
    let mut lines = vec![];
    for mut group in bands.into_values().flatten() {
        group.sort_by(|a, b| {
            a.bounds[0]
                .total_cmp(&b.bounds[0])
                .then(a.index.cmp(&b.index))
        });
        let size = median(group.iter().map(|c| c.size).collect());
        let baseline = median(
            group
                .iter()
                .filter(|c| c.size >= size * 0.9)
                .map(|c| c.baseline)
                .collect(),
        );
        let mut fragments: Vec<Vec<&PdfChar>> = vec![vec![]];
        let mut right = None;
        for c in group {
            if right.is_some_and(|r| c.bounds[0] - r > size * Thresholds::GUTTER) {
                fragments.push(vec![]);
            }
            right = Some(c.bounds[2]);
            fragments.last_mut().unwrap().push(c);
        }
        for fragment in fragments {
            if fragment.is_empty() {
                continue;
            }
            let tracking = median(
                fragment
                    .windows(2)
                    .map(|p| p[1].bounds[0] - p[0].bounds[2])
                    .filter(|g| *g >= 0. && *g < size * Thresholds::SPACE)
                    .collect(),
            );
            let spacing =
                (size * Thresholds::SPACE).max(if tracking < size { tracking * 1.9 } else { 0. });
            let mut spans: Vec<PdfSpan> = vec![];
            let mut bounds = fragment[0].bounds;
            let mut right = None;
            for c in fragment {
                let raised_symbol = matches!(c.text.as_str(), "*" | "†" | "‡" | "¹" | "²" | "³")
                    && c.bounds[3] < baseline - size * 0.15;
                let style = Style {
                    bold: c.bold,
                    italic: c.italic,
                    superscript: (c.size < size * 0.86 && c.baseline < baseline - size * 0.12)
                        || raised_symbol,
                    subscript: false,
                };
                let gap = right.is_some_and(|r| c.bounds[0] - r > spacing);
                let value = if gap {
                    format!(" {}", c.text)
                } else {
                    c.text.clone()
                };
                if let Some(last) = spans.last_mut().filter(|s| s.style == style) {
                    last.text.push_str(&value);
                    last.bounds = union(last.bounds, c.bounds);
                    last.indices.push(c.index);
                } else {
                    spans.push(PdfSpan {
                        text: value,
                        style,
                        bounds: c.bounds,
                        indices: vec![c.index],
                    });
                }
                bounds = union(bounds, c.bounds);
                right = Some(c.bounds[2]);
            }
            lines.push(PdfLine {
                spans,
                bounds,
                baseline,
                size,
                column: 0,
                heading: false,
                chapter: false,
                removed: None,
                note: None,
            });
        }
    }
    lines.sort_by(|a, b| {
        a.baseline
            .total_cmp(&b.baseline)
            .then(a.bounds[0].total_cmp(&b.bounds[0]))
    });
    (lines, removed, invalid)
}
fn column_order(lines: &mut [PdfLine], _width: f32, body: f32) -> (usize, Confidence) {
    // Find local, persistent gutters from paired baselines, not the page centre.
    // Full-width prose and headings delimit column sections on the same page.
    let pairs: Vec<_> = lines
        .windows(2)
        .enumerate()
        .filter_map(|(i, p)| {
            ((p[0].baseline - p[1].baseline).abs() < body * 0.3
                && p[1].bounds[0] - p[0].bounds[2] > body * 2.)
                .then_some((i, p[0].bounds[2], p[1].bounds[0]))
        })
        .collect();
    let mut sections = vec![];
    let mut at = 0;
    while at < pairs.len() {
        let (start, mut left, mut right) = pairs[at];
        let mut end = start + 1;
        let mut count = 1;
        at += 1;
        while at < pairs.len() {
            let (i, l, r) = pairs[at];
            let nl = left.max(l);
            let nr = right.min(r);
            if nr - nl < body
                || lines[i].baseline - lines[end].baseline > body * 3.
                || lines[end + 1..i]
                    .iter()
                    .any(|l| l.bounds[0] < nl && l.bounds[2] > nr)
            {
                break;
            }
            left = nl;
            right = nr;
            end = i + 1;
            count += 1;
            at += 1;
        }
        if count >= 2 {
            let gutter = (left + right) / 2.;
            // Include wrapped last lines in either column up to the next full-width block.
            while end + 1 < lines.len()
                && lines[end + 1].baseline - lines[end].baseline < body * 1.8
                && (lines[end + 1].bounds[2] < gutter || lines[end + 1].bounds[0] > gutter)
            {
                end += 1;
            }
            sections.push((start, end, gutter));
        }
    }
    let mut assigned = BTreeSet::new();
    for (section, (start, end, gutter)) in sections.iter().enumerate() {
        for (i, l) in lines.iter_mut().enumerate().take(end + 1).skip(*start) {
            l.column = section * 2 + 1 + usize::from(l.bounds[0] > *gutter);
            assigned.insert(i);
        }
        lines[*start..=*end].sort_by(|a, b| {
            a.column
                .cmp(&b.column)
                .then(a.baseline.total_cmp(&b.baseline))
        });
    }
    let unresolved = pairs
        .iter()
        .filter(|(i, _, _)| !assigned.contains(i))
        .count();
    (
        if sections.is_empty() { 1 } else { 2 },
        if unresolved > 3 {
            Confidence::Low
        } else {
            Confidence::High
        },
    )
}
fn header_key(line: &PdfLine, page: &PdfPageEvidence) -> Option<(String, i32)> {
    if line.bounds[1] > page.height * 0.08 && line.bounds[3] < page.height * 0.88 {
        return None;
    }
    let text = line.text();
    let trimmed = text.trim();
    if trimmed.len() > 200 {
        return None;
    }
    let normalized = if trimmed
        .chars()
        .all(|c| c.is_ascii_digit() || " -–—".contains(c))
    {
        "#page".into()
    } else {
        trimmed.to_lowercase()
    };
    Some((
        normalized,
        (line.baseline / page.height * 50.).round() as i32,
    ))
}
fn terminal(s: &str) -> bool {
    s.trim_end()
        .ends_with(['.', '!', '?', '…', ':', ';', '»', '”'])
}
#[derive(Clone)]
struct Paragraph {
    raw: Vec<RawSpan>,
    last: PdfLine,
    page: usize,
    chapter: bool,
    heading: bool,
}
fn flush(model: &mut Publication, pending: &mut Option<Paragraph>) -> Result<()> {
    if let Some(p) = pending.take() {
        let i = model.blocks.len();
        model.append_paragraph(
            p.raw,
            if p.heading {
                ParagraphKind::Heading
            } else {
                ParagraphKind::Body
            },
            None,
            None,
        )?;
        if p.heading {
            model.mark(i, p.chapter, Some(if p.chapter { 1 } else { 2 }));
        }
    }
    Ok(())
}
fn append(
    model: &mut Publication,
    pending: &mut Option<Paragraph>,
    line: &PdfLine,
    geometry: (usize, f32, f32),
    links: &BTreeMap<String, String>,
    vocabulary: &BTreeSet<String>,
    removals: &mut Vec<Removal>,
) -> Result<()> {
    let (page, left, right) = geometry;
    let indented = line.bounds[0] > left + line.size * 0.75;
    let split = pending.as_ref().is_some_and(|p| {
        p.heading
            || line.heading
            || (p.page == page
                && (p.last.column != line.column
                    || line.bounds[1] - p.last.bounds[3] > line.size * 0.85))
            || (p.last.size - line.size).abs() > line.size * 0.2
            || indented
            || (p.last.bounds[2] < right - line.size * 2. && terminal(&p.last.text()))
            || (p.page != page && terminal(&p.last.text()))
    });
    if split {
        flush(model, pending)?;
    }
    let p = pending.get_or_insert_with(|| Paragraph {
        raw: vec![],
        last: line.clone(),
        page,
        chapter: line.chapter,
        heading: line.heading,
    });
    let mut joined = false;
    if let Some(last) = p.raw.last_mut() {
        let previous = last.0.split_whitespace().last().unwrap_or("");
        let following = line.text();
        let first = following.split_whitespace().next().unwrap_or("");
        if (previous.ends_with('-') || previous.ends_with('\u{ad}'))
            && first.chars().next().is_some_and(char::is_lowercase)
        {
            let whole = format!(
                "{}{}",
                &previous[..previous.len() - previous.chars().last().unwrap().len_utf8()],
                first
            );
            if previous.ends_with('\u{ad}') || vocabulary.contains(&whole) {
                let hyphen = last.0.pop().unwrap();
                joined = true;
                removals.push(Removal {
                    page: p.page,
                    reason: "evidence-backed line-end dehyphenation".into(),
                    text: hyphen.to_string(),
                    indices: p
                        .last
                        .spans
                        .last()
                        .map(|s| s.indices.iter().rev().take(1).copied().collect())
                        .unwrap_or_default(),
                });
            }
        }
    }
    if !p.raw.is_empty() && !joined {
        p.raw.push((" ".into(), Style::default(), None));
    }
    for span in &line.spans {
        let link = if span.style.superscript {
            links.get(&marker(&span.text)).map(|id| format!("#{id}"))
        } else {
            None
        };
        p.raw.push((span.text.clone(), span.style, link));
    }
    p.last = line.clone();
    p.page = page;
    Ok(())
}
pub fn reconstruct(evidence: &PdfEvidence) -> Result<Reconstruction> {
    let _reconstruction_timer = crate::pipeline_metrics::stage("reconstruction_total");
    let started = std::time::Instant::now();
    // OCR font weight often describes the recognition substitute, not emphasis.
    // Normalize a predominantly bold scan text layer, but keep born-digital PDF
    // emphasis and ordinary OCR books with occasional bold spans unchanged.
    let scan_chars = evidence
        .pages
        .iter()
        .filter(|p| p.images.iter().any(|i| i.background))
        .flat_map(|p| &p.chars)
        .filter(|c| printable(c))
        .collect::<Vec<_>>();
    let normalize_scan_weight = !scan_chars.is_empty()
        && scan_chars.iter().filter(|c| c.bold).count() * 10 >= scan_chars.len() * 7;
    let mut diagnostics = vec![];
    let mut removals = vec![];
    let mut recurring: BTreeMap<(String, i32), BTreeSet<usize>> = BTreeMap::new();
    for page in &evidence.pages {
        let geometry_timer = crate::pipeline_metrics::stage("geometry");
        let (lines, removed, invalid) = lines(page);
        drop(geometry_timer);
        let duplicates = removed.len();
        removals.extend(removed);
        let header_timer = crate::pipeline_metrics::stage("header_footer");
        for line in &lines {
            if let Some(key) = header_key(line, page) {
                recurring.entry(key).or_default().insert(page.index);
            }
        }
        drop(header_timer);
        diagnostics.push(PdfPageStructure {
            page: page.index,
            category: String::new(),
            source_chars: page.chars.iter().filter(|c| printable(c)).count(),
            invalid_chars: page
                .chars
                .iter()
                .filter(|c| {
                    c.text.contains('\u{fffd}')
                        || c.text.chars().any(|c| matches!(c as u32, 0xe000..=0xf8ff))
                })
                .count(),
            invalid_geometry: invalid,
            duplicates,
            columns: 1,
            reading_order: Confidence::High,
            lines,
            images: page.images.iter().filter(|i| !i.background).count(),
            scans: page.images.iter().filter(|i| i.background).count(),
            unrecoverable_visuals: page.complex_objects
                + usize::from(
                    page.rules
                        .iter()
                        .filter(|b| b[2] - b[0] > page.width * 0.1)
                        .count()
                        >= 3
                        && page
                            .rules
                            .iter()
                            .filter(|b| b[3] - b[1] > page.height * 0.08)
                            .count()
                            >= 2,
                ),
        });
    }
    let vocabulary: BTreeSet<String> = diagnostics
        .iter()
        .flat_map(|d| d.lines.iter())
        .flat_map(|l| {
            l.text()
                .split_whitespace()
                .map(|s| s.trim_matches(|c: char| !c.is_alphabetic()).to_owned())
                .collect::<Vec<_>>()
        })
        .filter(|s| !s.is_empty())
        .collect();
    let mut model = Publication {
        schema_version: 3,
        text: String::new(),
        blocks: vec![],
        metadata: evidence.metadata.clone(),
        structure: vec![],
        notes: vec![],
        note_references: vec![],
    };
    let mut pending = None;
    let mut note_lines: BTreeMap<String, Vec<(usize, PdfLine)>> = BTreeMap::new();
    let mut note_labels = BTreeMap::new();
    let mut header_count = 0;
    let mut page_numbers = 0;
    let mut continuation: Option<(String, f32)> = None;
    for (page, d) in evidence.pages.iter().zip(&mut diagnostics) {
        // Dot-leader table-of-contents rows have a right-aligned page label,
        // not a second prose column. Keep the literal reference number.
        let mut joined: Vec<PdfLine> = vec![];
        for line in std::mem::take(&mut d.lines) {
            if let Some(last) = joined.last_mut()
                && (last.baseline - line.baseline).abs() < last.size * 0.25
                && (last.text().contains("..")
                    || line.text().trim().chars().all(|c| c.is_ascii_digit()))
            {
                last.spans.push(PdfSpan {
                    text: " ".into(),
                    style: Style::default(),
                    bounds: line.bounds,
                    indices: vec![],
                });
                last.spans.extend(line.spans);
                last.bounds = union(last.bounds, line.bounds);
            } else {
                joined.push(line);
            }
        }
        d.lines = joined;
        for line in &mut d.lines {
            if let Some(key) = header_key(line, page)
                && recurring
                    .get(&key)
                    .is_some_and(|set| set.len() >= 3.max(evidence.pages.len() / 4))
            {
                let reason = if key.0 == "#page" {
                    page_numbers += 1;
                    "printed page number"
                } else {
                    header_count += 1;
                    "recurring header/footer"
                };
                line.removed = Some(reason.into());
                removals.push(Removal {
                    page: page.index,
                    reason: reason.into(),
                    text: line.text(),
                    indices: line.spans.iter().flat_map(|s| s.indices.clone()).collect(),
                });
            }
        }
        let body = median(
            d.lines
                .iter()
                .filter(|l| l.removed.is_none() && l.bounds[1] < page.height * 0.55)
                .flat_map(|l| std::iter::repeat_n(l.size, l.text().chars().count()))
                .collect(),
        );
        if normalize_scan_weight && page.images.iter().any(|i| i.background) {
            for line in &mut d.lines {
                if line.size <= body * 1.18 {
                    for span in &mut line.spans {
                        span.style.bold = false;
                    }
                }
            }
        }
        let supers: BTreeSet<_> = d
            .lines
            .iter()
            .filter(|l| l.size >= body * 0.97)
            .flat_map(|l| l.spans.iter())
            .filter(|s| s.style.superscript && is_marker(&s.text))
            .map(|s| marker(&s.text))
            .collect();
        let note_timer = crate::pipeline_metrics::stage("footnote_analysis");
        let mut label_counts = BTreeMap::<String, usize>::new();
        crate::pipeline_metrics::count("count.candidate_references", supers.len());
        for l in &d.lines {
            if l.bounds[1] > page.height * 0.55 && l.size < body * Thresholds::NOTE_SIZE {
                let t = l.text();
                let prefix = t.split_whitespace().next().unwrap_or("");
                if is_marker(prefix) {
                    *label_counts.entry(marker(prefix)).or_default() += 1;
                }
            }
        }
        crate::pipeline_metrics::count("count.candidate_notes", label_counts.values().sum());
        // Carry a note only when its previous last line is unfinished and the
        // next page starts a similarly sized small-text region below main prose.
        let mut active: Option<String> = None;
        let mut links = BTreeMap::new();
        let carry = continuation.take();
        if let Some((id, size)) = carry {
            let first = d.lines.iter().find(|l| {
                l.removed.is_none()
                    && l.bounds[1] > page.height * 0.55
                    && l.size < body * Thresholds::NOTE_SIZE
            });
            if first.is_some_and(|l| {
                (l.size - size).abs() < size * 0.12
                    && !is_marker(l.text().split_whitespace().next().unwrap_or(""))
                    && l.text()
                        .trim_start()
                        .chars()
                        .next()
                        .is_some_and(char::is_lowercase)
            }) {
                active = Some(id);
            }
        }
        let mut bottom_started = false;
        for line in &mut d.lines {
            if line.removed.is_some() {
                continue;
            }
            let text = line.text();
            let prefix = text.split_whitespace().next().unwrap_or("");
            let label = marker(prefix);
            let bottom =
                line.bounds[1] > page.height * 0.55 && line.size < body * Thresholds::NOTE_SIZE;
            if bottom
                && is_marker(prefix)
                && supers.contains(&label)
                && label_counts.get(&label) == Some(&1)
                && text.trim().len() > prefix.len() + 2
            {
                // Repeated indistinguishable labels cannot be paired reliably.
                // Keep such text in the main manuscript instead of guessing.
                if links.contains_key(&label) {
                    active = None;
                    continue;
                }
                let id = format!("pdf-note-{}-{label}", page.index);
                active = Some(id.clone());
                links.insert(label.clone(), id.clone());
                note_labels.insert(id, label);
                // Label will be rendered from the corresponding reference. Its
                // exact source glyphs remain accounted for in diagnostics.
                if let Some(first) = line.spans.first_mut() {
                    let count = first.text.find(prefix).unwrap_or(0) + prefix.len();
                    if first.text.is_char_boundary(count) {
                        let removed = first.text[..count].to_owned();
                        first.text = first.text[count..].to_owned();
                        removals.push(Removal {
                            page: page.index,
                            reason: "note label rendered by reference".into(),
                            text: removed,
                            indices: first.indices.clone(),
                        });
                    }
                }
            } else if !bottom && bottom_started {
                active = None;
            }
            if bottom {
                bottom_started = true;
            }
            if bottom && let Some(id) = &active {
                line.note = Some(id.clone());
                note_lines
                    .entry(id.clone())
                    .or_default()
                    .push((page.index, line.clone()));
            }
        }
        if let Some(id) = active
            && let Some((_, last)) = note_lines.get(&id).and_then(|ls| ls.last())
            && !terminal(&last.text())
            && last.bounds[3] > page.height * 0.82
        {
            continuation = Some((id, last.size));
        }
        if note_lines.len() > MAX_NOTES {
            return Err("PDF footnote limit exceeded".into());
        }
        drop(note_timer);
        let _model_timer = crate::pipeline_metrics::stage("model_construction");
        let mut main: Vec<_> = d
            .lines
            .iter()
            .filter(|l| l.removed.is_none() && l.note.is_none())
            .cloned()
            .collect();
        let (cols, order) = column_order(&mut main, page.width, body);
        d.columns = cols;
        d.reading_order = order;
        if page.rotated
            || page
                .chars
                .iter()
                .any(|c| c.angle.abs() > 2. && c.angle.abs() < 358.)
        {
            d.reading_order = Confidence::Low;
        }
        d.category = if d.source_chars == 0 {
            "ImageOnly"
        } else if d.scans > 0 {
            "ScannedWithOcr"
        } else if d.unrecoverable_visuals > 0 || order == Confidence::Low {
            "ComplexLayout"
        } else if d.invalid_chars > 0 || d.invalid_geometry > d.source_chars / 50 {
            "LowQualityText"
        } else if d.images > 0 {
            "TextWithImages"
        } else {
            "TextOnly"
        }
        .into();
        for line in &main {
            if let Some(original) = d.lines.iter_mut().find(|l| l.bounds == line.bounds) {
                original.column = line.column;
            }
        }
        let mut image_at = 0;
        let mut images: Vec<_> = page
            .images
            .iter()
            .filter(|i| !i.background && i.asset.is_some())
            .collect();
        images.sort_by(|a, b| a.bounds[1].total_cmp(&b.bounds[1]));
        for line in &mut main {
            while image_at < images.len() && images[image_at].bounds[1] < line.bounds[1] {
                flush(&mut model, &mut pending)?;
                model.blocks.push(Block::Image {
                    asset: format!("assets/pdf/{}", images[image_at].asset.as_ref().unwrap()),
                    cover: page.index == 0 && page.chars.is_empty(),
                });
                image_at += 1;
            }
            let text = line.text();
            let plain = text.trim();
            let bold = line.spans.iter().any(|s| s.style.bold);
            let centered =
                ((line.bounds[0] + line.bounds[2]) / 2. - page.width / 2.).abs() < body * 1.5;
            let bookmark = page
                .bookmarks
                .iter()
                .any(|b| b.trim().eq_ignore_ascii_case(plain));
            let label = ["глава ", "книга ", "часть ", "chapter ", "part ", "эпизод "]
                .iter()
                .any(|p| plain.to_lowercase().starts_with(p));
            line.heading = plain.chars().count() < 120
                && (line.size > body * 1.18
                    || bookmark
                    || ((bold || normalize_scan_weight) && centered && label));
            line.chapter = line.heading && (bookmark || label || line.size > body * 1.5);
            let region: Vec<_> = d
                .lines
                .iter()
                .filter(|l| {
                    l.removed.is_none()
                        && l.note.is_none()
                        && l.size >= body * 0.9
                        && l.column == line.column
                })
                .collect();
            let left = region
                .iter()
                .map(|l| l.bounds[0])
                .fold(line.bounds[0], f32::min);
            let right = region
                .iter()
                .map(|l| l.bounds[2])
                .fold(line.bounds[2], f32::max);
            append(
                &mut model,
                &mut pending,
                line,
                (page.index, left, right),
                &links,
                &vocabulary,
                &mut removals,
            )?;
            if let Some(original) = d.lines.iter_mut().find(|l| l.bounds == line.bounds) {
                original.heading = line.heading;
                original.chapter = line.chapter;
                original.column = line.column;
            }
        }
        while image_at < images.len() {
            flush(&mut model, &mut pending)?;
            model.blocks.push(Block::Image {
                asset: format!("assets/pdf/{}", images[image_at].asset.as_ref().unwrap()),
                cover: page.index == 0 && page.chars.is_empty(),
            });
            image_at += 1;
        }
        if model.blocks.len() > MAX_BLOCKS {
            return Err("PDF block limit exceeded".into());
        }
    }
    flush(&mut model, &mut pending)?;
    for block in &model.blocks {
        if let Block::Paragraph { spans, .. } = block {
            for s in spans {
                if let Some(id) = s.link.as_deref().and_then(|l| l.strip_prefix('#'))
                    && note_lines.contains_key(id)
                {
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
    let main_end = model.text.len();
    for (id, lines) in note_lines {
        let at = model.blocks.len();
        let mut note_pending = None;
        for (page, line) in lines {
            append(
                &mut model,
                &mut note_pending,
                &line,
                (page, line.bounds[0], line.bounds[2]),
                &BTreeMap::new(),
                &vocabulary,
                &mut removals,
            )?;
        }
        flush(&mut model, &mut note_pending)?;
        model.notes.push(Note {
            label: note_labels.remove(&id).unwrap_or_default(),
            id,
            blocks: model.blocks.drain(at..).collect(),
        });
    }
    let mut source_counts = BTreeMap::<char, isize>::new();
    for page in &evidence.pages {
        for c in &page.chars {
            for c in content(&c.text) {
                *source_counts.entry(c).or_default() += 1;
            }
        }
    }
    let source_nonspace = source_counts.values().sum::<isize>() as usize;
    let mut removed_nonspace = 0;
    for r in &removals {
        for c in content(&r.text) {
            *source_counts.entry(c).or_default() -= 1;
            removed_nonspace += 1;
        }
    }
    let published_nonspace = content(&model.text).count();
    for c in content(&model.text) {
        *source_counts.entry(c).or_default() -= 1;
    }
    let unexplained = source_counts.values().map(|n| n.unsigned_abs()).sum();
    let total = diagnostics.iter().map(|p| p.source_chars).sum::<usize>();
    let invalid = diagnostics.iter().map(|p| p.invalid_chars).sum::<usize>();
    let geometry = diagnostics
        .iter()
        .map(|p| p.invalid_geometry)
        .sum::<usize>();
    let duplicates = diagnostics.iter().map(|p| p.duplicates).sum::<usize>();
    let text_pages = diagnostics.iter().filter(|p| p.source_chars > 0).count();
    let mut a = PdfReconstructionAssessment {
        extraction_ms: evidence.extraction_ms,
        reconstruction_ms: started.elapsed().as_secs_f64() * 1000.,
        image_ms: evidence.image_ms,
        publication_ms: 0.,
        importer: IMPORTER.into(),
        confidence: Confidence::High,
        reasons: vec![],
        pages: diagnostics.len(),
        text_pages,
        source_chars: total,
        average_chars_per_text_page: total as f64 / text_pages.max(1) as f64,
        invalid_unicode_ratio: invalid as f64 / total.max(1) as f64,
        valid_geometry_ratio: 1. - geometry as f64 / total.max(1) as f64,
        duplicate_ratio: duplicates as f64 / total.max(1) as f64,
        single_column_pages: diagnostics.iter().filter(|p| p.columns == 1).count(),
        two_column_pages: diagnostics.iter().filter(|p| p.columns == 2).count(),
        scan_pages: diagnostics.iter().filter(|p| p.scans > 0).count(),
        discrete_images: diagnostics.iter().map(|p| p.images).sum(),
        unrecoverable_visuals: diagnostics.iter().map(|p| p.unrecoverable_visuals).sum(),
        chapters: model.structure.iter().filter(|s| s.chapter).count(),
        paragraphs: model
            .blocks
            .iter()
            .filter(|b| matches!(b, Block::Paragraph { .. }))
            .count(),
        footnotes: model.notes.len(),
        removed_headers: header_count,
        removed_page_numbers: page_numbers,
        dehyphenations: removals
            .iter()
            .filter(|r| r.reason == "evidence-backed line-end dehyphenation")
            .count(),
        source_nonspace,
        published_nonspace,
        removed_nonspace,
        unexplained_difference: unexplained,
        footnote_chars: model.text[main_end..].chars().count(),
        removals,
        page_diagnostics: diagnostics,
    };
    assess(&mut a);
    Ok(Reconstruction {
        assessment: a,
        model,
    })
}
pub fn assess(a: &mut PdfReconstructionAssessment) {
    a.confidence = Confidence::High;
    a.reasons.clear();
    if a.source_chars == 0 {
        a.confidence = Confidence::Unsupported;
        a.reasons
            .push("No useful embedded text; OCR is not performed".into());
        return;
    }
    if a.invalid_unicode_ratio > Thresholds::BAD_UNICODE {
        a.reasons.push("Unreliable Unicode mapping".into());
    }
    if a.valid_geometry_ratio < Thresholds::VALID_GEOMETRY {
        a.reasons
            .push("Missing or invalid character geometry".into());
    }
    if a.duplicate_ratio > Thresholds::DUPLICATES {
        a.reasons
            .push("Excessive overlapping duplicate text".into());
    }
    if a.unexplained_difference > 0 {
        a.reasons
            .push("Unexplained text fidelity difference".into());
    }
    if a.unrecoverable_visuals > 0 {
        a.reasons.push("Unrecoverable vector/form content".into());
    }
    if a.page_diagnostics
        .iter()
        .any(|p| p.reading_order == Confidence::Low)
    {
        a.reasons.push("Ambiguous reading order or rotation".into());
    }
    if !a.reasons.is_empty() {
        a.confidence = Confidence::Low;
    } else if a.scan_pages > 0 {
        a.confidence = Confidence::Medium;
        a.reasons.push("Scan backgrounds excluded; embedded illustrations cannot be recovered without segmentation".into());
    }
}

pub(super) struct ReaderHandler;
impl crate::reader::format::DocumentFormatHandler for ReaderHandler {
    fn format_id(&self) -> crate::reader::format::FormatId {
        crate::reader::pdf::PDF
    }
    fn filter_name(&self) -> &'static str {
        "Reader"
    }
    fn supported_extensions(&self) -> &'static [&'static str] {
        &[]
    }
    fn probe(&self, _: &[u8]) -> crate::reader::format::ProbeResult {
        crate::reader::format::ProbeResult::NotMine
    }
    fn publication_kind(&self) -> crate::reader::format::PublicationKind {
        crate::reader::format::PublicationKind::GeneratedLayout
    }
}
pub fn prepare(
    source: &str,
    path: &std::path::Path,
    staging: &std::path::Path,
    _experimental: bool,
) -> Result<(PdfReconstructionAssessment, Option<super::Prepared>)> {
    let directory = tempfile::Builder::new()
        .prefix("publication-")
        .tempdir_in(staging)?;
    let evidence = crate::reader::pdf::inspect_evidence(path)?;
    // Embedded text always goes through Publisher; confidence is diagnostic.
    if !evidence.pages.iter().flat_map(|p| &p.chars).any(printable) {
        return Ok((reconstruct(&evidence)?.assessment, None));
    }
    drop(evidence);
    // Image-only documents avoid image decoding. All handles stay on the worker.
    let images = crate::reader::pdf::extract_evidence(path, &directory.path().join("assets/pdf"))?;
    // Use final image evidence, including omission of genuinely blank leaves.
    let reconstruction = reconstruct(&images)?;
    let mut assessment = reconstruction.assessment;
    drop(images);
    let mut manifest = super::manifest(source, &ReaderHandler)?;
    manifest.importer_id = Some(IMPORTER.into());
    manifest.metadata = Some(reconstruction.model.metadata.clone());
    manifest.edition_id = super::identity_manifest(&manifest);
    // Omitting scanned paper is intentional Reader presentation, not an import warning.
    if assessment.confidence == Confidence::Low {
        manifest
            .import_warnings
            .extend(assessment.reasons.iter().cloned());
    }
    for block in &reconstruction.model.blocks {
        if let Block::Image { asset, .. } = block {
            let bytes = std::fs::read(directory.path().join(asset))?;
            if !manifest.assets.iter().any(|a| &a.path == asset) {
                manifest.assets.push(super::FileRecord {
                    path: asset.clone(),
                    sha256: crate::library::store::hash_reader(bytes.as_slice())?,
                    bytes: bytes.len() as u64,
                });
            }
        }
    }
    manifest.assets.push(super::write_file(
        directory.path(),
        "publication.json",
        &serde_json::to_vec(&reconstruction.model)?,
    )?);
    let mut stable_report = assessment.summary();
    stable_report.extraction_ms = 0.;
    stable_report.reconstruction_ms = 0.;
    stable_report.image_ms = 0.;
    stable_report.publication_ms = 0.;
    manifest.assets.push(super::write_file(
        directory.path(),
        "reconstruction.json",
        &serde_json::to_vec(&stable_report)?,
    )?);
    let publication_started = std::time::Instant::now();
    super::typography::publish(&reconstruction.model, directory.path(), &mut manifest)?;
    assessment.publication_ms = publication_started.elapsed().as_secs_f64() * 1000.;
    manifest.page_count = manifest.pages.len();
    if manifest.page_count == 0 || manifest.page_count > 20_000 {
        return Err("Invalid Reader Edition page count".into());
    }
    let doc = super::open_payload(directory.path(), &manifest)?;
    let thumbnail = crate::library::thumbnail::render(doc.as_ref())?;
    super::write_file(
        directory.path(),
        "manifest.json",
        &serde_json::to_vec_pretty(&manifest)?,
    )?;
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

#[cfg(test)]
#[path = "pdf_reconstruction_tests.rs"]
mod tests;
