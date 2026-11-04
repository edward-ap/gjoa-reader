//! Test-only page source: no file parser, codec types or production registration.
use super::*;
use crate::reader::{
    document::{Document, RenderedPage},
    format::FormatId,
};
use tauri::ipc::{InvokeResponseBody, IpcResponse};

struct SyntheticDocument;
impl Document for SyntheticDocument {
    fn format_id(&self) -> FormatId {
        FormatId("synthetic-test")
    }
    fn page_count(&self) -> usize {
        3
    }
    fn page_info(&self, index: usize) -> Result<PageInfo> {
        let &(width, height) = [(800, 1200), (1200, 800), (900, 1400)]
            .get(index)
            .ok_or("Page index out of range")?;
        Ok(PageInfo {
            width,
            height,
            dpi: None,
        })
    }
    fn render_page(&self, index: usize, request: RenderRequest) -> Result<RenderedPage> {
        self.page_info(index)?;
        let mut rgba = vec![0; request.byte_len()?];
        for y in 0..request.height {
            for x in 0..request.width {
                let offset = ((y * request.width + x) * 4) as usize;
                rgba[offset..offset + 4].copy_from_slice(&[
                    index as u8 * 70,
                    (x % 256) as u8,
                    (y % 256) as u8,
                    255,
                ]);
            }
        }
        Ok(RenderedPage {
            width: request.width,
            height: request.height,
            rgba,
        })
    }
}

fn install(state: &ReaderState) -> u64 {
    let id = state.next_generation();
    let opened = OpenDocument::new(
        std::path::Path::new("synthetic.edition"),
        id,
        Arc::new(SyntheticDocument),
    )
    .unwrap();
    *state.document.lock().unwrap() = Some(Arc::new(opened));
    id
}

#[test]
fn generic_holder_metadata_and_binary_command_worker_accept_synthetic_pages() {
    let state = ReaderState::default();
    let id = install(&state);
    let info = state.info().unwrap().unwrap();
    assert_eq!(info.page_count, 3);
    assert!(info.first_page.dpi.is_none());
    let metadata = serde_json::to_value(info).unwrap();
    assert_eq!(metadata["format"], "synthetic-test");
    assert!(metadata["firstPage"]["dpi"].is_null());
    let doc = state.get(id).unwrap();
    for (index, expected) in [(800, 1200), (1200, 800), (900, 1400)]
        .into_iter()
        .enumerate()
    {
        let page = doc.document.page_info(index).unwrap();
        assert_eq!((page.width, page.height), expected);
        for (width, height) in [(40, 60), (90, 30)] {
            let response = render_document(&doc, index, RenderRequest { width, height }).unwrap();
            let InvokeResponseBody::Raw(bytes) = response.body().unwrap() else {
                panic!("RGBA must stay binary");
            };
            assert_eq!(bytes.len(), (width * height * 4) as usize);
            assert_eq!(&bytes[..4], &[index as u8 * 70, 0, 0, 255]);
            assert_eq!(
                &bytes[bytes.len() - 4..],
                &[index as u8 * 70, (width - 1) as u8, (height - 1) as u8, 255]
            );
        }
        // Rendering at other resolutions cannot repaginate the edition.
        let after = doc.document.page_info(index).unwrap();
        assert_eq!((after.width, after.height), expected);
    }
    assert_eq!(doc.document.page_count(), 3);
    assert!(doc.document.page_info(3).is_err());
    assert!(
        render_document(
            &doc,
            3,
            RenderRequest {
                width: 1,
                height: 1
            }
        )
        .is_err()
    );
    assert!(
        render_document(
            &doc,
            0,
            RenderRequest {
                width: u32::MAX,
                height: 1
            }
        )
        .is_err()
    );
    install(&state);
    assert!(state.get(id).is_err());
    *state.document.lock().unwrap() = None;
    assert!(state.info().unwrap().is_none());
}

#[test]
fn generic_worker_rejects_an_adapter_violating_the_raster_contract() {
    struct Broken;
    impl Document for Broken {
        fn format_id(&self) -> FormatId {
            FormatId("broken-test")
        }
        fn page_count(&self) -> usize {
            1
        }
        fn page_info(&self, _: usize) -> Result<PageInfo> {
            SyntheticDocument.page_info(0)
        }
        fn render_page(&self, _: usize, request: RenderRequest) -> Result<RenderedPage> {
            Ok(RenderedPage {
                width: request.width,
                height: request.height,
                rgba: vec![],
            })
        }
    }
    let doc =
        OpenDocument::new(std::path::Path::new("broken.edition"), 1, Arc::new(Broken)).unwrap();
    assert!(
        render_document(
            &doc,
            0,
            RenderRequest {
                width: 1,
                height: 1
            }
        )
        .err()
        .unwrap()
        .contains("Render failure")
    );
}

#[test]
fn fixed_document_appearance_keeps_original_pixels() {
    let doc = SyntheticDocument;
    let request = RenderRequest {
        width: 80,
        height: 120,
    };
    let original = doc.render_page(0, request).unwrap().rgba;
    assert!(!doc.supports_page_appearance());
    for appearance in [PageAppearance::Sepia, PageAppearance::Night] {
        assert_eq!(
            doc.render_with_appearance(0, request, appearance)
                .unwrap()
                .rgba,
            original
        );
    }
}
