//! Column layout for source-neutral tables. Emits existing saved glyph/image items.
use super::*;
use crate::publication::{
    model::{Alignment, TableCell, VerticalAlignment},
    optimizer::{Line, Measured},
};

const STEP: f32 = 24.;
const SIZE: f32 = 16.;
const PAD: f32 = 5.;

fn translate(item: &mut Item, x: f32, y: f32) {
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

fn flush(tokens: &mut Vec<Token>, width: f32, align: Alignment) -> Vec<Item> {
    while tokens.last().is_some_and(|t| t.space) {
        tokens.pop();
    }
    let used: f32 = tokens.iter().map(|t| t.width).sum();
    let left = match align {
        Alignment::Left => 0.,
        Alignment::Center => (width - used) / 2.,
        Alignment::Right => width - used,
    }
    .max(0.);
    measured_line(tokens, left, width, (SIZE, STEP), false, false)
}

#[allow(clippy::too_many_arguments)]
fn paragraph(
    model: &Publication,
    start: usize,
    end: usize,
    spans: &[Span],
    width: f32,
    align: Alignment,
    faces: &[rustybuzz::Face<'_>],
    resolver: &mut FontResolver<'_>,
) -> Result<Vec<Vec<Item>>> {
    let text = model
        .text
        .get(start..end)
        .ok_or("Invalid table text range")?;
    let bidi = unicode_bidi::BidiInfo::new(text, None);
    let mut breaks: Vec<_> = unicode_linebreak::linebreaks(text)
        .map(|(i, _)| i)
        .collect();
    for (i, c) in text.char_indices() {
        if c == ' ' {
            breaks.extend([i, i + 1]);
        }
    }
    breaks.push(text.len());
    breaks.sort_unstable();
    breaks.dedup();
    let boundaries: std::collections::HashSet<_> = text
        .grapheme_indices(true)
        .map(|(i, _)| i)
        .chain(std::iter::once(text.len()))
        .collect();
    breaks.retain(|i| boundaries.contains(i));
    let mut result = Vec::new();
    let mut tokens = Vec::new();
    let mut used = 0.;
    let mut previous = 0;
    for end in breaks {
        if end == previous {
            continue;
        }
        let mut token = shape(
            &text[previous..end],
            start + previous,
            spans,
            SIZE,
            faces,
            resolver,
        )?;
        token.level = bidi.levels[previous];
        // Emergency wrapping only for a word wider than its column; preserve graphemes.
        let pieces = if token.width > width {
            text[previous..end]
                .grapheme_indices(true)
                .map(|(i, g)| {
                    let mut t = shape(g, start + previous + i, spans, SIZE, faces, resolver)?;
                    t.level = bidi.levels[previous + i];
                    Ok(t)
                })
                .collect::<Result<Vec<_>>>()?
        } else {
            vec![token]
        };
        previous = end;
        for token in pieces {
            if token.width > width {
                return Err("Table column too narrow for a grapheme".into());
            }
            if token.space && tokens.is_empty() {
                continue;
            }
            if used + token.width > width && !tokens.is_empty() {
                result.push(flush(&mut tokens, width, align));
                used = 0.;
                if token.space {
                    continue;
                }
            }
            used += token.width;
            tokens.push(token);
        }
    }
    if !tokens.is_empty() {
        result.push(flush(&mut tokens, width, align));
    }
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn measure(
    model: &Publication,
    cells: &[TableCell],
    rows: usize,
    columns: usize,
    faces: &[rustybuzz::Face<'_>],
    resolver: &mut FontResolver<'_>,
    root: &Path,
    manifest: &Manifest,
) -> Result<Measured> {
    if rows == 0 || rows > 10_000 || columns == 0 || columns > 32 || cells.len() > 100_000 {
        return Err("Table dimensions exceed publication limits".into());
    }
    let mut occupied = vec![false; rows * columns];
    let mut preferred = vec![1f32; columns];
    for c in cells {
        if c.rowspan == 0
            || c.colspan == 0
            || c.row.checked_add(c.rowspan).is_none_or(|n| n > rows)
            || c.column.checked_add(c.colspan).is_none_or(|n| n > columns)
        {
            return Err("Invalid table cell span".into());
        }
        for r in c.row..c.row + c.rowspan {
            for col in c.column..c.column + c.colspan {
                if std::mem::replace(&mut occupied[r * columns + col], true) {
                    return Err("Overlapping table cells".into());
                }
            }
        }
        if c.colspan == 1 && !c.header {
            let length = c
                .blocks
                .iter()
                .filter_map(|b| {
                    if let Block::Paragraph { start, end, .. } = b {
                        model.text.get(*start..*end)
                    } else {
                        None
                    }
                })
                .map(|s| s.chars().count())
                .sum::<usize>();
            preferred[c.column] = preferred[c.column].max((length.min(80) as f32).sqrt());
        }
    }
    let available = RIGHT - LEFT;
    let minimum = (available / columns as f32).min(52.);
    let sum: f32 = preferred.iter().sum();
    let widths: Vec<_> = preferred
        .iter()
        .map(|p| minimum + (available - minimum * columns as f32) * p / sum)
        .collect();
    let mut offsets = vec![LEFT];
    for w in &widths {
        offsets.push(offsets.last().unwrap() + w);
    }
    let mut contents = Vec::new();
    let mut heights = vec![1usize; rows];
    let mut total_lines = 0usize;
    for c in cells {
        let width = offsets[c.column + c.colspan] - offsets[c.column] - 2. * PAD;
        let mut lines = Vec::new();
        for b in &c.blocks {
            match b {
                Block::Paragraph {
                    start, end, spans, ..
                } => lines.extend(paragraph(
                    model, *start, *end, spans, width, c.align, faces, resolver,
                )?),
                Block::EmptyLine => lines.push(vec![]),
                Block::Image { asset, .. } => {
                    let record = manifest
                        .assets
                        .iter()
                        .find(|r| &r.path == asset)
                        .ok_or("Missing table image")?;
                    let (w, h) =
                        crate::publication::images::dimensions(&crate::publication::read_file(
                            root,
                            record,
                            crate::publication::images::MAX_IMAGE_BYTES,
                        )?)?;
                    // Keep images within one line band so a page break cannot bisect them.
                    let scale = (width / w as f32).min((STEP - 4.) / h as f32).min(1.);
                    lines.push(vec![Item::Image {
                        asset: asset.clone(),
                        bounds: [0., 2., w as f32 * scale, h as f32 * scale],
                    }]);
                }
                Block::Table { .. } => {
                    return Err("Nested publication tables are unsupported".into());
                }
            }
        }
        total_lines += lines.len();
        if total_lines > 200_000 {
            return Err("Table layout line limit exceeded".into());
        }
        if c.rowspan == 1 {
            heights[c.row] = heights[c.row].max(lines.len());
        }
        contents.push(lines);
    }
    for (c, lines) in cells.iter().zip(&contents) {
        let current: usize = heights[c.row..c.row + c.rowspan].iter().sum();
        if lines.len() > current {
            heights[c.row + c.rowspan - 1] += lines.len() - current;
        }
    }
    let mut starts = vec![0usize];
    for h in heights {
        starts.push(starts.last().unwrap() + h);
    }
    if *starts.last().unwrap() > 200_000 {
        return Err("Table height limit exceeded".into());
    }
    let mut bands: Vec<Vec<Item>> = (0..*starts.last().unwrap()).map(|_| Vec::new()).collect();
    for (c, lines) in cells.iter().zip(contents) {
        let slack = starts[c.row + c.rowspan] - starts[c.row] - lines.len();
        let shift = match c.valign {
            VerticalAlignment::Top => 0,
            VerticalAlignment::Middle => slack / 2,
            VerticalAlignment::Bottom => slack,
        };
        for (i, items) in lines.into_iter().enumerate() {
            for mut item in items {
                translate(&mut item, offsets[c.column] + PAD, 2.);
                bands[starts[c.row] + shift + i].push(item);
            }
        }
    }
    // Keep span-connected row groups together when they fit on a page. Larger groups
    // split at baseline bands, so neither glyphs nor cell images are clipped or lost.
    let capacity = ((BOTTOM - 72.) / STEP) as usize;
    let mut reach: Vec<_> = (1..=rows).collect();
    for c in cells {
        reach[c.row] = reach[c.row].max(c.row + c.rowspan);
    }
    // A leading header must travel with the first data row, not sit alone at
    // the bottom of the preceding page.
    let mut header_rows = vec![(false, true); rows];
    for c in cells {
        header_rows[c.row].0 = true;
        header_rows[c.row].1 &= c.header;
    }
    let first_data = header_rows
        .iter()
        .position(|&(present, header)| !present || !header)
        .unwrap_or(rows);
    if first_data > 0 && first_data < rows {
        reach[0] = reach[0].max(first_data + 1);
    }
    let mut lines = Vec::new();
    let mut row = 0;
    while row < rows {
        let mut end = row + 1;
        let mut scan = row;
        while scan < end {
            end = end.max(reach[scan]);
            scan += 1;
        }
        let mut band = starts[row];
        while band < starts[end] {
            let stop = (band + capacity).min(starts[end]);
            let mut items = Vec::new();
            for (i, b) in bands.iter_mut().enumerate().take(stop).skip(band) {
                for mut item in std::mem::take(b) {
                    translate(&mut item, 0., (i - band) as f32 * STEP);
                    items.push(item);
                }
            }
            lines.push(Line {
                items,
                height: (stop - band) as f32 * STEP,
            });
            band = stop;
        }
        row = end;
    }
    Ok(Measured::Table { lines })
}
