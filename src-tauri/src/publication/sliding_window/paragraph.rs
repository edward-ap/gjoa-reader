//! Cached token shaping; line breaking queries a rectangular width profile.
use super::*;
use std::{collections::BTreeMap, rc::Rc};
#[derive(Clone)]
struct Word {
    start: usize,
    end: usize,
    token: Token,
}
#[derive(Clone)]
pub(super) struct Row {
    pub items: Vec<Item>,
    pub end: usize,
    pub height: f32,
    pub gap: f32,
    pub last: bool,
    pub chars: usize,
}
#[derive(Default)]
pub(super) struct ParagraphComposer {
    pub editorial: bool,
    words: BTreeMap<usize, Rc<Vec<Word>>>,
    rows: BTreeMap<(usize, usize, i32, i32), Rc<Row>>,
    pub hits: usize,
    pub misses: usize,
    pub shapes: usize,
}
impl ParagraphComposer {
    pub fn new(editorial: bool) -> Self {
        Self {
            editorial,
            ..Self::default()
        }
    }
    #[allow(clippy::too_many_arguments)]
    pub fn row(
        &mut self,
        model: &Publication,
        block: usize,
        offset: usize,
        mut left: f32,
        right: f32,
        faces: &[rustybuzz::Face<'_>],
        resolver: &mut FontResolver<'_>,
    ) -> Result<Rc<Row>> {
        let Block::Paragraph {
            start,
            end,
            style,
            spans,
            ..
        } = &model.blocks[block]
        else {
            return Err("Not a paragraph".into());
        };
        let offset = offset.max(*start);
        if offset == *start && *style == ParagraphKind::Body {
            left += 28.;
        }
        let inset = if matches!(
            style,
            ParagraphKind::Quote | ParagraphKind::Verse | ParagraphKind::Author
        ) {
            36.
        } else {
            0.
        };
        left += inset;
        let right = right - inset;
        let key = (
            block,
            offset,
            (left * 64.).round() as i32,
            (right * 64.).round() as i32,
        );
        if let Some(row) = self.rows.get(&key) {
            self.hits += 1;
            return Ok(row.clone());
        }
        self.misses += 1;
        let heading = *style == ParagraphKind::Heading;
        let size = if heading {
            26.
        } else if *style == ParagraphKind::Subtitle {
            20.
        } else {
            19.
        };
        let height = if heading { 36. } else { 28. };
        let scale = if self.editorial {
            super::super::editorial::metrics(model, *start, *style)
        } else {
            (size, height, false)
        };
        let (size, height) = (scale.0, scale.1);
        let normalized;
        let spans = if self.editorial {
            normalized = super::super::editorial::spans(spans, *style, scale.2);
            normalized.as_ref()
        } else {
            spans.as_slice()
        };
        if !self.words.contains_key(&block) {
            let text = &model.text[*start..*end];
            let bidi = unicode_bidi::BidiInfo::new(text, None);
            let mut breaks = unicode_linebreak::linebreaks(text)
                .map(|(i, _)| i)
                .collect::<Vec<_>>();
            for (i, c) in text.char_indices() {
                if c == ' ' {
                    breaks.extend([i, i + 1]);
                }
            }
            let boundaries = text
                .grapheme_indices(true)
                .map(|(i, _)| i)
                .chain(std::iter::once(text.len()))
                .collect::<std::collections::BTreeSet<_>>();
            breaks.retain(|i| boundaries.contains(i));
            breaks.push(text.len());
            breaks.sort_unstable();
            breaks.dedup();
            let mut from = 0;
            let mut words = vec![];
            for to in breaks {
                crate::import_cancel::check()?;
                if to == from {
                    continue;
                }
                let mut token = shape(&text[from..to], start + from, spans, size, faces, resolver)?;
                token.level = bidi.levels[from];
                words.push(Word {
                    start: start + from,
                    end: start + to,
                    token,
                });
                from = to;
                self.shapes += 1;
            }
            // Token data is shared by all candidates, bounded to active paragraphs.
            if self.words.len() >= 128 {
                self.words.clear();
            }
            self.words.insert(block, Rc::new(words));
        }
        let words = self.words[&block].clone();
        let mut tokens = vec![];
        let mut used = 0.;
        let mut consumed = offset;
        for word in words
            .iter()
            .skip(words.partition_point(|w| w.end <= offset))
        {
            let from = word.start.max(offset);
            let mut token = if from == word.start {
                word.token.clone()
            } else {
                shape(
                    &model.text[from..word.end],
                    from,
                    spans,
                    size,
                    faces,
                    resolver,
                )?
            };
            if token.space && tokens.is_empty() {
                consumed = word.end;
                continue;
            }
            if used + token.width > right - left && !tokens.is_empty() {
                break;
            }
            if token.width > right - left {
                let (bytes, prefix) = emergency_prefix(
                    &model.text[from..word.end],
                    from,
                    &token,
                    spans,
                    size,
                    right - left,
                    faces,
                    resolver,
                )?;
                consumed = from + bytes;
                token = prefix;
                tokens.push(token);
                break;
            }
            used += token.width;
            consumed = word.end;
            tokens.push(token);
        }
        if consumed <= offset {
            return Err("Paragraph made no progress".into());
        }
        let last = consumed == *end;
        let chars = model.text[offset..consumed]
            .chars()
            .filter(|c| !c.is_whitespace())
            .count();
        let items = measured_line(
            &mut tokens,
            left,
            right,
            (size, height),
            !last && matches!(style, ParagraphKind::Body | ParagraphKind::Quote),
            heading,
        );
        let gap = if !last || *style == ParagraphKind::Verse {
            0.
        } else if heading {
            14.
        } else {
            6.
        };
        let row = Rc::new(Row {
            items,
            end: consumed,
            height,
            gap,
            last,
            chars,
        });
        if self.rows.len() >= 8192 {
            self.rows.clear();
        }
        self.rows.insert(key, row.clone());
        Ok(row)
    }
}
