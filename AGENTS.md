# GjøaReader working boundaries

This is an independent Rust/Tauri application. Keep frontend framework-free and runtime dependency-free apart from the pinned Tæt UI. Read README.md, docs/APP_CONTRACTS.md, docs/NATIVE_BOUNDARIES.md and the relevant extension contract before changing behavior.

- vendor/taet-ui is the exact public upstream pin; use scripts/vendor-taet-ui.mjs to verify/fetch/update. Do not modify its core to work around application assumptions.
- Build one framework module. All browser aliases share identity. Extensions import public taet-ui/foundation only; no private source paths or old framework instance.
- RenderViewport and Painter stay independent local modules with types/styles/provenance/MIT notices. Application hosts/cache/palette/identity/native bridge remain application-owned.
- Formats enter native DocumentFormatHandler/registry/publication. No format branches in the shell, hosts, extension, spread layout or raster IPC.
- Preserve immutable Source/Edition compatibility, font/profile identities, bounded binary RGBA IPC, three-page Continuous cache, accepted-pixel progress and Painter v1 persistence. Do not change publication/storage policies as part of UI work.
- Owners destroy owned controls. DisposableBag accepts callbacks/dispose/off, not arbitrary Control.destroy. Guard asynchronous results after teardown.
- Use public menus/commands; never access TreeExplorer.menu. Explicit user-authorized exception: frontend/import-stage-adapter.js may insert an application-owned short status node immediately above each FileUpload ARIA progressbar, using only pinned data-file-id identity and the bar parent. It must not mutate existing queue/filename/progress/button state or access private queue fields. Keep this dependency documented in APP_CONTRACTS and covered by per-entry geometry/stale-event/cancel browser regressions. All other DOM/styling dependencies stay narrow.
- Display name and final Tauri executable are GjøaReader / GjøaReader.exe in both debug and release. Keep Cargo package/library reader; do not manually rename artifacts or fall back to another executable.
- Native app identifier is local.gjoa.reader. Tests must use fresh absolute READER_TEST_DATA_DIR and WebView2 profile. Never open another application's user Library/settings in tests.
- Do not commit books, personal data, generated outputs/caches, credentials, node_modules or internal reports. Screenshot/log evidence goes to an external directory. Reviewed synthetic README images under docs/images are intentional documentation assets; preserve their provenance.
- Validation: npm ci; npm run build; npm run test:types; npm test; in src-tauri cargo fmt --check, cargo clippy --all-targets --locked -- -D warnings, cargo test --locked. Finish all relinks before native smoke. Browser suites run serially.
- External corpus tests are explicit opt-in with GJOA_TEST_CORPUS_DIR; never misreport ignored tests as passed. Keep synthetic legacy fixture byte-stable.
