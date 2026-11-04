//! A single, pre-shaped decoration shared by all pages of a new edition.
//! It never enters the compositor, source offsets, or footnote numbering.
use super::*;

pub(crate) const ASSET: &str = "running-header.json";
const MARK_ASSET: &str = "fallback/publisher-ae.png";
const MARK_PNG: &[u8] = include_bytes!("../../../assets/branding/publisher-ae.png");
const LABEL_LEFT: f32 = LEFT + 40.;
#[derive(Serialize, Deserialize)]
pub(crate) struct Header {
    pub label: String,
    pub items: Vec<Item>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub footers: Vec<Vec<Item>>,
}

fn clean(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .filter(|c| !c.is_control())
        .take(512)
        .collect()
}
fn label(metadata: Option<&crate::publication::Metadata>, filename: &str) -> String {
    let title = metadata
        .and_then(|m| m.title.as_deref())
        .map(clean)
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            clean(
                Path::new(filename)
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .as_ref(),
            )
        });
    let author = metadata
        .and_then(|m| m.author.as_deref())
        .map(clean)
        .filter(|s| !s.is_empty());
    match author {
        Some(author) if !title.is_empty() => format!("{author} — {title}"),
        Some(author) => author,
        None => title,
    }
}
fn layout(
    text: &str,
    faces: &[rustybuzz::Face<'_>],
    resolver: &mut FontResolver<'_>,
) -> Result<Header> {
    let shaped = |text: &str, resolver: &mut FontResolver<'_>| {
        shape(
            text,
            0,
            &[Span {
                start: 0,
                end: text.len(),
                style: Default::default(),
                link: None,
            }],
            12.,
            faces,
            resolver,
        )
    };
    let mut displayed = text.to_owned();
    let mut token = shaped(&displayed, resolver)?;
    if token.width > RIGHT - LABEL_LEFT {
        let boundaries = text
            .grapheme_indices(true)
            .map(|(i, _)| i)
            .chain(std::iter::once(text.len()))
            .collect::<Vec<_>>();
        let (mut low, mut high) = (0, boundaries.len() - 1);
        while low < high {
            let mid = (low + high).div_ceil(2);
            let candidate = format!("{}…", text[..boundaries[mid]].trim_end());
            if shaped(&candidate, resolver)?.width <= RIGHT - LABEL_LEFT {
                low = mid;
            } else {
                high = mid - 1;
            }
        }
        displayed = format!("{}…", text[..boundaries[low]].trim_end());
        token = shaped(&displayed, resolver)?;
    }
    for item in &mut token.runs {
        crate::publication::optimizer::translate(item, RIGHT - token.width, 46.);
        match item {
            Item::GlyphRun {
                glyphs,
                source_start,
                source_end,
                ..
            } => {
                *source_start = 0;
                *source_end = 0;
                for glyph in glyphs {
                    glyph.3 = 0;
                    glyph.4 = 0;
                }
            }
            Item::RasterGlyph {
                source_start,
                source_end,
                ..
            } => {
                *source_start = 0;
                *source_end = 0;
            }
            _ => {}
        }
    }
    token.runs.push(Item::Rule {
        bounds: [LEFT, 58., RIGHT - LEFT, 0.6],
    });
    Ok(Header {
        label: displayed,
        items: token.runs,
        footers: vec![],
    })
}

fn footer(
    number: usize,
    faces: &[rustybuzz::Face<'_>],
    resolver: &mut FontResolver<'_>,
) -> Result<Vec<Item>> {
    let text = number.to_string();
    let mut token = shape(
        &text,
        0,
        &[Span {
            start: 0,
            end: text.len(),
            style: Default::default(),
            link: None,
        }],
        12.,
        faces,
        resolver,
    )?;
    for item in &mut token.runs {
        crate::publication::optimizer::translate(item, (WIDTH as f32 - token.width) / 2., 1080.);
        if let Item::GlyphRun {
            glyphs,
            source_start,
            source_end,
            ..
        } = item
        {
            *source_start = 0;
            *source_end = 0;
            for glyph in glyphs {
                glyph.3 = 0;
                glyph.4 = 0;
            }
        }
    }
    // Fine rules and small typographic dots balance the centered number.
    let number_left = (WIDTH as f32 - token.width) / 2.;
    let mut dot = shape(
        "·",
        0,
        &[Span {
            start: 0,
            end: "·".len(),
            style: Default::default(),
            link: None,
        }],
        10.,
        faces,
        resolver,
    )?;
    for item in &mut dot.runs {
        if let Item::GlyphRun {
            glyphs,
            source_start,
            source_end,
            ..
        } = item
        {
            *source_start = 0;
            *source_end = 0;
            for g in glyphs {
                g.3 = 0;
                g.4 = 0;
            }
        }
    }
    for (x, center) in [
        (number_left - 40., number_left - 10.),
        (
            number_left + token.width + 16.,
            number_left + token.width + 10.,
        ),
    ] {
        token.runs.push(Item::Rule {
            bounds: [x, 1075.8, 24., 0.4],
        });
        for mut item in dot.runs.clone() {
            crate::publication::optimizer::translate(&mut item, center - dot.width / 2., 1079.);
            token.runs.push(item);
        }
    }
    Ok(token.runs)
}

pub(crate) fn publish(root: &Path, manifest: &mut Manifest, filename: &str) -> Result<()> {
    let text = label(manifest.metadata.as_ref(), filename);
    if text.is_empty() {
        return Ok(());
    }
    let faces = CURRENT_FONTS
        .iter()
        .map(|b| rustybuzz::Face::from_slice(b, 0).ok_or("Invalid header font"))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut resolver = FontResolver::new(&faces);
    let mut header = layout(&text, &faces, &mut resolver)?;
    #[derive(Deserialize)]
    struct MarkMetrics {
        width: f32,
        height: f32,
        baseline: f32,
    }
    let mark: MarkMetrics =
        serde_json::from_str(include_str!("../../../assets/branding/publisher-ae.json"))?;
    manifest
        .assets
        .push(write_file(root, MARK_ASSET, MARK_PNG)?);
    header.items.push(Item::RasterGlyph {
        asset: MARK_ASSET.into(),
        baseline: [LEFT, 46.],
        advance: mark.width,
        source_start: 0,
        source_end: 0,
        bounds: [LEFT, 46. - mark.baseline, mark.width, mark.height],
    });
    let first = manifest.page_files.first().ok_or("Missing first page")?;
    let first = crate::publication::storage::read_layout(root, first, manifest.storage_version)?;
    let cover = matches!(first.items.as_slice(), [Item::Image { .. }]);
    for index in 0..manifest.pages.len() {
        header.footers.push(if cover && index == 0 {
            vec![]
        } else {
            footer(index + usize::from(!cover), &faces, &mut resolver)?
        });
    }
    resolver.finish_decoration(root, manifest)?;
    manifest
        .assets
        .push(write_file(root, ASSET, &serde_json::to_vec(&header)?)?);
    manifest.edition_id = crate::publication::identity_manifest(manifest);
    Ok(())
}
pub(crate) fn visible(page: &PageLayout, index: usize) -> bool {
    !(page.items.is_empty() || index == 0 && matches!(page.items.as_slice(), [Item::Image { .. }]))
        && page.items.iter().all(|item| {
            let bounds = match item {
                Item::GlyphRun { bounds, .. }
                | Item::RasterGlyph { bounds, .. }
                | Item::Image { bounds, .. }
                | Item::Rule { bounds } => bounds,
            };
            bounds[1] >= 64.
        })
}

pub(crate) fn footer_visible(page: &PageLayout) -> bool {
    !page.items.is_empty()
        && page.items.iter().all(|item| {
            let bounds = match item {
                Item::GlyphRun { bounds, .. }
                | Item::RasterGlyph { bounds, .. }
                | Item::Image { bounds, .. }
                | Item::Rule { bounds } => bounds,
            };
            bounds[1] + bounds[3] <= 1056.
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cover_is_unnumbered_and_saved_numbers_start_at_one() {
        use crate::reader::registry::FormatRegistry;
        use base64::Engine;
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("cover.fb2");
        let png = base64::engine::general_purpose::STANDARD.encode(MARK_PNG);
        std::fs::write(&source, format!(r##"<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><book-title>Cover proof</book-title><coverpage><image l:href="#cover"/></coverpage></title-info></description><body><section><title><p>One</p></title><p>First text page.</p></section><section><title><p>Two</p></title><p>Second text page.</p></section></body><binary id="cover" content-type="image/png">{png}</binary></FictionBook>"##)).unwrap();
        let registry = FormatRegistry::default();
        let source_id =
            crate::library::store::hash_reader(std::fs::File::open(&source).unwrap()).unwrap();
        let prepared = crate::publication::prepare(
            &source_id,
            registry.detect(&source).unwrap(),
            &source,
            temp.path(),
        )
        .unwrap();
        let root = prepared.directory.as_ref().unwrap().path();
        let record = prepared
            .manifest
            .assets
            .iter()
            .find(|r| r.path == ASSET)
            .unwrap();
        let header: Header = serde_json::from_slice(
            &crate::publication::read_file(root, record, 1024 * 1024).unwrap(),
        )
        .unwrap();
        assert_eq!(header.footers.len(), 3);
        assert!(header.footers[0].is_empty());
        let face = rustybuzz::Face::from_slice(CURRENT_FONTS[0], 0).unwrap();
        for (index, digit) in [(1, '1'), (2, '2')] {
            let Item::GlyphRun { glyphs, bounds, .. } = &header.footers[index][0] else {
                panic!("Expected saved page number")
            };
            assert_eq!(glyphs.len(), 1);
            assert_eq!(glyphs[0].0, face.glyph_index(digit).unwrap().0);
            assert!((bounds[0] + bounds[2] / 2. - WIDTH as f32 / 2.).abs() < 0.1);
            assert!(bounds[1] >= 1056. && bounds[1] + bounds[3] < HEIGHT as f32);
        }
        let mark = image::load_from_memory(MARK_PNG).unwrap().to_rgba8();
        assert!(mark.pixels().any(|p| p[3] == 0));
        assert!(mark.pixels().any(|p| p[3] == 255));
        assert!(mark.width() >= 128 && mark.height() >= 128);
    }
    #[test]
    fn running_header_survives_install_and_changes_only_top_margin() {
        use crate::{
            library::{Library, edition},
            reader::{
                document::{PageAppearance, RenderRequest},
                registry::FormatRegistry,
            },
        };
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("Название из файла.rtf");
        std::fs::write(&source, br"{\rtf1\ansi A short paragraph for the running header.\par Another paragraph remains at its original position.}").unwrap();
        let library_root = temp.path().join("library");
        let mut library = Library::new(&library_root).unwrap();
        let imported = library.import_path(&source, None).unwrap();
        std::fs::remove_file(&source).unwrap();
        let (decorated, _) = edition::resolve(
            &library_root,
            &imported.item.edition_id,
            &FormatRegistry::default(),
        )
        .unwrap();
        let root =
            crate::publication::edition_root(&library_root, &imported.item.edition_id).unwrap();
        let manifest: Manifest =
            serde_json::from_slice(&std::fs::read(root.join("manifest.json")).unwrap()).unwrap();
        let header_file = manifest.assets.iter().find(|r| r.path == ASSET).unwrap();
        let header: Header = serde_json::from_slice(
            &crate::publication::read_file(&root, header_file, 1024 * 1024).unwrap(),
        )
        .unwrap();
        assert_eq!(header.label, "Название из файла");
        let mut plain_manifest = manifest.clone();
        plain_manifest.assets.retain(|r| r.path != ASSET);
        let plain = crate::publication::open_payload_with_fonts(
            &root,
            &plain_manifest,
            Some(&library_root),
        )
        .unwrap();
        let request = RenderRequest {
            width: WIDTH,
            height: HEIGHT,
        };
        for appearance in [
            PageAppearance::Original,
            PageAppearance::Sepia,
            PageAppearance::Night,
        ] {
            let a = decorated
                .render_with_appearance(0, request, appearance)
                .unwrap();
            let b = plain
                .render_with_appearance(0, request, appearance)
                .unwrap();
            let split = 64 * WIDTH as usize * 4;
            assert_ne!(&a.rgba[..split], &b.rgba[..split]);
            let footer_split = 1056 * WIDTH as usize * 4;
            assert_eq!(&a.rgba[split..footer_split], &b.rgba[split..footer_split]);
            assert_ne!(&a.rgba[footer_split..], &b.rgba[footer_split..]);
            assert_eq!(decorated.page_count(), plain.page_count());
            if appearance == PageAppearance::Original {
                let output = temp.path().join("running-header-evidence");
                std::fs::create_dir_all(&output).unwrap();
                image::save_buffer(
                    output.join("page.png"),
                    &a.rgba,
                    WIDTH,
                    HEIGHT,
                    image::ColorType::Rgba8,
                )
                .unwrap();
            }
        }
    }
    #[test]
    fn metadata_fallback_and_bounded_right_aligned_header() {
        assert_eq!(label(None, "Моя книга.fb2"), "Моя книга");
        let metadata = crate::publication::Metadata {
            author: Some(" Автор\nИмя ".into()),
            title: Some("  ".into()),
        };
        assert_eq!(label(Some(&metadata), "Роман.epub"), "Автор Имя — Роман");
        let faces = CURRENT_FONTS
            .iter()
            .map(|b| rustybuzz::Face::from_slice(b, 0).unwrap())
            .collect::<Vec<_>>();
        for text in [
            "Франсуа Рабле — Гаргантюа и Пантагрюэль".to_string(),
            "Длинное название ".repeat(100),
        ] {
            let header = layout(&text, &faces, &mut FontResolver::new(&faces)).unwrap();
            if text.len() > 200 {
                assert!(header.label.ends_with('…'));
            }
            for item in header.items {
                if let Item::GlyphRun { bounds, glyphs, .. } = item {
                    assert!(bounds[0] >= LABEL_LEFT - 0.1 && bounds[0] + bounds[2] <= RIGHT + 0.1);
                    assert!(bounds[1] + bounds[3] < 58.);
                    assert!(glyphs.iter().all(|g| g.3 == 0 && g.4 == 0));
                }
            }
        }
        let cover = PageLayout {
            width: WIDTH,
            height: HEIGHT,
            items: vec![Item::Image {
                asset: "cover".into(),
                bounds: [72., 72., 200., 300.],
            }],
        };
        assert!(!visible(&cover, 0));
        assert!(visible(&cover, 1));
    }
}
