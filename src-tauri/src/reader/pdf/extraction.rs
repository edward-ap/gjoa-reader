//! Owned text/image evidence. Called exclusively on the existing PDFium worker.
use crate::publication::Metadata;
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use std::path::Path;
pub const MAX_PAGES: usize = 3000;
pub const MAX_CHARS_PAGE: usize = 30_000;
pub const MAX_CHARS: usize = 6_000_000;
pub const MAX_OBJECTS: usize = 20_000;
pub const MAX_IMAGES_PAGE: usize = 128;
pub const MAX_IMAGE_BYTES: usize = 128 * 1024 * 1024;
static EXTRACTIONS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
/// Diagnostic counter: persisted Reader opens must leave it unchanged.
pub fn extraction_count() -> usize {
    EXTRACTIONS.load(std::sync::atomic::Ordering::Relaxed)
}
// Parallel Rust tests share the PDFium worker and the process diagnostic above.
// Correlate the no-extraction acceptance test with source bytes, including staged
// copies, so another test's extraction cannot look like forbidden publication.
#[cfg(test)]
static TEST_SOURCE_EXTRACTIONS: std::sync::Mutex<std::collections::BTreeMap<String, usize>> =
    std::sync::Mutex::new(std::collections::BTreeMap::new());

#[cfg(test)]
fn test_source_fingerprint(path: &Path) -> Option<String> {
    crate::library::store::hash_reader(std::fs::File::open(path).ok()?).ok()
}

#[cfg(test)]
pub(crate) fn extraction_count_for_source(path: &Path) -> usize {
    let key = test_source_fingerprint(path).expect("test PDF source must be readable");
    *TEST_SOURCE_EXTRACTIONS
        .lock()
        .unwrap()
        .get(&key)
        .unwrap_or(&0)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PdfChar {
    pub index: usize,
    pub text: String,
    /// Left, top, right, bottom, in unrotated PDF points, Y down.
    pub bounds: [f32; 4],
    pub baseline: f32,
    pub size: f32,
    pub font: String,
    pub bold: bool,
    pub italic: bool,
    pub angle: f32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PdfImage {
    pub object: usize,
    pub bounds: [f32; 4],
    pub background: bool,
    pub asset: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PdfPageEvidence {
    pub index: usize,
    pub width: f32,
    pub height: f32,
    pub rotated: bool,
    pub chars: Vec<PdfChar>,
    pub images: Vec<PdfImage>,
    pub rules: Vec<[f32; 4]>,
    pub complex_objects: usize,
    pub text_objects: usize,
    pub bookmarks: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PdfEvidence {
    pub metadata: Metadata,
    pub pages: Vec<PdfPageEvidence>,
    pub extraction_ms: f64,
    pub image_ms: f64,
}
pub fn extract(pdfium: &Pdfium, path: &Path, assets: Option<&Path>) -> Result<PdfEvidence, String> {
    extract_inner(pdfium, path, assets, None, false)
}
pub fn sample(pdfium: &Pdfium, path: &Path) -> Result<PdfEvidence, String> {
    extract_inner(pdfium, path, None, None, true)
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PdfFastBlock {
    pub text: String,
    pub bounds: [f32; 4],
    pub size: f32,
    pub bold: bool,
    pub italic: bool,
}
#[derive(Serialize, Deserialize)]
pub struct PdfFastEvidence {
    pub pages: PdfEvidence,
    pub blocks: Vec<Vec<PdfFastBlock>>,
    pub native_text: Vec<String>,
}
pub fn extract_fast(
    pdfium: &Pdfium,
    path: &Path,
    assets: Option<&Path>,
) -> Result<PdfFastEvidence, String> {
    let mut fast = PdfFastEvidence {
        pages: PdfEvidence {
            metadata: Metadata::default(),
            pages: vec![],
            extraction_ms: 0.,
            image_ms: 0.,
        },
        blocks: vec![],
        native_text: vec![],
    };
    fast.pages = extract_inner(pdfium, path, assets, Some(&mut fast), false)?;
    Ok(fast)
}
fn extract_inner(
    pdfium: &Pdfium,
    path: &Path,
    assets: Option<&Path>,
    mut fast: Option<&mut PdfFastEvidence>,
    sample: bool,
) -> Result<PdfEvidence, String> {
    EXTRACTIONS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    #[cfg(test)]
    if let Some(key) = test_source_fingerprint(path) {
        *TEST_SOURCE_EXTRACTIONS
            .lock()
            .unwrap()
            .entry(key)
            .or_default() += 1;
    }
    crate::pipeline_metrics::count("count.extraction_passes", 1);
    let started = std::time::Instant::now();
    if std::fs::metadata(path).map_err(|e| e.to_string())?.len()
        > crate::library::store::MAX_SOURCE_BYTES
    {
        return Err("PDF source limit exceeded".into());
    }
    let open_timer = crate::pipeline_metrics::stage("pdf_open");
    let document = pdfium
        .load_pdf_from_file(path, None)
        .map_err(|e| e.to_string())?;
    drop(open_timer);
    if document.pages().len() as usize > MAX_PAGES {
        return Err("PDF reconstruction page limit exceeded".into());
    }
    let metadata = document.metadata();
    let mut result = PdfEvidence {
        metadata: Metadata {
            title: metadata
                .get(PdfDocumentMetadataTagType::Title)
                .map(|t| t.value().to_owned()),
            author: metadata
                .get(PdfDocumentMetadataTagType::Author)
                .map(|t| t.value().to_owned()),
        },
        pages: vec![],
        extraction_ms: 0.,
        image_ms: 0.,
    };
    let mut bookmarks = std::collections::BTreeMap::<usize, Vec<String>>::new();
    for bookmark in document.bookmarks().iter().take(10_000) {
        if let (Some(title), Some(destination)) = (bookmark.title(), bookmark.destination())
            && let Ok(index) = destination.page_index()
        {
            bookmarks.entry(index as usize).or_default().push(title);
        }
    }
    let mut total = 0;
    let mut image_bytes = 0;
    if let Some(assets) = assets {
        std::fs::create_dir_all(assets).map_err(|e| e.to_string())?;
    }
    let count = document.pages().len() as usize;
    let selected: std::collections::BTreeSet<usize> = (0..4.min(count))
        .chain((0..12).map(|i| i * count.saturating_sub(1) / 11))
        .collect();
    for index in document.pages().as_range() {
        if sample && !selected.contains(&(index as usize)) {
            continue;
        }
        if sample && started.elapsed().as_secs() > 20 {
            return Err("PDF assessment time budget exceeded; use Original".into());
        }
        let page = document.pages().get(index).map_err(|e| e.to_string())?;
        let h = page.height().value;
        let w = page.width().value;
        let rect = |r: PdfRect| {
            [
                r.left().value,
                h - r.top().value,
                r.right().value,
                h - r.bottom().value,
            ]
        };
        let text_timer = crate::pipeline_metrics::stage("text_extraction");
        let text = page.text().map_err(|e| e.to_string())?;
        if text.chars().len() > MAX_CHARS_PAGE {
            return Err("PDF character/page limit exceeded".into());
        }
        total += text.chars().len();
        if total > MAX_CHARS {
            return Err("PDF character limit exceeded".into());
        }
        let mut evidence = PdfPageEvidence {
            index: index as usize,
            width: w,
            height: h,
            rotated: page
                .rotation()
                .is_ok_and(|r| r != PdfPageRenderRotation::None),
            chars: vec![],
            images: vec![],
            rules: vec![],
            complex_objects: 0,
            text_objects: 0,
            bookmarks: bookmarks.remove(&(index as usize)).unwrap_or_default(),
        };
        let has_text;
        if let Some(fast) = fast.as_deref_mut() {
            let native = text.all();
            has_text = native.chars().any(|c| !c.is_whitespace());
            fast.native_text.push(native);
            let mut blocks = vec![];
            for object in page.objects().iter() {
                if let Some(run) = object.as_text_object() {
                    let content = text.for_object(run);
                    if content.trim().is_empty() {
                        continue;
                    }
                    let font = run.font();
                    blocks.push(PdfFastBlock {
                        text: content,
                        bounds: object
                            .bounds()
                            .map(|b| rect(b.to_rect()))
                            .unwrap_or([0.; 4]),
                        size: run.scaled_font_size().value,
                        bold: font.name().to_lowercase().contains("bold")
                            || matches!(
                                font.weight(),
                                Ok(PdfFontWeight::Weight600
                                    | PdfFontWeight::Weight700Bold
                                    | PdfFontWeight::Weight800
                                    | PdfFontWeight::Weight900)
                            ),
                        italic: font.is_italic(),
                    });
                }
            }
            // Forms can expose native text without top-level text objects. Preserve
            // that text as one coarse page container; do not descend to glyphs.
            if blocks.is_empty() && has_text {
                blocks.push(PdfFastBlock {
                    text: fast.native_text.last().unwrap().clone(),
                    bounds: [0., 0., w, h],
                    size: 12.,
                    bold: false,
                    italic: false,
                });
            }
            fast.blocks.push(blocks);
        } else {
            for (i, c) in text.chars().iter().enumerate() {
                let bounds = c.tight_bounds().map(&rect).unwrap_or([0.; 4]);
                let font = c.font_name();
                let bold = matches!(
                    c.font_weight(),
                    Some(
                        PdfFontWeight::Weight600
                            | PdfFontWeight::Weight700Bold
                            | PdfFontWeight::Weight800
                            | PdfFontWeight::Weight900
                    )
                ) || font.to_lowercase().contains("bold");
                evidence.chars.push(PdfChar {
                    index: i,
                    text: c.unicode_char().unwrap_or('\u{fffd}').to_string(),
                    bounds,
                    baseline: c.origin_y().map(|p| h - p.value).unwrap_or(bounds[3]),
                    size: c.scaled_font_size().value,
                    font,
                    bold,
                    italic: c.font_is_italic(),
                    angle: c.angle_degrees().unwrap_or(0.),
                });
            }
            has_text = evidence
                .chars
                .iter()
                .any(|c| c.text.chars().any(|c| !c.is_whitespace()));
        }
        drop(text_timer);
        let _image_timer = crate::pipeline_metrics::stage("image_extraction_and_objects");
        if page.objects().len() > MAX_OBJECTS {
            return Err("PDF object/page limit exceeded".into());
        }
        // A text-free illustration page can be a stack of paper, masks and ink.
        // Its objects are not independent illustrations: preserve the composite.
        if !has_text && !page.objects().is_empty() {
            crate::pipeline_metrics::count(
                "count.image_objects",
                page.objects()
                    .iter()
                    .filter(|o| o.as_image_object().is_some())
                    .count(),
            );
            let name = format!("pdf-page-{index}.png");
            let start = std::time::Instant::now();
            if let Some(assets) = assets {
                let scale = (1800. / w.max(h)).min(2.);
                let bitmap = page
                    .render_with_config(&PdfRenderConfig::new().set_target_size(
                        (w * scale).round().max(1.) as i32,
                        (h * scale).round().max(1.) as i32,
                    ))
                    .map_err(|e| e.to_string())?;
                let rgba = bitmap.as_rgba_bytes();
                // Empty scanned leaves are not standalone Reader illustrations.
                if rgba
                    .chunks_exact(4)
                    .all(|p| p[0] >= 250 && p[1] >= 250 && p[2] >= 250)
                {
                    result.image_ms += start.elapsed().as_secs_f64() * 1000.;
                    result.pages.push(evidence);
                    continue;
                }
                image::save_buffer(
                    assets.join(&name),
                    &rgba,
                    bitmap.width() as u32,
                    bitmap.height() as u32,
                    image::ColorType::Rgba8,
                )
                .map_err(|e| e.to_string())?;
                image_bytes += std::fs::metadata(assets.join(&name))
                    .map_err(|e| e.to_string())?
                    .len() as usize;
                if image_bytes > MAX_IMAGE_BYTES {
                    return Err("PDF extracted image byte limit exceeded".into());
                }
            }
            result.image_ms += start.elapsed().as_secs_f64() * 1000.;
            evidence.images.push(PdfImage {
                object: 0,
                bounds: [0., 0., w, h],
                background: false,
                asset: Some(name),
            });
            result.pages.push(evidence);
            continue;
        }
        for (i, object) in page.objects().iter().enumerate() {
            let bounds = object
                .bounds()
                .map(|b| rect(b.to_rect()))
                .unwrap_or([0.; 4]);
            let bw = (bounds[2] - bounds[0]).abs();
            let bh = (bounds[3] - bounds[1]).abs();
            if let Some(image) = object.as_image_object() {
                crate::pipeline_metrics::count("count.image_objects", 1);
                if evidence.images.len() >= MAX_IMAGES_PAGE {
                    return Err("PDF image/page limit exceeded".into());
                }
                let background = bw * bh / (w * h) > 0.75
                    && if fast.is_some() {
                        has_text
                    } else {
                        !evidence.chars.is_empty()
                    };
                if background {
                    crate::pipeline_metrics::count("count.scans_ignored", 1);
                }
                let start = std::time::Instant::now();
                let asset = if !background && bw > 2. && bh > 2. {
                    let name = format!("pdf-{index}-{i}.png");
                    if let Some(assets) = assets {
                        let native_width = image.width().map_err(|e| e.to_string())? as u64;
                        let native_height = image.height().map_err(|e| e.to_string())? as u64;
                        if native_width.saturating_mul(native_height) > 32_000_000
                            || bw * bh > 32_000_000.
                        {
                            return Err("PDF image working-memory limit exceeded".into());
                        }
                        let scale = (1800. / bw.max(bh)).min(2.);
                        let iw = (bw * scale).round().max(1.) as i32;
                        let ih = (bh * scale).round().max(1.) as i32;
                        let pixels = image
                            .get_processed_bitmap_with_size(&document, iw, ih)
                            .map_err(|e| e.to_string())?;
                        image::save_buffer(
                            assets.join(&name),
                            &pixels.as_rgba_bytes(),
                            pixels.width() as u32,
                            pixels.height() as u32,
                            image::ColorType::Rgba8,
                        )
                        .map_err(|e| e.to_string())?;
                        image_bytes += std::fs::metadata(assets.join(&name))
                            .map_err(|e| e.to_string())?
                            .len() as usize;
                        if image_bytes > MAX_IMAGE_BYTES {
                            return Err("PDF extracted image byte limit exceeded".into());
                        }
                    }
                    Some(name)
                } else {
                    None
                };
                result.image_ms += start.elapsed().as_secs_f64() * 1000.;
                evidence.images.push(PdfImage {
                    object: i,
                    bounds,
                    background,
                    asset,
                });
            } else if object.as_text_object().is_some() {
                evidence.text_objects += 1;
            } else if object.as_path_object().is_some()
                && ((bh <= 2. && bw >= w * 0.1) || (bw <= 2. && bh >= h * 0.08))
            {
                evidence.rules.push(bounds);
            } else if bw > 3. && bh > 3. {
                evidence.complex_objects += 1;
            }
        }
        result.pages.push(evidence);
    }
    result.extraction_ms = started.elapsed().as_secs_f64() * 1000. - result.image_ms;
    Ok(result)
}
