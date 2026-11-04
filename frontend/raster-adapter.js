let renderTail = Promise.resolve();

export function createPageRenderer(invoke, { documentId, pageIndex, appearance = () => 'original' }, onTiming = () => {}) {
  // Serialize native requests; a superseded queued request never enters Rust.
  return async request => {
    const { signal, targetWidth, targetHeight } = request;
    signal.throwIfAborted();
    const start = performance.now(), pageAppearance = appearance();
    const work = renderTail.then(() => {
      signal.throwIfAborted();
      return invoke('render_page', { documentId, pageIndex, targetWidth, targetHeight, appearance: pageAppearance });
    });
    renderTail = work.catch(() => {});
    const buffer = await work;
    signal.throwIfAborted();
    if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== targetWidth * targetHeight * 4) {
      throw new Error('Invalid binary RGBA response');
    }
    const pixels = new ImageData(new Uint8ClampedArray(buffer), targetWidth, targetHeight);
    const image = await createImageBitmap(pixels);
    if (signal.aborted) {
      image.close();
      signal.throwIfAborted();
    }
    onTiming({ milliseconds: performance.now() - start, bytes: buffer.byteLength, width: targetWidth, height: targetHeight });
    return { image, owned: true };
  };
}
