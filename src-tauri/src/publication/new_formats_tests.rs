use super::*;
use crate::{
    library::{Library, edition},
    reader::{document::RenderRequest, registry::FormatRegistry},
};
use std::io::{Cursor, Write};

fn raster(format: image::ImageFormat) -> Vec<u8> {
    let mut bytes = Cursor::new(vec![]);
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
        20,
        30,
        image::Rgb([24, 80, 160]),
    ))
    .write_to(&mut bytes, format)
    .unwrap();
    bytes.into_inner()
}
fn zip_file(path: &Path, entries: &[(&str, Vec<u8>)]) {
    let mut zip = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    for (name, bytes) in entries {
        zip.start_file(*name, zip::write::SimpleFileOptions::default())
            .unwrap();
        zip.write_all(bytes).unwrap();
    }
    zip.finish().unwrap();
}
#[test]
fn cbz_natural_order_formats_persistence_and_atomic_failure() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("comic.bin");
    zip_file(
        &source,
        &[
            ("глава/10.webp", raster(image::ImageFormat::WebP)),
            ("глава/2.bmp", raster(image::ImageFormat::Bmp)),
            ("глава/1.jpeg", raster(image::ImageFormat::Jpeg)),
            ("metadata.json", b"{}".to_vec()),
            ("__MACOSX/._1.jpg", b"ignored".to_vec()),
        ],
    );
    let root = temp.path().join("library");
    let mut library = Library::new(&root).unwrap();
    let result = library.import_path(&source, None).unwrap();
    assert_eq!(result.item.format, "cbz");
    assert_eq!(result.item.page_count, 3);
    assert!(library.import_path(&source, None).unwrap().duplicate);
    let payload = edition_root(&root, &result.item.edition_id).unwrap();
    let order: Vec<String> =
        serde_json::from_slice(&std::fs::read(payload.join("page-order.json")).unwrap()).unwrap();
    assert_eq!(order, ["глава/1.jpeg", "глава/2.bmp", "глава/10.webp"]);
    let manifest: edition::Manifest =
        serde_json::from_slice(&std::fs::read(payload.join("manifest.json")).unwrap()).unwrap();
    std::fs::remove_file(root.join(manifest.source_path)).unwrap();
    let (doc, _) =
        edition::resolve(&root, &result.item.edition_id, &FormatRegistry::default()).unwrap();
    assert_eq!(doc.format_id(), cbz::CBZ);
    for index in 0..3 {
        let r = doc
            .render_page(
                index,
                RenderRequest {
                    width: 40,
                    height: 60,
                },
            )
            .unwrap();
        assert_eq!(r.rgba.len(), 40 * 60 * 4);
        assert!(r.rgba.chunks_exact(4).all(|p| p[3] == 255 && p[0] < 240));
    }
    let before = library.list().unwrap().items.len();
    for name in ["../bad.jpg", "bad.jpg"] {
        zip_file(&source, &[(name, b"not an image".to_vec())]);
        assert!(library.import_path(&source, None).is_err());
        assert_eq!(library.list().unwrap().items.len(), before);
    }
}
#[test]
fn zip_container_is_not_automatically_a_comic() {
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("renamed.cbz");
    zip_file(&source, &[("readme.txt", b"hello".to_vec())]);
    assert!(FormatRegistry::default().detect(&source).is_err());
    zip_file(
        &source,
        &[
            ("mimetype", b"application/epub+zip".to_vec()),
            ("cover.jpg", raster(image::ImageFormat::Jpeg)),
        ],
    );
    assert_eq!(
        FormatRegistry::default()
            .detect(&source)
            .unwrap()
            .format_id(),
        epub::EPUB
    );
}
const MD: &str = "# Markdown proof\n\nРусский текст, **bold**, *italic*, `code` и [link](https://example.com). Note[^a].\n\n## Section\n\n> Quotation\n\n3. Third\n4. Fourth\n   - Nested\n\n- [x] Task\n\n```rust\nfn main() {\n    hello();\n}\n```\n\n| Name | Value |\n|:-----|------:|\n| one | 12 |\n\nLine one  \nLine two\n\n![Alt text](missing.png)\n\n[^a]: Footnote text.\n";
#[test]
fn markdown_semantics_and_staged_upload_reopen() {
    let (book, warnings) = markdown::parse(MD).unwrap();
    assert_eq!(book.metadata.title.as_deref(), Some("Markdown proof"));
    assert_eq!(book.notes.len(), 1);
    assert_eq!(book.note_references.len(), 1);
    assert_eq!(book.notes[0].id, book.note_references[0].note_id);
    assert!(book.structure.iter().any(|s| s.heading_level == Some(2)));
    assert!(book.text.contains("\u{a0}\u{a0}\u{a0}\u{a0}hello();"));
    assert!(book.text.contains("Line one\nLine two"));
    assert_eq!(warnings.len(), 1);
    assert!(book.text.contains("Alt text"));
    assert!(book.text.contains("3. Third\n4. Fourth\n• Nested"));
    assert!(book.blocks.iter().any(|b| matches!(
        b,
        model::Block::Table {
            rows: 2,
            columns: 2,
            ..
        }
    )));
    assert!(book.blocks.iter().any(|b| matches!(b, model::Block::Paragraph { list: Some(l), .. } if l.ordinal == 3 && l.ordered)));
    assert!(book.blocks.iter().any(|b| matches!(b, model::Block::Paragraph { spans, .. } if spans.iter().any(|s| s.style.bold && book.text[s.start..s.end].contains("bold")))));
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("library");
    let source = temp.path().join("proof.MD");
    std::fs::write(&source, MD).unwrap();
    let mut library = Library::new(&root).unwrap();
    // import_path goes through chunked staging (without the original extension).
    let imported = library.import_path(&source, None).unwrap();
    assert_eq!(imported.item.format, "md");
    assert_eq!(imported.item.title.as_deref(), Some("Markdown proof"));
    assert_eq!(imported.warnings.len(), 1);
    assert!(library.import_path(&source, None).unwrap().duplicate);
    let payload = edition_root(&root, &imported.item.edition_id).unwrap();
    let manifest: edition::Manifest =
        serde_json::from_slice(&std::fs::read(payload.join("manifest.json")).unwrap()).unwrap();
    std::fs::remove_file(root.join(manifest.source_path)).unwrap();
    let typesets = typography::TYPESETS.with(|n| n.get());
    let (doc, _) =
        edition::resolve(&root, &imported.item.edition_id, &FormatRegistry::default()).unwrap();
    assert_eq!(doc.format_id(), markdown::MARKDOWN);
    for index in 0..doc.page_count() {
        doc.render_page(
            index,
            RenderRequest {
                width: 400,
                height: 560,
            },
        )
        .unwrap();
    }
    assert_eq!(typography::TYPESETS.with(|n| n.get()), typesets);
}
#[test]
fn markdown_requires_name_and_utf8_not_a_binary_disguise() {
    assert!(markdown::parse(&format!("```\n{}\n```", "\n".repeat(100_001))).is_err());
    let file = tempfile::NamedTempFile::new().unwrap();
    let registry = FormatRegistry::default();
    for text in [
        "Just plain text",
        "<div>HTML remains literal</div>",
        "\u{feff}# Heading",
    ] {
        std::fs::write(file.path(), text).unwrap();
        assert!(registry.detect(file.path()).is_err());
        assert_eq!(
            registry
                .detect_named(file.path(), "a.markdown")
                .unwrap()
                .format_id(),
            markdown::MARKDOWN
        );
    }
    for bytes in [b"bad\0text".as_slice(), b"\xff\xfe", b"PK\x03\x04broken"] {
        std::fs::write(file.path(), bytes).unwrap();
        assert!(registry.detect_named(file.path(), "fake.md").is_err());
    }
    std::fs::write(file.path(), b"%PDF-1.7\n").unwrap();
    assert_eq!(
        registry
            .detect_named(file.path(), "fake.md")
            .unwrap()
            .format_id(),
        crate::reader::pdf::PDF
    );
}
#[test]
#[ignore = "external corpus: set GJOA_TEST_CORPUS_DIR and run explicitly with --ignored"]
fn supplied_cbz_corpus() {
    let temp = tempfile::tempdir().unwrap();
    let mut library = Library::new(temp.path()).unwrap();
    for (name, count) in [
        ("1_01_.cbz", 46),
        ("Volume 01.cbz", 205),
        ("Volume 02.cbz", 164),
    ] {
        let path = crate::test_corpus::directory().join(name);
        let imported = library.import_path(&path, None).unwrap();
        assert_eq!(imported.item.page_count, count);
        let (doc, _) = edition::resolve(
            temp.path(),
            &imported.item.edition_id,
            &FormatRegistry::default(),
        )
        .unwrap();
        for index in [0, count / 2, count - 1] {
            doc.render_page(
                index,
                RenderRequest {
                    width: 400,
                    height: 560,
                },
            )
            .unwrap();
        }
        eprintln!(
            "{name}: {count} pages, {:.2}s import; reopened and rendered first/middle/last",
            imported.total_ms / 1000.0
        );
    }
}
