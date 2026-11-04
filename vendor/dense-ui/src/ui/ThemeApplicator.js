const roles = ['primary', 'secondary', 'tertiary', 'accent'];
const attribute = 'data-dui-theme-owner';
let sequence = 0;

// Presentation is explicit: DOM depth never determines the palette role.
const parts = {
  surface: s => `${s}{background:var(--dui-color-focus-bg);border-color:var(--dui-window-border)}`,
  fieldGroup: s => `${s}{border-color:var(--dui-window-border)}${s}>.dui-field-group__title{background:var(--dui-window-header-bg);color:var(--dui-window-header-text);padding:3px 8px}`,
  dialog: s => `${s}{--dui-window-footer-bg:var(--dui-color-focus-bg)}`,
  sidePanel: s => `${s}{--dui-color-surface:var(--dui-color-focus-bg);--dui-color-border-strong:var(--dui-window-border);--dui-color-primary-soft:var(--dui-color-focus-bg);--dui-color-primary:var(--dui-color-focus-border)}`,
  progress: s => `${s} .dui-progress-bar__track{background:var(--dui-button-bg);box-shadow:inset 0 0 0 1px var(--dui-color-border-strong)}${s} .dui-progress-bar__fill{background:var(--dui-color-focus-border)}`
};

function declarations(tokens) {
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) throw new TypeError('Expected theme token map');
  return Object.entries(tokens).map(([name, value]) => {
    if (!/^--dui-[a-zA-Z0-9-]+$/.test(name) || typeof value !== 'string' || !/^#[a-f0-9]{6}$/i.test(value)) {
      throw new TypeError(`Invalid theme color token: ${name}`);
    }
    return `${name}:${value}`;
  }).join(';');
}

/** Experimental host adapter. Scopes are trusted application configuration. */
export class ThemeApplicator {
  constructor(target, {scopes = []} = {}) {
    const root = target?.element ?? target;
    if (!root?.ownerDocument || !root.style) throw new TypeError('Expected mounted control or HTMLElement');
    if (root.closest(`[${attribute}]`) || root.querySelector(`[${attribute}]`)) throw new Error('A theme applicator already owns this root');
    this._scopes = scopes.map(({selector, role, parts: presentation = []}) => {
      if (typeof selector !== 'string' || !selector.trim() || /[{};]/.test(selector)) throw new TypeError('Invalid theme selector');
      root.querySelector(selector); // Validate even when the dynamic scope does not exist yet.
      if (role !== undefined && !roles.includes(role)) throw new TypeError('Unknown theme role');
      if (!Array.isArray(presentation) || presentation.some(p => !Object.hasOwn(parts, p))) throw new TypeError('Unknown theme part');
      return {selector, role, parts: [...presentation]};
    });
    this._root = root;
    this._id = `dui-theme-${++sequence}`;
    this._style = root.ownerDocument.createElement('style');
    root.ownerDocument.head.append(this._style);
    root.setAttribute(attribute, this._id);
    this.destroyed = false;
    target.disposables?.add(() => this.destroy());
  }

  apply(theme) {
    if (this.destroyed) throw new Error('ThemeApplicator is destroyed');
    if (theme == null) return this.clear();
    // Construct and validate the entire replacement before touching the live sheet.
    const root = `[${attribute}="${this._id}"][${attribute}]`;
    const tokens = declarations(theme.tokens);
    const families = new Map();
    for (const [role, family] of Object.entries(theme.families ?? {})) {
      if (!roles.includes(role)) throw new TypeError('Unknown theme family');
      families.set(role, declarations(family.tokens));
    }
    const rules = [`${root}{${tokens};${families.get('primary') ?? ''}}`];
    for (const scope of this._scopes) {
      const selector = `${root} :is(${scope.selector})`;
      if (scope.role) {
        const family = families.get(scope.role);
        if (family === undefined && families.size) throw new TypeError(`Missing theme family: ${scope.role}`);
        rules.push(`${selector}{${family ?? ''}}`);
      }
      for (const part of scope.parts) rules.push(parts[part](selector));
    }
    this._style.textContent = rules.join('\n');
    return this;
  }

  clear() {
    if (this.destroyed) throw new Error('ThemeApplicator is destroyed');
    this._style.textContent = '';
    return this;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._style.remove();
    if (this._root.getAttribute(attribute) === this._id) this._root.removeAttribute(attribute);
  }
}
