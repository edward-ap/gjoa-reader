use super::*;
use crate::{
    publication::{
        self,
        model::{ParagraphKind, Publication},
        system_fallback::{FallbackResult, NativeGlyph},
        typography,
    },
    reader::{document::RenderRequest, registry::FormatRegistry},
};
use std::{cell::RefCell, rc::Rc};
struct Fake {
    calls: Rc<RefCell<Vec<String>>>,
    fail: bool,
    tone: u8,
}
impl SystemFontFallbackProvider for Fake {
    fn resolve_and_render(
        &mut self,
        r: FallbackRequest<'_>,
    ) -> std::result::Result<FallbackResult, String> {
        self.calls.borrow_mut().push(r.text.to_owned());
        if self.fail {
            return Err("Unavailable".into());
        }
        Ok(FallbackResult {
            advance: 17.,
            glyphs: vec![NativeGlyph {
                start: 0,
                end: r.text.len(),
                x: 0.,
                y: -15.,
                advance: 17.,
                width: 30,
                height: 45,
                mask: vec![self.tone; 30 * 45],
                rgba: (self.tone == 128).then(|| [255, 0, 0, 255].repeat(30 * 45)),
                family: "Deterministic fake face".into(),
                glyph_id: 77,
                missing: false,
            }],
        })
    }
}
fn faces() -> Vec<rustybuzz::Face<'static>> {
    typography::CURRENT_FONTS
        .iter()
        .map(|f| rustybuzz::Face::from_slice(f, 0).unwrap())
        .collect()
}
#[test]
fn literata_is_the_only_current_family_with_real_styles_and_system_fallback() {
    let faces = faces();
    assert_eq!(faces.len(), 4);
    for face in &faces {
        for c in "АБВГДабвгдЁёРусскийLatin0123".chars() {
            assert!(face.glyph_index(c).is_some(), "Missing {c}");
        }
    }
    let calls = Rc::new(RefCell::new(Vec::new()));
    let mut resolver = FontResolver::with_provider(
        &faces,
        Box::new(Fake {
            calls: calls.clone(),
            fail: false,
            tone: 255,
        }),
    );
    for style in [
        Style::default(),
        Style {
            italic: true,
            ..Default::default()
        },
        Style {
            bold: true,
            ..Default::default()
        },
        Style {
            bold: true,
            italic: true,
            ..Default::default()
        },
    ] {
        assert!(
            matches!(resolver.resolve("Текст", 0, style, 19.).unwrap().first(), Some(Resolved::Font { font, .. }) if *font == style.font())
        );
    }
    assert!(calls.borrow().is_empty());
    assert!(matches!(
        resolver
            .resolve("東京", 0, Style::default(), 19.)
            .unwrap()
            .first(),
        Some(Resolved::Raster { .. })
    ));
    assert_eq!(&*calls.borrow(), &["東京"]);
    assert_ne!(typography::profile_id(), typography::v3_profile_id());
    assert_eq!(
        typography::fonts_for_profile(Some(&typography::v3_profile_id()))
            .unwrap()
            .len(),
        7
    );
}

#[test]
fn tiers_graphemes_context_cache_controls_and_limits() {
    let faces: Vec<_> = typography::V3_FONTS
        .iter()
        .map(|f| rustybuzz::Face::from_slice(f, 0).unwrap())
        .collect();
    let calls = Rc::new(RefCell::new(Vec::new()));
    let mut resolver = FontResolver::with_provider(
        &faces,
        Box::new(Fake {
            calls: calls.clone(),
            fail: false,
            tone: 255,
        }),
    );
    for t in ["Русский текст", "Latin", "e\u{301}", "東京", "→"] {
        resolver.resolve(t, 0, Style::default(), 19.).unwrap();
    }
    assert!(calls.borrow().is_empty());
    for _ in 0..2 {
        resolver
            .resolve("العربية", 0, Style::default(), 19.)
            .unwrap();
    }
    assert_eq!(&*calls.borrow(), &["العربية"]);
    resolver
        .resolve("\u{10fffd}\u{301}", 40, Style::default(), 19.)
        .unwrap();
    assert_eq!(calls.borrow().last().unwrap(), "\u{10fffd}\u{301}");
    resolver
        .resolve("\u{200d}\u{fe0f}\u{2067}\u{ad}", 0, Style::default(), 19.)
        .unwrap();
    assert_eq!(calls.borrow().len(), 2);
    let result = resolver.resolve("\u{10fffd}".repeat(1024).as_str(), 0, Style::default(), 19.);
    assert!(result.unwrap_err_string().contains("resource limit"));
}
trait ErrorText {
    fn unwrap_err_string(self) -> String;
}
impl<T> ErrorText for Result<T> {
    fn unwrap_err_string(self) -> String {
        match self {
            Err(e) => e.to_string(),
            Ok(_) => panic!("expected error"),
        }
    }
}
fn publication(fail: bool, tone: u8) -> (tempfile::TempDir, Manifest, Rc<RefCell<Vec<String>>>) {
    let temp = tempfile::tempdir().unwrap();
    let input = temp.path().join("source.fb2");
    std::fs::write(&input, b"<FictionBook/>").unwrap();
    let registry = FormatRegistry::default();
    let handler = registry.detect(&input).unwrap();
    let mut manifest = publication::manifest(&"a".repeat(64), handler).unwrap();
    let mut model = Publication {
        notes: vec![],
        note_references: vec![],
        schema_version: 1,
        text: String::new(),
        blocks: vec![],
        metadata: publication::Metadata::default(),
        structure: vec![],
    };
    model
        .append_paragraph(
            vec![(
                "Русский e\u{301} 東京 العربية \u{10fffd}".into(),
                Style::default(),
                None,
            )],
            ParagraphKind::Body,
            None,
            None,
        )
        .unwrap();
    manifest.assets.push(
        publication::write_file(
            temp.path(),
            "publication.json",
            &serde_json::to_vec(&model).unwrap(),
        )
        .unwrap(),
    );
    let calls = Rc::new(RefCell::new(Vec::new()));
    typography::publish_with_provider(
        &model,
        temp.path(),
        &mut manifest,
        Box::new(Fake {
            calls: calls.clone(),
            fail,
            tone,
        }),
    )
    .unwrap();
    manifest.page_count = manifest.pages.len();
    (temp, manifest, calls)
}
#[test]
fn persistence_identity_last_resort_and_runtime_independence() {
    let (root, mut manifest, calls) = publication(false, 255);
    let (root2, other, _) = publication(false, 255);
    assert_eq!(manifest.edition_id, other.edition_id);
    let (changed_root, changed, _) = publication(false, 128);
    assert_ne!(manifest.edition_id, changed.edition_id);
    let color = publication::open_payload(changed_root.path(), &changed)
        .unwrap()
        .render_page(
            0,
            RenderRequest {
                width: 800,
                height: 1120,
            },
        )
        .unwrap();
    assert!(color.rgba.chunks_exact(4).any(|p| p[0] > p[1]));
    assert_eq!(calls.borrow().len(), 4); // Japanese now uses the system tier too.
    let request = RenderRequest {
        width: 800,
        height: 1120,
    };
    let before = publication::open_payload(root.path(), &manifest)
        .unwrap()
        .render_page(0, request)
        .unwrap()
        .rgba;
    let library = tempfile::tempdir().unwrap();
    std::fs::create_dir(library.path().join("fonts")).unwrap();
    let mut installed = vec![];
    publication::storage::compact(root.path(), &mut manifest, library.path(), &mut installed)
        .unwrap();
    assert_eq!(manifest.storage_version, 4);
    publication::system_fallback::FORBID.with(|v| v.set(true));
    let after = publication::open_payload_with_fonts(root.path(), &manifest, Some(library.path()))
        .unwrap()
        .render_page(0, request)
        .unwrap()
        .rgba;
    publication::system_fallback::FORBID.with(|v| v.set(false));
    assert_eq!(before, after);
    assert_eq!(
        crate::library::store::hash_reader(before.as_slice()).unwrap(),
        crate::library::store::hash_reader(after.as_slice()).unwrap()
    );
    assert!(root2.path().exists());
    let (last, manifest, _) = publication(true, 255);
    assert!(!manifest.import_warnings.is_empty());
    let model: Publication =
        serde_json::from_slice(&std::fs::read(last.path().join("publication.json")).unwrap())
            .unwrap();
    assert!(model.text.contains('\u{10fffd}'));
    publication::open_payload(last.path(), &manifest)
        .unwrap()
        .render_page(0, request)
        .unwrap();
}
#[test]
fn v3_codec_roundtrip_and_v2_rejection() {
    let page = typography::PageLayout {
        width: 800,
        height: 1120,
        items: vec![Item::RasterGlyph {
            asset: "fallback/a.png".into(),
            baseline: [12., 18.],
            advance: 19.,
            source_start: 0,
            source_end: 4,
            bounds: [12., 3., 10., 15.],
        }],
    };
    assert!(publication::layout_codec::encode(&page).is_err());
    let bytes = publication::layout_codec::encode_version(&page, 3).unwrap();
    assert!(publication::layout_codec::decode(&bytes).is_err());
    let restored = publication::layout_codec::decode_version(&bytes, 3).unwrap();
    assert_eq!(
        serde_json::to_vec(&page).unwrap(),
        serde_json::to_vec(&restored).unwrap()
    );
    for n in 0..bytes.len() {
        assert!(publication::layout_codec::decode_version(&bytes[..n], 3).is_err());
    }
}

#[test]
fn operation_and_asset_budgets() {
    let faces = faces();
    let calls = Rc::new(RefCell::new(Vec::new()));
    let mut resolver = FontResolver::with_provider(
        &faces,
        Box::new(Fake {
            calls: calls.clone(),
            fail: false,
            tone: 255,
        }),
    );
    resolver.report.system_calls = MAX_OPERATIONS;
    assert!(
        resolver
            .resolve("\u{10fffd}", 0, Style::default(), 19.)
            .unwrap_err_string()
            .contains("resource limit")
    );
    resolver.assets = (0..MAX_ASSETS)
        .map(|i| (format!("fake-{i}"), vec![]))
        .collect();
    assert!(
        resolver
            .asset(2, 2, &[255; 4])
            .unwrap_err_string()
            .contains("resource limit")
    );
    resolver.assets.clear();
    resolver.report.asset_bytes = MAX_ASSET_BYTES;
    assert!(
        resolver
            .asset(2, 2, &[255; 4])
            .unwrap_err_string()
            .contains("resource limit")
    );
}

#[test]
fn high_usage_is_cached_and_style_boundary_keeps_grapheme() {
    let faces = faces();
    let calls = Rc::new(RefCell::new(Vec::new()));
    let mut resolver = FontResolver::with_provider(
        &faces,
        Box::new(Fake {
            calls: calls.clone(),
            fail: false,
            tone: 255,
        }),
    );
    for index in 0..1100 {
        resolver
            .resolve("\u{10fffd}", index * 4, Style::default(), 19.)
            .unwrap();
    }
    assert!(resolver.report.high_fallback_usage);
    assert_eq!(resolver.assets.len(), 1);
    assert_eq!(calls.borrow().len(), 1);
    let mut model = Publication {
        notes: vec![],
        note_references: vec![],
        schema_version: 1,
        text: String::new(),
        blocks: vec![],
        metadata: publication::Metadata::default(),
        structure: vec![],
    };
    model
        .append_paragraph(
            vec![
                ("\u{10fffd}".into(), Style::default(), None),
                (
                    "\u{301}".into(),
                    Style {
                        bold: true,
                        ..Style::default()
                    },
                    None,
                ),
            ],
            ParagraphKind::Body,
            None,
            None,
        )
        .unwrap();
    let (_previous, mut manifest, _) = publication(false, 255);
    let root = tempfile::tempdir().unwrap();
    manifest.assets.clear();
    manifest.pages.clear();
    manifest.page_files.clear();
    let calls = Rc::new(RefCell::new(Vec::new()));
    typography::publish_with_provider(
        &model,
        root.path(),
        &mut manifest,
        Box::new(Fake {
            calls: calls.clone(),
            fail: false,
            tone: 255,
        }),
    )
    .unwrap();
    assert_eq!(&*calls.borrow(), &["\u{10fffd}\u{301}"]);
}

struct Partial;
impl SystemFontFallbackProvider for Partial {
    fn resolve_and_render(
        &mut self,
        r: FallbackRequest<'_>,
    ) -> std::result::Result<FallbackResult, String> {
        let mut glyphs = Vec::new();
        for (i, (start, c)) in r.text.char_indices().enumerate() {
            glyphs.push(NativeGlyph {
                start,
                end: start + c.len_utf8(),
                x: i as f32 * 17.,
                y: -60.,
                advance: 17.,
                width: 30,
                height: 180,
                mask: vec![255; 5400],
                rgba: None,
                family: "Fake contextual".into(),
                glyph_id: if i == 1 { 0 } else { 3 },
                missing: i == 1,
            });
        }
        Ok(FallbackResult {
            advance: 51.,
            glyphs,
        })
    }
}
#[test]
fn partial_missing_run_retains_neighbours_and_clamps_extreme_metrics() {
    let faces = faces();
    let mut resolver = FontResolver::with_provider(&faces, Box::new(Partial));
    let runs = resolver
        .resolve("ا\u{10fffd}ب", 0, Style::default(), 19.)
        .unwrap();
    assert!(matches!(&runs[0], Resolved::Raster { items, .. } if items.len() == 3));
    assert_eq!(resolver.report.last_resort_clusters, 1);
    assert_eq!(
        resolver
            .report
            .entries
            .iter()
            .filter(|e| e.tier == "system")
            .count(),
        2
    );
    assert_eq!(resolver.report.adjustments, 1);
    assert!(resolver.report.entries.iter().all(|e| e.bounds[1] >= -20.));
}
