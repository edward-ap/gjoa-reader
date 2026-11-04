use super::*;
use crate::{
    publication::{
        self,
        model::{Note, NoteReference, Style},
    },
    reader::sources::Fb2FormatHandler,
};
fn paragraph(model: &mut Publication, text: &str, style: ParagraphKind) {
    model
        .append_paragraph(
            vec![(text.into(), Style::default(), None)],
            style,
            None,
            None,
        )
        .unwrap();
}
fn fixture(kind: usize) -> (tempfile::TempDir, Publication, Manifest) {
    let root = tempfile::tempdir().unwrap();
    let mut m = publication::manifest(&"1".repeat(64), &Fb2FormatHandler).unwrap();
    let mut model = Publication {
        schema_version: 3,
        text: String::new(),
        blocks: vec![],
        metadata: Default::default(),
        structure: vec![],
        notes: vec![],
        note_references: vec![],
    };
    let image = image::RgbImage::from_pixel(300, 480, image::Rgb([150, 170, 190]));
    image.save(root.path().join("image.png")).unwrap();
    let bytes = std::fs::read(root.path().join("image.png")).unwrap();
    m.assets
        .push(write_file(root.path(), "assets/image.png", &bytes).unwrap());
    paragraph(
        &mut model,
        &"Ordinary prose with enough variation to fill the page. ".repeat(if kind == 3 {
            5
        } else {
            65
        }),
        ParagraphKind::Body,
    );
    if kind == 2 {
        let at = model.blocks.len();
        paragraph(
            &mut model,
            "Heading kept with the next paragraph",
            ParagraphKind::Heading,
        );
        model.mark(at, false, Some(2));
    }
    model.blocks.push(Block::Image {
        asset: "assets/image.png".into(),
        cover: false,
    });
    paragraph(
        &mut model,
        &"Text flows beside the illustration and continues below it. ".repeat(if kind == 3 {
            2
        } else if kind == 1 {
            12
        } else {
            60
        }),
        ParagraphKind::Body,
    );
    if kind == 4 {
        model.blocks.push(Block::Image {
            asset: "assets/image.png".into(),
            cover: false,
        });
    }
    if kind == 3 {
        let start = model.text.len();
        paragraph(
            &mut model,
            "1 A paragraph calling a long footnote, beside an illustration.",
            ParagraphKind::Body,
        );
        model.note_references.push(NoteReference {
            note_id: "n".into(),
            label: "1".into(),
            start,
            end: start + 1,
        });
        let before = model.blocks.len();
        paragraph(
            &mut model,
            &"Footnote words preserved on continuation pages. ".repeat(300),
            ParagraphKind::Body,
        );
        let blocks = model.blocks.split_off(before);
        model.notes.push(Note {
            id: "n".into(),
            label: "1".into(),
            blocks,
        });
    }
    paragraph(
        &mut model,
        &"The remaining prose must keep its semantic order. ".repeat(120),
        ParagraphKind::Body,
    );
    let at = model.blocks.len();
    paragraph(&mut model, "New chapter", ParagraphKind::Heading);
    model.mark(at, true, Some(1));
    paragraph(
        &mut model,
        "Final paragraph after the chapter boundary.",
        ParagraphKind::Body,
    );
    (root, model, m)
}
#[test]
fn adversarial_windows_preserve_content_geometry_and_determinism() {
    for (kind, strategy) in (0..5).flat_map(|kind| {
        [
            CompositionStrategy::SlidingWindowV2,
            CompositionStrategy::SlidingWindowV22,
            CompositionStrategy::ProductionV22,
        ]
        .into_iter()
        .map(move |strategy| (kind, strategy))
    }) {
        let (root, model, mut m) = fixture(kind);
        if let Some(directory) = std::env::var_os("SLIDING_WINDOW_EVIDENCE_DIR") {
            let destination = std::path::PathBuf::from(directory).join(format!("synthetic-{kind}"));
            std::fs::create_dir_all(destination.join("assets")).unwrap();
            std::fs::write(
                destination.join("model.json"),
                serde_json::to_vec(&model).unwrap(),
            )
            .unwrap();
            std::fs::write(
                destination.join("manifest.json"),
                serde_json::to_vec(&m).unwrap(),
            )
            .unwrap();
            std::fs::copy(
                root.path().join("assets/image.png"),
                destination.join("assets/image.png"),
            )
            .unwrap();
        }

        let diag = publish(&model, root.path(), &mut m, strategy).unwrap();
        if matches!(strategy, CompositionStrategy::ProductionV22) {
            assert_eq!(
                diag.short_tail_rejections, 0,
                "production uses a soft short-tail cost"
            );
            let wrapped = diag
                .windows
                .iter()
                .flat_map(|w| &w.images)
                .filter(|d| d.side != "full")
                .collect::<Vec<_>>();
            assert!(
                !wrapped.is_empty(),
                "production should retain useful text wrapping"
            );
            for (n, d) in wrapped.iter().enumerate() {
                assert_eq!(d.side, if n.is_multiple_of(2) { "right" } else { "left" });
                assert!(RIGHT - LEFT - d.bounds[2] - 12. >= 220.);
            }
            for window in &diag.windows {
                for d in window.images.iter().filter(|d| d.side == "full") {
                    assert!((d.bounds[0] + d.bounds[2] / 2. - (LEFT + RIGHT) / 2.).abs() < 0.01);
                }
            }
        }
        if kind == 3 {
            assert!(
                diag.windows
                    .iter()
                    .any(|page| !page.images.is_empty() && !page.notes.is_empty()),
                "long notes and an illustration must compete on the same committed page"
            );
        }
        let mut coverage = vec![0usize; model.text.len()];
        let mut images = 0;
        for r in &m.page_files {
            let p: PageLayout =
                serde_json::from_slice(&std::fs::read(root.path().join(&r.path)).unwrap()).unwrap();
            validate_geometry(&p).unwrap();
            for i in p.items {
                match i {
                    Item::Image { .. } => images += 1,
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
                        for n in &mut coverage[source_start..source_end] {
                            *n += 1;
                        }
                    }
                    _ => {}
                }
            }
        }
        for b in model
            .blocks
            .iter()
            .chain(model.notes.iter().flat_map(|n| &n.blocks))
        {
            if let Block::Paragraph { start, end, .. } = b {
                for (i, c) in model.text[*start..*end].char_indices() {
                    if c.is_alphabetic() {
                        assert_eq!(coverage[start + i], 1, "kind {kind} offset {}", start + i);
                    }
                }
            }
        }
        assert_eq!(images, if kind == 4 { 2 } else { 1 });
        assert!(
            diag.windows
                .iter()
                .all(|w| w.chosen.len() <= 3 && w.generated <= IMAGE_BUDGET * (1 + BEAM * 2))
        );
        if kind == 0 {
            let old = m
                .page_files
                .iter()
                .map(|r| r.sha256.clone())
                .collect::<Vec<_>>();
            let (second, second_model, mut second_manifest) = fixture(kind);
            publish(&second_model, second.path(), &mut second_manifest, strategy).unwrap();
            m = second_manifest;
            assert_eq!(
                old,
                m.page_files
                    .iter()
                    .map(|r| r.sha256.clone())
                    .collect::<Vec<_>>()
            );
        }
    }
}
#[test]
fn window_score_can_prefer_balanced_future() {
    let greedy = [0., 100., 20.];
    let balanced = [20., 20., 20.];
    let sum = |v: [f64; 3]| {
        v.iter()
            .zip(scoring::WINDOW_WEIGHTS)
            .map(|(c, w)| c * w)
            .sum::<f64>()
    };
    assert!(sum(balanced) < sum(greedy));
}
#[test]
fn explicit_chapter_break_allows_a_part_title_page() {
    let (root, mut model, mut manifest) = fixture(0);
    model.text.clear();
    model.blocks.clear();
    model.structure.clear();
    paragraph(&mut model, "Book title", ParagraphKind::Heading);
    paragraph(&mut model, "Part one", ParagraphKind::Heading);
    model.mark(1, true, Some(1));
    paragraph(&mut model, "Chapter one", ParagraphKind::Heading);
    model.mark(2, true, Some(2));
    paragraph(
        &mut model,
        "Body text following the chapter heading.",
        ParagraphKind::Body,
    );
    publish(
        &model,
        root.path(),
        &mut manifest,
        CompositionStrategy::SlidingWindowV2,
    )
    .unwrap();
    assert_eq!(manifest.page_count, 3);
}

#[test]
fn full_width_paragraph_rows_match_legacy_exactly() {
    let (root, mut model, manifest) = fixture(0);
    for kind in [
        ParagraphKind::Body,
        ParagraphKind::Quote,
        ParagraphKind::Verse,
        ParagraphKind::Heading,
        ParagraphKind::Subtitle,
    ] {
        paragraph(
            &mut model,
            "A line with punctuation, symbols â€” and several repeated words. "
                .repeat(35)
                .as_str(),
            kind,
        );
    }
    let audit = audit_paragraphs(&model, root.path(), &manifest).unwrap();
    assert_eq!(audit["legacy_rows"], audit["v2_rows"]);
    assert!(audit["differences"].as_array().unwrap().is_empty());
}
#[test]
fn visual_area_distinguishes_centered_portrait_from_filled_wrap() {
    let mut image = ImageDecision {
        block: 0,
        bounds: [236., 72., 328., 480.],
        scale: 1.,
        side: "full".into(),
        anchor_distance: 0.,
        policy: 8,
        intentional_side_space: false,
    };
    let centered = scoring::side_void_fraction(&[image.clone()], &[]);
    assert!(centered > 0.2);
    image.bounds[0] = LEFT;
    image.side = "left".into();
    let rows = (0..18)
        .map(|i| [412., 72. + i as f32 * 28., 316., 28.])
        .collect::<Vec<_>>();
    assert!(scoring::side_void_fraction(&[image.clone()], &rows) < 0.001);
    image.intentional_side_space = true;
    assert_eq!(scoring::side_void_fraction(&[image], &[]), 0.);
}

#[test]
fn illustration_rows_preserve_order_proportions_and_boundaries() {
    let (root, mut model, mut manifest) = fixture(0);
    model.blocks.clear();
    model.structure.clear();
    for _ in 0..4 {
        model.blocks.push(Block::Image {
            asset: "assets/image.png".into(),
            cover: false,
        });
    }
    paragraph(
        &mut model,
        "Text following the illustrations.",
        ParagraphKind::Body,
    );
    let faces = CURRENT_FONTS
        .iter()
        .map(|b| rustybuzz::Face::from_slice(b, 0).unwrap())
        .collect::<Vec<_>>();
    let mut engine = make_engine(&model, &faces, root.path(), &mut manifest).unwrap();
    engine.image_groups = true;
    let state = Boundary::default();
    let group = engine.image_group(0, 2, TOP, &[], &state).unwrap();
    assert_eq!(group.len(), 2);
    let a = &group[0].1;
    let b = &group[1].1;
    assert_eq!((a.block, b.block), (0, 1));
    assert_eq!(a.bounds[1], b.bounds[1]);
    assert!((b.bounds[0] - a.bounds[0] - a.bounds[2] - 12.).abs() < 0.01);
    for (_, d) in &group {
        assert!((d.bounds[2] / d.bounds[3] - 300. / 480.).abs() < 0.001);
        assert!(d.scale >= 0.7 && d.scale <= 1.);
    }
    assert!(
        engine
            .image_group(0, 2, BOTTOM - 100., &[], &state)
            .is_err()
    );
    assert!(
        engine.image_group(3, 2, TOP, &[], &state).is_err(),
        "never cross prose"
    );
    let mut consumed = state.clone();
    consumed.placed.insert(1);
    assert!(engine.image_group(0, 2, TOP, &[], &consumed).is_err());
    for image in engine.images.values_mut() {
        image.intrinsic = [200., 480.];
        image.layout.preferred = [200., 480.];
        image.layout.minimum = [140., 336.];
    }
    let trio = engine.image_group(0, 3, TOP, &[], &state).unwrap();
    assert_eq!(trio.len(), 3);
    validate_geometry(&PageLayout {
        width: WIDTH,
        height: HEIGHT,
        items: trio.into_iter().map(|(item, _)| item).collect(),
    })
    .unwrap();
    engine.images.get_mut(&0).unwrap().cover = true;
    assert!(
        engine.image_group(0, 2, TOP, &[], &state).is_err(),
        "never group covers"
    );
    drop(engine);
    model.mark(1, true, Some(1));
    let engine = make_engine(&model, &faces, root.path(), &mut manifest).unwrap();
    assert!(
        engine.image_group(0, 2, TOP, &[], &state).is_err(),
        "never cross chapters"
    );
}

#[test]
fn production_search_packs_picture_sequences_without_changing_old_policy() {
    let (root, mut model, mut manifest) = fixture(0);
    model.blocks.clear();
    model.structure.clear();
    for _ in 0..4 {
        model.blocks.push(Block::Image {
            asset: "assets/image.png".into(),
            cover: false,
        });
    }
    paragraph(
        &mut model,
        &"Ordinary text after the illustration sequence. ".repeat(30),
        ParagraphKind::Body,
    );
    for version in [26, 27] {
        let out = tempfile::tempdir().unwrap();
        for record in &manifest.assets {
            let bytes = publication::read_file(root.path(), record, 64 * 1024 * 1024).unwrap();
            write_file(out.path(), &record.path, &bytes).unwrap();
        }
        manifest.publisher_version = version;
        let mut m = manifest.clone();
        let diag = publish(
            &model,
            out.path(),
            &mut m,
            CompositionStrategy::ProductionV22,
        )
        .unwrap();
        let decisions: Vec<_> = diag.windows.iter().flat_map(|w| &w.images).collect();
        let mut order = decisions.iter().map(|d| d.block).collect::<Vec<_>>();
        if version < 27 {
            order.sort_unstable();
        }
        assert_eq!(order, vec![0, 1, 2, 3]);
        assert_eq!(decisions.iter().any(|d| d.side == "group"), version >= 27);
        if version >= 27 {
            assert!(decisions.iter().filter(|d| d.side == "group").count() >= 2);
            for window in &diag.windows {
                for image in window.images.iter().filter(|d| d.side == "group") {
                    let row_count = window
                        .images
                        .iter()
                        .filter(|other| {
                            other.side == "group"
                                && (image.bounds[1] - other.bounds[1]).abs() < 0.01
                        })
                        .count();
                    assert!((2..=3).contains(&row_count));
                }
            }
        }
        let mut covered = vec![0usize; model.text.len()];
        for (index, file) in m.page_files.iter().enumerate() {
            let page =
                publication::storage::read_layout(out.path(), file, m.storage_version).unwrap();
            if index == 0
                && let [Item::Image { bounds, .. }] = page.items.as_slice()
            {
                // Publisher 22 fits an opening image-only page to the whole sheet.
                assert!(bounds[0] >= 0. && bounds[1] >= 0.);
                assert!(bounds[0] + bounds[2] <= WIDTH as f32 + 0.01);
                assert!(bounds[1] + bounds[3] <= HEIGHT as f32 + 0.01);
            } else {
                validate_geometry(&page).unwrap();
            }
            for item in page.items {
                if let Item::GlyphRun {
                    source_start,
                    source_end,
                    ..
                } = item
                {
                    for c in &mut covered[source_start..source_end] {
                        *c += 1;
                    }
                }
            }
        }
        for block in &model.blocks {
            if let Block::Paragraph { start, end, .. } = block {
                for (i, c) in model.text[*start..*end].char_indices() {
                    if c.is_alphanumeric() {
                        assert_eq!(covered[start + i], 1);
                    }
                }
            }
        }
    }
}

#[test]
fn bottom_float_cannot_hide_two_unused_text_lines() {
    let mut image = ImageDecision {
        block: 1,
        bounds: [400., 648., 328., 384.],
        scale: 1.,
        side: "right".into(),
        anchor_distance: 0.,
        policy: 6,
        intentional_side_space: false,
    };
    let empty = scoring::wrap_tail_height(&[image.clone()], 966.);
    let filled = scoring::wrap_tail_height(&[image.clone()], 1022.);
    assert_eq!(empty - filled, 56.);
    assert!(
        2. * (empty - filled) / 28. > 1.,
        "filling two rows outweighs one orphan unit"
    );
    assert_eq!(scoring::wrap_tail_height(&[image.clone()], 1032.), 0.);
    image.side = "full".into();
    assert_eq!(
        scoring::wrap_tail_height(&[image], 966.),
        0.,
        "standalone images reserve their whole band"
    );
}

#[test]
fn production_illustrations_alternate_by_wrap_count_and_center_when_too_wide() {
    let (root, model, mut manifest) = fixture(0);
    let faces = CURRENT_FONTS
        .iter()
        .map(|b| rustybuzz::Face::from_slice(b, 0).unwrap())
        .collect::<Vec<_>>();
    let mut engine = make_engine(&model, &faces, root.path(), &mut manifest).unwrap();
    engine.alternating_wraps = true;
    let block = *engine.images.keys().next().unwrap();
    for policy in policies().into_iter().filter(|p| !p.full) {
        let (_, right) = engine.image(block, TOP, policy, true, &[], 0).unwrap();
        let (_, left) = engine.image(block, TOP, policy, true, &[], 1).unwrap();
        assert_eq!(right.side, "right");
        assert_eq!(left.side, "left");
    }
    let image = engine.images.get_mut(&block).unwrap();
    image.layout.preferred = [435., 260.];
    image.layout.minimum = [200., 100.];
    let (_, wide) = engine
        .image(block, TOP, policies()[0], true, &[], 0)
        .unwrap();
    assert_eq!(wide.side, "full");
    assert_eq!(wide.bounds[0], (LEFT + RIGHT - 435.) / 2.);
}

#[test]
fn diagnostic_search_matches_normal_and_preserves_note_continuations() {
    let (root, model, mut manifest) = fixture(3);
    let out = tempfile::tempdir().unwrap();
    let profile = search_diagnostics::SearchLimits {
        plan_beam: 4,
        diversity: false,
        page_replays: 80,
        window_beam: 6,
        endpoints: 6,
    };
    let result = search_diagnostics::diagnose(
        &model,
        root.path(),
        &mut manifest,
        &out.path().join("case"),
        &[1, 2],
        profile,
        true,
    )
    .unwrap();
    assert!(
        result["cases"]
            .as_array()
            .unwrap()
            .iter()
            .all(|c| c["normal_matches_unchanged_v2"] == true && c["oracle_repeat"] == true)
    );
    assert_eq!(
        result["cases"][1]["evidence"][0]["candidate"]["pages"][0]["continuation"],
        true
    );
    let invalid = search_diagnostics::SearchLimits {
        page_replays: 5001,
        ..profile
    };
    assert!(
        search_diagnostics::diagnose(
            &model,
            root.path(),
            &mut manifest,
            &out.path().join("invalid"),
            &[1],
            invalid,
            false
        )
        .is_err()
    );
    assert!(!out.path().join("invalid").exists());
}

#[test]
fn diversity_preserves_geometry_families_without_promoting_side_duplicates() {
    let policies = policies();
    let make = |id: usize| {
        let mut p = ImagePlan::default();
        p.0.insert(100, policies[id]);
        p
    };
    // Standalone and deferred lead by score. Bottom/native wrapping comes next;
    // several same-size side/backward variants must not consume every extra slot.
    let ranked = [8, 7, 6, 9, 0, 1, 10, 11, 2, 5, 3]
        .into_iter()
        .enumerate()
        .map(|(i, id)| (i as f64, make(id), Some(200)))
        .collect::<Vec<_>>();
    assert_eq!(expansion_slots(&ranked, 2, false), BTreeSet::from([0, 1]));
    assert_eq!(
        expansion_slots(&ranked, 2, true),
        BTreeSet::from([0, 1, 2, 8])
    );
    // Standalone size variants share occupancy; with two among the score winners,
    // the scarce extra slots go to both native and reduced wrapping instead.
    let ranked = [8, 9, 0, 1, 10, 11, 2, 3]
        .into_iter()
        .enumerate()
        .map(|(i, id)| (i as f64, make(id), Some(200)))
        .collect::<Vec<_>>();
    assert_eq!(
        expansion_slots(&ranked, 2, true),
        BTreeSet::from([0, 1, 2, 6])
    );
    let closed = vec![
        (0., make(0), None),
        (1., make(1), Some(200)),
        (f64::INFINITY, make(7), Some(200)),
    ];
    assert_eq!(expansion_slots(&closed, 1, true), BTreeSet::from([1]));
}

#[test]
fn interior_whitespace_counts_landscape_gap_but_not_wrap_or_gutters() {
    // Occupied bands may overlap (text wrapping an image); count their union.
    assert_eq!(
        scoring::interior_gap_height(&[], &[[72., 72., 656., 280.], [72., 492., 656., 280.]]),
        128.
    );
    assert_eq!(
        scoring::interior_gap_height(
            &[],
            &[
                [72., 72., 300., 280.],
                [384., 100., 300., 400.],
                [72., 512., 656., 28.]
            ]
        ),
        0.
    );
    assert_eq!(
        scoring::interior_gap_height(&[], &[[72., 72., 656., 28.]]),
        0.
    );
}
