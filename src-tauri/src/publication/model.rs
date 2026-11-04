//! Source-neutral semantic manuscript. No XML, ZIP, CSS or source-format tags.
use super::Metadata;
use crate::library::Result;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ListContext {
    pub ordered: bool,
    pub ordinal: usize,
    pub depth: usize,
}
pub type RawSpan = (String, Style, Option<String>);
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Style {
    pub bold: bool,
    pub italic: bool,
    pub superscript: bool,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub subscript: bool,
}
impl Style {
    pub fn font(self) -> usize {
        usize::from(self.bold) * 2 + usize::from(self.italic)
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Span {
    pub start: usize,
    pub end: usize,
    pub style: Style,
    pub link: Option<String>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum ParagraphKind {
    Body,
    Heading,
    Subtitle,
    Quote,
    Verse,
    Author,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Block {
    Paragraph {
        start: usize,
        end: usize,
        spans: Vec<Span>,
        style: ParagraphKind,
        id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        list: Option<ListContext>,
    },
    Image {
        asset: String,
        cover: bool,
    },
    Table {
        cells: Vec<TableCell>,
        rows: usize,
        columns: usize,
        id: Option<String>,
    },
    EmptyLine,
}
/// Cell coordinates/spans are semantic, independent of any source format.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TableCell {
    pub row: usize,
    pub column: usize,
    pub rowspan: usize,
    pub colspan: usize,
    pub header: bool,
    pub align: Alignment,
    pub valign: VerticalAlignment,
    pub blocks: Vec<Block>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub enum Alignment {
    Left,
    Center,
    Right,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub enum VerticalAlignment {
    Top,
    Middle,
    Bottom,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Publication {
    pub schema_version: u32,
    pub text: String,
    pub blocks: Vec<Block>,
    pub metadata: Metadata,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub structure: Vec<Structure>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notes: Vec<Note>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub note_references: Vec<NoteReference>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub label: String,
    pub blocks: Vec<Block>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NoteReference {
    pub note_id: String,
    pub label: String,
    pub start: usize,
    pub end: usize,
}
/// Sparse source-neutral structure, indexed by the unchanged semantic block order.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Structure {
    pub block: usize,
    pub chapter: bool,
    pub heading_level: Option<u8>,
}
impl Publication {
    pub fn mark(&mut self, block: usize, chapter: bool, heading_level: Option<u8>) {
        match self.structure.binary_search_by_key(&block, |s| s.block) {
            Ok(index) => {
                let s = &mut self.structure[index];
                s.chapter |= chapter;
                s.heading_level = s.heading_level.or(heading_level);
            }
            Err(index) => self.structure.insert(
                index,
                Structure {
                    block,
                    chapter,
                    heading_level,
                },
            ),
        }
    }
    pub fn append_paragraph(
        &mut self,
        raw: Vec<RawSpan>,
        kind: ParagraphKind,
        id: Option<String>,
        list: Option<ListContext>,
    ) -> Result<()> {
        let start = self.text.len();
        let mut spans: Vec<Span> = Vec::new();
        let mut space = false;
        for (raw, style, link) in raw {
            for c in raw.chars() {
                if c.is_whitespace() && c != '\u{a0}' {
                    space = true;
                    continue;
                }
                // Mark damaged XML-legal controls without inventing source text.
                let c = if c.is_control() {
                    '\u{fffd}'
                } else if c == '\u{25cf}' {
                    '\u{2022}'
                } else {
                    c
                };
                // Canonicalize the filled-circle bullet to the text bullet; no new font/profile.
                // This proof profile is deliberately LTR (the supplied Cyrillic/Latin corpus).

                let offset = self.text.len();
                if space && offset > start {
                    self.text.push(' ');
                }
                space = false;
                self.text.push(c);
                let end = self.text.len();
                if let Some(last) = spans
                    .last_mut()
                    .filter(|s| s.style == style && s.link == link)
                {
                    last.end = end;
                } else {
                    spans.push(Span {
                        start: offset,
                        end,
                        style,
                        link: link.clone(),
                    });
                }
            }
        }
        let end = self.text.len();
        if end > start {
            self.blocks.push(Block::Paragraph {
                start,
                end,
                spans,
                style: kind,
                id,
                list,
            });
            self.text.push('\n');
        }
        if self.text.len() > 16 * 1024 * 1024 || self.blocks.len() > 100_000 {
            return Err("Publication text/block limit exceeded".into());
        }
        Ok(())
    }
}
