use super::format::{DocumentFormatHandler, FormatId, ProbeResult, PublicationKind};
pub const CBR: FormatId = FormatId("cbr");
pub const FB2: FormatId = FormatId("fb2");
pub struct CbrFormatHandler;
impl DocumentFormatHandler for CbrFormatHandler {
    fn format_id(&self) -> FormatId {
        CBR
    }
    fn filter_name(&self) -> &'static str {
        "CBR comics"
    }
    fn supported_extensions(&self) -> &'static [&'static str] {
        &["cbr"]
    }
    fn publication_kind(&self) -> PublicationKind {
        PublicationKind::ExtractedImages
    }
    fn probe(&self, header: &[u8]) -> ProbeResult {
        if header.starts_with(b"Rar!\x1a\x07\x00") || header.starts_with(b"Rar!\x1a\x07\x01\x00") {
            ProbeResult::Supported
        } else if header.starts_with(b"Rar!") {
            ProbeResult::Malformed("invalid RAR signature")
        } else {
            ProbeResult::NotMine
        }
    }
}
pub struct Fb2FormatHandler;
impl DocumentFormatHandler for Fb2FormatHandler {
    fn format_id(&self) -> FormatId {
        FB2
    }
    fn filter_name(&self) -> &'static str {
        "FictionBook books"
    }
    fn supported_extensions(&self) -> &'static [&'static str] {
        &["fb2"]
    }
    fn publication_kind(&self) -> PublicationKind {
        PublicationKind::GeneratedLayout
    }
    fn probe(&self, header: &[u8]) -> ProbeResult {
        let header = header.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(header);
        let first = header.iter().find(|byte| !byte.is_ascii_whitespace());
        if first == Some(&b'<') || (first.is_none() && header.len() >= 13) {
            ProbeResult::Candidate
        } else {
            ProbeResult::NotMine
        }
    }
    fn deep_probe(&self, header: &[u8]) -> ProbeResult {
        // A truncated UTF-8 code point at the end of a bounded prefix is harmless.
        let text = String::from_utf8_lossy(header);
        for token in xmlparser::Tokenizer::from(text.trim_start_matches('\u{feff}')) {
            match token {
                Ok(xmlparser::Token::ElementStart { local, .. }) => {
                    return if local.as_str() == "FictionBook" {
                        ProbeResult::Supported
                    } else {
                        ProbeResult::NotMine
                    };
                }
                Ok(xmlparser::Token::DtdStart { .. } | xmlparser::Token::EmptyDtd { .. }) => {
                    return ProbeResult::Malformed("DTD is not allowed");
                }
                Err(_) => return ProbeResult::NotMine,
                _ => {}
            }
        }
        ProbeResult::NotMine
    }
}
