use super::{
    Result,
    store::{checked_path, directory, hash_id, object_relative, valid_id},
};
use crate::reader::{
    document::{Document, PageInfo, RenderRequest, RenderedPage},
    format::FormatId,
    registry::FormatRegistry,
};
use serde::{Deserialize, Serialize};
use std::{path::Path, sync::Arc};

pub const PUBLISHER: &str = "native-paged";
pub const PUBLISHER_VERSION: u32 = 1;
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub importer_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fallback_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub import_warnings: Vec<String>,
    pub schema_version: u32,
    pub edition_id: String,
    pub source_id: String,
    pub source_path: String,
    pub format: String,
    pub publisher_id: String,
    pub publisher_version: u32,
    pub kind: String,
    pub page_count: usize,
    pub pages: Vec<PageInfo>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub page_files: Vec<crate::publication::FileRecord>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub assets: Vec<crate::publication::FileRecord>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<crate::publication::Metadata>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(
        default = "crate::publication::storage::version_one",
        skip_serializing_if = "crate::publication::storage::is_version_one"
    )]
    pub storage_version: u32,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shared_fonts: Vec<crate::publication::FileRecord>,
}
pub fn edition_id(source: &str, format: &str) -> String {
    hash_id(&["reader-edition-v1", source, format, PUBLISHER, "1", ""])
}
pub struct NativePagedPublisher;
impl NativePagedPublisher {
    pub fn publish(source: &str, doc: &dyn Document) -> Result<Manifest> {
        if doc.page_count() == 0 || doc.page_count() > 20_000 {
            return Err("Invalid publication page count".into());
        }
        let mut pages = Vec::with_capacity(doc.page_count());
        for index in 0..doc.page_count() {
            let page = doc.page_info(index)?;
            if page.width == 0 || page.height == 0 {
                return Err("Publication has empty page geometry".into());
            }
            pages.push(page);
        }
        let page = &pages[0];
        let scale = 160.0 / f64::from(page.width.max(page.height));
        let request = RenderRequest {
            width: (f64::from(page.width) * scale).round().max(1.0) as u32,
            height: (f64::from(page.height) * scale).round().max(1.0) as u32,
        };
        let rendered = doc.render_page(0, request)?;
        if rendered.width != request.width
            || rendered.height != request.height
            || rendered.rgba.len() != request.byte_len()?
        {
            return Err("Publication validation returned an invalid raster".into());
        }
        Ok(Manifest {
            importer_id: None,
            import_warnings: vec![],
            fallback_fingerprint: None,
            schema_version: 1,
            edition_id: edition_id(source, doc.format_id().0),
            source_id: source.into(),
            source_path: object_relative(source)?,
            format: doc.format_id().0.into(),
            publisher_id: PUBLISHER.into(),
            publisher_version: PUBLISHER_VERSION,
            kind: "native-source".into(),
            page_count: pages.len(),
            pages,
            page_files: vec![],
            assets: vec![],
            metadata: None,
            profile_id: None,
            storage_version: 1,
            shared_fonts: vec![],
        })
    }
}
pub fn manifest_relative(id: &str) -> Result<String> {
    if !valid_id(id) {
        return Err("Invalid edition identity".into());
    }
    Ok(format!("editions/{id}/manifest.json"))
}
pub fn install_manifest(root: &Path, manifest: &Manifest) -> Result<bool> {
    let relative = manifest_relative(&manifest.edition_id)?;
    let destination = checked_path(root, &relative)?;
    let bytes = serde_json::to_vec_pretty(manifest)?;
    if destination.exists() {
        if std::fs::read(&destination)? != bytes {
            return Err("Immutable edition manifest differs from publication".into());
        }
        return Ok(false);
    }
    let dir = directory(root, &format!("editions/{}", manifest.edition_id))?;
    let installed = (|| -> Result<()> {
        let mut tmp = tempfile::Builder::new()
            .prefix("upload-")
            .tempfile_in(checked_path(root, "staging")?)?;
        use std::io::Write;
        tmp.write_all(&bytes)?;
        tmp.as_file().sync_all()?;
        tmp.persist_noclobber(&destination).map_err(|e| e.error)?;
        Ok(())
    })();
    if let Err(error) = installed {
        let _ = std::fs::remove_dir(dir);
        return Err(error);
    }
    Ok(true)
}
pub fn resolve(
    root: &Path,
    id: &str,
    registry: &FormatRegistry,
) -> Result<(Arc<dyn Document>, String)> {
    use std::io::Read;
    let mut timing = crate::open_timing::OpenTiming::new();
    let mut bytes = Vec::new();
    std::fs::File::open(checked_path(root, &manifest_relative(id)?)?)?
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Edition manifest too large".into());
    }
    let manifest: Manifest = serde_json::from_slice(&bytes)?;
    crate::publication::storage::validate_version(&manifest)?;
    use crate::reader::format::PublicationKind;
    let (kind, publisher) = match (manifest.kind.as_str(), manifest.format.as_str()) {
        ("native-source", "djvu" | "pdf") => (PublicationKind::Native, PUBLISHER),
        ("extracted-image", "cbr" | "cbz") => (PublicationKind::ExtractedImages, "comic-images"),
        ("generated-layout", "fb2" | "epub" | "rtf" | "mobi" | "pdf" | "md") => {
            (PublicationKind::GeneratedLayout, "canonical-typesetter")
        }
        _ => return Err("Unsupported edition kind/format".into()),
    };
    if manifest.schema_version != 1
        || (manifest.kind == "generated-layout"
            && manifest.format == "pdf"
            && !matches!(
                manifest.importer_id.as_deref(),
                Some(
                    crate::publication::pdf_reconstruction::IMPORTER
                        | crate::publication::pdf_fast::IMPORTER
                        | crate::publication::pdf_smart::IMPORTER
                        | "pdf-smart-prototype-v1;model1"
                        | "pdf-smart-prototype-v2;model1"
                        | "pdf-smart-prototype-v3;model1"
                        | "pdf-reconstruction-v1;model1"
                )
            ))
        || (manifest.format != "pdf" && manifest.importer_id.is_some())
        || manifest.edition_id != id
        || manifest.publisher_id != publisher
        || !(manifest.publisher_version == 1
            || (kind == PublicationKind::GeneratedLayout
                && matches!(manifest.publisher_version, 2..=27)))
        || manifest.fallback_fingerprint.as_ref().is_some_and(|f| {
            !matches!(manifest.publisher_version, 3..=27)
                || kind != PublicationKind::GeneratedLayout
                || !valid_id(f)
        })
        || manifest.edition_id != crate::publication::identity_manifest(&manifest)
        || manifest.source_path != object_relative(&manifest.source_id)?
        || manifest.pages.len() != manifest.page_count
        || manifest.page_count == 0
        || manifest.page_count > 20_000
        || manifest.pages.iter().any(|p| p.width == 0 || p.height == 0)
    {
        return Err("Invalid or unsupported Edition manifest".into());
    }
    timing.mark("edition.manifest");
    if kind != PublicationKind::Native {
        let payload = crate::publication::edition_root(root, id)?;
        return Ok((
            crate::publication::open_payload_with_fonts(&payload, &manifest, Some(root))?,
            payload.to_string_lossy().into_owned(),
        ));
    }
    let path = checked_path(root, &manifest.source_path)?;
    if std::fs::metadata(&path)?.len() > super::store::MAX_SOURCE_BYTES {
        return Err("Stored source exceeds size limit".into());
    }
    if super::store::hash_reader(std::fs::File::open(&path)?)? != manifest.source_id {
        return Err("Stored source hash mismatch".into());
    }
    timing.mark("edition.source_hash");
    let document = registry.open(&path)?;
    timing.mark("edition.decoder_open");
    if document.format_id().0 != manifest.format || document.page_count() != manifest.page_count {
        return Err("Edition metadata does not match its source".into());
    }
    for (index, page) in manifest.pages.iter().enumerate() {
        let actual = document.page_info(index)?;
        if (page.width, page.height, page.dpi) != (actual.width, actual.height, actual.dpi) {
            return Err("Edition page geometry does not match its source".into());
        }
    }
    timing.mark("edition.all_page_geometry");
    Ok((
        Arc::new(NativeEdition {
            document,
            pages: manifest.pages,
        }),
        path.to_string_lossy().into_owned(),
    ))
}
struct NativeEdition {
    document: Arc<dyn Document>,
    pages: Vec<PageInfo>,
}
impl Document for NativeEdition {
    fn format_id(&self) -> FormatId {
        self.document.format_id()
    }
    fn page_count(&self) -> usize {
        self.pages.len()
    }
    fn supports_page_appearance(&self) -> bool {
        self.document.supports_page_appearance()
    }
    fn render_with_appearance(
        &self,
        index: usize,
        request: RenderRequest,
        appearance: crate::reader::document::PageAppearance,
    ) -> crate::reader::document::Result<RenderedPage> {
        self.document
            .render_with_appearance(index, request, appearance)
    }
    fn page_info(&self, index: usize) -> crate::reader::document::Result<PageInfo> {
        self.pages
            .get(index)
            .cloned()
            .ok_or_else(|| "Page index out of range".into())
    }
    fn render_page(
        &self,
        index: usize,
        request: RenderRequest,
    ) -> crate::reader::document::Result<RenderedPage> {
        self.document.render_page(index, request)
    }
}
