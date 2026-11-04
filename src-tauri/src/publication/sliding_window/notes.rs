//! Note typography is identical to Legacy; allocation is shared, never post-processed.
use super::*;
use crate::publication::model::Style;
use crate::publication::optimizer::{Line, Measured, footnotes::MeasuredNote};
pub(super) fn measure(
    model: &Publication,
    root: &Path,
    manifest: &Manifest,
    faces: &[rustybuzz::Face<'_>],
    resolver: &mut FontResolver<'_>,
) -> Result<Vec<MeasuredNote>> {
    let mut notes = vec![];
    let mut total = 0usize;
    for note in &model.notes {
        let Some(reference) = model.note_references.iter().find(|r| r.note_id == note.id) else {
            notes.push(MeasuredNote {
                lines: vec![],
                label: vec![],
                continued: vec![],
            });
            continue;
        };
        let spans = [Span {
            start: reference.start,
            end: reference.end,
            style: Style::default(),
            link: None,
        }];
        let label = shape(
            &reference.label,
            reference.start,
            &spans,
            FOOTNOTE_STYLE.size,
            faces,
            resolver,
        )?;
        let indent = (label.width + 8.).max(34.);
        if indent > 160. {
            return Err("Footnote label exceeds 160 logical pixels".into());
        }
        let mut label_items = label.runs;
        for item in &mut label_items {
            optimizer::translate(item, LEFT, FOOTNOTE_STYLE.size);
        }
        let mut continued = label_items.clone();
        let marker = " …";
        let synthetic = [Span {
            start: 0,
            end: marker.len(),
            style: Style::default(),
            link: None,
        }];
        let mut dots = shape(marker, 0, &synthetic, FOOTNOTE_STYLE.size, faces, resolver)?.runs;
        for item in &mut dots {
            if let Item::GlyphRun {
                glyphs,
                source_start,
                source_end,
                ..
            } = item
            {
                *source_start = 0;
                *source_end = 0;
                for g in glyphs {
                    g.3 = 0;
                    g.4 = 0;
                }
            }
            optimizer::translate(item, LEFT + label.width, FOOTNOTE_STYLE.size);
        }
        continued.extend(dots);
        let mut selected = note.blocks.clone();
        // Preserve the title semantically, but avoid repeating a numeric label.
        let numeric = |s: &str| {
            s.trim_matches(|c: char| c.is_whitespace() || "[]().".contains(c))
                .to_owned()
        };
        if let Some(Block::Paragraph {
            start,
            end,
            style: ParagraphKind::Heading,
            ..
        }) = selected.first()
        {
            let title = numeric(&model.text[*start..*end]);
            let label = numeric(&reference.label);
            if !title.is_empty() && title.chars().all(|c| c.is_numeric()) && title == label {
                selected.remove(0);
            }
        }
        if selected
            .iter()
            .any(|b| matches!(b, Block::Image { .. } | Block::Table { .. }))
        {
            return Err(format!(
                "Note {}: images and tables inside footnotes are not supported in publisher v4",
                note.id
            )
            .into());
        }
        let measured = measure_blocks(
            model,
            &selected,
            Some(indent),
            faces,
            resolver,
            root,
            manifest,
        )?;
        let mut lines = vec![];
        for block in measured {
            match block {
                Measured::Text {
                    lines: mut paragraph,
                    gap,
                    ..
                } => {
                    if let Some(last) = paragraph.last_mut() {
                        last.height += gap;
                    }
                    lines.extend(paragraph);
                }
                Measured::Space => {
                    if let Some(last) = lines.last_mut() {
                        last.height += FOOTNOTE_STYLE.paragraph_gap;
                    }
                }
                _ => unreachable!(),
            }
        }
        if lines.is_empty() {
            lines.push(Line {
                items: vec![],
                height: FOOTNOTE_STYLE.line_height,
            });
        }
        total = total
            .checked_add(lines.len())
            .ok_or("Footnote measurement overflow")?;
        if total > 500_000 {
            return Err("Footnote measurement exceeds 500000 lines".into());
        }
        notes.push(MeasuredNote {
            lines,
            label: label_items,
            continued,
        });
    }
    Ok(notes)
}
