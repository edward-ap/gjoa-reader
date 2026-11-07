//! EPUB container/spine/XHTML semantics. Author CSS, fonts and scripts are never run.
use super::{
    Metadata,
    model::{Block, ListContext, ParagraphKind, Publication, RawSpan, Style},
    write_file,
};
use crate::{
    library::{Result, edition::Manifest},
    reader::format::{DocumentFormatHandler, FormatId, ProbeResult, PublicationKind},
};
use std::{
    collections::{BTreeMap, HashSet},
    io::{Cursor, Read},
    path::Path,
};
pub const EPUB: FormatId = FormatId("epub");
pub struct EpubFormatHandler;
impl DocumentFormatHandler for EpubFormatHandler {
    fn format_id(&self) -> FormatId {
        EPUB
    }
    fn filter_name(&self) -> &'static str {
        "EPUB books"
    }
    fn supported_extensions(&self) -> &'static [&'static str] {
        &["epub"]
    }
    fn publication_kind(&self) -> PublicationKind {
        PublicationKind::GeneratedLayout
    }
    fn probe(&self, header: &[u8]) -> ProbeResult {
        if header.starts_with(b"PK\x03\x04") {
            ProbeResult::Candidate
        } else {
            ProbeResult::NotMine
        }
    }
    fn probe_source(
        &self,
        path: &Path,
        _header: &[u8],
    ) -> crate::reader::document::Result<ProbeResult> {
        match Archive::open(path).and_then(|mut a| a.read("mimetype", 128)) {
            Ok(bytes) if is_mimetype(&bytes) => Ok(ProbeResult::Supported),
            _ => Ok(ProbeResult::NotMine),
        }
    }
}
pub(super) fn is_mimetype(bytes: &[u8]) -> bool {
    // Some older converters write a line ending into this otherwise exact marker.
    // Use the same tolerance for recognition, publication and ZIP/comic routing.
    bytes.trim_ascii() == b"application/epub+zip"
}
struct Archive {
    zip: zip::ZipArchive<std::fs::File>,
    names: HashSet<String>,
    read_bytes: u64,
}
impl Archive {
    fn open(path: &Path) -> Result<Self> {
        let mut zip = zip::ZipArchive::new(std::fs::File::open(path)?)?;
        if zip.len() > 10_000 {
            return Err("EPUB exceeds 10000 ZIP members".into());
        }
        let mut names = HashSet::new();
        let mut total = 0u64;
        for index in 0..zip.len() {
            let entry = zip.by_index(index)?;
            let name = entry.name();
            if name.len() > 2048
                || name.starts_with('/')
                || name.contains(['\\', ':'])
                || name.chars().any(char::is_control)
                || name.split('/').any(|p| p == "..")
                || !names.insert(name.to_owned())
            {
                return Err("Unsafe or duplicate EPUB ZIP member".into());
            }
            total = total
                .checked_add(entry.size())
                .ok_or("EPUB size overflow")?;
            if entry.size() > 64 * 1024 * 1024 || total > 512 * 1024 * 1024 {
                return Err("EPUB unpacked size budget exceeded".into());
            }
        }
        Ok(Self {
            zip,
            names,
            read_bytes: 0,
        })
    }
    fn read(&mut self, name: &str, limit: u64) -> Result<Vec<u8>> {
        let mut entry = self.zip.by_name(name)?;
        if entry.size() > limit {
            return Err(format!("EPUB resource exceeds limit: {name}").into());
        }
        let mut bytes = vec![];
        (&mut entry).take(limit + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > limit {
            return Err("EPUB resource exceeds read budget".into());
        }
        self.read_bytes += bytes.len() as u64;
        if self.read_bytes > 512 * 1024 * 1024 {
            return Err("EPUB total read budget exceeded".into());
        }
        Ok(bytes)
    }
}
/// Resolve publication URLs within the virtual ZIP root, never filesystem paths.
fn resource(base: &str, href: &str) -> Result<String> {
    let raw = href.split(['#', '?']).next().unwrap_or_default();
    if raw.is_empty() {
        return Ok(base.to_owned());
    }
    let mut decoded = vec![];
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() {
                return Err("Invalid EPUB URL escape".into());
            }
            decoded.push(u8::from_str_radix(
                std::str::from_utf8(&bytes[i + 1..i + 3])?,
                16,
            )?);
            i += 3;
        } else {
            decoded.push(bytes[i]);
            i += 1;
        }
    }
    let value = String::from_utf8(decoded)?;
    if value.starts_with('/') || value.contains(['\\', ':']) || value.chars().any(char::is_control)
    {
        return Err("External or unsafe EPUB resource URL".into());
    }
    let mut parts = base
        .rsplit_once('/')
        .map(|(p, _)| p.split('/').map(str::to_owned).collect::<Vec<_>>())
        .unwrap_or_default();
    for part in value.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop().ok_or("EPUB resource escapes ZIP root")?;
            }
            _ => parts.push(part.into()),
        }
    }
    Ok(parts.join("/"))
}
fn xml(bytes: &[u8]) -> Result<roxmltree::Document<'_>> {
    let source = std::str::from_utf8(bytes)?;
    // EPUB 2 XHTML commonly declares a public DTD. Accept the declaration only;
    // internal subsets stay forbidden and no external entity resolver is installed.
    for token in xmlparser::Tokenizer::from(source) {
        match token? {
            xmlparser::Token::DtdStart { .. } => {
                return Err("EPUB internal DTD subsets are unsupported".into());
            }
            xmlparser::Token::ElementStart { .. } => break,
            _ => {}
        }
    }
    Ok(roxmltree::Document::parse_with_options(
        source,
        roxmltree::ParsingOptions {
            allow_dtd: true,
            nodes_limit: 250_000,
            ..Default::default()
        },
    )?)
}
fn name<'a, 'b>(node: roxmltree::Node<'a, 'b>) -> &'b str {
    node.tag_name().name()
}
fn text(node: roxmltree::Node<'_, '_>) -> String {
    node.descendants()
        .filter(|n| n.is_text())
        .filter_map(|n| n.text())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}
fn block(node: roxmltree::Node<'_, '_>) -> bool {
    matches!(
        name(node),
        "body"
            | "div"
            | "section"
            | "article"
            | "main"
            | "header"
            | "footer"
            | "aside"
            | "nav"
            | "p"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "blockquote"
            | "ul"
            | "ol"
            | "li"
            | "figure"
            | "figcaption"
            | "pre"
            | "hr"
    )
}
struct Xhtml<'a> {
    book: &'a mut Publication,
    archive: &'a mut Archive,
    manifest: &'a mut Manifest,
    root: &'a Path,
    base: String,
    images: &'a mut BTreeMap<String, String>,
    cover: Option<String>,
    image_bytes: &'a mut usize,
    note_targets: &'a mut HashSet<String>,
    heading_targets: &'a mut BTreeMap<String, usize>,
    has_h1: bool,
}
impl Xhtml<'_> {
    fn image(&mut self, href: &str) -> Result<()> {
        let path = resource(&self.base, href)?;
        let asset = if let Some(asset) = self.images.get(&path) {
            asset.clone()
        } else {
            let bytes = self.archive.read(&path, 64 * 1024 * 1024)?;
            *self.image_bytes += bytes.len();
            if *self.image_bytes > 128 * 1024 * 1024 {
                return Err("EPUB image budget exceeded".into());
            }
            let (bytes, extension) = if bytes.starts_with(b"GIF8") {
                // Canonical publications represent a GIF by its first frame.
                let reader = image::ImageReader::new(Cursor::new(&bytes)).with_guessed_format()?;
                let (w, h) = reader.into_dimensions()?;
                if w == 0
                    || h == 0
                    || w > 16384
                    || h > 16384
                    || u64::from(w) * u64::from(h) > 32 * 1024 * 1024
                {
                    return Err("EPUB GIF geometry exceeds budget".into());
                }
                let decoded = image::load_from_memory_with_format(&bytes, image::ImageFormat::Gif)?;
                let mut png = Cursor::new(vec![]);
                decoded.write_to(&mut png, image::ImageFormat::Png)?;
                (png.into_inner(), "png")
            } else {
                super::images::decode(&bytes)?;
                let extension = if bytes.starts_with(b"\x89PNG") {
                    "png"
                } else {
                    "jpg"
                };
                (bytes, extension)
            };
            let record = write_file(
                self.root,
                &format!("assets/images/{:06}.{extension}", self.images.len() + 1),
                &bytes,
            )?;
            self.images.insert(path.clone(), record.path.clone());
            let asset = record.path.clone();
            self.manifest.assets.push(record);
            asset
        };
        let cover = self.book.blocks.is_empty() && self.cover.as_deref() == Some(&path);
        self.book.blocks.push(Block::Image { asset, cover });
        Ok(())
    }
    fn flush(
        &mut self,
        raw: &mut Vec<RawSpan>,
        kind: ParagraphKind,
        id: Option<String>,
        list: Option<ListContext>,
    ) -> Result<()> {
        if !raw.is_empty() {
            self.book
                .append_paragraph(std::mem::take(raw), kind, id, list)?;
        }
        Ok(())
    }
    fn walk(
        &mut self,
        node: roxmltree::Node<'_, '_>,
        mut style: Style,
        mut link: Option<String>,
        mut kind: ParagraphKind,
        raw: &mut Vec<RawSpan>,
        list: Option<ListContext>,
    ) -> Result<()> {
        if node.is_text() {
            raw.push((node.text().unwrap_or_default().into(), style, link));
            return Ok(());
        }
        if !node.is_element() {
            return Ok(());
        }
        let tag = name(node);
        let id = node.attribute("id").map(|id| format!("{}#{id}", self.base));
        match tag {
            "script" | "style" | "head" => return Ok(()),
            "iframe" | "object" | "embed" | "audio" | "video" | "canvas" | "math" | "table" => {
                return Err(format!("Unsupported EPUB content: {tag}").into());
            }
            "img" | "image" => {
                self.flush(raw, kind, id.clone(), list)?;
                let href = node
                    .attribute("src")
                    .or_else(|| {
                        node.attributes()
                            .find(|a| a.name() == "href")
                            .map(|a| a.value())
                    })
                    .ok_or("EPUB image without source")?;
                return self.image(href);
            }
            "svg" => {
                self.flush(raw, kind, id, list)?;
                // The supplied SVG covers are wrappers around a single embedded raster.
                for child in node.children().filter(|n| n.is_element()) {
                    if name(child) != "image" {
                        return Err("Only raster-image SVG wrappers are supported".into());
                    }
                    self.walk(child, style, link.clone(), kind, raw, None)?;
                }
                return Ok(());
            }
            "br" | "hr" => {
                self.flush(raw, kind, id, list)?;
                if tag == "hr" {
                    self.book.blocks.push(Block::EmptyLine);
                }
                return Ok(());
            }
            "b" | "strong" => style.bold = true,
            "i" | "em" => style.italic = true,
            "sup" => {
                style.superscript = true;
                style.subscript = false;
            }
            "sub" => {
                style.subscript = true;
                style.superscript = false;
            }
            "a" => {
                if (node.descendants().any(|n| n.has_tag_name("sup"))
                    || node.attributes().any(|a| {
                        a.name() == "type" && a.value().split_whitespace().any(|v| v == "noteref")
                    }))
                    && let Some(href) = node.attribute("href")
                    && let Some((path, fragment)) = href.split_once('#')
                    && let Ok(path) = if path.is_empty() {
                        Ok(self.base.clone())
                    } else {
                        resource(&self.base, path)
                    }
                {
                    self.note_targets.insert(format!("{path}#{fragment}"));
                }
                link = node.attribute("href").map(|v| {
                    if v.starts_with('#') {
                        format!("{}{v}", self.base)
                    } else {
                        v.into()
                    }
                });
            }
            "h1" | "h2" => {
                kind = ParagraphKind::Heading;
                style.bold = true;
            }
            "h3" | "h4" | "h5" | "h6" => {
                kind = ParagraphKind::Subtitle;
                style.bold = true;
            }
            "blockquote" => {
                kind = ParagraphKind::Quote;
                style.italic = true;
            }
            "figcaption" => {
                kind = ParagraphKind::Author;
                style.italic = true;
            }
            "pre" => kind = ParagraphKind::Verse,
            "ul" | "ol" => {
                self.flush(raw, kind, id, list.clone())?;
                let ordered = tag == "ol";
                let start = node.attribute("start").unwrap_or("1").parse::<usize>()?;
                for (i, child) in node.children().filter(|n| n.has_tag_name("li")).enumerate() {
                    let ordinal = child
                        .attribute("value")
                        .map(str::parse::<usize>)
                        .transpose()?
                        .unwrap_or(start.checked_add(i).ok_or("List ordinal overflow")?);
                    let context = ListContext {
                        ordered,
                        ordinal,
                        depth: list.as_ref().map(|l| l.depth + 1).unwrap_or(0),
                    };
                    let marker = if ordered {
                        format!("{ordinal}. ")
                    } else {
                        "• ".into()
                    };
                    let mut item = vec![(marker, style, None)];
                    for child in child.children() {
                        self.walk(
                            child,
                            style,
                            link.clone(),
                            ParagraphKind::Body,
                            &mut item,
                            Some(context.clone()),
                        )?;
                    }
                    self.flush(&mut item, ParagraphKind::Body, None, Some(context))?;
                }
                return Ok(());
            }
            "span" | "samp" | "small" | "code" | "u" | "s" | "del" | "ins" | "abbr" | "cite"
            | "q" | "mark" | "html" | "body" | "div" | "section" | "article" | "main"
            | "header" | "footer" | "aside" | "nav" | "p" | "li" | "figure" => {}
            _ => return Err(format!("Unsupported EPUB XHTML element: {tag}").into()),
        }
        let is_block = block(node);
        if is_block {
            self.flush(raw, ParagraphKind::Body, None, list.clone())?;
            let first = self.book.blocks.len();
            let mut own = vec![];
            for child in node.children() {
                self.walk(child, style, link.clone(), kind, &mut own, list.clone())?;
            }
            self.flush(&mut own, kind, id, list)?;
            if matches!(tag, "h1" | "h2" | "h3" | "h4" | "h5" | "h6")
                && self.book.blocks.len() > first
            {
                let level = tag.as_bytes()[1] - b'0';
                // A split spine resource is not necessarily a chapter. Use its highest
                // actual heading level; h2 is chapter-level only in documents without h1.
                let chapter = level == 1 || (level == 2 && !self.has_h1);
                self.book.mark(first, chapter, Some(level));
                if let Some(id) = node.attribute("id") {
                    self.heading_targets
                        .insert(format!("{}#{id}", self.base), first);
                }
            }
        } else {
            for child in node.children() {
                self.walk(child, style, link.clone(), kind, raw, list.clone())?;
            }
        }
        Ok(())
    }
}
#[cfg(test)]
thread_local! {pub static PARSES:std::cell::Cell<usize>=const{std::cell::Cell::new(0)};}
pub fn publish(path: &Path, root: &Path, manifest: &mut Manifest) -> Result<()> {
    #[cfg(test)]
    PARSES.with(|n| n.set(n.get() + 1));
    let mut archive = Archive::open(path)?;
    if !is_mimetype(&archive.read("mimetype", 128)?) {
        return Err("Not an EPUB container".into());
    }
    if archive.names.contains("META-INF/encryption.xml") {
        return Err("Encrypted/obfuscated EPUB resources are unsupported".into());
    }
    let container = archive.read("META-INF/container.xml", 64 * 1024)?;
    let container = xml(&container)?;
    let opf = container
        .descendants()
        .find(|n| n.has_tag_name("rootfile"))
        .and_then(|n| n.attribute("full-path"))
        .ok_or("EPUB container has no rootfile")?;
    let opf = resource("", opf)?;
    let package = archive.read(&opf, 2 * 1024 * 1024)?;
    let package = xml(&package)?;
    let root_element = package.root_element();
    if name(root_element) != "package" {
        return Err("Invalid EPUB package".into());
    }
    let metadata = root_element
        .children()
        .find(|n| n.has_tag_name("metadata"))
        .ok_or("Missing EPUB metadata")?;
    let title = metadata
        .children()
        .find(|n| n.has_tag_name("title"))
        .map(text)
        .filter(|s| !s.is_empty());
    let author = metadata
        .children()
        .filter(|n| n.has_tag_name("creator"))
        .map(text)
        .collect::<Vec<_>>()
        .join(", ");
    let metadata_value = Metadata {
        title,
        author: if author.is_empty() {
            None
        } else {
            Some(author)
        },
    };
    let mut items = BTreeMap::new();
    let mut cover = None;
    let cover_id = metadata
        .children()
        .find(|n| n.attribute("name") == Some("cover"))
        .and_then(|n| n.attribute("content"));
    for item in root_element
        .children()
        .find(|n| n.has_tag_name("manifest"))
        .ok_or("Missing EPUB manifest")?
        .children()
        .filter(|n| n.has_tag_name("item"))
    {
        let id = item
            .attribute("id")
            .ok_or("EPUB manifest item without ID")?;
        let href = resource(
            &opf,
            item.attribute("href").ok_or("EPUB item without href")?,
        )?;
        let media = item
            .attribute("media-type")
            .ok_or("EPUB item without media type")?
            .to_owned();
        if Some(id) == cover_id
            || item
                .attribute("properties")
                .is_some_and(|p| p.split_whitespace().any(|p| p == "cover-image"))
        {
            cover = Some(href.clone());
        }
        if items.insert(id, (href, media)).is_some() {
            return Err("Duplicate EPUB manifest ID".into());
        }
    }
    let spine = root_element
        .children()
        .find(|n| n.has_tag_name("spine"))
        .ok_or("Missing EPUB spine")?;

    let mut book = Publication {
        notes: vec![],
        note_references: vec![],
        structure: vec![],
        schema_version: 1,
        text: String::new(),
        blocks: vec![],
        metadata: metadata_value.clone(),
    };
    let mut images = BTreeMap::new();
    let mut image_bytes = 0;
    let mut note_targets = HashSet::new();
    let mut heading_targets = BTreeMap::new();
    let mut sections = 0;
    for item in spine.children().filter(|n| n.has_tag_name("itemref")) {
        sections += 1;
        if sections > 2000 {
            return Err("EPUB spine exceeds 2000 resources".into());
        }
        let (path, media) = items
            .get(item.attribute("idref").ok_or("Missing spine idref")?)
            .ok_or("Unresolved EPUB spine item")?;
        if !matches!(media.as_str(), "application/xhtml+xml" | "text/html") {
            return Err("EPUB spine requires XHTML".into());
        }
        let bytes = archive.read(path, 8 * 1024 * 1024)?;
        let doc = xml(&bytes)?;
        if doc
            .descendants()
            .any(|n| n.ancestors().take(66).count() > 64)
        {
            return Err("EPUB XHTML nesting exceeds 64".into());
        }
        let body = doc
            .descendants()
            .find(|n| n.has_tag_name("body"))
            .ok_or("EPUB XHTML has no body")?;
        let mut parser = Xhtml {
            book: &mut book,
            archive: &mut archive,
            manifest,
            root,
            base: path.clone(),
            images: &mut images,
            cover: cover.clone(),
            image_bytes: &mut image_bytes,
            note_targets: &mut note_targets,
            heading_targets: &mut heading_targets,
            has_h1: doc.descendants().any(|n| n.has_tag_name("h1")),
        };
        parser.walk(
            body,
            Style::default(),
            None,
            ParagraphKind::Body,
            &mut vec![],
            None,
        )?;
    }
    if sections == 0 || book.text.is_empty() {
        return Err("EPUB has no readable spine content".into());
    }
    // A heading targeted by a superscript note reference is a note label, even
    // when a converter exported it as h1 in its own spine file.
    for target in &note_targets {
        if let Some(index) = heading_targets.get(target)
            && let Some(s) = book.structure.iter_mut().find(|s| s.block == *index)
        {
            s.chapter = false;
        }
    }
    manifest.metadata = Some(metadata_value);
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

    #[test]
    fn epub_mimetype_tolerance_is_limited_to_surrounding_ascii_whitespace() {
        for bytes in [
            b"application/epub+zip".as_slice(),
            b"application/epub+zip\n",
            b" \tapplication/epub+zip\r\n",
        ] {
            assert!(is_mimetype(bytes));
        }
        for bytes in [
            b"application/epub+zip-extra".as_slice(),
            b"application/epub+zip\0",
            b"application/epub +zip",
            b"application/zip",
            b"",
        ] {
            assert!(!is_mimetype(bytes));
        }
    }

    #[test]
    fn epub_doctype_never_resolves_external_resources_or_allows_internal_subsets() {
        for declaration in [
            "<!DOCTYPE html>",
            "<!DOCTYPE html SYSTEM 'file:///nonexistent-epub.dtd'>",
            "<!DOCTYPE html PUBLIC '-//W3C//DTD XHTML 1.1//EN' 'http://www.w3.org/TR/xhtml11/DTD/xhtml11.dtd'>",
        ] {
            let source = format!("{declaration}<html><body><p>Text &amp; more</p></body></html>");
            assert!(xml(source.as_bytes()).is_ok());
        }
        for declaration in [
            "<!DOCTYPE html [<!ENTITY local 'expanded'>]>",
            "<!DOCTYPE html [<!ENTITY secret SYSTEM 'file:///secret'>]>",
            "<!DOCTYPE html SYSTEM 'http://example.invalid/epub.dtd' []>",
        ] {
            let source = format!("{declaration}<html><body><p>Text</p></body></html>");
            assert!(
                xml(source.as_bytes())
                    .unwrap_err()
                    .to_string()
                    .contains("internal DTD")
            );
        }
        assert!(
            xml(b"<!DOCTYPE html SYSTEM 'file:///nonexistent-epub.dtd'><html>&unknown;</html>")
                .is_err()
        );
    }
}
