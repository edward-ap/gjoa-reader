//! Physical representation only: publication identity/profile/pagination remain v1.
use super::{
    FileRecord, layout_codec, read_file,
    typography::{PageLayout, fonts_for_profile},
    write_file,
};
use crate::library::{
    Result,
    edition::Manifest,
    store::{checked_path, directory, hash_reader},
};
use std::{
    io::Write,
    path::{Path, PathBuf},
};

pub fn version_one() -> u32 {
    1
}
pub fn is_version_one(version: &u32) -> bool {
    *version == 1
}

pub fn validate_version(manifest: &Manifest) -> Result<()> {
    match manifest.storage_version {
        1 if manifest.shared_fonts.is_empty() => Ok(()),
        2..=4
            if manifest.kind == "generated-layout"
                && manifest.shared_fonts.len()
                    == fonts_for_profile(manifest.profile_id.as_deref())?.len() =>
        {
            Ok(())
        }
        _ => Err("Unsupported edition storage version/font table".into()),
    }
}

pub fn read_layout(root: &Path, file: &FileRecord, version: u32) -> Result<PageLayout> {
    let bytes = read_file(root, file, layout_codec::MAX_BYTES)?;
    match version {
        1 => Ok(serde_json::from_slice(&bytes)?),
        2..=4 => layout_codec::decode_version(&bytes, version),
        _ => Err("Unsupported page storage version".into()),
    }
}

pub fn shared_font(root: &Path, file: &FileRecord, expected: &[u8]) -> Result<Vec<u8>> {
    let hash = hash_reader(expected)?;
    if file.sha256 != hash
        || file.path != format!("fonts/{hash}")
        || file.bytes != expected.len() as u64
    {
        return Err("Shared font differs from canonical profile".into());
    }
    read_file(root, file, expected.len() as u64)
}

/// Called only for private staging while the Library's exclusive lock is held.
pub fn compact(
    root: &Path,
    manifest: &mut Manifest,
    library: &Path,
    installed_fonts: &mut Vec<PathBuf>,
) -> Result<()> {
    if manifest.kind != "generated-layout" {
        return Ok(());
    }
    validate_version(manifest)?;
    if manifest.storage_version != 1 {
        return Ok(());
    }
    let mut pages = Vec::with_capacity(manifest.page_files.len());
    for (index, file) in manifest.page_files.iter().enumerate() {
        crate::import_cancel::check()?;
        let page = read_layout(root, file, 1)?;
        let bytes = layout_codec::encode_version(
            &page,
            if manifest.publisher_version >= 4 {
                4
            } else if manifest.publisher_version >= 3 {
                3
            } else {
                2
            },
        )?;
        pages.push(write_file(
            root,
            &format!("pages/{:06}.rpg", index + 1),
            &bytes,
        )?);
        let old_page = checked_path(root, &file.path)?;
        std::fs::remove_file(&old_page).map_err(|e| {
            crate::library::store::io_context("Remove staged JSON page", &old_page, e)
        })?;
    }
    directory(library, "fonts")?;
    let mut shared = Vec::new();
    let fonts = fonts_for_profile(manifest.profile_id.as_deref())?;
    for (index, expected) in fonts.iter().enumerate() {
        let path = format!("assets/fonts/{index}.ttf");
        let file = manifest
            .assets
            .iter()
            .find(|r| r.path == path)
            .ok_or("Missing staged font")?;
        let bytes = read_file(root, file, expected.len() as u64)?;
        if bytes != *expected {
            return Err("Staged font differs from canonical profile".into());
        }
        let record = FileRecord {
            path: format!("fonts/{}", file.sha256),
            sha256: file.sha256.clone(),
            bytes: file.bytes,
        };
        let target = checked_path(library, &record.path)?;
        if target.exists() {
            shared_font(library, &record, expected)?;
        } else {
            let mut temp = tempfile::NamedTempFile::new_in(checked_path(library, "fonts")?)?;
            temp.write_all(&bytes)?;
            temp.as_file().sync_all()?;
            temp.persist_noclobber(&target).map_err(|e| {
                crate::library::store::io_context("Install shared font", &target, e.error)
            })?;
            installed_fonts.push(target);
        }
        let staged_font = checked_path(root, &path)?;
        std::fs::remove_file(&staged_font).map_err(|e| {
            crate::library::store::io_context("Remove staged font", &staged_font, e)
        })?;
        shared.push(record);
    }
    manifest
        .assets
        .retain(|r| !(0..fonts.len()).any(|i| r.path == format!("assets/fonts/{i}.ttf")));
    manifest.page_files = pages;
    manifest.shared_fonts = shared;
    manifest.storage_version = if manifest.publisher_version >= 4 {
        4
    } else if manifest.publisher_version >= 3 {
        3
    } else {
        2
    };
    let mut file = std::fs::File::create(checked_path(root, "manifest.json")?)?;
    file.write_all(&serde_json::to_vec_pretty(manifest)?)?;
    file.sync_all()?;
    Ok(())
}

/// Reconstruct the exact v1 manifest for semantic regression/golden comparisons.
pub fn legacy_manifest(root: &Path, manifest: &Manifest) -> Result<Manifest> {
    validate_version(manifest)?;
    let mut legacy = manifest.clone();
    if legacy.storage_version == 1 {
        return Ok(legacy);
    }
    for (index, file) in legacy.page_files.iter_mut().enumerate() {
        let bytes = serde_json::to_vec(&read_layout(root, file, manifest.storage_version)?)?;
        *file = FileRecord {
            path: format!("pages/{:06}.json", index + 1),
            sha256: hash_reader(bytes.as_slice())?,
            bytes: bytes.len() as u64,
        };
    }
    let position = legacy
        .assets
        .iter()
        .position(|r| r.path == "assets/fonts/OFL.txt")
        .ok_or("Missing font license")?;
    let fonts = legacy
        .shared_fonts
        .iter()
        .enumerate()
        .map(|(i, r)| FileRecord {
            path: format!("assets/fonts/{i}.ttf"),
            ..r.clone()
        })
        .collect::<Vec<_>>();
    legacy.assets.splice(position..position, fonts);
    legacy.shared_fonts.clear();
    legacy.storage_version = 1;
    Ok(legacy)
}
