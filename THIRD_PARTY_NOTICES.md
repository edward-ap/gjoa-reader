# Third-party notices

GjøaReader original author-owned code is MIT, Copyright(c)2026 Edward Aponasko; see [LICENSE](LICENSE). The following components retain their own terms. Project-owned artwork is under MIT in [licenses/ARTWORK.md](licenses/ARTWORK.md). This file does not relicense dependencies or fonts or represent the combined executable as MIT-only.

## Rust and covered source

- [licenses/RUST_DEPENDENCIES.md](licenses/RUST_DEPENDENCIES.md) and licenses/rust/ contain the exact audited Windows dependency graph's copied license/NOTICE/copyright texts and machine-readable file hashes. Graph reachability includes build/proc-macro packages and is not proof every package is physically linked. Keep all copied notices verbatim.
- UnRAR0.5.8 wrappers and native UnRAR7.1 have distinct terms. Include both native license.txt and acknow.txt, including Intel's Slicing-by-8 notice; extraction permission does not grant permission to recreate a RAR-compatible archiver/compression algorithm.
- [licenses/SOURCE_AVAILABILITY.md](licenses/SOURCE_AVAILABILITY.md) gives recipients the five exact MPL2.0 source archives, versions, SHA-256 and upstream download references. Keep those archives and instructions available with executable distributions. Their source remains MPL2.0.
- Local djvu-jb2 patch: [vendor/djvu-jb2/LICENSE](vendor/djvu-jb2/LICENSE) and [PATCHES.md](vendor/djvu-jb2/PATCHES.md). Preserve original notices and the documented modifications.

- Windows WebView2 SDK loader: [licenses/WEBVIEW2.md](licenses/WEBVIEW2.md), with the exact official Microsoft LICENSE/NOTICE and payload match in licenses/webview2/. The SDK loader is separate from wrapper MIT; browser/runtime installers are not bundled.

## Tæt UI and local extensions

- Upstream Tæt UI: [vendor/taet-ui/LICENSE](vendor/taet-ui/LICENSE), [THIRD_PARTY_NOTICES](vendor/taet-ui/THIRD_PARTY_NOTICES.md), exact commit recorded in vendor/taet-ui/pin.json.
- Viewport and Painter: [extensions/viewport/LICENSE](extensions/viewport/LICENSE), [extensions/painter/LICENSE](extensions/painter/LICENSE), with each provenance.json.
- UI Noto Sans: vendor/taet-ui/src/ui/fonts/NotoSans-OFL.txt. Its OFL remains separate from MIT.

## Native libraries, fonts, specifications and artwork

[licenses/ASSETS.md](licenses/ASSETS.md) records exact asset licenses, acknowledgements, project-owned artwork and remaining companion-schema scope. Preserve all publication font OFL/provenance files in src-tauri/assets/fonts, the complete PDFium LICENSE/VERSION/provenance.json/licenses set under src-tauri/assets/pdfium, and existing notices under docs/specifications/fb2. PDFium includes FreeType and Independent JPEG Group code; required acknowledgements are supplied in the asset notice document. Project artwork licensing does not grant upstream companion-schema permissions or relicense third-party fonts.

## Build/test tools

[licenses/TOOLS.md](licenses/TOOLS.md) describes locked development tooling. node_modules, browsers, Rust/MSVC/Windows SDK/WebView2 installers are not bundled by this project. Assess their separate terms if a future package distributes those tools themselves.

## Preparing accompanying notices

Run node scripts/package-notices.mjs --out ABSOLUTE_NEW_EMPTY_DIRECTORY. The command copies standard MIT, this index, the prepared licenses/covered-source directory and existing upstream asset notices unchanged, and writes a SHA-256 file manifest. It copies no application executable, third-party runtime binary, font payload, artwork or book. Include the resulting directory tree alongside an eventual binary. It is a notice bundle, not approval to distribute assets with unresolved rights or a substitute for reviewing the actual final package.
