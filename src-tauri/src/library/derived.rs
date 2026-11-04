//! Optional derived editions are committed after their Original succeeds.
use super::*;
use crate::publication::pdf_reconstruction::{self, PdfReconstructionAssessment};
#[derive(Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DerivedResult {
    pub label: String,
    pub item_id: Option<i64>,
    pub assessment: Option<PdfReconstructionAssessment>,
    pub error: Option<String>,
    pub cached: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderEditionStatus {
    pub supported: bool,
    pub item_id: Option<i64>,
    pub confidence: Option<pdf_reconstruction::Confidence>,
}
impl Library {
    // Keep command compatibility while removing reconstruction from the product.
    pub fn reader_edition_status(&self, id: i64) -> Result<ReaderEditionStatus> {
        self.item(id)?;
        Ok(ReaderEditionStatus {
            supported: false,
            item_id: None,
            confidence: None,
        })
    }
    pub fn reader_edition(&mut self, id: i64, _experimental: bool) -> Result<DerivedResult> {
        self.item(id)?;
        Err("PDF Reader reconstruction is disabled; open Original".into())
    }
    pub(super) fn optional_reader(&mut self, _id: i64) -> (Option<i64>, Option<String>) {
        (None, None)
    }
    /// Old PDF Reader rows open their Original item, with Original page/progress.
    pub fn original_reading_item(&self, id: i64) -> Result<i64> {
        let item = self.item(id)?;
        if item.format != "pdf" {
            return Ok(id);
        }
        let (source, publisher): (String, String) = self.db.query_row(
            "SELECT source_id,publisher_id FROM editions WHERE id=?1",
            [&item.edition_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if publisher == edition::PUBLISHER {
            return Ok(id);
        }
        let original: Option<i64> = self.db.query_row(
            "SELECT i.id FROM library_items i JOIN editions e ON e.id=i.edition_id WHERE e.source_id=?1 AND e.publisher_id=?2 ORDER BY i.id LIMIT 1",
            params![source, edition::PUBLISHER], |r| r.get(0)).optional()?;
        original
            .ok_or_else(|| "Original PDF item was removed; reimport the PDF to restore it".into())
    }
}
