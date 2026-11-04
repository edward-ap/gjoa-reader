export class EventBus {
  constructor() {
    this._handlers = new Map();
    this._destroyed = false;
  }

  get destroyed() {
    return this._destroyed;
  }

  on(eventName, handler) {
    this._assertUsable();
    this._assertEventName(eventName);

    if (typeof handler !== "function") {
      throw new TypeError("Event handler must be a function.");
    }

    let handlers = this._handlers.get(eventName);

    if (!handlers) {
      handlers = new Set();
      this._handlers.set(eventName, handlers);
    }

    handlers.add(handler);

    let disposed = false;
    const dispose = () => {
      if (disposed) {
        return;
      }

      disposed = true;
      this.off(eventName, handler);
    };

    return {
      off: dispose,
      dispose
    };
  }

  once(eventName, handler) {
    let subscription;

    subscription = this.on(eventName, event => {
      subscription.off();
      handler(event);
    });

    return subscription;
  }

  off(eventName, handler) {
    const handlers = this._handlers.get(eventName);

    if (!handlers) {
      return;
    }

    handlers.delete(handler);

    if (handlers.size === 0) {
      this._handlers.delete(eventName);
    }
  }

  emit(eventName, event = {}) {
    this._assertUsable();
    this._assertEventName(eventName);

    if (!event || typeof event !== "object" || Array.isArray(event)) {
      throw new TypeError("Event payload must be an object.");
    }

    if (!event.type) {
      event.type = eventName;
    }

    const handlers = this._handlers.get(eventName);

    if (!handlers || handlers.size === 0) {
      return event;
    }

    for (const handler of Array.from(handlers)) {
      handler(event);
    }

    return event;
  }

  // Internal committed-transfer delivery. Ordinary emit remains fail-fast.
  _emitCollect(eventName, event, notificationErrors, current = () => true) {
    if (this._destroyed) return event;
    if (!event.type) event.type = eventName;
    for (const handler of Array.from(this._handlers.get(eventName) ?? [])) {
      if (this._destroyed || !current()) break;
      try { handler(event); } catch (error) { notificationErrors.push(error); }
    }
    return event;
  }

  clear() {
    this._handlers.clear();
  }

  destroy() {
    if (this._destroyed) {
      return;
    }

    this._destroyed = true;
    this.clear();
  }

  _assertUsable() {
    if (this._destroyed) {
      throw new Error("EventBus has been destroyed.");
    }
  }

  _assertEventName(eventName) {
    if (typeof eventName !== "string" || eventName.length === 0) {
      throw new TypeError("Event name must be a non-empty string.");
    }
  }
}
