use crate::reader::{
    document::{Document, PageInfo, Result},
    format::FormatId,
    registry::FormatRegistry,
};
use serde::Serialize;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicU64, Ordering},
};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentInfo {
    pub document_id: u64,
    pub path: String,
    pub format: FormatId,
    pub library_item_id: Option<i64>,
    pub display_name: Option<String>,
    pub page_count: usize,
    pub supports_page_appearance: bool,
    pub first_page: PageInfo,
    pub initial_page_index: usize,
    pub initial_page: PageInfo,
    pub progress_warning: Option<String>,
}

pub struct OpenDocument {
    pub info: DocumentInfo,
    pub document: Arc<dyn Document>,
    pub identity: String,
    pub annotation_key: String,
}

#[derive(Default)]
pub struct ReaderState {
    pub formats: FormatRegistry,
    pub document: Mutex<Option<Arc<OpenDocument>>>,
    pub generation: AtomicU64,
    // Bound native render concurrency, including superseded requests.
    pub render_gate: Arc<Mutex<()>>,
}

impl ReaderState {
    pub fn next_generation(&self) -> u64 {
        self.generation.fetch_add(1, Ordering::SeqCst) + 1
    }
    pub fn get(&self, id: u64) -> Result<Arc<OpenDocument>> {
        self.document
            .lock()
            .map_err(|e| e.to_string())?
            .as_ref()
            .filter(|doc| doc.info.document_id == id)
            .cloned()
            .ok_or_else(|| "Document closed or replaced".into())
    }
    pub fn info(&self) -> Result<Option<DocumentInfo>> {
        Ok(self
            .document
            .lock()
            .map_err(|e| e.to_string())?
            .as_ref()
            .map(|doc| doc.info.clone()))
    }
}

pub fn load(registry: &FormatRegistry, path: &std::path::Path, id: u64) -> Result<OpenDocument> {
    let path =
        dunce::canonicalize(path).map_err(|error| format!("Cannot resolve book path: {error}"))?;
    let document = registry.open(&path)?;
    let mut opened = OpenDocument::new(&path, id, document)?;
    let metadata = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    opened.annotation_key = crate::annotations::identity(&format!(
        "external:{}:{}:{modified}",
        opened.identity,
        metadata.len()
    ));
    Ok(opened)
}

impl OpenDocument {
    pub fn new(path: &std::path::Path, id: u64, document: Arc<dyn Document>) -> Result<Self> {
        if document.page_count() == 0 {
            return Err("Invalid document: no pages".into());
        }
        let identity = crate::progress::book_identity(path);
        // Library callers replace this with the immutable edition identity.
        // External file metadata belongs to load(), not the Document constructor.
        let annotation_key = crate::annotations::identity(&format!("document:{identity}"));
        let first_page = document.page_info(0)?;
        let info = DocumentInfo {
            document_id: id,
            path: path.to_string_lossy().into_owned(),
            format: document.format_id(),
            library_item_id: None,
            display_name: None,
            page_count: document.page_count(),
            supports_page_appearance: document.supports_page_appearance(),
            initial_page: first_page.clone(),
            first_page,
            initial_page_index: 0,
            progress_warning: None,
        };
        Ok(OpenDocument {
            info,
            document,
            identity,
            annotation_key,
        })
    }
}
