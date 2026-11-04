# Asset and native-component notices

The application's user-owned code may be distributed under its root license. That grant does not relicense the fonts, native components, upstream framework/extension code, schemas, or artwork listed here. Keep their original notices and terms. Asset rights marked unresolved below are not granted by this document. This is a practical notice inventory, not a legal guarantee or a certification of a complete public package.

## Binary-distribution acknowledgments

Include this document with a distributed application together with the complete notice files mapped below. The supplied FreeType and IJG notices call for the following product-documentation acknowledgments:

> This software is based in part on the work of the FreeType Team.

> This software is based in part on the work of the Independent JPEG Group.

These credits do not replace their full accompanying notices. Do not imply endorsement by any upstream author or trademark owner. The executable being technically self-contained does not remove the requirement to provide notices in accessible accompanying materials.

## Fonts

All listed font software remains under **SIL Open Font License1.1**, separately from the application's license. Preserve complete copyright and OFL text. Do not sell the font software alone, relicense it to MIT, or remove its license metadata. Original/modified-version and Reserved Font Name conditions remain as supplied by each font's license; this preparation performs no new RFN naming/legal choice and changes no font bytes. The recorded static-instance/container conversions and source hashes remain in their existing provenance files.

| Asset | Family | License | Complete notice in source |
| --- | --- | --- | --- |
| src-tauri/assets/fonts/PT_Serif-Web-Regular.ttf | PT Serif | OFL-1.1 | src-tauri/assets/fonts/OFL.txt |
| src-tauri/assets/fonts/PT_Serif-Web-Italic.ttf | PT Serif | OFL-1.1 | src-tauri/assets/fonts/OFL.txt |
| src-tauri/assets/fonts/PT_Serif-Web-Bold.ttf | PT Serif | OFL-1.1 | src-tauri/assets/fonts/OFL.txt |
| src-tauri/assets/fonts/PT_Serif-Web-BoldItalic.ttf | PT Serif | OFL-1.1 | src-tauri/assets/fonts/OFL.txt |
| src-tauri/assets/fonts/NotoEmoji.ttf | Noto Emoji | OFL-1.1 | src-tauri/assets/fonts/NotoEmoji-OFL.txt |
| src-tauri/assets/fonts/NotoSansMono-Regular.ttf | Noto Sans Mono | OFL-1.1 | src-tauri/assets/fonts/NotoSansMono-OFL.txt |
| src-tauri/assets/fonts/NotoSerifJP-Regular.ttf | Noto Serif JP | OFL-1.1 | src-tauri/assets/fonts/NotoSerifJP-OFL.txt |
| src-tauri/assets/fonts/Literata-Bold.ttf | Literata | OFL-1.1 | src-tauri/assets/fonts/Literata-OFL.txt |
| src-tauri/assets/fonts/Literata-BoldItalic.ttf | Literata | OFL-1.1 | src-tauri/assets/fonts/Literata-OFL.txt |
| src-tauri/assets/fonts/Literata-Italic.ttf | Literata | OFL-1.1 | src-tauri/assets/fonts/Literata-OFL.txt |
| src-tauri/assets/fonts/Literata-Regular.ttf | Literata | OFL-1.1 | src-tauri/assets/fonts/Literata-OFL.txt |
| vendor/dense-ui/src/ui/fonts/NotoSans-variable.woff2 | Noto Sans UI | OFL-1.1 | vendor/dense-ui/src/ui/fonts/NotoSans-OFL.txt |

Publication-font provenance is in src-tauri/assets/fonts/provenance.json, symbols-provenance.json, Literata.provenance.json, NotoSansMono.provenance.md and NotoSerifJP.provenance.md. UI font conversion provenance is vendor/dense-ui/src/ui/fonts/README.md. Font byte hashes and exact source URLs are in asset-license-manifest.json. Lossless executable compression/cache extraction does not relicense font software.

## PDFium and component notices

The pinned native package is PDFium155.0.8044.0, release [chromium/8044](https://github.com/bblanchon/pdfium-binaries/releases/tag/chromium/8044). Source provenance is src-tauri/assets/pdfium/provenance.json and VERSION. The package/build project's MIT grant is not the license of all components inside pdfium.dll. Retain the complete supplied set, including combined/historical texts.

| Supplied source notice | License/terms represented |
| --- | --- |
| src-tauri/assets/pdfium/LICENSE | MIT |
| src-tauri/assets/pdfium/licenses/pdfium.txt | BSD-3-Clause AND supplied Apache-2.0 text |
| src-tauri/assets/pdfium/licenses/abseil.txt | Apache-2.0 |
| src-tauri/assets/pdfium/licenses/agg23.txt | AGG-2.3 permissive notice |
| src-tauri/assets/pdfium/licenses/fast_float.txt | MIT |
| src-tauri/assets/pdfium/licenses/freetype.txt | FTL (supplied permissive licensing route) |
| src-tauri/assets/pdfium/licenses/icu.txt | Unicode-3.0 + legacy ICU + BSD-3-Clause/MIT + IPADIC/ICOT terms; GPL build-script notices with explicit Autoconf distribution exceptions |
| src-tauri/assets/pdfium/licenses/lcms.txt | MIT |
| src-tauri/assets/pdfium/licenses/libjpeg_turbo.md | IJG AND BSD-3-Clause (plus zlib-derived source) |
| src-tauri/assets/pdfium/licenses/libjpeg_turbo.ijg | IJG |
| src-tauri/assets/pdfium/licenses/libopenjpeg.txt | BSD-2-Clause |
| src-tauri/assets/pdfium/licenses/libpng.txt | libpng-2.0 + historical notices |
| src-tauri/assets/pdfium/licenses/llvm-libc.txt | Apache-2.0 WITH LLVM-exception plus legacy NCSA text |
| src-tauri/assets/pdfium/licenses/simdutf.txt | MIT |
| src-tauri/assets/pdfium/licenses/zlib.txt | Zlib |

The ICU aggregate contains dictionary-data terms including IPADIC/ICOT and identified pkg.m4/config.guess GPL notices with explicit Autoconf distribution exceptions. Those identified build-script notices do not, by themselves, establish a GPL license for the DLL or application. Reassess the relevant terms if distributing or modifying those scripts separately. Retain the entire ICU notice instead of selecting only its first Unicode paragraph. FreeType is represented by the supplied FTL notice; this document does not substitute another licensing route.

Recorded local file hashes and the official release archive digest were checked during preparation. The DLL is unsigned; the existing audit is a provenance/hash consistency check, not an independent rebuild/signature attestation or an assurance that every compiled component was mapped independently to source. Redistribution rights come from the licenses, not from hash matching.

## Dense UI and local extensions

Dense UI is pinned to [commit7e4b2983bcac5c640de250bc7fa1b17d8e6d369e](https://github.com/edward-ap/dense-ui/tree/7e4b2983bcac5c640de250bc7fa1b17d8e6d369e). Preserve vendor/dense-ui/LICENSE and THIRD_PARTY_NOTICES.md. Local viewport and Painter derivatives preserve extensions/viewport/LICENSE and extensions/painter/LICENSE, plus their source-provenance records. All are original upstream MIT notices; the application root license does not replace these copyrights. UI-font OFL and upstream color-math attribution remain separate.

## Schemas

The unmodified FB2 schema source is [gribuser/fb2 commit4d3740e319039911c30d291abb0c8b26ec99703b](https://github.com/gribuser/fb2/tree/4d3740e319039911c30d291abb0c8b26ec99703b), recorded in docs/specifications/fb2/UPSTREAM.txt. FictionBook.xsd contains a BSD-2-Clause-style copyright/conditions/disclaimer. Preserve that complete notice. The companion FictionBookGenres.xsd, FictionBookLang.xsd and FictionBookLinks.xsd lack individual visible license headers: repository-level permission scope for those companions still needs confirmation. They are not designated MIT by this document.

## Project artwork

The ship image, native icon family and static Æ PNG are project-owned artwork under MIT. See [ARTWORK.md](ARTWORK.md) and [artwork-provenance.json](artwork-provenance.json) for license scope and file hashes. The emblem uses a stored PNG and width/height/baseline metrics; no separate font is required for its display. Page text uses Literata and UI text uses Noto Sans, under their existing font terms.

## Remaining schema scope

Only the companion FictionBookGenres.xsd, FictionBookLang.xsd and FictionBookLinks.xsd retain the specific permission-scope question described above. Project artwork licensing is separate from upstream schema permissions; no MIT grant is inferred for them.

## Accompanying files for a binary archive/folder

The following source files should be copied without altering their legal text to the companion locations shown. Keep this ASSETS.md and asset-license-manifest.json under licenses/. These mappings describe packaging obligations; they do not claim that a public binary archive has already been prepared.

| Source file | Companion path in binary distribution |
| --- | --- |
| src-tauri/assets/fonts/OFL.txt | licenses/assets/fonts/OFL.txt |
| src-tauri/assets/fonts/NotoEmoji-OFL.txt | licenses/assets/fonts/NotoEmoji-OFL.txt |
| src-tauri/assets/fonts/NotoSansMono-OFL.txt | licenses/assets/fonts/NotoSansMono-OFL.txt |
| src-tauri/assets/fonts/NotoSerifJP-OFL.txt | licenses/assets/fonts/NotoSerifJP-OFL.txt |
| src-tauri/assets/fonts/Literata-OFL.txt | licenses/assets/fonts/Literata-OFL.txt |
| vendor/dense-ui/src/ui/fonts/NotoSans-OFL.txt | licenses/assets/ui-fonts/NotoSans-OFL.txt |
| src-tauri/assets/pdfium/LICENSE | licenses/pdfium/LICENSE |
| src-tauri/assets/pdfium/licenses/pdfium.txt | licenses/pdfium/licenses/pdfium.txt |
| src-tauri/assets/pdfium/licenses/abseil.txt | licenses/pdfium/licenses/abseil.txt |
| src-tauri/assets/pdfium/licenses/agg23.txt | licenses/pdfium/licenses/agg23.txt |
| src-tauri/assets/pdfium/licenses/fast_float.txt | licenses/pdfium/licenses/fast_float.txt |
| src-tauri/assets/pdfium/licenses/freetype.txt | licenses/pdfium/licenses/freetype.txt |
| src-tauri/assets/pdfium/licenses/icu.txt | licenses/pdfium/licenses/icu.txt |
| src-tauri/assets/pdfium/licenses/lcms.txt | licenses/pdfium/licenses/lcms.txt |
| src-tauri/assets/pdfium/licenses/libjpeg_turbo.md | licenses/pdfium/licenses/libjpeg_turbo.md |
| src-tauri/assets/pdfium/licenses/libjpeg_turbo.ijg | licenses/pdfium/licenses/libjpeg_turbo.ijg |
| src-tauri/assets/pdfium/licenses/libopenjpeg.txt | licenses/pdfium/licenses/libopenjpeg.txt |
| src-tauri/assets/pdfium/licenses/libpng.txt | licenses/pdfium/licenses/libpng.txt |
| src-tauri/assets/pdfium/licenses/llvm-libc.txt | licenses/pdfium/licenses/llvm-libc.txt |
| src-tauri/assets/pdfium/licenses/simdutf.txt | licenses/pdfium/licenses/simdutf.txt |
| src-tauri/assets/pdfium/licenses/zlib.txt | licenses/pdfium/licenses/zlib.txt |
| src-tauri/assets/pdfium/VERSION | licenses/pdfium/VERSION |
| src-tauri/assets/pdfium/provenance.json | licenses/pdfium/provenance.json |
| vendor/dense-ui/LICENSE | licenses/dense-ui/LICENSE |
| extensions/viewport/LICENSE | licenses/extensions/viewport/LICENSE |
| extensions/painter/LICENSE | licenses/extensions/painter/LICENSE |
| vendor/dense-ui/THIRD_PARTY_NOTICES.md | licenses/dense-ui/THIRD_PARTY_NOTICES.md |

Merge the separate Rust/native dependency notice inventory as well. The absence of a blanket source-offer obligation in the inspected asset notices is not an assertion about every Rust/native dependency or every future build/tool configuration. Do not redistribute additional tools/browser/runtime installers merely because they are present on a build machine.
