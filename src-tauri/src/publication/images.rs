use super::{FileRecord, read_file, validate_files};
use crate::{
    library::{Result, edition::Manifest},
    reader::{
        document::{Document, PageInfo, RenderRequest, RenderedPage},
        format::FormatId,
        sources::CBR,
    },
};
use std::{
    io::Cursor,
    path::{Path, PathBuf},
};
pub const MAX_IMAGE_BYTES: u64 = 64 * 1024 * 1024;
pub fn extension(bytes: &[u8]) -> Result<&'static str> {
    match image::guess_format(bytes)? {
        image::ImageFormat::Jpeg => Ok("jpg"),
        image::ImageFormat::Png => Ok("png"),
        image::ImageFormat::WebP => Ok("webp"),
        image::ImageFormat::Bmp => Ok("bmp"),
        _ => Err("Only JPEG/PNG/WebP/BMP page images are supported".into()),
    }
}
pub fn dimensions(bytes: &[u8]) -> Result<(u32, u32)> {
    extension(bytes)?;
    let reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    let (width, height) = reader.into_dimensions()?;
    if width == 0
        || height == 0
        || width > 16384
        || height > 16384
        || u64::from(width) * u64::from(height) > 32 * 1024 * 1024
    {
        return Err("Image exceeds 16384 per axis / 32 MiPixels".into());
    }
    Ok((width, height))
}
pub fn decode(bytes: &[u8]) -> Result<image::RgbaImage> {
    dimensions(bytes)?;
    let mut reader = image::ImageReader::new(Cursor::new(bytes)).with_guessed_format()?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(128 * 1024 * 1024);
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    reader.limits(limits);
    Ok(reader.decode()?.to_rgba8())
}
pub struct ImageDocument {
    format: FormatId,
    root: PathBuf,
    files: Vec<FileRecord>,
    pages: Vec<PageInfo>,
}
impl ImageDocument {
    pub fn open(root: &Path, manifest: &Manifest) -> Result<Self> {
        validate_files(root, manifest)?;
        Ok(Self {
            format: match manifest.format.as_str() {
                "cbr" => CBR,
                "cbz" => super::cbz::CBZ,
                _ => return Err("Unsupported image edition format".into()),
            },
            root: root.to_owned(),
            files: manifest.page_files.clone(),
            pages: manifest.pages.clone(),
        })
    }
}
impl Document for ImageDocument {
    fn format_id(&self) -> FormatId {
        self.format
    }
    fn page_count(&self) -> usize {
        self.pages.len()
    }
    fn page_info(&self, index: usize) -> crate::reader::document::Result<PageInfo> {
        self.pages
            .get(index)
            .cloned()
            .ok_or_else(|| "Page index out of range".into())
    }
    fn render_page(
        &self,
        index: usize,
        request: RenderRequest,
    ) -> crate::reader::document::Result<RenderedPage> {
        (|| -> Result<RenderedPage> {
            request.byte_len()?;
            let file = self.files.get(index).ok_or("Page index out of range")?;
            let source = decode(&read_file(&self.root, file, MAX_IMAGE_BYTES)?)?;
            let info = &self.pages[index];
            if source.width() != info.width || source.height() != info.height {
                return Err("Image metadata mismatch".into());
            }
            let mut resized = image::imageops::resize(
                &source,
                request.width,
                request.height,
                image::imageops::FilterType::Lanczos3,
            );
            for pixel in resized.pixels_mut() {
                let a = u32::from(pixel[3]);
                for c in 0..3 {
                    pixel[c] = ((u32::from(pixel[c]) * a + 255 * (255 - a) + 127) / 255) as u8;
                }
                pixel[3] = 255;
            }
            Ok(RenderedPage {
                width: request.width,
                height: request.height,
                rgba: resized.into_raw(),
            })
        })()
        .map_err(|e| e.to_string())
    }
}
