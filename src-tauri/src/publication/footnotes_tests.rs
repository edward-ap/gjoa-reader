use super::*;
use crate::reader::{
    document::{PageAppearance, RenderRequest},
    registry::FormatRegistry,
};
use typography::{Item, PageLayout};
fn xml(main: &str, notes: &str) -> String {
    format!(
        "<FictionBook xmlns='http://www.gribuser.ru/xml/fictionbook/2.0'><description><title-info><book-title>Footnotes</book-title></title-info></description><body>{main}</body><body name='notes'>{notes}</body></FictionBook>"
    )
}
fn note(id: &str, label: &str, body: &str) -> String {
    format!("<section id='{id}'><title><p>{label}</p></title>{body}</section>")
}
fn prepared(xml: &str, temp: &tempfile::TempDir) -> Prepared {
    let input = temp.path().join("input.fb2");
    std::fs::write(&input, xml).unwrap();
    let source = crate::library::store::hash_reader(xml.as_bytes()).unwrap();
    let staging = temp.path().join("staging");
    std::fs::create_dir_all(&staging).unwrap();
    let registry = FormatRegistry::default();
    let handler = registry.detect(&input).unwrap();
    // These tests inspect Legacy optimizer traces; keep that baseline explicit.
    let directory = tempfile::tempdir_in(&staging).unwrap();
    let mut manifest = manifest(&source, handler).unwrap();
    manifest.publisher_version = 16;
    fb2::publish(&input, directory.path(), &mut manifest).unwrap();
    manifest.page_count = manifest.pages.len();
    manifest.edition_id = identity_manifest(&manifest);
    Prepared {
        manifest,
        directory: Some(directory),
        thumbnail: vec![],
        installed_fonts: vec![],
    }
}
fn model(p: &Prepared) -> model::Publication {
    serde_json::from_slice(
        &std::fs::read(
            p.directory
                .as_ref()
                .unwrap()
                .path()
                .join("publication.json"),
        )
        .unwrap(),
    )
    .unwrap()
}
fn pages(p: &Prepared) -> Vec<PageLayout> {
    let root = p.directory.as_ref().unwrap().path();
    p.manifest
        .page_files
        .iter()
        .map(|f| storage::read_layout(root, f, p.manifest.storage_version).unwrap())
        .collect()
}
fn range(item: &Item) -> Option<(usize, usize)> {
    match item {
        Item::GlyphRun {
            source_start,
            source_end,
            ..
        }
        | Item::RasterGlyph {
            source_start,
            source_end,
            ..
        } => Some((*source_start, *source_end)),
        _ => None,
    }
}
#[test]
fn short_notes_semantics_order_broken_nested_and_determinism() {
    let temp = tempfile::tempdir().unwrap();
    let source = xml(
        "<section><annotation><p>Annotation remains main text.</p></annotation><p>Main <a href='#three'>[3]</a> <a type='note' href='#one'>[1]</a> repeated <a href='#three'>[3]</a> <a href='#two'>[2]</a> <a type='note' href='#missing'>?</a> <a href='#chapter'>Chapter link</a></p><p id='chapter'>End.</p></section>",
        &(note(
            "one",
            "1",
            "<p>First <strong>bold</strong> <emphasis>italic</emphasis> note.</p>",
        ) + &note("two", "2", "<p>Second note.</p>")
            + &note(
                "three",
                "3",
                "<p>Third note <a type='note' href='#three'>[3]</a>.</p>",
            )
            + &note("orphan", "9", "<p>Orphan semantic text.</p>")),
    );
    optimizer::capture_trace(true);
    let first = prepared(&source, &temp);
    let trace = optimizer::take_trace().unwrap();
    let book = model(&first);
    assert_eq!(book.notes.len(), 4);
    assert_eq!(book.note_references.len(), 5);
    assert!(!book.blocks.iter().any(|b|matches!(b,model::Block::Paragraph{start,end,..}if book.text[*start..*end].contains("Orphan"))));
    assert!(book.text.contains("Orphan semantic text"));
    assert_eq!(trace.note_pages[0].visible_refs, ["three", "one", "two"]);
    assert_eq!(trace.note_pages[0].slices.len(), 3);
    assert!(trace.note_pages[0].height < 200.);
    assert_eq!(trace.note_pages.len(), 1);
    assert!(
        first
            .manifest
            .import_warnings
            .iter()
            .any(|w| w.contains("missing"))
    );
    assert!(
        first
            .manifest
            .import_warnings
            .iter()
            .any(|w| w.contains("unreferenced"))
    );
    assert!(
        first
            .manifest
            .import_warnings
            .iter()
            .any(|w| w.contains("cyclic"))
    );
    let second = prepared(&source, &temp);
    assert_eq!(
        serde_json::to_vec(&first.manifest).unwrap(),
        serde_json::to_vec(&second.manifest).unwrap()
    );
    assert_eq!(
        serde_json::to_vec(&pages(&first)).unwrap(),
        serde_json::to_vec(&pages(&second)).unwrap()
    );
    let root = first.directory.as_ref().unwrap().path();
    let doc = open_payload(root, &first.manifest).unwrap();
    let request = RenderRequest {
        width: 800,
        height: 1120,
    };
    let original = doc
        .render_with_appearance(0, request, PageAppearance::Original)
        .unwrap();
    for appearance in [PageAppearance::Sepia, PageAppearance::Night] {
        assert_ne!(
            original.rgba,
            doc.render_with_appearance(0, request, appearance)
                .unwrap()
                .rgba
        );
    }
    let parses = fb2::PARSES.with(|n| n.get());
    let typesets = typography::TYPESETS.with(|n| n.get());
    drop(doc);
    std::fs::remove_file(temp.path().join("input.fb2")).unwrap();
    let reopened = open_payload(root, &first.manifest).unwrap();
    assert_eq!(
        original.rgba,
        reopened.render_page(0, request).unwrap().rgba
    );
    assert_eq!(parses, fb2::PARSES.with(|n| n.get()));
    assert_eq!(typesets, typography::TYPESETS.with(|n| n.get()));
}
#[test]
fn huge_note_pauses_main_flow_and_chapter_until_last_continuation_page() {
    let temp = tempfile::tempdir().unwrap();
    let long = "Scholarly note text continues with exact source coverage. ".repeat(750);
    let source = xml(
        "<section><title><p>Chapter One</p></title><p>Main reference <a type='note' href='#long'>[17]</a>.</p><p>RESUMEHERE</p></section><section><title><p>CHAPTERTWO</p></title><p>New chapter text.</p></section>",
        &note("long", "17", &format!("<p>{long}</p>")),
    );
    optimizer::capture_trace(true);
    let p = prepared(&source, &temp);
    let trace = optimizer::take_trace().unwrap();
    let book = model(&p);
    let layouts = pages(&p);
    let continuation: Vec<_> = trace.note_pages.iter().filter(|p| p.continuation).collect();
    assert!(continuation.len() >= 2);
    for page in &continuation {
        assert!(page.main_placements.is_empty());
        for slice in &page.slices {
            assert!(slice.end > slice.start);
        }
    }
    let resume = book.text.find("RESUMEHERE").unwrap();
    let chapter = book.text.find("CHAPTERTWO").unwrap();
    // The main page may already contain RESUMEHERE before continuation begins.
    // A later chapter must always follow the last continuation on a fresh page.
    let chapter_page = layouts
        .iter()
        .position(|p| {
            p.items
                .iter()
                .filter_map(range)
                .any(|(a, b)| a <= chapter && b > chapter)
        })
        .unwrap()
        + 1;
    assert!(chapter_page > continuation.last().unwrap().page);
    for page in continuation {
        assert!(
            !layouts[page.page - 1]
                .items
                .iter()
                .filter_map(range)
                .any(|(a, b)| a <= resume && b > resume)
        );
    }
    let start = book.text.find("Scholarly").unwrap();
    let end = start + long.trim().len();
    let mut seen = vec![false; end - start];
    for page in &layouts {
        for item in &page.items {
            if let Item::GlyphRun { glyphs, .. } = item {
                for g in glyphs {
                    let a = g.3.max(start);
                    let b = g.4.min(end);
                    if a < b {
                        seen[a - start..b - start].fill(true);
                    }
                }
            }
        }
    }
    for (i, c) in book.text[start..end].char_indices() {
        if !c.is_whitespace() {
            assert!(seen[i]);
        }
    }
    let mut previous = 0;
    for page in &trace.note_pages {
        for s in &page.slices {
            assert_eq!(s.start, previous);
            previous = s.end;
        }
    }
}
#[test]
fn later_references_do_not_strand_main_text_above_long_note() {
    let temp = tempfile::tempdir().unwrap();
    let main = format!(
        "<section><title><p>Episode <a href='#a'>[1]</a></p></title>{}</section>",
        "<p>Main narrative continues <a href='#b'>[2]</a> with more text.</p>".repeat(30)
    );
    let source = xml(
        &main,
        &(note(
            "a",
            "1",
            &format!("<p>{}</p>", "Long explanation continues. ".repeat(400)),
        ) + &note("b", "2", "<p>Second explanation.</p>")),
    );
    optimizer::capture_trace(true);
    let prepared = prepared(&source, &temp);
    let trace = optimizer::take_trace().unwrap();
    let first = &trace.note_pages[0];
    assert_eq!(first.visible_refs, ["a", "b"]);
    assert!(
        first.main_placements.len() > 10,
        "Narrative must fill space above notes"
    );
    assert!(first.main_placements.last().unwrap().y > 500.);
    assert!(
        first
            .pending
            .iter()
            .any(|(id, offset)| id == "b" && *offset == 0)
    );
    assert!(
        trace
            .note_pages
            .iter()
            .any(|p| p.continuation && p.slices.iter().any(|s| s.note == 1))
    );
    assert!(
        trace
            .note_pages
            .iter()
            .filter(|p| p.continuation)
            .all(|p| p.main_placements.is_empty())
    );
    let layouts = pages(&prepared);
    assert!(
        layouts[0]
            .items
            .iter()
            .any(|i| matches!(i, Item::Rule { bounds } if bounds[0] == 72. && bounds[2] == 656.))
    );
}

#[test]
fn near_bottom_reference_moves_with_initial_note() {
    let temp = tempfile::tempdir().unwrap();
    let before = "<p>Short main line.</p>".repeat(27);
    let source = xml(
        &format!("<section>{before}<p>MARKER <a href='#n'>[1]</a></p></section>"),
        &note(
            "n",
            "1",
            &format!(
                "<p>{}</p>",
                "Two lines of note content and explanation. ".repeat(4)
            ),
        ),
    );
    optimizer::capture_trace(true);
    let p = prepared(&source, &temp);
    let trace = optimizer::take_trace().unwrap();
    let t = &trace.note_pages[0];
    assert!(t.page >= 2);
    assert!(t.height < 384.);
    assert!(t.slices[0].end >= 2);
    let book = model(&p);
    let marker = book.text.find("MARKER").unwrap();
    let layouts = pages(&p);
    assert!(
        layouts[t.page - 1]
            .items
            .iter()
            .filter_map(range)
            .any(|(a, b)| a <= marker && b > marker)
    );
}

#[test]
fn production_v22_long_notes_preserve_continuation_only_pages() {
    let temp = tempfile::tempdir().unwrap();
    let long = "Scholarly note text continues. ".repeat(750);
    let source = xml(
        "<section><p>Main <a type='note' href='#long'>[17]</a>.</p></section><section><title><p>CHAPTERTWO</p></title><p>New chapter.</p></section>",
        &note("long", "17", &format!("<p>{long}</p>")),
    );
    let input = temp.path().join("current.fb2");
    std::fs::write(&input, &source).unwrap();
    let registry = FormatRegistry::default();
    let p = prepare(
        &crate::library::store::hash_reader(source.as_bytes()).unwrap(),
        registry.detect(&input).unwrap(),
        &input,
        temp.path(),
    )
    .unwrap();
    assert_eq!(p.manifest.publisher_version, CURRENT_PUBLISHER_VERSION);
    assert!(p.manifest.importer_id.is_none());
    let book = model(&p);
    let layouts = pages(&p);
    let note_start = book.text.find("Scholarly").unwrap();
    let chapter = book.text.find("CHAPTERTWO").unwrap();
    let note_pages: Vec<_> = layouts
        .iter()
        .enumerate()
        .filter(|(_, p)| {
            p.items
                .iter()
                .filter_map(range)
                .any(|(a, _)| a >= note_start)
        })
        .collect();
    assert!(note_pages.len() >= 3);
    for (_, page) in note_pages.iter().skip(1) {
        assert!(
            !page
                .items
                .iter()
                .filter_map(range)
                .any(|(a, b)| (a < 4 && b > a) || (a <= chapter && chapter < b))
        );
    }
    let chapter_page = layouts
        .iter()
        .position(|p| {
            p.items
                .iter()
                .filter_map(range)
                .any(|(a, b)| a <= chapter && chapter < b)
        })
        .unwrap();
    assert!(chapter_page > note_pages.last().unwrap().0);
}
