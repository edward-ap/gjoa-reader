use super::{images, write_file};
use crate::{
    library::{Result, edition::Manifest},
    reader::document::PageInfo,
};
use std::{cmp::Ordering, path::Path};

/// Numeric segments are compared by magnitude without parsing into a bounded integer.
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let a = a.to_lowercase();
    let b = b.to_lowercase();
    let mut ai = a.as_bytes();
    let mut bi = b.as_bytes();
    while !ai.is_empty() && !bi.is_empty() {
        if ai[0].is_ascii_digit() && bi[0].is_ascii_digit() {
            let an = ai.iter().take_while(|c| c.is_ascii_digit()).count();
            let bn = bi.iter().take_while(|c| c.is_ascii_digit()).count();
            let aa = &ai[..an];
            let bb = &bi[..bn];
            let az = aa.iter().position(|c| *c != b'0').unwrap_or(aa.len());
            let bz = bb.iter().position(|c| *c != b'0').unwrap_or(bb.len());
            let order = (aa.len() - az)
                .cmp(&(bb.len() - bz))
                .then_with(|| aa[az..].cmp(&bb[bz..]))
                .then(an.cmp(&bn));
            if order != Ordering::Equal {
                return order;
            }
            ai = &ai[an..];
            bi = &bi[bn..];
        } else {
            let order = ai[0].cmp(&bi[0]);
            if order != Ordering::Equal {
                return order;
            }
            ai = &ai[1..];
            bi = &bi[1..];
        }
    }
    ai.len().cmp(&bi.len())
}
pub fn page_name(name: &str) -> Result<bool> {
    let name = name.replace('\\', "/");
    if name.starts_with('/')
        || name.contains(':')
        || name.chars().any(char::is_control)
        || name.split('/').any(|s| s == "..")
    {
        return Err("Unsafe archive entry name".into());
    }
    if name
        .split('/')
        .any(|part| part.starts_with('.') || part == "__MACOSX")
    {
        return Ok(false);
    }
    Ok(matches!(
        Path::new(&name)
            .extension()
            .and_then(|s| s.to_str())
            .map(str::to_lowercase)
            .as_deref(),
        Some("jpg" | "jpeg" | "png")
    ))
}
pub fn publish(path: &Path, root: &Path, manifest: &mut Manifest) -> Result<()> {
    let mut archive = unrar::Archive::new(path).open_for_processing()?;
    let mut entries = Vec::new();
    let mut total = 0u64;
    let mut count = 0;
    while let Some(header) = archive.read_header()? {
        count += 1;
        if count > 10_000 {
            return Err("CBR exceeds 10000 entries".into());
        }
        let entry = header.entry();
        let name = entry.filename.to_string_lossy().replace('\\', "/");
        if entry.is_encrypted() || entry.is_split() {
            return Err("Encrypted and multi-volume CBR archives are unsupported".into());
        }
        let selected = page_name(&name)? && entry.is_file();
        if entry.unpacked_size > images::MAX_IMAGE_BYTES {
            return Err("CBR entry exceeds 64 MiB".into());
        }
        total = total
            .checked_add(entry.unpacked_size)
            .ok_or("CBR size overflow")?;
        if total > 512 * 1024 * 1024 {
            return Err("CBR unpacked contents exceed 512 MiB".into());
        }
        if !selected {
            archive = header.skip()?;
            continue;
        }
        // Never pass an archive member's path to the extractor or the filesystem.
        let expected = entry.unpacked_size;
        let (bytes, next) = header.read()?;
        archive = next;
        if bytes.len() as u64 != expected {
            return Err("CBR entry length mismatch".into());
        }
        let decoded = images::decode(&bytes)?;
        let info = PageInfo {
            width: decoded.width(),
            height: decoded.height(),
            dpi: None,
        };
        drop(decoded);
        let extension = if bytes.starts_with(b"\x89PNG") {
            "png"
        } else {
            "jpg"
        };
        let temporary = format!("unpacked/{:06}.{extension}", entries.len() + 1);
        let file = write_file(root, &temporary, &bytes)?;
        entries.push((name, file, info, extension));
    }
    if entries.is_empty() {
        return Err("CBR contains no readable JPEG/PNG pages".into());
    }
    entries.sort_by(|a, b| natural_cmp(&a.0, &b.0).then(a.0.cmp(&b.0)));
    let order: Vec<_> = entries.iter().map(|e| e.0.clone()).collect();
    std::fs::create_dir(root.join("pages"))?;
    for (index, (_, mut file, info, extension)) in entries.into_iter().enumerate() {
        let destination = format!("pages/{:06}.{extension}", index + 1);
        std::fs::rename(root.join(&file.path), root.join(&destination))?;
        file.path = destination;
        manifest.page_files.push(file);
        manifest.pages.push(info);
    }
    std::fs::remove_dir(root.join("unpacked"))?;
    manifest.assets.push(write_file(
        root,
        "page-order.json",
        &serde_json::to_vec_pretty(&order)?,
    )?);
    Ok(())
}
