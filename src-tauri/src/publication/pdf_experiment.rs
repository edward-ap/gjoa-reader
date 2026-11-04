//! Development-only comparisons. Production uses Smart through library::derived.
use crate::library::Result;
use serde::Serialize;
use std::path::Path;
#[derive(Clone, Copy, Debug, Serialize)]
pub enum PdfManuscriptStrategy {
    Fast,
    Deep,
    Smart,
}
pub fn prepare(
    source: &str,
    path: &Path,
    staging: &Path,
    strategy: PdfManuscriptStrategy,
    diagnostics: &Path,
) -> Result<Option<super::Prepared>> {
    match strategy {
        PdfManuscriptStrategy::Smart => {
            super::pdf_smart::prepare(source, path, staging, diagnostics)
        }
        PdfManuscriptStrategy::Deep => {
            let (assessment, prepared) =
                super::pdf_reconstruction::prepare(source, path, staging, true)?;
            let _diagnostic_timer = crate::pipeline_metrics::stage("diagnostic_output");
            std::fs::write(
                diagnostics.join("removals.json"),
                serde_json::to_vec(&assessment.removals)?,
            )?;
            std::fs::write(
                diagnostics.join("diagnostics.json"),
                serde_json::to_vec_pretty(&assessment.summary())?,
            )?;
            Ok(prepared)
        }
        PdfManuscriptStrategy::Fast => {
            let directory = tempfile::Builder::new()
                .prefix("publication-")
                .tempdir_in(staging)?;
            let evidence = crate::reader::pdf::extract_fast_evidence(
                path,
                &directory.path().join("assets/pdf"),
            )?;
            let diagnostic_timer = crate::pipeline_metrics::stage("diagnostic_output");
            std::fs::write(
                diagnostics.join("source-text.json"),
                serde_json::to_vec(&evidence.native_text)?,
            )?;
            drop(diagnostic_timer);
            let (model, report) = super::pdf_fast::reconstruct(&evidence)?;
            let diagnostic_timer = crate::pipeline_metrics::stage("diagnostic_output");
            std::fs::write(
                diagnostics.join("diagnostics.json"),
                serde_json::to_vec_pretty(&report)?,
            )?;
            std::fs::write(diagnostics.join("images.json"),serde_json::to_vec(&evidence.pages.pages.iter().map(|p|serde_json::json!({"page":p.index,"images":p.images,"complex":p.complex_objects})).collect::<Vec<_>>())?)?;
            drop(diagnostic_timer);
            if model.text.trim().is_empty() {
                return Ok(None);
            }
            let mut manifest = super::manifest(source, &super::pdf_reconstruction::ReaderHandler)?;
            manifest.importer_id = Some(super::pdf_fast::IMPORTER.into());
            manifest.metadata = Some(model.metadata.clone());
            manifest.edition_id = super::identity_manifest(&manifest);
            let model_storage = crate::pipeline_metrics::stage("model_serialization");
            for block in &model.blocks {
                if let super::model::Block::Image { asset, .. } = block {
                    let bytes = std::fs::read(directory.path().join(asset))?;
                    if !manifest.assets.iter().any(|a| &a.path == asset) {
                        manifest.assets.push(super::FileRecord {
                            path: asset.clone(),
                            sha256: crate::library::store::hash_reader(bytes.as_slice())?,
                            bytes: bytes.len() as u64,
                        });
                    }
                }
            }
            manifest.assets.push(super::write_file(
                directory.path(),
                "publication.json",
                &serde_json::to_vec(&model)?,
            )?);
            drop(model_storage);
            super::typography::publish(&model, directory.path(), &mut manifest)?;
            manifest.page_count = manifest.pages.len();
            if manifest.page_count == 0 || manifest.page_count > 20_000 {
                return Err("Invalid Reader Edition page count".into());
            }
            let doc = super::open_payload(directory.path(), &manifest)?;
            let thumbnail = crate::library::thumbnail::render(doc.as_ref())?;
            super::write_file(
                directory.path(),
                "manifest.json",
                &serde_json::to_vec_pretty(&manifest)?,
            )?;
            Ok(Some(super::Prepared {
                manifest,
                thumbnail,
                directory: Some(directory),
                installed_fonts: vec![],
            }))
        }
    }
}
