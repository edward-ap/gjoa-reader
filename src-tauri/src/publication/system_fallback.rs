//! Publication-only native font services. Runtime consumes persisted masks instead.
use super::model::Style;
#[derive(Clone)]
pub struct FallbackRequest<'a> {
    pub text: &'a str,
    pub size: f32,
    pub style: Style,
}
#[derive(Clone, Debug)]
pub struct NativeGlyph {
    pub start: usize,
    pub end: usize,
    pub x: f32,
    pub y: f32,
    pub advance: f32,
    pub width: u32,
    pub height: u32,
    pub mask: Vec<u8>,
    pub rgba: Option<Vec<u8>>,
    pub family: String,
    pub glyph_id: u16,
    pub missing: bool,
}
#[derive(Clone, Debug)]
pub struct FallbackResult {
    pub advance: f32,
    pub glyphs: Vec<NativeGlyph>,
}
pub trait SystemFontFallbackProvider {
    fn resolve_and_render(
        &mut self,
        request: FallbackRequest<'_>,
    ) -> Result<FallbackResult, String>;
}
#[cfg(test)]
thread_local! { pub static FORBID:std::cell::Cell<bool> = const {std::cell::Cell::new(false)}; }
pub fn provider() -> Box<dyn SystemFontFallbackProvider> {
    #[cfg(test)]
    FORBID.with(|v| assert!(!v.get(), "Runtime accessed system fallback"));
    #[cfg(windows)]
    {
        Box::new(super::directwrite::DirectWriteSystemFallback::default())
    }
    #[cfg(not(windows))]
    {
        Box::new(Unavailable)
    }
}
#[cfg(not(windows))]
struct Unavailable;
#[cfg(not(windows))]
impl SystemFontFallbackProvider for Unavailable {
    fn resolve_and_render(&mut self, _: FallbackRequest<'_>) -> Result<FallbackResult, String> {
        Err("No native fallback provider on this platform".into())
    }
}
