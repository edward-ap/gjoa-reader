use super::*;
use crate::{
    library::{Library, edition},
    reader::{
        format::{DocumentFormatHandler, ProbeResult},
        registry::FormatRegistry,
        sources::Fb2FormatHandler,
    },
};
#[test]
fn natural_paths_and_bounded_xml_probe() {
    let mut names = vec!["part2/10.jpg", "part10/1.jpg", "part2/2.jpg", "part2/1.jpg"];
    names.sort_by(|a, b| cbr::natural_cmp(a, b));
    assert_eq!(
        names,
        ["part2/1.jpg", "part2/2.jpg", "part2/10.jpg", "part10/1.jpg"]
    );
    for junk in ["__MACOSX/1.jpg", ".DS_Store", "folder/.1.png", "notes.txt"] {
        assert!(!cbr::page_name(junk).unwrap());
    }
    for unsafe_name in ["../1.jpg", "C:/1.jpg", "/1.jpg", "folder/../../1.jpg"] {
        assert!(cbr::page_name(unsafe_name).is_err());
    }
    let xml = "\u{feff}<?xml version=\"1.0\"?>\n    <FictionBook xmlns=\"http://www.gribuser.ru/xml/fictionbook/2.0\">";
    assert_eq!(
        Fb2FormatHandler.probe(&xml.as_bytes()[..16]),
        ProbeResult::Candidate
    );
    assert_eq!(
        Fb2FormatHandler.deep_probe(xml.as_bytes()),
        ProbeResult::Supported
    );
    let file = tempfile::NamedTempFile::new().unwrap();
    std::fs::write(file.path(), format!("{}<FictionBook/>", " ".repeat(65536))).unwrap();
    assert!(FormatRegistry::default().detect(file.path()).is_err());
    assert!(!matches!(
        Fb2FormatHandler.deep_probe(b"<!DOCTYPE FictionBook [<!ENTITY a 'x'>]><FictionBook/>"),
        ProbeResult::Supported
    ));
}
#[test]
#[ignore = "external corpus: set GJOA_TEST_CORPUS_DIR and run explicitly with --ignored"]
fn real_publications_reopen_without_sources_or_republication() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("library");
    let mut library = Library::new(&root).unwrap();
    let fixtures = crate::test_corpus::directory();
    let mut imported = vec![];
    for entry in std::fs::read_dir(fixtures).unwrap() {
        let path = entry.unwrap().path();
        if path
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("Donald Duck")
        {
            continue;
        }
        if !matches!(
            path.extension().and_then(|e| e.to_str()),
            Some("cbr" | "fb2")
        ) {
            continue;
        }
        let result = library
            .import_path(&path, None)
            .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
        let id = &result.item.edition_id;
        let manifest_bytes =
            std::fs::read(root.join(edition::manifest_relative(id).unwrap())).unwrap();
        let manifest: Manifest = serde_json::from_slice(&manifest_bytes).unwrap();
        if manifest.format == "fb2" {
            assert_eq!(manifest.publisher_version, CURRENT_PUBLISHER_VERSION);
            assert_ne!(
                manifest.edition_id,
                identity_version(
                    &manifest.source_id,
                    "fb2",
                    crate::reader::format::PublicationKind::GeneratedLayout,
                    1
                )
            );
        }
        assert!(manifest.page_count > 10);
        let parses = fb2::PARSES.with(|n| n.get());
        let typesets = typography::TYPESETS.with(|n| n.get());
        let duplicate = library.import_path(&path, None).unwrap();
        assert!(duplicate.duplicate);
        assert_eq!(duplicate.publication_ms, 0.);
        // Remove only the test Library's source object. Neither new payload requires it.
        std::fs::remove_file(root.join(&manifest.source_path)).unwrap();
        let (doc, _) = edition::resolve(&root, id, &FormatRegistry::default()).unwrap();
        for width in [160, 800, 1600] {
            let page = doc.page_info(1).unwrap();
            let height = (width as f64 * page.height as f64 / page.width as f64).round() as u32;
            let raster = doc.render_page(1, RenderRequest { width, height }).unwrap();
            assert_eq!(raster.rgba.len(), width as usize * height as usize * 4);
            assert!(raster.rgba.chunks_exact(4).any(|p| p[0] < 240));
            assert_eq!(doc.page_count(), manifest.page_count);
        }
        assert_eq!(fb2::PARSES.with(|n| n.get()), parses);
        assert_eq!(typography::TYPESETS.with(|n| n.get()), typesets);
        assert_eq!(
            std::fs::read(root.join(edition::manifest_relative(id).unwrap())).unwrap(),
            manifest_bytes
        );
        library.save_progress(result.item.id, 10).unwrap();
        imported.push(result.item);
    }
    assert!(
        imported.len() >= 4,
        "Keep the original CBR/FB2 regression corpus"
    );
    drop(library);
    let library = Library::new(&root).unwrap();
    for item in imported {
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
fn semantic_layout_is_deterministic_and_corruption_is_rejected() {
    let temp = tempfile::tempdir().unwrap();
    let xml = r##"<?xml version="1.0"?><FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><author><first-name>A</first-name><last-name>Writer</last-name></author><book-title>Proof</book-title></title-info></description><body><section id="chapter"><title><p>Chapter</p></title><p>Regular <strong>bold</strong> <emphasis>italic</emphasis> <strong><emphasis>both</emphasis></strong> ☺ <a l:href="#note" type="note">1</a></p><epigraph><p>Quote.</p><text-author>Author</text-author></epigraph><poem><stanza><v>A verse.</v></stanza></poem></section></body><body name="notes"><section id="note"><p>A note.</p></section></body></FictionBook>"##;
    let input = temp.path().join("source.bin");
    std::fs::write(&input, xml).unwrap();
    let source = crate::library::store::hash_reader(xml.as_bytes()).unwrap();
    let staging = temp.path().join("staging");
    std::fs::create_dir(&staging).unwrap();
    let registry = FormatRegistry::default();
    let handler = registry.detect(&input).unwrap();
    let first = prepare(&source, handler, &input, &staging).unwrap();
    let second = prepare(&source, handler, &input, &staging).unwrap();
    assert_eq!(
        serde_json::to_vec(&first.manifest).unwrap(),
        serde_json::to_vec(&second.manifest).unwrap()
    );
    let root = first.directory.as_ref().unwrap().path();
    let page: typography::PageLayout = serde_json::from_slice(
        &read_file(root, &first.manifest.page_files[0], 16 * 1024 * 1024).unwrap(),
    )
    .unwrap();
    let fonts = page
        .items
        .iter()
        .filter_map(|item| {
            if let typography::Item::GlyphRun { font, .. } = item {
                Some(*font)
            } else {
                None
            }
        })
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(fonts, [0, 1, 2, 3].into_iter().collect());
    assert_eq!(
        first.manifest.metadata.as_ref().unwrap().title.as_deref(),
        Some("Proof")
    );
    let doc = open_payload(root, &first.manifest).unwrap();
    doc.render_page(
        0,
        RenderRequest {
            width: 800,
            height: 1120,
        },
    )
    .unwrap();
    let file = &first.manifest.page_files[0];
    let path = root.join(&file.path);
    let mut bytes = std::fs::read(&path).unwrap();
    bytes[0] ^= 1;
    std::fs::write(&path, bytes).unwrap();
    assert!(
        doc.render_page(
            0,
            RenderRequest {
                width: 80,
                height: 112
            }
        )
        .is_err()
    );
}

#[test]
fn invalid_fb2_leaves_no_library_artifacts() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("library");
    let mut library = Library::new(&root).unwrap();
    let path = temp.path().join("bad.fb2");
    for xml in [
        "<FictionBook/>",
        "<!DOCTYPE FictionBook [<!ENTITY a 'test'>]><FictionBook>&a;</FictionBook>",
        "<FictionBook xmlns='http://www.gribuser.ru/xml/fictionbook/2.0'><description><title-info/></description><body><image href='#missing'/></body></FictionBook>",
    ] {
        std::fs::write(&path, xml).unwrap();
        assert!(library.import_path(&path, None).is_err());
        assert!(library.list().unwrap().items.is_empty());
        assert_eq!(std::fs::read_dir(root.join("staging")).unwrap().count(), 0);
        assert_eq!(std::fs::read_dir(root.join("editions")).unwrap().count(), 0);
    }
}
