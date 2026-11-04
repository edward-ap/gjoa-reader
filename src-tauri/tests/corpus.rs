use reader::reader::{
    djvu::DjvuDocument,
    document::{Document, RenderRequest},
    registry::FormatRegistry,
};
use std::path::PathBuf;

// Integration crates do not share unit-test helpers. This opt-in boundary must
// never fall back to an application profile or a sibling checkout's test data.
fn corpus_directory() -> PathBuf {
    let root = PathBuf::from(std::env::var_os("GJOA_TEST_CORPUS_DIR").expect(
        "External corpus not supplied: set absolute GJOA_TEST_CORPUS_DIR before --ignored",
    ));
    assert!(
        root.is_absolute() && root.is_dir(),
        "GJOA_TEST_CORPUS_DIR must be an existing absolute directory"
    );
    root
}

#[test]
#[ignore = "external corpus: set GJOA_TEST_CORPUS_DIR and run explicitly with --ignored"]
fn real_corpus_smoke() {
    fn assert_send_sync<T: Send + Sync>() {}
    assert_send_sync::<DjvuDocument>();
    let root = corpus_directory();
    let mut tested = 0;
    for entry in
        std::fs::read_dir(root).expect("The supplied GJOA_TEST_CORPUS_DIR corpus must be readable")
    {
        let path = entry.unwrap().path();
        if !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("djvu") || ext.eq_ignore_ascii_case("djv"))
        {
            continue;
        }
        let doc = FormatRegistry::default().open(&path).unwrap();
        assert!(doc.page_count() > 0);
        for index in [
            0,
            1.min(doc.page_count() - 1),
            doc.page_count() / 2,
            doc.page_count() - 1,
        ] {
            let info = doc.page_info(index).unwrap();
            assert!(info.width > 0 && info.height > 0);
            let width = 400;
            let height =
                (f64::from(info.height) * f64::from(width) / f64::from(info.width)).round() as u32;
            let raster = doc
                .render_page(index, RenderRequest { width, height })
                .unwrap_or_else(|error| panic!("{} page {}: {error}", path.display(), index + 1));
            assert_eq!((raster.width, raster.height), (width, height));
            assert_eq!(raster.rgba.len(), width as usize * height as usize * 4);
        }
        assert!(doc.page_info(doc.page_count()).is_err());
        assert!(
            doc.render_page(
                doc.page_count(),
                RenderRequest {
                    width: 1,
                    height: 1
                }
            )
            .is_err()
        );
        tested += 1;
    }
    assert!(tested >= 2, "Both supplied books must be tested");
}

#[test]
fn missing_and_invalid_files_report_errors() {
    assert!(DjvuDocument::open(std::path::Path::new("missing-reader-test.djvu")).is_err());
    let invalid = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
    assert!(DjvuDocument::open(&invalid).is_err());
}

#[test]
#[ignore = "external corpus: set GJOA_TEST_CORPUS_DIR and run explicitly with --ignored"]
fn verne_large_components_and_number_context_reset() {
    let root = corpus_directory();
    let book = std::fs::read_dir(root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| path.to_string_lossy().contains("Вверх дном"))
        .expect("Verne compatibility fixture is required");
    let doc = DjvuDocument::open(&book).unwrap();
    assert_eq!(doc.page_count(), 180);
    // Previously rejected: a 19 MP symbol on page 1 and JB2 number-context
    // resets on pages 2/179. Adjacent and final pages check shared state reuse.
    for index in [0, 1, 2, 89, 178, 179] {
        let info = doc.page_info(index).unwrap();
        let width = 400;
        let height =
            (f64::from(width) * f64::from(info.height) / f64::from(info.width)).round() as u32;
        let raster = doc
            .render_page(index, RenderRequest { width, height })
            .unwrap_or_else(|error| panic!("Verne page {}: {error}", index + 1));
        assert_eq!((raster.width, raster.height), (width, height));
        assert_eq!(raster.rgba.len(), (width * height * 4) as usize);
        assert!(raster.rgba.chunks_exact(4).any(|p| p[0] < 128));
        assert!(raster.rgba.chunks_exact(4).all(|p| p[3] == 255));
    }
}

#[test]
#[ignore = "external corpus: set GJOA_TEST_CORPUS_DIR and run explicitly with --ignored"]
fn reduced_text_preserves_gray_edges_and_glyph_weight() {
    let root = corpus_directory();
    let book = std::fs::read_dir(root)
        .unwrap()
        .filter_map(std::result::Result::ok)
        .map(|entry| entry.path())
        .find(|path| path.to_string_lossy().contains("Бортинженер"))
        .unwrap();
    let doc = DjvuDocument::open(&book).unwrap();
    let original = djvu_rs::Document::from_bytes(std::fs::read(book).unwrap()).unwrap();
    let page = original.page(8).unwrap(); // Representative chapter text page.
    for width in [600, 1000, 1200] {
        let height = (f64::from(width) * f64::from(page.display_height())
            / f64::from(page.display_width()))
        .round() as u32;
        let before = page.render_to_size(width, height).unwrap();
        let after = doc.render_page(8, RenderRequest { width, height }).unwrap();
        let grays = after
            .rgba
            .chunks_exact(4)
            .filter(|p| p[0] > 0 && p[0] < 255)
            .count();
        assert!(
            grays > (width * height / 50) as usize,
            "Text must retain antialiased edges at width {width}"
        );
        let ink = |data: &[u8]| {
            data.chunks_exact(4)
                .map(|p| u64::from(255 - p[0]))
                .sum::<u64>()
        };
        assert!(
            ink(&after.rgba) < ink(&before.data) * 9 / 10,
            "Max-pool must not artificially thicken text"
        );
        assert!(
            after
                .rgba
                .chunks_exact(4)
                .all(|p| p[0] == p[1] && p[1] == p[2] && p[3] == 255)
        );
        assert_eq!(after.rgba.len(), (width * height * 4) as usize);
    }
}
