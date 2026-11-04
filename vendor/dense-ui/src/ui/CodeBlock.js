import { BaseControl } from "../core/BaseControl.js";

export class CodeBlock extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);
    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.language = options.language ?? "text";
    this.copyButton = options.copyButton !== false;
    this._code = String(options.code ?? options.value ?? "");
    this._codeElement = null;
    this._copyElement = null;
    this.value = Object.freeze({
      get: () => this._code,
      set: (value, mutationOptions) => this.setCode(value, mutationOptions),
      clear: mutationOptions => this.setCode("", mutationOptions)
    });

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("section");
    root.className = "dui-control dui-code-block";
    root.dataset.duiControlId = this.id;

    const header = document.createElement("header");
    header.className = "dui-code-block__header";

    const language = document.createElement("span");
    language.className = "dui-code-block__language";
    language.textContent = this.language;
    header.append(language);

    if (this.copyButton) {
      const copy = document.createElement("button");
      copy.className = "dui-code-block__copy";
      copy.type = "button";
      copy.textContent = "Copy";
      copy.setAttribute("aria-label", "Copy source code");
      this.disposables.addEventListener(copy, "click", () => void this.copy());
      header.append(copy);
      this._copyElement = copy;
    }

    const pre = document.createElement("pre");
    pre.className = "dui-code-block__pre";
    pre.tabIndex = 0;
    pre.setAttribute("aria-label", `Read-only ${this.language} code`);
    pre.setAttribute("aria-readonly", "true");

    const code = document.createElement("code");
    code.className = `language-${normalizeLanguageClass(this.language)}`;
    code.textContent = this._code;
    pre.append(code);
    root.append(header, pre);

    this._codeElement = code;
    return root;
  }

  setCode(code, options = {}) {
    this._assertMutable("value.set");
    const oldValue = this._code;
    const newValue = String(code ?? "");

    if (oldValue === newValue) {
      return false;
    }

    this._code = newValue;
    if (this._codeElement) {
      this._codeElement.textContent = newValue;
    }

    if (!options.silent) {
      this.events.emit("change", {
        source: this,
        oldValue,
        newValue,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return true;
  }

  async copy(options = {}) {
    this._assertMutable("copy");
    const value = this._code;

    try {
      await writeClipboardText(value);
      if (this.destroyed) return false;
      this._showCopiedState();
      if (!options.silent) this.events.emit("copy", {
        source: this,
        value,
        origin: options.origin ?? "user",
        userAction: options.userAction !== false
      });
      return true;
    } catch (error) {
      if (!this.destroyed && !options.silent) this.events.emit("copyError", {
        source: this,
        error,
        origin: options.origin ?? "user",
        userAction: options.userAction !== false
      });
      return false;
    }
  }

  destroy() {
    clearTimeout(this._copyTimer);
    super.destroy();
    this._codeElement = null;
    this._copyElement = null;
  }

  _showCopiedState() {
    if (!this._copyElement) {
      return;
    }

    this._copyElement.textContent = "Copied";
    clearTimeout(this._copyTimer);
    this._copyTimer = globalThis.setTimeout?.(() => {
      if (this._copyElement) {
        this._copyElement.textContent = "Copy";
      }
    }, 1200);
  }
}

async function writeClipboardText(value) {
  if (globalThis.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(value);
    return;
  }

  throw new Error("Clipboard API is unavailable.");
}

function normalizeLanguageClass(language) {
  return String(language ?? "text").toLowerCase().replace(/[^a-z0-9_-]/g, "-");
}
