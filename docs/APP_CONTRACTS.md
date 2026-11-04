# Application boundaries and lifecycle

The shell is format-neutral. Rust Document/Library/publication services own source parsing,
edition identity and storage. JavaScript receives bounded binary RGBA and metadata through
Tauri; no decoder, publication or book persistence is part of Dense UI.

## Rendering and annotations

ReaderViewHost and ContinuousView own semantic page/spread geometry, scroll synchronization,
accepted raster identity and progress. The continuous cache retains only previous/current/next.
The local viewport extension receives generic raster requests and owned ImageBitmap results.
The app owns annotation page transforms, document identity, save queues and the tool rail.
Only the local Painter engine knows drawing gestures and the DenseUI.Painter v1 model.
Neither annotation marks nor appearance settings alter immutable edition layouts.

## Public UI contracts

All Dense imports resolve to one pinned framework instance. The local extensions are separate:
viewport does not import Painter. ThemeDesigner/ThemeApplicator remain the published editor and
color service; the app confirms nested drafts and adapts persisted flat families to {tokens}.

Resource menus are application-owned ContextMenu controls. CommandRegistry.state/execute use
an explicit item ID; no TreeExplorer.menu or private command context is read. A small DOM
adapter on the parent Panel intercepts contextmenu, menu-button clicks and Shift+F10 before
TreeExplorer. It recognizes application data-library-id markup and ARIA row/button semantics,
never private Dense CSS classes or fields. The built-in action column stays because normal
TreeExplorer drag/drop and shortcuts still own their internal row mapping. Preserve ARIA
semantics or revise this adapter when replacing the tree control.

## FileUpload stage presentation: explicit application DOM exception

Publication stages appear directly above the progressbar of each queued file.
Published Dense UI 0.6.0-rc.1 has no public row render/status slot. A small application
adapter supplies this missing presentation slot in frontend/import-stage-adapter.js.
It is not an entirely public framework contract.

The adapter uses only the pinned data-file-id entry identity, the row's ARIA
progressbar and its immediate parent as insertion host. It inserts and owns one
plain status node; it never mutates the framework's existing filename, indicator,
progress, buttons or queue fields. Browse/queue/progress/cancel/retry remain Dense UI.
Each upload attempt gets an identity token; stale callbacks and settlement cannot
remove another attempt/row. Public getEntries checks active status. Only the owned
node is removed on completion/error/cancel/disposal. The short localized stage text
contains no filename, so a long name cannot push it out of view.

This is a pinned semantic DOM dependency and must be covered by browser geometry,
event-to-visible-text, multiple-entry, retry/cancel and stale-callback regressions.
Replace this adapter with an upstream public row slot if one becomes available;
do not add application publication behavior to the Dense UI core.

Close is disabled and beforeClose vetoes header/Escape while queued uploads or
native jobs exist. Cancel all remains available; canceled native work can commit,
so refresh after drain. concurrency=1 and importTail retain native serialization.

## Ownership and teardown

Container controls own their children. Separately mounted menus and externally supplied footer
buttons register cleanup functions: DisposableBag accepts functions/dispose/off, not a generic
Control.destroy method. Cleanup remains idempotent and asynchronous completions check destroyed
state. The app never weakens framework ownership checks or changes baseline lifecycle behavior.

## Validation evidence

Browser screenshots use tests/test-artifacts.mjs. Set GJOA_EVIDENCE_DIR to an absolute
folder outside the checkout for CI collection; the default is the system temporary
folder. This helper rejects traversal and checkout-local output. Synthetic browser
fixtures exercise the real controls/extensions with a mocked native bridge; they do
not certify native publication, physical input, IME or other operating systems.


## Interface language

Application presentation is English regardless of OS locale. Legacy language values
remain accepted without a startup settings rewrite; Settings presents English only
and saves en when accepted. resolveLocale/setLocale retain their call contracts for
legacy callers. The legacy ru catalog module re-exports English. Interpolation never
translates, normalizes or otherwise transforms book titles, content, paths or names.

OS-native dialogs and regional dates produced by the upstream FileUpload control
may follow Windows/WebView conventions. Application-owned labels remain English;
owned byte-size formatting uses en-US. The app does not patch global Intl behavior,
WebView language internals, native security defaults or upstream date-row markup.
