# Dependency provenance and distribution

## Dense UI

Repository https://github.com/edward-ap/dense-ui, tag v0.6.0-rc.1, commit 7e4b2983bcac5c640de250bc7fa1b17d8e6d369e. vendor/dense-ui/pin.json records every delivered source/type/style/font/license file with length and SHA-256. Hashes are for canonical GitHub archive bytes, not Windows checkout line-ending conversions. The checked source is built through public entry points into one module; no private API change has been made. MIT: vendor/dense-ui/LICENSE and THIRD_PARTY_NOTICES.md; these notices are copied to offline output. UI Noto Sans WOFF2 and OFL remain beside generated CSS.

## Local extension extraction

RenderViewport/Painter are local MIT derivatives of the archived Dense UI implementation, absent from the public preview. Each extensions directory contains original-file provenance hashes, delivered-file hashes where recorded, its license and a public contract. The old implementation was adapted to public BaseControl lifecycle/events and local geometry helpers; no old core/framework/runtime module is shipped. ThemeDesigner/ThemeApplicator remain the unchanged upstream implementations. Unit/browser/consumer type checks exercise this boundary.

## Rust/native assets

Cargo.lock pins the Rust graph. Native PDFium Windows x64 binary, exact version/provenance and all upstream notices are in src-tauri/assets/pdfium. Do not replace it with an unpinned OS DLL. The worker owns its native handles; source-only/generated editions do not depend on a native PDF handle at reopen.

Publication fonts include the pinned legacy PT Serif/Noto sets plus four Literata faces needed for current and historical edition profiles. Original bytes, hashes, OFL/license/provenance live in src-tauri/assets/fonts. build.rs losslessly compresses embedded font bytes; runtime verifies/caches exact bytes in the current application's data root. They are not UI fonts and must not be subset/re-encoded during packaging. System fallback persists raster evidence, not copied OS font files.

The local MIT djvu-jb2 0.31.0 Cargo patch is in vendor/djvu-jb2 with its upstream license and focused PATCHES.md. Other decoder crate versions remain locked. FB2 XSD notices are retained under docs/specifications/fb2.

Original author-owned application code and project-owned artwork are MIT; see ../LICENSE, LICENSE_SCOPE.md and ../licenses/ARTWORK.md. Third-party fonts, native components and upstream code retain their existing licenses/notices. Companion FB2 schema scope remains separate in ../licenses/ASSETS.md.

## Reproducible update

Run npm run dense:fetch to reproduce the current pin. For a reviewed update run node scripts/vendor-dense-ui.mjs --pin TAG FULL_COMMIT_SHA. Review manifest/source diffs and extension contracts, then build/types/browser/Rust/native isolation gates. npm dependencies are dev-only and exact-version/lockfile pinned. No global toolchain/security/credential changes are part of setup.
