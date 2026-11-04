import { pageRasterTargets } from './reader-spread.js';

// Each closure captures immutable page slots for one document/view generation.
// Siblings share an AbortSignal, not a competing "latest page" identity.
export function createSpreadRenderer(geometry, rendererForPage, onComplete = () => {}) {
  const providers = new Map(geometry.slots.filter(slot => slot.pageIndex !== null)
    .map(slot => [slot.pageIndex, rendererForPage(slot.pageIndex)]));
  return async request => {
    const { signal, targetWidth, targetHeight } = request;
    signal.throwIfAborted();
    const targets = pageRasterTargets(geometry, targetWidth, targetHeight);
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Spread composition requires Canvas 2D');
    const started = performance.now(), pages = [];
    try {
      for (const target of targets) {
        signal.throwIfAborted();
        const result = await providers.get(target.pageIndex)({ ...request,
          contentWidth: target.width, contentHeight: target.height,
          targetWidth: target.targetWidth, targetHeight: target.targetHeight });
        try {
          signal.throwIfAborted();
          context.drawImage(result.image, target.x, target.y, target.targetWidth, target.targetHeight);
          pages.push({ pageIndex: target.pageIndex, side: target.side, width: target.targetWidth, height: target.targetHeight,
            bytes: target.targetWidth * target.targetHeight * 4, readyMilliseconds: performance.now() - started });
        } finally {
          if (result.owned) result.image.close();
        }
      }
      signal.throwIfAborted();
      const image = canvas.transferToImageBitmap();
      try {
        onComplete({ requestId: request.requestId, pages, fullMilliseconds: performance.now() - started,
          width: targetWidth, height: targetHeight, compositeBytes: targetWidth * targetHeight * 4 });
        return { image, owned: true };
      } catch (error) { image.close(); throw error; }
    } finally {
      canvas.width = 0; canvas.height = 0;
    }
  };
}
