use super::{
    FileRecord, read_file,
    typography::{HEIGHT, Item, PageLayout, WIDTH},
    validate_files,
};
use crate::reader::document::PageAppearance;
use crate::{
    library::{Result, edition::Manifest},
    reader::{
        document::{Document, PageInfo, RenderRequest, RenderedPage},
        format::FormatId,
        sources::FB2,
    },
};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};
pub struct GeneratedDocument {
    format: FormatId,
    root: PathBuf,
    pages: Vec<FileRecord>,
    assets: HashMap<String, FileRecord>,
    fonts: Vec<fontdue::Font>,
    text: String,
    storage_version: u32,
    running_header: Vec<Item>,
    page_footers: Vec<Vec<Item>>,
    editorial: bool,
}

// Independent outline rasterization can give the mirrored stems of [ and ]
// different pixel coverage at small sizes. Share one mask for the pair, retaining
// each glyph's bearings/advance and mirroring only the bitmap for the closing one.
fn rasterize_balanced_bracket(
    font: &fontdue::Font,
    glyph: u16,
    size: f32,
) -> (fontdue::Metrics, Vec<u8>) {
    let left = font.lookup_glyph_index('[');
    let right = font.lookup_glyph_index(']');
    if left == 0 || right == 0 || (glyph != left && glyph != right) {
        return font.rasterize_indexed(glyph, size);
    }
    let (lm, mut mask) = font.rasterize_indexed(left, size);
    let (rm, other) = font.rasterize_indexed(right, size);
    if lm.width == rm.width && lm.height == rm.height {
        for y in 0..lm.height {
            for x in 0..lm.width {
                let i = y * lm.width + x;
                mask[i] = ((u16::from(mask[i]) + u16::from(other[y * lm.width + lm.width - 1 - x]))
                    / 2) as u8;
            }
        }
    }
    if glyph == left {
        return (lm, mask);
    }
    if lm.width > 0 {
        for row in mask.chunks_exact_mut(lm.width) {
            row.reverse();
        }
    }
    let mut metrics = rm;
    metrics.width = lm.width;
    metrics.height = lm.height;
    metrics.ymin = lm.ymin;
    (metrics, mask)
}
impl GeneratedDocument {
    pub fn open(root: &Path, manifest: &Manifest) -> Result<Self> {
        Self::open_with_fonts(root, manifest, None)
    }
    pub fn open_with_fonts(
        root: &Path,
        manifest: &Manifest,
        fonts_root: Option<&Path>,
    ) -> Result<Self> {
        let mut timing = crate::open_timing::OpenTiming::new();
        validate_files(root, manifest)?;
        timing.mark("generated.file_validation");
        let expected_fonts = super::typography::fonts_for_profile(manifest.profile_id.as_deref())?;
        if manifest
            .pages
            .iter()
            .any(|p| p.width != WIDTH || p.height != HEIGHT)
        {
            return Err("Unsupported canonical profile/geometry".into());
        }
        let assets: HashMap<_, _> = manifest
            .assets
            .iter()
            .map(|r| (r.path.clone(), r.clone()))
            .collect();
        let mut fonts = vec![];
        for (index, expected) in expected_fonts.iter().enumerate() {
            let bytes = if manifest.storage_version >= 2 {
                super::storage::shared_font(
                    fonts_root.ok_or("Missing shared font store")?,
                    &manifest.shared_fonts[index],
                    expected,
                )?
            } else {
                let file = assets
                    .get(&format!("assets/fonts/{index}.ttf"))
                    .ok_or("Missing edition font")?;
                read_file(root, file, expected.len() as u64)?
            };
            if bytes != *expected {
                return Err("Edition font differs from canonical profile".into());
            }
            timing.mark("generated.font_read_verify");
            fonts.push(fontdue::Font::from_bytes(
                bytes,
                fontdue::FontSettings::default(),
            )?);
            timing.mark("generated.font_parse");
        }
        let model_bytes = read_file(
            root,
            assets
                .get("publication.json")
                .ok_or("Missing publication text")?,
            64 * 1024 * 1024,
        )?;
        timing.mark("generated.publication_read");
        let model: super::model::Publication = serde_json::from_slice(&model_bytes)?;
        timing.mark("generated.publication_parse");
        let format = match manifest.format.as_str() {
            "fb2" => FB2,
            "epub" => super::epub::EPUB,
            "rtf" => super::rtf::RTF,
            "mobi" => super::mobi::MOBI,
            "md" => super::markdown::MARKDOWN,
            "pdf" => crate::reader::pdf::PDF,
            _ => return Err("Unsupported generated source identity".into()),
        };
        let (running_header, page_footers) = if let Some(record) =
            assets.get(super::typography::running_header::ASSET)
        {
            let bytes = read_file(root, record, 16 * 1024 * 1024)?;
            let header: super::typography::running_header::Header = serde_json::from_slice(&bytes)?;
            if header.items.len() > 2048
                || (!header.footers.is_empty() && header.footers.len() != manifest.page_count)
                || header.footers.iter().any(|items| items.len() > 8)
            {
                return Err("Running header exceeds budget".into());
            }
            (header.items, header.footers)
        } else {
            (vec![], vec![])
        };
        Ok(Self {
            format,
            root: root.into(),
            pages: manifest.page_files.clone(),
            assets,
            fonts,
            text: model.text,
            storage_version: manifest.storage_version,
            running_header,
            page_footers,
            editorial: manifest.publisher_version >= 26,
        })
    }
    fn render(
        &self,
        index: usize,
        request: RenderRequest,
        appearance: PageAppearance,
    ) -> Result<RenderedPage> {
        let mut rgba = vec![255; request.byte_len()?];
        let (paper, ink) = appearance.palette();
        for pixel in rgba.chunks_exact_mut(4) {
            pixel[..3].copy_from_slice(&paper);
        }
        let page: PageLayout = super::storage::read_layout(
            &self.root,
            self.pages.get(index).ok_or("Page index out of range")?,
            self.storage_version,
        )?;
        if page.width != WIDTH || page.height != HEIGHT || page.items.len() > 20_000 {
            return Err("Invalid persisted page layout".into());
        }
        let sx = request.width as f32 / WIDTH as f32;
        let sy = request.height as f32 / HEIGHT as f32;
        let mut cache = HashMap::new();
        let mut cache_bytes = 0usize;
        let mut count = 0;
        let show_header = super::typography::running_header::visible(&page, index);
        let show_footer = super::typography::running_header::footer_visible(&page);
        let note_start = self.editorial.then(|| page.items.iter().rposition(|item| matches!(item,
            Item::Rule { bounds } if bounds[0] == 72. && bounds[2] == super::typography::editorial::NOTE_RULE_WIDTH && bounds[3] == 0.5))).flatten();
        let footer = self
            .page_footers
            .get(index)
            .into_iter()
            .flatten()
            .filter(|_| show_footer)
            .cloned()
            .map(|item| (item, true, false));
        let header = self
            .running_header
            .iter()
            .filter(|_| show_header)
            .cloned()
            .map(|item| (item, true, false));
        for (item, decoration, footnote) in page
            .items
            .into_iter()
            .enumerate()
            .map(|(i, item)| (item, false, note_start.is_some_and(|start| i >= start)))
            .chain(header)
            .chain(footer)
        {
            let ink = if decoration {
                std::array::from_fn(|c| {
                    (paper[c] as f32 * 0.45 + ink[c] as f32 * 0.55).round() as u8
                })
            } else if footnote {
                std::array::from_fn(|c| (paper[c] as f32 * 0.1 + ink[c] as f32 * 0.9).round() as u8)
            } else {
                ink
            };
            let bounds = match &item {
                Item::GlyphRun { bounds, .. }
                | Item::Image { bounds, .. }
                | Item::RasterGlyph { bounds, .. }
                | Item::Rule { bounds } => bounds,
            };
            if bounds.iter().any(|v| !v.is_finite() || v.abs() > 4096.)
                || bounds[2] < 0.
                || bounds[3] < 0.
            {
                return Err("Invalid layout bounds".into());
            }
            match item {
                Item::Rule {
                    bounds: [x, y, w, h],
                } => {
                    let x0 = (x * sx).floor().max(0.) as u32;
                    let x1 = ((x + w) * sx).ceil().min(request.width as f32) as u32;
                    let y0 = (y * sy).floor().max(0.) as u32;
                    let y1 = ((y + h) * sy).ceil().min(request.height as f32) as u32;
                    for py in y0..y1 {
                        for px in x0..x1 {
                            let alpha = ((px as f32 + 1.).min((x + w) * sx)
                                - (px as f32).max(x * sx))
                            .clamp(0., 1.)
                                * ((py as f32 + 1.).min((y + h) * sy) - (py as f32).max(y * sy))
                                    .clamp(0., 1.);
                            let i = (py as usize * request.width as usize + px as usize) * 4;
                            for c in 0..3 {
                                rgba[i + c] = (ink[c] as f32 * alpha
                                    + rgba[i + c] as f32 * (1. - alpha))
                                    .round() as u8;
                            }
                        }
                    }
                }

                Item::GlyphRun {
                    font,
                    size,
                    glyphs,
                    source_start,
                    source_end,
                    ..
                } => {
                    if font >= self.fonts.len()
                        || !size.is_finite()
                        || !(1. ..=96.).contains(&size)
                        || source_start > source_end
                        || self.text.get(source_start..source_end).is_none()
                    {
                        return Err("Invalid glyph run".into());
                    }
                    count += glyphs.len();
                    if count > 20_000 {
                        return Err("Page glyph budget exceeded".into());
                    }
                    for g in glyphs {
                        if !g.1.is_finite()
                            || !g.2.is_finite()
                            || g.1.abs() > 4096.
                            || g.2.abs() > 4096.
                            || g.3 < source_start
                            || g.4 > source_end
                            || g.3 > g.4
                            || self.text.get(g.3..g.4).is_none()
                            || g.0 >= self.fonts[font].glyph_count()
                        {
                            return Err("Invalid persisted glyph".into());
                        }
                        if cache_bytes > 16 * 1024 * 1024 {
                            cache.clear();
                            cache_bytes = 0;
                        }
                        let (metrics, bitmap) = cache
                            .entry((font, g.0, (size * sy).to_bits()))
                            .or_insert_with(|| {
                                let raster =
                                    rasterize_balanced_bracket(&self.fonts[font], g.0, size * sy);
                                cache_bytes += raster.1.len();
                                raster
                            });
                        let x = (g.1 * sx + metrics.xmin as f32 * sx / sy).round() as i32;
                        let y = (g.2 * sy).round() as i32 - metrics.ymin - metrics.height as i32;
                        let width = (metrics.width as f32 * sx / sy).round() as usize;
                        for row in 0..metrics.height {
                            for col in 0..width {
                                let px = x + col as i32;
                                let py = y + row as i32;
                                if px < 0
                                    || py < 0
                                    || px >= request.width as i32
                                    || py >= request.height as i32
                                {
                                    continue;
                                }
                                let src = (col as f32 * sy / sx).floor() as usize;
                                let alpha = u32::from(
                                    bitmap[row * metrics.width
                                        + src.min(metrics.width.saturating_sub(1))],
                                );
                                let offset =
                                    (py as usize * request.width as usize + px as usize) * 4;
                                for c in 0..3 {
                                    rgba[offset + c] = ((u32::from(ink[c]) * alpha
                                        + u32::from(rgba[offset + c]) * (255 - alpha)
                                        + 127)
                                        / 255)
                                        as u8;
                                }
                            }
                        }
                    }
                }
                Item::RasterGlyph {
                    asset,
                    baseline,
                    advance,
                    source_start,
                    source_end,
                    bounds: [x, y, w, h],
                } => {
                    count += 1;
                    if count > 20_000
                        || baseline.iter().any(|n| !n.is_finite() || n.abs() > 4096.)
                        || !advance.is_finite()
                        || !(0. ..=4096.).contains(&advance)
                        || source_start > source_end
                        || self.text.get(source_start..source_end).is_none()
                        || !asset.starts_with("fallback/")
                    {
                        return Err("Invalid raster glyph metadata".into());
                    }
                    let bytes = read_file(
                        &self.root,
                        self.assets
                            .get(&asset)
                            .ok_or("Missing raster glyph asset")?,
                        1024 * 1024,
                    )?;
                    let (mw, mh) = super::images::dimensions(&bytes)?;
                    if mw > 512 || mh > 512 {
                        return Err("Raster glyph dimensions exceed budget".into());
                    }
                    let image =
                        image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)?;
                    if image.width() > 512 || image.height() > 512 {
                        return Err("Raster glyph dimensions exceed budget".into());
                    }
                    let width = (w * sx).round().max(1.) as u32;
                    let height = (h * sy).round().max(1.) as u32;
                    RenderRequest { width, height }.byte_len()?;
                    let color = image.color().has_alpha();
                    let pixels = if decoration && color {
                        let alpha = image.to_rgba8();
                        image::RgbaImage::from_fn(image.width(), image.height(), |x, y| {
                            image::Rgba([ink[0], ink[1], ink[2], alpha.get_pixel(x, y)[3]])
                        })
                    } else if color {
                        image.to_rgba8()
                    } else {
                        let alpha = image.to_luma8();
                        image::RgbaImage::from_fn(image.width(), image.height(), |x, y| {
                            image::Rgba([ink[0], ink[1], ink[2], alpha.get_pixel(x, y)[0]])
                        })
                    };
                    let mask = image::imageops::resize(
                        &pixels,
                        width,
                        height,
                        image::imageops::FilterType::Lanczos3,
                    );
                    for (ix, iy, pixel) in mask.enumerate_pixels() {
                        let px = (x * sx).round() as i32 + ix as i32;
                        let py = (y * sy).round() as i32 + iy as i32;
                        if px < 0
                            || py < 0
                            || px >= request.width as i32
                            || py >= request.height as i32
                        {
                            continue;
                        }
                        let offset = (py as usize * request.width as usize + px as usize) * 4;
                        let alpha = u32::from(pixel[3]);
                        for c in 0..3 {
                            rgba[offset + c] = ((u32::from(pixel[c]) * alpha
                                + u32::from(rgba[offset + c]) * (255 - alpha)
                                + 127)
                                / 255) as u8;
                        }
                    }
                }
                Item::Image {
                    asset,
                    bounds: [x, y, w, h],
                } => {
                    let image = super::images::decode(&read_file(
                        &self.root,
                        self.assets.get(&asset).ok_or("Missing page image")?,
                        super::images::MAX_IMAGE_BYTES,
                    )?)?;
                    let w = (w * sx).round().max(1.) as u32;
                    let h = (h * sy).round().max(1.) as u32;
                    RenderRequest {
                        width: w,
                        height: h,
                    }
                    .byte_len()?;
                    let image = image::imageops::resize(
                        &image,
                        w,
                        h,
                        image::imageops::FilterType::Lanczos3,
                    );
                    for (ix, iy, pixel) in image.enumerate_pixels() {
                        let px = (x * sx).round() as i32 + ix as i32;
                        let py = (y * sy).round() as i32 + iy as i32;
                        if px < 0
                            || py < 0
                            || px >= request.width as i32
                            || py >= request.height as i32
                        {
                            continue;
                        }
                        let offset = (py as usize * request.width as usize + px as usize) * 4;
                        let alpha = u32::from(pixel[3]);
                        for c in 0..3 {
                            rgba[offset + c] = ((u32::from(pixel[c]) * alpha
                                + u32::from(rgba[offset + c]) * (255 - alpha)
                                + 127)
                                / 255) as u8;
                        }
                    }
                }
            }
        }
        Ok(RenderedPage {
            width: request.width,
            height: request.height,
            rgba,
        })
    }
}
impl Document for GeneratedDocument {
    fn supports_page_appearance(&self) -> bool {
        true
    }
    fn render_with_appearance(
        &self,
        index: usize,
        request: RenderRequest,
        appearance: PageAppearance,
    ) -> crate::reader::document::Result<RenderedPage> {
        self.render(index, request, appearance)
            .map_err(|e| e.to_string())
    }
    fn format_id(&self) -> FormatId {
        self.format
    }
    fn page_count(&self) -> usize {
        self.pages.len()
    }
    fn page_info(&self, index: usize) -> crate::reader::document::Result<PageInfo> {
        if index >= self.pages.len() {
            return Err("Page index out of range".into());
        }
        Ok(PageInfo {
            width: WIDTH,
            height: HEIGHT,
            dpi: None,
        })
    }
    fn render_page(
        &self,
        index: usize,
        request: RenderRequest,
    ) -> crate::reader::document::Result<RenderedPage> {
        self.render(index, request, PageAppearance::Original)
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod appearance_tests {
    use super::*;
    #[test]
    fn brackets_have_identical_mirrored_coverage_at_reader_scales() {
        let font = fontdue::Font::from_bytes(
            super::super::typography::CURRENT_FONTS[0],
            fontdue::FontSettings::default(),
        )
        .unwrap();
        for size in [9.975, 13.3, 15.96, 19.95, 26.6, 39.9] {
            let (lm, left) = rasterize_balanced_bracket(&font, font.lookup_glyph_index('['), size);
            let (rm, right) = rasterize_balanced_bracket(&font, font.lookup_glyph_index(']'), size);
            assert_eq!(
                (lm.width, lm.height, lm.ymin),
                (rm.width, rm.height, rm.ymin)
            );
            assert!(left.iter().any(|&a| a > 0));
            for y in 0..lm.height {
                for x in 0..lm.width {
                    assert_eq!(
                        left[y * lm.width + x],
                        right[y * lm.width + lm.width - 1 - x]
                    );
                }
            }
            let digit = font.lookup_glyph_index('4');
            assert_eq!(
                rasterize_balanced_bracket(&font, digit, size).1,
                font.rasterize_indexed(digit, size).1
            );
        }
    }
    #[test]
    fn appearance_preserves_layout_original_pixels_and_color_images() {
        let dir = tempfile::tempdir().unwrap();
        let font = fontdue::Font::from_bytes(
            super::super::typography::CURRENT_FONTS[0],
            fontdue::FontSettings::default(),
        )
        .unwrap();
        let glyph = font.lookup_glyph_index('A');
        let image = image::RgbaImage::from_pixel(8, 8, image::Rgba([180, 40, 90, 255]));
        let mask = image::GrayImage::from_pixel(8, 8, image::Luma([255]));
        let mut assets = HashMap::new();
        for (name, data) in [
            ("images/color.png", image::DynamicImage::ImageRgba8(image)),
            ("fallback/mask.png", image::DynamicImage::ImageLuma8(mask)),
        ] {
            let mut bytes = std::io::Cursor::new(Vec::new());
            data.write_to(&mut bytes, image::ImageFormat::Png).unwrap();
            assets.insert(
                name.to_owned(),
                super::super::write_file(dir.path(), name, &bytes.into_inner()).unwrap(),
            );
        }
        let page = PageLayout {
            width: WIDTH,
            height: HEIGHT,
            items: vec![
                Item::GlyphRun {
                    font: 0,
                    size: 32.,
                    glyphs: vec![super::super::typography::Glyph(glyph, 72., 100., 0, 1)],
                    source_start: 0,
                    source_end: 1,
                    bounds: [72., 60., 40., 40.],
                },
                Item::Image {
                    asset: "images/color.png".into(),
                    bounds: [100., 150., 8., 8.],
                },
                Item::RasterGlyph {
                    asset: "fallback/mask.png".into(),
                    baseline: [100., 208.],
                    advance: 8.,
                    source_start: 0,
                    source_end: 1,
                    bounds: [100., 200., 8., 8.],
                },
            ],
        };
        let bytes = serde_json::to_vec(&page).unwrap();
        let file = super::super::write_file(dir.path(), "pages/1.json", &bytes).unwrap();
        let doc = GeneratedDocument {
            running_header: vec![],
            page_footers: vec![],
            editorial: false,
            format: FB2,
            root: dir.path().into(),
            pages: vec![file],
            assets,
            fonts: vec![font],
            text: "A".into(),
            storage_version: 1,
        };
        let request = RenderRequest {
            width: WIDTH,
            height: HEIGHT,
        };
        let original = doc.render_page(0, request).unwrap().rgba;
        assert!(doc.supports_page_appearance());
        for appearance in [
            PageAppearance::Original,
            PageAppearance::Sepia,
            PageAppearance::Night,
            PageAppearance::Custom([203, 219, 195]),
            PageAppearance::Custom([24, 32, 56]),
        ] {
            let rgba = doc
                .render_with_appearance(0, request, appearance)
                .unwrap()
                .rgba;
            let (paper, ink) = appearance.palette();
            assert_eq!(&rgba[..3], &paper);
            let pixel = |x: usize, y: usize| {
                &rgba[(y * WIDTH as usize + x) * 4..(y * WIDTH as usize + x) * 4 + 3]
            };
            assert_eq!(pixel(103, 153), [180, 40, 90]);
            assert_eq!(pixel(103, 203), ink);
            assert_eq!(doc.page_count(), 1);
            assert_eq!(doc.page_info(0).unwrap().height, HEIGHT);
            for (a, b) in original
                .chunks_exact(4)
                .zip(rgba.chunks_exact(4))
                .take(140 * WIDTH as usize)
            {
                assert_eq!(
                    a[..3] != [255, 255, 255],
                    b[..3] != paper,
                    "glyph coverage changed"
                );
            }
            if appearance == PageAppearance::Original {
                assert_eq!(rgba, original);
            }
        }
        assert_eq!(doc.render_page(0, request).unwrap().rgba, original);
        assert_eq!(
            std::fs::read(dir.path().join("pages/1.json")).unwrap(),
            bytes
        );
    }
}
