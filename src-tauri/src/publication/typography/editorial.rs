//! Source-neutral editorial scale. Enabled only for new publisher editions.
use super::*;
use std::borrow::Cow;

pub(super) fn metrics(model: &Publication, start: usize, kind: ParagraphKind) -> (f32, f32, bool) {
    match kind {
        ParagraphKind::Heading => {
            let level = model
                .structure
                .iter()
                .find_map(|s| match model.blocks.get(s.block) {
                    Some(Block::Paragraph { start: at, .. }) if *at == start => s.heading_level,
                    _ => None,
                })
                .unwrap_or(1);
            match level {
                0 | 1 => (26., 34., false),
                2 => (22., 30., false),
                _ => (20., 29., true),
            }
        }
        ParagraphKind::Subtitle => (18., 27., true),
        _ => (19., 28., false),
    }
}

pub(super) fn spans<'a>(spans: &'a [Span], kind: ParagraphKind, italic: bool) -> Cow<'a, [Span]> {
    if !matches!(kind, ParagraphKind::Heading | ParagraphKind::Subtitle) {
        return Cow::Borrowed(spans);
    }
    Cow::Owned(
        spans
            .iter()
            .map(|s| {
                let mut s = s.clone();
                s.style.bold = false;
                s.style.italic = italic;
                s
            })
            .collect(),
    )
}

pub(crate) const NOTE_RULE_WIDTH: f32 = (RIGHT - LEFT) * 0.28;
pub(super) fn finish_page(page: &mut PageLayout) {
    if let Some(Item::Rule { bounds }) = page.items.iter_mut().rfind(|item| matches!(item,
        Item::Rule { bounds } if bounds[0] == LEFT && bounds[2] == FOOTNOTE_STYLE.separator_width && bounds[3] == 0.75)) {
        bounds[2] = NOTE_RULE_WIDTH;
        bounds[3] = 0.5;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{publication, reader::registry::FormatRegistry};
    #[test]
    fn editorial_hierarchy_and_notes_use_semantics_without_changing_source_text() {
        let xml = r##"<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><book-title>Editorial proof</book-title></title-info></description><body><section><title><p>Chapter</p></title><p>Body <strong>bold</strong>, <emphasis>italic</emphasis>, Grace a Dieu<a l:href="#n" type="note">[985]</a>.</p><section><title><p>Section</p></title><section><title><p>Detail</p></title><subtitle>Subtitle</subtitle><p>Another paragraph.</p></section></section></section></body><body name="notes"><section id="n"><title><p>985</p></title><p>A regular note.</p></section></body></FictionBook>"##;
        let temp = tempfile::tempdir().unwrap();
        let input = temp.path().join("editorial.fb2");
        std::fs::write(&input, xml).unwrap();
        let registry = FormatRegistry::default();
        let prepared = publication::prepare(
            &crate::library::store::hash_reader(xml.as_bytes()).unwrap(),
            registry.detect(&input).unwrap(),
            &input,
            temp.path(),
        )
        .unwrap();
        let root = prepared.directory.as_ref().unwrap().path();
        let model: Publication =
            serde_json::from_slice(&std::fs::read(root.join("publication.json")).unwrap()).unwrap();
        let pages = prepared
            .manifest
            .page_files
            .iter()
            .map(|f| {
                publication::storage::read_layout(root, f, prepared.manifest.storage_version)
                    .unwrap()
            })
            .collect::<Vec<_>>();
        for (text, size, font) in [
            ("Chapter", 26., 0),
            ("Section", 22., 0),
            ("Detail", 20., 1),
            ("Subtitle", 18., 1),
            ("Body", 19., 0),
            ("bold", 19., 2),
            ("italic", 19., 1),
            ("Grace", 19., 0),
            ("A regular note.", 15., 0),
        ] {
            let offset = model.text.find(text).unwrap();
            assert!(pages.iter().flat_map(|p| &p.items).any(|item| matches!(item, Item::GlyphRun { size: s, font: f, glyphs, .. } if *s == size && *f == font && glyphs.iter().any(|g| g.3 <= offset && offset < g.4))), "Unexpected style for {text}");
        }
        let page = pages
            .iter()
            .find(|page| {
                page.items
                    .iter()
                    .any(|i| matches!(i, Item::Rule { bounds } if bounds[2] == NOTE_RULE_WIDTH))
            })
            .unwrap();
        assert!(page.items.iter().any(
            |i| matches!(i, Item::GlyphRun { size, font: 0, .. } if (*size - 13.8).abs() < 0.02)
        ));
        let doc = publication::open_payload(root, &prepared.manifest).unwrap();
        for index in 0..doc.page_count() {
            doc.render_page(
                index,
                crate::reader::document::RenderRequest {
                    width: WIDTH,
                    height: HEIGHT,
                },
            )
            .unwrap();
        }
    }
}
