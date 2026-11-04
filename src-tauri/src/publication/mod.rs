mod binary;
pub mod cbr;
pub mod cbz;
#[cfg(windows)]
pub mod directwrite;
pub mod epub;
pub mod fb2;
pub(crate) mod font_assets;
pub mod font_resolver;
pub mod generated;
pub mod images;
pub mod layout_codec;
pub mod markdown;
pub mod mobi;
pub mod model;
#[cfg(test)]
mod new_formats_tests;
pub mod optimizer;
pub mod pdf_experiment;
pub mod pdf_fast;
pub mod pdf_reconstruction;
pub mod pdf_smart;
pub mod rtf;
pub mod storage;
pub mod system_fallback;
pub mod typography;
use crate::{
    library::{
        Result,
        edition::{Manifest, NativePagedPublisher},
        store::{checked_path, hash_id, object_relative},
    },
    reader::{
        document::{Document, RenderRequest},
        format::{DocumentFormatHandler, PublicationKind},
    },
};
use serde::{Deserialize, Serialize};
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileRecord {
    pub path: String,
    pub sha256: String,
    pub bytes: u64,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Metadata {
    pub title: Option<String>,
    pub author: Option<String>,
}
pub struct Prepared {
    pub manifest: Manifest,
    pub thumbnail: Vec<u8>,
    pub directory: Option<tempfile::TempDir>,
    installed_fonts: Vec<PathBuf>,
}
pub const CURRENT_PUBLISHER_VERSION: u32 = 27;
pub fn identity(source: &str, format: &str, kind: PublicationKind) -> String {
    identity_version(
        source,
        format,
        kind,
        if kind == PublicationKind::GeneratedLayout {
            CURRENT_PUBLISHER_VERSION
        } else {
            1
        },
    )
}
pub fn identity_version(source: &str, format: &str, kind: PublicationKind, version: u32) -> String {
    let profile = if version == 1 {
        typography::legacy_profile_id()
    } else if version <= 5 {
        typography::v3_profile_id()
    } else {
        typography::profile_id()
    };
    identity_profile(source, format, kind, version, &profile)
}
pub fn identity_profile(
    source: &str,
    format: &str,
    kind: PublicationKind,
    version: u32,
    font_profile: &str,
) -> String {
    let (publisher, profile) = match kind {
        PublicationKind::Native => ("native-paged", String::new()),
        PublicationKind::ExtractedImages => ("comic-images", String::new()),
        PublicationKind::GeneratedLayout => ("canonical-typesetter", font_profile.to_owned()),
    };
    hash_id(&[
        "reader-edition-v1",
        source,
        format,
        publisher,
        &version.to_string(),
        &profile,
    ])
}
pub fn identity_manifest(manifest: &Manifest) -> String {
    let kind = match manifest.kind.as_str() {
        "generated-layout" => PublicationKind::GeneratedLayout,
        "extracted-image" => PublicationKind::ExtractedImages,
        _ => PublicationKind::Native,
    };
    let base = identity_profile(
        &manifest.source_id,
        &manifest.format,
        kind,
        manifest.publisher_version,
        manifest.profile_id.as_deref().unwrap_or_default(),
    );
    let base = match &manifest.importer_id {
        Some(importer) => hash_id(&["reader-derived-edition-v1", &base, importer]),
        None => base,
    };
    let base = match &manifest.fallback_fingerprint {
        Some(f) => hash_id(&["reader-fallback-edition-v1", &base, f]),
        None => base,
    };
    // A filename fallback is part of the printed edition, unlike the editable
    // Library title. Different fallback labels must never collide on disk.
    match manifest
        .assets
        .iter()
        .find(|r| r.path == typography::running_header::ASSET)
    {
        Some(header) => hash_id(&["reader-decorated-edition-v1", &base, &header.sha256]),
        None => base,
    }
}
pub fn manifest(source: &str, handler: &dyn DocumentFormatHandler) -> Result<Manifest> {
    let kind = handler.publication_kind();
    Ok(Manifest {
        importer_id: None,
        import_warnings: vec![],
        fallback_fingerprint: None,
        schema_version: 1,
        edition_id: identity(source, handler.format_id().0, kind),
        source_id: source.into(),
        source_path: object_relative(source)?,
        format: handler.format_id().0.into(),
        publisher_id: match kind {
            PublicationKind::Native => "native-paged",
            PublicationKind::ExtractedImages => "comic-images",
            PublicationKind::GeneratedLayout => "canonical-typesetter",
        }
        .into(),
        publisher_version: if kind == PublicationKind::GeneratedLayout {
            CURRENT_PUBLISHER_VERSION
        } else {
            1
        },
        kind: match kind {
            PublicationKind::Native => "native-source",
            PublicationKind::ExtractedImages => "extracted-image",
            PublicationKind::GeneratedLayout => "generated-layout",
        }
        .into(),
        page_count: 0,
        pages: vec![],
        page_files: vec![],
        assets: vec![],
        metadata: None,
        profile_id: if kind == PublicationKind::GeneratedLayout {
            Some(typography::profile_id())
        } else {
            None
        },
        storage_version: 1,
        shared_fonts: vec![],
    })
}
pub fn prepare(
    source: &str,
    handler: &dyn DocumentFormatHandler,
    path: &Path,
    staging: &Path,
) -> Result<Prepared> {
    prepare_named(
        source,
        handler,
        path,
        staging,
        &path.file_name().unwrap_or_default().to_string_lossy(),
    )
}
pub fn prepare_named(
    source: &str,
    handler: &dyn DocumentFormatHandler,
    path: &Path,
    staging: &Path,
    original_name: &str,
) -> Result<Prepared> {
    if handler.publication_kind() == PublicationKind::Native {
        let document = handler.open(path)?;
        return Ok(Prepared {
            manifest: NativePagedPublisher::publish(source, document.as_ref())?,
            thumbnail: crate::library::thumbnail::render(document.as_ref())?,
            directory: None,
            installed_fonts: vec![],
        });
    }
    let directory = tempfile::Builder::new()
        .prefix("publication-")
        .tempdir_in(staging)?;
    let mut manifest = manifest(source, handler)?;
    match handler.publication_kind() {
        PublicationKind::ExtractedImages => match handler.format_id().0 {
            "cbr" => cbr::publish(path, directory.path(), &mut manifest)?,
            "cbz" => cbz::publish(path, directory.path(), &mut manifest)?,
            _ => return Err("No image publisher registered".into()),
        },
        PublicationKind::GeneratedLayout => match handler.format_id().0 {
            "fb2" => fb2::publish(path, directory.path(), &mut manifest)?,
            "epub" => epub::publish(path, directory.path(), &mut manifest)?,
            "rtf" => rtf::publish(path, directory.path(), &mut manifest)?,
            "mobi" => mobi::publish(path, directory.path(), &mut manifest)?,
            "md" => markdown::publish(path, directory.path(), &mut manifest)?,
            _ => return Err("No source publisher registered".into()),
        },
        PublicationKind::Native => unreachable!(),
    }
    if manifest.kind == "generated-layout" && manifest.publisher_version >= 23 {
        typography::running_header::publish(directory.path(), &mut manifest, original_name)?;
    }
    if manifest.pages.is_empty() || manifest.pages.len() > 20_000 {
        return Err("Invalid publication page count".into());
    }
    manifest.page_count = manifest.pages.len();
    let doc = open_payload(directory.path(), &manifest)?;
    let page = doc.page_info(0)?;
    let scale = 160.0 / f64::from(page.width.max(page.height));
    let request = RenderRequest {
        width: (f64::from(page.width) * scale).round().max(1.0) as u32,
        height: (f64::from(page.height) * scale).round().max(1.0) as u32,
    };
    let result = doc.render_page(0, request)?;
    if result.width != request.width
        || result.height != request.height
        || result.rgba.len() != request.byte_len()?
    {
        return Err("Publication validation raster mismatch".into());
    }
    write_file(
        directory.path(),
        "manifest.json",
        &serde_json::to_vec_pretty(&manifest)?,
    )?;
    let _ = writeln!(
        std::io::stderr(),
        "publish format={} pages={} edition={}",
        manifest.format,
        manifest.page_count,
        manifest.edition_id
    );
    Ok(Prepared {
        manifest,
        thumbnail: crate::library::thumbnail::render(doc.as_ref())?,
        directory: Some(directory),
        installed_fonts: vec![],
    })
}
pub fn open_payload(root: &Path, manifest: &Manifest) -> Result<Arc<dyn Document>> {
    open_payload_with_fonts(root, manifest, None)
}
pub fn open_payload_with_fonts(
    root: &Path,
    manifest: &Manifest,
    fonts_root: Option<&Path>,
) -> Result<Arc<dyn Document>> {
    match manifest.kind.as_str() {
        "extracted-image" => Ok(Arc::new(images::ImageDocument::open(root, manifest)?)),
        "generated-layout" => Ok(Arc::new(generated::GeneratedDocument::open_with_fonts(
            root, manifest, fonts_root,
        )?)),
        _ => Err("Unsupported publication payload kind".into()),
    }
}
pub fn write_file(root: &Path, relative: &str, bytes: &[u8]) -> Result<FileRecord> {
    crate::import_cancel::check()?;
    let path = checked_path(root, relative)?;
    std::fs::create_dir_all(path.parent().ok_or("Missing asset parent")?)?;
    let path = checked_path(root, relative)?;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(FileRecord {
        path: relative.into(),
        sha256: crate::library::store::hash_reader(bytes)?,
        bytes: bytes.len() as u64,
    })
}
pub fn read_file(root: &Path, file: &FileRecord, limit: u64) -> Result<Vec<u8>> {
    use std::io::Read;
    if file.bytes > limit || !crate::library::store::valid_id(&file.sha256) {
        return Err("Edition asset exceeds limit or has invalid identity".into());
    }
    let mut input = std::fs::File::open(checked_path(root, &file.path)?)?;
    if input.metadata()?.len() != file.bytes {
        return Err("Edition asset size mismatch".into());
    }
    let mut bytes = Vec::with_capacity(file.bytes as usize);
    (&mut input).take(limit + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 != file.bytes
        || crate::library::store::hash_reader(bytes.as_slice())? != file.sha256
    {
        return Err("Edition asset integrity failure".into());
    }
    Ok(bytes)
}
pub fn validate_files(root: &Path, manifest: &Manifest) -> Result<()> {
    storage::validate_version(manifest)?;
    if manifest.page_files.len() != manifest.page_count || manifest.assets.len() > 10_000 {
        return Err("Edition file table mismatch".into());
    }
    let mut names = std::collections::HashSet::new();
    let mut total = 0u64;
    for file in manifest.page_files.iter().chain(&manifest.assets) {
        total = total
            .checked_add(file.bytes)
            .ok_or("Edition size overflow")?;
        if total > 1024 * 1024 * 1024
            || file.bytes > 64 * 1024 * 1024
            || !names.insert(&file.path)
            || !crate::library::store::valid_id(&file.sha256)
        {
            return Err("Invalid or oversized edition file table".into());
        }
        let path = checked_path(root, &file.path)?;
        if std::fs::metadata(path)?.len() != file.bytes {
            return Err("Missing or incomplete edition asset".into());
        }
    }
    Ok(())
}
impl Prepared {
    pub fn rollback_fonts(&mut self) {
        for path in self.installed_fonts.drain(..) {
            let _ = std::fs::remove_file(path);
        }
    }
    pub fn install(&mut self, root: &Path) -> Result<bool> {
        let _storage_timer = crate::pipeline_metrics::stage("edition_install_and_compaction");
        let Some(directory) = self.directory.take() else {
            return crate::library::edition::install_manifest(root, &self.manifest);
        };
        let result = (|| -> Result<bool> {
            storage::compact(
                directory.path(),
                &mut self.manifest,
                root,
                &mut self.installed_fonts,
            )?;
            let destination =
                checked_path(root, &format!("editions/{}", self.manifest.edition_id))?;
            if destination.exists() {
                if std::fs::read(destination.join("manifest.json"))?
                    != serde_json::to_vec_pretty(&self.manifest)?
                {
                    return Err("Immutable edition differs from publication".into());
                }
                validate_files(&destination, &self.manifest)?;
                for file in self.manifest.page_files.iter().chain(&self.manifest.assets) {
                    read_file(&destination, file, 64 * 1024 * 1024)?;
                }
                return Ok(false);
            }
            // Directory is entirely prepared on this filesystem before SQLite can reference it.
            crate::library::store::install_directory(directory.path(), &destination)?;
            Ok(true)
        })();
        if result.is_err() {
            self.rollback_fonts();
        }
        result
    }
}
pub fn edition_root(root: &Path, id: &str) -> Result<PathBuf> {
    if !crate::library::store::valid_id(id) {
        return Err("Invalid edition ID".into());
    }
    checked_path(root, &format!("editions/{id}"))
}

#[cfg(test)]
mod footnotes_tests;
pub mod note_diagnostics;
#[cfg(test)]
mod tests;

#[cfg(test)]
mod sprint8_tests;

#[cfg(test)]
mod storage_tests;
