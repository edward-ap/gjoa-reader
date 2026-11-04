import { EventBus } from "./EventBus.js";

export class GridDataProvider {
  constructor(load) {
    if (typeof load !== "function") throw new TypeError("GridDataProvider requires a load function.");
    this.events = new EventBus();
    this._load = load;
    this._controller = null;
    this.loading = false;
    this.destroyed = false;
  }
  async request(request, options = {}) {
    if (this.destroyed) throw new Error("GridDataProvider is destroyed.");
    this._controller?.abort();
    const controller = new AbortController();
    this._controller = controller;
    const abort = () => controller.abort();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    this.loading = true;
    this.events.emit("loading", { source:this, request });
    try {
      controller.signal.throwIfAborted();
      const result = await this._load(request, { ...options, signal:controller.signal });
      controller.signal.throwIfAborted();
      if (!result || !Array.isArray(result.items)) {
        throw new TypeError("GridDataProvider result requires items array.");
      }
      const response = { items:result.items, totalCount:Number(result.totalCount ?? result.items.length),
        page:result.page ?? request.page ?? 1, pageSize:result.pageSize ?? request.pageSize ?? null };
      this.events.emit("load", { source:this, request, response });
      return response;
    } catch (error) {
      if (error?.name !== "AbortError" && !controller.signal.aborted && !this.destroyed) this.events.emit("error", { source:this, request, error });
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (this._controller === controller) {
        this._controller = null;
        this.loading = false;
      }
    }
  }
  destroy() {
    if (this.destroyed) return;
    this._controller?.abort();
    this._controller = null;
    this.loading = false;
    this.destroyed = true;
    this.events.destroy();
  }
}
