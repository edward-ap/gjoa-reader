//! ZIP comics are materialized once; the reader opens the saved image edition.
use super::{
    cbr::{natural_cmp, page_name},
    images, write_file,
};
use crate::{
    library::{Result, edition::Manifest},
    reader::{
        document::PageInfo,
        format::{DocumentFormatHandler, FormatId, ProbeResult, PublicationKind},
    },
};
use std::{io::Read, path::Path};

pub const CBZ: FormatId = FormatId("cbz");
pub struct CbzFormatHandler;
impl DocumentFormatHandler for CbzFormatHandler {
    fn format_id(&self) -> FormatId {
        CBZ
    }
    fn filter_name(&self) -> &'static str {
        "CBZ comics"
    }
    fn supported_extensions(&self) -> &'static [&'static str] {
        &["cbz"]
    }
    fn publication_kind(&self) -> PublicationKind {
        PublicationKind::ExtractedImages
    }
    fn probe(&self, header: &[u8]) -> ProbeResult {
        if header.starts_with(b"PK\x03\x04") || header.starts_with(b"PK\x05\x06") {
            ProbeResult::Candidate
        } else {
            ProbeResult::NotMine
        }
    }
    fn probe_source(&self, path: &Path, _: &[u8]) -> crate::reader::document::Result<ProbeResult> {
        (|| -> Result<ProbeResult> {
            let mut archive = zip::ZipArchive::new(std::fs::File::open(path)?)?;
            // An EPUB can also contain hundreds of images. Its container wins.
            if archive.file_names().any(|n| n == "META-INF/container.xml") {
                return Ok(ProbeResult::NotMine);
            }
            if let Ok(entry) = archive.by_name("mimetype") {
                let mut bytes = Vec::new();
                entry.take(128).read_to_end(&mut bytes)?;
                if super::epub::is_mimetype(&bytes) {
                    return Ok(ProbeResult::NotMine);
                }
            }
            validate(&mut archive)?;
            for name in archive.file_names() {
                if comic_page(name)? {
                    return Ok(ProbeResult::Supported);
                }
            }
            Ok(ProbeResult::NotMine)
        })()
        .map_err(|e| format!("Invalid ZIP/CBZ: {e}"))
    }
}
fn comic_page(name: &str) -> Result<bool> {
    // Share CBR path/hidden-file rules, including the extra raster formats.
    if page_name(name)? {
        return Ok(true);
    }
    let name = name.replace('\\', "/");
    if name
        .split('/')
        .any(|p| p.starts_with('.') || p == "__MACOSX")
    {
        return Ok(false);
    }
    Ok(Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("webp") || e.eq_ignore_ascii_case("bmp")))
}
fn validate(archive: &mut zip::ZipArchive<std::fs::File>) -> Result<()> {
    if archive.len() > 10_000 {
        return Err("CBZ exceeds 10000 entries".into());
    }
    let mut total = 0u64;
    let mut names = std::collections::HashSet::new();
    for index in 0..archive.len() {
        crate::import_cancel::check()?;
        let entry = archive.by_index(index)?;
        comic_page(entry.name())?;
        if entry.name().len() > 2048
            || !names.insert(entry.name().replace('\\', "/"))
            || entry.is_symlink()
            || entry.encrypted()
        {
            return Err("Unsafe, duplicate or encrypted CBZ member".into());
        }
        total = total.checked_add(entry.size()).ok_or("CBZ size overflow")?;
        if entry.size() > images::MAX_IMAGE_BYTES || total > 512 * 1024 * 1024 {
            return Err("CBZ exceeds 64 MiB per entry / 512 MiB unpacked".into());
        }
    }
    Ok(())
}
pub fn publish(path: &Path, root: &Path, manifest: &mut Manifest) -> Result<()> {
    let mut archive = zip::ZipArchive::new(std::fs::File::open(path)?)?;
    validate(&mut archive)?;
    let mut names = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index(index)?;
        if entry.is_file() && comic_page(entry.name())? {
            names.push(entry.name().to_owned());
        }
    }
    names.sort_by(|a, b| natural_cmp(a, b).then(a.cmp(b)));
    if names.is_empty() {
        return Err("CBZ contains no JPEG/PNG/WebP/BMP pages".into());
    }
    for (index, name) in names.iter().enumerate() {
        crate::import_cancel::check()?;
        let entry = archive.by_name(name)?;
        let expected = entry.size();
        let mut bytes = Vec::new();
        entry
            .take(images::MAX_IMAGE_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 != expected || bytes.len() as u64 > images::MAX_IMAGE_BYTES {
            return Err("CBZ entry length exceeds budget or differs from header".into());
        }
        let decoded =
            images::decode(&bytes).map_err(|e| format!("Invalid CBZ page {name}: {e}"))?;
        manifest.pages.push(PageInfo {
            width: decoded.width(),
            height: decoded.height(),
            dpi: None,
        });
        drop(decoded);
        let ext = images::extension(&bytes)?;
        manifest.page_files.push(write_file(
            root,
            &format!("pages/{:06}.{ext}", index + 1),
            &bytes,
        )?);
    }
    manifest.assets.push(write_file(
        root,
        "page-order.json",
        &serde_json::to_vec_pretty(&names)?,
    )?);
    Ok(())
}
