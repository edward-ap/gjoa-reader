import { describeTreeGridMoveSources, planTreeGridMove } from "./GridTreeMove.js";
const DROP_POSITIONS = new Set(["before", "inside", "after"]);
const AUTO_EXPAND_DELAY = 650;

/**
 * Native row drag/drop behavior shared by tree controls.
 *
 * The owner remains responsible for tree mutation through moveNode(). This
 * keeps DOM drag state separate from DataStore and domain-specific rules.
 */
export class TreeNodeDragController {
  constructor(tree) {
    if (!tree) {
      throw new TypeError("TreeNodeDragController requires a Tree owner.");
    }

    this.tree = tree;
    this.state = null;
    this._expandTimer = null;
  }

  attach(row, entry) {
    if (!this.tree?.nodeReorderEnabled) {
      return;
    }

    row.draggable = true;
    row.dataset.duiTreeNodeDraggable = "true";
    row.addEventListener("dragstart", event => this.start(event, entry, row));
    row.addEventListener("dragover", event => this.over(event, entry, row));
    row.addEventListener("dragleave", event => this.leave(event, row));
    row.addEventListener("drop", event => this.drop(event, entry));
    row.addEventListener("dragend", () => this.finish());
  }

  start(event, entry, row) {
    const tree = this.tree;

    if (
      !tree ||
      tree.destroyed || tree._destroyingTree ||
      tree.data.destroyed || tree.data.get(entry.id) !== entry.item ||
      tree.disabled ||
      !tree.nodeReorderEnabled ||
      event.target.closest?.("[data-dui-tree-toggle], button, input, select, textarea, a")
    ) {
      event.preventDefault();
      return false;
    }

    this.finish();
    if (tree !== this.tree || tree.destroyed || tree._destroyingTree || this.state) {
      event.preventDefault();
      return false;
    }
    this.state = {
      sourceId: entry.id,
      targetId: null,
      position: null
    };
    this._draggedItem = entry.item;
    event.dataTransfer?.setData("text/plain", String(entry.id));

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }

    row.classList.add("dui-tree-node--dragging");
    row.setAttribute("aria-grabbed", "true");
    const state = this.state;
    tree.events.emit("nodeDragStart", {
      source: tree,
      id: entry.id,
      item: entry.item,
      nativeEvent: event,
      origin: "user",
      userAction: true
    });
    const active = this.tree === tree && !tree.destroyed && this.state === state;
    if (!active) event.preventDefault();
    return active;
  }

  over(event, targetEntry, row) {
    if (!this.state || !this.tree) {
      return false;
    }
    if (this.tree.destroyed || this.tree.data.destroyed ||
        this.tree.data.get(this.state.sourceId) !== this._draggedItem) {
      this.finish();
      return false;
    }

    const tree = this.tree;
    const state = this.state;
    const position = getDropPosition(event, row);
    const allowed = tree.canMoveNode(
      state.sourceId,
      targetEntry.id,
      position
    );
    if (this.tree !== tree || tree.destroyed || this.state !== state) return false;

    this.clearMarkers();
    this._clearExpandTimer();

    if (!allowed) {
      this.state.targetId = null;
      this.state.position = null;

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "none";
      }
      return false;
    }

    event.preventDefault();

    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }

    row.classList.add(`dui-tree-node--drop-${position}`);
    this.state.targetId = targetEntry.id;
    this.state.position = position;

    if (
      position === "inside" &&
      targetEntry.hasChildren &&
      !targetEntry.expanded
    ) {
      this._expandTimer = setTimeout(() => {
        this._expandTimer = null;
        if (this.tree !== tree || tree.destroyed || this.state !== state ||
            state.targetId !== targetEntry.id || !row.isConnected ||
            tree.data.get(targetEntry.id) !== targetEntry.item) return;
        tree.expand(targetEntry.id, {
          origin: "user",
          userAction: true
        });
      }, AUTO_EXPAND_DELAY);
    }

    return true;
  }

  leave(event, row) {
    if (event.relatedTarget && row.contains(event.relatedTarget)) {
      return;
    }

    row.classList.remove(
      "dui-tree-node--drop-before",
      "dui-tree-node--drop-inside",
      "dui-tree-node--drop-after"
    );
    this._clearExpandTimer();
  }

  drop(event, targetEntry) {
    const tree = this.tree;
    const state = this.state;

    if (
      !tree ||
      !state ||
      tree.destroyed || tree.data.destroyed ||
      tree.data.get(state.sourceId) !== this._draggedItem ||
      tree.data.get(targetEntry.id) !== targetEntry.item ||
      !DROP_POSITIONS.has(state.position) ||
      !Object.is(state.targetId, targetEntry.id)
    ) {
      this.finish();
      return false;
    }

    event.preventDefault();
    try {
      return tree.moveNode(
        state.sourceId,
        targetEntry.id,
        state.position,
        {
          origin: "user",
          userAction: true,
          nativeEvent: event
        }
      );
    } finally {
      if (this.state === state) this.finish();
    }
  }

  clearMarkers() {
    this.tree?.element
      ?.querySelectorAll(
        ".dui-tree-node--drop-before, " +
        ".dui-tree-node--drop-inside, " +
        ".dui-tree-node--drop-after"
      )
      .forEach(row =>
        row.classList.remove(
          "dui-tree-node--drop-before",
          "dui-tree-node--drop-inside",
          "dui-tree-node--drop-after"
        )
      );
  }

  finish() {
    const tree = this.tree;
    const state = this.state;
    const item = this._draggedItem;

    this._clearExpandTimer();
    tree?.element
      ?.querySelectorAll(".dui-tree-node--dragging")
      .forEach(row => {
        row.classList.remove("dui-tree-node--dragging");
        row.removeAttribute("aria-grabbed");
      });
    this.clearMarkers();
    this.state = null;
    this._draggedItem = null;

    if (tree && !tree.destroyed && !tree.data.destroyed && state) {
      tree.events.emit("nodeDragEnd", {
        source: tree,
        id: state.sourceId,
        item: tree.data.get(state.sourceId) === item ? item : null,
        origin: "user",
        userAction: true
      });
    }
  }

  destroy() {
    try { this.finish(); }
    finally { this.tree = null; }
  }

  _clearExpandTimer() {
    if (this._expandTimer != null) {
      clearTimeout(this._expandTimer);
      this._expandTimer = null;
    }
  }
}

function getDropPosition(event, row) {
  const bounds = row.getBoundingClientRect();
  const offset = event.clientY - bounds.top;

  if (offset < bounds.height * 0.25) {
    return "before";
  }

  if (offset > bounds.height * 0.75) {
    return "after";
  }

  return "inside";
}

// Internal TreeGrid adapter: the public TreeList controller above keeps its
// original full-row gesture, events and hover expansion policy.
export function createTreeGridNodeDragController(tree) {
  return new TreeGridNodeDragController(tree);
}

const TREE_GRID_DRAG_MIME = "application/x-dense-ui-tree-nodes";
let treeGridDragSequence = 0;
let activeTreeGridDrag = null;
const sameReferences = (left, right) => left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
const nodeDropClasses = ["before", "inside", "after", "invalid"].map(position => `dui-tree-grid__row--node-drop-${position}`);

class TreeGridNodeDragController extends TreeNodeDragController {
  constructor(tree) {
    super(tree);
    this._body = null;
    this._bindings = [];
    this._generation = 0;
  }

  attachGrid(body) {
    if (!body || this._body === body || !this.tree) return;
    this._detach();
    this._body = body;
    const tree = this.tree;
    if (!tree.nodeReorderEnabled) return;
    const doc = body.ownerDocument;
    const listen = (target, name, callback, options) => {
      this._bindings.push(tree.disposables.addEventListener(target, name, callback, options));
    };
    listen(body, "dragstart", event => this.start(event));
    listen(body, "dragover", event => this.over(event));
    listen(body, "drop", event => this.drop(event));
    listen(body, "dragleave", event => this.leave(event));
    listen(body, "scroll", () => this.finish());
    listen(doc, "dragend", () => this.finish());
    // Bubble phase lets this owner's body finish a valid drop first.
    listen(doc, "drop", () => this.finish());
    listen(doc, "keydown", event => { if (event.key === "Escape") this.finish(); }, true);
    listen(doc.defaultView, "blur", () => this.finish());
    for (const model of [tree.data, tree.treeView, tree.selection, tree.columnModel]) {
      if (model?.events?.on) this._bindings.push(tree.disposables.add(model.events.on("invalidate", () => {
        ++this._generation;
        this.finish();
      })));
    }
    this.sync();
  }

  _available() {
    const tree = this.tree;
    return Boolean(tree && !tree.destroyed && !tree._destroyingGrid && !tree.disabled &&
      !tree._editing && !tree._startingEdit && !tree.data?.destroyed && !tree.treeView?.destroyed &&
      tree.nodeReorderEnabled && tree.indicatorGutterEnabled);
  }

  syncIndicator(cell) {
    if (!cell) return;
    const enabled = this._available();
    cell.draggable = enabled;
    cell.classList.toggle("dui-tree-grid__node-handle", enabled);
    if (enabled) {
      cell.dataset.duiTreeNodeDraggable = "true";
      cell.title = "Move node and subtree";
    } else {
      delete cell.dataset.duiTreeNodeDraggable;
      cell.removeAttribute("title");
    }
  }

  sync() {
    this.finish();
    for (const cell of this._body?.querySelectorAll(".dui-tree-grid__row > .dui-grid__indicator-body") ?? []) this.syncIndicator(cell);
  }

  _capture() {
    const tree = this.tree;
    return { tree, data: tree.data, view: tree.treeView, columns: tree.columns,
      revision: tree.data._revision, entries: tree.treeView._entries,
      generation: this._generation, selected: tree.selection.get() };
  }

  _intact(snapshot) {
    const tree = this.tree;
    return this._available() && snapshot.tree === tree && snapshot.data === tree.data && snapshot.view === tree.treeView &&
      snapshot.columns === tree.columns && snapshot.revision === tree.data._revision &&
      snapshot.entries === tree.treeView._entries && snapshot.generation === this._generation &&
      sameReferences(snapshot.selected, tree.selection.get());
  }

  _ownRow(target) {
    const row = target?.closest?.(".dui-tree-grid__row[data-dui-grid-row-id]");
    return row && row.parentElement && this._body?.contains(row) && row.closest(".dui-grid") === this.tree?.element ? row : null;
  }

  start(event) {
    const handle = event.target?.closest?.(".dui-tree-grid__node-handle[data-dui-tree-node-draggable='true']");
    const row = this._ownRow(handle);
    if (!handle || !row || handle.parentElement !== row) return;
    event.stopPropagation();
    activeTreeGridDrag?.finish();
    this.finish();
    if (!this._available() || !event.dataTransfer) { event.preventDefault(); return false; }
    const tree = this.tree;
    const item = tree._getItemFromRow(row);
    if (!item) { event.preventDefault(); return false; }
    let snapshot = this._capture();
    const id = tree.data.idOf(item);
    if (!this._intact(snapshot)) { event.preventDefault(); return false; }
    const selected = tree.getSelectedIds();
    if (!this._intact(snapshot)) { event.preventDefault(); return false; }
    if (!selected.some(value => Object.is(value, id))) {
      tree.setSelectedIds([id], { origin: "user", userAction: true });
      if (!this._available() || this.tree !== tree || tree.data !== snapshot.data ||
          tree.data._revision !== snapshot.revision || tree.treeView._entries !== snapshot.entries ||
          tree.columns !== snapshot.columns || !sameReferences(tree.selection.get(), [item])) {
        event.preventDefault(); return false;
      }
      snapshot = this._capture();
    }
    const ids = tree.getSelectedIds();
    if (!this._intact(snapshot)) { event.preventDefault(); return false; }
    const sources = describeTreeGridMoveSources(tree, ids);
    if (!sources.accepted || !this._intact(snapshot)) { event.preventDefault(); return false; }
    const token = `dui-tree-${++treeGridDragSequence}-${Math.random().toString(36).slice(2)}`;
    this.state = { sourceId: sources.ids[0], ids: [...sources.ids], subtreeIds: [...sources.subtreeIds],
      targetId: null, position: null, reason: null, token, snapshot };
    activeTreeGridDrag = this;
    tree.element.classList.add("dui-tree-grid--node-dragging");
    row.classList.add("dui-tree-grid__row--node-dragging");
    const ghost = row.ownerDocument.createElement("div");
    ghost.className = "dui-tree-grid__node-drag-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.textContent = `${sources.ids.length} roots / ${sources.subtreeIds.length} nodes`;
    tree.element.append(ghost);
    this._ghost = ghost;
    event.dataTransfer.setData(TREE_GRID_DRAG_MIME, token);
    event.dataTransfer.setData("text/plain", token);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setDragImage?.(ghost, 0, 0);
    return true;
  }

  _session(event, dropping = false) {
    const state = this.state;
    if (!state || activeTreeGridDrag !== this) return null;
    if (!this._intact(state.snapshot)) { this.finish(); return null; }
    const types = Array.from(event.dataTransfer?.types ?? []);
    if (!types.includes(TREE_GRID_DRAG_MIME) && !types.includes("text/plain")) return null;
    if (dropping && event.dataTransfer.getData(TREE_GRID_DRAG_MIME) !== state.token &&
        event.dataTransfer.getData("text/plain") !== state.token) return null;
    return state;
  }

  _target(event) {
    if (!this._body?.contains(event.target) || event.target.closest?.(".dui-grid") !== this.tree?.element) return null;
    const row = this._ownRow(event.target);
    if (!row) return { row: null, id: null, position: "inside" };
    const item = this.tree._getItemFromRow(row);
    if (!item) return null;
    const bounds = row.getBoundingClientRect();
    const offset = event.clientY - bounds.top;
    return { row, id: this.tree.data.idOf(item),
      position: offset <= bounds.height * 0.25 ? "before" : offset >= bounds.height * 0.75 ? "after" : "inside" };
  }

  over(event) {
    const state = this._session(event);
    if (!state) return false;
    const target = this._target(event);
    if (!target || !this._intact(state.snapshot)) { this.clearMarkers(); return false; }
    const plan = planTreeGridMove(this.tree, state.ids, target.id, target.position);
    if (this.state !== state || !this._intact(state.snapshot)) { this.finish(); return false; }
    this.clearMarkers();
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = plan.accepted ? "move" : "none";
    state.targetId = target.id;
    state.position = target.position;
    state.reason = plan.reason;
    if (target.row) target.row.classList.add(`dui-tree-grid__row--node-drop-${plan.accepted ? target.position : "invalid"}`);
    else this._body.classList.add(`dui-tree-grid__body--node-drop-${plan.accepted ? "root" : "invalid"}`);
    if (this._ghost) {
      this._ghost.classList.toggle("dui-tree-grid__node-drag-ghost--invalid", !plan.accepted);
      this._ghost.textContent = `${state.ids.length} roots / ${state.subtreeIds.length} nodes${plan.accepted ? "" : ` | ${plan.reason}`}`;
    }
    return plan.accepted;
  }

  leave(event) {
    if (!this._body?.contains(event.relatedTarget)) this.clearMarkers();
  }

  drop(event) {
    const state = this._session(event, true);
    if (!state) return false;
    const target = this._target(event);
    if (!target || !this._intact(state.snapshot)) { this.finish(); return false; }
    const tree = this.tree;
    const plan = planTreeGridMove(tree, state.ids, target.id, target.position);
    if (this.state !== state || !this._intact(state.snapshot)) { this.finish(); return false; }
    event.preventDefault();
    event.stopPropagation();
    const ids = [...state.ids];
    this.finish();
    return tree.moveNodes(ids, target.id, target.position, { origin: "user", userAction: true, nativeEvent: event });
  }

  clearMarkers() {
    for (const row of this._body?.querySelectorAll(nodeDropClasses.map(name => `.${name}`).join(",")) ?? []) row.classList.remove(...nodeDropClasses);
    this._body?.classList.remove("dui-tree-grid__body--node-drop-root", "dui-tree-grid__body--node-drop-invalid");
    if (this.state) { this.state.targetId = null; this.state.position = null; this.state.reason = null; }
  }

  finish() {
    if (activeTreeGridDrag === this) activeTreeGridDrag = null;
    this.clearMarkers();
    this.tree?.element?.classList.remove("dui-tree-grid--node-dragging");
    for (const row of this._body?.querySelectorAll(".dui-tree-grid__row--node-dragging") ?? []) row.classList.remove("dui-tree-grid__row--node-dragging");
    this._ghost?.remove();
    this._ghost = null;
    this.state = null;
  }

  _detach() {
    this.finish();
    for (const binding of this._bindings) binding.dispose?.();
    this._bindings.length = 0;
    this._body = null;
  }

  destroy() {
    this._detach();
    ++this._generation;
    this.tree = null;
  }
}
