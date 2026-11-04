use super::*;
use crate::publication::{Metadata, model::Structure, typography::Glyph};

#[test]
fn fb2_book_containers_promote_chapters_but_not_subheadings_or_each_note() {
    use crate::publication::{fb2, manifest};
    use crate::reader::sources::Fb2FormatHandler;
    let temp = tempfile::tempdir().unwrap();
    let file = temp.path().join("book.fb2");
    std::fs::write(&file,r#"<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>Test</book-title></title-info></description><body><section><title><p>Book</p></title><section><title><p>One</p></title><p>Body.</p><section><title><p>Subheading</p></title><p>More.</p></section></section><section><title><p>Two</p></title><p>Body.</p></section></section></body><body name="notes"><section><title><p>1</p></title><p>Note.</p></section><section><title><p>2</p></title><p>Note.</p></section></body></FictionBook>"#).unwrap();
    let mut manifest = manifest(&"0".repeat(64), &Fb2FormatHandler).unwrap();
    let book = fb2::parse(&file, temp.path(), &mut manifest).unwrap();
    let chapters: Vec<_> = book
        .structure
        .iter()
        .filter(|s| s.chapter)
        .map(|s| match &book.blocks[s.block] {
            crate::publication::model::Block::Paragraph { start, end, .. } => {
                &book.text[*start..*end]
            }
            _ => "",
        })
        .collect();
    assert_eq!(chapters, ["Book", "One", "Two"]);
    assert!(
        book.text.contains("Note."),
        "Unreferenced note text remains semantic data"
    );
    let levels: Vec<_> = book.structure.iter().map(|s| s.block).collect();
    assert!(levels.windows(2).all(|p| p[0] < p[1]));
}

#[test]
#[ignore = "external corpus: set GJOA_TEST_CORPUS_DIR and run explicitly with --ignored"]
fn akunin_all_chapters_content_determinism_and_persisted_reopen() {
    use crate::{
        library::{Library, edition},
        publication::{epub, typography},
        reader::{document::RenderRequest, registry::FormatRegistry},
    };
    let fixtures = crate::test_corpus::directory();
    let source = std::fs::read_dir(fixtures)
        .unwrap()
        .map(|p| p.unwrap().path())
        .find(|p| {
            p.to_string_lossy().contains("Азазель") && p.extension().is_some_and(|e| e == "epub")
        })
        .unwrap();
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let mut first = Library::new(&a.path().join("library")).unwrap();
    capture_trace(true);
    let item = first.import_path(&source, None).unwrap().item;
    let _legacy_trace = take_trace();
    let payload = first.root.join("editions").join(&item.edition_id);
    let model: Publication =
        serde_json::from_slice(&std::fs::read(payload.join("publication.json")).unwrap()).unwrap();
    let mut chapter_count = 0;
    for s in &model.structure {
        if s.chapter
            && let crate::publication::model::Block::Paragraph { start, end, .. } =
                &model.blocks[s.block]
        {
            let saved: edition::Manifest =
                serde_json::from_slice(&std::fs::read(payload.join("manifest.json")).unwrap())
                    .unwrap();
            let page = saved.page_files.iter().map(|r| crate::publication::storage::read_layout(&payload,r,saved.storage_version).unwrap()).find(|p| p.items.iter().any(|item| matches!(item, Item::GlyphRun { source_start, source_end, .. } if *source_start <= *start && *source_end > *start))).unwrap();
            let first_source = page
                .items
                .iter()
                .filter_map(|item| match item {
                    Item::GlyphRun { source_start, .. } => Some(*source_start),
                    _ => None,
                })
                .min()
                .unwrap();
            assert_eq!(first_source, *start, "Chapter must start on a fresh page");
            if model.text[*start..*end].starts_with("Глава ") {
                chapter_count += 1;
            }
        }
    }
    assert_eq!(chapter_count, 17);
    // Floats are now represented inside measured paragraph bands. Validate
    // persisted image occurrences and actual source coverage, not old trace slots.
    let saved: edition::Manifest =
        serde_json::from_slice(&std::fs::read(payload.join("manifest.json")).unwrap()).unwrap();
    let layouts = saved
        .page_files
        .iter()
        .map(|r| {
            crate::publication::storage::read_layout(&payload, r, saved.storage_version).unwrap()
        })
        .collect::<Vec<_>>();
    let mut expected = std::collections::BTreeMap::new();
    let mut actual = std::collections::BTreeMap::new();
    let mut coverage = vec![0u32; model.text.len()];
    for block in &model.blocks {
        if let crate::publication::model::Block::Image { asset, .. } = block {
            *expected.entry(asset.clone()).or_insert(0usize) += 1;
        }
    }
    for layout in &layouts {
        for item in &layout.items {
            match item {
                Item::Image { asset, .. } => {
                    *actual.entry(asset.clone()).or_insert(0usize) += 1;
                }
                Item::GlyphRun {
                    source_start,
                    source_end,
                    ..
                }
                | Item::RasterGlyph {
                    source_start,
                    source_end,
                    ..
                } => {
                    for n in &mut coverage[*source_start..*source_end] {
                        *n += 1;
                    }
                }
                _ => {}
            }
        }
    }
    assert_eq!(expected, actual);
    for block in &model.blocks {
        if let crate::publication::model::Block::Paragraph { start, end, .. } = block {
            for (offset, ch) in model.text[*start..*end].char_indices() {
                if ch.is_alphanumeric()
                    && !model
                        .note_references
                        .iter()
                        .any(|r| r.start <= start + offset && start + offset < r.end)
                {
                    assert_eq!(coverage[start + offset], 1);
                }
            }
        }
    }
    let representative_page = layouts
        .iter()
        .position(|p| p.items.iter().any(|i| matches!(i, Item::Image { .. })))
        .unwrap();
    let mut second = Library::new(&b.path().join("library")).unwrap();
    let again = second.import_path(&source, None).unwrap().item;
    assert_eq!(item.edition_id, again.edition_id);
    let manifest = std::fs::read(payload.join("manifest.json")).unwrap();
    assert_eq!(
        manifest,
        std::fs::read(
            second
                .root
                .join("editions")
                .join(&again.edition_id)
                .join("manifest.json")
        )
        .unwrap()
    );
    let parsed: edition::Manifest = serde_json::from_slice(&manifest).unwrap();
    std::fs::remove_file(first.root.join(parsed.source_path)).unwrap();
    let counts = (
        epub::PARSES.with(|n| n.get()),
        typography::TYPESETS.with(|n| n.get()),
    );
    let root = first.root.clone();
    drop(first);
    let _restarted = Library::new(&root).unwrap();
    let (doc, _) = edition::resolve(&root, &item.edition_id, &FormatRegistry::default()).unwrap();
    for index in [0, representative_page, doc.page_count() - 1] {
        assert!(
            !doc.render_page(
                index,
                RenderRequest {
                    width: 400,
                    height: 560
                }
            )
            .unwrap()
            .rgba
            .is_empty()
        );
    }
    assert_eq!(
        counts,
        (
            epub::PARSES.with(|n| n.get()),
            typography::TYPESETS.with(|n| n.get())
        )
    );
    capture_trace(false);
}
fn text(n: usize, heading: bool) -> Measured {
    Measured::Text {
        lines: (0..n)
            .map(|i| Line {
                height: 28.,
                items: vec![Item::GlyphRun {
                    font: 0,
                    size: 19.,
                    glyphs: vec![Glyph(1, 72., 19., i, i + 1)],
                    source_start: i,
                    source_end: i + 1,
                    bounds: [72., 0., 10., 24.],
                }],
            })
            .collect(),
        gap: 6.,
        heading,
        movable: !heading,
    }
}
fn image(w: f32, h: f32, cover: bool) -> Measured {
    Measured::Image {
        asset: "image.png".into(),
        width: w,
        height: h,
        cover,
    }
}
fn model(chapters: &[usize]) -> Publication {
    Publication {
        notes: vec![],
        note_references: vec![],
        schema_version: 1,
        text: String::new(),
        blocks: vec![],
        metadata: Metadata::default(),
        structure: chapters
            .iter()
            .map(|&block| Structure {
                block,
                chapter: true,
                heading_level: Some(1),
            })
            .collect(),
    }
}
fn run(blocks: &[Measured], chapters: &[usize]) -> (Vec<PageLayout>, Trace) {
    capture_trace(true);
    paginate(&model(chapters), blocks).unwrap()
}
#[test]
fn chapter_breaks_and_ordinary_heading_keep() {
    let (_, t) = run(&[text(4, false), text(1, true), text(4, false)], &[0, 1]);
    assert_eq!(t.pages.len(), 2);
    assert_eq!(t.pages[1].placements[0].block, 1);
    assert_eq!(t.pages[1].placements[0].y, TOP);
    let (_, t) = run(
        &[image(600., 900., true), text(1, true), text(4, false)],
        &[0, 1],
    );
    assert_eq!(t.pages.len(), 2);
    let (_, t) = run(&[text(4, false), text(1, true), text(4, false)], &[]);
    assert_eq!(t.pages.len(), 1);
    let (_, t) = run(&[text(32, false), text(1, true), text(4, false)], &[]);
    assert_eq!(t.pages.len(), 2);
    assert_eq!(t.pages[1].placements[0].block, 1);
    assert!(
        t.pages[1]
            .placements
            .iter()
            .filter(|p| p.block == 2)
            .count()
            >= 2
    );
}
#[test]
fn widow_orphan_and_impossible_fragment_terminate() {
    for first in [31, 32, 33] {
        let (_, t) = run(&[text(first, false), text(4, false)], &[]);
        for p in &t.pages {
            let n = p.placements.iter().filter(|p| p.block == 1).count();
            assert_ne!(n, 1);
        }
    }
    let (_, t) = run(&[text(35, false)], &[]);
    assert_eq!(t.pages[0].placements.len(), 33);
    assert_eq!(t.pages[1].placements.len(), 2);
    let (_, t) = run(&[text(1, false)], &[]);
    assert_eq!(t.pages.len(), 1);
    assert_eq!(t.pages[0].placements.len(), 1);
    let (_, t) = run(
        &[text(201, false), image(600., 800., false), text(3, false)],
        &[],
    );
    assert_eq!(t.fallbacks, 1);
    assert_eq!(
        t.pages
            .iter()
            .flat_map(|p| &p.placements)
            .filter(|p| p.line.is_some())
            .count(),
        204
    );
}
#[test]
fn illustration_search_preserves_geometry_anchor_order_and_cover() {
    let (_, context) = run(&[image(656., 867., false), text(9, false)], &[]);
    assert!(
        context
            .candidates
            .iter()
            .find(|c| c.selected)
            .unwrap()
            .scale
            < 1.
    );
    assert!(
        context.pages[0]
            .placements
            .iter()
            .filter(|p| p.line.is_some())
            .count()
            >= 3
    );
    let blocks = [text(5, false), image(656., 820., false), text(4, false)];
    let (pages, t) = run(&blocks, &[]);
    assert!(t.candidates.len() > 1);
    assert!(t.peak_candidates <= MAX_CANDIDATES);
    assert_eq!(pages.len(), 1);
    for item in &pages[0].items {
        if let Item::Image { bounds, .. } = item {
            assert!((bounds[2] / bounds[3] - 0.8).abs() < 0.00001);
            assert!(bounds[3] >= 820. * 0.6);
        }
    }
    assert!(
        t.pages
            .iter()
            .flat_map(|p| &p.placements)
            .all(|p| p.anchor_delta.abs() <= 1)
    );
    let (pages2, t2) = run(&blocks, &[]);
    assert_eq!(
        serde_json::to_vec(&pages).unwrap(),
        serde_json::to_vec(&pages2).unwrap()
    );
    assert_eq!(
        serde_json::to_value(&t.candidates).unwrap(),
        serde_json::to_value(&t2.candidates).unwrap()
    );
    let (_, t) = run(
        &[
            text(3, false),
            image(656., 820., false),
            text(3, false),
            image(300., 400., false),
        ],
        &[2],
    );
    let indices: Vec<_> = t
        .pages
        .iter()
        .flat_map(|p| &p.placements)
        .filter(|p| p.line.is_none())
        .map(|p| p.block)
        .collect();
    assert_eq!(indices, [1, 3]);
    let first_chapter = t
        .pages
        .iter()
        .take_while(|p| p.placements.iter().all(|p| p.block < 2))
        .count();
    assert!(first_chapter > 0);
    assert!(
        t.pages[first_chapter]
            .placements
            .iter()
            .all(|p| p.block >= 2)
    );
    let (_, t) = run(
        &[
            image(300., 400., true),
            text(2, false),
            image(30., 40., false),
            image(40., 50., false),
        ],
        &[],
    );
    assert_eq!(t.pages[0].placements.len(), 1);
    assert_eq!(t.pages[0].placements[0].scale, 1.);
    assert_eq!(t.pages[0].penalties.isolated_illustration, 0.);
    let imgs: Vec<_> = t
        .pages
        .iter()
        .flat_map(|p| &p.placements)
        .filter(|p| p.line.is_none())
        .collect();
    assert_eq!(imgs.iter().map(|p| p.block).collect::<Vec<_>>(), [0, 2, 3]);
    assert!(imgs.iter().all(|p| p.scale <= 1.));
}
#[test]
fn independent_scoring_and_stable_tie_breaking() {
    let cost = |u, w, o, s, d| soft_cost(u, false, w, o, false, s, d).total();
    assert!(cost(0.7, false, false, 1., 0) > cost(0.1, false, false, 1., 0));
    assert!(cost(0., true, false, 1., 0) > cost(0., false, false, 1., 0));
    assert!(cost(0., false, true, 1., 0) > cost(0., false, false, 1., 0));
    assert!(cost(0., false, false, 0.6, 0) > cost(0., false, false, 0.9, 0));
    assert!(cost(0., false, false, 1., 1) < cost(0., false, false, 1., 2));
    assert_eq!(
        soft_cost(0.9, true, false, false, false, 1., 0).whitespace,
        0.
    );
    let (_, t) = run(&[image(40., 50., false)], &[]);
    let winner = t.candidates.iter().find(|c| c.selected).unwrap();
    assert_eq!(winner.scale, 1.);
    assert_eq!(winner.anchor_delta, 0);
    assert!(
        t.candidates
            .iter()
            .all(|c| c.anchor_delta == 0 && c.scale >= 0.6)
    );
}

#[test]
fn persisted_publisher_v1_is_immutable_and_new_identity_is_distinct() {
    use crate::{
        library::{Library, edition},
        publication::{storage, typography},
        reader::{document::RenderRequest, registry::FormatRegistry},
    };
    let fixture =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/publisher-v1");
    let id = "f9065f570a150545b1dfa96f239dc265bef4e2451aa18a3da69ca5491a593550";
    let old = fixture.join("editions").join(id);
    let bytes = std::fs::read(old.join("manifest.json")).unwrap();
    let manifest: edition::Manifest = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(manifest.publisher_version, 1);
    let temp = tempfile::tempdir().unwrap();
    let mut library = Library::new(&temp.path().join("library")).unwrap();
    let target = library.root.join("editions").join(id);
    std::fs::create_dir_all(&target).unwrap();
    for f in manifest.assets.iter().chain(&manifest.page_files) {
        let path = target.join(&f.path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::copy(old.join(&f.path), path).unwrap();
    }
    std::fs::write(target.join("manifest.json"), &bytes).unwrap();
    std::fs::create_dir_all(library.root.join("fonts")).unwrap();
    for (f, data) in manifest.shared_fonts.iter().zip(*typography::FONTS) {
        std::fs::write(library.root.join(&f.path), data).unwrap();
    }
    let (doc, _) = edition::resolve(&library.root, id, &FormatRegistry::default()).unwrap();
    let expected = image::open(fixture.join("expected.png"))
        .unwrap()
        .into_rgba8();
    assert_eq!(
        doc.render_page(
            0,
            RenderRequest {
                width: 800,
                height: 1120
            }
        )
        .unwrap()
        .rgba,
        expected.into_raw()
    );
    let fresh = library
        .import_path(&fixture.join("source.fb2"), None)
        .unwrap();
    // Publisher v2 with the original five-font profile must remain readable too.
    let mut prior_v2 = manifest.clone();
    prior_v2.publisher_version = 2;
    prior_v2.edition_id = crate::publication::identity_profile(
        &prior_v2.source_id,
        &prior_v2.format,
        crate::reader::format::PublicationKind::GeneratedLayout,
        2,
        prior_v2.profile_id.as_deref().unwrap(),
    );
    let v2_root = library.root.join("editions").join(&prior_v2.edition_id);
    std::fs::create_dir_all(&v2_root).unwrap();
    for f in prior_v2.assets.iter().chain(&prior_v2.page_files) {
        let path = v2_root.join(&f.path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::copy(old.join(&f.path), path).unwrap();
    }
    std::fs::write(
        v2_root.join("manifest.json"),
        serde_json::to_vec_pretty(&prior_v2).unwrap(),
    )
    .unwrap();
    let (old_v2, _) = edition::resolve(
        &library.root,
        &prior_v2.edition_id,
        &FormatRegistry::default(),
    )
    .unwrap();
    assert_eq!(
        old_v2
            .render_page(
                0,
                RenderRequest {
                    width: 800,
                    height: 1120
                }
            )
            .unwrap()
            .rgba,
        doc.render_page(
            0,
            RenderRequest {
                width: 800,
                height: 1120
            }
        )
        .unwrap()
        .rgba
    );
    assert_ne!(fresh.item.edition_id, id);
    assert_eq!(fresh.item.page_count, 2);
    assert_eq!(std::fs::read(target.join("manifest.json")).unwrap(), bytes);
    assert_eq!(
        storage::read_layout(&target, &manifest.page_files[0], 2)
            .unwrap()
            .height,
        1120
    );
}

#[test]
fn mixed_float_band_and_text_use_actual_heights() {
    let blocks = vec![Measured::Text {
        lines: [400., 28., 28.]
            .into_iter()
            .map(|height| Line {
                items: vec![],
                height,
            })
            .collect(),
        gap: 0.,
        heading: false,
        movable: true,
    }];
    let mut state = State::default();
    state.page.used = 400.;
    place(&mut state, &blocks, 0, 1, 1., 0);
    assert!(state.done.is_empty());
    assert_eq!(state.page.used, 856.);
    assert_eq!(state.page.entries.len(), 3);
}

#[test]
fn deferred_float_band_is_not_a_single_orphan_line() {
    let blocks = vec![Measured::Text {
        lines: [28., 28., 28., 400.]
            .into_iter()
            .map(|height| Line {
                items: vec![],
                height,
            })
            .collect(),
        gap: 0.,
        heading: false,
        movable: true,
    }];
    let mut state = State::default();
    state.page.used = 850.;
    place(&mut state, &blocks, 0, 1, 1., 0);
    assert_eq!(state.done[0].entries.len(), 3);
    assert_eq!(state.done[0].used, 934.);
    assert_eq!(state.page.entries.len(), 1);
}
