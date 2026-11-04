import { localize } from "./localize.js";
import { BaseControl } from "../core/BaseControl.js";
import { CommandRegistry } from "../core/CommandRegistry.js";
import { ShortcutManager } from "../core/ShortcutManager.js";
import { TreeGrid } from "./TreeGrid.js";
import { gridEditors } from "./GridEditors.js";
import { IconButton } from "./IconButton.js";
import { ContextMenu } from "./Menu.js";
import { MemoryResourceProvider, resourceId, validateResources } from "./resourceModel.js";

const commands = [
  ["open", "Open", "Enter"], ["newFolder", "New Folder", "Ctrl+Shift+N"],
  ["newFile", "New File"], ["importFile", "Import File\u2026"], ["addExisting", "Add Existing\u2026"],
  ["rename", "Rename", "F2"], ["delete", "Delete", "Delete"],
  ["cut", "Cut", "Ctrl+X"], ["copy", "Copy", "Ctrl+C"], ["paste", "Paste", "Ctrl+V"],
  ["properties", "Properties"], ["refresh", "Refresh"]
];
const creation = ["newFolder", "newFile", "importFile", "addExisting"];
const userAction = { origin: "user", userAction: true };

/** A resource command surface composed around TreeGrid; experimental. */
export class TreeExplorer extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer = typeof containerOrOptions === "string" ||
      typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement;
    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};
    super(options);
    this.provider = options.provider ?? new MemoryResourceProvider();
    if (typeof this.provider.execute !== "function") throw new TypeError("TreeExplorer provider requires execute(request).");
    this._busy = false;
    this._editId = null;
    this._transient = null;
    this._clipboard = null;
    this._contextId = null;
    this._writing = false;
    this._generation = 0;
    this._pending = null;
    this._rowIds = new WeakMap();
    this.grid = new TreeGrid({
      rowHeight: options.rowHeight,
      indicatorGutter: false, columnMenu: false, columnReorder: false, textField: "name", treeColumnId: "name", expandAll: options.expandAll !== false,
      nodeIcon: options.nodeIcon ?? (item => item.kind === "folder" ? "folder" : "file"),
      columns: [
        { id: "name", field: "name", title: localize(this.options, "Name"), width: "1fr", editor: gridEditors.text(),
          render: options.renderName ? (_, item) => options.renderName(item) : undefined,
          readOnly: item => this._busy || (!Object.is(this._transient, item.id) && !this.canExecute("rename", item.id)) },
        ...(options.renderDetail ? [{ id: "detail", title: "", width: options.detailWidth ?? 58, render: (_, item) => options.renderDetail(item) }] : []),
        { id: "actions", title: "", width: 30, minWidth: 30, resizable: false, sortable: false,
          render: (_, item) => {
            const button = document.createElement("button");
            button.type = "button"; button.className = "dui-tree-explorer__row-menu dui-tree-explorer__menu-button";
            button.textContent = "\u22ef"; button.setAttribute("aria-label", localize(this.options, "Actions for {name}", { name: item.name }));
            button.setAttribute("aria-haspopup", "menu");
            this._rowIds.set(button, item.id);
            return button;
          } }
      ]
    });
    this.grid.data.parse(validateResources(options.items ?? []));
    if (options.expandAll !== false) this.grid.expandAll({ silent: true });
    this.commands = new CommandRegistry({ contextProvider: { getContext: () => ({ id: this._contextId }) } });
    for (const [id, label, shortcut] of commands) {
      this.commands.register(id, { label: localize(this.options, label), shortcut,
        enabled: context => this.canExecute(id, context.id ?? null),
        run: context => this.execute(id, context.id ?? null) });
    }
    this.menu = new ContextMenu({ commands: this.commands });
    this.shortcuts = new ShortcutManager({ commands: this.commands, autoListen: false });
    this.shortcuts.bindCommands();
    this.disposables.add(this.grid.events.on("activeChange", event => { this._contextId = event.id; this.commands.refreshState(); }));
    this.disposables.add(this.grid.events.on("selectionChange", () => { this._contextId = this.grid.getSelectedIds()[0] ?? null; this.commands.refreshState(); }));
    this.disposables.add(this.grid.events.on("editStart", event => { this._editId = event.id; }));
    this.disposables.add(this.grid.events.on("beforeCellChange", event => {
      event.cancel = true;
      if (!this._busy) void this._commitName(event.id, event.newValue);
    }));
    this.disposables.add(this.grid.events.on("editCancel", () => this._cancelDraft()));
    this.disposables.add(this.grid.data.events.on("invalidate", () => {
      if (!this._writing) {
        this._generation++; this._pending?.abort(); this._pending = null;
        this._setBusy(false); this._clipboard = null;
      }
    }));
    if (hasContainer) this.mount(containerOrOptions);
  }

  get busy() { return this._busy; }
  getResources() { return this.grid.data.all().filter(item => !Object.is(item.id, this._transient)).map(item => ({ ...item })); }
  setResources(items) {
    this._assertMutable("setResources");
    const next = validateResources(items);
    this._generation++; this._pending?.abort(); this._pending = null;
    this._cancelDraft();
    this._clipboard = null;
    this.menu.close({ silent: true });
    this._showMessage("");
    this._write(next); this._setBusy(false);
  }

  createElement() {
    const root = super.createElement(); root.classList.add("dui-tree-explorer");
    const header = document.createElement("div"); header.className = "dui-tree-explorer__header";
    if (this.options.showHeader === false) { header.hidden = true; header.style.display = "none"; root.style.gridTemplateRows = "minmax(0, 1fr) auto"; }
    const title = document.createElement("span"); title.textContent = this.options.title ?? localize(this.options, "Library");
    header.append(title);
    const create = new IconButton({ text: localize(this.options, "Create resource"), icon: "add", onClick: () => this._anchorMenu(this._createButton.element, this._contextId, true) });
    const more = new IconButton({ text: localize(this.options, "Library actions"), css: "dui-tree-explorer__menu-button", onClick: () => this._anchorMenu(this._moreButton.element, this._contextId) });
    this._createButton = create; this._moreButton = more;
    create.mount(header); more.mount(header);
    // The ellipsis is an icon-like glyph, while IconButton supplies the accessible button contract.
    const glyph = document.createElement("span"); glyph.textContent = "\u22ef"; glyph.setAttribute("aria-hidden", "true"); more.element.replaceChildren(glyph);
    create.element.setAttribute("aria-haspopup", "menu"); more.element.setAttribute("aria-haspopup", "menu");
    const body = document.createElement("div"); body.className = "dui-tree-explorer__body";
    this._message = document.createElement("div"); this._message.className = "dui-tree-explorer__message";
    this._message.setAttribute("role", "status"); this._message.setAttribute("aria-live", "polite");
    root.append(header, body, this._message);
    this.grid.mount(body); this.menu.mount(root);
    this.grid.element.style.gridTemplateRows = "0 minmax(0, 1fr)";
    this.grid.element.querySelector(".dui-grid__header").setAttribute("aria-hidden", "true");
    this.grid.element.setAttribute("aria-label", this.options.title ?? localize(this.options, "Library"));
    if (this.options.dragDrop) {
      this.disposables.addEventListener(body, "pointerdown", event => {
        const row = event.target.closest('.dui-grid__row');
        if (row) row.draggable = this.canExecute('cut', this._idAt(event.target));
      });
      this.disposables.addEventListener(body, "dragstart", event => {
        const id = this._idAt(event.target);
        if (!this.canExecute('cut', id)) { event.preventDefault(); return; }
        this._dragId = id; event.dataTransfer.setData('text/plain', String(id)); event.dataTransfer.effectAllowed = 'move';
      });
      this.disposables.addEventListener(body, "dragover", event => {
        if (this._dragId != null && this.grid.data.get(this._idAt(event.target))?.kind === 'folder') event.preventDefault();
      });
      this.disposables.addEventListener(body, "drop", event => {
        if (this._dragId == null) return;
        event.preventDefault(); const id = this._dragId; this._dragId = null;
        void this.moveResource(id, this._idAt(event.target));
      });
      this.disposables.addEventListener(body, "dragend", () => { this._dragId = null; });
    }
    this.disposables.addEventListener(root, "contextmenu", event => {
      if (!body.contains(event.target) || event.target.closest("input,textarea,[contenteditable=true]")) return;
      event.preventDefault(); this._openMenu(this._idAt(event.target), event.clientX, event.clientY);
    });
    this.disposables.addEventListener(root, "click", event => {
      const button = event.target.closest(".dui-tree-explorer__row-menu");
      if (button) { event.stopPropagation(); this._anchorMenu(button, this._rowIds.get(button)); }
    }, true); // Read the anchor before TreeGrid selection replaces the row DOM.
    this.disposables.addEventListener(root, "keydown", event => {
      if (!body.contains(event.target) || event.target.closest("input,textarea,select,[contenteditable=true]")) return;
      if (event.target.closest("button") && !["ContextMenu", "F10"].includes(event.key)) return;
      if (["ArrowLeft", "ArrowRight"].includes(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault(); event.stopPropagation();
        if (this.disabled || this._busy) return;
        const item = this.grid.treeView.get(this._contextId) ?? this.grid.treeView.all()[0];
        if (!item) return;
        if (event.key === "ArrowRight") {
          if (this.grid.treeView.hasChildren(item.id) && !this.grid.isExpanded(item.id)) this.grid.expand(item.id, userAction);
          else {
            const child = this.grid.treeView.all().find(node => Object.is(node.parentId, item.id));
            if (child) this.grid.selectById(child.id, userAction);
          }
        } else if (this.grid.treeView.hasChildren(item.id) && this.grid.isExpanded(item.id)) this.grid.collapse(item.id, userAction);
        else if (item.parentId != null) this.grid.selectById(item.parentId, userAction);
        return;
      }
      if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) {
        event.preventDefault(); event.stopPropagation();
        const id = this._idAt(event.target) ?? this._contextId;
        const active = document.getElementById(this.grid.element.getAttribute("aria-activedescendant"));
        const anchor = active && body.contains(active) ? active.closest(".dui-grid__row") : event.target;
        this._anchorMenu(anchor, id); return;
      }
      if (this.shortcuts.handleKeyboardEvent(event)) event.stopPropagation();
      else if (["Enter", "F2", "Delete"].includes(event.key)) { event.preventDefault(); event.stopPropagation(); }
    }, true);
    return root;
  }

  _idAt(target) {
    const row = target.closest(".dui-grid__row");
    const button = row?.querySelector(".dui-tree-explorer__row-menu");
    return button ? this._rowIds.get(button) ?? null : null;
  }
  _parent(id) {
    const item = this.grid.data.get(id);
    return item?.kind === "folder" ? item.id : item?.parentId ?? null;
  }
  async moveResource(id, targetId) {
    if (!this.canExecute('cut', id) || this.grid.data.get(targetId)?.kind !== 'folder') return false;
    const clipboard = this._clipboard;
    this._clipboard = { id, mode: 'cut' };
    if (!this.canExecute('paste', targetId)) { this._clipboard = clipboard; return false; }
    return this.execute('paste', targetId);
  }
  canExecute(command, id = this._contextId) {
    if (this.destroyed || this.disabled || this._busy || this._editId != null) return false;
    const item = this.grid.data.get(id) ?? null;
    if (["open", "rename", "delete", "cut", "copy", "properties"].includes(command) && !item) return false;
    if (command === "paste" && (!this._clipboard || item?.kind === "file")) return false;
    if (!commands.some(definition => definition[0] === command)) return false;
    const context = { id, item: item ? { ...item } : null, parentId: this._parent(id), clipboard: this._clipboard ? { ...this._clipboard } : null };
    return this.provider.canExecute?.(command, context) !== false && !this.destroyed;
  }
  async execute(command, id = this._contextId) {
    if (!this.canExecute(command, id)) return false;
    if (command === "rename") return this.grid.startEdit(id, "name", userAction);
    if (command === "newFolder" || command === "newFile") return this._createDraft(id, command === "newFolder" ? "folder" : "file");
    if (command === "cut" || command === "copy") { this._clipboard = { id, mode: command }; this.commands.refreshState(); return true; }
    if (command === "open" && this.grid.data.get(id)?.kind === "folder") this.grid.expand(id, userAction);
    const operation = command === "paste" ? this._clipboard.mode === "cut" ? "move" : "copy" : command;
    return this._perform({ command: operation, id, parentId: this._parent(id), clipboard: this._clipboard ? { ...this._clipboard } : null }, command === "paste");
  }
  _createDraft(id, kind) {
    const items = this.getResources(), parentId = this._parent(id);
    const base = kind === "folder" ? "New Folder" : "New File";
    let name = base, suffix = 2;
    while (items.some(item => Object.is(item.parentId, parentId) && item.name === name)) name = `${base} ${suffix++}`;
    const draft = { id: resourceId(items), name, parentId, kind };
    this._transient = draft.id;
    this._write([...items, draft]);
    if (parentId != null) this.grid.expand(parentId);
    this.grid.selectById(draft.id);
    if (!this.grid.startEdit(draft.id, "name", userAction)) { this._cancelDraft(); return false; }
    return true;
  }
  _cancelDraft() {
    this._generation++; this._pending?.abort(); this._pending = null;
    const transient = this._transient;
    this._transient = null; this._editId = null;
    this.grid.cancelEdit({ silent: true });
    if (transient != null) this._write(this.grid.data.all().filter(item => !Object.is(item.id, transient)));
    this._setBusy(false);
  }
  async _commitName(id, value) {
    const item = this.grid.data.get(id);
    if (!item) return false;
    const name = String(value ?? "").trim();
    if (!name) { this._showMessage("Enter a name."); return false; }
    return this._perform({ command: Object.is(id, this._transient) ? "create" : "rename", id,
      name, kind: item.kind, parentId: item.parentId });
  }
  async _perform(operation, clearClipboard = false) {
    if (this._busy || this.destroyed) return false;
    const generation = ++this._generation;
    const controller = new AbortController(); this._pending = controller;
    const items = this.getResources();
    this._setBusy(true); this._showMessage("Working\u2026");
    try {
      const result = await this.provider.execute({ ...operation, items, signal: controller.signal });
      if (this.destroyed || generation !== this._generation || controller.signal.aborted) return false;
      if (result === false) throw new Error("Operation was rejected.");
      if (["create", "rename", "delete", "move", "copy"].includes(operation.command) && !result?.items) {
        throw new Error("Mutation provider must return { items, selectId? }.");
      }
      const next = result?.items ? validateResources(result.items) : null;
      const wasEditing = this._editId != null;
      if (next) {
        this._transient = null; this._editId = null;
        this.grid.cancelEdit({ silent: true });
        this._write(next);
        if (operation.parentId != null) this.grid.expand(operation.parentId);
        if (result.selectId != null) this.grid.selectById(result.selectId);
      }
      if (clearClipboard && this._clipboard?.mode === "cut") this._clipboard = null;
      this._setBusy(false); this._showMessage("");
      if (wasEditing && !this.destroyed) this.grid.element?.focus({ preventScroll: true });
      this.events.emit("operation", { source: this, command: operation.command, id: operation.id, result });
      return true;
    } catch (error) {
      if (this.destroyed || generation !== this._generation || controller.signal.aborted) return false;
      this._showMessage(error instanceof Error ? error.message : String(error));
      this._setBusy(false);
      this.events.emit("operationError", { source: this, command: operation.command, id: operation.id, error });
      return false;
    } finally {
      if (!this.destroyed && generation === this._generation) { this._pending = null; this._setBusy(false); }
    }
  }
  _write(items) {
    this._writing = true;
    try { this.grid.data.parse(items); } finally { this._writing = false; }
  }
  _showMessage(message) { if (this._message) this._message.textContent = message; }
  _setBusy(value) {
    const changed = this._busy !== value;
    this._busy = value;
    if (changed && !this.destroyed && !this.commands?.destroyed) this.commands?.refreshState();
    this.element?.setAttribute("aria-busy", String(value));
    for (const input of this.grid?.element?.querySelectorAll(".dui-grid__editor-host input") ?? []) input.readOnly = value;
  }
  _anchorMenu(anchor, id, create = false) {
    const rect = anchor.getBoundingClientRect();
    this._openMenu(id, rect.left, rect.bottom, create);
  }
  _openMenu(id, x, y, create = false) {
    if (this.destroyed || this.disabled || this._busy || this._editId != null) return;
    this._contextId = id ?? null;
    if (id != null) this.grid.selectById(id); else this.grid.clearSelection();
    const item = this.grid.data.get(id);
    const list = create ? creation : !item ? ["newFolder", "paste", "refresh"] : ["open", ...(item.kind === "folder" ? ["newFolder"] : []), null,
      "rename", "delete", null, "cut", "copy", ...(item.kind === "folder" ? ["paste"] : []), null, "properties"];
    this.menu.setItems(list.map(command => command ? { command } : { type: "separator" }));
    this.menu.openAt(x, y, userAction);
  }
  _applyDisabledState() {
    super._applyDisabledState();
    for (const child of [this.grid, this._createButton, this._moreButton]) {
      if (child && !child.destroyed) child[this.disabled ? "disable" : "enable"]();
    }
    if (this.disabled) { this.menu?.close({ silent: true }); this._cancelDraft(); }
  }
  destroy() {
    if (this.destroyed) return;
    this._generation++; this._pending?.abort();
    this.shortcuts.destroy(); this.menu.destroy();
    this._createButton?.destroy(); this._moreButton?.destroy();
    this.grid.destroy(); this.commands.destroy();
    super.destroy();
  }
}
