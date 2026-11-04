# Third-party notices

Dense UI source is licensed under [MIT](LICENSE). Core has no npm runtime dependencies. No external icon font or icon package is bundled; icons are implemented in the source registry.

Development tests use [Playwright](https://github.com/microsoft/playwright), licensed under Apache-2.0. Installed packages and downloaded browser distributions retain their own notices and are not included in the Dense UI package.

Declaration and package-consumer tests use [TypeScript](https://github.com/microsoft/TypeScript), licensed under Apache-2.0. It is a development dependency and is not shipped in the Dense UI package or required at runtime.

New third-party source, artwork or fonts must include attribution and license. This inventory describes the checked-in tree and manifests, not undisclosed historical provenance.

## Default UI font

`src/ui/fonts/NotoSans-variable.woff2` is a container-only conversion of the Google
Fonts Noto Sans upright variable font, bundled locally under SIL OFL 1.1. All
glyphs, metrics, hinting and variation tables are preserved; no subsetting is used.
Copyright and full license: `src/ui/fonts/NotoSans-OFL.txt` in source/package
delivery, or `fonts/NotoSans-OFL.txt` beside a portable bundle.
Source/conversion provenance is in the repository file `src/ui/fonts/README.md`.
Runtime WOFF2 SHA-256: `7ed77c38412a34312e975abcd5eb2b2848a596f1921393f925a53a27938eb116`.
The font license is separate from Dense UI's MIT license.

## Optional font comparison Lab

`examples/labs/fonts/NotoSans-variable.ttf` and `Roboto-variable.ttf` are original
Google Fonts distributions under SIL OFL 1.1. Their respective copyright and license
files are `NotoSans-OFL.txt` and `Roboto-OFL.txt` in the same directory; exact sources
and file hashes are recorded in `sources.json`. The Lab copies are not packaged; the Noto Sans runtime copy is described above.
Roboto is only used in the comparison. Segoe UI is accessed
from the host OS only and is not redistributed.

## Theme Designer color math

The Theme Designer OKLab conversion uses the public-domain matrix implementation
by Björn Ottosson (2021 revision), with local JavaScript sRGB transfer functions
and chroma gamut search. Source and permission: https://bottosson.github.io/posts/oklab/ .
No color library or new runtime dependency is included.

## Build tool

Portable bundles use esbuild (MIT) as a development/build dependency. Its code is
not a required runtime library in the Dense UI delivery. Source: https://github.com/evanw/esbuild .

An optional Tauri source example has separate Rust host dependencies. Those are
not Dense UI JavaScript runtime dependencies; source users retain their upstream
licenses. A distributed native binary needs its own resolved dependency notice review.
