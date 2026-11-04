//! All DirectWrite interfaces are created, used and dropped on the publishing thread.
//! No visible desktop, DOM, font-file copying or unsafe Send is involved.
use super::system_fallback::*;
use std::{
    cell::{Cell, RefCell},
    collections::HashMap,
    ffi::c_void,
    rc::Rc,
};
use windows::{
    Win32::Graphics::DirectWrite::*,
    core::{BOOL, IUnknown, Interface, Ref, implement, w},
};
const SCALE: f32 = 3.;
static CALLS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
pub fn calls() -> usize {
    CALLS.load(std::sync::atomic::Ordering::Relaxed)
}
#[derive(Default)]
pub struct DirectWriteSystemFallback {
    factory: Option<IDWriteFactory>,
    cache: Rc<RefCell<HashMap<String, NativeGlyph>>>,
}
impl SystemFontFallbackProvider for DirectWriteSystemFallback {
    fn resolve_and_render(
        &mut self,
        request: FallbackRequest<'_>,
    ) -> Result<FallbackResult, String> {
        CALLS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        self.render(request).map_err(|e| e.to_string())
    }
}
impl DirectWriteSystemFallback {
    fn render(&mut self, request: FallbackRequest<'_>) -> windows::core::Result<FallbackResult> {
        if request.text.encode_utf16().count() > 1024 {
            return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                0x80070057u32 as i32,
            )));
        }
        // DirectWrite does not require apartment initialization. Its interfaces never escape this call.
        unsafe {
            if self.factory.is_none() {
                self.factory = Some(DWriteCreateFactory(DWRITE_FACTORY_TYPE_ISOLATED)?);
            }
            let factory = self.factory.as_ref().unwrap().clone();
            let format = factory.CreateTextFormat(
                w!("Segoe UI"),
                None,
                if request.style.bold {
                    DWRITE_FONT_WEIGHT_BOLD
                } else {
                    DWRITE_FONT_WEIGHT_NORMAL
                },
                if request.style.italic {
                    DWRITE_FONT_STYLE_ITALIC
                } else {
                    DWRITE_FONT_STYLE_NORMAL
                },
                DWRITE_FONT_STRETCH_NORMAL,
                request.size,
                w!("en-us"),
            )?;
            format.SetWordWrapping(DWRITE_WORD_WRAPPING_NO_WRAP)?;
            let utf16: Vec<_> = request.text.encode_utf16().collect();
            let layout = factory.CreateTextLayout(&utf16, &format, 65536., 512.)?;
            let mut metrics = DWRITE_TEXT_METRICS::default();
            layout.GetMetrics(&mut metrics)?;
            let result = Rc::new(RefCell::new(Vec::new()));
            let mut map = vec![0; utf16.len() + 1];
            let mut u = 0;
            for (b, c) in request.text.char_indices() {
                for n in 0..c.len_utf16() {
                    map[u + n] = b;
                }
                u += c.len_utf16();
            }
            map[u] = request.text.len();
            let renderer: IDWriteTextRenderer = Capture {
                factory,
                result: result.clone(),
                result_bytes: Cell::new(0),
                cache: self.cache.clone(),
                map,
            }
            .into();
            layout.Draw(None, &renderer, 0., 0.)?;
            let glyphs = result.borrow().clone();
            Ok(FallbackResult {
                advance: metrics.widthIncludingTrailingWhitespace,
                glyphs,
            })
        }
    }
}
#[implement(IDWriteTextRenderer)]
struct Capture {
    factory: IDWriteFactory,
    result: Rc<RefCell<Vec<NativeGlyph>>>,
    result_bytes: Cell<usize>,
    cache: Rc<RefCell<HashMap<String, NativeGlyph>>>,
    map: Vec<usize>,
}
#[allow(non_snake_case)]
impl IDWritePixelSnapping_Impl for Capture_Impl {
    fn IsPixelSnappingDisabled(&self, _: *const c_void) -> windows::core::Result<BOOL> {
        Ok(true.into())
    }
    fn GetCurrentTransform(
        &self,
        _: *const c_void,
        t: *mut DWRITE_MATRIX,
    ) -> windows::core::Result<()> {
        unsafe {
            *t = DWRITE_MATRIX {
                m11: 1.,
                m22: 1.,
                ..Default::default()
            };
        }
        Ok(())
    }
    fn GetPixelsPerDip(&self, _: *const c_void) -> windows::core::Result<f32> {
        Ok(1.)
    }
}
#[allow(non_snake_case)]
impl IDWriteTextRenderer_Impl for Capture_Impl {
    fn DrawGlyphRun(
        &self,
        _: *const c_void,
        bx: f32,
        _by: f32,
        mode: DWRITE_MEASURING_MODE,
        run: *const DWRITE_GLYPH_RUN,
        description: *const DWRITE_GLYPH_RUN_DESCRIPTION,
        _: Ref<'_, IUnknown>,
    ) -> windows::core::Result<()> {
        // The pointers/slices are provided by synchronous IDWriteTextLayout::Draw and used only here.
        unsafe {
            if run.is_null() || description.is_null() {
                return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                    0x80070057u32 as i32,
                )));
            }
            let run = &*run;
            let desc = &*description;
            if run.glyphCount == 0 {
                return Ok(());
            }
            if run.glyphIndices.is_null() || desc.clusterMap.is_null() || desc.stringLength == 0 {
                return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                    0x80070057u32 as i32,
                )));
            }
            if run.glyphCount > 4096 || self.result.borrow().len() + run.glyphCount as usize > 4096
            {
                return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                    0x80070057u32 as i32,
                )));
            }
            let face = run.fontFace.as_ref().unwrap();
            let mut collection = None;
            self.factory
                .GetSystemFontCollection(&mut collection, false)?;
            let collection = collection.unwrap();
            let font = collection.GetFontFromFontFace(face)?;
            let family = font.GetFontFamily()?.GetFamilyNames()?;
            let mut name = vec![0; family.GetStringLength(0)? as usize + 1];
            family.GetString(0, &mut name)?;
            let face_names = font.GetFaceNames()?;
            let mut face_name = vec![0; face_names.GetStringLength(0)? as usize + 1];
            face_names.GetString(0, &mut face_name)?;
            let family = format!(
                "{} / {} / {}",
                String::from_utf16_lossy(&name[..name.len() - 1]),
                String::from_utf16_lossy(&face_name[..face_name.len() - 1]),
                face.GetIndex()
            );
            let ids = std::slice::from_raw_parts(run.glyphIndices, run.glyphCount as usize);
            // DirectWrite may omit offsets when every offset is zero (e.g. Greek).
            // Optional native arrays must never become Rust slices from null pointers.
            let offsets = if run.glyphOffsets.is_null() {
                vec![DWRITE_GLYPH_OFFSET::default(); ids.len()]
            } else {
                std::slice::from_raw_parts(run.glyphOffsets, ids.len()).to_vec()
            };
            let advances = if run.glyphAdvances.is_null() {
                let mut font_metrics = DWRITE_FONT_METRICS::default();
                face.GetMetrics(&mut font_metrics);
                let mut glyph_metrics = vec![DWRITE_GLYPH_METRICS::default(); ids.len()];
                face.GetDesignGlyphMetrics(
                    ids.as_ptr(),
                    run.glyphCount,
                    glyph_metrics.as_mut_ptr(),
                    run.isSideways.as_bool(),
                )?;
                let scale = run.fontEmSize / f32::from(font_metrics.designUnitsPerEm.max(1));
                glyph_metrics
                    .iter()
                    .map(|g| {
                        if run.isSideways.as_bool() {
                            g.advanceHeight as f32 * scale
                        } else {
                            g.advanceWidth as f32 * scale
                        }
                    })
                    .collect()
            } else {
                std::slice::from_raw_parts(run.glyphAdvances, ids.len()).to_vec()
            };
            let clusters = std::slice::from_raw_parts(desc.clusterMap, desc.stringLength as usize);
            let rtl = !run.bidiLevel.is_multiple_of(2);
            let mut pen = bx;
            for (i, &id) in ids.iter().enumerate() {
                let cluster = clusters
                    .iter()
                    .copied()
                    .filter(|&v| usize::from(v) <= i)
                    .max()
                    .unwrap_or(0);
                let from = clusters.iter().position(|&v| v == cluster).unwrap_or(0);
                let to = clusters
                    .iter()
                    .rposition(|&v| v == cluster)
                    .map(|v| v + 1)
                    .unwrap_or(clusters.len());
                let start = self.map[(desc.textPosition as usize + from).min(self.map.len() - 1)];
                let end = self.map[(desc.textPosition as usize + to).min(self.map.len() - 1)];
                let key = format!(
                    "{family}/{}/{}/{}/{id}",
                    face.GetSimulations().0,
                    run.fontEmSize.to_bits(),
                    run.isSideways.as_bool()
                );
                let cached = self.cache.borrow().get(&key).cloned();
                let mut glyph = if let Some(g) = cached {
                    g
                } else {
                    let index = [id];
                    let zero = [0.];
                    let offset = [DWRITE_GLYPH_OFFSET::default()];
                    let single = DWRITE_GLYPH_RUN {
                        fontFace: std::mem::ManuallyDrop::new(Some(face.clone())),
                        fontEmSize: run.fontEmSize,
                        glyphCount: 1,
                        glyphIndices: index.as_ptr(),
                        glyphAdvances: zero.as_ptr(),
                        glyphOffsets: offset.as_ptr(),
                        isSideways: run.isSideways,
                        bidiLevel: 0,
                    };
                    let color = color_glyph(&self.factory, &single, mode);
                    let analysis = self.factory.CreateGlyphRunAnalysis(
                        &single,
                        SCALE,
                        None,
                        DWRITE_RENDERING_MODE_NATURAL_SYMMETRIC,
                        mode,
                        0.,
                        0.,
                    );
                    let mut single = single;
                    std::mem::ManuallyDrop::drop(&mut single.fontFace);
                    let color = color?;
                    let analysis = analysis?;
                    let bounds = analysis.GetAlphaTextureBounds(DWRITE_TEXTURE_CLEARTYPE_3x1)?;
                    let width = bounds.right.saturating_sub(bounds.left) as u32;
                    let height = bounds.bottom.saturating_sub(bounds.top) as u32;
                    if width > 512 || height > 512 {
                        return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                            0x80070057u32 as i32,
                        )));
                    }
                    let mut rgb = vec![0; width as usize * height as usize * 3];
                    if !rgb.is_empty() {
                        analysis.CreateAlphaTexture(
                            DWRITE_TEXTURE_CLEARTYPE_3x1,
                            &bounds,
                            &mut rgb,
                        )?;
                    }
                    let mask = rgb
                        .chunks_exact(3)
                        .map(|p| {
                            ((u32::from(p[0]) + u32::from(p[1]) + u32::from(p[2]) + 1) / 3) as u8
                        })
                        .collect();
                    let mut g = NativeGlyph {
                        start: 0,
                        end: 0,
                        x: bounds.left as f32 / SCALE,
                        y: bounds.top as f32 / SCALE,
                        advance: 0.,
                        width,
                        height,
                        mask,
                        rgba: None,
                        family: family.clone(),
                        glyph_id: id,
                        missing: id == 0,
                    };
                    if let Some((bounds, rgba)) = color {
                        g.width = (bounds.right - bounds.left) as u32;
                        g.height = (bounds.bottom - bounds.top) as u32;
                        g.x = bounds.left as f32 / SCALE;
                        g.y = bounds.top as f32 / SCALE;
                        g.mask = rgba.chunks_exact(4).map(|p| p[3]).collect();
                        g.rgba = Some(rgba);
                    }
                    let mut cache = self.cache.borrow_mut();
                    if cache.len() >= 4096
                        || cache
                            .values()
                            .map(|g| g.mask.len() + g.rgba.as_ref().map_or(0, Vec::len))
                            .sum::<usize>()
                            + g.mask.len()
                            + g.rgba.as_ref().map_or(0, Vec::len)
                            > 16 * 1024 * 1024
                    {
                        cache.clear();
                    }
                    cache.insert(key, g.clone());
                    g
                };
                if rtl {
                    pen -= advances[i];
                }
                glyph.x += pen
                    + if rtl {
                        -offsets[i].advanceOffset
                    } else {
                        offsets[i].advanceOffset
                    };
                glyph.y -= offsets[i].ascenderOffset;
                glyph.advance = advances[i];
                glyph.start = start;
                glyph.end = end;
                let total = self.result_bytes.get()
                    + glyph.mask.len()
                    + glyph.rgba.as_ref().map_or(0, Vec::len);
                if total > 16 * 1024 * 1024 {
                    return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                        0x80070057u32 as i32,
                    )));
                }
                self.result_bytes.set(total);
                self.result.borrow_mut().push(glyph);
                if !rtl {
                    pen += advances[i];
                }
            }
        }
        Ok(())
    }
    fn DrawUnderline(
        &self,
        _: *const c_void,
        _: f32,
        _: f32,
        _: *const DWRITE_UNDERLINE,
        _: Ref<'_, IUnknown>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn DrawStrikethrough(
        &self,
        _: *const c_void,
        _: f32,
        _: f32,
        _: *const DWRITE_STRIKETHROUGH,
        _: Ref<'_, IUnknown>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn DrawInlineObject(
        &self,
        _: *const c_void,
        _: f32,
        _: f32,
        _: Ref<'_, IDWriteInlineObject>,
        _: BOOL,
        _: BOOL,
        _: Ref<'_, IUnknown>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
}

// COLR/CPAL layers exposed by DirectWrite 2; SVG/bitmap-only color fonts may use
// the monochrome outline path. All layer buffers and their union are bounded.
fn color_glyph(
    factory: &IDWriteFactory,
    run: &DWRITE_GLYPH_RUN,
    mode: DWRITE_MEASURING_MODE,
) -> windows::core::Result<Option<(windows::Win32::Foundation::RECT, Vec<u8>)>> {
    use windows::Win32::Foundation::RECT;
    unsafe {
        let Ok(factory2) = factory.cast::<IDWriteFactory2>() else {
            return Ok(None);
        };
        let Ok(colors) = factory2.TranslateColorGlyphRun(0., 0., run, None, mode, None, 0) else {
            return Ok(None);
        };
        let mut layers = Vec::new();
        let mut union = RECT {
            left: i32::MAX,
            top: i32::MAX,
            right: i32::MIN,
            bottom: i32::MIN,
        };
        let mut total = 0usize;
        while colors.MoveNext()?.as_bool() {
            let layer = &*colors.GetCurrentRun()?;
            let analysis = factory.CreateGlyphRunAnalysis(
                &layer.glyphRun,
                SCALE,
                None,
                DWRITE_RENDERING_MODE_NATURAL_SYMMETRIC,
                mode,
                layer.baselineOriginX,
                layer.baselineOriginY,
            )?;
            let b = analysis.GetAlphaTextureBounds(DWRITE_TEXTURE_CLEARTYPE_3x1)?;
            let w = b.right.saturating_sub(b.left) as usize;
            let h = b.bottom.saturating_sub(b.top) as usize;
            if w == 0 || h == 0 {
                continue;
            }
            if w > 512 || h > 512 || layers.len() >= 256 || total + w * h * 3 > 4 * 1024 * 1024 {
                return Ok(None);
            }
            total += w * h * 3;
            let mut rgb = vec![0; w * h * 3];
            analysis.CreateAlphaTexture(DWRITE_TEXTURE_CLEARTYPE_3x1, &b, &mut rgb)?;
            union.left = union.left.min(b.left);
            union.top = union.top.min(b.top);
            union.right = union.right.max(b.right);
            union.bottom = union.bottom.max(b.bottom);
            layers.push((b, rgb, layer.runColor, layer.paletteIndex));
        }
        if layers.is_empty() {
            return Ok(None);
        }
        let w = union.right.saturating_sub(union.left) as usize;
        let h = union.bottom.saturating_sub(union.top) as usize;
        if w > 512 || h > 512 {
            return Ok(None);
        }
        let mut pixels = vec![[0f32; 4]; w * h];
        for (b, rgb, color, palette) in layers {
            let width = (b.right - b.left) as usize;
            for (i, mask) in rgb.chunks_exact(3).enumerate() {
                let x = (b.left - union.left) as usize + i % width;
                let y = (b.top - union.top) as usize + i / width;
                let alpha = (mask.iter().map(|&v| f32::from(v)).sum::<f32>() / 765.)
                    * if palette == 0xffff { 1. } else { color.a };
                let channels = if palette == 0xffff {
                    [0., 0., 0.]
                } else {
                    [color.r, color.g, color.b]
                };
                let p = &mut pixels[y * w + x];
                for c in 0..3 {
                    p[c] = channels[c] * alpha + p[c] * (1. - alpha);
                }
                p[3] = alpha + p[3] * (1. - alpha);
            }
        }
        let mut rgba = Vec::with_capacity(w * h * 4);
        for p in pixels {
            for c in p.iter().take(3) {
                rgba.push(if p[3] > 0. {
                    (*c / p[3] * 255.).round().clamp(0., 255.) as u8
                } else {
                    0
                });
            }
            rgba.push((p[3] * 255.).round().clamp(0., 255.) as u8);
        }
        Ok(Some((union, rgba)))
    }
}
