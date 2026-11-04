use super::document::{Document, PageAppearance, PageInfo, RenderRequest, RenderedPage, Result};
use super::format::{DocumentFormatHandler, FormatId, ProbeResult};
use djvu_rs::djvu_render::{RenderOptions, Resampling};
use std::sync::Arc;
use std::{io::Read, path::Path};

pub const DJVU: FormatId = FormatId("djvu");
pub struct DjvuFormatHandler;

impl DocumentFormatHandler for DjvuFormatHandler {
    fn format_id(&self) -> FormatId {
        DJVU
    }
    fn filter_name(&self) -> &'static str {
        "DjVu books"
    }
    fn supported_extensions(&self) -> &'static [&'static str] {
        &["djvu", "djv"]
    }
    fn probe(&self, header: &[u8]) -> ProbeResult {
        if !header.starts_with(b"AT&T") {
            return if !header.is_empty() && b"AT&T".starts_with(header) {
                ProbeResult::Malformed("truncated DjVu signature")
            } else {
                ProbeResult::NotMine
            };
        }
        if header.len() < 16 {
            return ProbeResult::Malformed("truncated DjVu FORM header");
        }
        if &header[4..8] != b"FORM" {
            return ProbeResult::Malformed("missing FORM container");
        }
        if !matches!(&header[12..16], b"DJVU" | b"DJVM") {
            return ProbeResult::Malformed("expected DJVU or DJVM document container");
        }
        let size = u32::from_be_bytes(header[8..12].try_into().expect("four bounded header bytes"));
        if size < 4 {
            return ProbeResult::Malformed("FORM length smaller than its type");
        }
        ProbeResult::Supported
    }
    fn open(&self, path: &Path) -> Result<Arc<dyn Document>> {
        Ok(Arc::new(DjvuDocument::open(path)?))
    }
}

pub struct DjvuDocument(djvu_rs::Document);

impl DjvuDocument {
    pub fn open(path: &Path) -> Result<Self> {
        const MAX_FILE_BYTES: u64 = 512 * 1024 * 1024;
        let file = std::fs::File::open(path)
            .map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
        let mut bytes = Vec::new();
        file.take(MAX_FILE_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_FILE_BYTES {
            return Err("Book exceeds 512 MiB file limit".into());
        }
        let options = djvu_rs::ParseOptions {
            limits: Some(djvu_rs::ResourceLimits {
                max_file_bytes: Some(MAX_FILE_BYTES),
                max_pages: Some(20_000),
                max_components: Some(40_000),
                // High-DPI covers can exceed 64 MP; the packed JB2 canvas is
                // bounded to 12 MiB at 96 MP. Output/decoded-byte caps stay separate.
                max_page_pixels: Some(96 * 1024 * 1024),
                max_decoded_bytes: Some(512 * 1024 * 1024),
                max_render_pixels: Some(super::document::MAX_PIXELS),
                ..Default::default()
            }),
        };
        let doc = djvu_rs::Document::from_bytes_with_options(bytes, &options)
            .map_err(|e| format!("Invalid DjVu: {e}"))?;
        if doc.page_count() == 0 {
            return Err("Document has no pages".into());
        }
        Ok(Self(doc))
    }
}

impl Document for DjvuDocument {
    fn format_id(&self) -> FormatId {
        DJVU
    }
    fn page_count(&self) -> usize {
        self.0.page_count()
    }

    fn page_info(&self, index: usize) -> Result<PageInfo> {
        let page = self.0.page(index).map_err(|e| e.to_string())?;
        Ok(PageInfo {
            width: page.display_width(),
            height: page.display_height(),
            dpi: Some(page.dpi()),
        })
    }

    fn supports_page_appearance(&self) -> bool {
        true
    }

    fn render_with_appearance(
        &self,
        index: usize,
        request: RenderRequest,
        appearance: PageAppearance,
    ) -> Result<RenderedPage> {
        let mut page = self.render_page(index, request)?;
        if appearance != PageAppearance::Original {
            let source = self.0.page(index).map_err(|e| e.to_string())?;
            if !clean_text_paper(&source, &mut page, appearance) {
                recolor_paper(&mut page.rgba, appearance);
            }
        }
        Ok(page)
    }

    fn render_page(&self, index: usize, request: RenderRequest) -> Result<RenderedPage> {
        let expected = request.byte_len()?;
        let page = self.0.page(index).map_err(|e| e.to_string())?;
        let options = reading_render_options(page.display_width(), page.display_height(), request);
        let raster = page
            .render_with(&options)
            .map_err(|e| format!("Page {}: {e}", index + 1))?;
        if raster.width != request.width
            || raster.height != request.height
            || raster.data.len() != expected
        {
            return Err("Decoder returned unexpected raster dimensions/length".into());
        }
        Ok(RenderedPage {
            width: raster.width,
            height: raster.height,
            rgba: raster.data,
        })
    }
}

fn paper_tone(rgba: &[u8]) -> [u32; 3] {
    let mut bins = vec![0u32; 32768];
    let stride = (rgba.len() / 4 / 100_000).max(1);
    for pixel in rgba.chunks_exact(4).step_by(stride) {
        let low = pixel[0].min(pixel[1]).min(pixel[2]);
        let high = pixel[0].max(pixel[1]).max(pixel[2]);
        if high >= 128 && low >= 64 && high - low <= 128 {
            let bin = (usize::from(pixel[0] >> 3) << 10)
                | (usize::from(pixel[1] >> 3) << 5)
                | usize::from(pixel[2] >> 3);
            bins[bin] += 1;
        }
    }
    let dominant = bins
        .iter()
        .enumerate()
        .max_by_key(|(_, count)| *count)
        .filter(|(_, count)| **count > 0);
    let base = dominant.map_or([255u32; 3], |(bin, _)| {
        [
            ((bin >> 10) as u32 * 8 + 4).min(255),
            (((bin >> 5) & 31) as u32 * 8 + 4).min(255),
            ((bin & 31) as u32 * 8 + 4).min(255),
        ]
    });
    if base.iter().all(|v| *v >= 248) {
        [255; 3]
    } else {
        base
    }
}

/// Flatten a plain paper background using the actual JB2/G4 mask. If unmasked
/// detail suggests an illustration, keep the composited scan instead of deleting it.
fn clean_text_paper(
    source: &djvu_rs::Page<'_>,
    page: &mut RenderedPage,
    appearance: PageAppearance,
) -> bool {
    let limit = super::document::MAX_PIXELS;
    if u64::from(source.width()) * u64::from(source.height()) > limit
        || u64::from(page.width) * u64::from(source.width().max(source.height())) > limit
    {
        return false;
    }
    let Ok(Some(mask)) = source.decode_mask() else {
        return false;
    };
    if mask.width != source.width() || mask.height != source.height() {
        return false;
    }
    let mask_image = image::GrayImage::from_fn(mask.width, mask.height, |x, y| {
        image::Luma([if mask.get(x, y) { 255 } else { 0 }])
    });
    use djvu_rs::Rotation;
    let oriented = match source.rotation() {
        Rotation::None => mask_image,
        Rotation::Ccw90 => image::imageops::rotate270(&mask_image),
        Rotation::Cw90 => image::imageops::rotate90(&mask_image),
        Rotation::Rot180 => image::imageops::rotate180(&mask_image),
    };
    let coverage = image::imageops::resize(
        &oriented,
        page.width,
        page.height,
        image::imageops::FilterType::Lanczos3,
    );
    let base = paper_tone(&page.rgba);
    let mut background = 0usize;
    let mut detail = 0usize;
    for (pixel, mask) in page.rgba.chunks_exact(4).zip(coverage.as_raw()) {
        if *mask < 8 {
            background += 1;
            if (0..3).any(|c| (i32::from(pixel[c]) - base[c] as i32).abs() > 48) {
                detail += 1;
            }
        }
    }
    if background < page.rgba.len() / 4 / 5 || detail * 100 > background {
        return false;
    }
    let (paper, ink) = appearance.palette();
    for (pixel, mask) in page.rgba.chunks_exact_mut(4).zip(coverage.as_raw()) {
        for c in 0..3 {
            pixel[c] = ((u32::from(paper[c]) * (255 - u32::from(*mask))
                + u32::from(ink[c]) * u32::from(*mask)
                + 127)
                / 255) as u8;
        }
    }
    true
}

/// Estimate the dominant light paper tone, then normalize it before tinting.
/// This is a reading presentation, not a faithful scan restoration.
fn recolor_paper(rgba: &mut [u8], appearance: PageAppearance) {
    if appearance == PageAppearance::Original {
        return;
    }
    let base = paper_tone(rgba);
    let (paper, ink) = appearance.palette();
    let mut palette = [[0u8; 3]; 256];
    for (value, rgb) in palette.iter_mut().enumerate() {
        for c in 0..3 {
            // Keep grayscale coverage exact on already-white pages. On aged paper,
            // stretch contrast gently without a hard black/white threshold.
            let normalized = if base == [255; 3] {
                value as u32
            } else {
                let relative = (value as u32 * 255 / base[c]).min(255);
                (relative.saturating_sub(32) * 255 / 223).min(255)
            };
            rgb[c] =
                ((u32::from(ink[c]) * (255 - normalized) + u32::from(paper[c]) * normalized + 127)
                    / 255) as u8;
        }
    }
    for pixel in rgba.chunks_exact_mut(4) {
        for c in 0..3 {
            pixel[c] = palette[pixel[c] as usize][c];
        }
    }
}

fn reading_render_options(width: u32, height: u32, request: RenderRequest) -> RenderOptions {
    // The decoder's fast downscale can use a max-pooled 1-bit JB2 mask, making
    // small text jagged and artificially bold. Lanczos composites at native
    // resolution first, retaining glyph coverage before reducing the page.
    // Use the same native-page resampling when magnifying: the decoder's fast
    // scaled compositor can crop the page content at non-native resolutions.
    // Bound both the native and separable intermediate RGBA buffers to 64 MiB.
    let native_fits = u64::from(width) * u64::from(height) <= super::document::MAX_PIXELS;
    // Account for either orientation of the native pre-pass as well.
    let intermediate_fits =
        u64::from(request.width) * u64::from(width.max(height)) <= super::document::MAX_PIXELS;
    let scaling = request.width != width || request.height != height;
    RenderOptions {
        width: request.width,
        height: request.height,
        resampling: if native_fits && intermediate_fits && scaling {
            Resampling::Lanczos3
        } else {
            Resampling::Bilinear
        },
        mask_aa: true,
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paper_palette_preserves_antialiasing_alpha_and_original() {
        let original: Vec<u8> = (0..=255u8).flat_map(|v| [v, v, v, 255]).collect();
        let mut pixels = original.clone();
        recolor_paper(&mut pixels, PageAppearance::Original);
        assert_eq!(pixels, original);
        for appearance in [
            PageAppearance::Sepia,
            PageAppearance::Night,
            PageAppearance::Custom([203, 219, 195]),
        ] {
            let mut pixels = original.clone();
            recolor_paper(&mut pixels, appearance);
            let (paper, ink) = appearance.palette();
            assert_eq!(&pixels[..3], &ink);
            assert_eq!(&pixels[1020..1023], &paper);
            assert!(pixels.chunks_exact(4).all(|p| p[3] == 255));
            for pair in pixels.chunks_exact(4).collect::<Vec<_>>().windows(2) {
                for (a, b) in pair[0][..3].iter().zip(&pair[1][..3]) {
                    assert!((i16::from(*a) - i16::from(*b)).abs() <= 1);
                }
            }
        }
        let mut paper = [[188, 180, 124, 255].repeat(100), vec![32, 30, 20, 255]].concat();
        recolor_paper(&mut paper, PageAppearance::Custom([255, 255, 255]));
        assert_eq!(&paper[..3], &[255, 255, 255]);
        assert!(paper[400..403].iter().all(|v| *v < 40));
    }

    #[test]
    #[ignore = "external corpus: set GJOA_TEST_CORPUS_DIR and run explicitly with --ignored"]
    fn london_page_five_keeps_all_content_when_enlarged() {
        let path = crate::test_corpus::directory().join("ЛОНДОН Джек – Смок Белью, 1945 год.djvu");
        let doc = DjvuDocument::open(&path).unwrap();
        let info = doc.page_info(4).unwrap();
        let native = doc
            .render_page(
                4,
                RenderRequest {
                    width: info.width,
                    height: info.height,
                },
            )
            .unwrap();
        let source = image::RgbaImage::from_raw(info.width, info.height, native.rgba).unwrap();
        // Compare the whole page at a common resolution, including its right edge.
        // Merely checking the returned buffer size misses an internally cropped scan.
        let reference =
            image::imageops::resize(&source, 155, 240, image::imageops::FilterType::Triangle);
        for (width, height) in [(696, 1078), (1277, 1978), (1621, 2510)] {
            let raster = doc.render_page(4, RenderRequest { width, height }).unwrap();
            let image = image::RgbaImage::from_raw(width, height, raster.rgba).unwrap();
            let reduced =
                image::imageops::resize(&image, 155, 240, image::imageops::FilterType::Triangle);
            let error: f64 = reference
                .as_raw()
                .iter()
                .zip(reduced.as_raw())
                .map(|(a, b)| f64::from(a.abs_diff(*b)))
                .sum::<f64>()
                / reference.as_raw().len() as f64;
            assert!(
                error < 2.0,
                "Page content moved at {width}x{height}: mean error {error}"
            );
        }
    }

    #[test]
    fn quality_resampling_keeps_intermediate_rasters_bounded() {
        let target = RenderRequest {
            width: 1000,
            height: 1600,
        };
        assert_eq!(
            reading_render_options(2868, 4856, target).resampling,
            Resampling::Lanczos3
        );
        assert_eq!(
            reading_render_options(500, 800, target).resampling,
            Resampling::Lanczos3
        );
        // Oversized native pages and an extreme aspect-ratio request
        // must not allocate a large native/intermediate Lanczos raster.
        for (w, h) in [(8000, 8000), (100, 60000)] {
            let options = reading_render_options(w, h, target);
            assert_eq!(options.resampling, Resampling::Bilinear);
            assert!(options.mask_aa);
            assert!(!options.aa); // aa halves output dimensions; it is not a quality toggle.
        }
        assert_eq!(
            reading_render_options(
                60000,
                100,
                RenderRequest {
                    width: 1000,
                    height: 50
                }
            )
            .resampling,
            Resampling::Bilinear
        );
    }
}
