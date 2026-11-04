//! Source recognition is separate from the already-open page contract.
use super::document::{Document, Result};
use serde::Serialize;
use std::{path::Path, sync::Arc};

/// Stable reader-owned identifier; never a decoder crate name or a UI switch.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct FormatId(pub &'static str);

#[derive(Debug, PartialEq, Eq)]
pub enum ProbeResult {
    Supported,
    Candidate,
    NotMine,
    Malformed(&'static str),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PublicationKind {
    Native,
    ExtractedImages,
    GeneratedLayout,
}

pub trait DocumentFormatHandler: Send + Sync {
    fn format_id(&self) -> FormatId;
    fn filter_name(&self) -> &'static str;
    fn supported_extensions(&self) -> &'static [&'static str];
    /// Receives at most the first 16 bytes. Recognition is not full validation.
    fn probe(&self, header: &[u8]) -> ProbeResult;
    /// At most 64 KiB, only requested for a quick-probe candidate.
    fn deep_probe(&self, header: &[u8]) -> ProbeResult {
        self.probe(header)
    }
    fn probe_source(&self, _path: &Path, header: &[u8]) -> Result<ProbeResult> {
        Ok(self.deep_probe(header))
    }
    fn publication_kind(&self) -> PublicationKind {
        PublicationKind::Native
    }
    fn open(&self, _path: &Path) -> Result<Arc<dyn Document>> {
        Err("This source requires publication. Use Import Book to add it to Library.".into())
    }
}
