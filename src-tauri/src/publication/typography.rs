mod cover;
pub(crate) mod editorial;
mod page_numbers;
pub(crate) mod running_header;
#[path = "sliding_window/mod.rs"]
pub mod sliding_window;
mod table;
use super::font_resolver::{FontResolver, Resolved};
use super::{
    model::{Block, ParagraphKind, Publication, Span},
    write_file,
};
use crate::library::{Result, edition::Manifest};
use crate::reader::document::PageInfo;
use serde::{Deserialize, Serialize};
use std::path::Path;
use unicode_segmentation::UnicodeSegmentation;

pub const WIDTH: u32 = 800;
pub const HEIGHT: u32 = 1120;
const LEFT: f32 = 72.;
const RIGHT: f32 = 728.;
const BOTTOM: f32 = 1032.;
pub struct FootnoteStyle {
    pub size: f32,
    pub line_height: f32,
    pub paragraph_gap: f32,
    pub max_fraction: f32,
    pub separator_gap: f32,
    pub separator_width: f32,
    pub minimum_lines: usize,
}
pub const FOOTNOTE_STYLE: FootnoteStyle = FootnoteStyle {
    size: 15.,
    line_height: 20.,
    paragraph_gap: 4.,
    max_fraction: 0.4,
    separator_gap: 16.,
    separator_width: RIGHT - LEFT,
    minimum_lines: 2,
};
mod footnotes;

pub static V3_FONTS: std::sync::LazyLock<[&'static [u8]; 7]> =
    std::sync::LazyLock::new(|| std::array::from_fn(|i| super::font_assets::FONTS[i].as_slice()));
pub static FONTS: std::sync::LazyLock<[&'static [u8]; 5]> =
    std::sync::LazyLock::new(|| std::array::from_fn(|i| V3_FONTS[i]));
pub static V2_FONTS: std::sync::LazyLock<[&'static [u8]; 6]> =
    std::sync::LazyLock::new(|| std::array::from_fn(|i| V3_FONTS[i]));
pub fn legacy_profile_id() -> String {
    let mut parts=vec!["reader-serif-v1;800x1120;m72;body19/28;indent28;gap6;heading26/36;unicode-linebreak;rustybuzz0.20.1;round64;LTR".to_owned()];
    parts.extend(
        FONTS
            .iter()
            .map(|f| crate::library::store::hash_reader(*f).expect("memory hash")),
    );
    crate::library::store::hash_id(&parts.iter().map(String::as_str).collect::<Vec<_>>())
}
pub fn v2_profile_id() -> String {
    crate::library::store::hash_id(&[
        &legacy_profile_id(),
        "reader-serif-v2;mono-symbols-fallback;subscript0.7/down0.2",
        &crate::library::store::hash_reader(V2_FONTS[5]).expect("memory hash"),
    ])
}
pub fn v3_profile_id() -> String {
    crate::library::store::hash_id(&[
        &v2_profile_id(),
        "reader-serif-v3;cjk-serif-fallback",
        &crate::library::store::hash_reader(V3_FONTS[6]).expect("memory hash"),
    ])
}
pub static CURRENT_FONTS: std::sync::LazyLock<[&'static [u8]; 4]> =
    std::sync::LazyLock::new(|| {
        std::array::from_fn(|i| super::font_assets::LITERATA[i].as_slice())
    });
pub fn profile_id() -> String {
    let mut parts = vec!["reader-literata-v1;800x1120;m72;body19/28;indent28;gap6;heading26/36;footnote15/20;static-optical-default;unicode-linebreak;rustybuzz0.20.1;round64;LTR;system-fallback".to_owned()];
    parts.extend(
        CURRENT_FONTS
            .iter()
            .map(|f| crate::library::store::hash_reader(*f).expect("memory hash")),
    );
    crate::library::store::hash_id(&parts.iter().map(String::as_str).collect::<Vec<_>>())
}
pub fn fonts_for_profile(profile: Option<&str>) -> Result<&'static [&'static [u8]]> {
    if profile == Some(profile_id().as_str()) {
        Ok(&*CURRENT_FONTS)
    } else if profile == Some(v3_profile_id().as_str()) {
        Ok(&*V3_FONTS)
    } else if profile == Some(v2_profile_id().as_str()) {
        Ok(&*V2_FONTS)
    } else if profile == Some(legacy_profile_id().as_str()) {
        Ok(&*FONTS)
    } else {
        Err("Unsupported canonical profile".into())
    }
}
// Glyph tuple: font glyph ID, baseline x/y, normalized source UTF-8 byte range.
#[derive(Clone, Serialize, Deserialize)]
pub struct Glyph(pub u16, pub f32, pub f32, pub usize, pub usize);
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Item {
    GlyphRun {
        font: usize,
        size: f32,
        glyphs: Vec<Glyph>,
        source_start: usize,
        source_end: usize,
        bounds: [f32; 4],
    },
    RasterGlyph {
        asset: String,
        baseline: [f32; 2],
        advance: f32,
        source_start: usize,
        source_end: usize,
        bounds: [f32; 4],
    },
    Image {
        asset: String,
        bounds: [f32; 4],
    },
    Rule {
        bounds: [f32; 4],
    },
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct PageLayout {
    pub width: u32,
    pub height: u32,
    pub items: Vec<Item>,
}
fn q(v: f32) -> f32 {
    (v * 64.).round() / 64.
}
#[derive(Clone)]
struct Token {
    level: unicode_bidi::Level,
    runs: Vec<Item>,
    width: f32,
    space: bool,
}
fn shape(
    text: &str,
    start: usize,
    spans: &[Span],
    size: f32,
    faces: &[rustybuzz::Face<'_>],
    resolver: &mut FontResolver<'_>,
) -> Result<Token> {
    crate::import_cancel::check()?;
    let mut token = Token {
        level: unicode_bidi::Level::ltr(),
        runs: vec![],
        width: 0.,
        space: text.trim().is_empty(),
    };
    for span in spans {
        let boundary = |p: usize| {
            text.grapheme_indices(true)
                .map(|(i, _)| start + i)
                .chain(std::iter::once(start + text.len()))
                .find(|&i| i >= p)
                .unwrap_or(start + text.len())
        };
        let a = boundary(start.max(span.start));
        let b = boundary((start + text.len()).min(span.end));
        if a >= b {
            continue;
        }
        let original = &text[a - start..b - start];
        let em = if span.style.superscript || span.style.subscript {
            size * 0.7
        } else {
            size
        };
        let shift = if span.style.superscript {
            -size * 0.35
        } else if span.style.subscript {
            size * 0.2
        } else {
            0.
        };
        for resolved in resolver.resolve(original, a, span.style, em)? {
            let (a, b, font) = match resolved {
                Resolved::Font { start, end, font } => (start, end, font),
                Resolved::Raster { mut items, advance } => {
                    for item in &mut items {
                        if let Item::RasterGlyph {
                            baseline, bounds, ..
                        } = item
                        {
                            baseline[0] = q(baseline[0] + token.width);
                            baseline[1] = q(baseline[1] + shift);
                            bounds[0] = q(bounds[0] + token.width);
                            bounds[1] = q(bounds[1] + shift);
                        }
                    }
                    token.runs.extend(items);
                    token.width += advance;
                    continue;
                }
            };
            let value = &text[a - start..b - start];
            let scale = em / faces[font].units_per_em() as f32;
            let mut buffer = rustybuzz::UnicodeBuffer::new();
            for (offset, ch) in value.char_indices() {
                buffer.add(ch, offset as u32);
            }
            buffer.guess_segment_properties();
            let shaped = rustybuzz::shape(&faces[font], &[], buffer);
            let mut clusters = shaped
                .glyph_infos()
                .iter()
                .map(|i| i.cluster as usize)
                .collect::<Vec<_>>();
            clusters.push(value.len());
            clusters.sort_unstable();
            clusters.dedup();
            let mut glyphs = vec![];
            let begin = token.width;
            for (info, pos) in shaped.glyph_infos().iter().zip(shaped.glyph_positions()) {
                if info.glyph_id == 0 {
                    return Err(format!(
                        "FontResolver coverage invariant violated for {:?}",
                        value
                    )
                    .into());
                }
                let cluster = info.cluster as usize;
                let end = *clusters
                    .iter()
                    .find(|&&c| c > cluster)
                    .unwrap_or(&value.len());
                glyphs.push(Glyph(
                    info.glyph_id as u16,
                    q(token.width + pos.x_offset as f32 * scale),
                    q(-pos.y_offset as f32 * scale
                        - if span.style.superscript {
                            size * 0.35
                        } else if span.style.subscript {
                            -size * 0.2
                        } else {
                            0.
                        }),
                    a + cluster,
                    a + end,
                ));
                token.width += pos.x_advance as f32 * scale;
            }
            resolver.record_font(font, glyphs.len());
            token.runs.push(Item::GlyphRun {
                font,
                size: em,
                glyphs,
                source_start: a,
                source_end: b,
                bounds: [begin, -size, token.width - begin, size * 1.3],
            });
        }
    }
    Ok(token)
}
// Only used when normal Unicode wrapping cannot fit a token. Re-shape each
// candidate as a whole run, preserving ligatures, contextual shaping and styles.
#[allow(clippy::too_many_arguments)]
fn emergency_prefix(
    text: &str,
    start: usize,
    original: &Token,
    spans: &[Span],
    size: f32,
    available: f32,
    faces: &[rustybuzz::Face<'_>],
    resolver: &mut FontResolver<'_>,
) -> Result<(usize, Token)> {
    let mut clusters = std::collections::HashSet::new();
    for run in &original.runs {
        match run {
            Item::GlyphRun { glyphs, .. } => {
                for glyph in glyphs {
                    clusters.insert(glyph.4);
                }
            }
            Item::RasterGlyph { source_end, .. } => {
                clusters.insert(*source_end);
            }
            Item::Image { .. } | Item::Rule { .. } => {}
        }
    }
    let boundaries: Vec<_> = text
        .grapheme_indices(true)
        .map(|(i, _)| i)
        .filter(|&i| i > 0 && clusters.contains(&(start + i)))
        .collect();
    // Probe increasingly long prefixes rather than repeatedly shaping half of
    // a potentially chapter-sized token. Binary refinement stays within that bound.
    let mut low = 0;
    let mut high = boundaries.len();
    let mut probe = 1usize;
    let mut best = None;
    while low < high {
        let count = probe.min(high);
        let end = boundaries[count - 1];
        let mut token = shape(&text[..end], start, spans, size, faces, resolver)?;
        token.level = original.level;
        if token.width <= available {
            best = Some((end, token));
            low = count;
            if low == high {
                break;
            }
            probe = count.saturating_mul(2).min(high);
        } else {
            high = count - 1;
            break;
        }
    }
    while low < high {
        let count = low + (high - low).div_ceil(2);
        let end = boundaries[count - 1];
        let mut token = shape(&text[..end], start, spans, size, faces, resolver)?;
        token.level = original.level;
        if token.width <= available {
            best = Some((end, token));
            low = count;
        } else {
            high = count - 1;
        }
    }
    best.ok_or_else(|| {
        "A publication grapheme or shaping cluster exceeds canonical line width".into()
    })
}

#[cfg(test)]
mod emergency_tests {
    use super::*;
    #[test]
    fn oversized_words_preserve_graphemes_styles_and_source_coverage() {
        let faces: Vec<_> = CURRENT_FONTS
            .iter()
            .map(|f| rustybuzz::Face::from_slice(f, 0).unwrap())
            .collect();
        for text in [
            "государственныхгимназиймузеевсанаториевисуспензориеввсеобщейисторииэкстра".repeat(3),
            "officea\u{301}".repeat(100),
        ] {
            let spans = [Span {
                start: 0,
                end: text.len(),
                style: super::super::model::Style {
                    italic: true,
                    ..Default::default()
                },
                link: None,
            }];
            let mut resolver = FontResolver::new(&faces);
            let boundaries: std::collections::HashSet<_> = text
                .grapheme_indices(true)
                .map(|(i, _)| i)
                .chain([text.len()])
                .collect();
            let mut offset = 0;
            let mut count = 0;
            while offset < text.len() {
                let original =
                    shape(&text[offset..], offset, &spans, 19., &faces, &mut resolver).unwrap();
                let (used, token) = if original.width > 300. {
                    emergency_prefix(
                        &text[offset..],
                        offset,
                        &original,
                        &spans,
                        19.,
                        300.,
                        &faces,
                        &mut resolver,
                    )
                    .unwrap()
                } else {
                    (text.len() - offset, original)
                };
                assert!(used > 0 && token.width <= 300.);
                assert!(boundaries.contains(&(offset + used)));
                let mut covered = vec![false; used];
                for run in &token.runs {
                    if let Item::GlyphRun { font, glyphs, .. } = run {
                        assert_eq!(*font, 1, "italic style survives emergency wrapping");
                        for g in glyphs {
                            assert!(g.3 >= offset && g.4 <= offset + used);
                            covered[g.3 - offset..g.4 - offset].fill(true);
                        }
                    }
                }
                assert!(covered.iter().all(|b| *b), "no source bytes lost");
                offset += used;
                count += 1;
            }
            assert!(count > 1);
        }
    }
}

fn measured_line(
    tokens: &mut Vec<Token>,
    left: f32,
    right: f32,
    metrics: (f32, f32),
    justify: bool,
    center: bool,
) -> Vec<Item> {
    let (size, _height) = metrics;
    while tokens.last().is_some_and(|t| t.space) {
        tokens.pop();
    }
    let mut items = vec![];
    let width: f32 = tokens.iter().map(|t| t.width).sum();
    let spaces = tokens.iter().filter(|t| t.space).count();
    let extra = if justify && spaces > 0 {
        ((right - left - width) / spaces as f32).max(0.)
    } else {
        0.
    };
    let mut x = left
        + if center {
            ((right - left - width) / 2.).max(0.)
        } else {
            0.
        };
    let order =
        unicode_bidi::BidiInfo::reorder_visual(&tokens.iter().map(|t| t.level).collect::<Vec<_>>());
    let mut visual = tokens.drain(..).map(Some).collect::<Vec<_>>();
    for index in order {
        let token = visual[index].take().expect("unique bidi index");
        for mut run in token.runs {
            if let Item::GlyphRun { glyphs, bounds, .. } = &mut run {
                for g in glyphs {
                    g.1 = q(g.1 + x);
                    g.2 = q(g.2 + size);
                }
                bounds[0] = q(bounds[0] + x);
                bounds[1] = q(bounds[1] + size);
            }
            if let Item::RasterGlyph {
                baseline, bounds, ..
            } = &mut run
            {
                baseline[0] = q(baseline[0] + x);
                baseline[1] = q(baseline[1] + size);
                bounds[0] = q(bounds[0] + x);
                bounds[1] = q(bounds[1] + size);
            }
            items.push(run);
        }
        x += token.width + if token.space { extra } else { 0. };
    }
    items
}
#[cfg(test)]
thread_local! {pub static TYPESETS:std::cell::Cell<usize>=const {std::cell::Cell::new(0)};}
pub fn publish_current(model: &Publication, root: &Path, manifest: &mut Manifest) -> Result<()> {
    if manifest.publisher_version < 17
        || model
            .blocks
            .iter()
            .any(|b| matches!(b, Block::Table { .. }))
    {
        return publish(model, root, manifest);
    }
    // Isolate speculative output: fallback must never see partially written fonts/pages.
    let attempt = tempfile::tempdir()?;
    let original_paths: std::collections::HashSet<_> =
        manifest.assets.iter().map(|f| f.path.clone()).collect();
    for file in &manifest.assets {
        let target = attempt.path().join(&file.path);
        std::fs::create_dir_all(target.parent().ok_or("Missing asset parent")?)?;
        std::fs::copy(root.join(&file.path), target)?;
    }
    let mut candidate = manifest.clone();
    if let Err(error) = sliding_window::publish(
        model,
        attempt.path(),
        &mut candidate,
        sliding_window::CompositionStrategy::ProductionV22,
    ) {
        eprintln!("V2.2 unavailable for manuscript; using frozen Legacy: {error}");
        return publish(model, root, manifest);
    }
    for file in candidate.assets.iter().chain(&candidate.page_files) {
        if !original_paths.contains(&file.path) {
            write_file(
                root,
                &file.path,
                &std::fs::read(attempt.path().join(&file.path))?,
            )?;
        }
    }
    *manifest = candidate;
    Ok(())
}
pub fn publish(model: &Publication, root: &Path, manifest: &mut Manifest) -> Result<()> {
    publish_with_provider(model, root, manifest, super::system_fallback::provider())
}
pub fn publish_with_provider(
    model: &Publication,
    root: &Path,
    manifest: &mut Manifest,
    provider: Box<dyn super::system_fallback::SystemFontFallbackProvider>,
) -> Result<()> {
    let plan = illustration_plan(model, root, manifest)?;
    publish_plan(model, root, manifest, provider, &plan)
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct LayoutPlan {
    pub full_pages: Vec<String>,
    pub floats: Vec<FloatSpec>,
    #[serde(default)]
    pub deferred_lines: std::collections::BTreeMap<usize, usize>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct FloatSpec {
    pub image_block: usize,
    pub paragraph_block: usize,
    pub asset: String,
    pub left: bool,
    pub width: f32,
    pub height: f32,
}
// Covers remain standalone. Other portrait images alternate left/right.
fn illustration_plan(model: &Publication, root: &Path, manifest: &Manifest) -> Result<LayoutPlan> {
    let mut plan = LayoutPlan::default();
    if manifest.publisher_version < 7 {
        return Ok(plan);
    }
    let mut left = true;
    for (i, block) in model.blocks.iter().enumerate() {
        let Block::Image {
            asset,
            cover: false,
        } = block
        else {
            continue;
        };
        let record = manifest
            .assets
            .iter()
            .find(|r| &r.path == asset)
            .ok_or("Missing image record")?;
        let (w, h) = super::images::dimensions(&super::read_file(
            root,
            record,
            super::images::MAX_IMAGE_BYTES,
        )?)?;
        if h <= w {
            continue;
        }
        let scale = ((RIGHT - LEFT) / 2. / w as f32)
            .min(900. / h as f32)
            .min(1.);
        if matches!(
            model.blocks.get(i + 1),
            Some(Block::Paragraph {
                style: ParagraphKind::Body,
                ..
            })
        ) {
            plan.floats.push(FloatSpec {
                image_block: i,
                paragraph_block: i + 1,
                asset: asset.clone(),
                left,
                width: w as f32 * scale,
                height: h as f32 * scale,
            });
            left = !left;
        }
    }
    Ok(plan)
}
pub fn publish_planned(
    model: &Publication,
    root: &Path,
    manifest: &mut Manifest,
    plan: &LayoutPlan,
) -> Result<()> {
    publish_plan(
        model,
        root,
        manifest,
        super::system_fallback::provider(),
        plan,
    )
}
fn publish_plan(
    model: &Publication,
    root: &Path,
    manifest: &mut Manifest,
    provider: Box<dyn super::system_fallback::SystemFontFallbackProvider>,
    plan: &LayoutPlan,
) -> Result<()> {
    #[cfg(test)]
    TYPESETS.with(|n| n.set(n.get() + 1));
    let font_timer = crate::pipeline_metrics::stage("font_storage");
    for (i, font) in CURRENT_FONTS.iter().enumerate() {
        manifest
            .assets
            .push(write_file(root, &format!("assets/fonts/{i}.ttf"), font)?);
    }
    manifest.assets.push(write_file(
        root,
        "assets/fonts/OFL.txt",
        include_bytes!("../../assets/fonts/Literata-OFL.txt"),
    )?);
    drop(font_timer);
    let publisher_timer = crate::pipeline_metrics::stage("publisher");
    let started = std::time::Instant::now();
    let (blocks, notes) = if model.notes.is_empty() {
        (
            if plan.floats.is_empty() {
                measure(model, root, manifest, provider)?
            } else {
                measure_planned(model, root, manifest, provider, plan)?
            },
            Vec::new(),
        )
    } else {
        if plan.floats.is_empty() {
            footnotes::measure(model, root, manifest, provider)?
        } else {
            footnotes::measure_planned(model, root, manifest, provider, plan)?
        }
    };
    let measurement_ms = started.elapsed().as_secs_f64() * 1000.;
    let (mut pages, mut trace) = if notes.is_empty() {
        super::optimizer::paginate(model, &blocks)?
    } else {
        super::optimizer::footnotes::paginate_with_policy(
            model,
            &blocks,
            &notes,
            manifest.publisher_version >= 26,
        )?
    };
    for page in &mut pages {
        if let [Item::Image { asset, bounds }] = page.items.as_mut_slice()
            && plan.full_pages.contains(asset)
        {
            let record = manifest
                .assets
                .iter()
                .find(|r| &r.path == asset)
                .ok_or("Missing full-page asset")?;
            let (w, h) = super::images::dimensions(&super::read_file(
                root,
                record,
                super::images::MAX_IMAGE_BYTES,
            )?)?;
            let scale = (WIDTH as f32 / w as f32).min(HEIGHT as f32 / h as f32);
            let (w, h) = (w as f32 * scale, h as f32 * scale);
            *bounds = [(WIDTH as f32 - w) / 2., (HEIGHT as f32 - h) / 2., w, h];
        }
    }
    if manifest.publisher_version >= 21 {
        let mut numbers = page_numbers::PageNumbers::default();
        numbers.delicate = manifest.publisher_version >= 26;
        for page in &mut pages {
            numbers.apply(page, model)?;
            if manifest.publisher_version >= 26 {
                editorial::finish_page(page);
            }
        }
    }
    if manifest.publisher_version >= 22
        && let Some(page) = pages.first_mut()
    {
        cover::fit(page, 0);
    }
    trace.measurement_ms = measurement_ms;
    super::optimizer::set_trace(trace);
    drop(publisher_timer);
    let _storage_timer = crate::pipeline_metrics::stage("page_serialization");
    for (index, page) in pages.iter().enumerate() {
        manifest.page_files.push(write_file(
            root,
            &format!("pages/{:06}.json", index + 1),
            &serde_json::to_vec(page)?,
        )?);
        manifest.pages.push(PageInfo {
            width: WIDTH,
            height: HEIGHT,
            dpi: None,
        });
    }
    Ok(())
}

pub(crate) fn measure(
    model: &Publication,
    root: &Path,
    manifest: &mut Manifest,
    provider: Box<dyn super::system_fallback::SystemFontFallbackProvider>,
) -> Result<Vec<super::optimizer::Measured>> {
    measure_planned(model, root, manifest, provider, &LayoutPlan::default())
}
fn measure_planned(
    model: &Publication,
    root: &Path,
    manifest: &mut Manifest,
    provider: Box<dyn super::system_fallback::SystemFontFallbackProvider>,
    plan: &LayoutPlan,
) -> Result<Vec<super::optimizer::Measured>> {
    let faces = CURRENT_FONTS
        .iter()
        .map(|bytes| rustybuzz::Face::from_slice(bytes, 0).ok_or("Invalid bundled font"))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut resolver = FontResolver::with_provider(&faces, provider);
    let blocks = measure_main(model, &faces, &mut resolver, root, manifest, plan)?;
    let blocks = fit_illustrations(
        model,
        root,
        manifest,
        &faces,
        &mut resolver,
        plan,
        blocks,
        &[],
    )?;
    resolver.finish(root, manifest)?;
    Ok(blocks)
}

// Bounded page-aware refinement: shrink an overflowing float, then reflow text
// at its new width. Never scale pre-shaped glyphs with an illustration.
#[allow(clippy::too_many_arguments)]
fn fit_illustrations(
    model: &Publication,
    root: &Path,
    manifest: &Manifest,
    faces: &[rustybuzz::Face<'_>],
    resolver: &mut FontResolver<'_>,
    original: &LayoutPlan,
    mut blocks: Vec<super::optimizer::Measured>,
    notes: &[super::optimizer::footnotes::MeasuredNote],
) -> Result<Vec<super::optimizer::Measured>> {
    if manifest.publisher_version < 10 || original.floats.is_empty() {
        return Ok(blocks);
    }
    let mut plan = original.clone();
    if manifest.publisher_version >= 14 {
        let mut raised = false;
        for f in &mut plan.floats {
            let Some(previous) = f.image_block.checked_sub(1) else {
                continue;
            };
            if !matches!(
                &model.blocks[previous],
                Block::Paragraph {
                    style: ParagraphKind::Body,
                    ..
                }
            ) || model
                .structure
                .iter()
                .any(|s| s.chapter && (previous..=f.paragraph_block).contains(&s.block))
            {
                continue;
            }
            let super::optimizer::Measured::Text {
                lines: preceding, ..
            } = &blocks[previous]
            else {
                continue;
            };
            if preceding.len() < 2
                || preceding
                    .iter()
                    .flat_map(|l| &l.items)
                    .any(|i| matches!(i, Item::Image { .. }))
            {
                continue;
            }
            let super::optimizer::Measured::Text { lines, .. } = &blocks[f.paragraph_block] else {
                continue;
            };
            let Some(band) = lines.first() else {
                continue;
            };
            let Some(image_bottom) = band.items.iter().find_map(|i| match i {
                Item::Image { asset, bounds } if asset == &f.asset => Some(bounds[1] + bounds[3]),
                _ => None,
            }) else {
                continue;
            };
            let text_bottom = band
                .items
                .iter()
                .filter_map(|i| match i {
                    Item::GlyphRun { bounds, .. } | Item::RasterGlyph { bounds, .. } => {
                        Some(bounds[1] + bounds[3])
                    }
                    _ => None,
                })
                .fold(0f32, f32::max);
            if image_bottom - text_bottom >= 28. {
                f.paragraph_block = previous;
                raised = true;
            }
        }
        if raised {
            blocks = measure_main(model, faces, resolver, root, manifest, &plan)?;
        }
    }
    for pass in 0..if manifest.publisher_version >= 16 {
        8
    } else if manifest.publisher_version >= 15 {
        3
    } else {
        2
    } {
        let (pages, _) = if notes.is_empty() {
            super::optimizer::paginate(model, &blocks)?
        } else {
            super::optimizer::footnotes::paginate(model, &blocks, notes)?
        };
        let mut changed = false;
        for pair in pages.windows(2) {
            let previous = &pair[0];
            // Covers, note continuations, and heading boundaries are not gaps.
            if previous.items.is_empty()
                || previous
                    .items
                    .iter()
                    .any(|i| matches!(i, Item::Rule { .. }))
                || !previous
                    .items
                    .iter()
                    .any(|i| matches!(i, Item::GlyphRun { .. }))
            {
                continue;
            }
            let bottom = previous
                .items
                .iter()
                .map(|item| match item {
                    Item::GlyphRun { bounds, .. }
                    | Item::RasterGlyph { bounds, .. }
                    | Item::Image { bounds, .. }
                    | Item::Rule { bounds } => bounds[1] + bounds[3],
                })
                .fold(72f32, f32::max);
            let available = BOTTOM - bottom - 100.; // bridge, line rounding, paragraph gap
            if available
                < if manifest.publisher_version >= 16 {
                    // The 100px image reserve does not apply to plain text.
                    -100.
                } else if manifest.publisher_version >= 15 {
                    0.
                } else {
                    180.
                }
            {
                continue;
            }
            for item in &pair[1].items {
                let Item::Image { asset, bounds } = item else {
                    continue;
                };
                if bounds[1]
                    > if manifest.publisher_version >= 15 {
                        246.
                    } else {
                        140.
                    }
                    || pair[1].items.iter().any(|i| {
                        matches!(i,
                    Item::GlyphRun { size, bounds: b, .. } if *size > 19. && b[1] < bounds[1])
                    })
                {
                    continue;
                }
                if original.floats.iter().filter(|f| &f.asset == asset).count() != 1 {
                    continue;
                }
                let Some(f) = plan.floats.iter_mut().find(|f| &f.asset == asset) else {
                    continue;
                };
                let base = original.floats.iter().find(|f| &f.asset == asset).unwrap();
                if model.structure.iter().any(|s| {
                    s.chapter && (s.block == f.image_block || s.block == f.paragraph_block)
                }) {
                    continue;
                }
                let target = available.min(f.height * 0.9);
                if target < base.height * 0.6 || target >= f.height || available < 180. || pass >= 2
                {
                    if manifest.publisher_version >= 15
                        && (manifest.publisher_version >= 16
                            || !plan.deferred_lines.contains_key(&f.image_block))
                    {
                        let lines = ((BOTTOM - bottom - 20.) / 28.).floor().max(0.) as usize;
                        if lines >= 2 {
                            let prior = plan
                                .deferred_lines
                                .get(&f.image_block)
                                .copied()
                                .unwrap_or(0);
                            // Reflow can move an earlier paragraph to this page,
                            // changing the remaining gap. Refine an existing prefix
                            // instead of considering the first estimate final.
                            let next = (prior + lines).min(24);
                            if next > prior {
                                plan.deferred_lines.insert(f.image_block, next);
                                changed = true;
                            }
                        }
                    }
                    continue;
                }
                f.width *= target / f.height;
                f.height = target;
                changed = true;
                break;
            }
        }
        if !changed {
            break;
        }
        blocks = measure_main(model, faces, resolver, root, manifest, &plan)?;
    }
    Ok(blocks)
}

#[allow(clippy::too_many_arguments)]
fn measure_main(
    model: &Publication,
    faces: &[rustybuzz::Face<'_>],
    resolver: &mut FontResolver<'_>,
    root: &Path,
    manifest: &Manifest,
    plan: &LayoutPlan,
) -> Result<Vec<super::optimizer::Measured>> {
    if plan.floats.is_empty() {
        return measure_blocks(model, &model.blocks, None, faces, resolver, root, manifest);
    }
    for f in &plan.floats {
        if !(f.image_block.checked_add(1) == Some(f.paragraph_block)
            || (manifest.publisher_version >= 14 && f.paragraph_block.checked_add(1) == Some(f.image_block)))
            || f.image_block >= model.blocks.len()
            || f.paragraph_block >= model.blocks.len()
            || !matches!(&model.blocks[f.image_block],Block::Image{asset,cover:false} if asset==&f.asset)
            || !matches!(
                &model.blocks[f.paragraph_block],
                Block::Paragraph {
                    style: ParagraphKind::Body,
                    ..
                }
            )
            // f32 division followed by multiplication can overshoot the bound
            // by a few ULPs (e.g. 645 * (328 / 645) = 328.00003).
            // Allow less than 1/1024 px, without altering saved geometry.
            || !(1. ..=(RIGHT - LEFT) / 2. + 1. / 1024.).contains(&f.width)
            || !(1. ..=900. + 1. / 1024.).contains(&f.height)
        {
            return Err("Invalid floating illustration plan".into());
        }
    }
    use super::optimizer::{Line, Measured};
    let empty = || Measured::Text {
        lines: vec![],
        gap: 0.,
        heading: false,
        movable: false,
    };
    let mut flow_blocks = model.blocks.clone();
    let mut blocks = Vec::with_capacity(model.blocks.len());
    let mut i = 0;
    let mut previous_float_side = None;
    let mut placed_images = std::collections::HashSet::new();
    while i < model.blocks.len() {
        crate::import_cancel::check()?;
        if placed_images.contains(&i) {
            blocks.push(empty());
            i += 1;
            continue;
        }
        let Some(f) = plan
            .floats
            .iter()
            .find(|f| f.image_block.min(f.paragraph_block) == i)
        else {
            if !matches!(
                &model.blocks[i],
                Block::Paragraph {
                    style: ParagraphKind::Body,
                    ..
                }
            ) {
                previous_float_side = None;
            }
            let continuation = matches!((&flow_blocks[i], &model.blocks[i]),
                (Block::Paragraph { start: a, .. }, Block::Paragraph { start: b, .. }) if a != b);
            let no_exclusion = FloatSpec {
                image_block: 0,
                paragraph_block: 0,
                asset: String::new(),
                left: false,
                width: 0.,
                height: 0.,
            };
            blocks.extend(measure_blocks_impl(
                model,
                &flow_blocks[i..=i],
                None,
                faces,
                resolver,
                root,
                manifest,
                continuation.then_some((&no_exclusion, 0., true)),
            )?);
            i += 1;
            continue;
        };
        placed_images.insert(f.image_block);
        if i == f.image_block {
            blocks.push(empty()); // Preserve source block indices for structure/notes.
            i += 1;
        }
        let anchor = i;
        let mut prefix = vec![];
        let mut lead = plan
            .deferred_lines
            .get(&f.image_block)
            .copied()
            .unwrap_or(0);
        while lead > 0 && i < model.blocks.len() {
            if i == f.image_block {
                blocks.push(empty());
                i += 1;
                continue;
            }
            let Block::Paragraph { start, .. } = &flow_blocks[i] else {
                break;
            };
            if !matches!(
                &flow_blocks[i],
                Block::Paragraph {
                    style: ParagraphKind::Body,
                    ..
                }
            ) || model.structure.iter().any(|s| s.chapter && s.block == i)
            {
                break;
            }
            let continuation = matches!(&model.blocks[i], Block::Paragraph { start: original, .. } if original != start);
            let no_exclusion = FloatSpec {
                height: 0.,
                ..f.clone()
            };
            let Measured::Text { mut lines, gap, .. } = measure_blocks_impl(
                model,
                &flow_blocks[i..=i],
                None,
                faces,
                resolver,
                root,
                manifest,
                Some((&no_exclusion, 0., continuation)),
            )?
            .pop()
            .unwrap() else {
                unreachable!()
            };
            let count = lead.min(lines.len());
            let mut consumed = *start;
            for line in lines.drain(..count) {
                for item in &line.items {
                    if let Item::GlyphRun { source_end, .. }
                    | Item::RasterGlyph { source_end, .. } = item
                    {
                        consumed = consumed.max(*source_end);
                    }
                }
                prefix.push(line);
            }
            lead -= count;
            if let Block::Paragraph { start, end, .. } = &mut flow_blocks[i] {
                *start = if lines.is_empty() { *end } else { consumed };
                while *start < *end && model.text.as_bytes()[*start].is_ascii_whitespace() {
                    *start += 1;
                }
            }
            if lines.is_empty() {
                if let Some(last) = prefix.last_mut() {
                    last.height += gap;
                }
                blocks.push(empty());
                i += 1;
            } else {
                break;
            }
        }
        // Let the next paragraph bridge opposing illustrations at full width.
        // Keep these lines with their illustration even if pagination moves the band.
        let top = if manifest.publisher_version >= 8
            && previous_float_side.is_some_and(|left| left != f.left)
        {
            56.
        } else {
            0.
        };
        previous_float_side = Some(f.left);
        // The bridge and the indivisible float band must still fit a fresh page.
        let mut f = f.clone();
        let scale = ((900. - top) / f.height).min(1.);
        f.width *= scale;
        f.height *= scale;
        let bottom = top + f.height;
        let mut y = 0.;
        let mut combined = vec![Item::Image {
            asset: f.asset.clone(),
            bounds: [
                if f.left { LEFT } else { RIGHT - f.width },
                top,
                f.width,
                f.height,
            ],
        }];
        let mut borrowed_index = None;
        let mut fill_bottom = bottom;
        while i < model.blocks.len() && y < fill_bottom {
            if i == f.image_block {
                blocks.push(empty());
                i += 1;
                continue;
            }
            // A following float is deferred, but its paragraph can already fill
            // the current exclusion area. Preserve the remainder's source range.
            let next_float = plan.floats.iter().any(|next| next.image_block == i);
            let deferred_block_image = manifest.publisher_version >= 11
                && matches!(&model.blocks[i], Block::Image { cover: false, .. })
                && !next_float;
            let borrowed = (manifest.publisher_version >= 9 && next_float) || deferred_block_image;
            let text_index = if borrowed {
                borrowed_index.unwrap_or(i + 1)
            } else {
                i
            };
            if text_index >= model.blocks.len()
                || model
                    .structure
                    .iter()
                    .any(|s| s.chapter && s.block == text_index)
            {
                break;
            }
            if deferred_block_image {
                // Real full-width lines between the active float and deferred image.
                fill_bottom = (bottom + 56.).min(BOTTOM - 72. - 28.);
            }
            if !matches!(
                &flow_blocks[text_index],
                Block::Paragraph {
                    style: ParagraphKind::Body,
                    ..
                }
            ) {
                break;
            }
            let continuation = match (&flow_blocks[text_index], &model.blocks[text_index]) {
                (Block::Paragraph { start: a, .. }, Block::Paragraph { start: b, .. }) => a != b,
                _ => false,
            };
            let remaining = FloatSpec {
                height: bottom - y,
                ..f.clone()
            };
            let measured = measure_blocks_impl(
                model,
                &flow_blocks[text_index..=text_index],
                None,
                faces,
                resolver,
                root,
                manifest,
                Some((&remaining, top - y, continuation)),
            )?
            .pop()
            .unwrap();
            let Measured::Text { mut lines, gap, .. } = measured else {
                unreachable!()
            };
            let n = lines
                .iter()
                .scan(y, |at, line| {
                    let beside = *at < fill_bottom;
                    *at += line.height;
                    Some(beside)
                })
                .take_while(|beside| *beside)
                .count();
            let mut consumed_end = None;
            for line in lines.drain(..n) {
                for mut item in line.items {
                    if let Item::GlyphRun { source_end, .. }
                    | Item::RasterGlyph { source_end, .. } = &item
                    {
                        consumed_end = Some(consumed_end.unwrap_or(0).max(*source_end));
                    }
                    super::optimizer::translate(&mut item, 0., y);
                    combined.push(item);
                }
                y += line.height;
            }
            if borrowed {
                if let Block::Paragraph { start, end, .. } = &mut flow_blocks[text_index] {
                    *start = if lines.is_empty() {
                        *end
                    } else {
                        consumed_end.unwrap_or(*start)
                    };
                    // Spaces at a line boundary have no visible glyph.
                    while *start < *end && model.text.as_bytes()[*start].is_ascii_whitespace() {
                        *start += 1;
                    }
                }
                if manifest.publisher_version >= 11 && lines.is_empty() {
                    y += gap;
                    borrowed_index = Some(text_index + 1);
                    continue;
                }
                break;
            }
            if lines.is_empty() {
                y += gap;
                blocks.push(empty());
            } else {
                blocks.push(Measured::Text {
                    lines,
                    gap,
                    heading: false,
                    movable: true,
                });
            }
            i += 1;
        }
        let band = Line {
            items: combined,
            height: y.max(bottom),
        };
        if let Measured::Text { lines, .. } = &mut blocks[anchor] {
            lines.splice(0..0, prefix.into_iter().chain(std::iter::once(band)));
        }
    }
    Ok(blocks)
}
#[allow(clippy::too_many_arguments)]
fn measure_blocks(
    model: &Publication,
    selected: &[Block],
    note_indent: Option<f32>,
    faces: &[rustybuzz::Face<'_>],
    resolver: &mut FontResolver<'_>,
    root: &Path,
    manifest: &Manifest,
) -> Result<Vec<super::optimizer::Measured>> {
    measure_blocks_impl(
        model,
        selected,
        note_indent,
        faces,
        resolver,
        root,
        manifest,
        None,
    )
}
#[allow(clippy::too_many_arguments)]
fn measure_blocks_impl(
    model: &Publication,
    selected: &[Block],
    note_indent: Option<f32>,
    faces: &[rustybuzz::Face<'_>],
    resolver: &mut FontResolver<'_>,
    root: &Path,
    manifest: &Manifest,
    float: Option<(&FloatSpec, f32, bool)>,
) -> Result<Vec<super::optimizer::Measured>> {
    let footnote = note_indent.is_some();
    let blocks = selected
        .iter()
        .map(|block| match block {
            Block::Table {
                cells,
                rows,
                columns,
                ..
            } => table::measure(
                model, cells, *rows, *columns, faces, resolver, root, manifest,
            ),
            Block::EmptyLine => Ok(super::optimizer::Measured::Space),
            Block::Image { asset, cover } => {
                let record = manifest
                    .assets
                    .iter()
                    .find(|r| &r.path == asset)
                    .ok_or("Missing image record")?;
                let (w, h) = super::images::dimensions(&super::read_file(
                    root,
                    record,
                    super::images::MAX_IMAGE_BYTES,
                )?)?;
                let portrait = manifest.publisher_version >= 7 && !cover && h > w;
                let available_width = if portrait {
                    (RIGHT - LEFT) / 2.
                } else {
                    RIGHT - LEFT
                };
                let available_height = if portrait { 900. } else { BOTTOM - 72. };
                let scale = (available_width / w as f32)
                    .min(available_height / h as f32)
                    .min(1.);
                Ok(super::optimizer::Measured::Image {
                    asset: asset.clone(),
                    width: w as f32 * scale,
                    height: h as f32 * scale,
                    cover: *cover,
                })
            }
            Block::Paragraph {
                start,
                end,
                spans,
                style,
                ..
            } => {
                let mut lines = vec![];
                let heading = *style == ParagraphKind::Heading;
                let size = if footnote {
                    FOOTNOTE_STYLE.size
                } else if heading {
                    26.
                } else if *style == ParagraphKind::Subtitle {
                    20.
                } else {
                    19.
                };
                let height = if footnote {
                    FOOTNOTE_STYLE.line_height
                } else if heading {
                    36.
                } else {
                    28.
                };
                let scale = if !footnote && manifest.publisher_version >= 26 {
                    editorial::metrics(model, *start, *style)
                } else {
                    (size, height, false)
                };
                let (size, height) = (scale.0, scale.1);
                let normalized_spans;
                let spans = if !footnote && manifest.publisher_version >= 26 {
                    normalized_spans = editorial::spans(spans, *style, scale.2);
                    normalized_spans.as_ref()
                } else {
                    spans.as_slice()
                };
                let inset = if footnote {
                    note_indent.unwrap()
                } else if matches!(
                    style,
                    ParagraphKind::Quote | ParagraphKind::Verse | ParagraphKind::Author
                ) {
                    36.
                } else {
                    0.
                };
                let mut left = LEFT
                    + inset
                    + if !footnote
                        && *style == ParagraphKind::Body
                        && !float.is_some_and(|(_, _, continuation)| continuation)
                    {
                        28.
                    } else {
                        0.
                    };
                let mut right = if footnote { RIGHT } else { RIGHT - inset };
                let beside_float = |line: usize| {
                    float
                        .filter(|(f, top, _)| {
                            let y = line as f32 * height;
                            y + height > *top && y < f.height
                        })
                        .map(|(f, _, _)| f)
                };
                if let Some(f) = beside_float(0) {
                    if f.left {
                        left += f.width + 12.;
                    } else {
                        right -= f.width + 12.;
                    }
                }
                let text = &model.text[*start..*end];
                let bidi = unicode_bidi::BidiInfo::new(text, None);
                // Unicode break opportunities, with spaces kept separate for justification.
                let mut breaks = unicode_linebreak::linebreaks(text)
                    .map(|(i, _)| i)
                    .collect::<Vec<_>>();
                for (i, c) in text.char_indices() {
                    if c == ' ' {
                        breaks.push(i);
                        breaks.push(i + 1);
                    }
                }
                let graphemes: std::collections::HashSet<_> = text
                    .grapheme_indices(true)
                    .map(|(i, _)| i)
                    .chain(std::iter::once(text.len()))
                    .collect();
                breaks.retain(|i| graphemes.contains(i));
                breaks.push(text.len());
                breaks.sort_unstable();
                breaks.dedup();
                let mut previous = 0;
                let mut line = vec![];
                let mut width = 0.;
                let mut pending: std::collections::VecDeque<_> = breaks.into();
                while let Some(end) = pending.pop_front() {
                    if end == previous {
                        continue;
                    }
                    let token_start = previous;
                    let mut token = shape(
                        &text[previous..end],
                        start + previous,
                        spans,
                        size,
                        faces,
                        resolver,
                    )?;
                    token.level = bidi.levels[previous];
                    previous = end;
                    if token.space && line.is_empty() {
                        continue;
                    }
                    if width + token.width > right - left && !line.is_empty() {
                        lines.push(super::optimizer::Line {
                            items: measured_line(
                                &mut line,
                                left,
                                right,
                                (size, height),
                                !footnote
                                    && matches!(style, ParagraphKind::Body | ParagraphKind::Quote),
                                heading && !footnote,
                            ),
                            height,
                        });
                        left = LEFT + inset;
                        right = if footnote { RIGHT } else { RIGHT - inset };
                        if let Some(f) = beside_float(lines.len()) {
                            if f.left {
                                left += f.width + 12.;
                            } else {
                                right -= f.width + 12.;
                            }
                        }
                        width = 0.;
                        if token.space {
                            continue;
                        }
                    }
                    if token.width > right - left {
                        let (used, prefix) = emergency_prefix(
                            &text[token_start..end],
                            start + token_start,
                            &token,
                            spans,
                            size,
                            right - left,
                            faces,
                            resolver,
                        )?;
                        previous = token_start + used;
                        pending.push_front(end);
                        token = prefix;
                    }
                    width += token.width;
                    line.push(token);
                }
                if !line.is_empty() {
                    lines.push(super::optimizer::Line {
                        items: measured_line(
                            &mut line,
                            left,
                            right,
                            (size, height),
                            false,
                            heading && !footnote,
                        ),
                        height,
                    });
                }
                let gap = if footnote {
                    FOOTNOTE_STYLE.paragraph_gap
                } else if *style == ParagraphKind::Verse {
                    0.
                } else if heading {
                    14.
                } else {
                    6.
                };
                Ok(super::optimizer::Measured::Text {
                    lines,
                    gap,
                    heading: heading || *style == ParagraphKind::Subtitle,
                    movable: *style == ParagraphKind::Body,
                })
            }
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(blocks)
}
