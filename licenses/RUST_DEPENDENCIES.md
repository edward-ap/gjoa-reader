# Rust dependency licenses and notices

This directory preserves third-party license/NOTICE/copyright texts from the verified dependency inventory. It does not relicense those components under the application MIT license. No license branch is selected here: where upstream offers alternatives, all supplied text is retained; where terms use AND, both terms remain applicable.

## Scope

The audited exact Windows x64 custom-protocol metadata graph contains334 packages including the application:333 third-party packages are represented in rust/manifest.json. Of those,312 are reachable by normal edges,333 by normal/build edges and333 by the test graph. These are metadata graph counts, including host/proc-macro and feature-unified dependencies; they do not prove that every package is physically present in the release executable. The complete cross-platform Cargo.lock contains516 packages; this notice preparation is the Windows graph only.

- rust/manifest.json records exact versions, upstream declarations/repositories/source archive URLs/checksums, scope flags and SHA-256 of each included file. No local registry/user-home path is included.
- rust/<package>-<version>/ contains verbatim root-level upstream license/NOTICE/copyright files present in the verified evidence.579 text files are preserved, including two native UnRAR notices.
- [SOURCE_AVAILABILITY.md](SOURCE_AVAILABILITY.md) and [mpl-sources.json](mpl-sources.json) identify the five included exact MPL source archives. Their bytes match Cargo.lock registry checksums.
- The application own license is the root LICENSE. Native PDFium, fonts, UI extensions and other assets have separate notices elsewhere; this Rust inventory is not their license.

## Additional native UnRAR conditions

unrar/unrar_sys0.5.8 Cargo declarations are MIT OR Apache-2.0 for the wrappers. unrar_sys also compiles native UnRAR7.1 C++ code into a static library. Its custom license remains separate, including restrictions on RAR-compatible archiver/compression-algorithm recreation and special modified-source notice conditions. The application uses extraction; no violation is inferred merely from this usage. Do not describe the full executable as MIT-only.

Preserved verbatim:
- [UnRAR native license](rust/unrar_sys-0.5.8/native-license.txt).
- [UnRAR acknowledgement, including Intel BSD binary redistribution notice](rust/unrar_sys-0.5.8/native-acknow.txt).

## Compound and other terms

- brotli8.0.4: BSD-3-Clause AND MIT.
- dpi0.1.2: Apache-2.0 AND MIT; its libm-derived notice file is preserved.
- encoding_rs0.8.35: (Apache-2.0 OR MIT) AND BSD-3-Clause; COPYRIGHT and LICENSE-WHATWG are preserved.
- Unicode data crates retain their Unicode-3.0 texts; unicode-ident also carries a wrapper/data compound declaration.
- tao0.35.3 and unicode-linebreak0.1.5 declare Apache-2.0-only. Applicable Apache redistribution/NOTICE/modified-file conditions remain separate from appMIT.
- libsqlite3-sys binding license is MIT; bundled SQLite has its own public-domain dedication. Archive presence of nonselected SQLCipher code does not show that SQLCipher was linked.
- DjVu0.31.0 and the local jb2 patch declare MIT; the patch/source is retained in vendor/djvu-jb2. This is not a DjVuLibre/GPL dependency.

## Resolved upstream text omissions

Nineteen published crate source packages omitted a top-level named license text. Those packaging omissions are resolved here using exact upstream repository root files at the crate VCS commit, or (selectors) the actual MPL header, complete exact source archive and common verbatim MPL text. Copyright owners were not synthesized from Cargo author fields. Details and file hashes are recorded per package in rust/manifest.json and [NOTICE_RESOLUTIONS.md](rust/NOTICE_RESOLUTIONS.md).

| Package | Version | Preserved supplemental texts | Evidence resolution |
|---|---|---|---|
| alloc-stdlib | 0.2.4 | LICENSE | Verbatim exact-pinned upstream root texts, not synthesized from Cargo authors |
| defmt-parser | 1.0.0 | LICENSE-MIT, LICENSE-APACHE | Verbatim exact-pinned upstream root texts, not synthesized from Cargo authors |
| djvu-bitmap | 0.31.0 | LICENSE | Verbatim exact-pinned upstream root texts, not synthesized from Cargo authors |
| djvu-bzz | 0.31.0 | LICENSE | Verbatim exact-pinned upstream root texts, not synthesized from Cargo authors |
| djvu-iff | 0.31.0 | LICENSE | Verbatim exact-pinned upstream root texts, not synthesized from Cargo authors |
| djvu-iw44 | 0.31.0 | LICENSE | Verbatim exact-pinned upstream root texts, not synthesized from Cargo authors |
| djvu-pixmap | 0.31.0 | LICENSE | Verbatim exact-pinned upstream root texts, not synthesized from Cargo authors |
| djvu-zp | 0.31.0 | LICENSE | Verbatim exact-pinned upstream root texts, not synthesized from Cargo authors |
| selectors | 0.36.1 | MPL-2.0.txt, SOURCE_HEADER.txt | MPL source archive and actual header are preserved; generic MPL text is not claimed to be an upstream-root file |
| tauri-plugin | 2.6.3 | LICENSE_MIT, LICENSE_APACHE-2.0 | Verbatim exact-pinned upstream root texts, not synthesized from Cargo authors |
| unic-char-property | 0.9.0 | LICENSE-MIT, LICENSE-APACHE, COPYRIGHT.md, AUTHORS, SOURCE_HEADER.txt | COPYRIGHT.md and AUTHORS recovered at exact pinned commit; their Git blob SHAs verified |
| unic-char-range | 0.9.0 | LICENSE-MIT, LICENSE-APACHE, COPYRIGHT.md, AUTHORS, SOURCE_HEADER.txt | COPYRIGHT.md and AUTHORS recovered at exact pinned commit; their Git blob SHAs verified |
| unic-common | 0.9.0 | LICENSE-MIT, LICENSE-APACHE, COPYRIGHT.md, AUTHORS, SOURCE_HEADER.txt | COPYRIGHT.md and AUTHORS recovered at exact pinned commit; their Git blob SHAs verified |
| unic-ucd-ident | 0.9.0 | LICENSE-MIT, LICENSE-APACHE, COPYRIGHT.md, AUTHORS, SOURCE_HEADER.txt | COPYRIGHT.md and AUTHORS recovered at exact pinned commit; their Git blob SHAs verified |
| unic-ucd-version | 0.9.0 | LICENSE-MIT, LICENSE-APACHE, COPYRIGHT.md, AUTHORS, SOURCE_HEADER.txt | COPYRIGHT.md and AUTHORS recovered at exact pinned commit; their Git blob SHAs verified |
| unrar_sys | 0.5.8 | LICENSE-MIT, LICENSE-APACHE | Verbatim exact-pinned upstream root texts, not synthesized from Cargo authors |
| webview2-com | 0.38.2 | LICENSE | Verbatim exact-pinned upstream root texts, not synthesized from Cargo authors |
| webview2-com-macros | 0.8.1 | LICENSE | Verbatim exact-pinned upstream root texts, not synthesized from Cargo authors |
| webview2-com-sys | 0.38.2 | LICENSE | Rust wrapper root license recovered; Microsoft loader handled separately in WEBVIEW2.md |

UNIC source headers referred to COPYRIGHT; the pinned root tree identifies COPYRIGHT.md, which includes Rust/rust-url/Servo/UNIC attribution and points to AUTHORS. Both files and the actual source copyright/header are preserved. The Microsoft WebView2 native loader terms are [documented separately](WEBVIEW2.md); root Rust-binding MIT does not replace them.

This closes the specific missing-top-level-text list. It does not establish a full per-file attribution audit or a linker-derived claim that every possible third-party notice is complete.

## Distribution boundary

This is a documented evidence-preservation/source-availability step, not a legal guarantee or final linker-derived SBOM. Binary-only distributions must carry relevant notices and source-availability instructions too; keeping these only in a separate source repository is not an automatic substitute. Future dependency or local MPL changes require updated source archives/notice review. OS libraries, Microsoft redistributables/WebView2 and separate native DLLs require their own distribution analysis. No publication or installer/signing action is performed by this preparation.
