//! Assign display numbers only after pagination commits a page. Source ranges and
//! the space reserved for each reference remain immutable, including continuations.
use super::*;
use std::collections::BTreeMap;

#[derive(Default)]
pub(super) struct PageNumbers {
    pub(super) delicate: bool,
    carried: BTreeMap<String, usize>,
}
impl PageNumbers {
    pub(super) fn apply(&mut self, page: &mut PageLayout, model: &Publication) -> Result<()> {
        // compose() appends this separator after all main-text items. Other rules
        // (e.g. table borders) are not footnote separators.
        let Some(separator) = page.items.iter().rposition(|item| {
            matches!(item,
            Item::Rule { bounds } if bounds[0] == LEFT
                && bounds[2] == FOOTNOTE_STYLE.separator_width && bounds[3] == 0.75)
        }) else {
            return Ok(());
        };
        let visible = |items: &[Item], start: usize, end: usize| {
            items.iter().any(|item| match item {
                Item::GlyphRun { glyphs, .. } => glyphs.iter().any(|g| g.3 < end && start < g.4),
                _ => false,
            })
        };
        let mut references = model.note_references.iter().collect::<Vec<_>>();
        references.sort_by_key(|r| r.start);
        let mut local = BTreeMap::new();
        for r in &references {
            if visible(&page.items[..separator], r.start, r.end) {
                let next = local.len() + 1;
                local.entry(r.note_id.clone()).or_insert(next);
            }
        }
        self.carried.extend(local.clone());
        let mut notes = page.items.split_off(separator);
        for (items, numbers) in [(&mut page.items, &local), (&mut notes, &self.carried)] {
            for r in &references {
                if let Some(&number) = numbers.get(&r.note_id) {
                    replace(items, r.start, r.end, number, &r.label, self.delicate)?;
                }
            }
        }
        page.items.extend(notes);
        Ok(())
    }
}

fn replace(
    items: &mut Vec<Item>,
    start: usize,
    end: usize,
    number: usize,
    label: &str,
    delicate: bool,
) -> Result<()> {
    // Labels may span multiple runs/fonts. Collect all fragments on a baseline,
    // then replace them once; never replace surrounding body text or ellipsis.
    let mut groups: BTreeMap<i32, Vec<(usize, usize)>> = BTreeMap::new();
    for (i, item) in items.iter().enumerate() {
        if let Item::GlyphRun { glyphs, .. } = item {
            for (j, g) in glyphs.iter().enumerate() {
                if g.3 < end && start < g.4 {
                    groups
                        .entry((g.2 * 100.).round() as i32)
                        .or_default()
                        .push((i, j));
                }
            }
        }
    }
    // Reverse baseline order keeps indices stable if a reference straddles rows.
    for positions in groups.values().rev() {
        let (first, first_glyph) = positions[0];
        let Item::GlyphRun {
            font, size, glyphs, ..
        } = &items[first]
        else {
            unreachable!()
        };
        let (font, size, y) = (
            if delicate { 0 } else { *font },
            if delicate { *size * 0.92 } else { *size },
            glyphs[first_glyph].2,
        );
        let mut left = f32::MAX;
        let mut right = f32::MIN;
        for &(i, j) in positions {
            let Item::GlyphRun { glyphs, bounds, .. } = &items[i] else {
                unreachable!()
            };
            left = left.min(glyphs[j].1);
            right = right.max(glyphs.get(j + 1).map_or(bounds[0] + bounds[2], |g| g.1));
        }
        let face = rustybuzz::Face::from_slice(
            CURRENT_FONTS.get(font).ok_or("Invalid note font index")?,
            0,
        )
        .ok_or("Invalid note font")?;
        let mut buffer = rustybuzz::UnicodeBuffer::new();
        // Retain the source's bracket convention while replacing its number.
        let label = if label.contains('[') {
            format!("[{number}]")
        } else if label.contains('(') {
            format!("({number})")
        } else {
            number.to_string()
        };
        buffer.push_str(&label);
        buffer.guess_segment_properties();
        let shaped = rustybuzz::shape(&face, &[], buffer);
        let width = shaped
            .glyph_positions()
            .iter()
            .map(|p| p.x_advance as f32)
            .sum::<f32>();
        let scale = (size / face.units_per_em() as f32).min((right - left).max(1.) / width);
        let mut x = left;
        let replacement = shaped
            .glyph_infos()
            .iter()
            .zip(shaped.glyph_positions())
            .map(|(g, p)| {
                let glyph = Glyph(
                    g.glyph_id as u16,
                    q(x + p.x_offset as f32 * scale),
                    q(y - p.y_offset as f32 * scale),
                    start,
                    end,
                );
                x += p.x_advance as f32 * scale;
                glyph
            })
            .collect::<Vec<_>>();
        // Existing numeric references normally shrink. Symbolic references can
        // grow; fit them in the reserved advance instead of overlapping text.
        for &(i, j) in positions.iter().rev() {
            let Item::GlyphRun { glyphs, .. } = &mut items[i] else {
                unreachable!()
            };
            glyphs.remove(j);
        }
        items.push(Item::GlyphRun {
            font,
            size: scale * face.units_per_em() as f32,
            glyphs: replacement,
            source_start: start,
            source_end: end,
            bounds: [left, y - size, (right - left).max(1.), size * 1.3],
        });
    }
    items.retain(|item| !matches!(item, Item::GlyphRun { glyphs, .. } if glyphs.is_empty()));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::publication::model::{NoteReference, Style};
    fn model() -> Publication {
        Publication {
            schema_version: 1,
            text: "[984][985][984]".into(),
            blocks: vec![],
            metadata: crate::publication::Metadata {
                title: None,
                author: None,
            },
            structure: vec![],
            notes: vec![],
            note_references: vec![
                NoteReference {
                    note_id: "a".into(),
                    label: "[984]".into(),
                    start: 0,
                    end: 5,
                },
                NoteReference {
                    note_id: "b".into(),
                    label: "[985]".into(),
                    start: 5,
                    end: 10,
                },
                NoteReference {
                    note_id: "a".into(),
                    label: "[984]".into(),
                    start: 10,
                    end: 15,
                },
            ],
        }
    }
    fn label(start: usize, value: &str, y: f32) -> Vec<Item> {
        let faces = CURRENT_FONTS
            .iter()
            .map(|b| rustybuzz::Face::from_slice(b, 0).unwrap())
            .collect::<Vec<_>>();
        let mut resolver = FontResolver::new(&faces);
        let mut items = shape(
            value,
            start,
            &[Span {
                start,
                end: start + value.len(),
                style: Style::default(),
                link: None,
            }],
            14.,
            &faces,
            &mut resolver,
        )
        .unwrap()
        .runs;
        for i in &mut items {
            crate::publication::optimizer::translate(i, LEFT, y);
        }
        items
    }
    fn rule() -> Item {
        Item::Rule {
            bounds: [LEFT, 800., FOOTNOTE_STYLE.separator_width, 0.75],
        }
    }
    fn ids(items: &[Item], start: usize) -> Vec<u16> {
        items
            .iter()
            .flat_map(|i| match i {
                Item::GlyphRun { glyphs, .. } => glyphs
                    .iter()
                    .filter(|g| g.3 == start)
                    .map(|g| g.0)
                    .collect(),
                _ => vec![],
            })
            .collect()
    }
    fn expected(value: &str) -> Vec<u16> {
        label(0, value, 0.)
            .iter()
            .flat_map(|i| match i {
                Item::GlyphRun { glyphs, .. } => glyphs.iter().map(|g| g.0).collect(),
                _ => vec![],
            })
            .collect()
    }
    #[test]
    fn page_numbers_reset_repeat_and_continue() {
        let model = model();
        let mut numbers = PageNumbers::default();
        let mut page = PageLayout::default();
        page.items.extend(label(0, "[984]", 100.));
        page.items.extend(label(5, "[985]", 120.));
        page.items.extend(label(10, "[984]", 140.));
        page.items.push(rule());
        page.items.extend(label(0, "[984]", 820.));
        page.items.extend(label(5, "[985]", 900.));
        numbers.apply(&mut page, &model).unwrap();
        assert_eq!(
            ids(&page.items, 0),
            [expected("[1]"), expected("[1]")].concat()
        );
        assert_eq!(
            ids(&page.items, 5),
            [expected("[2]"), expected("[2]")].concat()
        );
        assert_eq!(ids(&page.items, 10), expected("[1]"));
        let mut continuation = PageLayout::default();
        continuation.items.push(rule());
        continuation.items.extend(label(5, "[985]", 820.));
        numbers.apply(&mut continuation, &model).unwrap();
        assert_eq!(ids(&continuation.items, 5), expected("[2]"));
        let mut next = PageLayout::default();
        next.items.extend(label(5, "[985]", 100.));
        next.items.push(rule());
        next.items.extend(label(5, "[985]", 820.));
        numbers.apply(&mut next, &model).unwrap();
        assert_eq!(
            ids(&next.items, 5),
            [expected("[1]"), expected("[1]")].concat()
        );
    }
    #[test]
    fn replacement_preserves_neighbor_glyphs_and_fits_symbol_slot() {
        let mut items = label(0, "x*y", 100.);
        let before = items.clone();
        replace(&mut items, 1, 2, 12, "*", false).unwrap();
        for offset in [0, 2] {
            assert_eq!(ids(&items, offset), ids(&before, offset));
        }
        assert_eq!(ids(&items, 1), expected("12"));
        let Item::GlyphRun {
            size,
            glyphs,
            source_start,
            source_end,
            ..
        } = items.last().unwrap()
        else {
            panic!()
        };
        assert!(*size <= 14.);
        assert_eq!((*source_start, *source_end), (1, 2));
        assert!(glyphs.iter().all(|g| g.3 == 1 && g.4 == 2));
    }
}
