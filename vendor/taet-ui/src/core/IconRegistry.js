const ICON_NAME = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

export class IconRegistry {
  constructor(definitions = {}) {
    this._definitions = new Map();
    this._aliases = new Map();
    this.registerAll(definitions);
  }

  register(name, definition, options = {}) {
    const normalizedName = normalizeName(name);

    if (!options.replace && (this._definitions.has(normalizedName) || this._aliases.has(normalizedName))) {
      throw new Error(`Icon "${normalizedName}" is already registered.`);
    }

    this._aliases.delete(normalizedName);
    this._definitions.set(normalizedName, validateDefinition(definition));
    return this;
  }

  registerAll(definitions, options = {}) {
    for (const [name, definition] of Object.entries(definitions ?? {})) {
      this.register(name, definition, options);
    }

    return this;
  }

  alias(name, target, options = {}) {
    const normalizedName = normalizeName(name);
    const normalizedTarget = normalizeName(target);

    if (!this.has(normalizedTarget)) {
      throw new Error(`Cannot alias unknown icon "${normalizedTarget}".`);
    }

    if (normalizedName === normalizedTarget || aliasChainContains(this._aliases, normalizedTarget, normalizedName)) {
      throw new Error(`Circular icon alias detected for "${normalizedName}".`);
    }

    if (!options.replace && (this._definitions.has(normalizedName) || this._aliases.has(normalizedName))) {
      throw new Error(`Icon "${normalizedName}" is already registered.`);
    }

    this._definitions.delete(normalizedName);
    this._aliases.set(normalizedName, normalizedTarget);
    return this;
  }

  has(name) {
    try {
      return this.resolve(name) != null;
    } catch {
      return false;
    }
  }

  resolve(name) {
    let current = normalizeName(name);
    const visited = new Set();

    while (this._aliases.has(current)) {
      if (visited.has(current)) {
        throw new Error(`Circular icon alias detected for "${current}".`);
      }

      visited.add(current);
      current = this._aliases.get(current);
    }

    return this._definitions.get(current) ?? null;
  }

  unregister(name) {
    const normalizedName = normalizeName(name);
    const removed = this._definitions.delete(normalizedName) || this._aliases.delete(normalizedName);

    let changed = true;
    while (changed) {
      changed = false;
      for (const alias of this._aliases.keys()) {
        if (this.resolve(alias) == null) {
          this._aliases.delete(alias);
          changed = true;
        }
      }
    }

    return removed;
  }

  list() {
    return [...new Set([...this._definitions.keys(), ...this._aliases.keys()])].sort();
  }
}

function aliasChainContains(aliases, start, expected) {
  const visited = new Set();
  let current = start;

  while (aliases.has(current) && !visited.has(current)) {
    if (current === expected) return true;
    visited.add(current);
    current = aliases.get(current);
  }

  return current === expected;
}

function normalizeName(name) {
  const normalized = String(name ?? "").trim().toLowerCase();

  if (!ICON_NAME.test(normalized)) {
    throw new TypeError(`Invalid icon name "${name}". Use lowercase names such as "save" or "window.close".`);
  }

  return normalized;
}

function validateDefinition(definition) {
  if (!definition || typeof definition !== "object" || !Array.isArray(definition.nodes)) {
    throw new TypeError("Icon definition must contain a nodes array.");
  }

  const viewBox = String(definition.viewBox ?? "0 0 24 24");
  const nodes = definition.nodes.map(node => {
    if (!Array.isArray(node) || typeof node[0] !== "string" || !node[1] || typeof node[1] !== "object") {
      throw new TypeError("Each icon node must be [tagName, attributes].");
    }

    return Object.freeze([node[0], Object.freeze({ ...node[1] })]);
  });

  return Object.freeze({ viewBox, nodes: Object.freeze(nodes) });
}
