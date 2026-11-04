# Local raster viewport extension

This directory documents the application-local, source-neutral raster extension
used with published Tæt UI. Its extraction origin is the archived Dense UI component. It is application-local and MIT-licensed; original relative source names
and SHA-256 values are recorded in provenance.json. Nothing is fetched from an
archive at runtime. Import RenderViewport from extensions/viewport/index.js and
include viewport.css. The module does not import Painter or reader/native code.

## Public foundation boundary

Only BaseControl, LifecycleError and normalizeMutationOptions from the published
taet-ui/foundation entry are used. BaseControl lifecycle, events and disposables
are public. Resize is observed through events rather than a private resize hook.
Private mutation/assert/event binding methods and options writes were removed.
The build must share one foundation instance across the UI and both extensions.

## Host contract and ownership

The host sets a logical content size and renderer(request). A request is frozen
and includes requestId, logical content size, CSS viewport size, zoom, DPR, bounded
targetWidth/targetHeight, AbortSignal and reason/origin/userAction metadata.
Return { image, owned? }; ImageData, canvas, OffscreenCanvas, loaded HTMLImageElement
and ImageBitmap are accepted. Only an ImageBitmap with owned:true transfers
ownership. Borrowed images are never closed. Converted ImageData backing canvases
are disposed by the extension. Supersession/destroy abort pending work; a late
owned result is closed once and cannot set ready or replace pixels. Reusing the
current bitmap preserves its transferred ownership until final release.

The previous accepted raster remains visible during a same-content replacement;
setContentSize clears it so pixels from a previous document are not inherited.
RenderComplete is emitted only after the raster swap. Readiness/progress/book
identity stay with ReaderViewHost, not the generic surface.

## Coordinates, bounds and lifecycle

Zoom/pan and viewport/content conversions use CSS pixels and logical content units.
DPR only changes display canvas/raster resolution. Small axes center; large axes
clamp to edges. Fit modes recalculate on resize; manual mode preserves the content
point under the viewport center. Pointer/wheel changes coalesce per animation frame.
Raster allocation is bounded by maxRasterPixels/maxRasterDimension, including a
one-pixel short axis for extremely tall/wide content. The display canvas is sized
to the actual visible surface, never the height of a book.

The owner destroys this control; it then cancels animation/media/DOM subscriptions,
marks the public BaseControl lifecycle destroyed before external abort callbacks,
and releases accepted owned images. Every post-destroy mutation throws LifecycleError.
Events support before-change cancellation and mutation metadata; silent still
updates model/pixels but suppresses semantic notifications. See index.d.ts for
options, event payloads, renderer values and coordinate methods.

## Validation

The ported unit contract covers fit/clamping/anchored zoom/manual resize/raster
limits/getter snapshots/cancellation/metadata/silent mutations/lifecycle. Browser
coverage exercises real Canvas/ImageBitmap acceptance and disposal, stale work,
resize/DPR, pointer/wheel behavior and error recovery. Browser automation is not
physical input, native IME, accessibility or macOS certification.
