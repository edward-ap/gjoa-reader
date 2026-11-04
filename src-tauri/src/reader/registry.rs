use super::{
    djvu::DjvuFormatHandler,
    document::{Document, Result},
    format::{DocumentFormatHandler, ProbeResult},
};
use std::{io::Read, path::Path, sync::Arc};

/// Explicit static registration. No runtime plugins or extension dispatch in UI.
pub struct FormatRegistry {
    handlers: Vec<Box<dyn DocumentFormatHandler>>,
}

impl Default for FormatRegistry {
    fn default() -> Self {
        Self::new(vec![
            Box::new(DjvuFormatHandler),
            Box::new(super::sources::CbrFormatHandler),
            Box::new(super::sources::Fb2FormatHandler),
            Box::new(super::pdf::PdfFormatHandler),
            Box::new(crate::publication::epub::EpubFormatHandler),
            Box::new(crate::publication::rtf::RtfFormatHandler),
            Box::new(crate::publication::mobi::MobiFormatHandler),
            Box::new(crate::publication::cbz::CbzFormatHandler),
            Box::new(crate::publication::markdown::MarkdownFormatHandler),
        ])
        .expect("unique production format IDs")
    }
}

impl FormatRegistry {
    pub fn new(handlers: Vec<Box<dyn DocumentFormatHandler>>) -> Result<Self> {
        for (index, handler) in handlers.iter().enumerate() {
            if handler.format_id().0.is_empty()
                || handlers[..index]
                    .iter()
                    .any(|other| other.format_id() == handler.format_id())
            {
                return Err("Invalid registry: empty or duplicate format ID".into());
            }
        }
        Ok(Self { handlers })
    }

    pub fn handlers(&self) -> impl Iterator<Item = &dyn DocumentFormatHandler> {
        self.handlers.iter().map(Box::as_ref)
    }

    pub fn select(&self, header: &[u8]) -> Result<&dyn DocumentFormatHandler> {
        let mut selected = None;
        let mut malformed = None;
        for handler in self.handlers() {
            match handler.probe(header) {
                ProbeResult::Supported => {
                    if selected.is_some() {
                        return Err("Invalid document: ambiguous format signature".into());
                    }
                    selected = Some(handler);
                }
                ProbeResult::Malformed(detail) => {
                    malformed = Some(format!(
                        "Invalid {} document: {detail}",
                        handler.format_id().0
                    ));
                }
                ProbeResult::NotMine | ProbeResult::Candidate => {}
            }
        }
        selected.ok_or_else(|| malformed.unwrap_or_else(|| "Unsupported document format".into()))
    }

    pub fn detect(&self, path: &Path) -> Result<&dyn DocumentFormatHandler> {
        self.detect_named(path, &path.to_string_lossy())
    }

    fn named_text(&self, path: &Path, name: &str) -> Result<&dyn DocumentFormatHandler> {
        if Path::new(name)
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("markdown"))
        {
            crate::publication::markdown::read_source(path).map_err(|e| e.to_string())?;
            if let Some(handler) = self
                .handlers()
                .find(|h| h.format_id() == crate::publication::markdown::MARKDOWN)
            {
                return Ok(handler);
            }
        }
        Err("Unsupported document format".into())
    }

    pub fn detect_named(
        &self,
        path: &Path,
        original_name: &str,
    ) -> Result<&dyn DocumentFormatHandler> {
        // Do not trust the extension or read a whole source merely to identify it.
        let mut file = std::fs::File::open(path)
            .map_err(|error| format!("Cannot open {}: {error}", path.display()))?;
        // Container signatures may live after their title/metadata prefix (PalmDB).
        const PREFIX_BYTES: usize = 128;
        let mut header = Vec::with_capacity(PREFIX_BYTES);
        if file.metadata().map_err(|e| e.to_string())?.len()
            > crate::library::store::MAX_SOURCE_BYTES
        {
            return Err("Source exceeds 512 MiB".into());
        }
        (&mut file)
            .take(PREFIX_BYTES as u64)
            .read_to_end(&mut header)
            .map_err(|error| format!("Cannot probe {}: {error}", path.display()))?;
        if !self
            .handlers()
            .any(|h| h.probe(&header) == ProbeResult::Candidate)
        {
            return match self.select(&header) {
                Err(e) if e == "Unsupported document format" => {
                    self.named_text(path, original_name)
                }
                result => result,
            };
        }
        (&mut file)
            .take(65536 - header.len() as u64)
            .read_to_end(&mut header)
            .map_err(|e| e.to_string())?;
        let mut selected = None;
        for handler in self.handlers() {
            let result = if handler.probe(&header[..header.len().min(PREFIX_BYTES)])
                == ProbeResult::Candidate
            {
                handler.probe_source(path, &header)?
            } else {
                handler.probe(&header)
            };
            match result {
                ProbeResult::Supported => {
                    if selected.is_some() {
                        return Err("Ambiguous document signature".into());
                    }
                    selected = Some(handler);
                }
                ProbeResult::Malformed(detail) => {
                    return Err(format!(
                        "Invalid {} document: {detail}",
                        handler.format_id().0
                    ));
                }
                _ => {}
            }
        }
        match selected {
            Some(handler) => Ok(handler),
            None => self.named_text(path, original_name),
        }
    }
    pub fn open(&self, path: &Path) -> Result<Arc<dyn Document>> {
        let handler = self.detect(path)?;
        // The adapter revalidates the complete source; probe is only routing.
        let document = handler.open(path)?;
        if document.format_id() != handler.format_id() {
            return Err("Invalid document: handler returned a different format ID".into());
        }
        Ok(document)
    }
}

#[cfg(test)]
mod tests;
