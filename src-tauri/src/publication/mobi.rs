//! Bounded, unencrypted MOBI6/PalmDOC -> semantic manuscript. No reader-time parser.
use super::{
    Metadata, images,
    model::{Block, ListContext, ParagraphKind, Publication, RawSpan, Style},
    write_file,
};
use crate::{
    library::{Result, edition::Manifest},
    reader::format::{DocumentFormatHandler, FormatId, ProbeResult, PublicationKind},
};
use html5ever::tokenizer::{BufferQueue, TagKind, Token, TokenSink, TokenSinkResult, Tokenizer};
use std::cell::RefCell;
use std::{
    collections::BTreeMap,
    io::{Cursor, Read},
    path::Path,
};

pub const MOBI: FormatId = FormatId("mobi");
const MAX_TEXT: usize = 16 * 1024 * 1024;
pub struct MobiFormatHandler;
#[derive(Default)]
struct Element {
    tag: String,
    attrs: BTreeMap<String, String>,
    children: Vec<usize>,
}
impl Element {
    fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.get(name).map(String::as_str)
    }
}
enum HtmlNode {
    Element(Element),
    Text(String),
}
struct Markup {
    nodes: Vec<HtmlNode>,
    stack: Vec<usize>,
    error: bool,
}
struct MarkupSink(RefCell<Markup>);
impl Markup {
    fn parse(text: &str) -> Result<Self> {
        // MOBI's legacy HTML permits formatting around blocks. HTML5's adoption
        // agency algorithm invents thousands of nested b/i elements for such files.
        // Tokenize entities/attributes with html5ever, but retain scoped source order.
        let sink = MarkupSink(RefCell::new(Self {
            nodes: vec![HtmlNode::Element(Element::default())],
            stack: vec![0],
            error: false,
        }));
        let tokenizer = Tokenizer::new(sink, Default::default());
        let input = BufferQueue::default();
        input.push_back(text.into());
        let _ = tokenizer.feed(&input);
        tokenizer.end();
        let tree = tokenizer.sink.0.into_inner();
        if tree.error {
            Err("MOBI markup exceeds node/depth budget".into())
        } else {
            Ok(tree)
        }
    }
    fn append(&mut self, node: HtmlNode) {
        if self.nodes.len() >= 250000 {
            self.error = true;
            return;
        }
        let parent = *self.stack.last().expect("root");
        let index = self.nodes.len();
        if let HtmlNode::Element(e) = &mut self.nodes[parent] {
            e.children.push(index);
        }
        self.nodes.push(node);
    }
    fn close(&mut self, tag: &str) {
        if let Some(index) = self
            .stack
            .iter()
            .rposition(|&i| matches!(&self.nodes[i],HtmlNode::Element(e) if e.tag==tag))
        {
            self.stack.truncate(index.max(1));
        }
    }
}
impl TokenSink for MarkupSink {
    type Handle = ();
    fn process_token(&self, token: Token, _line: u64) -> TokenSinkResult<()> {
        let mut tree = self.0.borrow_mut();
        if tree.error {
            return TokenSinkResult::Continue;
        }
        match token {
            Token::CharacterTokens(text) => tree.append(HtmlNode::Text(text.to_string())),
            Token::NullCharacterToken => tree.append(HtmlNode::Text("\u{fffd}".into())),
            Token::TagToken(tag) => {
                let name = tag.name.to_string();
                if tag.kind == TagKind::EndTag {
                    tree.close(&name);
                } else {
                    if matches!(
                        name.as_str(),
                        "p" | "div" | "blockquote" | "h1" | "h2" | "h3" | "ul" | "ol" | "pre"
                    ) {
                        tree.close("p");
                    }
                    if name == "li"
                        && let Some(&last) = tree.stack.last()
                        && matches!(&tree.nodes[last],HtmlNode::Element(e) if e.tag=="li")
                    {
                        tree.close("li");
                    }
                    let is_void = tag.self_closing
                        || matches!(
                            name.as_str(),
                            "img"
                                | "br"
                                | "hr"
                                | "mbp:pagebreak"
                                | "meta"
                                | "link"
                                | "input"
                                | "reference"
                        );
                    let index = tree.nodes.len();
                    tree.append(HtmlNode::Element(Element {
                        tag: name,
                        attrs: tag
                            .attrs
                            .into_iter()
                            .map(|a| (a.name.local.to_string(), a.value.to_string()))
                            .collect(),
                        children: Vec::new(),
                    }));
                    if !is_void && !tree.error {
                        if tree.stack.len() >= 64 {
                            tree.error = true;
                        } else {
                            tree.stack.push(index);
                        }
                    }
                }
            }
            _ => {}
        }
        TokenSinkResult::Continue
    }
}
impl DocumentFormatHandler for MobiFormatHandler {
    fn format_id(&self) -> FormatId {
        MOBI
    }
    fn filter_name(&self) -> &'static str {
        "MOBI books"
    }
    fn supported_extensions(&self) -> &'static [&'static str] {
        &["mobi", "prc"]
    }
    fn publication_kind(&self) -> PublicationKind {
        PublicationKind::GeneratedLayout
    }
    fn probe(&self, header: &[u8]) -> ProbeResult {
        if header.get(60..68) == Some(b"BOOKMOBI") {
            ProbeResult::Supported
        } else {
            ProbeResult::NotMine
        }
    }
}
fn u16be(b: &[u8], p: usize) -> Result<usize> {
    Ok(u16::from_be_bytes(
        b.get(p..p + 2)
            .ok_or("Truncated MOBI integer")?
            .try_into()?,
    ) as usize)
}
fn u32be(b: &[u8], p: usize) -> Result<usize> {
    Ok(u32::from_be_bytes(
        b.get(p..p + 4)
            .ok_or("Truncated MOBI integer")?
            .try_into()?,
    ) as usize)
}
fn decode(b: &[u8], encoding: usize) -> Result<String> {
    match encoding {
        65001 => Ok(std::str::from_utf8(b)?.to_owned()),
        1252 => Ok(encoding_rs::WINDOWS_1252.decode(b).0.into_owned()),
        _ => Err(format!("Unsupported MOBI text encoding: {encoding}").into()),
    }
}
fn trim_record(mut b: &[u8], flags: usize) -> Result<&[u8]> {
    for bit in (1..16).rev() {
        if flags & (1 << bit) == 0 {
            continue;
        }
        let mut size = 0;
        let mut found = false;
        for (i, &byte) in b.iter().rev().take(4).enumerate() {
            size |= usize::from(byte & 127) << (7 * i);
            if byte & 128 != 0 {
                found = size > i;
                break;
            }
        }
        if !found || size > b.len() {
            return Err("Invalid MOBI trailing record size".into());
        }
        b = &b[..b.len() - size];
    }
    if flags & 1 != 0 {
        let size = usize::from(*b.last().ok_or("Missing MOBI overlap")? & 3) + 1;
        b = b
            .get(..b.len().checked_sub(size).ok_or("Invalid MOBI overlap")?)
            .ok_or("Invalid MOBI overlap")?;
    }
    Ok(b)
}
fn palmdoc(b: &[u8], limit: usize) -> Result<Vec<u8>> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let byte = b[i];
        i += 1;
        match byte {
            1..=8 => {
                let end = i + usize::from(byte);
                out.extend_from_slice(b.get(i..end).ok_or("Truncated PalmDOC literal")?);
                i = end;
            }
            0 | 9..=127 => out.push(byte),
            192..=255 => out.extend_from_slice(&[b' ', byte ^ 128]),
            _ => {
                let pair = (usize::from(byte) << 8)
                    | usize::from(*b.get(i).ok_or("Truncated PalmDOC reference")?);
                i += 1;
                let distance = (pair >> 3) & 2047;
                if distance == 0 || distance > out.len() {
                    return Err("Invalid PalmDOC back-reference".into());
                }
                for _ in 0..(pair & 7) + 3 {
                    out.push(out[out.len() - distance]);
                }
            }
        }
        if out.len() > limit {
            return Err("PalmDOC expansion exceeds record limit".into());
        }
    }
    Ok(out)
}
struct Container<'a> {
    records: Vec<&'a [u8]>,
    html: String,
    metadata: Metadata,
    first_image: usize,
    cover: Option<usize>,
}
impl<'a> Container<'a> {
    fn parse(bytes: &'a [u8]) -> Result<Self> {
        if bytes.get(60..68) != Some(b"BOOKMOBI") {
            return Err("Not a MOBI database".into());
        }
        let count = u16be(bytes, 76)?;
        if count < 2 {
            return Err("Empty MOBI database".into());
        }
        let table_end = 78 + count * 8;
        let mut offsets = Vec::with_capacity(count + 1);
        for i in 0..count {
            let p = u32be(bytes, 78 + i * 8)?;
            if p < table_end || p >= bytes.len() || offsets.last().is_some_and(|&prev| prev >= p) {
                return Err("Invalid MOBI record table".into());
            }
            offsets.push(p);
        }
        offsets.push(bytes.len());
        let records: Vec<_> = offsets.windows(2).map(|w| &bytes[w[0]..w[1]]).collect();
        let h = records[0];
        if h.get(16..20) != Some(b"MOBI") {
            return Err("Missing MOBI header".into());
        }
        let compression = u16be(h, 0)?;
        if u16be(h, 12)? != 0 {
            return Err("Encrypted MOBI books are not supported".into());
        }
        if !matches!(compression, 1 | 2) {
            return Err("MOBI HUFF/CDIC compression is not supported; use an uncompressed or PalmDOC MOBI edition".into());
        }
        let header_len = u32be(h, 20)?;
        if header_len < 116 || 16 + header_len > h.len() {
            return Err("Invalid MOBI header length".into());
        }
        if u32be(h, 36)? > 6 {
            return Err(
                "Standalone KF8/AZW3 is not supported; MOBI6 or a dual MOBI edition is required"
                    .into(),
            );
        }
        let encoding = u32be(h, 28)?;
        let text_len = u32be(h, 4)?;
        let text_count = u16be(h, 8)?;
        let record_size = u16be(h, 10)?;
        if text_len == 0
            || text_len > MAX_TEXT
            || text_count == 0
            || text_count >= records.len()
            || record_size == 0
            || record_size > 65535
        {
            return Err("MOBI text budget/header invalid".into());
        }
        let flags = if header_len >= 228 { u16be(h, 242)? } else { 0 };
        let mut text = Vec::with_capacity(text_len);
        for record in &records[1..=text_count] {
            let b = trim_record(record, flags)?;
            let b = if compression == 2 {
                palmdoc(b, record_size)?
            } else {
                b.to_vec()
            };
            if b.len() > record_size || text.len() + b.len() > text_len {
                return Err("MOBI expanded text exceeds header length".into());
            }
            text.extend(b);
        }
        if text.len() != text_len {
            return Err("MOBI text length mismatch".into());
        }
        let name_offset = u32be(h, 84)?;
        let name_len = u32be(h, 88)?;
        let title = decode(
            h.get(
                name_offset
                    ..name_offset
                        .checked_add(name_len)
                        .ok_or("MOBI title overflow")?,
            )
            .ok_or("Invalid MOBI title")?,
            encoding,
        )?;
        let mut metadata = Metadata {
            title: Some(title),
            author: None,
        };
        let mut cover = None;
        if u32be(h, 128)? & 64 != 0 {
            let start = 16 + header_len;
            if h.get(start..start + 4) != Some(b"EXTH") {
                return Err("Missing MOBI EXTH".into());
            }
            let len = u32be(h, start + 4)?;
            let entries = u32be(h, start + 8)?;
            if len < 12 || start + len > h.len() || entries > 10000 {
                return Err("Invalid MOBI EXTH bounds".into());
            }
            let mut pos = start + 12;
            let mut authors = Vec::new();
            for _ in 0..entries {
                let kind = u32be(h, pos)?;
                let len = u32be(h, pos + 4)?;
                if len < 8 || pos + len > start + u32be(h, start + 4)? {
                    return Err("Invalid MOBI EXTH entry".into());
                }
                let value = &h[pos + 8..pos + len];
                match kind {
                    100 => authors.push(decode(value, encoding)?),
                    503 => metadata.title = Some(decode(value, encoding)?),
                    201 => cover = Some(u32be(value, 0)?),
                    _ => {}
                }
                pos += len;
            }
            if !authors.is_empty() {
                metadata.author = Some(authors.join(", "));
            }
        }
        Ok(Self {
            first_image: u32be(h, 108)?,
            records,
            html: decode(&text, encoding)?,
            metadata,
            cover,
        })
    }
}
#[derive(Clone, Default)]
struct Context {
    style: Style,
    kind: Option<ParagraphKind>,
    link: Option<String>,
    centered: bool,
    large: bool,
    list: Option<ListContext>,
}
struct Builder<'a, 'b> {
    source: &'a Container<'b>,
    root: &'a Path,
    manifest: &'a mut Manifest,
    book: Publication,
    raw: Vec<RawSpan>,
    assets: BTreeMap<usize, String>,
    image_bytes: usize,
    pending_chapter: bool,
}
impl Builder<'_, '_> {
    fn flush(&mut self, c: &Context, id: Option<String>) -> Result<()> {
        let index = self.book.blocks.len();
        let heading = c.centered && c.large && self.raw.iter().any(|(_, s, _)| s.bold);
        let kind = if heading {
            ParagraphKind::Heading
        } else {
            c.kind.unwrap_or(ParagraphKind::Body)
        };
        self.book
            .append_paragraph(std::mem::take(&mut self.raw), kind, id, c.list.clone())?;
        if self.book.blocks.len() > index {
            if self.pending_chapter
                || matches!(kind, ParagraphKind::Heading | ParagraphKind::Subtitle)
            {
                self.book.mark(
                    index,
                    self.pending_chapter,
                    if matches!(kind, ParagraphKind::Heading | ParagraphKind::Subtitle) {
                        Some(1)
                    } else {
                        None
                    },
                );
            }
            self.pending_chapter = false;
        }
        Ok(())
    }
    fn image(&mut self, index: usize, cover: bool) -> Result<()> {
        let asset = if let Some(asset) = self.assets.get(&index) {
            asset.clone()
        } else {
            let b = self
                .source
                .records
                .get(
                    self.source
                        .first_image
                        .checked_add(index)
                        .ok_or("MOBI image index overflow")?,
                )
                .ok_or("Missing MOBI image record")?;
            self.image_bytes += b.len();
            if self.image_bytes > 128 * 1024 * 1024 || self.assets.len() >= 10000 {
                return Err("MOBI image budget exceeded".into());
            }
            let (data, ext) = if b.starts_with(b"GIF8") {
                let (w, h) = image::ImageReader::new(Cursor::new(b))
                    .with_guessed_format()?
                    .into_dimensions()?;
                if w == 0
                    || h == 0
                    || w > 16384
                    || h > 16384
                    || u64::from(w) * u64::from(h) > 32 * 1024 * 1024
                {
                    return Err("MOBI GIF geometry exceeds budget".into());
                }
                let image = image::load_from_memory_with_format(b, image::ImageFormat::Gif)?;
                let mut out = Cursor::new(Vec::new());
                image.write_to(&mut out, image::ImageFormat::Png)?;
                (out.into_inner(), "png")
            } else {
                images::decode(b)?;
                (
                    b.to_vec(),
                    if b.starts_with(b"\x89PNG") {
                        "png"
                    } else {
                        "jpg"
                    },
                )
            };
            let file = write_file(
                self.root,
                &format!("assets/images/{:06}.{ext}", self.assets.len() + 1),
                &data,
            )?;
            let asset = file.path.clone();
            self.manifest.assets.push(file);
            self.assets.insert(index, asset.clone());
            asset
        };
        self.book.blocks.push(Block::Image { asset, cover });
        Ok(())
    }
    fn walk(&mut self, tree: &Markup, node: usize, parent: &Context, depth: usize) -> Result<()> {
        if depth > 64 {
            return Err("MOBI HTML nesting exceeds 64".into());
        }
        let HtmlNode::Element(e) = &tree.nodes[node] else {
            return Ok(());
        };
        let tag = e.tag.as_str();
        let mut c = parent.clone();
        let is_block = matches!(
            tag,
            "html"
                | "body"
                | "div"
                | "p"
                | "blockquote"
                | "h1"
                | "h2"
                | "h3"
                | "h4"
                | "h5"
                | "h6"
                | "li"
                | "pre"
                | "center"
        );
        if matches!(tag, "head" | "script" | "style" | "guide") {
            return Ok(());
        }
        if matches!(
            tag,
            "table" | "svg" | "math" | "object" | "iframe" | "audio" | "video"
        ) {
            return Err(format!("Unsupported MOBI HTML content: {tag}").into());
        }
        if is_block {
            self.flush(parent, None)?;
        }
        if e.attr("align") == Some("center") || tag == "center" {
            c.centered = true;
        }
        match tag {
            "b" | "strong" => c.style.bold = true,
            "i" | "em" => c.style.italic = true,
            "sup" => {
                c.style.superscript = true;
                c.style.subscript = false;
            }
            "sub" => {
                c.style.subscript = true;
                c.style.superscript = false;
            }
            "font" => {
                c.large |= e
                    .attr("size")
                    .is_some_and(|s| s.starts_with('+') || s.parse::<i32>().is_ok_and(|n| n >= 4))
            }
            "blockquote" => {
                c.kind = Some(ParagraphKind::Quote);
                c.style.italic = true;
            }
            "pre" => c.kind = Some(ParagraphKind::Verse),
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                c.kind = Some(ParagraphKind::Heading);
                c.style.bold = true;
                if tag == "h1" {
                    self.pending_chapter = true;
                }
            }
            "a" => {
                c.link = e
                    .attr("href")
                    .map(str::to_owned)
                    .or_else(|| e.attr("filepos").map(|v| format!("mobi:filepos:{v}")))
            }
            "br" | "hr" => {
                self.flush(parent, None)?;
                if tag == "hr" {
                    self.book.blocks.push(Block::EmptyLine);
                }
                return Ok(());
            }
            "mbp:pagebreak" => {
                self.flush(parent, None)?;
                self.pending_chapter = true;
                return Ok(());
            }
            "img" => {
                self.flush(parent, None)?;
                let index = e
                    .attr("recindex")
                    .ok_or("MOBI image has no local recindex")?
                    .parse::<usize>()?
                    .checked_sub(1)
                    .ok_or("Invalid MOBI image recindex")?;
                // EXTH cover is published once even when the HTML also references it.
                if Some(index) != self.source.cover {
                    self.image(index, false)?;
                }
                return Ok(());
            }
            "ul" | "ol" => {
                self.flush(parent, None)?;
                let ordered = tag == "ol";
                let mut ordinal = e.attr("start").unwrap_or("1").parse::<usize>()?;
                for &item in &e.children {
                    let HtmlNode::Element(item_element) = &tree.nodes[item] else {
                        continue;
                    };
                    if item_element.tag != "li" {
                        continue;
                    }
                    ordinal = item_element
                        .attr("value")
                        .map(str::parse)
                        .transpose()?
                        .unwrap_or(ordinal);
                    let mut item_context = c.clone();
                    item_context.list = Some(ListContext {
                        ordered,
                        ordinal,
                        depth: parent.list.as_ref().map_or(0, |l| l.depth + 1),
                    });
                    self.walk(tree, item, &item_context, depth + 1)?;
                    ordinal = ordinal.checked_add(1).ok_or("MOBI list overflow")?;
                }
                return Ok(());
            }
            _ => {}
        }
        if tag == "li"
            && let Some(list) = &c.list
        {
            self.raw.push((
                if list.ordered {
                    format!("{}. ", list.ordinal)
                } else {
                    "• ".into()
                },
                c.style,
                None,
            ));
        }
        for &child in &e.children {
            match &tree.nodes[child] {
                HtmlNode::Text(text) => self.raw.push((text.clone(), c.style, c.link.clone())),
                HtmlNode::Element(_) => self.walk(tree, child, &c, depth + 1)?,
            }
        }
        if is_block {
            self.flush(&c, e.attr("id").map(str::to_owned))?;
        }
        Ok(())
    }
}
pub fn publish(path: &Path, root: &Path, manifest: &mut Manifest) -> Result<()> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(128 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 128 * 1024 * 1024 {
        return Err("MOBI source exceeds 128 MiB".into());
    }
    let source = Container::parse(&bytes)?;
    // Bound markup before HTML5 tree allocation, as well as the resulting tree.
    if source.html.bytes().filter(|&b| b == b'<').count() > 100_000 {
        return Err("MOBI HTML markup budget exceeded".into());
    }
    let html = Markup::parse(&source.html)?;
    let mut builder = Builder {
        source: &source,
        root,
        manifest,
        book: Publication {
            notes: vec![],
            note_references: vec![],
            schema_version: 1,
            text: String::new(),
            blocks: Vec::new(),
            metadata: source.metadata.clone(),
            structure: Vec::new(),
        },
        raw: Vec::new(),
        assets: BTreeMap::new(),
        image_bytes: 0,
        pending_chapter: false,
    };
    if let Some(index) = source.cover {
        builder.image(index, true)?;
    }
    builder.walk(&html, 0, &Context::default(), 0)?;
    builder.flush(&Context::default(), None)?;
    if builder.book.text.is_empty() {
        return Err("MOBI contains no manuscript text".into());
    }
    builder.manifest.metadata = Some(builder.book.metadata.clone());
    builder.manifest.assets.push(write_file(
        root,
        "publication.json",
        &serde_json::to_vec(&builder.book)?,
    )?);
    super::typography::publish_current(&builder.book, root, builder.manifest)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample(html: &str) -> Vec<u8> {
        let mut h = vec![0; 280];
        h.extend(b"Test");
        for (at, value) in [(0, 1u16), (8, 1), (10, 4096)] {
            h[at..at + 2].copy_from_slice(&value.to_be_bytes());
        }
        h[16..20].copy_from_slice(b"MOBI");
        for (at, value) in [
            (4, html.len() as u32),
            (20, 264),
            (28, 65001),
            (36, 6),
            (84, 280),
            (88, 4),
            (108, u32::MAX),
        ] {
            h[at..at + 4].copy_from_slice(&value.to_be_bytes());
        }
        let mut b = vec![0; 94];
        b[60..68].copy_from_slice(b"BOOKMOBI");
        b[76..78].copy_from_slice(&2u16.to_be_bytes());
        b[78..82].copy_from_slice(&94u32.to_be_bytes());
        b[86..90].copy_from_slice(&(94u32 + h.len() as u32).to_be_bytes());
        b.extend(h);
        b.extend(html.as_bytes());
        b
    }
    #[test]
    fn mobi_semantics_and_malformed_containers() {
        let bytes = sample(
            "<html><body><h1>Chapter</h1><p>A &amp; B <b>bold</b> H<sub>2</sub>O <sup>3</sup> ███<p>Second paragraph<ol><li>One<li>Two</ol><mbp:pagebreak/>After break<script>HIDDEN</script></body></html>",
        );
        let c = Container::parse(&bytes).unwrap();
        assert!(c.html.contains("Second paragraph"));
        for (offset, data) in [
            (78, 0u32.to_be_bytes().to_vec()),
            (94 + 4, u32::MAX.to_be_bytes().to_vec()),
            (94 + 36, 8u32.to_be_bytes().to_vec()),
            (94 + 12, 2u16.to_be_bytes().to_vec()),
            (94, 17480u16.to_be_bytes().to_vec()),
        ] {
            let mut bad = bytes.clone();
            bad[offset..offset + data.len()].copy_from_slice(&data);
            assert!(Container::parse(&bad).is_err());
        }
        for end in [0, 60, 77, 90, 110, bytes.len() - 1] {
            assert!(Container::parse(&bytes[..end]).is_err());
        }
        let temp = tempfile::tempdir().unwrap();
        let input = temp.path().join("test.mobi");
        std::fs::write(&input, &bytes).unwrap();
        let mut library = crate::library::Library::new(&temp.path().join("library")).unwrap();
        let imported = library.import_path(&input, None).unwrap();
        let payload = library
            .root
            .join("editions")
            .join(&imported.item.edition_id);
        let model: Publication =
            serde_json::from_slice(&std::fs::read(payload.join("publication.json")).unwrap())
                .unwrap();
        assert!(model.text.contains("A & B bold H2O 3 ███"));
        assert!(model.text.contains("Second paragraph"));
        assert!(!model.text.contains("HIDDEN"));
        assert!(model.text.contains("After break"));
        assert!(model.text.contains("1. One\n2. Two"));
        assert!(model.blocks.iter().any(|b| matches!(b,Block::Paragraph{spans,..} if spans.iter().any(|s|s.style.subscript && &model.text[s.start..s.end]=="2"))));
        let (doc, _) = crate::library::edition::resolve(
            &library.root,
            &imported.item.edition_id,
            &crate::reader::registry::FormatRegistry::default(),
        )
        .unwrap();
        let request = crate::reader::document::RenderRequest {
            width: 800,
            height: 1120,
        };
        let before = doc.render_page(0, request).unwrap().rgba;
        let manifest: Manifest =
            serde_json::from_slice(&std::fs::read(payload.join("manifest.json")).unwrap()).unwrap();
        let page = super::super::storage::read_layout(
            &payload,
            &manifest.page_files[0],
            manifest.storage_version,
        )
        .unwrap();
        assert!(
            page.items
                .iter()
                .any(|i| matches!(i, super::super::typography::Item::RasterGlyph { source_start, source_end, .. } if model.text[*source_start..*source_end].contains('█')))
        );
        assert!(library.import_path(&input, None).unwrap().duplicate);
        std::fs::remove_file(library.root.join(&manifest.source_path)).unwrap();
        drop(doc);
        drop(library);
        let library = crate::library::Library::new(&temp.path().join("library")).unwrap();
        let (doc, _) = crate::library::edition::resolve(
            &library.root,
            &imported.item.edition_id,
            &crate::reader::registry::FormatRegistry::default(),
        )
        .unwrap();
        assert_eq!(doc.render_page(0, request).unwrap().rgba, before);
    }
    #[test]
    fn bounded_palmdoc_and_trailers() {
        assert_eq!(palmdoc(b"abc\x80\x18\xc1", 20).unwrap(), b"abcabc A");
        for b in [b"\x80\x00".as_slice(), b"\x80", b"\x08abc", b"\x80\x18"] {
            assert!(palmdoc(b, 4096).is_err());
        }
        assert!(palmdoc(b"abcd", 3).is_err());
        assert_eq!(trim_record(b"abc\x00xx\x83", 3).unwrap(), b"abc");
        assert!(trim_record(b"\xff", 2).is_err());
        assert!(trim_record(b"\x00", 2).is_err());
        assert!(trim_record(b"\x03", 1).is_err());
    }
}
