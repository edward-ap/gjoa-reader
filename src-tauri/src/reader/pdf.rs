//! PDFium is confined to one worker: no PDF handles or unsafe Send implementations
//! cross the Document boundary. The embedded, pinned DLL is loaded by absolute path.
use super::{
    document::{Document, PageInfo, RenderRequest, RenderedPage, Result},
    format::{DocumentFormatHandler, FormatId, ProbeResult},
};
use pdfium_render::prelude::*;
pub mod extraction;
pub mod semantics;
use std::{
    path::{Path, PathBuf},
    sync::{
        Arc, OnceLock,
        mpsc::{self, Sender},
    },
};
pub const PDF: FormatId = FormatId("pdf");
pub struct PdfFormatHandler;
impl DocumentFormatHandler for PdfFormatHandler {
    fn format_id(&self) -> FormatId {
        PDF
    }
    fn filter_name(&self) -> &'static str {
        "PDF books"
    }
    fn supported_extensions(&self) -> &'static [&'static str] {
        &["pdf"]
    }
    fn probe(&self, header: &[u8]) -> ProbeResult {
        if header.starts_with(b"%PDF-") {
            ProbeResult::Supported
        } else {
            ProbeResult::NotMine
        }
    }
    fn open(&self, path: &Path) -> Result<Arc<dyn Document>> {
        Ok(Arc::new(PdfSourceDocument::open(path)?))
    }
}
enum Command {
    Sample(PathBuf, Sender<Result<extraction::PdfEvidence>>),
    Semantics(PathBuf, Sender<Result<Vec<semantics::SemanticPage>>>),
    Fast(
        PathBuf,
        Option<PathBuf>,
        Sender<Result<extraction::PdfFastEvidence>>,
    ),
    Extract(
        PathBuf,
        Option<PathBuf>,
        Sender<Result<extraction::PdfEvidence>>,
    ),
    Open(PathBuf, Sender<Result<(u64, Vec<PageInfo>)>>),
    Render(u64, usize, RenderRequest, Sender<Result<RenderedPage>>),
    Close(u64, Sender<()>),
}
fn engine() -> Result<&'static Sender<Command>> {
    static ENGINE: OnceLock<Result<Sender<Command>>> = OnceLock::new();
    ENGINE
        .get_or_init(|| {
            let (sender, receiver) = mpsc::channel();
            let (ready, initialized) = mpsc::channel();
            std::thread::Builder::new()
                .name("reader-pdfium".into())
                .spawn(move || {
                    let setup = (|| -> Result<_> {
                        let directory = tempfile::Builder::new()
                            .prefix("reader-pdfium-")
                            .tempdir()
                            .map_err(|e| e.to_string())?;
                        let dll = directory.path().join("pdfium.dll");
                        std::fs::write(&dll, include_bytes!("../../assets/pdfium/bin/pdfium.dll"))
                            .map_err(|e| e.to_string())?;
                        let bindings = Pdfium::bind_to_library(&dll)
                            .map_err(|e| format!("Cannot initialize bundled PDFium: {e}"))?;
                        let semantic_bindings = Pdfium::bind_to_library(&dll)
                            .map_err(|e| format!("Cannot bind PDF structure API: {e}"))?;
                        Ok((directory, Pdfium::new(bindings), semantic_bindings))
                    })();
                    let (_directory, pdfium, semantic_bindings) = match setup {
                        Ok(value) => {
                            let _ = ready.send(Ok(()));
                            value
                        }
                        Err(error) => {
                            let _ = ready.send(Err(error));
                            return;
                        }
                    };
                    let mut documents = std::collections::HashMap::new();
                    let mut next = 1u64;
                    while let Ok(command) = receiver.recv() {
                        match command {
                            Command::Sample(path, reply) => {
                                let _ = reply.send(extraction::sample(&pdfium, &path));
                            }
                            Command::Semantics(path, reply) => {
                                let _ = reply
                                    .send(semantics::extract(semantic_bindings.as_ref(), &path));
                            }
                            Command::Fast(path, assets, reply) => {
                                let _ = reply.send(extraction::extract_fast(
                                    &pdfium,
                                    &path,
                                    assets.as_deref(),
                                ));
                            }
                            Command::Extract(path, assets, reply) => {
                                let _ = reply.send(extraction::extract(
                                    &pdfium,
                                    &path,
                                    assets.as_deref(),
                                ));
                            }
                            Command::Open(path, reply) => {
                                let result = (|| -> Result<_> {
                                    if std::fs::metadata(&path).map_err(|e| e.to_string())?.len()
                                        > crate::library::store::MAX_SOURCE_BYTES
                                    {
                                        return Err("PDF exceeds 512 MiB".into());
                                    }
                                    let doc =
                                        pdfium.load_pdf_from_file(&path, None).map_err(|e| {
                                            format!(
                                                "Cannot open PDF (passwords are unsupported): {e}"
                                            )
                                        })?;
                                    if doc.pages().is_empty() || doc.pages().len() > 20_000 {
                                        return Err("Invalid PDF page count".into());
                                    }
                                    let mut pages = vec![];
                                    // Read dimensions without loading every page's content.
                                    // Only Render loads a page into PDFium.
                                    for index in doc.pages().as_range() {
                                        let size = doc
                                            .pages()
                                            .page_size(index)
                                            .map_err(|e| e.to_string())?;
                                        let w = size.width().value;
                                        let h = size.height().value;
                                        if !w.is_finite()
                                            || !h.is_finite()
                                            || !(1. ..=100_000.).contains(&w)
                                            || !(1. ..=100_000.).contains(&h)
                                        {
                                            return Err("Invalid PDF page geometry".into());
                                        }
                                        pages.push(PageInfo {
                                            width: w.round() as u32,
                                            height: h.round() as u32,
                                            dpi: Some(72),
                                        });
                                    }
                                    let id = next;
                                    next += 1;
                                    documents.insert(id, doc);
                                    Ok((id, pages))
                                })();
                                let _ = reply.send(result);
                            }
                            Command::Render(id, index, request, reply) => {
                                let result = (|| -> Result<_> {
                                    let length = request.byte_len()?;
                                    let doc = documents.get(&id).ok_or("PDF is closed")?;
                                    let page = doc
                                        .pages()
                                        .get(i32::try_from(index).map_err(|e| e.to_string())?)
                                        .map_err(|e| e.to_string())?;
                                    let bitmap = page
                                        .render_with_config(
                                            &PdfRenderConfig::new().set_target_size(
                                                request.width as i32,
                                                request.height as i32,
                                            ),
                                        )
                                        .map_err(|e| e.to_string())?;
                                    let rgba = bitmap.as_rgba_bytes();
                                    if bitmap.width() != request.width as i32
                                        || bitmap.height() != request.height as i32
                                        || rgba.len() != length
                                    {
                                        return Err("PDF raster geometry mismatch".into());
                                    }
                                    Ok(RenderedPage {
                                        width: request.width,
                                        height: request.height,
                                        rgba,
                                    })
                                })();
                                let _ = reply.send(result);
                            }
                            Command::Close(id, reply) => {
                                documents.remove(&id);
                                let _ = reply.send(());
                            }
                        }
                    }
                })
                .map_err(|e| e.to_string())?;
            initialized.recv().map_err(|e| e.to_string())??;
            Ok(sender)
        })
        .as_ref()
        .map_err(Clone::clone)
}
pub struct PdfSourceDocument {
    id: u64,
    pages: Vec<PageInfo>,
    sender: Sender<Command>,
}
pub fn extract_evidence(path: &Path, assets: &Path) -> Result<extraction::PdfEvidence> {
    let (reply, result) = mpsc::channel();
    engine()?
        .send(Command::Extract(path.into(), Some(assets.into()), reply))
        .map_err(|e| e.to_string())?;
    result.recv().map_err(|e| e.to_string())?
}
pub fn extract_semantics(path: &Path) -> Result<Vec<semantics::SemanticPage>> {
    let (reply, result) = mpsc::channel();
    engine()?
        .send(Command::Semantics(path.into(), reply))
        .map_err(|e| e.to_string())?;
    result.recv().map_err(|e| e.to_string())?
}
impl PdfSourceDocument {
    pub fn open(path: &Path) -> Result<Self> {
        let sender = engine()?.clone();
        let (reply, result) = mpsc::channel();
        sender
            .send(Command::Open(path.into(), reply))
            .map_err(|e| e.to_string())?;
        let (id, pages) = result.recv().map_err(|e| e.to_string())??;
        Ok(Self { id, pages, sender })
    }
}
impl Drop for PdfSourceDocument {
    fn drop(&mut self) {
        // Acknowledgement releases the source file before Library renames staging on Windows.
        let (reply, result) = mpsc::channel();
        if self.sender.send(Command::Close(self.id, reply)).is_ok() {
            let _ = result.recv();
        }
    }
}
impl Document for PdfSourceDocument {
    fn format_id(&self) -> FormatId {
        PDF
    }
    fn page_count(&self) -> usize {
        self.pages.len()
    }
    fn page_info(&self, index: usize) -> Result<PageInfo> {
        self.pages
            .get(index)
            .cloned()
            .ok_or_else(|| "Page index out of range".into())
    }
    fn render_page(&self, index: usize, request: RenderRequest) -> Result<RenderedPage> {
        request.byte_len()?;
        self.page_info(index)?;
        let (reply, result) = mpsc::channel();
        self.sender
            .send(Command::Render(self.id, index, request, reply))
            .map_err(|e| e.to_string())?;
        result.recv().map_err(|e| e.to_string())?
    }
}

pub fn sample_evidence(path: &Path) -> Result<extraction::PdfEvidence> {
    let (reply, receive) = mpsc::channel();
    engine()?
        .send(Command::Sample(path.into(), reply))
        .map_err(|e| e.to_string())?;
    receive.recv().map_err(|e| e.to_string())?
}

pub fn inspect_evidence(path: &Path) -> Result<extraction::PdfEvidence> {
    let (reply, receive) = std::sync::mpsc::channel();
    engine()?
        .send(Command::Extract(path.into(), None, reply))
        .map_err(|e| e.to_string())?;
    receive.recv().map_err(|e| e.to_string())?
}

pub fn extract_fast_evidence(path: &Path, assets: &Path) -> Result<extraction::PdfFastEvidence> {
    let (reply, receive) = mpsc::channel();
    engine()?
        .send(Command::Fast(path.into(), Some(assets.into()), reply))
        .map_err(|e| e.to_string())?;
    receive.recv().map_err(|e| e.to_string())?
}

/// Inspection-only counterpart for comparing a saved model without decoding images.
pub fn inspect_fast_evidence(path: &Path) -> Result<extraction::PdfFastEvidence> {
    let (reply, receive) = mpsc::channel();
    engine()?
        .send(Command::Fast(path.into(), None, reply))
        .map_err(|e| e.to_string())?;
    receive.recv().map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn crop_rotation_color_and_file_lifetime() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("geometry.pdf");
        let objects=[
            "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
            "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>".into(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /CropBox [10 20 190 280] /Rotate 90 /Resources << >> /Contents 5 0 R >>".into(),
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << >> /Contents 5 0 R >>".into(),
            {let stream="1 0 0 rg 30 40 60 60 re f\n";format!("<< /Length {} >>\nstream\n{stream}endstream",stream.len())},
        ];
        let mut pdf = b"%PDF-1.7\n".to_vec();
        let mut offsets = vec![0];
        for (index, object) in objects.iter().enumerate() {
            offsets.push(pdf.len());
            pdf.extend_from_slice(format!("{} 0 obj\n{object}\nendobj\n", index + 1).as_bytes());
        }
        let xref = pdf.len();
        pdf.extend_from_slice(
            format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
        );
        for offset in &offsets[1..] {
            pdf.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
        }
        pdf.extend_from_slice(
            format!(
                "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF",
                objects.len() + 1
            )
            .as_bytes(),
        );
        std::fs::write(&path, pdf).unwrap();
        let doc = PdfSourceDocument::open(&path).unwrap();
        assert_eq!(doc.page_count(), 2);
        let first = doc.page_info(0).unwrap();
        assert_eq!((first.width, first.height), (260, 180));
        let second = doc.page_info(1).unwrap();
        assert_eq!((second.width, second.height), (400, 200));
        let raster = doc
            .render_page(
                0,
                RenderRequest {
                    width: 520,
                    height: 360,
                },
            )
            .unwrap();
        assert_eq!(raster.rgba.len(), 520 * 360 * 4);
        assert!(
            raster
                .rgba
                .chunks_exact(4)
                .any(|p| p[0] > 240 && p[1] < 10 && p[2] < 10 && p[3] == 255)
        );
        assert!(
            doc.render_page(
                2,
                RenderRequest {
                    width: 100,
                    height: 100
                }
            )
            .is_err()
        );
        drop(doc);
        std::fs::rename(&path, temp.path().join("closed.pdf")).unwrap();
    }
}
