export class DisposableBag {
  constructor() {
    this._items = new Set();
    this._disposed = false;
  }

  get disposed() {
    return this._disposed;
  }

  add(disposable) {
    if (!disposable) {
      return disposable;
    }

    if (this._disposed) {
      this._disposeOne(disposable);
      return disposable;
    }

    this._items.add(disposable);
    return disposable;
  }

  addEventListener(target, type, handler, options) {
    target.addEventListener(type, handler, options);

    return this.add({
      dispose: () => target.removeEventListener(type, handler, options)
    });
  }

  clear() {
    for (const item of Array.from(this._items).reverse()) {
      this._disposeOne(item);
    }

    this._items.clear();
  }

  dispose() {
    if (this._disposed) {
      return;
    }

    this._disposed = true;
    this.clear();
  }

  _disposeOne(item) {
    try {
      if (typeof item === "function") {
        item();
        return;
      }

      if (item && typeof item.dispose === "function") {
        item.dispose();
        return;
      }

      if (item && typeof item.off === "function") {
        item.off();
      }
    } catch (error) {
      console.error("Disposable cleanup failed", error);
    }
  }
}
