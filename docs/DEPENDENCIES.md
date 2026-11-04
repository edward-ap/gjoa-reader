# Dependency provenance and distribution

## Current UI delivery

Tæt UI v0.6.0-rc.4, Git commit bfd3ddcddf1cdc539397e5d2ac5ed3cb976e72c2, repository https://github.com/edward-ap/taet-ui. The exact published npm tarball and its SHA-512 integrity are pinned in vendor/taet-ui/pin.json; each selected source/type/style/font/license/provenance file has a SHA-256. Reproduction downloads that immutable version and verifies all bytes before replacing owned vendor files. Build/runtime has no dependency on a local framework checkout. The application compiles one ESM from public all/foundation exports.

Current upstream notices: vendor/taet-ui/LICENSE and THIRD_PARTY_NOTICES.md. UI Noto Sans WOFF2 keeps its OFL. Original upstream snapshot/grid provenance is retained in the delivery; do not edit vendor source to adapt application assumptions.

## Local specialized extensions

RenderViewport and Painter are local MIT derivatives of the previously archived Dense UI components. Their original copyright/source hashes remain in extensions/*/provenance.json and LICENSE. Current imports use public taet-ui/foundation only. They are not supplied by Tæt and do not import one another. Geometry, bitmap ownership, logical annotation coordinates and DenseUI.Painter v1 persistence stay application contracts. No old framework runtime is shipped alongside Tæt.

## Native engine and assets

Cargo.lock and the Rust publication/decoder/render/IPC source remain outside this UI migration. Fonts, edition identities, original PDF behavior and the three-page Continuous cache policy are unchanged. Native PDFium version/provenance/notices remain under src-tauri/assets/pdfium. Publication fonts retain exact legacy/current bytes and OFL/provenance under src-tauri/assets/fonts. The local MIT DjVu patch and notices remain in vendor/djvu-jb2.

Original application code and project-owned artwork are MIT; source specifications and dependencies retain their own terms. See LICENSE_SCOPE.md, ../THIRD_PARTY_NOTICES.md and ../licenses/ASSETS.md. The pinned FB2 schema set retains its repository-wide BSD-2-Clause license and complete notice; UI migration does not change those rights.

## Updates and validation

Use npm run taet:fetch to reproduce the pin, or scripts/vendor-taet-ui.mjs --pin TAG FULL_COMMIT_SHA for an explicitly reviewed published update. Keep private user settings/books out of source and run tests in isolated profiles. Changing UI dependencies does not authorize republishing existing editions, moving user data or adding format branches to the frontend.
