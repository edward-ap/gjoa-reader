//! Shared decoding of embedded Base64, independent of the source book format.
use base64::{
    Engine,
    engine::{
        DecodePaddingMode,
        general_purpose::{GeneralPurpose, GeneralPurposeConfig, STANDARD},
    },
};

/// Normalize whitespace, terminal padding and unused bits without guessing any
/// payload bytes. A dangling sextet (six bits, not a byte) additionally requires
/// the caller to verify that the preceding payload is already complete and valid.
/// `true` reports a repaired encoding; ordinary whitespace does not count.
pub(crate) fn decode_base64(
    encoded: &[u8],
    verify_complete: impl FnOnce(&[u8]) -> bool,
) -> crate::library::Result<(Vec<u8>, bool)> {
    let compact: Vec<_> = encoded
        .iter()
        .copied()
        .filter(|b| !b.is_ascii_whitespace())
        .collect();
    let original_error = match STANDARD.decode(&compact) {
        Ok(bytes) => return Ok((bytes, false)),
        Err(error) => error,
    };
    let data_end = compact
        .iter()
        .position(|&b| b == b'=')
        .unwrap_or(compact.len());
    if data_end == 0 || compact[data_end..].iter().any(|&b| b != b'=') {
        return Err(original_error.into());
    }
    let mut data = &compact[..data_end];
    let dangling = data.len() % 4 == 1;
    if dangling {
        let last = data[data.len() - 1];
        if data.len() < 5 || !(last.is_ascii_alphanumeric() || matches!(last, b'+' | b'/')) {
            return Err(original_error.into());
        }
        data = &data[..data.len() - 1];
    }
    let compatible = GeneralPurpose::new(
        &base64::alphabet::STANDARD,
        GeneralPurposeConfig::new()
            .with_decode_padding_mode(DecodePaddingMode::Indifferent)
            .with_decode_allow_trailing_bits(true),
    );
    let bytes = compatible.decode(data)?; // Invalid alphabet characters still fail.
    if dangling && !verify_complete(&bytes) {
        return Err(original_error.into());
    }
    Ok((bytes, true))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_encodings_produce_identical_payloads() {
        for (encoded, expected, repaired) in [
            ("TWE=", "Ma", false),
            (" T W\r\nE=\t", "Ma", false),
            ("TWE", "Ma", true),
            ("TWF=", "Ma", true),
            ("TWE===", "Ma", true),
            ("TQ", "M", true),
            ("TR==", "M", true),
            ("TWFu====", "Man", true),
        ] {
            assert_eq!(
                decode_base64(encoded.as_bytes(), |_| false).unwrap(),
                (expected.as_bytes().to_vec(), repaired),
                "{encoded}"
            );
        }
        for bad in [
            "=",
            "Q===",
            "T=WE",
            "TW@=",
            "TWFu?===",
            "TWFuQ===",
            "TWE=garbage",
            "TW-E",
        ] {
            assert!(decode_base64(bad.as_bytes(), |_| false).is_err(), "{bad}");
        }
    }
}
