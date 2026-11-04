//! Lossless packaging only: decoded font bytes and canonical identities stay exact.
use flate2::read::ZlibDecoder;
use sha2::{Digest, Sha256};
use std::{
    fs::File,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{LazyLock, OnceLock},
};

struct PackedFont {
    data: &'static [u8],
    length: usize,
    hash: &'static str,
}
include!(concat!(env!("OUT_DIR"), "/packed_fonts.rs"));
static CACHE: OnceLock<PathBuf> = OnceLock::new();
pub(crate) fn configure(path: PathBuf) {
    let _ = CACHE.set(path);
}
pub(super) static FONTS: LazyLock<[Vec<u8>; 7]> = LazyLock::new(|| {
    std::array::from_fn(|i| {
        load(&PACKED[i], CACHE.get().map(PathBuf::as_path)).expect("valid bundled font")
    })
});
pub(super) static LITERATA: LazyLock<[Vec<u8>; 4]> = LazyLock::new(|| {
    std::array::from_fn(|i| {
        load(&PACKED[i + 7], CACHE.get().map(PathBuf::as_path)).expect("valid Literata font")
    })
});
fn valid(bytes: &[u8], font: &PackedFont) -> bool {
    bytes.len() == font.length && format!("{:x}", Sha256::digest(bytes)) == font.hash
}
fn load(font: &PackedFont, cache: Option<&Path>) -> std::io::Result<Vec<u8>> {
    let path = cache.map(|dir| dir.join(format!("{}.ttf", font.hash)));
    if let Some(path) = &path {
        let cached = (|| -> std::io::Result<Vec<u8>> {
            let mut bytes = Vec::new();
            File::open(path)?
                .take(font.length as u64 + 1)
                .read_to_end(&mut bytes)?;
            Ok(bytes)
        })();
        if let Ok(bytes) = cached
            && valid(&bytes, font)
        {
            return Ok(bytes);
        }
    }
    let mut bytes = Vec::with_capacity(font.length);
    ZlibDecoder::new(font.data)
        .take(font.length as u64 + 1)
        .read_to_end(&mut bytes)?;
    if !valid(&bytes, font) {
        return Err(std::io::Error::other("Bundled font checksum mismatch"));
    }
    // An unavailable cache must not prevent reading: retain the verified in-memory copy.
    if let (Some(dir), Some(path)) = (cache, path) {
        let _ = (|| -> std::io::Result<()> {
            std::fs::create_dir_all(dir)?;
            let mut temp = tempfile::NamedTempFile::new_in(dir)?;
            temp.write_all(&bytes)?;
            temp.as_file().sync_all()?;
            temp.persist(path).map_err(|e| e.error)?;
            Ok(())
        })();
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fonts_are_exact_cached_and_repaired() {
        let temp = tempfile::tempdir().unwrap();
        for (font, name) in PACKED.iter().zip([
            "PT_Serif-Web-Regular.ttf",
            "PT_Serif-Web-Italic.ttf",
            "PT_Serif-Web-Bold.ttf",
            "PT_Serif-Web-BoldItalic.ttf",
            "NotoEmoji.ttf",
            "NotoSansMono-Regular.ttf",
            "NotoSerifJP-Regular.ttf",
            "Literata-Regular.ttf",
            "Literata-Italic.ttf",
            "Literata-Bold.ttf",
            "Literata-BoldItalic.ttf",
        ]) {
            let expected = std::fs::read(
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("assets/fonts")
                    .join(name),
            )
            .unwrap();
            assert_eq!(load(font, Some(temp.path())).unwrap(), expected);
            // An unusable compressed payload proves a valid disk cache bypasses decompression.
            let cache_only = PackedFont {
                data: b"invalid zlib",
                length: font.length,
                hash: font.hash,
            };
            assert_eq!(load(&cache_only, Some(temp.path())).unwrap(), expected);
            let path = temp.path().join(format!("{}.ttf", font.hash));
            std::fs::write(&path, b"corrupt").unwrap();
            assert_eq!(load(font, Some(temp.path())).unwrap(), expected);
            assert_eq!(std::fs::read(path).unwrap(), expected);
        }
    }
}
