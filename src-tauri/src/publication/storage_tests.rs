use super::*;
use crate::{
    library::{Library, edition},
    reader::registry::FormatRegistry,
};

#[test]
fn v2_reuses_fonts_preserves_v1_semantics_and_rejects_corruption() {
    let temp = tempfile::tempdir().unwrap();
    let root = dunce::canonicalize(temp.path()).unwrap();
    let input = root.join("test.fb2");
    std::fs::write(&input,r#"<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>Storage proof</book-title></title-info></description><body><section><title><p>Heading</p></title><p>Plain <strong>bold</strong> <emphasis>italic</emphasis> and <sup>superscript</sup>.</p></section></body></FictionBook>"#).unwrap();
    let mut library = Library::new(&root.join("library")).unwrap();
    let source = crate::library::store::hash_reader(std::fs::File::open(&input).unwrap()).unwrap();
    let registry = FormatRegistry::default();
    let handler = registry.detect(&input).unwrap();
    let v1 = prepare(&source, handler, &input, &library.root.join("staging")).unwrap();
    let legacy_root = v1.directory.as_ref().unwrap().path();
    let legacy_bytes = serde_json::to_vec_pretty(&v1.manifest).unwrap();
    let old_doc = open_payload(legacy_root, &v1.manifest).unwrap();
    let item = library.import_path(&input, None).unwrap().item;
    let payload = edition_root(&library.root, &item.edition_id).unwrap();
    let manifest_path = payload.join("manifest.json");
    let mut v2: Manifest = serde_json::from_slice(&std::fs::read(&manifest_path).unwrap()).unwrap();
    assert_eq!(v2.storage_version, 4);
    assert_eq!(v2.shared_fonts.len(), typography::CURRENT_FONTS.len());
    assert!(!payload.join("assets/fonts/0.ttf").exists());
    assert!(!payload.join("pages/000001.json").exists());
    assert_eq!(
        serde_json::to_vec_pretty(&storage::legacy_manifest(&payload, &v2).unwrap()).unwrap(),
        legacy_bytes
    );
    let (new_doc, _) = edition::resolve(&library.root, &item.edition_id, &registry).unwrap();
    for width in [160, 800, 1600] {
        let request = RenderRequest {
            width,
            height: width * 1120 / 800,
        };
        assert_eq!(
            old_doc.render_page(0, request).unwrap().rgba,
            new_doc.render_page(0, request).unwrap().rgba
        );
    }
    let other = root.join("second.fb2");
    std::fs::write(
        &other,
        std::fs::read_to_string(&input)
            .unwrap()
            .replace("Storage proof", "Second book"),
    )
    .unwrap();
    library.import_path(&other, None).unwrap();
    assert_eq!(
        std::fs::read_dir(library.root.join("fonts"))
            .unwrap()
            .count(),
        typography::CURRENT_FONTS.len()
    );
    let db = rusqlite::Connection::open(library.root.join("library.db")).unwrap();
    db.execute_batch("CREATE TRIGGER fail_shared_import BEFORE INSERT ON library_items BEGIN SELECT RAISE(ABORT,'injected commit failure'); END;").unwrap();
    std::fs::write(
        &other,
        std::fs::read_to_string(&input)
            .unwrap()
            .replace("Storage proof", "Failed book"),
    )
    .unwrap();
    assert!(library.import_path(&other, None).is_err());
    assert_eq!(
        std::fs::read_dir(library.root.join("fonts"))
            .unwrap()
            .count(),
        typography::CURRENT_FONTS.len()
    );
    assert_eq!(library.list().unwrap().items.len(), 2);
    edition::resolve(&library.root, &item.edition_id, &registry).unwrap();
    let font = library.root.join(&v2.shared_fonts[0].path);
    let font_bytes = std::fs::read(&font).unwrap();
    std::fs::write(&font, vec![0; font_bytes.len()]).unwrap();
    assert!(edition::resolve(&library.root, &item.edition_id, &registry).is_err());
    std::fs::write(&font, &font_bytes).unwrap();
    std::fs::rename(&font, font.with_extension("held")).unwrap();
    assert!(edition::resolve(&library.root, &item.edition_id, &registry).is_err());
    std::fs::rename(font.with_extension("held"), &font).unwrap();
    v2.storage_version = 99;
    std::fs::write(&manifest_path, serde_json::to_vec(&v2).unwrap()).unwrap();
    assert!(edition::resolve(&library.root, &item.edition_id, &registry).is_err());
    v2.storage_version = 4;
    v2.shared_fonts[0].path = "../escape.ttf".into();
    std::fs::write(&manifest_path, serde_json::to_vec(&v2).unwrap()).unwrap();
    assert!(edition::resolve(&library.root, &item.edition_id, &registry).is_err());
    // The independently prepared v1 payload and its byte-identical manifest remain readable.
    assert_eq!(
        serde_json::to_vec_pretty(&v1.manifest).unwrap(),
        legacy_bytes
    );
    old_doc
        .render_page(
            0,
            RenderRequest {
                width: 160,
                height: 224,
            },
        )
        .unwrap();
}
