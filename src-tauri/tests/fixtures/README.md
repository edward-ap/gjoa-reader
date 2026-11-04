# Synthetic compatibility fixtures

The publisher-v1 folder contains a tiny original test manuscript (source.fb2),
its saved immutable edition and a rendered expected PNG. The manuscript begins
with "Publisher v1 compatibility" and "Chapter One"; it is purpose-written test
data, not a distributed book or a personal Library export. Keep its saved bytes
unchanged: publication/storage compatibility tests compare legacy edition reads
and rendering against this baseline instead of silently republishing it.

Original synthetic fixture text, expected rendering and test metadata follow the
project source license. The edition carries upstream OFL font notices in its
assets/fonts folder. Those notices retain their own terms. Exact legacy font
bytes are supplied by the pinned application assets as required by the tested
profile; do not substitute current fonts when interpreting an older edition.

External corpus regressions in ../corpus.rs are separate opt-in ignored tests.
No external books are shipped. See docs/NATIVE_BOUNDARIES.md for the absolute
GJOA_TEST_CORPUS_DIR contract and validation limits.
