# GjøaReader

A local Windows desktop reader built with Rust/Tauri and Tæt UI to read books in formats: DjVu, PDF, CBR/CBZ, FB2, EPUB, RTF and MOBI.

## Clean checkout

Currently validated target: Windows x64, Rust MSVC toolchain + Windows SDK, Node.js 22+, npm, Microsoft Edge and WebView2 Evergreen. PDFium for Windows x64 is pinned and included. Other operating systems are not certified by this repository's Windows checks. Use a checkout path containing Unicode if desired; the application is built and tested from a path containing **ø (U+00F8)**.

```powershell
Set-Location .\gjøa-reader
npm ci
npm run taet:verify
npm run build
npm run test:types
npm test
Set-Location src-tauri
cargo fmt --check
cargo clippy --all-targets --locked -- -D warnings
cargo test --locked
Set-Location ..
npm run desktop:build
.\src-tauri\target\release\GjøaReader.exe
```

The final standalone executable is `src-tauri/target/release/GjøaReader.exe` after `npm run desktop:build` (`tauri build`). For the final named debug executable, use `npm run desktop:build -- --debug`; its path is `src-tauri/target/debug/GjøaReader.exe`. These Tauri build commands apply `mainBinaryName`; raw Cargo commands and `tauri dev` may use the unchanged technical Cargo target `reader` instead. The Cargo package and library keep that technical name. Builds own only dist and their native target directory. Finish all native builds/tests before launching integration checks. The executable/product rename does not change the application identifier or data directories.

Native pagination and publication are CPU-intensive, so development builds optimize the native pipeline and its runtime dependencies (reader at level3, the base development profile at level2, with explicit dependency overrides retained). Development debug information, assertions and overflow checks retain their existing settings. Saved edition formats and identities are unchanged.

## Independent data and safe integration checks

The application identifier is **local.gjoa.reader**, separate from the predecessor. Normal launches reuse this application's existing Library and preferences under its Tauri app-data directory; only the first launch initializes an empty Library and default preferences. Changing the executable/product name preserves that identifier and data root, so it does not clear or replace existing books/settings. The identifier is pinned in [src-tauri/tauri.conf.json](src-tauri/tauri.conf.json); [native boundaries](docs/NATIVE_BOUNDARIES.md) describe data isolation. No startup migration or lookup of another reader's Library/settings is implemented. Import copies into this application's immutable source/edition storage; original external documents are not Library storage.

`READER_TEST_DATA_DIR` is a process-only absolute override for native validation, including Library, settings, annotations, font cache and window state. Do not point it at real application data. The legacy environment-variable spelling is retained for test compatibility, not as a reference to an old data path. The native smoke also sets a fresh WebView2 user-data directory.

After completing all relinks:

```powershell
node scripts/native-smoke.mjs --release <absolute-evidence-directory-outside-checkout>
```

With `--release` this launches the actual optimized standalone Tauri executable from the release directory; omitting the flag selects debug. Both use embedded assets rather than a development server. The smoke uploads a generated synthetic FB2 through FileUpload/native binary IPC, checks published/raster pages, navigation, Painter v1 native persistence and exact model restoration after restart in a fresh profile. Browser pointer/file-injection automation is not physical mouse/pen/touch, native file-dialog or IME certification. Evidence defaults to a temporary directory when omitted. Browser screenshot evidence uses GJOA_EVIDENCE_DIR or a temporary directory.

## Tæt UI pin and updates

The current public preview is **v0.6.0-rc.4**, Git commit **bfd3ddcddf1cdc539397e5d2ac5ed3cb976e72c2**, from [edward-ap/taet-ui](https://github.com/edward-ap/taet-ui). This project vendors the exact published npm tarball for taet-ui@0.6.0-rc.4, verified by its published SHA-512 integrity and per-file SHA-256 in vendor/taet-ui/pin.json. No sibling checkout or runtime npm resolution is needed. The upstream package contains no runtime dependencies.

```powershell
npm run taet:verify
npm run taet:fetch
# Explicit reviewed update: published tag and full matching Git commit.
node scripts/vendor-taet-ui.mjs --pin vVERSION FULL_COMMIT_SHA
```

Build verifies the source delivery, then bundles public all/foundation exports into one ESM runtime with matching taet-ui.css/fonts/notices. All application import aliases share that instance. The local viewport/Painter modules import public taet-ui/foundation and keep their own types/styles/ownership. Existing dui-* classes, data-dui-* attributes and --dui-* tokens are retained upstream contracts, not old runtime imports.

Saved annotations deliberately retain the DenseUI.Painter v1 codec tag. It is persisted application data, not a framework dependency. Application-owned theme definitions/settings are unchanged; Tæt also accepts the earlier theme envelope/storage key where its public editor exposes those operations. No eager rewrite of user data is part of this migration.

## Local extensions and application ownership

- [Raster viewport](docs/VIEWPORT.md): generic bounded raster presentation, fit/zoom/pan, transforms, cancellation, ImageBitmap ownership and accepted-render events. Entry extensions/viewport/index.js; CSS viewport.css. It does not import Painter.
- [Painter](docs/PAINTER.md): SVG annotation engine with the compatible DenseUI.Painter v1 codec, optional dash, logical coordinates, gestures/selection/eraser/history. Entry extensions/painter/index.js; CSS styles.css. It does not import the viewport.
- [Application contracts](docs/APP_CONTRACTS.md): ReaderViewHost, Continuous three-page cache, Library commands, app-owned status presentation and theme draft semantics.
- [Native boundaries](docs/NATIVE_BOUNDARIES.md): binary IPC, immutable editions, persisted annotations and data isolation.
- [Dependencies and licenses](docs/DEPENDENCIES.md): upstream pin, original extension provenance, fonts, PDFium and decoder patch.

ThemeDesigner and ThemeApplicator are already provided by the pinned release and are not duplicated. Book identity, parser/publication logic, Library/annotation persistence, page progress, annotation palette and native bridge belong to the application. Extensions do not know source formats or call Tauri. The application contains no access to a private Dense UI component/core path.

## Validation scope

The default Rust and browser suites use self-contained generated/synthetic fixtures. Thirteen existing external corpus tests are explicit opt-in ignored tests; real books are not redistributed. Run them only with an authorized external corpus and absolute GJOA_TEST_CORPUS_DIR as explained in NATIVE_BOUNDARIES. Ignored corpus tests are not counted as successful corpus coverage.

Tæt UI remains a pre-1.0 release candidate; Grid/TreeGrid and Advanced are experimental. Application validation is separate from upstream gates and limited to the browsers/native platforms actually exercised. No other engine/platform certification follows from the library update.

## License

Original application code, documentation and project-owned artwork by Edward Aponasko are licensed under the [MIT License](LICENSE), copyright2026. The grant covers only material the author owns; it does not replace Dense UI/extension, decoder, font or native-library terms. Artwork licensing is recorded in [licenses/ARTWORK.md](licenses/ARTWORK.md). See [license scope](docs/LICENSE_SCOPE.md), [third-party notices](THIRD_PARTY_NOTICES.md), [Rust licenses](licenses/RUST_DEPENDENCIES.md), [covered source availability](licenses/SOURCE_AVAILABILITY.md) and [asset notices](licenses/ASSETS.md).

Prepare accompanying notices for a standalone binary with:

```powershell
node scripts/package-notices.mjs --out C:\Path\To\New-Empty-Notices-Directory
```

This creates a notice/source-availability bundle only; it copies no executable, font payload, DLL, artwork or book. Include the bundle unchanged with any eventual binary distribution. It does not resolve upstream companion-schema permission scope or certify the final linked binary's complete license scope. Project-owned artwork is MIT; third-party font licenses remain separate. Specific component obligations are in the linked license documents.

No remote/push/publication is configured. The combined executable and third-party assets must not be described as MIT-only.

The additional `npm run test:native:formats -- ABSOLUTE_EVIDENCE_DIRECTORY` smoke
uses only generated FB2, EPUB, PDF and JPEG-backed DjVu containers. It checks a mixed
FileUpload queue with one malformed file, native rasters, custom-theme persistence
and restart in a new isolated profile. Complete all native builds before running
WebView2 tests, and run native suites sequentially. This is automated Windows
coverage, not a private-book corpus, physical-input or macOS certification.
