use super::*;

#[test]
fn cancel_before_saving_discards_staging_and_allows_next_import() {
    let temp = tempfile::tempdir().unwrap();
    let mut library = Library::new(temp.path()).unwrap();
    let bytes = br#"<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>Cancel probe</book-title></title-info></description><body><section><p>One short paragraph.</p></section></body></FictionBook>"#;
    let id = library.begin("probe.fb2", bytes.len() as u64).unwrap();
    library.append(id, bytes).unwrap();
    let token_id = u64::MAX - 1;
    crate::import_cancel::register(token_id);
    let scope = crate::import_cancel::Scope::enter(crate::import_cancel::token(token_id));
    let result = library.finish_with_progress(id, None, |stage| {
        if stage == "Saving" {
            crate::import_cancel::cancel(token_id);
        }
    });
    assert!(
        result
            .err()
            .expect("import must be canceled")
            .to_string()
            .contains("canceled")
    );
    drop(scope);
    crate::import_cancel::remove(token_id);
    assert!(library.list().unwrap().items.is_empty());
    assert_eq!(
        fs::read_dir(temp.path().join("staging")).unwrap().count(),
        0
    );
    let id = library.begin("next.fb2", bytes.len() as u64).unwrap();
    library.append(id, bytes).unwrap();
    library.finish(id, None).unwrap();
    assert_eq!(library.list().unwrap().items.len(), 1);
}

fn prose_pdf(path: &Path, with_text: bool) {
    let stream = if with_text {
        "BT /F1 12 Tf 40 720 Td (A dependable publication contains ordinary readable text.) Tj 0 -18 Td (It preserves the original while offering a separate Reader edition.) Tj ET"
    } else {
        ""
    };
    prose_pdf_stream(path, stream);
}
fn prose_pdf_stream(path: &Path, stream: &str) {
    let objects=["<< /Type /Catalog /Pages 2 0 R >>".to_owned(),"<< /Type /Pages /Kids [3 0 R] /Count 1 >>".into(),"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>".into(),"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".into(),format!("<< /Length {} >>\nstream\n{stream}\nendstream",stream.len())];
    let mut bytes = b"%PDF-1.4\n".to_vec();
    let mut offsets = vec![];
    for (i, o) in objects.iter().enumerate() {
        offsets.push(bytes.len());
        bytes.extend_from_slice(format!("{} 0 obj\n{o}\nendobj\n", i + 1).as_bytes());
    }
    let xref = bytes.len();
    bytes.extend_from_slice(b"xref\n0 6\n0000000000 65535 f \n");
    for offset in offsets {
        bytes.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    bytes.extend_from_slice(
        format!("trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF").as_bytes(),
    );
    fs::write(path, bytes).unwrap();
}
#[test]
fn text_free_pdf_layers_are_one_faithful_composite() {
    use crate::reader::document::{Document, RenderRequest};
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("layers.pdf");
    prose_pdf_stream(
        &source,
        "1 0 0 rg 0 0 600 800 re f 0 0 0 rg 100 100 400 600 re f",
    );
    let assets = temp.path().join("assets");
    let evidence = crate::reader::pdf::extract_evidence(&source, &assets).unwrap();
    assert_eq!(evidence.pages[0].images.len(), 1);
    let composite = image::open(assets.join(evidence.pages[0].images[0].asset.as_ref().unwrap()))
        .unwrap()
        .to_rgba8();
    let native = crate::reader::pdf::PdfSourceDocument::open(&source).unwrap();
    let raster = native
        .render_page(
            0,
            RenderRequest {
                width: composite.width(),
                height: composite.height(),
            },
        )
        .unwrap();
    assert_eq!(composite.into_raw(), raster.rgba);
    let blank = temp.path().join("blank.pdf");
    prose_pdf_stream(&blank, "1 1 1 rg 0 0 600 800 re f");
    let blank_evidence =
        crate::reader::pdf::extract_evidence(&blank, &temp.path().join("blank-assets")).unwrap();
    assert!(blank_evidence.pages[0].images.is_empty());
}

#[test]
fn pdf_fast_and_deep_have_distinct_persistent_identities() {
    use crate::publication::{
        pdf_experiment::{self, PdfManuscriptStrategy},
        typography,
    };
    use crate::reader::document::RenderRequest;
    let temp = tempfile::tempdir().unwrap();
    let source = temp.path().join("prose.pdf");
    prose_pdf(&source, true);
    let root = temp.path().join("library");
    let mut library = Library::new(&root).unwrap();
    let original = library.import_path(&source, None).unwrap();
    assert!(original.preferred_item_id.is_none()); // Production is Original-only.
    let source_id = store::hash_reader(fs::File::open(&source).unwrap()).unwrap();
    let mut deep = pdf_experiment::prepare(
        &source_id,
        &source,
        &root.join("staging"),
        PdfManuscriptStrategy::Deep,
        temp.path(),
    )
    .unwrap()
    .unwrap();
    deep.install(&root).unwrap();
    let mut fast = pdf_experiment::prepare(
        &source_id,
        &source,
        &root.join("staging"),
        PdfManuscriptStrategy::Fast,
        temp.path(),
    )
    .unwrap()
    .unwrap();
    assert_ne!(fast.manifest.edition_id, deep.manifest.edition_id);
    fast.install(&root).unwrap();
    let registry = FormatRegistry::default();
    let typesets = typography::TYPESETS.with(|n| n.get());
    // Remove only this fixture's external source. Generated editions open their saved payloads.
    fs::remove_file(&source).unwrap();
    for id in [&deep.manifest.edition_id, &fast.manifest.edition_id] {
        let (doc, _) = edition::resolve(&root, id, &registry).unwrap();
        let request = RenderRequest {
            width: 320,
            height: 448,
        };
        let first = doc.render_page(0, request).unwrap().rgba;
        drop(doc);
        let (doc, _) = edition::resolve(&root, id, &registry).unwrap();
        assert_eq!(first, doc.render_page(0, request).unwrap().rgba);
    }
    assert_eq!(typesets, typography::TYPESETS.with(|n| n.get()));
    assert_eq!(fast.manifest.source_id, source_id);
    assert_eq!(count(&library, "sources"), 1);
    let blank = temp.path().join("blank.pdf");
    prose_pdf(&blank, false);
    assert!(
        pdf_experiment::prepare(
            &source_id,
            &blank,
            &root.join("staging"),
            PdfManuscriptStrategy::Fast,
            temp.path()
        )
        .unwrap()
        .is_none()
    );
}

fn book(prefix: &str) -> PathBuf {
    fs::read_dir(crate::test_corpus::directory())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(prefix)
        })
        .unwrap()
}
fn count(library: &Library, table: &str) -> i64 {
    library
        .db
        .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
        .unwrap()
}
#[test]
#[ignore = "external corpus: set GJOA_TEST_CORPUS_DIR and run explicitly with --ignored"]
fn source_edition_dedup_external_removal_and_folders_survive_restart() {
    let temp = tempfile::tempdir().unwrap();
    let external = temp.path().join("renamed.djvu");
    fs::copy(book("УЭЛЛС"), &external).unwrap();
    let root = temp.path().join("library");
    let mut library = Library::new(&root).unwrap();
    let first = library.import_path(&external, None).unwrap();
    assert_eq!(first.item.page_count, 44);
    assert_eq!(first.item.page_index, None);
    let duplicate = library.import_path(&book("УЭЛЛС"), None).unwrap();
    assert!(duplicate.duplicate);
    assert_eq!(duplicate.item.id, first.item.id);
    for table in ["sources", "editions", "library_items"] {
        assert_eq!(count(&library, table), 1);
    }
    let manifest_path = root.join(edition::manifest_relative(&first.item.edition_id).unwrap());
    let manifest_bytes = fs::read(&manifest_path).unwrap();
    let manifest: edition::Manifest = serde_json::from_slice(&manifest_bytes).unwrap();
    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.pages.len(), 44);
    assert_eq!(
        manifest.edition_id,
        edition::edition_id(&manifest.source_id, "djvu")
    );
    assert_eq!(
        fs::read(root.join(&manifest.source_path)).unwrap(),
        fs::read(&external).unwrap()
    );
    fs::remove_file(external).unwrap();
    let (doc, _) =
        edition::resolve(&root, &first.item.edition_id, &FormatRegistry::default()).unwrap();
    assert_eq!(
        doc.render_page(
            3,
            crate::reader::document::RenderRequest {
                width: 80,
                height: 100
            }
        )
        .unwrap()
        .rgba
        .len(),
        32000
    );
    let parent = library.create_folder(None, "Science Fiction").unwrap();
    let child = library.create_folder(Some(parent), "Classic").unwrap();
    assert!(library.create_folder(None, " SCIENCE FICTION ").is_err());
    assert!(library.delete_folder(parent).is_err());
    library
        .move_item(first.item.id, Some(child), false)
        .unwrap();
    assert!(library.delete_folder(child).is_err());
    library.save_progress(first.item.id, 43).unwrap();
    assert!(library.save_progress(first.item.id, 44).is_err());
    drop(library);
    let library = Library::new(&root).unwrap();
    let item = library.item(first.item.id).unwrap();
    assert_eq!(item.folder_id, Some(child));
    assert!(!item.inbox);
    assert_eq!(item.page_index, Some(43));
    assert_eq!(library.list().unwrap().folders.len(), 2);
    library.rename_folder(child, "Classics").unwrap();
    library.move_item(item.id, None, false).unwrap();
    assert!(!library.item(item.id).unwrap().inbox);
    library.move_item(item.id, None, true).unwrap();
    assert!(library.item(item.id).unwrap().inbox);
    library.delete_folder(child).unwrap();
    library.delete_folder(parent).unwrap();
    assert_eq!(fs::read(manifest_path).unwrap(), manifest_bytes);
    assert_eq!(
        store::hash_reader(File::open(root.join(manifest.source_path)).unwrap()).unwrap(),
        manifest.source_id
    );
}
#[test]
fn failures_are_invisible_and_staging_is_clean() {
    let temp = tempfile::tempdir().unwrap();
    let mut library = Library::new(temp.path()).unwrap();
    assert!(library.begin("large.djvu", MAX_SOURCE_BYTES + 1).is_err());
    let id = library.begin("../../invalid.djvu", 8).unwrap();
    assert!(library.append(id, &[0; 9]).is_err());
    assert!(
        library
            .append(id, &vec![0; store::CHUNK_BYTES + 1])
            .is_err()
    );
    library.cancel(id + 1);
    assert!(library.begin("other", 1).is_err());
    assert!(library.finish(id, None).is_err());
    let invalid = temp.path().join("bad.djvu");
    fs::write(&invalid, b"AT&TFORMbad-DJVU").unwrap();
    assert!(library.import_path(&invalid, None).is_err());
    for bytes in [
        b"%PDF-1.7".as_slice(),
        b"PK\x03\x04",
        b"Rar!\x1a\x07\x00",
        b"<FictionBook/>",
    ] {
        fs::write(&invalid, bytes).unwrap();
        assert!(library.import_path(&invalid, None).is_err());
    }
    for table in ["sources", "editions", "library_items"] {
        assert_eq!(count(&library, table), 0);
    }
    assert_eq!(
        fs::read_dir(temp.path().join("staging")).unwrap().count(),
        0
    );
    assert_eq!(
        fs::read_dir(temp.path().join("editions")).unwrap().count(),
        0
    );
    library.db.execute_batch("CREATE TRIGGER fail_import BEFORE INSERT ON library_items BEGIN SELECT RAISE(ABORT,'injected disk/index failure'); END;").unwrap();
    // Exercise a native extracted-image edition without shipping a private book.
    // It must compensate the same failed SQL commit as generated publication.
    let comic = temp.path().join("valid.cbz");
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        8,
        12,
        image::Rgba([45, 80, 120, 255]),
    ))
    .write_to(&mut png, image::ImageFormat::Png)
    .unwrap();
    let mut archive = zip::ZipWriter::new(File::create(&comic).unwrap());
    archive
        .start_file("page.png", zip::write::SimpleFileOptions::default())
        .unwrap();
    std::io::Write::write_all(&mut archive, &png.into_inner()).unwrap();
    archive.finish().unwrap();
    assert!(library.import_path(&comic, None).is_err());
    let generated = temp.path().join("valid.fb2");
    fs::write(&generated, r#"<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>Rollback</book-title></title-info></description><body><section><p>Generated edition rollback.</p></section></body></FictionBook>"#).unwrap();
    assert!(library.import_path(&generated, None).is_err());
    assert_eq!(count(&library, "sources"), 0);
    assert_eq!(count(&library, "edition_thumbnails"), 0);
    assert_eq!(
        std::fs::read_dir(temp.path().join("fonts"))
            .unwrap()
            .count(),
        0
    );
    assert_eq!(
        fs::read_dir(temp.path().join("editions")).unwrap().count(),
        0
    );
    for prefix in fs::read_dir(temp.path().join("objects/sha256")).unwrap() {
        assert_eq!(fs::read_dir(prefix.unwrap().path()).unwrap().count(), 0);
    }
}
#[test]
fn checked_paths_schema_lock_cleanup_and_folder_rules() {
    let temp = tempfile::tempdir().unwrap();
    let library = Library::new(temp.path()).unwrap();
    assert!(Library::new(temp.path()).is_err());
    for path in [
        "../outside",
        "C:/outside",
        "/outside",
        "objects/../../outside",
        "objects\\outside",
    ] {
        assert!(store::checked_path(temp.path(), path).is_err());
    }
    for name in ["", "  ", "a/b", "a\\b", "a\nb"] {
        assert!(library.create_folder(None, name).is_err());
    }
    assert!(library.create_folder(None, &"a".repeat(101)).is_err());
    assert!(library.rename_folder(0, "New").is_err());
    assert!(library.delete_folder(0).is_err());
    fs::write(temp.path().join("staging/upload-abandoned"), b"partial").unwrap();
    fs::write(temp.path().join("staging/other"), b"preserve").unwrap();
    drop(library);
    let library = Library::new(temp.path()).unwrap();
    assert!(!temp.path().join("staging/upload-abandoned").exists());
    assert!(temp.path().join("staging/other").exists());
    assert_eq!(
        library
            .db
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        8
    );
    library.db.execute_batch("PRAGMA user_version=9").unwrap();
    drop(library);
    assert!(Library::new(temp.path()).is_err());
    assert_eq!(
        store::hash_reader(&b"abc"[..]).unwrap(),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}
#[test]
#[ignore = "external corpus: set GJOA_TEST_CORPUS_DIR and run explicitly with --ignored"]
fn independent_progress_and_legacy_seed_never_overwrite_library_progress() {
    let temp = tempfile::tempdir().unwrap();
    let mut library = Library::new(temp.path()).unwrap();
    let a = library.import_path(&book("[ЗБФ]"), Some(99)).unwrap().item;
    let b = library
        .import_path(&book("ХАЙНЛАЙН"), Some(49))
        .unwrap()
        .item;
    drop(library);
    let mut library = Library::new(temp.path()).unwrap();
    assert_eq!(library.item(a.id).unwrap().page_index, Some(99));
    assert_eq!(library.item(b.id).unwrap().page_index, Some(49));
    library.import_path(&book("[ЗБФ]"), Some(1)).unwrap();
    assert_eq!(library.item(a.id).unwrap().page_index, Some(99));
    let manifest_path = temp
        .path()
        .join(edition::manifest_relative(&a.edition_id).unwrap());
    let mut manifest: edition::Manifest =
        serde_json::from_slice(&fs::read(&manifest_path).unwrap()).unwrap();
    manifest.source_path = "../outside.djvu".into();
    fs::write(manifest_path, serde_json::to_vec(&manifest).unwrap()).unwrap();
    assert!(edition::resolve(temp.path(), &a.edition_id, &FormatRegistry::default()).is_err());
}

#[test]
fn publisher_uses_generic_pages_and_rejects_failed_first_raster() {
    use crate::reader::{
        document::{Document, PageInfo, RenderRequest, RenderedPage},
        format::FormatId,
    };
    struct Paged {
        fail: bool,
    }
    impl Document for Paged {
        fn format_id(&self) -> FormatId {
            FormatId("test-paged")
        }
        fn page_count(&self) -> usize {
            2
        }
        fn page_info(&self, index: usize) -> crate::reader::document::Result<PageInfo> {
            Ok(PageInfo {
                width: 400 + index as u32,
                height: 600,
                dpi: None,
            })
        }
        fn render_page(
            &self,
            index: usize,
            request: RenderRequest,
        ) -> crate::reader::document::Result<RenderedPage> {
            assert_eq!(index, 0);
            assert!(request.width <= 160 && request.height <= 160);
            if self.fail {
                return Err("Injected publication failure".into());
            }
            Ok(RenderedPage {
                width: request.width,
                height: request.height,
                rgba: vec![255; request.byte_len()?],
            })
        }
    }
    let source = "a".repeat(64);
    let manifest = edition::NativePagedPublisher::publish(&source, &Paged { fail: false }).unwrap();
    assert_eq!(manifest.pages[1].width, 401);
    assert_eq!(manifest.format, "test-paged");
    assert_ne!(manifest.edition_id, edition::edition_id(&source, "djvu"));
    assert!(edition::NativePagedPublisher::publish(&source, &Paged { fail: true }).is_err());
}

#[test]
fn schema_one_migrates_and_recent_order_survives_restart() {
    let temp = tempfile::tempdir().unwrap();
    // The exact original schema remains the migration fixture.
    let db = Connection::open(temp.path().join("library.db")).unwrap();
    db.execute_batch(include_str!("schema.sql")).unwrap();
    for id in 1..=7 {
        db.execute(
            "INSERT INTO sources VALUES(?1,'djvu',1,'book','object-'||?1,1)",
            [id.to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO editions VALUES(?1,?1,'native',1,'djvu','manifest-'||?1,10,1)",
            [id.to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO library_items VALUES(?1,?1,'Title','Author',1,NULL,1)",
            [id],
        )
        .unwrap();
    }
    db.execute("INSERT INTO folders VALUES(1,NULL,'Folder','folder',1)", [])
        .unwrap();
    db.execute("INSERT INTO progress VALUES(1,3,1)", [])
        .unwrap();
    drop(db);
    let library = Library::new(temp.path()).unwrap();
    assert!(library.list().unwrap().recent.is_empty());
    for id in 1..=7 {
        library.mark_opened(id).unwrap();
    }
    assert_eq!(library.list().unwrap().recent, vec![7, 6, 5, 4, 3]);
    library.mark_opened(3).unwrap();
    assert_eq!(library.list().unwrap().recent, vec![3, 7, 6, 5, 4]);
    assert!(library.mark_opened(99).is_err());
    assert_eq!(library.item(1).unwrap().page_index, Some(3));
    assert_eq!(library.list().unwrap().folders[0].name, "Folder");
    drop(library);
    let library = Library::new(temp.path()).unwrap();
    assert_eq!(library.list().unwrap().recent, vec![3, 7, 6, 5, 4]);
    assert_eq!(count(&library, "sources"), 7);
    assert_eq!(count(&library, "editions"), 7);
    library.remove_recent(1).unwrap();
    library.remove_recent(3).unwrap();
    library.remove_recent(3).unwrap();
    assert_eq!(library.item(1).unwrap().page_index, Some(3));
    assert_eq!(count(&library, "library_items"), 7);
    drop(library);
    let library = Library::new(temp.path()).unwrap();
    assert!(!library.list().unwrap().recent.contains(&3));
    assert!(!library.list().unwrap().recent.contains(&1));
    assert_eq!(library.item(1).unwrap().page_index, Some(3));
    library.mark_opened(3).unwrap();
    assert_eq!(library.list().unwrap().recent[0], 3);
    library
        .db
        .execute("DELETE FROM library_items WHERE id=3", [])
        .unwrap();
    assert!(!library.list().unwrap().recent.contains(&3));
}

#[test]
#[ignore = "external corpus: set GJOA_TEST_CORPUS_DIR and run explicitly with --ignored"]
fn thumbnail_is_published_atomically_and_survives_restart_without_edition_files() {
    let temp = tempfile::tempdir().unwrap();
    let mut library = Library::new(temp.path()).unwrap();
    let result = library.import_path(&book("[ЗБФ]"), None).unwrap();
    let item = result.item;
    let bytes = library
        .cached_thumbnail(item.id)
        .unwrap()
        .expect("generated during import");
    let width = u32::from_le_bytes(bytes[..4].try_into().unwrap());
    let height = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    assert!(width > 0 && width <= 64 && height > 0 && height <= 88);
    assert_eq!(bytes.len(), 8 + (width * height * 4) as usize);
    assert!(library.import_path(&book("[ЗБФ]"), None).unwrap().duplicate);
    assert_eq!(count(&library, "edition_thumbnails"), 1);
    library.save_progress(item.id, 5).unwrap();
    library.mark_opened(item.id).unwrap();
    drop(library);

    // Simulate the pre-thumbnail schema; migration itself must not read any books.
    let db = Connection::open(temp.path().join("library.db")).unwrap();
    db.execute_batch("DROP TABLE edition_thumbnails; ALTER TABLE progress DROP COLUMN completed; DROP TABLE deletion_commits; DROP TABLE library_settings; DROP TABLE source_reconstructions; ALTER TABLE library_items DROP COLUMN display_name; PRAGMA user_version=2;")
        .unwrap();
    drop(db);
    let library = Library::new(temp.path()).unwrap();
    assert!(library.cached_thumbnail(item.id).unwrap().is_none());
    assert_eq!(library.thumbnail(item.id).unwrap(), bytes);
    assert_eq!(count(&library, "edition_thumbnails"), 1);
    assert_eq!(library.item(item.id).unwrap().page_index, Some(5));
    assert_eq!(library.list().unwrap().recent, vec![item.id]);
    drop(library);

    let manifest = temp
        .path()
        .join(edition::manifest_relative(&item.edition_id).unwrap());
    let before = fs::read(&manifest).unwrap();
    fs::rename(&manifest, manifest.with_extension("held")).unwrap();
    let library = Library::new(temp.path()).unwrap();
    // Cached reads work with the edition deliberately unavailable: no resolve/render.
    assert_eq!(library.thumbnail(item.id).unwrap(), bytes);
    assert!(library.thumbnail(i64::MAX).is_err());
    assert_eq!(fs::read(manifest.with_extension("held")).unwrap(), before);
}
#[test]
fn completed_progress_migrates_at_99_percent_and_keeps_position_independent() {
    assert!(!completion_reached(97, 100));
    assert!(completion_reached(98, 100));
    assert!(completion_reached(99, 100));
    assert!(!completion_reached(98, 101));
    assert!(completion_reached(99, 101));
    assert!(completion_reached(0, 1));
    assert!(!completion_reached(0, 0));
    let temp = tempfile::tempdir().unwrap();
    let db = Connection::open(temp.path().join("library.db")).unwrap();
    db.execute_batch(include_str!("schema.sql")).unwrap();
    db.execute_batch("CREATE TABLE recent_items(item_id INTEGER PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE, opened_order INTEGER NOT NULL);
        CREATE TABLE edition_thumbnails(edition_id TEXT PRIMARY KEY REFERENCES editions(id),version INTEGER NOT NULL,pixels BLOB NOT NULL);
        PRAGMA user_version=3;").unwrap();
    for (id, index) in [(1, 98), (2, 97), (3, 99)] {
        db.execute(
            "INSERT INTO sources VALUES(?1,'pdf',1,'book','object-'||?1,1)",
            [id.to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO editions VALUES(?1,?1,'native',1,'pdf','manifest-'||?1,100,1)",
            [id.to_string()],
        )
        .unwrap();
        db.execute(
            "INSERT INTO library_items VALUES(?1,?1,'Title',NULL,1,NULL,1)",
            [id],
        )
        .unwrap();
        db.execute("INSERT INTO progress VALUES(?1,?2,42)", params![id, index])
            .unwrap();
    }
    drop(db);
    let library = Library::new(temp.path()).unwrap();
    assert!(library.item(1).unwrap().completed);
    assert!(!library.item(2).unwrap().completed);
    assert!(library.item(3).unwrap().completed);
    assert_eq!(library.item(1).unwrap().page_index, Some(98));
    let item = library.save_progress(1, 0).unwrap();
    assert!(item.completed);
    assert_eq!(item.page_index, Some(0));
    assert!(!library.save_progress(2, 0).unwrap().completed);
    assert!(library.save_progress(2, 98).unwrap().completed);
    assert!(library.save_progress(2, 0).unwrap().completed);
    assert!(library.save_progress(2, 100).is_err());
    drop(library);
    let reopened = Library::new(temp.path()).unwrap();
    assert!(reopened.item(1).unwrap().completed);
    assert!(reopened.item(2).unwrap().completed);
    assert_eq!(reopened.item(2).unwrap().page_index, Some(0));
    assert_eq!(reopened.list().unwrap().items.len(), 3);
}

#[test]
fn mylib_rename_persists_without_changing_root_identity() {
    let temp = tempfile::tempdir().unwrap();
    let library = Library::new(temp.path()).unwrap();
    assert_eq!(library.list().unwrap().my_lib_name, "MyLib");
    let child = library.create_folder(None, "Classics").unwrap();
    library.rename_mylib("  Мои книги  ").unwrap();
    assert!(library.rename_mylib(" ").is_err());
    assert!(library.delete_folder(0).is_err());
    drop(library);
    let library = Library::new(temp.path()).unwrap();
    let snapshot = library.list().unwrap();
    assert_eq!(snapshot.my_lib_name, "Мои книги");
    assert_eq!(snapshot.folders[0].id, child);
    assert_eq!(snapshot.folders[0].parent_id, None);
}

#[test]
fn pdf_original_only_import_and_legacy_redirect() {
    for text in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("book.pdf");
        prose_pdf(&source, text);
        // A fixture-specific PDF comment keeps this source distinct from other
        // synthetic extraction tests, while preserving the text/no-text cases.
        let mut bytes = fs::read(&source).unwrap();
        bytes.extend_from_slice(
            format!("\n% Gjoa original-only regression text={text}\n").as_bytes(),
        );
        fs::write(&source, bytes).unwrap();
        let mut library = Library::new(&temp.path().join("library")).unwrap();
        let before = crate::reader::pdf::extraction::extraction_count_for_source(&source);
        let imported = library.import_path(&source, None).unwrap();
        assert!(imported.preferred_item_id.is_none());
        assert!(imported.warnings.is_empty());
        assert_eq!(
            before,
            crate::reader::pdf::extraction::extraction_count_for_source(&source)
        );
        assert_eq!(count(&library, "editions"), 1);
        assert_eq!(count(&library, "source_reconstructions"), 0);
        assert!(
            !library
                .reader_edition_status(imported.item.id)
                .unwrap()
                .supported
        );
        assert!(library.reader_edition(imported.item.id, true).is_err());
        assert_eq!(
            library.original_reading_item(imported.item.id).unwrap(),
            imported.item.id
        );
        let duplicate = library.import_path(&source, None).unwrap();
        assert!(duplicate.duplicate);
        assert_eq!(
            before,
            crate::reader::pdf::extraction::extraction_count_for_source(&source)
        );
        library.db.execute("INSERT INTO editions SELECT 'old-reader',source_id,'canonical-typesetter',6,format_id,'editions/old-reader/manifest.json',99,created_at FROM editions WHERE id=?1", [&imported.item.edition_id]).unwrap();
        library.db.execute("INSERT INTO library_items(edition_id,title,inbox,added_at) VALUES('old-reader','Legacy Reader',1,unixepoch())", []).unwrap();
        let legacy = library.db.last_insert_rowid();
        assert_eq!(
            library.original_reading_item(legacy).unwrap(),
            imported.item.id
        );
    }
}

#[test]
fn schema_seven_migrates_custom_display_names() {
    let temp = tempfile::tempdir().unwrap();
    let library = Library::new(temp.path()).unwrap();
    library
        .db
        .execute_batch("ALTER TABLE library_items DROP COLUMN display_name; PRAGMA user_version=7;")
        .unwrap();
    drop(library);
    let library = Library::new(temp.path()).unwrap();
    assert_eq!(
        library
            .db
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        8
    );
    assert!(library.list().unwrap().items.is_empty());
    library
        .db
        .prepare("SELECT display_name FROM library_items")
        .unwrap();
}
