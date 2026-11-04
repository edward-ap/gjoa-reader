# Native boundary and isolated validation

GjøaReader is a separate Tauri application. Its configured application identifier
selects its own production data directory; startup never probes another reader's
profile and never imports or migrates a sibling application's Library.

The only data-root override is the **process environment** variable
READER_TEST_DATA_DIR. It must be an absolute path. JavaScript cannot set it.
Use a newly created temporary directory for native smoke runs. The override covers
Library, preferences, UI state, legacy progress, annotations, the shared font cache
and the window-state plugin together. Without it, Tauri's app_data_dir() supplies
the application-specific root. Ordinary unit tests create their own temporary
stores and do not start Tauri or open the production Library.

## Reader, renderer and publication

The registered Document abstraction owns paged format behavior. Fixed formats and
persisted generated editions implement that same contract. Frontend hosts know
pages, geometry and accepted view identity; they must not branch on source format.
Source parsing and typesetting happen during publication, never when opening a
saved generated page. Source and edition hashes, versioned profiles/codecs,
bounded checked paths, transactional Library installation and compensation remain
native responsibilities.

The render command accepts a document identity, page index, bounded dimensions
and a page appearance. Pixels cross IPC as binary RGBA, not JSON arrays or PNGs.
Native render requests are serialized, while the frontend checks abort/generation
before and after native work. A completed obsolete raster must not replace the
current view or authorize a progress save. Single/Facing and Continuous own their
compositions; Continuous keeps only the previous/current/next page window.

Native handles and source lifetimes stay behind the Rust worker/document boundary.
The local viewport extension only presents owned bitmap results. It does not know
books, file formats, Tauri, Library persistence or publication.

## Imports, state and annotations

Upload chunks stay binary and bounded to 1 MiB, with a 512 MiB source limit.
The upload ID filters native stage events. Cancellation can race a committed
publication, so the application drains native work and refreshes Library after the
job settles. No automatic book deletion, broad garbage collection or startup
edition migration is introduced by the UI migration.

Preferences and UI geometry are separate atomic stores. Library progress is
item-based; legacy external-path progress stays separate. Only a fully accepted
view can update progress. Window state is restored while hidden and shown after
frontend composition.

Annotations live in a separate SQLite store, never in immutable edition payloads.
The native validator accepts **DenseUI.Painter version 1**, logical page dimensions,
bounded object/point counts and color/style ranges. Optional solid/dashed style is
backward compatible. The application supplies book identity and serializes saves
across book replacement; the Painter extension only edits the generic model.
Failed reads must not authorize overwriting corrupt annotations.

## Default tests and the external compatibility corpus

No private books, personal settings or historical diagnostic artifacts are shipped.
Default cargo test --locked runs self-contained parser, publication, codec,
rendering, Library transaction and state tests. Fixtures are generated in temporary
directories. Native image-edition rollback uses a synthetic CBZ; generated-edition
rollback uses synthetic FB2, so neither requires a real book.

Thirteen retained corpus regressions are explicitly marked ignored. They are visible
in the test listing; they are **not claimed passed** by the default suite. An
operator may supply their own compatible, read-only fixture corpus:

~~~powershell
$env:GJOA_TEST_CORPUS_DIR = 'D:\reader-test-corpus'
cargo test --locked -- --ignored
Remove-Item Env:GJOA_TEST_CORPUS_DIR
~~~

The corpus root must be absolute and exist; explicitly running these tests without
it fails with a diagnostic rather than silently passing. These historical tests
expect a particular known compatibility collection (DjVu, FB2/CBR, RTF, PDF/EPUB
and CBZ) with their asserted page counts/content. They are separate from the
public, clean-checkout synthetic checks. Do not point this variable at the user's
Library database or application data folder.

The pinned FB2 XSD remains under docs/specifications/fb2 with its upstream notices.
Font, PDFium and decoder notices travel with the required assets; UI bundle fonts
are independent from immutable publication font profiles.

Native smoke validation must use a fresh READER_TEST_DATA_DIR and synthetic books,
and run sequentially because WebView2 profiles/processes are shared resources.
Finish Rust commands that relink the executable before launching a smoke run.
Programmatic WebView tests do not certify physical input, IME, macOS or all DPI
configurations. Platform and external-corpus limitations must be reported explicitly.

## Standalone profile selection

After all native relinks finish, `node scripts/native-smoke.mjs --release <external-evidence-directory>` tests the optimized executable. Without `--release` it selects debug. The script launches only the executable under this checkout's target directory, verifies the embedded Tauri URL, creates a fresh absolute data and WebView2 profile, then closes/restarts the same profile and compares the exact saved Painter v1 document. It does not run an installer, sign, publish or migrate another application's data. Release and debug results are recorded separately.

## Executable identity

The final Tauri application is `GjøaReader.exe` in both target/debug and target/release.
`mainBinaryName` controls this supported build output; the Cargo package/library
remain `reader`. Native smoke accepts only this exact final executable and the
local.gjoa.reader application identifier. No launcher falls back to a predecessor
binary, and the display/binary rename does not change application data paths.
