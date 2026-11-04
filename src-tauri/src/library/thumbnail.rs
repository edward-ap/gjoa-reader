use super::Result;
use crate::reader::document::{Document, RenderRequest};

/// Small, versioned database cache; the binary IPC representation is unchanged.
pub fn render(document: &dyn Document) -> Result<Vec<u8>> {
    let page = document.page_info(0)?;
    if page.width == 0 || page.height == 0 {
        return Err("Invalid thumbnail page size".into());
    }
    let scale = (64.0 / f64::from(page.width)).min(88.0 / f64::from(page.height));
    let request = RenderRequest {
        width: (f64::from(page.width) * scale).round().max(1.0) as u32,
        height: (f64::from(page.height) * scale).round().max(1.0) as u32,
    };
    let raster = document.render_page(0, request)?;
    if raster.width != request.width
        || raster.height != request.height
        || raster.rgba.len() != request.byte_len()?
    {
        return Err("Invalid thumbnail raster".into());
    }
    let mut bytes = Vec::with_capacity(8 + raster.rgba.len());
    bytes.extend_from_slice(&raster.width.to_le_bytes());
    bytes.extend_from_slice(&raster.height.to_le_bytes());
    bytes.extend(raster.rgba);
    Ok(bytes)
}
