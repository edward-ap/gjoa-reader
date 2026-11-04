//! Independently generated, copyright-free JB2 v21 reset regression streams.
use super::*;

#[test]
fn compat_high_resolution_packed_canvas_retains_finite_limits() {
    use crate::{Jb2Error, decode_downsampled, decode_indexed};
    let blank = |w, h| {
        let mut zp = ZpEncoder::new();
        let mut record = NumContext::new();
        let mut size = NumContext::new();
        let mut flag = 0;
        encode_num(&mut zp, &mut record, 0, 11, 0);
        encode_num(&mut zp, &mut size, 0, 262142, w);
        encode_num(&mut zp, &mut size, 0, 262142, h);
        zp.encode_bit(&mut flag, false);
        encode_num(&mut zp, &mut record, 0, 11, 11);
        zp.finish()
    };
    let bytes = blank(7436, 9307);
    let reduced = decode_downsampled(&bytes, None, 3).unwrap();
    assert_eq!((reduced.width, reduced.height), (930, 1164));
    assert!(matches!(
        decode_indexed(&bytes, None),
        Err(Jb2Error::ImageTooLarge)
    ));
    assert!(matches!(
        decode_downsampled(&blank(10000, 11000), None, 3),
        Err(Jb2Error::ImageTooLarge)
    ));
}

fn glyph(w: u32, h: u32) -> Bitmap {
    let mut bitmap = Bitmap::new(w, h);
    for y in 0..h {
        for x in 0..w {
            bitmap.set(x, y, x == 0 || y == h - 1 || (x + y) % 3 == 0);
        }
    }
    bitmap
}

fn reset_fixture(dictionary: bool, reset: bool) -> (Vec<u8>, Bitmap) {
    let mut zp = ZpEncoder::new();
    let mut record = NumContext::new();
    let mut size = NumContext::new();
    let mut width = NumContext::new();
    let mut height = NumContext::new();
    let mut hoff = NumContext::new();
    let mut voff = NumContext::new();
    let mut shoff = NumContext::new();
    let mut svoff = NumContext::new();
    let mut index = NumContext::new();
    let mut comment_length = NumContext::new();
    let mut comment_octet = NumContext::new();
    let mut flag = 0;
    let mut offset = 0;
    let mut bitmap_contexts = [0; 1024];
    let mut expected = Bitmap::new(24, 16);
    encode_num(&mut zp, &mut record, 0, 11, 0);
    encode_num(
        &mut zp,
        &mut size,
        0,
        262142,
        if dictionary { 0 } else { 24 },
    );
    encode_num(
        &mut zp,
        &mut size,
        0,
        262142,
        if dictionary { 0 } else { 16 },
    );
    zp.encode_bit(&mut flag, false);
    for n in 0..2 {
        if n == 1 && reset {
            encode_num(&mut zp, &mut record, 0, 11, 9);
            // Encode according to the format, independently of decoder.reset().
            record = NumContext::new();
            width = NumContext::new();
            height = NumContext::new();
            hoff = NumContext::new();
            voff = NumContext::new();
            shoff = NumContext::new();
            svoff = NumContext::new();
            index = NumContext::new();
            comment_length = NumContext::new();
            comment_octet = NumContext::new();
            // Keep ZP registers, bitmap contexts and the binary offset flag.
        }
        encode_num(&mut zp, &mut record, 0, 11, 10);
        encode_num(&mut zp, &mut comment_length, 0, 262142, 3);
        for value in [b'J', b'B', b'2'] {
            encode_num(&mut zp, &mut comment_octet, 0, 255, value as i32);
        }
        let bm = if n == 0 { glyph(3, 5) } else { glyph(4, 4) };
        encode_num(&mut zp, &mut record, 0, 11, if dictionary { 2 } else { 1 });
        encode_num(&mut zp, &mut width, 0, 262142, bm.width as i32);
        encode_num(&mut zp, &mut height, 0, 262142, bm.height as i32);
        encode_bitmap_direct(&mut zp, &mut bitmap_contexts, &bm);
        if !dictionary {
            zp.encode_bit(&mut offset, n == 0);
            if n == 0 {
                encode_num(&mut zp, &mut hoff, -262143, 262142, 1);
                encode_num(&mut zp, &mut voff, -262143, 262142, 0);
            } else {
                encode_num(&mut zp, &mut shoff, -262143, 262142, 5);
                encode_num(&mut zp, &mut svoff, -262143, 262142, 0);
            }
            for y in 0..bm.height {
                for x in 0..bm.width {
                    expected.set(
                        if n == 0 { x } else { x + 7 },
                        if n == 0 { y } else { y + 1 },
                        bm.get(x, y),
                    );
                }
            }
        }
    }
    if !dictionary {
        // A pre-reset library symbol remains available after reset.
        encode_num(&mut zp, &mut record, 0, 11, 7);
        encode_num(&mut zp, &mut index, 0, 1, 0);
        zp.encode_bit(&mut offset, false);
        encode_num(&mut zp, &mut shoff, -262143, 262142, 4);
        encode_num(&mut zp, &mut svoff, -262143, 262142, 0);
        let bm = glyph(3, 5);
        for y in 0..bm.height {
            for x in 0..bm.width {
                expected.set(x + 14, y, bm.get(x, y));
            }
        }
    }
    encode_num(&mut zp, &mut record, 0, 11, 11);
    (zp.finish(), expected)
}

#[test]
fn compat_reset_retains_pixels_library_and_coordinates_in_all_image_paths() {
    let (stream, expected) = reset_fixture(false, true);
    let (control, _) = reset_fixture(false, false);
    assert!(stream.len() < 100);
    for bytes in [&stream, &control] {
        let mask = crate::decode(bytes, None).unwrap();
        assert_eq!((mask.width, mask.height), (24, 16));
        assert_eq!(mask.data, expected.data);
        let (indexed, indices) = crate::decode_indexed(bytes, None).unwrap();
        assert_eq!(indexed.data, expected.data);
        assert_eq!(indices[14], 2);
        for shift in [1, 2] {
            let reduced = crate::decode_downsampled(bytes, None, shift).unwrap();
            for y in 0..reduced.height {
                for x in 0..reduced.width {
                    let factor = 1 << shift;
                    let black = (0..factor).any(|dy| {
                        (0..factor).any(|dx| expected.get(x * factor + dx, y * factor + dy))
                    });
                    assert_eq!(reduced.get(x, y), black);
                }
            }
        }
    }
}

#[test]
fn compat_dictionary_reset_keeps_both_symbols() {
    let (reset, _) = reset_fixture(true, true);
    let (control, _) = reset_fixture(true, false);
    let dict = crate::decode_dict(&reset, None).unwrap();
    let expected = crate::decode_dict(&control, None).unwrap();
    assert_eq!(dict.symbols.len(), 2);
    for (actual, expected) in dict.symbols.iter().zip(&expected.symbols) {
        assert_eq!(
            (actual.width, actual.height),
            (expected.width, expected.height)
        );
        assert_eq!(actual.data, expected.data);
    }
}

#[test]
fn compat_reset_does_not_reset_record_work_limit() {
    let mut zp = ZpEncoder::new();
    let mut record = NumContext::new();
    let mut size = NumContext::new();
    encode_num(&mut zp, &mut record, 0, 11, 0);
    encode_num(&mut zp, &mut size, 0, 262142, 1);
    encode_num(&mut zp, &mut size, 0, 262142, 1);
    zp.encode_bit(&mut 0, false);
    for _ in 0..crate::MAX_RECORDS + 1 {
        encode_num(&mut zp, &mut record, 0, 11, 9);
        record = NumContext::new();
    }
    encode_num(&mut zp, &mut record, 0, 11, 11);
    assert!(matches!(
        crate::decode(&zp.finish(), None),
        Err(crate::Jb2Error::TooManyRecords)
    ));
}

#[test]
fn compat_symbol_budgets_bound_small_streams_overflow_and_large_components() {
    use crate::{Jb2Error, SymbolBudget, check_pixel_budget, page_symbol_budget};
    for bytes in [0, 1, 1024, 32768] {
        assert_eq!(page_symbol_budget(bytes).total, 16 * 1024 * 1024);
    }
    assert_eq!(page_symbol_budget(65536).total, 32 * 1024 * 1024);
    for bytes in [131072, usize::MAX] {
        assert_eq!(page_symbol_budget(bytes).total, 64 * 1024 * 1024);
    }
    assert_eq!(
        check_pixel_budget(3754, 5115, &mut 0, page_symbol_budget(1024)),
        Err(Jb2Error::ImageTooLarge)
    );
    let mut total = 0;
    let budget = page_symbol_budget(139079);
    assert!(check_pixel_budget(3754, 5115, &mut total, budget).is_ok());
    assert!(
        check_pixel_budget(8192, 8192, &mut total, budget).is_err(),
        "cumulative cap is enforced before allocation"
    );
    assert!(
        check_pixel_budget(i32::MAX, i32::MAX, &mut 0, page_symbol_budget(usize::MAX)).is_err()
    );
    let dictionary = SymbolBudget {
        per_symbol: 16 * 1024 * 1024,
        total: 256 * 1024 * 1024,
    };
    assert!(
        check_pixel_budget(3754, 5115, &mut 0, dictionary).is_err(),
        "dictionary allocation limit unchanged"
    );
}
