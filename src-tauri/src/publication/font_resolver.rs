//! Format-neutral, publication-time resolution. No source adapter or runtime dependency.
use super::{
    model::Style,
    system_fallback::{self, FallbackRequest, FallbackResult, SystemFontFallbackProvider},
    typography::Item,
};
use crate::library::{Result, edition::Manifest, store::hash_reader};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, path::Path};
use unicode_script::{Script, UnicodeScript};
use unicode_segmentation::UnicodeSegmentation;
pub const POLICY: &str = "font-resolver-v1;grapheme-script;dwrite-alpha3-colr;box-last-resort";
pub const MAX_OPERATIONS: usize = 100_000;
pub const MAX_ASSETS: usize = 32_768;
pub const MAX_ASSET_BYTES: usize = 128 * 1024 * 1024;
pub const MAX_RUN_BYTES: usize = 2048;
#[derive(Default, Serialize)]
pub struct Report {
    pub canonical_runs: usize,
    pub bundled_runs: usize,
    pub canonical_glyphs: usize,
    pub bundled_glyphs: usize,
    pub system_runs: usize,
    pub system_calls: usize,
    pub fallback_clusters: usize,
    pub unique_assets: usize,
    pub asset_bytes: usize,
    pub last_resort_clusters: usize,
    pub adjustments: usize,
    pub high_fallback_usage: bool,
    pub entries: Vec<Entry>,
}
#[derive(Serialize)]
pub struct Entry {
    pub start: usize,
    pub end: usize,
    pub codepoints: Vec<String>,
    pub tier: String,
    pub family: String,
    pub glyph_id: u16,
    pub advance: f32,
    pub bounds: [f32; 4],
    pub asset: String,
}
pub enum Resolved {
    Font {
        start: usize,
        end: usize,
        font: usize,
    },
    Raster {
        items: Vec<Item>,
        advance: f32,
    },
}
pub struct FontResolver<'a> {
    faces: &'a [rustybuzz::Face<'a>],
    provider: Box<dyn SystemFontFallbackProvider>,
    pub report: Report,
    assets: HashMap<String, Vec<u8>>,
    runs: HashMap<String, FallbackResult>,
    fingerprint: Sha256,
}
fn q(v: f32) -> f32 {
    (v * 64.).round() / 64.
}
pub fn invisible(c: char) -> bool {
    matches!(c as u32,0x00ad|0x034f|0x061c|0x115f..=0x1160|0x17b4..=0x17b5|0x180b..=0x180f|0x200b..=0x200f|0x202a..=0x202e|0x2060..=0x206f|0x3164|0xfe00..=0xfe0f|0xfeff|0xffa0|0x1bca0..=0x1bca3|0x1d173..=0x1d17a|0xe0000..=0xe0fff)
}
fn contextual(text: &str) -> bool {
    text.chars().any(|c| {
        !matches!(
            c.script(),
            Script::Common
                | Script::Inherited
                | Script::Latin
                | Script::Cyrillic
                | Script::Greek
                | Script::Han
                | Script::Hiragana
                | Script::Katakana
                | Script::Hangul
                | Script::Unknown
        )
    })
}
impl<'a> FontResolver<'a> {
    pub fn new(faces: &'a [rustybuzz::Face<'a>]) -> Self {
        Self::with_provider(faces, system_fallback::provider())
    }
    pub fn with_provider(
        faces: &'a [rustybuzz::Face<'a>],
        provider: Box<dyn SystemFontFallbackProvider>,
    ) -> Self {
        let mut fingerprint = Sha256::new();
        fingerprint.update(POLICY.as_bytes());
        Self {
            faces,
            provider,
            report: Report::default(),
            assets: HashMap::new(),
            runs: HashMap::new(),
            fingerprint,
        }
    }
    fn supports(&self, font: usize, text: &str) -> bool {
        if text.chars().all(invisible) {
            return true;
        }
        let mut buffer = rustybuzz::UnicodeBuffer::new();
        buffer.push_str(text);
        buffer.guess_segment_properties();
        let glyphs = rustybuzz::shape(&self.faces[font], &[], buffer);
        !glyphs.glyph_infos().is_empty() && glyphs.glyph_infos().iter().all(|g| g.glyph_id != 0)
    }
    fn choose(&self, text: &str, style: Style) -> Option<usize> {
        std::iter::once(style.font())
            .chain(4..self.faces.len())
            .find(|&i| self.supports(i, text))
    }
    pub fn resolve(
        &mut self,
        text: &str,
        start: usize,
        style: Style,
        size: f32,
    ) -> Result<Vec<Resolved>> {
        if text.chars().all(invisible) {
            return Ok(vec![]);
        }
        if self.supports(style.font(), text) {
            return Ok(vec![Resolved::Font {
                start,
                end: start + text.len(),
                font: style.font(),
            }]);
        }
        // Contextual scripts need their shaping context. A style/line-break run is handed to
        // the OS intact, even when some of its letters happen to exist in the canonical face.
        if contextual(text) {
            if let Some(font) = self.choose(text, style) {
                return Ok(vec![Resolved::Font {
                    start,
                    end: start + text.len(),
                    font,
                }]);
            }
            return Ok(vec![self.emergency(text, start, style, size)?]);
        }
        let mut segments: Vec<(usize, usize, Option<usize>)> = Vec::new();
        for (offset, g) in text.grapheme_indices(true) {
            let font = self.choose(g, style);
            if let Some(last) = segments.last_mut().filter(|s| s.2 == font) {
                last.1 = offset + g.len();
            } else {
                segments.push((offset, offset + g.len(), font));
            }
        }
        let mut result = Vec::new();
        for (from, to, font) in segments {
            if let Some(font) = font.filter(|&f| self.supports(f, &text[from..to])) {
                result.push(Resolved::Font {
                    start: start + from,
                    end: start + to,
                    font,
                });
            } else {
                result.push(self.emergency(&text[from..to], start + from, style, size)?);
            }
        }
        Ok(result)
    }
    pub fn record_font(&mut self, font: usize, count: usize) {
        if font < 4 {
            self.report.canonical_runs += 1;
            self.report.canonical_glyphs += count;
        } else {
            self.report.bundled_runs += 1;
            self.report.bundled_glyphs += count;
        }
    }
    fn emergency(&mut self, text: &str, start: usize, style: Style, size: f32) -> Result<Resolved> {
        if text.len() > MAX_RUN_BYTES {
            return Err("Emergency glyph resource limit: run length exceeds 2048 bytes".into());
        }
        let key = format!("{}/{}/{}:{text}", style.font(), size.to_bits(), POLICY);
        let native = if let Some(result) = self.runs.get(&key) {
            Some(result.clone())
        } else {
            if self.report.system_calls >= MAX_OPERATIONS {
                return Err("Emergency glyph resource limit: native operations".into());
            }
            self.report.system_calls += 1;
            let result = self
                .provider
                .resolve_and_render(FallbackRequest { text, size, style })
                .ok();
            if let Some(result) = &result
                && self.runs.len() < 1024
                && result.glyphs.len() <= 4096
                && self
                    .runs
                    .values()
                    .chain(std::iter::once(result))
                    .flat_map(|r| &r.glyphs)
                    .map(|g| g.mask.len() + g.rgba.as_ref().map_or(0, Vec::len))
                    .sum::<usize>()
                    <= 8 * 1024 * 1024
            {
                self.runs.insert(key, result.clone());
            }
            result
        };
        self.report.fallback_clusters += text.graphemes(true).count();
        self.report.high_fallback_usage = self.report.fallback_clusters > 1000;
        let Some(mut native) = native.filter(|r| {
            r.advance.is_finite()
                && r.advance >= 0.
                && r.advance <= 65536.
                && r.glyphs.len() <= 4096
        }) else {
            return self.last_resort(text, start, size);
        };
        if native.glyphs.is_empty() {
            return self.last_resort(text, start, size);
        }
        // Keep already shaped neighbours when the native run contains a .notdef cluster.
        // Replacing its pixels must not break joining or discard supported text in the run.
        let missing: Vec<_> = native
            .glyphs
            .iter()
            .filter(|g| g.missing)
            .map(|g| (g.start, g.end))
            .collect();
        let mut replaced = std::collections::HashSet::new();
        native.glyphs.retain_mut(|g| {
            let Some(&(from, to)) = missing.iter().find(|&&(a, b)| g.start < b && g.end > a) else {
                return true;
            };
            if !replaced.insert((from, to)) {
                return false;
            }
            g.start = from;
            g.end = to;
            g.missing = true;
            g.family = "Reader Last Resort".into();
            g.glyph_id = 0;
            g.width = (size * 0.55 * 3.).ceil() as u32;
            g.height = (size * 0.8 * 3.).ceil() as u32;
            g.y = -size * 0.8;
            g.rgba = None;
            g.mask = box_mask(g.width, g.height);
            self.report.last_resort_clusters +=
                text.get(from..to).map_or(1, |t| t.graphemes(true).count());
            true
        });
        self.report.system_runs += usize::from(native.glyphs.iter().any(|g| !g.missing));
        let mut items = Vec::new();
        let mut min_y = 0f32;
        let mut max_y = 0f32;
        for g in &native.glyphs {
            if g.width > 512
                || g.height > 512
                || g.mask.len() != g.width as usize * g.height as usize
                || g.rgba
                    .as_ref()
                    .is_some_and(|p| p.len() != g.width as usize * g.height as usize * 4)
                || !g.x.is_finite()
                || !g.y.is_finite()
                || !g.advance.is_finite()
                || g.advance.abs() > 65536.
                || g.x.abs() > 65536.
                || g.y.abs() > 65536.
                || g.start > g.end
                || text.get(g.start..g.end).is_none()
            {
                return Err("Invalid native glyph result / resource limit".into());
            }
            min_y = min_y.min(g.y);
            max_y = max_y.max(g.y + g.height as f32 / 3.);
        }
        let factor = (size * 1.05 / (-min_y).max(0.001))
            .min(size * 0.35 / max_y.max(0.001))
            .min(1.);
        if factor < 1. {
            self.report.adjustments += 1;
        }
        for g in native.glyphs {
            if g.width == 0 || g.height == 0 {
                continue;
            }
            let bounds = [
                q(g.x * factor),
                q(g.y * factor),
                q(g.width as f32 / 3. * factor),
                q(g.height as f32 / 3. * factor),
            ];
            let asset = self.asset_bytes(
                g.width,
                g.height,
                g.rgba.as_deref().unwrap_or(&g.mask),
                g.rgba.is_some(),
            )?;
            let item = Item::RasterGlyph {
                asset: asset.clone(),
                baseline: [0., 0.],
                advance: q(g.advance * factor),
                source_start: start + g.start,
                source_end: start + g.end,
                bounds,
            };
            self.fingerprint.update(serde_json::to_vec(&item)?);
            self.fingerprint.update(g.family.as_bytes());
            self.fingerprint.update(g.glyph_id.to_le_bytes());
            if self.report.entries.len() < 4096 {
                self.report.entries.push(Entry {
                    start: start + g.start,
                    end: start + g.end,
                    codepoints: text[g.start..g.end]
                        .chars()
                        .map(|c| format!("U+{:04X}", c as u32))
                        .collect(),
                    tier: if g.missing { "last-resort" } else { "system" }.into(),
                    family: g.family,
                    glyph_id: g.glyph_id,
                    advance: q(g.advance * factor),
                    bounds,
                    asset,
                });
            }
            items.push(item);
        }
        self.fingerprint
            .update(q(native.advance * factor).to_bits().to_le_bytes());
        Ok(Resolved::Raster {
            items,
            advance: q(native.advance * factor),
        })
    }
    fn asset(&mut self, width: u32, height: u32, mask: &[u8]) -> Result<String> {
        self.asset_bytes(width, height, mask, false)
    }
    fn asset_bytes(&mut self, width: u32, height: u32, mask: &[u8], color: bool) -> Result<String> {
        use image::ImageEncoder;
        let mut bytes = Vec::new();
        image::codecs::png::PngEncoder::new(&mut bytes).write_image(
            mask,
            width,
            height,
            if color {
                image::ExtendedColorType::Rgba8
            } else {
                image::ExtendedColorType::L8
            },
        )?;
        let hash = hash_reader(bytes.as_slice())?;
        let path = format!("fallback/{hash}.png");
        if !self.assets.contains_key(&path) {
            if self.assets.len() >= MAX_ASSETS
                || self
                    .report
                    .asset_bytes
                    .checked_add(bytes.len())
                    .is_none_or(|n| n > MAX_ASSET_BYTES)
            {
                return Err("Emergency glyph resource limit: asset budget".into());
            }
            self.report.asset_bytes += bytes.len();
            self.assets.insert(path.clone(), bytes);
        }
        Ok(path)
    }
    fn last_resort(&mut self, text: &str, start: usize, size: f32) -> Result<Resolved> {
        let width = 24;
        let height = 36;
        let mask = box_mask(width, height);
        let asset = self.asset(width, height, &mask)?;
        let mut items = Vec::new();
        let mut x = 0.;
        for (offset, cluster) in text.grapheme_indices(true) {
            if cluster.chars().all(invisible) {
                continue;
            }
            let from = start + offset;
            let end = from + cluster.len();
            let bounds = [q(x), q(-size * 0.8), q(size * 0.55), q(size * 0.8)];
            let item = Item::RasterGlyph {
                asset: asset.clone(),
                baseline: [q(x), 0.],
                advance: q(size * 0.65),
                source_start: from,
                source_end: end,
                bounds,
            };
            self.fingerprint.update(serde_json::to_vec(&item)?);
            if self.report.entries.len() < 4096 {
                self.report.entries.push(Entry {
                    start: from,
                    end,
                    codepoints: cluster
                        .chars()
                        .map(|c| format!("U+{:04X}", c as u32))
                        .collect(),
                    tier: "last-resort".into(),
                    family: "Reader Last Resort".into(),
                    glyph_id: 0,
                    advance: q(size * 0.65),
                    bounds,
                    asset: asset.clone(),
                });
            }
            self.report.last_resort_clusters += 1;
            items.push(item);
            x += size * 0.65;
        }
        Ok(Resolved::Raster {
            items,
            advance: q(x),
        })
    }
    /// Decorations have their own report, but share the immutable glyph assets.
    pub fn finish_decoration(mut self, root: &Path, manifest: &mut Manifest) -> Result<()> {
        self.report.unique_assets = self.assets.len();
        if self.report.last_resort_clusters > 0 {
            manifest.import_warnings.push(format!(
                "Running header contains {} unsupported text clusters.",
                self.report.last_resort_clusters
            ));
        }
        if !self.assets.is_empty() {
            manifest.fallback_fingerprint = Some(crate::library::store::hash_id(&[
                manifest.fallback_fingerprint.as_deref().unwrap_or(""),
                &format!("{:x}", self.fingerprint.finalize()),
            ]));
        }
        let mut assets: Vec<_> = self.assets.into_iter().collect();
        assets.sort_by(|a, b| a.0.cmp(&b.0));
        for (path, bytes) in assets {
            if !manifest.assets.iter().any(|r| r.path == path) {
                manifest
                    .assets
                    .push(super::write_file(root, &path, &bytes)?);
            }
        }
        manifest.assets.push(super::write_file(
            root,
            "header-font-resolution.json",
            &serde_json::to_vec(&self.report)?,
        )?);
        manifest.edition_id = super::identity_manifest(manifest);
        Ok(())
    }
    pub fn finish(mut self, root: &Path, manifest: &mut Manifest) -> Result<()> {
        self.report.unique_assets = self.assets.len();
        if self.report.last_resort_clusters > 0 {
            manifest.import_warnings.push(format!(
                "Book imported with {} unsupported text clusters.",
                self.report.last_resort_clusters
            ));
        }
        if !self.assets.is_empty() {
            manifest.fallback_fingerprint = Some(format!("{:x}", self.fingerprint.finalize()));
        }
        let mut assets: Vec<_> = self.assets.into_iter().collect();
        assets.sort_by(|a, b| a.0.cmp(&b.0));
        for (path, bytes) in assets {
            manifest
                .assets
                .push(super::write_file(root, &path, &bytes)?);
        }
        manifest.assets.push(super::write_file(
            root,
            "font-resolution.json",
            &serde_json::to_vec_pretty(&self.report)?,
        )?);
        manifest.edition_id = super::identity_manifest(manifest);
        Ok(())
    }
}

fn box_mask(width: u32, height: u32) -> Vec<u8> {
    let mut mask = vec![0; (width * height) as usize];
    for y in 0..height {
        for x in 0..width {
            if x < 2 || y < 2 || x >= width.saturating_sub(2) || y >= height.saturating_sub(2) {
                mask[(y * width + x) as usize] = 255;
            }
        }
    }
    mask
}

#[cfg(test)]
#[path = "font_resolver_tests.rs"]
mod tests;
