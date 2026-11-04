# License scope

Copyright (c)2026 Edward Aponasko. Original author-owned GjøaReader application source, tests, scripts, documentation and project-owned artwork are available under the standard MIT text in [../LICENSE](../LICENSE). Package metadata identifies that application grant; it is not a blanket license for the entire dependency graph or resulting executable.

## Separately licensed material

- Tæt UI remains its pinned upstream MIT implementation with its original LICENSE and THIRD_PARTY_NOTICES. Local viewport/Painter derivatives retain their original MIT notices and provenance; the application grant does not replace them.
- Rust dependencies and the patched DjVu decoder keep their individual licenses/copyrights. Native UnRAR includes extraction-specific restrictions; wrapper MIT/Apache metadata does not replace them. See [Rust dependency notices](../licenses/RUST_DEPENDENCIES.md).
- MPL-covered source remains under MPL2.0. The five exact cached archives and hashes, local acquisition instructions and immutable upstream download references are in [source availability](../licenses/SOURCE_AVAILABILITY.md). Application MIT does not restrict the recipient's rights in that source.
- Publication/UI fonts retain OFL and any reserved-name conditions. PDFium and its native dependencies retain their complete notice set, including FreeType/IJG acknowledgements. No OS font binaries are distributed.
- Project-owned ship/icon artwork and the static Æ PNG are under MIT; see [artwork licensing](../licenses/ARTWORK.md). The pinned FB2 specifications retain their repository-wide BSD-2-Clause terms; preserve docs/specifications/fb2/LICENSE.md and provenance.json.
- User books, Library data, metadata and external paths are not distributed and acquire no license from this repository.

## Distribution scope

A source checkout must preserve the existing vendor/extension/font/PDFium/schema notices and the licenses directory. A standalone executable must be accompanied by the notice/source-availability bundle; packaging instructions and per-component gaps are in [../THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md). The bundle contains notices and explicitly licensed covered sources, not a complete redistributable application package.

MPL source availability and notice preservation apply to its covered code; they do not automatically relicense independent application files. See the [official MPL2.0 responsibilities](https://www.mozilla.org/en-US/MPL/2.0/#responsibilities) and the component-specific source instructions. Additional copyrights/licenses remain effective alongside MIT.
