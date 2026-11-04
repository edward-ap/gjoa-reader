//! Bounded manuscript importer. RTF layout/font geometry never reaches typography.
use super::{
    Metadata, images,
    model::{Block, ListContext, ParagraphKind, Publication, RawSpan, Style},
    write_file,
};
use crate::{
    library::{Result, edition::Manifest},
    reader::format::{DocumentFormatHandler, FormatId, ProbeResult, PublicationKind},
};
use std::{collections::BTreeMap, path::Path};
pub const RTF: FormatId = FormatId("rtf");
pub struct RtfFormatHandler;
impl DocumentFormatHandler for RtfFormatHandler {
    fn format_id(&self) -> FormatId {
        RTF
    }
    fn filter_name(&self) -> &'static str {
        "RTF books"
    }
    fn supported_extensions(&self) -> &'static [&'static str] {
        &["rtf"]
    }
    fn publication_kind(&self) -> PublicationKind {
        PublicationKind::GeneratedLayout
    }
    fn probe(&self, header: &[u8]) -> ProbeResult {
        if header.starts_with(b"{\\rtf1") && header.get(6).is_none_or(|b| !b.is_ascii_digit()) {
            ProbeResult::Supported
        } else {
            ProbeResult::NotMine
        }
    }
}
#[derive(Debug)]
enum Node<'a> {
    Group(Vec<Node<'a>>),
    Word(&'a str, Option<i32>),
    Symbol(u8),
    Byte(u8),
    Text(&'a [u8]),
    Binary(&'a [u8]),
}
struct Lexer<'a> {
    bytes: &'a [u8],
    pos: usize,
    nodes: usize,
}
impl<'a> Lexer<'a> {
    fn group(&mut self, depth: usize) -> Result<Vec<Node<'a>>> {
        if depth > 64 {
            return Err("RTF nesting exceeds 64".into());
        }
        let mut out = vec![];
        while self.pos < self.bytes.len() {
            self.nodes += 1;
            if self.nodes > 1_000_000 {
                return Err("RTF exceeds token budget".into());
            }
            let b = self.bytes[self.pos];
            self.pos += 1;
            let node = match b {
                b'{' => Node::Group(self.group(depth + 1)?),
                b'}' => return Ok(out),
                b'\\' => {
                    let b = *self.bytes.get(self.pos).ok_or("Truncated RTF escape")?;
                    self.pos += 1;
                    if b == b'\'' {
                        let hex = self
                            .bytes
                            .get(self.pos..self.pos + 2)
                            .ok_or("Truncated RTF hex")?;
                        self.pos += 2;
                        Node::Byte(u8::from_str_radix(std::str::from_utf8(hex)?, 16)?)
                    } else if b.is_ascii_alphabetic() {
                        let start = self.pos - 1;
                        while self
                            .bytes
                            .get(self.pos)
                            .is_some_and(u8::is_ascii_alphabetic)
                        {
                            self.pos += 1;
                        }
                        if self.pos - start > 32 {
                            return Err("RTF control word exceeds 32 characters".into());
                        }
                        let word = std::str::from_utf8(&self.bytes[start..self.pos])?;
                        let start = self.pos;
                        if self.bytes.get(self.pos) == Some(&b'-') {
                            self.pos += 1;
                        }
                        while self.bytes.get(self.pos).is_some_and(u8::is_ascii_digit) {
                            self.pos += 1;
                        }
                        let value = if self.pos != start {
                            Some(
                                std::str::from_utf8(&self.bytes[start..self.pos])?
                                    .parse::<i32>()?,
                            )
                        } else {
                            None
                        };
                        if self.bytes.get(self.pos) == Some(&b' ') {
                            self.pos += 1;
                        }
                        if word == "bin" {
                            let len = usize::try_from(value.ok_or("RTF bin needs length")?)?;
                            let end = self
                                .pos
                                .checked_add(len)
                                .ok_or("RTF binary length overflow")?;
                            let data = self
                                .bytes
                                .get(self.pos..end)
                                .ok_or("Truncated RTF binary data")?;
                            self.pos = end;
                            Node::Binary(data)
                        } else {
                            Node::Word(word, value)
                        }
                    } else {
                        Node::Symbol(b)
                    }
                }
                b'\r' | b'\n' => continue,
                _ => {
                    let start = self.pos - 1;
                    while self
                        .bytes
                        .get(self.pos)
                        .is_some_and(|b| !matches!(b, b'{' | b'}' | b'\\' | b'\r' | b'\n'))
                    {
                        self.pos += 1;
                    }
                    Node::Text(&self.bytes[start..self.pos])
                }
            };
            out.push(node);
        }
        Err("Unclosed RTF group".into())
    }
}
fn destination<'a>(nodes: &[Node<'a>]) -> (&'a str, bool) {
    let mut optional = false;
    for n in nodes {
        match n {
            Node::Symbol(b'*') => optional = true,
            Node::Word(word, _) => return (word, optional),
            Node::Text(t) if t.iter().all(u8::is_ascii_whitespace) => {}
            _ => break,
        }
    }
    ("", optional)
}
#[derive(Clone)]
struct Attributes {
    style: Style,
    font: i32,
    default_font: i32,
    cp: i32,
    uc: usize,
    fs: i32,
    centered: bool,
    left: i32,
    right: i32,
    kind: Option<ParagraphKind>,
    heading_level: Option<u8>,
    hidden: bool,
    list: Option<ListContext>,
}
impl Default for Attributes {
    fn default() -> Self {
        Self {
            style: Style::default(),
            font: 0,
            default_font: 0,
            cp: 1252,
            uc: 1,
            fs: 24,
            centered: false,
            left: 0,
            right: 0,
            kind: None,
            heading_level: None,
            hidden: false,
            list: None,
        }
    }
}
#[derive(Default)]
struct Tables {
    fonts: BTreeMap<i32, i32>,
    styles: BTreeMap<i32, Attributes>,
}
impl Attributes {
    fn control(&mut self, word: &str, n: Option<i32>, tables: &Tables) -> Result<()> {
        let v = n.unwrap_or(1);
        match word {
            "b" => self.style.bold = v != 0,
            "i" => self.style.italic = v != 0,
            "super" | "up" => {
                self.style.superscript = v > 0;
                self.style.subscript = false;
            }
            "sub" | "dn" => {
                self.style.subscript = v > 0;
                self.style.superscript = false;
            }
            "nosupersub" => {
                self.style.superscript = false;
                self.style.subscript = false;
            }
            "v" => self.hidden = v != 0,
            "plain" => {
                self.style = Style::default();
                self.hidden = false;
                self.font = self.default_font;
                self.fs = 24;
            }
            "pard" => {
                self.kind = None;
                self.heading_level = None;
                self.centered = false;
                self.left = 0;
                self.right = 0;
                self.list = None;
            }
            "f" => self.font = v,
            "deff" => {
                self.font = v;
                self.default_font = v;
            }
            "ansicpg" => self.cp = v,
            "uc" => {
                self.uc = usize::try_from(v)?;
                if self.uc > 16 {
                    return Err("RTF Unicode fallback exceeds 16".into());
                }
            }
            "fs" => self.fs = v,
            "qc" => self.centered = true,
            "ql" | "qr" | "qj" => self.centered = false,
            "li" => self.left = v,
            "ri" => self.right = v,
            "outlinelevel" => {
                self.heading_level = (0..=8).contains(&v).then(|| (v + 1) as u8);
                self.kind = if (0..=8).contains(&v) {
                    Some(if v < 2 {
                        ParagraphKind::Heading
                    } else {
                        ParagraphKind::Subtitle
                    })
                } else {
                    None
                }
            }
            "s" => {
                if let Some(s) = tables.styles.get(&v) {
                    self.style = s.style;
                    self.fs = s.fs;
                    self.centered = s.centered;
                    self.left = s.left;
                    self.right = s.right;
                    self.kind = s.kind;
                    self.heading_level = s.heading_level;
                    self.font = s.font;
                } else if v == 0 {
                    self.kind = None;
                    self.heading_level = None;
                    self.centered = false;
                    self.left = 0;
                    self.right = 0;
                    self.style = Style::default();
                    self.fs = 24;
                    self.font = self.default_font;
                }
            }
            "rtlch" | "rtlpar" | "rtldoc" => {}
            "mac" | "pc" | "pca" => {
                return Err("Only Windows ANSI RTF code pages are supported".into());
            }
            _ => {}
        }
        Ok(())
    }
    fn paragraph_kind(&self) -> ParagraphKind {
        self.kind
            .unwrap_or(if self.centered && self.style.bold && self.fs >= 28 {
                ParagraphKind::Heading
            } else if self.left > 0 && self.right > 0 {
                ParagraphKind::Quote
            } else {
                ParagraphKind::Body
            })
    }
    fn encoding(&self, tables: &Tables) -> Result<&'static encoding_rs::Encoding> {
        let cp = tables
            .fonts
            .get(&self.font)
            .copied()
            .filter(|v| *v != 0)
            .unwrap_or(self.cp);
        if !(1250..=1258).contains(&cp) {
            return Err(format!("Unsupported RTF code page {cp}").into());
        }
        encoding_rs::Encoding::for_label(format!("windows-{cp}").as_bytes())
            .ok_or_else(|| "Unknown RTF encoding".into())
    }
}
#[derive(Default)]
struct TextBuffer {
    spans: Vec<RawSpan>,
    skip: usize,
    high: Option<u16>,
}
impl TextBuffer {
    fn push(&mut self, text: &str, style: Style, link: Option<String>) -> Result<()> {
        if self.high.is_some() {
            return Err("Unpaired RTF Unicode surrogate".into());
        }
        if let Some((last, old_style, old_link)) = self.spans.last_mut()
            && *old_style == style
            && *old_link == link
        {
            last.push_str(text);
            return Ok(());
        }
        self.spans.push((text.into(), style, link));
        Ok(())
    }
    fn bytes(&mut self, bytes: &[u8], a: &Attributes, tables: &Tables) -> Result<()> {
        let skip = self.skip.min(bytes.len());
        self.skip -= skip;
        if a.hidden || bytes.len() == skip {
            return Ok(());
        }
        let (text, errors) = a
            .encoding(tables)?
            .decode_without_bom_handling(&bytes[skip..]);
        if errors {
            return Err("Invalid byte in RTF code page".into());
        }
        self.push(&text, a.style, None)
    }
    fn unicode(&mut self, n: i32, a: &Attributes) -> Result<()> {
        if !(-32768..=65535).contains(&n) {
            return Err("RTF Unicode escape outside UTF-16".into());
        }
        self.skip = a.uc;
        if a.hidden {
            return Ok(());
        }
        let unit = n as u16;
        if (0xd800..=0xdbff).contains(&unit) {
            if self.high.replace(unit).is_some() {
                return Err("Unpaired RTF high surrogate".into());
            }
            return Ok(());
        }
        let value = if let Some(high) = self.high.take() {
            if !(0xdc00..=0xdfff).contains(&unit) {
                return Err("Unpaired RTF high surrogate".into());
            }
            0x10000 + ((u32::from(high) - 0xd800) << 10) + u32::from(unit) - 0xdc00
        } else {
            u32::from(unit)
        };
        let ch = char::from_u32(value).ok_or("Unpaired RTF low surrogate")?;
        self.push(&ch.to_string(), a.style, None)
    }
    fn symbol(&mut self, s: u8, a: &Attributes, tables: &Tables) -> Result<()> {
        if self.skip > 0 {
            self.skip -= 1;
            return Ok(());
        }
        if a.hidden {
            return Ok(());
        }
        match s {
            b'\\' | b'{' | b'}' => self.bytes(&[s], a, tables),
            b'~' => self.push("\u{a0}", a.style, None),
            b'_' => self.push("‑", a.style, None),
            b'-' => Ok(()), // discretionary hyphen is not part of canonical line geometry
            _ => Ok(()),
        }
    }
}
fn plain_text(
    nodes: &[Node<'_>],
    mut a: Attributes,
    tables: &Tables,
    out: &mut TextBuffer,
) -> Result<()> {
    for node in nodes {
        match node {
            Node::Text(t) => out.bytes(t, &a, tables)?,
            Node::Byte(b) => out.bytes(&[*b], &a, tables)?,
            Node::Symbol(s) => out.symbol(*s, &a, tables)?,
            Node::Word("u", Some(n)) => out.unicode(*n, &a)?,
            Node::Word(w, n) => a.control(w, *n, tables)?,
            Node::Group(g) if !destination(g).1 => {
                out.skip = 0;
                plain_text(g, a.clone(), tables, out)?;
                out.skip = 0;
            }
            _ => {}
        }
    }
    Ok(())
}
fn string(nodes: &[Node<'_>], a: Attributes, tables: &Tables) -> Result<String> {
    let mut out = TextBuffer::default();
    plain_text(nodes, a, tables, &mut out)?;
    if out.high.is_some() {
        return Err("Unpaired metadata surrogate".into());
    }
    Ok(out
        .spans
        .into_iter()
        .map(|s| s.0)
        .collect::<String>()
        .trim()
        .trim_end_matches(';')
        .trim()
        .to_owned())
}
struct Builder<'a, 'b> {
    book: Publication,
    raw: TextBuffer,
    paragraph: Option<Attributes>,
    tables: &'b Tables,
    root: &'b Path,
    manifest: &'b mut Manifest,
    image_bytes: usize,
    notes: Vec<(&'a [Node<'a>], Attributes, usize)>,
    next_note: usize,
    in_note: Option<usize>,
}
impl<'a, 'b> Builder<'a, 'b> {
    fn flush(&mut self) -> Result<()> {
        if self.raw.high.is_some() {
            return Err("Unpaired RTF Unicode surrogate".into());
        }
        let a = self.paragraph.take().unwrap_or_default();
        let raw = std::mem::take(&mut self.raw.spans);
        if !raw.is_empty() {
            let first = self.book.blocks.len();
            let level = a.heading_level;
            self.book
                .append_paragraph(raw, a.paragraph_kind(), None, a.list)?;
            if self.book.blocks.len() > first && level.is_some() {
                self.book
                    .mark(first, level == Some(1) && self.in_note.is_none(), level);
            }
        }
        Ok(())
    }
    fn capture(&mut self, a: &Attributes) {
        if !a.hidden && self.paragraph.is_none() {
            self.paragraph = Some(a.clone());
        }
    }
    fn image(&mut self, nodes: &[Node<'_>]) -> Result<()> {
        self.flush()?;
        let mut bytes = vec![];
        let mut high = None;
        let mut extension = None;
        for node in nodes {
            match node {
                Node::Word("pngblip", _) => extension = Some("png"),
                Node::Word("jpegblip", _) => extension = Some("jpg"),
                Node::Text(text) => {
                    for b in *text {
                        if b.is_ascii_whitespace() {
                            continue;
                        }
                        let digit =
                            (*b as char).to_digit(16).ok_or("Invalid RTF picture hex")? as u8;
                        if let Some(h) = high.take() {
                            bytes.push(h * 16 + digit);
                        } else {
                            high = Some(digit);
                        }
                    }
                }
                Node::Binary(data) if high.is_none() => bytes.extend_from_slice(data),
                Node::Binary(_) => return Err("Unaligned RTF picture binary".into()),
                Node::Group(g) if destination(g).1 => {}
                Node::Group(_) => return Err("Unsupported RTF picture group".into()),
                _ => {}
            }
            if bytes.len() > images::MAX_IMAGE_BYTES as usize {
                return Err("RTF image exceeds 64 MiB".into());
            }
        }
        if high.is_some() {
            return Err("Odd RTF picture hex length".into());
        }
        let extension = extension.ok_or("Only RTF JPEG/PNG pictures are supported")?;
        images::dimensions(&bytes)?;
        self.image_bytes += bytes.len();
        if self.image_bytes > 128 * 1024 * 1024 || self.manifest.assets.len() >= 2000 {
            return Err("RTF image budget exceeded".into());
        }
        let file = write_file(
            self.root,
            &format!(
                "assets/images/{:06}.{extension}",
                self.manifest.assets.len() + 1
            ),
            &bytes,
        )?;
        self.book.blocks.push(Block::Image {
            asset: file.path.clone(),
            cover: self.book.blocks.is_empty(),
        });
        self.manifest.assets.push(file);
        Ok(())
    }
    fn group(&mut self, nodes: &'a [Node<'a>], a: Attributes) -> Result<()> {
        let (dest, optional) = destination(nodes);
        match dest {
            "fonttbl" | "colortbl" | "stylesheet" | "info" | "header" | "headerl" | "headerr"
            | "headerf" | "footer" | "footerl" | "footerr" | "footerf" | "filetbl"
            | "listtable" | "listoverridetable" | "revtbl" | "generator" | "nonshppict"
            | "fldinst" | "annotation" => return Ok(()),
            "object" | "objdata" | "shp" => {
                return Err("RTF objects/vector shapes are unsupported".into());
            }
            "pict" => return self.image(nodes),
            "footnote" => {
                if self.in_note.is_some() || self.notes.len() >= 10_000 {
                    return Err("Invalid RTF footnote nesting/count".into());
                }
                let index = self.notes.len() + 1;
                self.next_note = self.next_note.max(index);
                self.notes.push((nodes, a, index));
                return Ok(());
            }
            "listtext" | "pntext" => {
                let marker = string(nodes, a.clone(), self.tables)?;
                self.capture(&a);
                if let Some(p) = &mut self.paragraph {
                    p.list = Some(ListContext {
                        ordered: marker.chars().next().is_some_and(|c| c.is_ascii_digit()),
                        ordinal: marker.trim_end_matches(['.', ')']).parse().unwrap_or(1),
                        depth: 0,
                    });
                }
                return self.raw.push(&format!("{marker} "), a.style, None);
            }
            "shppict" | "fldrslt" | "field" => {}
            _ if optional => return Ok(()),
            _ => {}
        }
        self.walk(nodes, a)
    }
    fn walk(&mut self, nodes: &'a [Node<'a>], mut a: Attributes) -> Result<()> {
        for node in nodes {
            match node {
                Node::Group(g) => {
                    self.raw.skip = 0;
                    self.group(g, a.clone())?;
                    self.raw.skip = 0;
                }
                Node::Text(t) => {
                    if !t.iter().all(u8::is_ascii_whitespace) {
                        self.capture(&a);
                    }
                    self.raw.bytes(t, &a, self.tables)?;
                }
                Node::Byte(b) => {
                    self.capture(&a);
                    self.raw.bytes(&[*b], &a, self.tables)?;
                }
                Node::Symbol(s) => {
                    if *s != b'*' {
                        self.capture(&a);
                    }
                    self.raw.symbol(*s, &a, self.tables)?;
                }
                Node::Word("u", Some(n)) => {
                    self.capture(&a);
                    self.raw.unicode(*n, &a)?;
                }
                Node::Word(w, _) if self.raw.skip > 0 && *w != "uc" => {
                    self.raw.skip -= 1;
                }
                Node::Word("par" | "line" | "page" | "sect", _) => self.flush()?,
                Node::Word("tab", _) => {
                    self.capture(&a);
                    self.raw.push(" ", a.style, None)?;
                }
                Node::Word(
                    "emdash" | "endash" | "bullet" | "lquote" | "rquote" | "ldblquote"
                    | "rdblquote",
                    _,
                ) => {
                    let Node::Word(w, _) = node else {
                        unreachable!()
                    };
                    let text = match *w {
                        "emdash" => "—",
                        "endash" => "–",
                        "bullet" => "•",
                        "lquote" => "‘",
                        "rquote" => "’",
                        "ldblquote" => "“",
                        _ => "”",
                    };
                    self.capture(&a);
                    if !a.hidden {
                        self.raw.push(text, a.style, None)?;
                    }
                }
                Node::Word("chftn", _) => {
                    let index = if let Some(n) = self.in_note {
                        n
                    } else {
                        self.next_note += 1;
                        self.next_note
                    };
                    self.capture(&a);
                    let mut style = a.style;
                    style.superscript = true;
                    self.raw
                        .push(&format!("[{index}]"), style, Some(format!("#note-{index}")))?;
                }
                Node::Word("trowd" | "intbl" | "cell" | "nestcell" | "row", _) => {
                    return Err("RTF tables are unsupported".into());
                }
                Node::Word(w, n) => a.control(w, *n, self.tables)?,
                Node::Binary(_) => return Err("RTF binary outside a picture".into()),
            }
        }
        Ok(())
    }
}
#[cfg(test)]
thread_local! { pub static PARSES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }
pub fn parse(path: &Path, root: &Path, manifest: &mut Manifest) -> Result<Publication> {
    #[cfg(test)]
    PARSES.with(|n| n.set(n.get() + 1));
    if std::fs::metadata(path)?.len() > 64 * 1024 * 1024 {
        return Err("RTF exceeds 64 MiB".into());
    }
    let bytes = std::fs::read(path)?;
    if RtfFormatHandler.probe(&bytes) != ProbeResult::Supported {
        return Err("Invalid RTF header".into());
    }
    let mut lexer = Lexer {
        bytes: &bytes,
        pos: 1,
        nodes: 0,
    };
    let nodes = lexer.group(1)?;
    if !bytes[lexer.pos..].iter().all(u8::is_ascii_whitespace) {
        return Err("Trailing data after RTF root".into());
    }
    let mut defaults = Attributes::default();
    let mut tables = Tables::default();
    for node in &nodes {
        if let Node::Word(w @ ("ansicpg" | "deff"), n) = node {
            defaults.control(w, *n, &tables)?;
        }
        if let Node::Group(g) = node
            && destination(g).0 == "fonttbl"
        {
            for entry in g {
                if let Node::Group(font) = entry {
                    let mut id = None;
                    let mut cp = 0;
                    for item in font {
                        match item {
                            Node::Word("f", Some(n)) => id = Some(*n),
                            Node::Word("cpg", Some(n)) => cp = *n,
                            Node::Word("fcharset", Some(n)) => {
                                cp = match n {
                                    0 | 1 => 0,
                                    204 => 1251,
                                    238 => 1250,
                                    161 => 1253,
                                    162 => 1254,
                                    177 => 1255,
                                    178 => 1256,
                                    186 => 1257,
                                    163 => 1258,
                                    2 => -2,
                                    _ => -*n,
                                }
                            }
                            _ => {}
                        }
                    }
                    if let Some(id) = id {
                        tables.fonts.insert(id, cp);
                    }
                }
            }
        }
    }
    let mut table_state = defaults.clone();
    for node in &nodes {
        if let Node::Word("uc", n) = node {
            table_state.control("uc", *n, &tables)?;
        }
        if let Node::Group(g) = node
            && destination(g).0 == "stylesheet"
        {
            for entry in g {
                if let Node::Group(style) = entry {
                    let mut a = defaults.clone();
                    let mut id = None;
                    for item in style {
                        if let Node::Word(w, n) = item {
                            if *w == "s" {
                                id = *n;
                            } else {
                                a.control(w, *n, &tables)?;
                            }
                        }
                    }
                    let name = string(style, table_state.clone(), &tables)?.to_lowercase();
                    if name.contains("heading") || name.contains("заголовок") {
                        a.heading_level = name
                            .chars()
                            .find_map(|c| c.to_digit(10))
                            .filter(|n| (1..=9).contains(n))
                            .map(|n| n as u8)
                            .or(a.heading_level);
                    }
                    a.kind = if name.contains("heading")
                        || name == "title"
                        || name.contains("заголовок")
                    {
                        Some(ParagraphKind::Heading)
                    } else if name.contains("author") {
                        Some(ParagraphKind::Author)
                    } else if name.contains("cite")
                        || name.contains("quote")
                        || name.contains("epigraph")
                    {
                        Some(ParagraphKind::Quote)
                    } else if name.contains("stanza") {
                        Some(ParagraphKind::Verse)
                    } else {
                        a.kind
                    };
                    if let Some(id) = id {
                        tables.styles.insert(id, a);
                    }
                }
            }
        }
    }
    let mut metadata = Metadata::default();
    let mut metadata_state = defaults.clone();
    for node in &nodes {
        if let Node::Word("uc", n) = node {
            metadata_state.control("uc", *n, &tables)?;
        }
        if let Node::Group(g) = node
            && destination(g).0 == "info"
        {
            for item in g {
                if let Node::Group(info) = item {
                    let value = string(info, metadata_state.clone(), &tables)?;
                    if !value.is_empty() {
                        match destination(info).0 {
                            "title" => metadata.title = Some(value),
                            "author" => metadata.author = Some(value),
                            _ => {}
                        }
                    }
                }
            }
        }
    }
    let mut builder = Builder {
        book: Publication {
            notes: vec![],
            note_references: vec![],
            structure: vec![],
            schema_version: 1,
            text: String::new(),
            blocks: vec![],
            metadata: metadata.clone(),
        },
        raw: TextBuffer::default(),
        paragraph: None,
        tables: &tables,
        root,
        manifest,
        image_bytes: 0,
        notes: vec![],
        next_note: 0,
        in_note: None,
    };
    builder.walk(&nodes, defaults)?;
    builder.flush()?;
    for (note, mut a, index) in std::mem::take(&mut builder.notes) {
        a.style.superscript = false;
        a.style.subscript = false;
        a.kind = Some(ParagraphKind::Body);
        builder.in_note = Some(index);
        let start = builder.book.blocks.len();
        builder.walk(note, a)?;
        builder.flush()?;
        if let Some(Block::Paragraph { id, .. }) = builder.book.blocks.get_mut(start) {
            *id = Some(format!("note-{index}"));
        }
    }
    if builder.book.text.trim().is_empty() {
        return Err("RTF has no readable manuscript text".into());
    }
    builder.manifest.metadata = Some(metadata);
    Ok(builder.book)
}
pub fn publish(path: &Path, root: &Path, manifest: &mut Manifest) -> Result<()> {
    let book = parse(path, root, manifest)?;
    super::typography::publish_current(&book, root, manifest)?;
    manifest.assets.push(write_file(
        root,
        "publication.json",
        &serde_json::to_vec(&book)?,
    )?);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        library::{Library, edition},
        reader::{document::RenderRequest, registry::FormatRegistry},
    };
    fn parse_bytes(bytes: &[u8]) -> Result<Publication> {
        let temp = tempfile::tempdir()?;
        let path = temp.path().join("source.bin");
        std::fs::write(&path, bytes)?;
        let mut manifest = super::super::manifest(&"0".repeat(64), &RtfFormatHandler)?;
        parse(&path, temp.path(), &mut manifest)
    }
    #[test]
    fn groups_codepages_unicode_and_footnotes_preserve_text_and_styles() {
        let extreme = parse_bytes(br"{\rtf1\outlinelevel2147483647 Text}").unwrap();
        assert!(extreme.structure.is_empty());
        // A later root-level uc must not change fallback handling earlier in the file.
        let scoped = parse_bytes(br"{\rtf1\u1040?\uc0\u1041{\uc1\u1042?}\u1043}").unwrap();
        assert_eq!(scoped.text, "АБВГ\n");
        let metadata = parse_bytes(br"{\rtf1\uc0{\info{\title \u1040}}Text}").unwrap();
        assert_eq!(metadata.metadata.title.as_deref(), Some("А"));
        let book = parse_bytes(br"{\rtf1\ansi\ansicpg1251{\fonttbl{\f0\fcharset204 Arial;}}{\info{\title Test}{\author Writer}}{\stylesheet{\s1\b\fs32 heading 1;}{\s2\i\li600\ri600 Quote;}}\s1 Heading\par\s0\b0\i0\li0\ri0\fs24\ql \'cf\'f0\'e8\'e2\'e5\'f2 {\b bold {\i both} bold} normal \uc2\u1040??\uc1\u1041?\uc0\u1042  \{ok\}\par\s2 Quoted\par\pard\plain Body{\super superscript}\chftn{\footnote \chftn Note text\par} tail\par{\*\unknown SECRET {nested}}{\header HEADER}\uc1\u-10179?\u-8704?}").unwrap();
        assert_eq!(book.metadata.title.as_deref(), Some("Test"));
        assert!(
            book.text.contains("Привет bold both bold normal АБВ {ok}"),
            "{}",
            book.text
        );
        assert!(!book.text.contains("SECRET") && !book.text.contains("HEADER"));
        assert!(book.text.contains('😀'));
        assert!(book.text.find("tail").unwrap() < book.text.find("Note text").unwrap());
        let span_has = |word: &str, bold: bool, italic: bool, superscript: bool| {
            book.blocks.iter().any(|b| match b {
                Block::Paragraph { spans, .. } => spans.iter().any(|s| {
                    book.text[s.start..s.end].contains(word)
                        && s.style
                            == Style {
                                bold,
                                italic,
                                superscript,
                                subscript: false,
                            }
                }),
                _ => false,
            })
        };
        assert!(span_has("both", true, true, false));
        assert!(span_has("normal", false, false, false));
        assert!(span_has("superscript", false, false, true));
        assert!(book.blocks.iter().any(|b| matches!(
            b,
            Block::Paragraph {
                style: ParagraphKind::Quote,
                ..
            }
        )));
        assert!(
            book.blocks
                .iter()
                .any(|b| matches!(b, Block::Paragraph { id: Some(id), .. } if id == "note-1"))
        );
    }
    #[test]
    fn canonical_output_ignores_author_font_and_geometry() {
        let temp = tempfile::tempdir().unwrap();
        let staging = temp.path().join("staging");
        std::fs::create_dir(&staging).unwrap();
        let mut outputs = vec![];
        for (index, face, size, paper) in [(0, "Arial", 20, 8000), (1, "Courier New", 80, 20000)] {
            let path = temp.path().join(format!("{index}.bin"));
            let source = format!(
                r"{{\rtf1\ansi{{\fonttbl{{\f0 {face};}}}}{{\stylesheet{{\s1\b\fs{size} heading 1;}}{{\s0\b0\fs{size} Normal;}}}}\paperw{paper}\margl2000\s1 Heading\par\s0 Plain {{\b strong}} {{\i emphasis}} {{\super 2}}.\par{{\listtext 1.\tab}}First item\par}}"
            );
            std::fs::write(&path, source).unwrap();
            let hash =
                crate::library::store::hash_reader(std::fs::File::open(&path).unwrap()).unwrap();
            let registry = FormatRegistry::default();
            let handler = registry.detect(&path).unwrap();
            assert_eq!(handler.format_id(), RTF);
            let prepared = super::super::prepare(&hash, handler, &path, &staging).unwrap();
            let root = prepared.directory.as_ref().unwrap().path();
            let model = std::fs::read(root.join("publication.json")).unwrap();
            let book: Publication = serde_json::from_slice(&model).unwrap();
            assert!(book.blocks.iter().any(|b| matches!(b, Block::Paragraph { list: Some(l), .. } if l.ordered && l.ordinal == 1)));
            outputs.push((prepared.manifest.page_files.clone(), model));
        }
        assert_eq!(outputs[0], outputs[1]);
    }
    #[test]
    fn binary_and_hex_images_are_persisted_once() {
        use image::ImageEncoder;
        let mut png = vec![];
        image::codecs::png::PngEncoder::new(&mut png)
            .write_image(&[255, 0, 0, 255], 1, 1, image::ExtendedColorType::Rgba8)
            .unwrap();
        let mut binary =
            format!(r"{{\rtf1\ansi Text\par{{\pict\pngblip\bin{} ", png.len()).into_bytes();
        binary.extend_from_slice(&png);
        binary.extend_from_slice(b"}} ");
        let book = parse_bytes(&binary).unwrap();
        assert_eq!(
            book.blocks
                .iter()
                .filter(|b| matches!(b, Block::Image { .. }))
                .count(),
            1
        );
        let hex: String = png.iter().map(|b| format!("{b:02x}")).collect();
        let book = parse_bytes(format!(r"{{\rtf1 Text{{\*\shppict{{\pict\pngblip {hex}}}}}{{\nonshppict{{\pict\wmetafile8 ignored}}}}}}").as_bytes()).unwrap();
        assert_eq!(
            book.blocks
                .iter()
                .filter(|b| matches!(b, Block::Image { .. }))
                .count(),
            1
        );
    }
    #[test]
    fn malformed_sources_roll_back_cleanly() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("library");
        let mut library = Library::new(&root).unwrap();
        let deep = format!("{{\\rtf1 {}text{} }}", "{".repeat(65), "}".repeat(65));
        for source in [
            r"{\rtf1 unclosed",
            r"{\rtf1 text}trailing",
            r"{\rtf1 \'xx}",
            r"{\rtf1 \u-10179?}",
            r"{\rtf1 \uc999 text}",
            r"{\rtf1 {\pict\pngblip a}}",
            r"{\rtf1 \bin999 x}",
            r"{\rtf1 \ansicpg932 text}",
            r"{\rtf1 {\object unsupported}}",
            &deep,
        ] {
            let path = temp.path().join("broken.rtf");
            std::fs::write(&path, source).unwrap();
            assert!(
                library.import_path(&path, None).is_err(),
                "accepted {source}"
            );
            assert!(library.list().unwrap().items.is_empty());
            for dir in ["staging", "editions"] {
                assert_eq!(std::fs::read_dir(root.join(dir)).unwrap().count(), 0);
            }
        }
    }
    #[test]
    #[ignore = "external corpus: set GJOA_TEST_CORPUS_DIR and run explicitly with --ignored"]
    fn real_rtf_editions_reopen_without_sources_or_typesetting() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("library");
        let mut library = Library::new(&root).unwrap();
        let mut imported = vec![];
        for entry in std::fs::read_dir(crate::test_corpus::directory()).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|x| x.to_str()) != Some("rtf") {
                continue;
            }
            let result = library
                .import_path(&path, None)
                .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            let parses = PARSES.with(|n| n.get());
            let typesets = super::super::typography::TYPESETS.with(|n| n.get());
            let duplicate = library.import_path(&path, None).unwrap();
            assert!(duplicate.duplicate);
            assert_eq!(duplicate.publication_ms, 0.);
            let manifest: Manifest = serde_json::from_slice(
                &std::fs::read(
                    root.join(edition::manifest_relative(&result.item.edition_id).unwrap()),
                )
                .unwrap(),
            )
            .unwrap();
            std::fs::remove_file(root.join(&manifest.source_path)).unwrap();
            let (doc, _) =
                edition::resolve(&root, &result.item.edition_id, &FormatRegistry::default())
                    .unwrap();
            assert_eq!(doc.format_id(), RTF);
            for index in [0, 10, doc.page_count() / 2, doc.page_count() - 1] {
                let raster = doc
                    .render_page(
                        index,
                        RenderRequest {
                            width: 160,
                            height: 224,
                        },
                    )
                    .unwrap();
                assert_eq!(raster.rgba.len(), 160 * 224 * 4);
            }
            for width in [800, 1600] {
                doc.render_page(
                    10,
                    RenderRequest {
                        width,
                        height: width * 7 / 5,
                    },
                )
                .unwrap();
            }
            assert_eq!(PARSES.with(|n| n.get()), parses);
            assert_eq!(
                super::super::typography::TYPESETS.with(|n| n.get()),
                typesets
            );
            library.save_progress(result.item.id, 10).unwrap();
            imported.push(result.item);
        }
        assert!(
            imported.len() >= 2,
            "Keep the original RTF regression corpus"
        );
        drop(library);
        let library = Library::new(&root).unwrap();
        for item in imported {
            assert_eq!(
                library
                    .list()
                    .unwrap()
                    .items
                    .iter()
                    .find(|i| i.id == item.id)
                    .unwrap()
                    .page_index,
                Some(10)
            );
            let (doc, _) =
                edition::resolve(&root, &item.edition_id, &FormatRegistry::default()).unwrap();
            assert_eq!(doc.page_count(), item.page_count);
        }
    }
}
