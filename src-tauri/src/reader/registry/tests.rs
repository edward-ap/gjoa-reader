use super::*;
use crate::reader::{djvu::DJVU, format::ProbeResult};
use std::io::Write;

fn header(kind: &[u8; 4], size: u32) -> Vec<u8> {
    [b"AT&TFORM".as_slice(), &size.to_be_bytes(), kind].concat()
}

#[test]
fn registration_extensions_and_unique_ids() {
    let registry = FormatRegistry::default();
    let handlers: Vec<_> = registry.handlers().collect();
    assert_eq!(handlers.len(), 9);
    assert_eq!(handlers[6].supported_extensions(), ["mobi", "prc"]);
    assert_eq!(handlers[0].format_id(), DJVU);
    assert_eq!(handlers[0].supported_extensions(), ["djvu", "djv"]);
    assert_eq!(handlers[0].filter_name(), "DjVu books");
    assert!(
        FormatRegistry::new(vec![
            Box::new(DjvuFormatHandler),
            Box::new(DjvuFormatHandler)
        ])
        .is_err()
    );
}

#[test]
fn signature_selection_does_not_trust_extensions() {
    let registry = FormatRegistry::default();
    for kind in [b"DJVU", b"DJVM"] {
        assert_eq!(
            registry.select(&header(kind, 100)).unwrap().format_id(),
            DJVU
        );
    }
    for unknown in [
        b"unsupported".as_slice(),
        b"PK\x03\x04",
        b"",
        b"ordinary text",
    ] {
        assert_eq!(DjvuFormatHandler.probe(unknown), ProbeResult::NotMine);
        assert!(
            registry
                .select(unknown)
                .err()
                .unwrap()
                .contains("Unsupported")
        );
    }
}

#[test]
fn recognized_malformed_headers_are_distinct_from_unsupported() {
    let valid = header(b"DJVU", 100);
    for count in 1..16 {
        assert!(matches!(
            DjvuFormatHandler.probe(&valid[..count]),
            ProbeResult::Malformed(_)
        ));
    }
    for malformed in [
        header(b"DJVI", 100),
        header(b"DJVU", 3),
        b"AT&TNOPE\0\0\0\x04DJVU".to_vec(),
    ] {
        assert!(
            FormatRegistry::default()
                .select(&malformed)
                .err()
                .unwrap()
                .starts_with("Invalid djvu")
        );
    }
}

#[test]
fn opening_checks_the_full_document_after_probe() {
    let registry = FormatRegistry::default();
    let mut fake = tempfile::Builder::new().suffix(".djvu").tempfile().unwrap();
    fake.write_all(b"unsupported").unwrap();
    assert!(
        registry
            .open(fake.path())
            .err()
            .unwrap()
            .contains("Unsupported")
    );
    let mut truncated = tempfile::NamedTempFile::new().unwrap();
    truncated.write_all(&header(b"DJVU", 100)).unwrap();
    assert!(
        registry
            .open(truncated.path())
            .err()
            .unwrap()
            .contains("Invalid DjVu")
    );
    assert!(
        registry
            .open(std::path::Path::new("missing-registry-book"))
            .err()
            .unwrap()
            .contains("Cannot open")
    );
}

#[test]
#[ignore = "external corpus: set GJOA_TEST_CORPUS_DIR and run explicitly with --ignored"]
fn real_djvu_opens_with_an_unrelated_extension() {
    let root = crate::test_corpus::directory();
    let source = std::fs::read_dir(root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| path.to_string_lossy().contains("Новейший ускоритель"))
        .unwrap();
    let mut renamed = tempfile::Builder::new().suffix(".bin").tempfile().unwrap();
    renamed.write_all(&std::fs::read(source).unwrap()).unwrap();
    let doc = FormatRegistry::default().open(renamed.path()).unwrap();
    assert_eq!(doc.format_id(), DJVU);
    assert_eq!(doc.page_count(), 44);
    assert!(doc.page_info(0).unwrap().dpi.is_some());
    let page = doc
        .render_page(
            0,
            crate::reader::document::RenderRequest {
                width: 40,
                height: 60,
            },
        )
        .unwrap();
    assert_eq!(page.rgba.len(), 40 * 60 * 4);
}
