//! Markdown semantics only. No browser HTML/CSS execution or external resource reads.
use super::{Metadata, model::*, write_file};
use crate::{
    library::{Result, edition::Manifest},
    reader::format::{DocumentFormatHandler, FormatId, ProbeResult, PublicationKind},
};
use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use std::{collections::BTreeMap, io::Read, path::Path};

pub const MARKDOWN: FormatId = FormatId("md");
pub struct MarkdownFormatHandler;
impl DocumentFormatHandler for MarkdownFormatHandler {
    fn format_id(&self) -> FormatId {
        MARKDOWN
    }
    fn filter_name(&self) -> &'static str {
        "Markdown documents"
    }
    fn supported_extensions(&self) -> &'static [&'static str] {
        &["md", "markdown"]
    }
    fn publication_kind(&self) -> PublicationKind {
        PublicationKind::GeneratedLayout
    }
    // Plain text has no magic. Registry requires the original upload extension.
    fn probe(&self, _: &[u8]) -> ProbeResult {
        ProbeResult::NotMine
    }
}
pub fn read_source(path: &Path) -> Result<String> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(16 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("Markdown exceeds 16 MiB".into());
    }
    let text = String::from_utf8(bytes).map_err(|_| "Markdown must be UTF-8 text")?;
    if text
        .chars()
        .any(|c| c.is_control() && !matches!(c, '\n' | '\r' | '\t'))
    {
        return Err("Markdown contains binary/control characters".into());
    }
    Ok(text.trim_start_matches('\u{feff}').to_owned())
}
struct Table {
    align: Vec<pulldown_cmark::Alignment>,
    cells: Vec<TableCell>,
    row: usize,
    column: usize,
    header: bool,
    cell_start: usize,
}
struct Builder {
    book: Publication,
    raw: Vec<RawSpan>,
    style: Style,
    inline: Vec<(Style, Option<String>)>,
    link: Option<String>,
    kind: ParagraphKind,
    heading: Option<u8>,
    quotes: usize,
    lists: Vec<(ListContext, bool)>,
    code: bool,
    note: Option<(String, usize)>,
    labels: BTreeMap<String, usize>,
    table: Option<Table>,
    warnings: Vec<String>,
}
impl Builder {
    fn text(&mut self, value: impl Into<String>) {
        self.raw.push((value.into(), self.style, self.link.clone()));
    }
    fn label(&mut self, id: &str) -> String {
        let next = self.labels.len() + 1;
        self.labels.entry(id.to_owned()).or_insert(next).to_string()
    }
    fn flush(&mut self) -> Result<()> {
        let index = self.book.blocks.len();
        let list = self
            .lists
            .last()
            .filter(|(_, used)| !used)
            .map(|(l, _)| l.clone());
        if let Some(context) = &list
            && self.raw.iter().any(|span| !span.0.trim().is_empty())
        {
            let marker = if context.ordered {
                format!("{}. ", context.ordinal)
            } else {
                "• ".into()
            };
            self.raw.insert(0, (marker, Style::default(), None));
        }
        self.book
            .append_paragraph(std::mem::take(&mut self.raw), self.kind, None, list)?;
        if self.book.blocks.len() == index {
            return Ok(());
        }
        if let Some((_, used)) = self.lists.last_mut() {
            *used = true;
        }
        if let Some(Block::Paragraph {
            start, end, spans, ..
        }) = self.book.blocks.last()
        {
            for span in spans {
                if let Some(id) = span
                    .link
                    .as_deref()
                    .and_then(|s| s.strip_prefix("#md-note-"))
                {
                    self.book.note_references.push(NoteReference {
                        note_id: format!("md-note-{id}"),
                        label: self.book.text[span.start..span.end]
                            .trim()
                            .trim_matches(['[', ']'])
                            .to_owned(),
                        start: span.start,
                        end: span.end,
                    });
                }
            }
            if self.heading == Some(1) && self.book.metadata.title.is_none() && self.note.is_none()
            {
                self.book.metadata.title = Some(self.book.text[*start..*end].to_owned());
            }
        }
        if let Some(level) = self
            .heading
            .filter(|_| self.note.is_none() && self.table.is_none())
        {
            self.book.mark(index, level == 1, Some(level));
        }
        Ok(())
    }
    fn body(&mut self) {
        self.kind = if self.quotes > 0 {
            ParagraphKind::Quote
        } else {
            ParagraphKind::Body
        };
    }
    fn start(&mut self, tag: Tag<'_>) -> Result<()> {
        match tag {
            Tag::Paragraph => {
                self.flush()?;
                self.body();
            }
            Tag::Heading { level, .. } => {
                self.flush()?;
                self.kind = ParagraphKind::Heading;
                self.style.bold = true;
                self.heading = Some(level as u8);
            }
            Tag::BlockQuote(_) => {
                self.flush()?;
                self.quotes += 1;
                self.body();
            }
            Tag::CodeBlock(_) => {
                self.flush()?;
                self.code = true;
                self.kind = ParagraphKind::Verse;
            }
            Tag::List(first) => {
                self.flush()?;
                self.lists.push((
                    ListContext {
                        ordered: first.is_some(),
                        ordinal: usize::try_from(first.unwrap_or(1))?,
                        depth: self.lists.len(),
                    },
                    false,
                ));
            }
            Tag::Item => {
                self.flush()?;
                if let Some((_, used)) = self.lists.last_mut() {
                    *used = false;
                }
            }
            Tag::Emphasis | Tag::Strong | Tag::Link { .. } | Tag::Strikethrough => {
                self.inline.push((self.style, self.link.clone()));
                match tag {
                    Tag::Emphasis => self.style.italic = true,
                    Tag::Strong => self.style.bold = true,
                    Tag::Link { dest_url, .. } => self.link = Some(dest_url.into_string()),
                    _ => {}
                }
            }
            Tag::Image { dest_url, .. } => {
                // A standalone uploaded .md has no accompanying directory. Preserve
                // the description and location rather than silently losing the image.
                self.text(format!("[Image: {dest_url} — "));
                if self.warnings.is_empty() {
                    self.warnings.push("Markdown images are shown as descriptions/paths; external resources are not loaded. Use EPUB for a document with bundled images.".into());
                }
            }
            Tag::FootnoteDefinition(id) => {
                self.flush()?;
                if self.note.is_some() {
                    return Err("Nested Markdown footnotes are unsupported".into());
                }
                self.note = Some((id.into_string(), self.book.blocks.len()));
            }
            Tag::Table(align) => {
                self.flush()?;
                if align.len() > 64 || self.table.is_some() {
                    return Err("Markdown table exceeds limits".into());
                }
                self.table = Some(Table {
                    align,
                    cells: vec![],
                    row: 0,
                    column: 0,
                    header: false,
                    cell_start: self.book.blocks.len(),
                });
            }
            Tag::TableHead => {
                if let Some(t) = &mut self.table {
                    t.header = true;
                    t.column = 0;
                }
            }
            Tag::TableRow => {
                if let Some(t) = &mut self.table {
                    t.header = false;
                    t.column = 0;
                }
            }
            Tag::TableCell => {
                self.flush()?;
                if let Some(t) = &mut self.table {
                    t.cell_start = self.book.blocks.len();
                }
            }
            _ => {}
        }
        Ok(())
    }
    fn end(&mut self, tag: TagEnd) -> Result<()> {
        match tag {
            TagEnd::Paragraph => {
                self.flush()?;
                self.body();
            }
            TagEnd::Heading(_) => {
                self.flush()?;
                self.heading = None;
                self.style.bold = false;
                self.body();
            }
            TagEnd::BlockQuote(_) => {
                self.flush()?;
                self.quotes -= 1;
                self.body();
            }
            TagEnd::CodeBlock => {
                self.flush()?;
                self.code = false;
                self.body();
            }
            TagEnd::Item => {
                self.flush()?;
                if let Some((l, _)) = self.lists.last_mut() {
                    l.ordinal = l.ordinal.saturating_add(1);
                }
            }
            TagEnd::List(_) => {
                self.flush()?;
                self.lists.pop();
            }
            TagEnd::Emphasis | TagEnd::Strong | TagEnd::Link | TagEnd::Strikethrough => {
                if let Some((style, link)) = self.inline.pop() {
                    self.style = style;
                    self.link = link;
                }
            }
            TagEnd::Image => self.text("]"),
            TagEnd::FootnoteDefinition => {
                self.flush()?;
                let (id, index) = self.note.take().ok_or("Invalid Markdown footnote")?;
                let label = self.label(&id);
                self.book.notes.push(Note {
                    id: format!("md-note-{id}"),
                    label,
                    blocks: self.book.blocks.split_off(index),
                });
            }
            TagEnd::TableCell => {
                self.flush()?;
                if let Some(t) = &mut self.table {
                    let align = match t.align.get(t.column) {
                        Some(pulldown_cmark::Alignment::Center) => Alignment::Center,
                        Some(pulldown_cmark::Alignment::Right) => Alignment::Right,
                        _ => Alignment::Left,
                    };
                    t.cells.push(TableCell {
                        row: t.row,
                        column: t.column,
                        rowspan: 1,
                        colspan: 1,
                        header: t.header,
                        align,
                        valign: VerticalAlignment::Top,
                        blocks: self.book.blocks.split_off(t.cell_start),
                    });
                    t.column += 1;
                    if t.cells.len() > 10_000 {
                        return Err("Markdown table exceeds 10000 cells".into());
                    }
                }
            }
            TagEnd::TableHead | TagEnd::TableRow => {
                if let Some(t) = &mut self.table {
                    t.row += 1;
                }
            }
            TagEnd::Table => {
                let t = self.table.take().ok_or("Invalid Markdown table")?;
                self.book.blocks.push(Block::Table {
                    cells: t.cells,
                    rows: t.row,
                    columns: t.align.len(),
                    id: None,
                });
            }
            _ => {}
        }
        Ok(())
    }
}
pub fn parse(text: &str) -> Result<(Publication, Vec<String>)> {
    if text.len() > 16 * 1024 * 1024 {
        return Err("Markdown exceeds 16 MiB".into());
    }
    let mut b = Builder {
        book: Publication {
            schema_version: 1,
            text: String::new(),
            blocks: vec![],
            metadata: Metadata::default(),
            structure: vec![],
            notes: vec![],
            note_references: vec![],
        },
        raw: vec![],
        style: Style::default(),
        inline: vec![],
        link: None,
        kind: ParagraphKind::Body,
        heading: None,
        quotes: 0,
        lists: vec![],
        code: false,
        note: None,
        labels: BTreeMap::new(),
        table: None,
        warnings: vec![],
    };
    let mut depth = 0;
    let options = Options::ENABLE_TABLES | Options::ENABLE_FOOTNOTES | Options::ENABLE_TASKLISTS;
    for (count, event) in Parser::new_ext(text, options).enumerate() {
        if count % 1024 == 0 {
            crate::import_cancel::check()?;
        }
        if count > 1_000_000 {
            return Err("Markdown exceeds event budget".into());
        }
        match event {
            Event::Start(tag) => {
                depth += 1;
                if depth > 64 {
                    return Err("Markdown nesting exceeds 64".into());
                }
                b.start(tag)?;
            }
            Event::End(tag) => {
                b.end(tag)?;
                depth -= 1;
            }
            Event::Text(value) if b.code => {
                for (index, line) in value.split_inclusive('\n').enumerate() {
                    if index % 1024 == 0 {
                        crate::import_cancel::check()?;
                    }
                    let line = line
                        .trim_end_matches(['\r', '\n'])
                        .replace('\t', "    ")
                        .replace(' ', "\u{a0}");
                    if line.is_empty() {
                        b.book.blocks.push(Block::EmptyLine);
                    } else {
                        b.text(line);
                        b.flush()?;
                    }
                    if b.book.blocks.len() > 100_000 {
                        return Err("Markdown exceeds block budget".into());
                    }
                }
            }
            Event::Text(value)
            | Event::Code(value)
            | Event::Html(value)
            | Event::InlineHtml(value) => b.text(value.into_string()),
            Event::SoftBreak => b.text(" "),
            Event::HardBreak => {
                b.kind = ParagraphKind::Verse;
                b.flush()?;
            }
            Event::Rule => {
                b.flush()?;
                b.book.append_paragraph(
                    vec![("* * *".into(), Style::default(), None)],
                    ParagraphKind::Subtitle,
                    None,
                    None,
                )?;
            }
            Event::TaskListMarker(done) => b.text(if done { "[x] " } else { "[ ] " }),
            Event::FootnoteReference(id) => {
                let label = b.label(&id);
                b.raw.push((
                    format!("[{label}]"),
                    Style {
                        superscript: true,
                        ..Style::default()
                    },
                    Some(format!("#md-note-{id}")),
                ));
            }
            _ => {}
        }
    }
    b.flush()?;
    if b.book.blocks.is_empty() {
        return Err("Markdown has no readable text".into());
    }
    Ok((b.book, b.warnings))
}
pub fn publish(path: &Path, root: &Path, manifest: &mut Manifest) -> Result<()> {
    let (book, warnings) = parse(&read_source(path)?)?;
    manifest.metadata = Some(book.metadata.clone());
    manifest.import_warnings.extend(warnings);
    super::typography::publish_current(&book, root, manifest)?;
    manifest.assets.push(write_file(
        root,
        "publication.json",
        &serde_json::to_vec(&book)?,
    )?);
    Ok(())
}
