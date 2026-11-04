use super::*;
use crate::reader::pdf::extraction::{PdfImage, PdfPageEvidence};
fn page(index: usize) -> PdfPageEvidence {
    PdfPageEvidence {
        index,
        width: 600.,
        height: 800.,
        rotated: false,
        chars: vec![],
        images: vec![],
        rules: vec![],
        complex_objects: 0,
        text_objects: 1,
        bookmarks: vec![],
    }
}
fn text(p: &mut PdfPageEvidence, s: &str, x: f32, y: f32, size: f32) {
    let mut x = x;
    for c in s.chars() {
        p.chars.push(PdfChar {
            index: p.chars.len(),
            text: c.to_string(),
            bounds: [x, y - size * 0.7, x + size * 0.45, y + size * 0.1],
            baseline: y,
            size,
            font: "Synthetic".into(),
            bold: false,
            italic: false,
            angle: 0.,
        });
        x += size * 0.5;
    }
}
fn evidence(pages: Vec<PdfPageEvidence>) -> PdfEvidence {
    PdfEvidence {
        metadata: Default::default(),
        pages,
        extraction_ms: 0.,
        image_ms: 0.,
    }
}
#[test]
fn dominant_ocr_bold_is_normalized_without_changing_digital_emphasis_or_italics() {
    let mut p = page(0);
    text(
        &mut p,
        "Ordinary body words on the first line",
        40.,
        80.,
        12.,
    );
    text(&mut p, "More body words on the second line", 40., 98., 12.);
    for c in &mut p.chars {
        c.bold = true;
    }
    p.chars[0].italic = true;
    let digital = reconstruct(&evidence(vec![p.clone()])).unwrap();
    p.images.push(PdfImage {
        object: 0,
        bounds: [0., 0., 600., 800.],
        background: true,
        asset: None,
    });
    let scan = reconstruct(&evidence(vec![p.clone()])).unwrap();
    let styles = |r: &Reconstruction| {
        r.model
            .blocks
            .iter()
            .flat_map(|b| match b {
                Block::Paragraph { spans, .. } => spans.iter().map(|s| s.style).collect::<Vec<_>>(),
                _ => vec![],
            })
            .collect::<Vec<_>>()
    };
    assert!(styles(&digital).iter().all(|s| s.bold));
    assert!(styles(&scan).iter().all(|s| !s.bold));
    assert!(styles(&scan).iter().any(|s| s.italic));
    assert_eq!(digital.model.text, scan.model.text);
    // Sparse emphasis in an ordinary scanned book remains emphasis.
    for (i, c) in p.chars.iter_mut().enumerate() {
        c.bold = i < 3;
    }
    assert!(
        styles(&reconstruct(&evidence(vec![p])).unwrap())
            .iter()
            .any(|s| s.bold)
    );
}
#[test]
fn geometric_order_spacing_styles_and_raised_marker() {
    let mut p = page(0);
    text(&mut p, "second line", 40., 90., 12.);
    text(&mut p, "first", 40., 60., 12.);
    text(&mut p, "word", 95., 60., 12.);
    text(&mut p, "1", 122., 55., 8.);
    p.chars.reverse();
    let (ls, _, invalid) = lines(&p);
    assert_eq!(invalid, 0);
    assert_eq!(ls.len(), 2);
    assert!(ls[0].text().starts_with("first word"));
    assert!(
        ls[0]
            .spans
            .iter()
            .any(|s| s.style.superscript && s.text.trim() == "1")
    );
    assert_eq!(ls[1].text(), "second line");
}
#[test]
fn two_columns_are_not_interleaved_and_definition_order_is_ignored() {
    let mut p = page(0);
    for i in 0..6 {
        text(
            &mut p,
            &format!("RIGHT column line {i} with prose"),
            330.,
            60. + i as f32 * 15.,
            10.,
        );
        text(
            &mut p,
            &format!("LEFT column line {i} with prose"),
            40.,
            60. + i as f32 * 15.,
            10.,
        );
    }
    let a = reconstruct(&evidence(vec![p.clone()])).unwrap();
    assert_eq!(a.assessment.two_column_pages, 1);
    assert!(
        a.model.text.find("LEFT column line 5").unwrap()
            < a.model.text.find("RIGHT column line 0").unwrap()
    );
    p.chars.reverse();
    let b = reconstruct(&evidence(vec![p])).unwrap();
    assert_eq!(
        serde_json::to_vec(&a.model).unwrap(),
        serde_json::to_vec(&b.model).unwrap()
    );
    assert_eq!(a.assessment.unexplained_difference, 0);
}
#[test]
fn recurring_headers_numbers_indent_and_cross_page_continuity() {
    let mut pages = vec![];
    for i in 0..3 {
        let mut p = page(i);
        text(&mut p, "Running book title", 40., 30., 10.);
        text(&mut p, "Paragraph continues with words", 40., 100., 12.);
        text(&mut p, "into the following page", 40., 116., 12.);
        text(&mut p, &format!("{}", i + 1), 290., 775., 10.);
        pages.push(p);
    }
    let r = reconstruct(&evidence(pages)).unwrap();
    assert_eq!(r.assessment.removed_headers, 3);
    assert_eq!(r.assessment.removed_page_numbers, 3);
    assert_eq!(r.assessment.paragraphs, 1);
    assert!(!r.model.text.contains("Running"));
    assert_eq!(r.assessment.unexplained_difference, 0);
    let mut p = page(0);
    text(&mut p, "First paragraph body", 40., 100., 12.);
    text(&mut p, "Indented new paragraph", 60., 116., 12.);
    let r = reconstruct(&evidence(vec![p])).unwrap();
    assert_eq!(r.assessment.paragraphs, 2);
}
#[test]
fn matched_notes_use_generic_model_and_unmatched_bottom_text_stays_main() {
    let mut p = page(0);
    text(&mut p, "Main reference", 40., 100., 12.);
    text(&mut p, "1", 126., 95., 8.);
    text(
        &mut p,
        "More main prose content for the book reader",
        40.,
        116.,
        12.,
    );
    text(
        &mut p,
        "1 This explanation belongs to the reference.",
        40.,
        700.,
        9.,
    );
    text(&mut p, "and continues in smaller text.", 40., 712., 9.);
    let r = reconstruct(&evidence(vec![p.clone()])).unwrap();
    assert_eq!(r.model.notes.len(), 1);
    assert_eq!(r.model.note_references.len(), 1);
    assert_eq!(r.assessment.unexplained_difference, 0);
    assert!(!r.model.notes[0].blocks.is_empty());
    p.chars.retain(|c| c.text != "1" || c.baseline > 200.);
    let r = reconstruct(&evidence(vec![p])).unwrap();
    assert!(r.model.notes.is_empty());
    assert!(r.model.text.contains("This explanation"));
}
#[test]
fn confidence_bounds_duplicates_images_and_low_quality() {
    let mut p = page(0);
    text(
        &mut p,
        &"Ordinary prose with a reliable text layer. ".repeat(3),
        40.,
        100.,
        10.,
    );
    let r = reconstruct(&evidence(vec![p.clone()])).unwrap();
    assert_eq!(r.assessment.confidence, Confidence::High);
    p.images.push(PdfImage {
        object: 0,
        bounds: [0., 0., 600., 800.],
        background: true,
        asset: None,
    });
    let r = reconstruct(&evidence(vec![p.clone()])).unwrap();
    assert_eq!(r.assessment.confidence, Confidence::Medium);
    assert!(
        !r.model
            .blocks
            .iter()
            .any(|b| matches!(b, Block::Image { .. }))
    );
    p.chars.extend(p.chars.clone());
    let r = reconstruct(&evidence(vec![p])).unwrap();
    assert_eq!(r.assessment.confidence, Confidence::Low);
    assert!(r.assessment.duplicate_ratio > 0.4);
    assert_eq!(r.assessment.unexplained_difference, 0);
    let r = reconstruct(&evidence(vec![page(0)])).unwrap();
    assert_eq!(r.assessment.confidence, Confidence::Unsupported);
}

#[test]
fn localized_columns_preserve_surrounding_full_width_prose() {
    let mut p = page(0);
    text(
        &mut p,
        "Before the two column passage starts",
        40.,
        100.,
        12.,
    );
    for i in 0..4 {
        text(
            &mut p,
            &format!("Left {i}"),
            60.,
            140. + i as f32 * 15.,
            12.,
        );
        text(
            &mut p,
            &format!("Right {i}"),
            190.,
            140. + i as f32 * 15.,
            12.,
        );
    }
    text(
        &mut p,
        "After both columns finish the story continues",
        40.,
        220.,
        12.,
    );
    let r = reconstruct(&evidence(vec![p])).unwrap();
    assert_eq!(r.assessment.two_column_pages, 1);
    let text = &r.model.text;
    assert!(text.find("Before").unwrap() < text.find("Left 0").unwrap());
    assert!(text.find("Left 3").unwrap() < text.find("Right 0").unwrap());
    assert!(text.find("Right 3").unwrap() < text.find("After").unwrap());
}

#[test]
fn line_end_hyphen_requires_soft_hyphen_or_independent_word_evidence() {
    let mut p = page(0);
    text(&mut p, "A reconstruction explains extra-", 40., 100., 12.);
    text(&mut p, "ordinary meaning", 40., 116., 12.);
    text(
        &mut p,
        "Independent extraordinary evidence.",
        40.,
        150.,
        12.,
    );
    let r = reconstruct(&evidence(vec![p.clone()])).unwrap();
    assert!(r.model.text.contains("explains extraordinary meaning"));
    assert_eq!(r.assessment.dehyphenations, 1);
    assert_eq!(r.assessment.unexplained_difference, 0);
    p.chars.retain(|c| c.baseline < 140.);
    let r = reconstruct(&evidence(vec![p])).unwrap();
    assert!(r.model.text.contains("extra- ordinary"));
    assert_eq!(r.assessment.dehyphenations, 0);
}

#[test]
fn note_continuation_and_ambiguous_labels_do_not_drop_text() {
    let mut first = page(0);
    text(&mut first, "Main reference", 40., 100., 12.);
    text(&mut first, "1", 126., 95., 8.);
    text(
        &mut first,
        "More main prose to establish the body font",
        40.,
        116.,
        12.,
    );
    text(&mut first, "1 A long note continues with", 40., 740., 9.);
    let mut second = page(1);
    text(
        &mut second,
        "The next page has its own main prose",
        40.,
        100.,
        12.,
    );
    text(
        &mut second,
        "further explanation ending here.",
        40.,
        700.,
        9.,
    );
    let r = reconstruct(&evidence(vec![first.clone(), second])).unwrap();
    assert_eq!(r.model.notes.len(), 1);
    assert_eq!(r.model.note_references.len(), 1);
    let note = &r.model.notes[0];
    let serialized = serde_json::to_string(note).unwrap();
    assert!(!serialized.is_empty());
    assert_eq!(r.assessment.unexplained_difference, 0);
    assert!(
        r.model.text.find("further explanation").unwrap() > r.model.text.find("next page").unwrap()
    );
    text(
        &mut first,
        "1 Another equally plausible note.",
        40.,
        720.,
        9.,
    );
    let r = reconstruct(&evidence(vec![first])).unwrap();
    assert!(r.model.notes.is_empty());
    assert_eq!(r.assessment.unexplained_difference, 0);
}
