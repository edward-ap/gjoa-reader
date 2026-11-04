//! Opt-in external compatibility fixtures. No private books are shipped.
//! Default cargo test runs self-contained synthetic tests. Corpus regressions
//! remain visible as ignored tests and require an explicit absolute directory.
use std::path::PathBuf;

pub(crate) fn directory() -> PathBuf {
    let root = PathBuf::from(std::env::var_os("GJOA_TEST_CORPUS_DIR").expect(
        "External corpus not supplied: set GJOA_TEST_CORPUS_DIR to an absolute read-only fixture directory",
    ));
    assert!(root.is_absolute(), "GJOA_TEST_CORPUS_DIR must be absolute");
    assert!(
        root.is_dir(),
        "GJOA_TEST_CORPUS_DIR must be an existing directory"
    );
    root
}
