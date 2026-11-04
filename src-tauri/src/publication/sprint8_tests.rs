use super::*;
use crate::{
    library::{Library, edition},
    reader::{document::RenderRequest, registry::FormatRegistry},
};
use std::io::Write;
fn epub_file(path: &Path, css: &str, body: &str) {
    let mut zip = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    let opf = r#"<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Proof</dc:title><dc:creator>Writer</dc:creator></metadata><manifest><item id="second" href="second.xhtml" media-type="application/xhtml+xml"/><item id="first" href="first.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="first"/><itemref idref="second"/></spine></package>"#;
    let html = format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><style>{css}</style></head><body>{body}</body></html>"#
    );
    // Archive order deliberately disagrees with the reading order.
    for (name, content) in [
        ("mimetype", "application/epub+zip"),
        (
            "META-INF/container.xml",
            r#"<container><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>"#,
        ),
        ("OPS/book.opf", opf),
        (
            "OPS/second.xhtml",
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><body><p>SECOND</p></body></html>"#,
        ),
        ("OPS/first.xhtml", &html),
    ] {
        zip.start_file(name, options).unwrap();
        zip.write_all(content.as_bytes()).unwrap();
    }
    zip.finish().unwrap();
}
#[test]
fn epub_spine_semantics_and_css_independence() {
    let temp = tempfile::tempdir().unwrap();
    let staging = temp.path().join("staging");
    std::fs::create_dir(&staging).unwrap();
    let mut outputs = vec![];
    for (index, css) in [
        "p {font: 8px Comic Sans; margin: 17%;}",
        "body {font-size: 100px; color: red;}",
    ]
    .iter()
    .enumerate()
    {
        let path = temp.path().join(format!("{index}.bin"));
        epub_file(
            &path,
            css,
            "<h1>FIRST</h1><p>Normal <strong>bold</strong> <em>italic</em>.</p><blockquote><p>Quote</p></blockquote><ol start='3'><li>Ordered</li><li>Next</li></ol><ul><li>Bullet</li></ul><script>ignore()</script>",
        );
        let source =
            crate::library::store::hash_reader(std::fs::File::open(&path).unwrap()).unwrap();
        let registry = FormatRegistry::default();
        let handler = registry.detect(&path).unwrap();
        assert_eq!(handler.format_id(), epub::EPUB);
        let prepared = prepare(&source, handler, &path, &staging).unwrap();
        let root = prepared.directory.as_ref().unwrap().path();
        let model: model::Publication =
            serde_json::from_slice(&std::fs::read(root.join("publication.json")).unwrap()).unwrap();
        assert!(model.text.find("FIRST").unwrap() < model.text.find("SECOND").unwrap());
        assert!(!model.text.contains("ignore"));
        assert!(model.text.contains("3. Ordered"));
        assert!(model.text.contains("• Bullet"));
        assert!(model.blocks.iter().any(|block| matches!(
            block,
            model::Block::Paragraph {
                style: model::ParagraphKind::Heading,
                ..
            }
        )));
        assert!(model.blocks.iter().any(|block| matches!(
            block,
            model::Block::Paragraph {
                style: model::ParagraphKind::Quote,
                ..
            }
        )));
        for (word, bold, italic) in [("bold", true, false), ("italic", false, true)] {
            assert!(model.blocks.iter().any(|block| match block {
                model::Block::Paragraph { spans, .. } => spans.iter().any(|span| {
                    model.text[span.start..span.end].contains(word)
                        && span.style.bold == bold
                        && span.style.italic == italic
                }),
                _ => false,
            }));
        }
        assert_eq!(
            model
                .blocks
                .iter()
                .filter(|b| matches!(b, model::Block::Paragraph { list: Some(_), .. }))
                .count(),
            3
        );
        outputs.push((
            prepared.manifest.page_files.clone(),
            crate::library::store::hash_reader(
                std::fs::File::open(root.join("publication.json")).unwrap(),
            )
            .unwrap(),
        ));
    }
    assert_eq!(outputs[0], outputs[1]);
}
#[test]
#[ignore = "external corpus: set GJOA_TEST_CORPUS_DIR and run explicitly with --ignored"]
fn six_real_sources_reopen_and_epub_never_republishes() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("library");
    let mut library = Library::new(&root).unwrap();
    let mut items = vec![];
    for entry in std::fs::read_dir(crate::test_corpus::directory()).unwrap() {
        let path = entry.unwrap().path();
        if !matches!(
            path.extension().and_then(|e| e.to_str()),
            Some("pdf" | "epub")
        ) {
            continue;
        }
        let imported = library
            .import_path(&path, None)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let manifest: Manifest = serde_json::from_slice(
            &std::fs::read(
                root.join(edition::manifest_relative(&imported.item.edition_id).unwrap()),
            )
            .unwrap(),
        )
        .unwrap();
        let parses = epub::PARSES.with(|n| n.get());
        let typesets = typography::TYPESETS.with(|n| n.get());
        let duplicate = library.import_path(&path, None).unwrap();
        assert!(duplicate.duplicate);
        assert_eq!(duplicate.publication_ms, 0.);
        if manifest.kind == "generated-layout" {
            std::fs::remove_file(root.join(&manifest.source_path)).unwrap();
        }
        let (doc, _) =
            edition::resolve(&root, &imported.item.edition_id, &FormatRegistry::default()).unwrap();
        for width in [160, 800, 1600] {
            let info = doc.page_info(10).unwrap();
            let height = (width as f64 * info.height as f64 / info.width as f64).round() as u32;
            let raster = doc
                .render_page(10, RenderRequest { width, height })
                .unwrap();
            assert_eq!(raster.rgba.len(), width as usize * height as usize * 4);
            assert!(raster.rgba.chunks_exact(4).any(|p| p[0] < 240));
            assert_eq!(doc.page_count(), manifest.page_count);
        }
        assert_eq!(epub::PARSES.with(|n| n.get()), parses);
        assert_eq!(typography::TYPESETS.with(|n| n.get()), typesets);
        library.save_progress(imported.item.id, 10).unwrap();
        items.push(imported.item);
    }
    // Users may add PDF/EPUB fixtures; retain the baseline coverage minimum.
    assert!(
        items.len() >= 6,
        "Expected at least the six baseline PDF/EPUB fixtures"
    );
    drop(library);
    let library = Library::new(&root).unwrap();
    for item in items {
        assert_eq!(library.item(item.id).unwrap().page_index, Some(10));
        let (doc, _) =
            edition::resolve(&root, &item.edition_id, &FormatRegistry::default()).unwrap();
        assert_eq!(doc.page_count(), item.page_count);
        doc.render_page(
            10,
            RenderRequest {
                width: 160,
                height: 224,
            },
        )
        .unwrap();
    }
}
#[test]
fn invalid_epub_resources_fail_without_residue() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("library");
    let mut library = Library::new(&root).unwrap();
    let path = temp.path().join("bad.epub");
    for href in [
        "../../outside.png",
        "https://example.invalid/image.png",
        "%💥",
        "missing.png",
    ] {
        epub_file(&path, "", &format!("<p>Text</p><img src='{href}'/>"));
        assert!(library.import_path(&path, None).is_err());
        assert!(library.list().unwrap().items.is_empty());
        assert_eq!(std::fs::read_dir(root.join("staging")).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(root.join("editions")).unwrap().count(), 0);
    }
}
