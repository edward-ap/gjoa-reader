# Noto Sans

Original upright variable font from Google Fonts, retrieved 2026-09-12.
Source: https://raw.githubusercontent.com/google/fonts/main/ofl/notosans/NotoSans%5Bwdth,wght%5D.ttf
Original SHA-256: `bfb7bb691513f12e734dc346c03a03f784912432d7e3fa8e56efcf906fe86b3d`
Original retained at `examples/labs/fonts/NotoSans-variable.ttf` for reproduction.

Runtime: `NotoSans-variable.woff2`, 918,168 bytes (original 2,049,096).
SHA-256: `7ed77c38412a34312e975abcd5eb2b2848a596f1921393f925a53a27938eb116`.
Container conversion only: no subsetting, outline changes or removed hinting.
All 21 tables match after decoding, apart from the head checksum/WOFF2 flag.
All 4515 glyphs, 3094 cmap code points, weight and width axes are preserved.
CSS exposes weights 100–900 at normal width, unchanged from the original.

To reproduce, install `fonttools==4.61.1 brotli==1.2.0` in an isolated Python
maintenance environment and run `python scripts/convert-font.py --write` from
repository root. Without `--write` it verifies the checked-in asset. Conversion
disables optional table transforms to preserve exact outline/metric table bytes.
See https://fonttools.readthedocs.io/en/stable/ttLib/woff2.html.
Ordinary npm builds use the checked-in WOFF2 and do not require Python packages.

Copyright and SIL Open Font License 1.1 are in NotoSans-OFL.txt.
Keep the license when redistributing. Loaded locally by ../styles/fonts.css;
no Google Fonts service requests.
