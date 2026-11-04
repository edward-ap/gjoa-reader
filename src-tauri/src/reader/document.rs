use super::format::FormatId;
use serde::{Deserialize, Serialize};

pub type Result<T> = std::result::Result<T, String>;
pub const MAX_DIMENSION: u32 = 8192;
pub const MAX_PIXELS: u64 = 16_777_216;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PageInfo {
    pub width: u32,
    pub height: u32,
    /// Optional source metadata. Geometry and Actual never depend on DPI.
    pub dpi: Option<u16>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PageAppearance {
    #[default]
    Original,
    Sepia,
    Night,
    Custom([u8; 3]),
}
impl PageAppearance {
    pub fn palette(self) -> ([u8; 3], [u8; 3]) {
        match self {
            Self::Original => ([255, 255, 255], [0, 0, 0]),
            Self::Sepia => ([244, 236, 216], [58, 51, 39]),
            Self::Night => ([17, 17, 17], [221, 221, 221]),
            Self::Custom(paper) => {
                // Choose black/white ink by WCAG relative luminance for arbitrary paper colors.
                let linear = paper.map(|channel| {
                    let value = f64::from(channel) / 255.0;
                    if value <= 0.04045 {
                        value / 12.92
                    } else {
                        ((value + 0.055) / 1.055).powf(2.4)
                    }
                });
                let luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
                (
                    paper,
                    if luminance > 0.179 {
                        [0, 0, 0]
                    } else {
                        [255, 255, 255]
                    },
                )
            }
        }
    }
}

#[derive(Clone, Copy)]
pub struct RenderRequest {
    pub width: u32,
    pub height: u32,
}

impl RenderRequest {
    pub fn byte_len(self) -> Result<usize> {
        let pixels = u64::from(self.width) * u64::from(self.height);
        if self.width == 0
            || self.height == 0
            || self.width > MAX_DIMENSION
            || self.height > MAX_DIMENSION
            || pixels > MAX_PIXELS
        {
            return Err(
                "Raster exceeds limits (8192 per axis, 16777216 pixels) or is empty".into(),
            );
        }
        usize::try_from(pixels * 4).map_err(|e| e.to_string())
    }
}

pub struct RenderedPage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// An immutable edition of logical pages, independent of source format.
/// Rendering changes raster resolution, never page count or logical geometry.
/// RGBA is tightly packed, row-major, top-down, straight alpha, exactly the
/// requested width/height. Source parsing and pagination belong to adapters.
pub trait Document: Send + Sync {
    fn supports_page_appearance(&self) -> bool {
        false
    }
    fn render_with_appearance(
        &self,
        index: usize,
        request: RenderRequest,
        _appearance: PageAppearance,
    ) -> Result<RenderedPage> {
        self.render_page(index, request)
    }
    fn format_id(&self) -> FormatId;
    fn page_count(&self) -> usize;
    fn page_info(&self, index: usize) -> Result<PageInfo>;
    fn render_page(&self, index: usize, request: RenderRequest) -> Result<RenderedPage>;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn render_limits_reject_untrusted_dimensions() {
        for (width, height) in [
            (0, 1),
            (1, 0),
            (u32::MAX, u32::MAX),
            (8193, 1),
            (8192, 8192),
        ] {
            assert!(RenderRequest { width, height }.byte_len().is_err());
        }
        assert_eq!(
            RenderRequest {
                width: 4096,
                height: 4096
            }
            .byte_len()
            .unwrap(),
            67_108_864
        );
    }
}
