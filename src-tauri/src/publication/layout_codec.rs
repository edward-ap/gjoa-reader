//! Page storage v2: explicit little-endian records, lossless f32 bits, zlib frame.
use super::typography::{Glyph, Item, PageLayout};
use crate::library::Result;
use std::io::Write;

const MAGIC: &[u8; 8] = b"RDRPAGE2";
pub const MAX_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ITEMS: usize = 20_000;

fn uint(out: &mut Vec<u8>, value: usize) -> Result<()> {
    out.extend_from_slice(&u32::try_from(value)?.to_le_bytes());
    Ok(())
}
fn float(out: &mut Vec<u8>, value: f32) {
    out.extend_from_slice(&value.to_bits().to_le_bytes());
}
fn bounds(out: &mut Vec<u8>, value: &[f32; 4]) {
    for v in value {
        float(out, *v);
    }
}

pub fn encode(page: &PageLayout) -> Result<Vec<u8>> {
    encode_version(page, 2)
}
pub fn encode_version(page: &PageLayout, version: u32) -> Result<Vec<u8>> {
    if !matches!(version, 2..=4) {
        return Err("Unsupported page codec version".into());
    }
    if page.items.len() > MAX_ITEMS {
        return Err("Page item budget exceeded".into());
    }
    let mut raw = Vec::new();
    uint(&mut raw, page.width as usize)?;
    uint(&mut raw, page.height as usize)?;
    uint(&mut raw, page.items.len())?;
    let mut count = 0;
    for item in &page.items {
        match item {
            Item::Rule { bounds: b } => {
                if version < 4 {
                    return Err("Rule requires page storage v4".into());
                }
                raw.push(3);
                bounds(&mut raw, b);
            }

            Item::GlyphRun {
                font,
                size,
                glyphs,
                source_start,
                source_end,
                bounds: b,
            } => {
                count += glyphs.len();
                if count > MAX_ITEMS {
                    return Err("Page glyph budget exceeded".into());
                }
                raw.push(0);
                uint(&mut raw, *font)?;
                float(&mut raw, *size);
                uint(&mut raw, *source_start)?;
                uint(&mut raw, *source_end)?;
                bounds(&mut raw, b);
                uint(&mut raw, glyphs.len())?;
                for Glyph(id, x, y, start, end) in glyphs {
                    raw.extend_from_slice(&id.to_le_bytes());
                    float(&mut raw, *x);
                    float(&mut raw, *y);
                    uint(&mut raw, *start)?;
                    uint(&mut raw, *end)?;
                }
            }
            Item::RasterGlyph {
                asset,
                baseline,
                advance,
                source_start,
                source_end,
                bounds: b,
            } => {
                if version < 3 || asset.len() > 4096 {
                    return Err("Raster glyph requires page storage v3".into());
                }
                raw.push(2);
                uint(&mut raw, asset.len())?;
                raw.extend_from_slice(asset.as_bytes());
                float(&mut raw, baseline[0]);
                float(&mut raw, baseline[1]);
                float(&mut raw, *advance);
                uint(&mut raw, *source_start)?;
                uint(&mut raw, *source_end)?;
                bounds(&mut raw, b);
            }
            Item::Image { asset, bounds: b } => {
                if asset.len() > 4096 {
                    return Err("Image asset path exceeds budget".into());
                }
                raw.push(1);
                uint(&mut raw, asset.len())?;
                raw.extend_from_slice(asset.as_bytes());
                bounds(&mut raw, b);
            }
        }
        if raw.len() as u64 > MAX_BYTES {
            return Err("Page storage budget exceeded".into());
        }
    }
    let mut out = if version == 4 {
        b"RDRPAGE4".to_vec()
    } else if version == 3 {
        b"RDRPAGE3".to_vec()
    } else {
        MAGIC.to_vec()
    };
    uint(&mut out, raw.len())?;
    let mut zip = flate2::write::ZlibEncoder::new(out, flate2::Compression::new(6));
    zip.write_all(&raw)?;
    let bytes = zip.finish()?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err("Compressed page storage budget exceeded".into());
    }
    Ok(bytes)
}

struct Cursor<'a>(&'a [u8]);
impl<'a> Cursor<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if n > self.0.len() {
            return Err("Truncated binary page".into());
        }
        let (head, tail) = self.0.split_at(n);
        self.0 = tail;
        Ok(head)
    }
    fn uint(&mut self) -> Result<usize> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into()?) as usize)
    }
    fn float(&mut self) -> Result<f32> {
        Ok(f32::from_bits(self.uint()? as u32))
    }
    fn bounds(&mut self) -> Result<[f32; 4]> {
        Ok([self.float()?, self.float()?, self.float()?, self.float()?])
    }
    fn count(&mut self, min_bytes: usize) -> Result<usize> {
        let count = self.uint()?;
        if count > MAX_ITEMS || count > self.0.len() / min_bytes {
            return Err("Invalid binary page count".into());
        }
        Ok(count)
    }
}
pub fn decode(bytes: &[u8]) -> Result<PageLayout> {
    decode_version(bytes, 2)
}
pub fn decode_version(bytes: &[u8], version: u32) -> Result<PageLayout> {
    let magic = match version {
        2 => MAGIC,
        3 => b"RDRPAGE3",
        4 => b"RDRPAGE4",
        _ => return Err("Unsupported page codec version".into()),
    };
    if bytes.len() < 12 || bytes.len() as u64 > MAX_BYTES || &bytes[..8] != magic {
        return Err("Unsupported or invalid page storage header".into());
    }
    let size = u32::from_le_bytes(bytes[8..12].try_into()?) as usize;
    if !(12..=MAX_BYTES as usize).contains(&size) {
        return Err("Page decompression budget exceeded".into());
    }
    let mut decoder = flate2::Decompress::new(true);
    let mut raw = Vec::with_capacity(size + 1);
    let status = decoder.decompress_vec(&bytes[12..], &mut raw, flate2::FlushDecompress::Finish)?;
    if status != flate2::Status::StreamEnd
        || raw.len() != size
        || decoder.total_in() != (bytes.len() - 12) as u64
    {
        return Err("Incomplete, oversized or trailing compressed page data".into());
    }
    let mut input = Cursor(&raw);
    let width = input.uint()? as u32;
    let height = input.uint()? as u32;
    let count = input.count(21)?;
    let mut items = Vec::with_capacity(count);
    let mut total_glyphs = 0;
    for _ in 0..count {
        let tag = input.take(1)?[0];
        items.push(match tag {
            0 => {
                let font = input.uint()?;
                let size = input.float()?;
                let source_start = input.uint()?;
                let source_end = input.uint()?;
                let bounds = input.bounds()?;
                let count = input.count(18)?;
                total_glyphs += count;
                if total_glyphs > MAX_ITEMS {
                    return Err("Page glyph budget exceeded".into());
                }
                let mut glyphs = Vec::with_capacity(count);
                for _ in 0..count {
                    glyphs.push(Glyph(
                        u16::from_le_bytes(input.take(2)?.try_into()?),
                        input.float()?,
                        input.float()?,
                        input.uint()?,
                        input.uint()?,
                    ));
                }
                Item::GlyphRun {
                    font,
                    size,
                    source_start,
                    source_end,
                    bounds,
                    glyphs,
                }
            }
            1 => {
                let len = input.uint()?;
                if len > 4096 {
                    return Err("Image asset path exceeds budget".into());
                }
                let asset = std::str::from_utf8(input.take(len)?)?.to_owned();
                Item::Image {
                    asset,
                    bounds: input.bounds()?,
                }
            }
            2 if version >= 3 => {
                let len = input.uint()?;
                if len > 4096 {
                    return Err("Raster asset path budget".into());
                }
                let asset = std::str::from_utf8(input.take(len)?)?.to_owned();
                Item::RasterGlyph {
                    asset,
                    baseline: [input.float()?, input.float()?],
                    advance: input.float()?,
                    source_start: input.uint()?,
                    source_end: input.uint()?,
                    bounds: input.bounds()?,
                }
            }
            3 if version >= 4 => Item::Rule {
                bounds: input.bounds()?,
            },
            _ => return Err("Unknown binary page item".into()),
        });
    }
    if !input.0.is_empty() {
        return Err("Trailing binary page data".into());
    }
    Ok(PageLayout {
        width,
        height,
        items,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_float_bits_and_malformed_frames() {
        let page = PageLayout {
            width: 800,
            height: 1120,
            items: vec![
                Item::GlyphRun {
                    font: 4,
                    size: 19.0,
                    source_start: 0,
                    source_end: 9,
                    bounds: [-0.0, 72.125, 100.0, 28.0],
                    glyphs: vec![Glyph(42, f32::from_bits(0x3f812345), -0.0, 0, 9)],
                },
                Item::Image {
                    asset: "assets/画像.png".into(),
                    bounds: [1.0, 2.0, 3.0, 4.0],
                },
            ],
        };
        let bytes = encode(&page).unwrap();
        assert_eq!(encode(&decode(&bytes).unwrap()).unwrap(), bytes);
        assert_eq!(
            serde_json::to_vec(&decode(&bytes).unwrap()).unwrap(),
            serde_json::to_vec(&page).unwrap()
        );
        for n in 0..bytes.len() {
            assert!(decode(&bytes[..n]).is_err(), "truncation {n}");
        }
        let mut bad = bytes.clone();
        bad.push(0);
        assert!(decode(&bad).is_err());
        let mut bad = bytes.clone();
        bad[7] = b'3';
        assert!(decode(&bad).is_err());
        let mut bad = bytes.clone();
        bad[8..12].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(decode(&bad).is_err());
        let mut bad = bytes;
        let last = bad.len() - 1;
        bad[last] ^= 1;
        assert!(decode(&bad).is_err());
    }
}
