use super::{Metadata, images, write_file};
use crate::library::{Result, edition::Manifest};
use std::{collections::BTreeMap, path::Path};

use super::model::{Block, ParagraphKind, Publication, Style};
#[cfg(test)]
thread_local! {pub static PARSES:std::cell::Cell<usize>=const {std::cell::Cell::new(0)};}

fn decode_binary(encoded: &[u8]) -> Result<(Vec<u8>, bool)> {
    super::binary::decode_base64(encoded, |bytes| {
        let complete = (bytes.starts_with(b"\x89PNG\r\n\x1a\n")
            && bytes.ends_with(b"\0\0\0\0IEND\xae\x42\x60\x82"))
            || (bytes.starts_with(b"\xff\xd8") && bytes.ends_with(b"\xff\xd9"));
        complete && images::decode(bytes).is_ok()
    })
}

fn name<'a, 'input>(node: roxmltree::Node<'a, 'input>) -> &'input str {
    node.tag_name().name()
}
fn text(node: roxmltree::Node<'_, '_>) -> String {
    node.descendants()
        .filter(|n| n.is_text())
        .filter_map(|n| n.text())
        .collect::<Vec<_>>()
        .join("")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
fn href<'a, 'input>(node: roxmltree::Node<'a, 'input>) -> Result<&'a str> {
    node.attributes()
        .find(|a| a.name() == "href")
        .map(|a| a.value())
        .ok_or_else(|| "FB2 image/link has no href".into())
}
type RawSpan = (String, Style, Option<String>);
enum InlinePart {
    Text(RawSpan),
    Image(String),
}
fn inline(
    node: roxmltree::Node<'_, '_>,
    mut style: Style,
    mut link: Option<String>,
    out: &mut Vec<InlinePart>,
) -> Result<()> {
    if node.is_text() {
        out.push(InlinePart::Text((
            node.text().unwrap_or_default().into(),
            style,
            link,
        )));
        return Ok(());
    }
    if !node.is_element() {
        return Ok(());
    }
    match name(node) {
        "image" => {
            out.push(InlinePart::Image(href(node)?.into()));
            return Ok(());
        }
        "empty-line" => {
            out.push(InlinePart::Text((" ".into(), style, link)));
            return Ok(());
        }
        "strong" => style.bold = true,
        "emphasis" => style.italic = true,
        "sup" => {
            style.superscript = true;
            style.subscript = false;
        }
        "sub" => {
            style.subscript = true;
            style.superscript = false;
        }
        "a" => {
            link = Some(href(node)?.into());
            if node.attribute("type") == Some("note") {
                style.superscript = true;
            }
        }
        // These decorations have no canonical style; retain all nested text/links.
        "td" | "th" | "date" | "p" | "v" | "subtitle" | "text-author" | "title" | "style"
        | "code" | "strikethrough" => {}
        other => return Err(format!("Unsupported FB2 inline element: {other}").into()),
    }
    for child in node.children() {
        inline(child, style, link.clone(), out)?;
    }
    Ok(())
}
struct ModelBuilder {
    publication: Publication,
    assets: BTreeMap<String, String>,
    containers: std::collections::HashSet<roxmltree::NodeId>,
    warnings: Vec<String>,
    note_nodes: std::collections::HashSet<roxmltree::NodeId>,
    note_ranges: Vec<(String, std::ops::Range<usize>)>,
    excluded: Vec<std::ops::Range<usize>>,
}
impl ModelBuilder {
    fn chapter(&self, section: roxmltree::Node<'_, '_>) -> bool {
        section.has_tag_name("section")
            && !section.ancestors().any(|n| {
                n.has_tag_name("body")
                    && n.attribute("name")
                        .is_some_and(|s| s.eq_ignore_ascii_case("notes"))
            })
            && section
                .ancestors()
                .skip(1)
                .filter(|n| n.has_tag_name("section"))
                .all(|n| self.containers.contains(&n.id()))
    }
    fn paragraph(
        &mut self,
        node: roxmltree::Node<'_, '_>,
        kind: ParagraphKind,
        id: Option<String>,
    ) -> Result<()> {
        let mut raw = Vec::new();
        let base = Style {
            italic: matches!(
                kind,
                ParagraphKind::Quote | ParagraphKind::Verse | ParagraphKind::Author
            ),
            bold: matches!(kind, ParagraphKind::Heading | ParagraphKind::Subtitle),
            superscript: false,
            subscript: false,
        };
        if name(node) == "title" {
            for child in node.children().filter(|n| n.is_element()) {
                inline(child, base, None, &mut raw)?;
                raw.push(InlinePart::Text((" ".into(), base, None)));
            }
        } else {
            inline(node, base, None, &mut raw)?;
        }
        let mut spans = Vec::new();
        let mut id = id;
        for part in raw {
            match part {
                InlinePart::Text(span) => spans.push(span),
                InlinePart::Image(reference) => {
                    self.publication.append_paragraph(
                        std::mem::take(&mut spans),
                        kind,
                        id.take(),
                        None,
                    )?;
                    self.image(&reference)?;
                }
            }
        }
        self.publication.append_paragraph(spans, kind, id, None)
    }

    fn table(&mut self, node: roxmltree::Node<'_, '_>, id: Option<String>) -> Result<()> {
        use super::model::{Alignment, TableCell, VerticalAlignment};
        let rows: Vec<_> = node.children().filter(|n| n.is_element()).collect();
        if rows.is_empty() || rows.len() > 10_000 {
            return Err("FB2 table row limit exceeded".into());
        }
        let mut occupied = vec![0usize; 32];
        let mut cells = Vec::new();
        let mut columns = 0;
        for (row, tr) in rows.iter().enumerate() {
            if name(*tr) != "tr" {
                return Err("Expected FB2 table row".into());
            }
            let mut column = 0;
            for td in tr.children().filter(|n| n.is_element()) {
                if !matches!(name(td), "td" | "th") {
                    return Err("Expected FB2 table cell".into());
                }
                let span = |key: &str, limit: usize| -> Result<usize> {
                    let value = td.attribute(key).unwrap_or("1").parse::<usize>()?;
                    if value == 0 || value > limit {
                        return Err(format!("Invalid FB2 table {key}").into());
                    }
                    Ok(value)
                };
                let rowspan = span("rowspan", rows.len() - row)?;
                let colspan = span("colspan", 32)?;
                while column < 32 && occupied[column] > row {
                    column += 1;
                }
                if column + colspan > 32
                    || occupied[column..column + colspan]
                        .iter()
                        .any(|&end| end > row)
                {
                    return Err("Overlapping or excessively wide FB2 table".into());
                }
                occupied[column..column + colspan].fill(row + rowspan);
                let start = self.publication.blocks.len();
                let header = name(td) == "th";
                self.paragraph(
                    td,
                    if header {
                        ParagraphKind::Subtitle
                    } else {
                        ParagraphKind::Body
                    },
                    td.attribute("id").map(str::to_owned),
                )?;
                let blocks = self.publication.blocks.drain(start..).collect();
                let align = match td
                    .attribute("align")
                    .or(tr.attribute("align"))
                    .unwrap_or("left")
                {
                    "left" => Alignment::Left,
                    "center" => Alignment::Center,
                    "right" => Alignment::Right,
                    _ => return Err("Invalid FB2 table alignment".into()),
                };
                let valign = match td.attribute("valign").unwrap_or("top") {
                    "top" => VerticalAlignment::Top,
                    "middle" => VerticalAlignment::Middle,
                    "bottom" => VerticalAlignment::Bottom,
                    _ => return Err("Invalid FB2 table vertical alignment".into()),
                };
                cells.push(TableCell {
                    row,
                    column,
                    rowspan,
                    colspan,
                    header,
                    align,
                    valign,
                    blocks,
                });
                if cells.len() > 100_000 {
                    return Err("FB2 table cell limit exceeded".into());
                }
                column += colspan;
                columns = columns.max(column);
            }
        }
        if columns == 0 {
            return Err("Empty FB2 table".into());
        }
        self.publication.schema_version = 2;
        self.publication.blocks.push(Block::Table {
            cells,
            rows: rows.len(),
            columns,
            id,
        });
        Ok(())
    }

    fn image(&mut self, reference: &str) -> Result<()> {
        let reference = reference
            .strip_prefix('#')
            .ok_or("FB2 images must refer to embedded binaries")?;
        if let Some(asset) = self.assets.get(reference) {
            self.publication.blocks.push(Block::Image {
                asset: asset.clone(),
                cover: false,
            });
        }
        Ok(())
    }

    fn walk(
        &mut self,
        node: roxmltree::Node<'_, '_>,
        kind: ParagraphKind,
        section_id: Option<String>,
    ) -> Result<()> {
        let start = self.publication.blocks.len();
        self.walk_inner(node, kind, section_id)?;
        let end = self.publication.blocks.len();
        if self.note_nodes.contains(&node.id()) {
            self.note_ranges
                .push((node.attribute("id").unwrap().to_owned(), start..end));
            self.excluded.push(start..end);
        }
        if is_notes_body(node) {
            self.excluded.push(start..end);
        }
        Ok(())
    }
    fn walk_inner(
        &mut self,
        node: roxmltree::Node<'_, '_>,
        kind: ParagraphKind,
        section_id: Option<String>,
    ) -> Result<()> {
        crate::import_cancel::check()?;
        if !node.is_element() {
            return Ok(());
        }
        let id = node.attribute("id").map(str::to_owned).or(section_id);
        match name(node) {
            "p" => self.paragraph(node, kind, id)?,
            "title" => {
                let index = self.publication.blocks.len();
                self.paragraph(node, ParagraphKind::Heading, id)?;
                if self.publication.blocks.len() > index {
                    let depth = node
                        .ancestors()
                        .filter(|n| n.has_tag_name("section"))
                        .count();
                    self.publication.mark(
                        index,
                        node.parent().is_some_and(|n| self.chapter(n)),
                        Some(depth.max(1) as u8),
                    );
                }
            }
            "subtitle" => self.paragraph(node, ParagraphKind::Subtitle, id)?,
            "table" => self.table(node, id)?,
            "date" => self.paragraph(node, ParagraphKind::Author, id)?,
            "text-author" => self.paragraph(node, ParagraphKind::Author, id)?,
            "v" => self.paragraph(node, ParagraphKind::Verse, id)?,
            "empty-line" => self.publication.blocks.push(Block::EmptyLine),
            "image" => {
                self.image(href(node)?)?;
            }
            "body" | "section" | "poem" | "stanza" | "cite" | "epigraph" | "annotation" => {
                if self.chapter(node)
                    || (name(node) == "body"
                        && node
                            .attribute("name")
                            .is_some_and(|s| s.eq_ignore_ascii_case("notes")))
                {
                    self.publication
                        .mark(self.publication.blocks.len(), true, None);
                }
                let next = if matches!(name(node), "cite" | "epigraph") {
                    ParagraphKind::Quote
                } else {
                    kind
                };
                for child in node.children().filter(|n| n.is_element()) {
                    self.walk(child, next, id.clone())?;
                }
                if name(node) == "stanza" {
                    self.publication.blocks.push(Block::EmptyLine);
                }
            }
            other => return Err(format!("Unsupported FB2 body element: {other}").into()),
        }
        Ok(())
    }
}
pub fn parse(path: &Path, root: &Path, manifest: &mut Manifest) -> Result<Publication> {
    let parse_started = std::time::Instant::now();
    #[cfg(test)]
    PARSES.with(|n| n.set(n.get() + 1));
    if std::fs::metadata(path)?.len() > 64 * 1024 * 1024 {
        return Err("FB2 XML exceeds 64 MiB".into());
    }
    let bytes = std::fs::read(path)?;
    let xml = decode_xml(&bytes)?;
    let options = roxmltree::ParsingOptions {
        allow_dtd: false,
        nodes_limit: 250_000,
        ..Default::default()
    };
    let doc = roxmltree::Document::parse_with_options(&xml, options)?;
    let book = doc.root_element();
    if name(book) != "FictionBook"
        || book.tag_name().namespace() != Some("http://www.gribuser.ru/xml/fictionbook/2.0")
    {
        return Err("Invalid FictionBook root/namespace".into());
    }
    if book
        .descendants()
        .any(|n| n.ancestors().take(66).count() > 64)
    {
        return Err("FB2 nesting exceeds 64".into());
    }
    let title_info = book
        .children()
        .find(|n| n.has_tag_name("description"))
        .and_then(|n| n.children().find(|c| c.has_tag_name("title-info")))
        .ok_or("Missing FB2 title-info")?;
    let title = title_info
        .children()
        .find(|n| n.has_tag_name("book-title"))
        .map(text)
        .filter(|s| !s.is_empty());
    let authors = title_info
        .children()
        .filter(|n| n.has_tag_name("author"))
        .map(|a| {
            a.children()
                .filter(|n| {
                    matches!(
                        name(*n),
                        "first-name" | "middle-name" | "last-name" | "nickname"
                    )
                })
                .map(text)
                .filter(|s| !s.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(", ");
    let metadata = Metadata {
        title,
        author: if authors.is_empty() {
            None
        } else {
            Some(authors)
        },
    };
    let mut builder = ModelBuilder {
        publication: Publication {
            notes: vec![],
            note_references: vec![],
            structure: vec![],
            schema_version: 1,
            text: String::new(),
            blocks: vec![],
            metadata: metadata.clone(),
        },
        assets: BTreeMap::new(),
        warnings: vec![],
        note_nodes: Default::default(),
        note_ranges: vec![],
        excluded: vec![],
        // Book/part containers have sections and front matter, not running text.
        containers: book
            .descendants()
            .filter(|n| {
                n.has_tag_name("section")
                    && n.children().any(|c| c.has_tag_name("section"))
                    && n.children()
                        .filter(|c| c.is_element())
                        .all(|c| matches!(name(c), "title" | "section" | "epigraph" | "empty-line"))
            })
            .map(|n| n.id())
            .collect(),
    };
    let typed: std::collections::HashSet<String> = book
        .descendants()
        .filter(|n| {
            n.has_tag_name("a")
                && n.attribute("type")
                    .is_some_and(|v| v.eq_ignore_ascii_case("note"))
        })
        .filter_map(|n| {
            href(n)
                .ok()
                .and_then(|h| h.strip_prefix('#'))
                .map(str::to_owned)
        })
        .collect();
    let targets: std::collections::HashSet<_> = book
        .descendants()
        .filter(|n| {
            n.attribute("id").is_some_and(|id| {
                typed.contains(id)
                    || (n.has_tag_name("section") && n.ancestors().any(is_notes_body))
            })
        })
        .map(|n| n.id())
        .collect();
    builder.note_nodes = book
        .descendants()
        .filter(|n| {
            targets.contains(&n.id()) && !n.ancestors().skip(1).any(|a| targets.contains(&a.id()))
        })
        .map(|n| n.id())
        .collect();
    let mut total = 0usize;
    let mut normalized_binaries = 0usize;
    for (index, binary) in book
        .children()
        .filter(|n| n.has_tag_name("binary"))
        .enumerate()
    {
        if index >= 2000 {
            return Err("FB2 exceeds 2000 embedded images".into());
        }
        let id = binary.attribute("id").ok_or("FB2 binary without ID")?;
        let duplicate = builder.assets.contains_key(id);
        if duplicate {
            builder.warnings.push(format!(
                "Duplicate image ID {id}: using the first definition"
            ));
        }
        let encoded = binary
            .text()
            .unwrap_or_default()
            .bytes()
            .filter(|c| !c.is_ascii_whitespace())
            .collect::<Vec<_>>();
        if encoded.len() > 88 * 1024 * 1024 {
            return Err("FB2 image exceeds size limit".into());
        }
        let (bytes, normalized) = decode_binary(&encoded)
            .map_err(|error| format!("Invalid FB2 image '{id}': {error}"))?;
        normalized_binaries += usize::from(normalized);
        total += bytes.len();
        if bytes.len() > 64 * 1024 * 1024 || total > 128 * 1024 * 1024 {
            return Err("FB2 embedded image budget exceeded".into());
        }
        // Reader editions are static: decode GIF's first frame or BMP to PNG.
        // Trust the encoded signature: some FB2s call their BMP binaries JPEG.
        let bytes = if bytes.starts_with(b"GIF8") || bytes.starts_with(b"BM") {
            let mut reader =
                image::ImageReader::new(std::io::Cursor::new(&bytes)).with_guessed_format()?;
            let (w, h) = image::ImageReader::new(std::io::Cursor::new(&bytes))
                .with_guessed_format()?
                .into_dimensions()?;
            if w == 0
                || h == 0
                || w > 16384
                || h > 16384
                || u64::from(w) * u64::from(h) > 32 * 1024 * 1024
            {
                return Err("FB2 image geometry exceeds budget".into());
            }
            let mut limits = image::Limits::default();
            limits.max_alloc = Some(128 * 1024 * 1024);
            limits.max_image_width = Some(16384);
            limits.max_image_height = Some(16384);
            reader.limits(limits);
            let decoded = reader.decode()?;
            let mut png = std::io::Cursor::new(Vec::new());
            decoded.write_to(&mut png, image::ImageFormat::Png)?;
            let png = png.into_inner();
            total += png.len();
            if png.len() > 64 * 1024 * 1024 || total > 128 * 1024 * 1024 {
                return Err("FB2 converted image budget exceeded".into());
            }
            png
        } else {
            bytes
        };
        images::decode(&bytes)?;
        let extension = if bytes.starts_with(b"\x89PNG") {
            "png"
        } else {
            "jpg"
        };
        let record = write_file(
            root,
            &format!("assets/images/{:06}.{extension}", index + 1),
            &bytes,
        )?;
        if !duplicate {
            builder.assets.insert(id.into(), record.path.clone());
        }
        manifest.assets.push(record);
    }
    if normalized_binaries > 0 {
        builder.warnings.push(format!(
            "Normalized noncanonical Base64 endings in {normalized_binaries} embedded images"
        ));
    }
    if let Some(cover) = title_info
        .children()
        .find(|n| n.has_tag_name("coverpage"))
        .and_then(|n| n.children().find(|n| n.has_tag_name("image")))
    {
        let id = href(cover)?
            .strip_prefix('#')
            .ok_or("External cover image is unsupported")?;
        if let Some(asset) = builder.assets.get(id) {
            builder.publication.blocks.push(Block::Image {
                asset: asset.clone(),
                cover: true,
            });
        }
    }
    let mut bodies = 0;
    for body in book.children().filter(|n| n.has_tag_name("body")) {
        bodies += 1;
        builder.walk(body, ParagraphKind::Body, None)?;
    }
    if bodies == 0 || builder.publication.text.is_empty() {
        return Err("FB2 has no readable body text".into());
    }
    let aliases: BTreeMap<String, String> = book
        .descendants()
        .filter_map(|n| {
            let id = n.attribute("id")?;
            let owner = n
                .ancestors()
                .find(|a| builder.note_nodes.contains(&a.id()))?;
            Some((id.to_owned(), owner.attribute("id")?.to_owned()))
        })
        .collect();
    let parse_ms = parse_started.elapsed().as_secs_f64() * 1000.;
    let resolution_started = std::time::Instant::now();
    resolve_notes(
        &mut builder.publication,
        builder.note_ranges,
        &builder.excluded,
        &typed,
        &aliases,
        &mut builder.warnings,
    )?;
    super::note_diagnostics::parsed(parse_ms, resolution_started.elapsed().as_secs_f64() * 1000.);
    manifest.metadata = Some(metadata);
    manifest.import_warnings = builder.warnings;
    Ok(builder.publication)
}
fn is_notes_body(node: roxmltree::Node<'_, '_>) -> bool {
    node.has_tag_name("body")
        && node
            .attribute("name")
            .is_some_and(|v| v.eq_ignore_ascii_case("notes"))
}
fn resolve_notes(
    model: &mut Publication,
    ranges: Vec<(String, std::ops::Range<usize>)>,
    excluded: &[std::ops::Range<usize>],
    typed: &std::collections::HashSet<String>,
    aliases: &BTreeMap<String, String>,
    warnings: &mut Vec<String>,
) -> Result<()> {
    use super::model::{Note, NoteReference};
    if ranges.len() > 10_000 {
        return Err("Publication exceeds 10000 notes".into());
    }
    let mut ids = std::collections::HashSet::new();
    for (id, range) in ranges {
        if !ids.insert(id.clone()) {
            warnings.push(format!(
                "Duplicate note target {id}: first definition retained"
            ));
            continue;
        }
        model.notes.push(Note {
            id,
            label: String::new(),
            blocks: model.blocks[range].to_vec(),
        });
    }
    let mut removed = vec![false; model.blocks.len()];
    for range in excluded {
        removed[range.clone()].fill(true);
    }
    let mut mapping = vec![0; model.blocks.len() + 1];
    let mut next = 0;
    for (i, remove) in removed.iter().enumerate() {
        mapping[i] = next;
        if !remove {
            next += 1;
        }
    }
    mapping[removed.len()] = next;
    model
        .structure
        .retain(|s| s.block < removed.len() && !removed[s.block]);
    for s in &mut model.structure {
        s.block = mapping[s.block];
    }
    let old = std::mem::take(&mut model.blocks);
    model.blocks = old
        .into_iter()
        .enumerate()
        .filter_map(|(i, b)| (!removed[i]).then_some(b))
        .collect();
    fn refs(
        blocks: &mut [Block],
        text: &str,
        typed: &std::collections::HashSet<String>,
        aliases: &BTreeMap<String, String>,
        out: &mut Vec<NoteReference>,
    ) {
        for block in blocks {
            match block {
                Block::Paragraph { spans, .. } => {
                    for span in spans {
                        if let Some(target) = span.link.as_deref().and_then(|l| l.strip_prefix('#'))
                            && (typed.contains(target) || aliases.contains_key(target))
                        {
                            let raw = &text[span.start..span.end];
                            let label = raw.trim();
                            if !label.is_empty() {
                                let start = span.start + raw.len() - raw.trim_start().len();
                                out.push(NoteReference {
                                    note_id: aliases
                                        .get(target)
                                        .map_or(target, String::as_str)
                                        .to_owned(),
                                    label: label.to_owned(),
                                    start,
                                    end: start + label.len(),
                                });
                                span.style.superscript = true;
                                span.style.subscript = false;
                            }
                        }
                    }
                }
                Block::Table { cells, .. } => {
                    for c in cells {
                        refs(&mut c.blocks, text, typed, aliases, out);
                    }
                }
                _ => {}
            }
        }
    }
    refs(
        &mut model.blocks,
        &model.text,
        typed,
        aliases,
        &mut model.note_references,
    );
    model.note_references.sort_by_key(|r| r.start);
    // Inline styling can split one visible marker into adjacent spans.
    let mut merged: Vec<NoteReference> = Vec::new();
    for reference in std::mem::take(&mut model.note_references) {
        if let Some(previous) = merged.last_mut()
            && previous.note_id == reference.note_id
            && previous.end == reference.start
        {
            previous.end = reference.end;
            previous.label.push_str(&reference.label);
        } else {
            merged.push(reference);
        }
    }
    model.note_references = merged;
    // Nested/cyclic markers remain visible, but never recursively inject notes.
    let mut nested = 0;
    for note in &mut model.notes {
        let mut found = vec![];
        refs(&mut note.blocks, &model.text, typed, aliases, &mut found);
        nested += found.len();
        note.label = model
            .note_references
            .iter()
            .find(|r| r.note_id == note.id)
            .map(|r| r.label.clone())
            .unwrap_or_else(|| note.id.clone());
    }
    let referenced: std::collections::HashSet<_> = model
        .note_references
        .iter()
        .map(|r| r.note_id.as_str())
        .collect();
    let missing = referenced.iter().filter(|id| !ids.contains(**id)).count();
    let orphan = model
        .notes
        .iter()
        .filter(|n| !referenced.contains(n.id.as_str()))
        .count();
    if missing > 0 {
        warnings.push(format!(
            "{missing} missing note targets: visible markers retained"
        ));
    }
    if orphan > 0 {
        warnings.push(format!(
            "{orphan} unreferenced notes retained in semantic data only"
        ));
    }
    if nested > 0 {
        warnings.push(format!("{nested} nested or cyclic note references retained as inline markers; no recursive expansion"));
    }
    if model.note_references.len() > 100_000 {
        return Err("Publication note reference limit exceeded".into());
    }
    if !model.notes.is_empty() || !model.note_references.is_empty() {
        model.schema_version = 3;
    }
    Ok(())
}
fn decode_xml(bytes: &[u8]) -> Result<String> {
    let (encoding, skip) = if let Some(bom) = encoding_rs::Encoding::for_bom(bytes) {
        bom
    } else {
        let header = bytes.strip_prefix(b"<?xml").and_then(|b| {
            b.windows(2)
                .position(|w| w == b"?>")
                .filter(|&end| end < 512)
                .map(|end| &b[..end])
        });
        let label = header
            .and_then(|h| std::str::from_utf8(h).ok())
            .and_then(|h| h.split_once("encoding").map(|(_, s)| s.trim_start()))
            .map(|s| -> Result<&str> {
                let s = s
                    .strip_prefix('=')
                    .ok_or("Invalid XML encoding declaration")?
                    .trim_start();
                let quote = s.chars().next().ok_or("Empty XML encoding")?;
                if quote != '\'' && quote != '"' {
                    return Err("Invalid XML encoding quote".into());
                }
                s[1..]
                    .split_once(quote)
                    .map(|(label, _)| label)
                    .ok_or_else(|| "Unclosed XML encoding".into())
            })
            .transpose()?;
        (
            match label {
                Some(label) => encoding_rs::Encoding::for_label(label.as_bytes())
                    .ok_or("Unsupported FB2 XML encoding")?,
                None => encoding_rs::UTF_8,
            },
            0,
        )
    };
    let xml = encoding
        .decode_without_bom_handling_and_without_replacement(&bytes[skip..])
        .ok_or("Invalid bytes for declared FB2 XML encoding")?;
    if xml.len() > 128 * 1024 * 1024 {
        return Err("Decoded FB2 XML exceeds 128 MiB".into());
    }
    Ok(xml.into_owned())
}
pub fn publish(path: &Path, root: &Path, manifest: &mut Manifest) -> Result<()> {
    let publication = parse(path, root, manifest)?;
    super::typography::publish_current(&publication, root, manifest)?;
    manifest.assets.push(write_file(
        root,
        "publication.json",
        &serde_json::to_vec(&publication)?,
    )?);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    #[test]
    fn base64_unused_bits_preserve_bytes_but_invalid_payload_is_rejected() {
        for (canonical, noncanonical, bytes) in [
            ("TWE=", "TWF=", b"Ma".as_slice()),
            ("TQ==", "TR==", b"M".as_slice()),
        ] {
            assert_eq!(
                decode_binary(canonical.as_bytes()).unwrap(),
                (bytes.to_vec(), false)
            );
            assert_eq!(
                decode_binary(noncanonical.as_bytes()).unwrap(),
                (bytes.to_vec(), true)
            );
        }
        for invalid in ["T?E=", "T=WE", "TW@=", "TWFuQ===", "TWFu?==="] {
            assert!(decode_binary(invalid.as_bytes()).is_err(), "{invalid}");
        }
    }

    #[test]
    fn base64_extra_sextet_requires_a_complete_decodable_image() {
        use base64::engine::general_purpose::STANDARD;
        // Find a valid PNG whose byte length needs no Base64 padding.
        let bytes = (1..64)
            .find_map(|width| {
                let img = image::RgbaImage::from_pixel(width, 2, image::Rgba([20, 40, 60, 255]));
                let mut out = std::io::Cursor::new(Vec::new());
                img.write_to(&mut out, image::ImageFormat::Png).unwrap();
                let bytes = out.into_inner();
                bytes.len().is_multiple_of(3).then_some(bytes)
            })
            .expect("PNG divisible by three");
        let encoded = STANDARD.encode(&bytes);
        assert_eq!(
            decode_binary(encoded.as_bytes()).unwrap(),
            (bytes.clone(), false)
        );
        for tail in ["Q===", "P==="] {
            assert_eq!(
                decode_binary(format!("{encoded}{tail}").as_bytes()).unwrap(),
                (bytes.clone(), true)
            );
        }
        let truncated = STANDARD.encode(&bytes[..bytes.len() - 3]);
        assert!(decode_binary(format!("{truncated}Q===").as_bytes()).is_err());
        let mut corrupt = bytes.clone();
        corrupt[12] = b'X'; // Break the image header while preserving the IEND suffix.
        assert!(decode_binary(format!("{}Q===", STANDARD.encode(corrupt)).as_bytes()).is_err());
        assert!(decode_binary(format!("{encoded}QQ==").as_bytes()).is_ok()); // A real extra byte is never silently discarded.
        assert_eq!(
            decode_binary(format!("{encoded}QQ==").as_bytes())
                .unwrap()
                .0
                .len(),
            bytes.len() + 1
        );
    }
    #[test]
    fn table_spans_columns_pagination_and_all_source_text_survive() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("table.fb2");
        let long = "Long cell content with wrapping. ".repeat(500);
        let rows = (0..100)
            .map(|i| {
                format!("<tr><td>Entry {i}</td><td align='right'>{i}</td><td>Reference</td></tr>")
            })
            .collect::<String>();
        let xml = format!(
            "<FictionBook xmlns='http://www.gribuser.ru/xml/fictionbook/2.0'><description><title-info><book-title>Table</book-title></title-info></description><body><section><table id='t'><tr><th colspan='3'>Heading</th></tr><tr><td rowspan='2'>Year</td><td><strong>Bold</strong> <a href='#t'>Link</a></td><td align='center'>Center</td></tr><tr><td colspan='2' valign='bottom'><emphasis>Italic</emphasis><sup>2</sup><sub>3</sub></td></tr>{rows}<tr><td colspan='3'>{long}</td></tr></table><poem><stanza><v>Verse</v></stanza><date>1923</date></poem></section></body></FictionBook>"
        );
        std::fs::write(&path, &xml).unwrap();
        let mut manifest =
            super::super::manifest(&"c".repeat(64), &crate::reader::sources::Fb2FormatHandler)
                .unwrap();
        let model = parse(&path, temp.path(), &mut manifest).unwrap();
        let Block::Table {
            cells,
            rows,
            columns,
            id,
        } = &model.blocks[0]
        else {
            panic!("table missing")
        };
        assert_eq!((*rows, *columns, id.as_deref()), (104, 3, Some("t")));
        assert_eq!((cells[3].row, cells[3].column), (1, 2));
        assert_eq!((cells[4].row, cells[4].column, cells[4].colspan), (2, 1, 2));
        assert!(
            matches!(&cells[2].blocks[0], Block::Paragraph {spans,..} if spans.iter().any(|s|s.link.as_deref()==Some("#t")) && spans.iter().any(|s|s.style.bold))
        );
        let measured = super::super::typography::measure(
            &model,
            temp.path(),
            &mut manifest,
            super::super::system_fallback::provider(),
        )
        .unwrap();
        assert_eq!(model.schema_version, 2);
        let super::super::optimizer::Measured::Table { lines } = &measured[0] else {
            panic!("missing measured table")
        };
        let year = model.text.find("Year").unwrap();
        assert!(lines[0].items.iter().any(|i| matches!(i, super::super::typography::Item::GlyphRun {source_start,source_end,..} if *source_start <= year && *source_end > year)), "header must stay with first data row");
        let (pages, _) = super::super::optimizer::paginate(&model, &measured).unwrap();
        assert!(pages.len() > 3);
        let mut covered = std::collections::HashSet::new();
        for page in &pages {
            for item in &page.items {
                if let super::super::typography::Item::GlyphRun { glyphs, .. } = item {
                    for g in glyphs {
                        assert!(g.1 >= 72. && g.1 < 728. && g.2 >= 72. && g.2 < 1032.);
                        covered.extend(g.3..g.4);
                    }
                }
            }
        }
        for (offset, ch) in model
            .text
            .char_indices()
            .filter(|(_, c)| !c.is_whitespace())
        {
            assert!(covered.contains(&offset), "lost {ch} at {offset}");
        }
        let (again, _) = super::super::optimizer::paginate(&model, &measured).unwrap();
        assert_eq!(
            serde_json::to_vec(&pages).unwrap(),
            serde_json::to_vec(&again).unwrap()
        );
        for invalid in [
            xml.replace("rowspan='2'", "rowspan='99999999'"),
            xml.replace("colspan='3'", "colspan='0'"),
        ] {
            std::fs::write(&path, invalid).unwrap();
            assert!(parse(&path, temp.path(), &mut manifest).is_err());
        }
    }

    #[test]
    fn pinned_schema_content_vocabulary_is_accounted_for() {
        let schema = roxmltree::Document::parse(include_str!(
            "../../../docs/specifications/fb2/FictionBook.xsd"
        ))
        .unwrap();
        let body = [
            "bodyType",
            "titleType",
            "citeType",
            "poemType",
            "epigraphType",
            "annotationType",
            "sectionType",
            "tableType",
        ];
        let inline_types = ["styleType", "namedStyleType", "linkType", "styleLinkType"];
        for ty in schema
            .descendants()
            .filter(|n| n.has_tag_name(("http://www.w3.org/2001/XMLSchema", "complexType")))
        {
            let name = ty.attribute("name").unwrap_or_default();
            let allowed: &[&str] = if body.contains(&name) {
                &[
                    "image",
                    "title",
                    "epigraph",
                    "section",
                    "empty-line",
                    "p",
                    "poem",
                    "subtitle",
                    "table",
                    "text-author",
                    "date",
                    "stanza",
                    "v",
                    "cite",
                    "annotation",
                    "tr",
                    "th",
                    "td",
                ]
            } else if inline_types.contains(&name) {
                &[
                    "a",
                    "code",
                    "emphasis",
                    "image",
                    "strikethrough",
                    "strong",
                    "style",
                    "sub",
                    "sup",
                ]
            } else {
                continue;
            };
            for e in ty
                .descendants()
                .filter(|n| n.has_tag_name(("http://www.w3.org/2001/XMLSchema", "element")))
            {
                assert!(
                    allowed.contains(&e.attribute("name").unwrap()),
                    "unaccounted schema element in {name}"
                );
            }
        }
    }
    #[test]
    fn declared_encoding_is_decoded_without_replacing_text() {
        let source = "<?xml version=\"1.0\" encoding=\"windows-1251\"?><p>Акунин: Инь и Ян</p>";
        let (bytes, _, errors) = encoding_rs::WINDOWS_1251.encode(source);
        assert!(!errors);
        assert_eq!(decode_xml(&bytes).unwrap(), source);
        let text = "<p>日本語 и русский</p>";
        let bytes: Vec<_> = [0xff, 0xfe]
            .into_iter()
            .chain(text.encode_utf16().flat_map(u16::to_le_bytes))
            .collect();
        assert_eq!(decode_xml(&bytes).unwrap(), text);
        assert!(decode_xml(b"<?xml encoding='unknown'?><p/>").is_err());
        assert!(decode_xml(b"<p>\xff</p>").is_err());
    }

    #[test]
    fn inline_images_gif_title_spacing_and_damaged_references_preserve_content() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("test.fb2");
        let gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
        let xml = format!(
            r##"<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>Test</book-title><coverpage><image href="#absent-cover"/></coverpage></title-info></description><body><section><title><p>First</p><empty-line/><p>Second</p></title><p><strong>Before<image href="#picture"/>After</strong></p><image href="#missing"/><p>End</p></section></body><binary id="picture">{gif}</binary><binary id="picture">{gif}</binary><binary id="other">{gif}</binary></FictionBook>"##
        );
        std::fs::write(&path, xml).unwrap();
        let mut manifest =
            super::super::manifest(&"b".repeat(64), &crate::reader::sources::Fb2FormatHandler)
                .unwrap();
        let book = parse(&path, temp.path(), &mut manifest).unwrap();
        assert_eq!(book.text, "First Second\nBefore\nAfter\nEnd\n");
        assert!(
            matches!(&book.blocks[2], Block::Image { asset, .. } if asset == "assets/images/000001.png")
        );
        for index in [1, 3] {
            assert!(
                matches!(&book.blocks[index], Block::Paragraph { spans, .. } if spans.iter().all(|s|s.style.bold))
            );
        }
        assert_eq!(manifest.import_warnings.len(), 1); // Missing pictures are silently omitted.
        assert!(manifest.import_warnings[0].contains("Duplicate image ID"));
        assert_eq!(manifest.assets.len(), 3);
        for file in manifest.assets {
            let bytes = std::fs::read(temp.path().join(file.path)).unwrap();
            assert!(bytes.starts_with(b"\x89PNG"));
            assert_eq!(images::decode(&bytes).unwrap().dimensions(), (1, 1));
        }
    }
    #[test]
    fn annotation_and_decorative_wrappers_preserve_content() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("test.fb2");
        let xml = r##"<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>Test</book-title></title-info></description><body><section><p>Before</p><annotation id="intro"><p>First <emphasis>italic</emphasis>.</p><p>Second <style name="custom"><strong>bold</strong> <a href="#target">link</a></style> <code>code</code> <strikethrough>retained</strikethrough>.</p></annotation><p id="target">After</p></section></body></FictionBook>"##;
        std::fs::write(&path, xml).unwrap();
        let mut manifest =
            super::super::manifest(&"a".repeat(64), &crate::reader::sources::Fb2FormatHandler)
                .unwrap();
        let book = parse(&path, temp.path(), &mut manifest).unwrap();
        assert_eq!(
            book.text,
            "Before\nFirst italic.\nSecond bold link code retained.\nAfter\n"
        );
        assert_eq!(book.blocks.len(), 4);
        assert!(
            matches!(&book.blocks[1], Block::Paragraph { id, spans, .. } if id.as_deref() == Some("intro") && spans.iter().any(|s|s.style.italic))
        );
        assert!(
            matches!(&book.blocks[2], Block::Paragraph { spans, .. } if spans.iter().any(|s|s.style.bold) && spans.iter().any(|s|s.link.as_deref()==Some("#target")))
        );
        // An unknown element may contain an image/table: never silently drop it.
        std::fs::write(&path, xml.replace("annotation", "unknown-content")).unwrap();
        assert!(
            parse(&path, temp.path(), &mut manifest)
                .err()
                .unwrap()
                .to_string()
                .contains("Unsupported FB2 body element")
        );
    }
}
