//! Experimental coarse PDF manuscript adapter. Native object order, no glyph graph.
use super::model::{Block, Note, NoteReference, ParagraphKind, Publication, RawSpan, Style};
use crate::{
    library::Result,
    reader::pdf::extraction::{PdfFastBlock, PdfFastEvidence},
};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
pub const IMPORTER: &str = "pdf-fast-v1;model1";
const HEADER_MIN: usize = 3;
const HEADER_FRACTION: usize = 4;
#[derive(Default, Serialize)]
pub struct Diagnostics {
    pub quality: String,
    pub reasons: Vec<String>,
    pub removed_headers: Vec<String>,
    pub removed_page_numbers: Vec<String>,
    pub removed_note_labels: Vec<String>,
    pub dehyphenations: usize,
    pub candidate_references: usize,
    pub candidate_notes: usize,
    pub matched_notes: usize,
    pub unmatched_notes: usize,
    pub suspicious_order: usize,
    pub headings: Vec<(usize, String)>,
}
pub fn clean(text: &str) -> (String, usize) {
    let chars: Vec<_> = text.chars().collect();
    let mut result = String::new();
    let mut repairs = 0;
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        if c == '-' && i > 0 && chars[i - 1].is_alphabetic() {
            let mut next = i + 1;
            while next < chars.len() && chars[next].is_whitespace() {
                next += 1;
            }
            if chars[i + 1..next].iter().any(|c| matches!(c, '\n' | '\r'))
                && chars.get(next).is_some_and(|c| c.is_lowercase())
            {
                repairs += 1;
                i = next;
                continue;
            }
        }
        if !(matches!(c, '\u{200b}' | '\u{feff}' | '\u{2060}' | '\u{ad}')
            || (c.is_control() && !c.is_whitespace()))
        {
            result.push(c);
        }
        i += 1;
    }
    (
        result.split_whitespace().collect::<Vec<_>>().join(" "),
        repairs,
    )
}
fn terminal(s: &str) -> bool {
    s.trim_end().ends_with(['.', '!', '?', ':', ';', '»'])
}
fn label(s: &str) -> bool {
    let s = s.trim_matches(['[', ']', '(', ')', '.']);
    !s.is_empty()
        && (s == "*" || s == "†" || (s.len() <= 3 && s.chars().all(|c| c.is_ascii_digit())))
}
fn page_number(s: &str, b: [f32; 4], h: f32) -> bool {
    let s = s.trim().trim_matches(['-', '[', ']', '—']);
    (b[1] < h * 0.1 || b[3] > h * 0.88)
        && !s.is_empty()
        && s.len() <= 5
        && s.chars().all(|c| c.is_ascii_digit())
}
#[derive(Clone)]
struct Chunk {
    runs: Vec<RawSpan>,
    bounds: [f32; 4],
    size: f32,
    page: usize,
    heading: bool,
}
impl Chunk {
    fn text(&self) -> String {
        self.runs.iter().map(|r| r.0.as_str()).collect()
    }
    fn terminal(&self) -> bool {
        // A long pending paragraph must not be copied for every incoming line.
        self.runs
            .iter()
            .rev()
            .map(|r| r.0.trim_end())
            .find(|s| !s.is_empty())
            .is_some_and(terminal)
    }
}
fn union(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    [
        a[0].min(b[0]),
        a[1].min(b[1]),
        a[2].max(b[2]),
        a[3].max(b[3]),
    ]
}
fn obvious_heading(c: &Chunk, body: f32, width: f32) -> bool {
    let text = c.text();
    let text = text.trim();
    if text.is_empty() || text.chars().count() > 120 {
        return false;
    }
    let first = text.split_whitespace().next().unwrap_or("").to_lowercase();
    let lexical = [
        "chapter",
        "book",
        "part",
        "volume",
        "prologue",
        "epilogue",
        "глава",
        "книга",
        "часть",
        "том",
        "пролог",
        "эпилог",
    ]
    .contains(&first.as_str());
    let centered = ((c.bounds[0] + c.bounds[2]) * 0.5 - width * 0.5).abs() < width * 0.1;
    let capitals = text
        .chars()
        .filter(|c| c.is_alphabetic())
        .all(|c| c.is_uppercase());
    (lexical && (centered || c.size > body * 1.12))
        || (centered && c.size > body * 1.25 && (capitals || c.runs.iter().any(|r| r.1.bold)))
}
fn lines(blocks: &[PdfFastBlock], page: usize, body: f32, normalize_bold: bool) -> Vec<Chunk> {
    let mut result: Vec<Chunk> = vec![];
    for b in blocks {
        let style = Style {
            bold: b.bold && !(normalize_bold && b.size <= body * 1.18),
            italic: b.italic,
            superscript: b.size < body * 0.8 && label(b.text.trim()),
            ..Style::default()
        };
        if let Some(last) = result.last_mut() {
            let gap = b.bounds[0] - last.bounds[2];
            if (b.bounds[3] - last.bounds[3]).abs() < body * 0.6
                && gap >= -body * 0.25
                && gap < body * 2.
            {
                if gap > body * 0.15 {
                    last.runs.push((" ".into(), Style::default(), None));
                }
                last.runs.push((b.text.clone(), style, None));
                last.bounds = union(last.bounds, b.bounds);
                last.size = last.size.max(b.size);
                continue;
            }
        }
        result.push(Chunk {
            runs: vec![(b.text.clone(), style, None)],
            bounds: b.bounds,
            size: b.size,
            page,
            heading: false,
        });
    }
    result
}
fn emit(model: &mut Publication, c: Chunk, d: &mut Diagnostics) -> Result<()> {
    let mut raw = vec![];
    for (text, style, link) in c.runs {
        let leading = text.starts_with(char::is_whitespace);
        let trailing = text.ends_with(char::is_whitespace);
        let (text, n) = clean(&text);
        d.dehyphenations += n;
        // Preserve intentional separators between differently styled native runs.
        let text = if text.is_empty() {
            " ".into()
        } else {
            format!(
                "{}{}{}",
                if leading { " " } else { "" },
                text,
                if trailing { " " } else { "" }
            )
        };
        raw.push((text, style, link));
    }
    let index = model.blocks.len();
    model.append_paragraph(
        raw,
        if c.heading {
            ParagraphKind::Heading
        } else {
            ParagraphKind::Body
        },
        Some(format!("pdf-page-{}", c.page)),
        None,
    )?;
    if c.heading {
        model.mark(index, true, Some(1));
    }
    if let Some(Block::Paragraph { spans, .. }) = model.blocks.last() {
        for span in spans {
            if let Some(id) = span.link.as_deref().and_then(|l| l.strip_prefix('#')) {
                model.note_references.push(NoteReference {
                    note_id: id.into(),
                    label: model.text[span.start..span.end].trim().into(),
                    start: span.start,
                    end: span.end,
                });
            }
        }
    }
    Ok(())
}
pub fn reconstruct(e: &PdfFastEvidence) -> Result<(Publication, Diagnostics)> {
    let _total = crate::pipeline_metrics::stage("reconstruction_total");
    let mut d = Diagnostics::default();
    let mut sizes = BTreeMap::<i32, usize>::new();
    let mut total = 0;
    let mut bold = 0;
    for (p, blocks) in e.pages.pages.iter().zip(&e.blocks) {
        for b in blocks {
            let n = b.text.chars().count();
            *sizes.entry((b.size * 10.).round() as i32).or_default() += n;
            if p.images.iter().any(|i| i.background) {
                total += n;
                if b.bold {
                    bold += n;
                }
            }
        }
    }
    let body = sizes
        .iter()
        .max_by_key(|(_, n)| *n)
        .map(|(s, _)| *s as f32 / 10.)
        .unwrap_or(12.)
        .max(1.);
    let geometry_timer = crate::pipeline_metrics::stage("geometry");
    let mut pages: Vec<_> = e
        .blocks
        .iter()
        .enumerate()
        .map(|(p, b)| lines(b, p, body, total > 0 && bold * 10 >= total * 7))
        .collect();
    drop(geometry_timer);
    let header_timer = crate::pipeline_metrics::stage("header_footer");
    let mut recurring = BTreeMap::<(String, bool), BTreeSet<usize>>::new();
    for (p, chunks) in pages.iter().enumerate() {
        for c in chunks.iter().take(1).chain(chunks.iter().rev().take(1)) {
            let h = e.pages.pages[p].height;
            if c.bounds[1] < h * 0.1 || c.bounds[3] > h * 0.9 {
                recurring
                    .entry((clean(&c.text()).0, c.bounds[1] < h * 0.1))
                    .or_default()
                    .insert(p);
            }
        }
    }
    for (p, chunks) in pages.iter_mut().enumerate() {
        let h = e.pages.pages[p].height;
        chunks.retain(|c| {
            let s = clean(&c.text()).0;
            if page_number(&s, c.bounds, h) {
                d.removed_page_numbers.push(s);
                return false;
            }
            if (c.bounds[1] < h * 0.1 || c.bounds[3] > h * 0.9)
                && recurring
                    .get(&(s.clone(), c.bounds[1] < h * 0.1))
                    .is_some_and(|v| v.len() >= HEADER_MIN.max(pages_len(e) / HEADER_FRACTION))
            {
                d.removed_headers.push(s);
                return false;
            }
            !s.is_empty()
        });
    }
    drop(header_timer);
    let mut model = Publication {
        schema_version: 3,
        text: String::new(),
        blocks: vec![],
        metadata: e.pages.metadata.clone(),
        structure: vec![],
        notes: vec![],
        note_references: vec![],
    };
    let mut notes = vec![];
    let mut pending: Option<Chunk> = None;
    for (p, mut chunks) in pages.into_iter().enumerate() {
        let page = &e.pages.pages[p];
        for c in &mut chunks {
            c.heading = obvious_heading(c, body, page.width);
            if c.heading {
                d.headings.push((p, c.text()));
            }
        }
        for pair in chunks.windows(2) {
            if pair[1].bounds[1] + body * 2. < pair[0].bounds[1] {
                d.suspicious_order += 1;
            }
        }
        let note_timer = crate::pipeline_metrics::stage("footnote_analysis");
        // Page-local index avoids a candidate × runs scan.
        let mut markers = BTreeMap::<String, BTreeSet<(usize, usize)>>::new();
        for (j, c) in chunks.iter().enumerate() {
            for (k, r) in c.runs.iter().enumerate() {
                if r.1.superscript {
                    markers.entry(r.0.trim().into()).or_default().insert((j, k));
                }
            }
        }
        let mut removed = BTreeSet::new();
        for i in 0..chunks.len() {
            if removed.contains(&i) {
                continue;
            }
            if chunks[i].bounds[1] < page.height * 0.55 || chunks[i].size >= body * 0.96 {
                continue;
            }
            let text = chunks[i].text();
            let prefix = text.split_whitespace().next().unwrap_or("");
            if !label(prefix) || text.len() <= prefix.len() + 2 {
                continue;
            }
            d.candidate_notes += 1;
            // Two candidates already prove ambiguity; do not enumerate more.
            let matches: Vec<_> = markers
                .get(prefix)
                .map(|refs| refs.range(..(i, 0)).take(2).copied().collect())
                .unwrap_or_default();
            d.candidate_references += matches.len();
            if matches.len() != 1 {
                d.unmatched_notes += 1;
                continue;
            }
            let (j, k) = matches[0];
            markers.get_mut(prefix).unwrap().remove(&(j, k));
            let id = format!("fast-note-{p}-{i}");
            chunks[j].runs[k].2 = Some(format!("#{id}"));
            let mut note = chunks[i].clone();
            note.runs = vec![(text[prefix.len()..].into(), Style::default(), None)];
            d.removed_note_labels.push(prefix.into());
            removed.insert(i);
            for (k, r) in chunks[i].runs.iter().enumerate() {
                if let Some(refs) = markers.get_mut(r.0.trim()) {
                    refs.remove(&(i, k));
                }
            }
            let mut continuations = vec![note];
            for (next, c) in chunks.iter().enumerate().skip(i + 1) {
                if c.size >= body * 0.96
                    || c.bounds[1] < page.height * 0.55
                    || label(c.text().split_whitespace().next().unwrap_or(""))
                {
                    break;
                }
                continuations.push(c.clone());
                removed.insert(next);
                for (k, r) in c.runs.iter().enumerate() {
                    if let Some(refs) = markers.get_mut(r.0.trim()) {
                        refs.remove(&(next, k));
                    }
                }
            }
            notes.push((id, prefix.to_string(), continuations));
            d.matched_notes += 1;
        }
        drop(note_timer);
        let _model_timer = crate::pipeline_metrics::stage("model_construction");
        let mut images: Vec<_> = page
            .images
            .iter()
            .filter(|i| !i.background && i.asset.is_some())
            .collect();
        images.sort_by(|a, b| a.bounds[1].total_cmp(&b.bounds[1]));
        let mut images = images.into_iter().peekable();
        let right = chunks
            .iter()
            .filter(|c| !c.heading)
            .map(|c| c.bounds[2])
            .fold(0., f32::max);
        for (i, c) in chunks.into_iter().enumerate() {
            if removed.contains(&i) {
                continue;
            }
            while images.peek().is_some_and(|im| im.bounds[1] <= c.bounds[1]) {
                if let Some(c) = pending.take() {
                    emit(&mut model, c, &mut d)?;
                }
                model.blocks.push(Block::Image {
                    asset: format!(
                        "assets/pdf/{}",
                        images.next().unwrap().asset.as_ref().unwrap()
                    ),
                    cover: false,
                });
            }
            if let Some(last) = pending.as_mut() {
                let same_page = last.page == p;
                let continuation = !last.terminal()
                    && c.text()
                        .trim_start()
                        .chars()
                        .next()
                        .is_some_and(char::is_lowercase);
                let adjacent = same_page
                    // A first-line indent may return left on the next line;
                    // a new rightward indent starts a fresh paragraph.
                    && c.bounds[0] - last.bounds[0] > -body * 3.
                    && c.bounds[0] - last.bounds[0] < body * 0.8
                    && c.bounds[1] >= last.bounds[3] - body * 0.2
                    && c.bounds[1] - last.bounds[3] < body
                    && last.bounds[2] > right - body * 2.;
                if !last.heading
                    && !c.heading
                    && (last.size - c.size).abs() < body * 0.15
                    && (adjacent || (!same_page && continuation))
                {
                    // Keep newline until cleanup so line-end hyphens can be repaired.
                    if let (Some(a), Some(b)) = (last.runs.last_mut(), c.runs.first()) {
                        if a.1 == b.1 && a.2 == b.2 {
                            a.0.push('\n');
                            a.0.push_str(&b.0);
                            last.runs.extend(c.runs.into_iter().skip(1));
                        } else {
                            last.runs.push((" ".into(), Style::default(), None));
                            last.runs.extend(c.runs);
                        }
                    }
                    last.bounds = union(last.bounds, c.bounds);
                    last.bounds[3] = c.bounds[3];
                    last.page = p;
                    continue;
                }
            }
            if let Some(c) = pending.take() {
                emit(&mut model, c, &mut d)?;
            }
            pending = Some(c);
        }
        for im in images {
            if let Some(c) = pending.take() {
                emit(&mut model, c, &mut d)?;
            }
            model.blocks.push(Block::Image {
                asset: format!("assets/pdf/{}", im.asset.as_ref().unwrap()),
                cover: false,
            });
        }
    }
    if let Some(c) = pending.take() {
        emit(&mut model, c, &mut d)?;
    }
    for (id, label, chunks) in notes {
        let start = model.blocks.len();
        for c in chunks {
            emit(&mut model, c, &mut d)?;
        }
        let blocks = model.blocks.split_off(start);
        model.notes.push(Note { id, label, blocks });
    }
    d.quality = if model.text.trim().is_empty() {
        "Unsuitable"
    } else if d.unmatched_notes > 0
        || d.suspicious_order > e.pages.pages.len() / 5
        || e.pages.pages.iter().any(|p| p.complex_objects > 5)
    {
        "Questionable"
    } else {
        "Good"
    }
    .into();
    if d.suspicious_order > 0 {
        d.reasons.push(
            "Native text object order contains backward jumps; no global reordering attempted"
                .into(),
        );
    }
    if d.unmatched_notes > 0 {
        d.reasons
            .push("Unmatched small-print notes preserved as body text".into());
    }
    Ok((model, d))
}
fn pages_len(e: &PdfFastEvidence) -> usize {
    e.pages.pages.len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reader::pdf::extraction::{PdfEvidence, PdfImage, PdfPageEvidence};
    fn block(text: &str, x: f32, y: f32, size: f32) -> PdfFastBlock {
        PdfFastBlock {
            text: text.into(),
            bounds: [x, y, x + text.chars().count() as f32 * size * 0.5, y + size],
            size,
            bold: false,
            italic: false,
        }
    }
    fn evidence(blocks: Vec<Vec<PdfFastBlock>>) -> PdfFastEvidence {
        PdfFastEvidence {
            native_text: blocks
                .iter()
                .map(|bs| {
                    bs.iter()
                        .map(|b| b.text.as_str())
                        .collect::<Vec<_>>()
                        .join(" ")
                })
                .collect(),
            pages: PdfEvidence {
                metadata: super::super::Metadata::default(),
                pages: (0..blocks.len())
                    .map(|index| PdfPageEvidence {
                        index,
                        width: 600.,
                        height: 1000.,
                        rotated: false,
                        chars: vec![],
                        images: vec![],
                        rules: vec![],
                        complex_objects: 0,
                        text_objects: 0,
                        bookmarks: vec![],
                    })
                    .collect(),
                extraction_ms: 0.,
                image_ms: 0.,
            },
            blocks,
        }
    }
    #[test]
    fn repeated_headers_and_real_heading() {
        let mut e = evidence(
            (0..4)
                .map(|_| {
                    vec![
                        block("Running header", 200., 30., 12.),
                        block("Chapter I", 245., 150., 24.),
                        block(
                            "Ordinary prose has sufficient words for body statistics.",
                            40.,
                            210.,
                            12.,
                        ),
                        block(
                            "More ordinary prose with enough words for the body font.",
                            40.,
                            260.,
                            12.,
                        ),
                    ]
                })
                .collect(),
        );
        e.blocks[0].push(block("17", 280., 950., 12.));
        let (m, d) = reconstruct(&e).unwrap();
        assert_eq!(d.removed_headers.len(), 4);
        assert_eq!(d.removed_page_numbers.len(), 1);
        assert_eq!(d.headings.len(), 4);
        assert!(!m.text.contains("Running header"));
        assert!(m.text.contains("Ordinary prose"));
    }
    #[test]
    fn image_anchor_and_scan_rejection() {
        let mut e = evidence(vec![vec![
            block("Before illustration", 40., 200., 12.),
            block("After illustration", 40., 500., 12.),
        ]]);
        e.pages.pages[0].images = vec![
            PdfImage {
                object: 0,
                bounds: [0., 0., 600., 1000.],
                background: true,
                asset: None,
            },
            PdfImage {
                object: 1,
                bounds: [40., 300., 500., 450.],
                background: false,
                asset: Some("picture.png".into()),
            },
        ];
        let (m, _) = reconstruct(&e).unwrap();
        assert_eq!(m.blocks.len(), 3);
        assert!(matches!(&m.blocks[1],Block::Image{asset,..} if asset=="assets/pdf/picture.png"));
    }
    #[test]
    fn page_local_notes_and_unmatched_text() {
        let mut marker = block("1", 346., 200., 7.);
        marker.bounds[2] = 350.;
        let mut e = evidence(vec![vec![
            block(
                "Main prose with plenty of ordinary body text here",
                40.,
                200.,
                12.,
            ),
            marker,
            block(
                "More ordinary body prose to establish font statistics.",
                40.,
                250.,
                12.,
            ),
            block("1 A small explanatory note", 40., 800., 8.),
            block("2 Unmatched note survives", 40., 880., 8.),
        ]]);
        e.blocks[0][0].bounds[2] = 344.;
        let (m, d) = reconstruct(&e).unwrap();
        assert_eq!(m.notes.len(), 1);
        assert_eq!(m.note_references.len(), 1);
        assert_eq!(d.unmatched_notes, 1);
        assert!(m.text.contains("Unmatched note survives"));
    }
    #[test]
    fn styled_word_boundaries_survive() {
        let mut e = evidence(vec![vec![
            block("hello ", 40., 200., 12.),
            block("world", 76., 200., 12.),
        ]]);
        e.blocks[0][1].italic = true;
        let (m, _) = reconstruct(&e).unwrap();
        assert_eq!(m.text.trim(), "hello world");
    }
    #[test]
    fn duplicate_note_label_does_not_steal_an_existing_reference() {
        let mut body = block(
            // Body text must outweigh BOTH small-print candidates in the
            // fixture's weighted modal font size, just as it does in prose.
            "Main prose with enough ordinary words for font statistics and another full sentence establishing the normal body size.",
            40.,
            200.,
            12.,
        );
        body.bounds[2] = 344.;
        let e = evidence(vec![vec![
            body,
            block("1", 346., 200., 7.),
            block("1 First explanation", 40., 800., 8.),
            block("1 Another explanation with the same label", 40., 880., 8.),
        ]]);
        let (m, d) = reconstruct(&e).unwrap();
        assert_eq!(m.notes.len(), 1);
        assert_eq!(d.unmatched_notes, 1);
        assert_eq!(m.note_references[0].note_id, m.notes[0].id);
        assert!(m.blocks.iter().any(|b|matches!(b,Block::Paragraph{start,end,..} if m.text[*start..*end].contains("Another explanation"))));
    }
    #[test]
    fn cleanup_and_conservative_hyphenation() {
        assert_eq!(
            clean("  предло-\nжение\u{a0} ещё\u{200b}\r\nслово "),
            ("предложение ещё слово".into(), 1)
        );
        assert_eq!(clean("Jean-\nPaul"), ("Jean- Paul".into(), 0));
        assert_eq!(clean("сло\u{2}\nво"), ("сло во".into(), 0));
    }
    #[test]
    fn numbers_require_margin() {
        assert!(page_number("[17]", [20., 950., 40., 970.], 1000.));
        assert!(!page_number("17", [20., 400., 40., 420.], 1000.));
    }
    #[test]
    fn first_line_indent_stays_in_its_paragraph() {
        let mut runs = vec![
            block("First indented sentence begins", 70., 200., 12.),
            block("and continues on the next line.", 40., 220., 12.),
            block("A second paragraph begins.", 70., 240., 12.),
        ];
        runs[0].bounds[2] = 550.;
        runs[1].bounds[2] = 350.;
        let (m, _) = reconstruct(&evidence(vec![runs])).unwrap();
        assert_eq!(m.blocks.len(), 2);
        assert!(m.text.contains("begins and continues"));
    }
}
