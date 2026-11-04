# Local Painter extension

Painter is an SVG annotation control maintained in this application. Its public
entry is `extensions/painter/index.js`, declarations are in `index.d.ts`, and its
matching stylesheet is `styles.css`. The viewport extension is independent:
importing Painter does not import a raster provider, page cache, or native bridge.

The implementation was extracted from the archived Dense UI Painter under MIT.
`extensions/painter/provenance.json` records original relative filenames and
SHA-256 values, the adaptations, and the pinned Tæt UI foundation revision.
The adjacent `LICENSE` retains the original notice. This is an application-local
extension, not an API supplied by the published Tæt UI 0.6.0 release.

## Composition and ownership

Painter extends only the public `BaseControl` exported by `taet-ui/foundation`.
The application's import map must resolve that entry to the same module instance
as its other Tæt UI controls. The extension imports no private framework source
paths, mutation hooks, disabled-state hooks, or destruction flags. It has its own
mutation/teardown guard and uses public `enable`, `disable`, `mount`, `destroy`,
`events`, and `disposables` contracts. The tiny local SVG builder creates trusted
SVG elements and writes text with `textContent`; it does not evaluate markup.

The application supplies a mounted overlay container, logical area dimensions and
a transform. It owns the background page, page-to-screen geometry, persistence,
book identity, toolbar/palette, and whether the active page is ready for editing.
Painter owns its DOM, pointer capture, temporary drawing/text drafts, selection,
committed model, and bounded undo/redo history. Destroy Painter explicitly or put
it under a real control owner. A `DisposableBag` holding a borrowed control needs
`() => painter.destroy()`, not the control object itself.

```js
import {Painter} from './extensions/painter/index.js';

const layer = new Painter(overlay, {
  areaWidth: page.width,
  areaHeight: page.height,
  label: 'Page annotations'
});
layer.importJSON(savedDocument, {silent: true});
layer.setTransform({scale: zoom, offsetX: pageX, offsetY: pageY});
layer.setTool('pen');
layer.setToolSettings({color: '#b3261e', strokeWidth: 2});
layer.setMode('edit');
const change = layer.events.on('change', ({document}) => save(document));
// Screen teardown: change.dispose() and layer.destroy(), or an owning container.
```

An annotation layer in `view` mode is transparent to input. In `edit` mode its
logical area and annotation objects accept drawing input. The caller decides when
to disable page-edge navigation. Painter never pans or zooms the background.

## Coordinates and persisted document

All stored geometry uses logical page units, independently of browser device
pixels. A transform maps logical coordinates to CSS viewport pixels:
`screen = logical * scale + offset`. `logicalToViewport` and `viewportToLogical`
are inverse mappings. Changing the transform cancels a draft without moving any
committed object. Resizing the logical area validates the complete current model
before committing; shrinking past existing content fails atomically.

`getDocument` returns a detached object; `exportJSON` returns its JSON encoding.
The persisted contract remains `kind: 'DenseUI.Painter', version: 1`, with
`width`, `height`, and ordered `objects`. IDs are nonempty unique strings.
Recognized persisted object types are `pen`, `marker`, `line`, `arrow`,
`rectangle`, `ellipse`, and `text`. A style contains six-digit hex `color`,
`strokeWidth`, `opacity`, and `fontSize`; optional `dash: 'dashed'` survives
round-trips. An omitted dash remains solid and explicit `solid` is normalized to
the legacy omitted representation. `square` and `circle` are constrained tools
that serialize as rectangle and ellipse. Selection and eraser are transient tools
and never appear in saved objects. Text remains plain text, including characters
that look like HTML.

The codec bounds area dimensions, finite coordinates, styles and transforms. A
document has at most 5,000 objects, a stroke at most 10,000 points, total points at
most 200,000, IDs at most 128 UTF-16 code units, and text at most 10,000 UTF-16 code
units. The native application additionally validates page geometry, UTF-8 ID size
and an 8 MiB serialized page limit before storage. Those native checks remain the
authority for data written to `annotations.sqlite`; the extension does not open
that store. Import validates a whole replacement before changing live state,
clears selection/history, and can be silent to avoid saving an already-saved page
again. Invalid imports leave the preceding model and history intact.

## Gestures, history and notifications

Pointer motion updates a transient preview; a completed drawing, object move,
group move or eraser sweep produces one committed document change. Escape,
pointer cancellation, disable, mode/transform changes and teardown cancel the
draft. Area selection changes only selection, not the persisted document. The
eraser hides touched objects during a sweep and deletes them atomically on
completion; cancellation restores their visibility. Constrained shapes stay within
the logical page. Each marker receives its own multiply plane in source order so
it composites correctly with ordinary annotations between markers.

`change` carries a detached `document`; `selectionChange` carries `id` and `ids`;
`historyChange` carries `canUndo` and `canRedo`; `error` carries the validation
error. Notifications include `source`, `origin`, and `userAction` where applicable.
Silent model import/mutations update state without semantic save notifications.
Every notification boundary checks whether application code destroyed the control.

History defaults to 50 committed states, accepts a configured limit of 0–200, and
is also capped at 8 MiB of estimated JSON UTF-16 history memory. A new edit after
undo discards the redo branch. Undo/redo uses physical `KeyZ`/`KeyY` codes across
keyboard layouts; the textarea retains its own normal editing keys. Ctrl/Cmd+Enter
commits a text draft, while Escape cancels it. No physical IME or accessibility
certification follows from the synthetic keyboard tests.

## Validation

- `tests/painter-geometry.test.mjs`: pure codec/geometry bounds, detached values,
  legacy dash representation and persisted primitive types.
- `tests/painter-model.test.mjs`: archived meaningful model regressions adapted to
  this entry, plus public lifecycle/reentrant teardown protection. The project's
  Dense loader resolves the pinned public foundation for these Node tests.
- `tests/painter.browser.test.mjs`: the actual extension with the built import
  map and synthetic page geometry. Headless Edge pointer input covers graphical
  tools, zoom mapping, area/group operations, eraser/undo/cancellation, dashed and
  constrained shapes, text safety, history key dispatch, public disable/teardown,
  multiply-plane styling and transparent view-mode hit testing.

These browser checks exercise browser-dispatched pointer/keyboard operations,
not a mocked Painter. They do not establish physical pen/touch/IME behavior,
native WebView2 restart/storage compatibility, macOS support, or full cross-engine
acceptance. The application's separate host/annotation integration tests cover the
boundary with its raster viewport and persistence bridge.
