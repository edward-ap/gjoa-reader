import { changeTreeExpansion, watchTreeData } from "./treeExpansion.js";
import { TreeDataView } from "../core/TreeDataView.js";
import { normalizeMutationOptions } from "../core/mutationOptions.js";
import { List } from "./List.js";
import { TreeNodeDragController } from "./TreeNodeDragController.js";

const NODE_DROP_POSITIONS = new Set(["before", "inside", "after"]);

export class TreeList extends List {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    const treeView = options.treeView ?? null;

    super({
      ...options,
      data: options.data ?? treeView?.data,
      idField: options.idField ?? "id"
    });

    this.parentField = options.parentField ?? "parentId";
    this.rootParentId = options.rootParentId ?? null;
    this.expandOnClick = options.expandOnClick === true;
    this.nodeReorderEnabled = options.nodeReorder !== false;
    this.nodeDropValidator =
      typeof options.canDropNode === "function" ? options.canDropNode : null;
    if (
      options.canDropNode != null &&
      typeof options.canDropNode !== "function"
    ) {
      throw new TypeError("TreeList canDropNode must be a function.");
    }
    this._ownsTreeView = !treeView;
    this.treeView =
      treeView ??
      new TreeDataView({
        data: this.data,
        parentField: this.parentField,
        rootParentId: this.rootParentId,
        expandedIds: options.expandedIds,
        expandAll: options.expandAll
      });
    assertTreeDataView(this.treeView);

    if (this.treeView.data && this.treeView.data !== this.data) {
      throw new Error("TreeList treeView must project the same DataStore used by TreeList data.");
    }

    this._nodeDragController = new TreeNodeDragController(this);
    this._bindOptionEvent("beforeNodeMove", options.onBeforeNodeMove);
    this._bindOptionEvent("nodeMove", options.onNodeMove);
    this._bindOptionEvent("nodeDragStart", options.onNodeDragStart);
    this._bindOptionEvent("nodeDragEnd", options.onNodeDragEnd);

    this.disposables.add(
      this.treeView.events.on("invalidate", event => {
        if (this.destroyed) return;
        if (event.silent) {
          this._reconcileActiveItem();
          this._reconcileSelection();
          if (this.destroyed) return;
          this._renderItems();
        }
      })
    );
    this.disposables.add(
      this.treeView.events.on("change", event => {
        if (this.destroyed) return;
        this._reconcileActiveItem();
        this._reconcileSelection();
        if (this.destroyed) return;
        this._renderItems();
        if (this.destroyed) return;
        this.events.emit("treeViewChange", {
          source: this,
          viewEvent: event,
          origin: event.origin,
          reason: event.reason,
          userAction: event.userAction
        });
      })
    );

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  destroy() {
    if (this.destroyed || this._destroyingTree) return;
    this._destroyingTree = true;
    const ownedTreeView = this._ownsTreeView ? this.treeView : null;

    try {
      this._nodeDragController?.destroy();
    } finally {
      this._nodeDragController = null;
      try { super.destroy(); }
      finally {
        if (ownedTreeView && !ownedTreeView.destroyed) ownedTreeView.destroy();
      }
    }
  }

  createElement() {
    const root = super.createElement();
    root.classList.add("dui-tree-list");
    root.setAttribute("role", "tree");
    return root;
  }

  expand(idOrItem, options = {}) {
    this._assertMutable("expand");
    return changeTreeExpansion(this, "expand", this._normalizeItemId(idOrItem), options);
  }

  collapse(idOrItem, options = {}) {
    this._assertMutable("collapse");
    return changeTreeExpansion(this, "collapse", this._normalizeItemId(idOrItem), options);
  }

  toggle(idOrItem, options = {}) {
    this._assertMutable("toggle");
    const id = this._normalizeItemId(idOrItem);
    return this.isExpanded(id) ? this.collapse(id, options) : this.expand(id, options);
  }

  expandAll(options = {}) {
    this._assertMutable("expandAll");
    changeTreeExpansion(this, "expandAll", null, options);
    return this;
  }

  collapseAll(options = {}) {
    this._assertMutable("collapseAll");
    changeTreeExpansion(this, "collapseAll", null, options);
    return this;
  }

  isExpanded(idOrItem) {
    return this.treeView.isExpanded(this._normalizeItemId(idOrItem));
  }

  canMoveNode(sourceIdOrItem, targetIdOrItem, position = "inside") {
    this._assertMutable("canMoveNode");
    const move = this._createNodeMove(
      this._normalizeItemId(sourceIdOrItem),
      this._normalizeItemId(targetIdOrItem),
      position
    );
    return Boolean(
      move &&
      (move.oldParentId !== move.parentId || move.oldIndex !== move.index)
    );
  }

  moveNode(sourceIdOrItem, targetIdOrItem, position = "inside", options = {}) {
    this._assertMutable("moveNode");
    if (this._movingNode || this._validatingNode || this._destroyingTree) return false;
    this._movingNode = true;
    try { return this._moveNode(sourceIdOrItem, targetIdOrItem, position, options); }
    finally { this._movingNode = false; }
  }

  _moveNode(sourceIdOrItem, targetIdOrItem, position, options) {
    const watching = watchTreeData(this);
    try {
      const move = this._createNodeMove(
        this._normalizeItemId(sourceIdOrItem),
        this._normalizeItemId(targetIdOrItem),
        position
      );

      if (!move || (move.oldParentId === move.parentId && move.oldIndex === move.index)) {
        return false;
      }

      const mutation = normalizeMutationOptions(options);
      const event = {
        source: this,
        ...move,
        cancel: false,
        nativeEvent: options.nativeEvent ?? null,
        origin: mutation.origin,
        userAction: mutation.userAction
      };

      if (!mutation.silent) {
        this.events.emit("beforeNodeMove", event);
      }

      if (event.cancel || !watching.current()) {
        return false;
      }

      const nextItems = buildMovedItems(
        this.data.all(),
        move,
        this.parentField,
        this.rootParentId
      );
      const changed = this.data.batch(
        data => data.parse(nextItems, {
          ...options,
          operation: "node-move"
        }),
        {
          ...options,
          operation: "node-move"
        }
      );

      if (!changed) {
        return false;
      }

      // The write is committed. Notification callbacks may replace the rows or
      // close the owner; retain the result but stop dependent UI/event phases.
      if (!this._matchesNodeItems(nextItems)) return true;

      if (position === "inside" && options.expandTarget !== false) {
        this.expand(move.targetId, {
          silent: mutation.silent,
          origin: event.origin,
          userAction: event.userAction
        });
      }

      if (!mutation.silent && this._matchesNodeItems(nextItems)) {
        this.events.emit("nodeMove", {
          ...event,
          cancel: undefined,
          item: this.data.get(move.id),
          targetItem: this.data.get(move.targetId)
        });
      }

      return true;
    } finally { watching.dispose(); }
  }

  _matchesNodeItems(items) {
    if (this.destroyed || this._destroyingTree || this.data.destroyed || this.treeView.destroyed) return false;
    const current = this.data.all();
    return current.length === items.length && current.every((item, index) => item === items[index]);
  }

  _syncAfterSilentTreeViewChange(changed, options = {}) {
    if (!changed || !options.silent || this.destroyed) {
      return;
    }

    this._reconcileActiveItem();
    this._reconcileSelection();
    if (this.destroyed) return;
    this._renderItems();
  }

  _renderItems(element = this.element) {
    if (!element || this.destroyed) {
      return;
    }
    const revision = this._renderRevision = (this._renderRevision ?? 0) + 1;
    const current = () => !this.destroyed && revision === this._renderRevision;

    this._itemKeysById.clear();
    this._idsByItemKey.clear();
    this._itemElementsById.clear();
    element.replaceChildren();

    const visibleItems = this._getVisibleItems();

    if (visibleItems.length === 0) {
      this._activeId = null;
      element.removeAttribute("aria-activedescendant");
      this._observeItemGeometry();
      return;
    }

    if (this._activeId == null || !visibleItems.some(entry => Object.is(entry.id, this._activeId))) {
      this._activeId = visibleItems[0].id;
    }

    for (const [index, entry] of visibleItems.entries()) {
      const { item, id, level, hasChildren, expanded } = entry;
      const itemKey = toItemKey(id);
      const row = document.createElement("div");

      row.className = "dui-list__item dui-tree-list__item";
      row.dataset.duiListItemId = itemKey;
      row.dataset.duiTreeLevel = String(level);
      row.id = `${this.id}-item-${index}`;
      row.setAttribute("role", "treeitem");
      row.setAttribute("aria-level", String(level + 1));
      row.setAttribute("aria-expanded", hasChildren ? String(expanded) : "false");
      row.style.setProperty("--dui-tree-level", String(level));

      this._itemKeysById.set(id, itemKey);
      this._idsByItemKey.set(itemKey, id);

      const content = this._createTreeItemContent(item, { ...entry, index }, current);
      if (!current()) return;
      row.appendChild(content);
      this._nodeDragController?.attach(row, entry);
      element.appendChild(row);
      this._itemElementsById.set(id, row);
    }

    this._syncSelectionState(element);
    this._observeItemGeometry();
  }

  _createTreeItemContent(item, entry, current) {
    const content = document.createElement("span");
    content.className = "dui-tree-list__content";

    const toggle = document.createElement("span");
    toggle.className = "dui-tree-list__toggle";
    toggle.setAttribute("aria-hidden", "true");

    if (entry.hasChildren) {
      toggle.dataset.duiTreeToggle = "true";
    }

    const text = document.createElement("span");
    text.className = "dui-tree-list__text";
    if (this.renderItem) {
      const rendered = this.renderItem(item, {
        source:this, id:entry.id, index:entry.index,
        selected:this._isSelected(item), active:Object.is(entry.id, this._activeId),
        level:entry.level, hasChildren:entry.hasChildren, expanded:entry.expanded
      });
      if (!current()) return content;
      if (rendered instanceof Node) text.appendChild(rendered);
      else text.textContent = rendered == null ? "" : String(rendered);
    } else text.textContent = getItemText(item, this.textField);
    if (!current()) return content;

    const icon = this.renderItem ? null : this._createItemIcon(item);
    content.append(toggle);
    if (icon) {
      content.classList.add("dui-tree-list__content--has-icon");
      content.append(icon);
    }
    content.append(text);
    return content;
  }

  _selectItemFromUser(item, nativeEvent) {
    const id = this.data.idOf(item);

    if (nativeEvent.target.closest?.("[data-dui-tree-toggle]")) {
      this.toggle(id, {
        origin: "user",
        userAction: true
      });
      return false;
    }

    if (this.expandOnClick && this._hasChildren(id)) {
      this.toggle(id, {
        origin: "user",
        userAction: true
      });
    }

    if (this.destroyed || this.data.get(id) !== item) return false;
    return super._selectItemFromUser(item, nativeEvent);
  }

  _handleKeyDown(event) {
    if (this.disabled) {
      return;
    }

    const visibleEntries = this._getVisibleItems();

    if (visibleEntries.length === 0) {
      return;
    }

    const visibleItems = visibleEntries.map(entry => entry.item);
    const activeEntry = visibleEntries[this._getActiveIndex(visibleItems)] ?? visibleEntries[0];

    if (event.key === "ArrowRight") {
      event.preventDefault();

      if (activeEntry.hasChildren && !activeEntry.expanded) {
        this.expand(activeEntry.id, {
          origin: "user",
          userAction: true
        });
      }

      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();

      if (activeEntry.hasChildren && activeEntry.expanded) {
        this.collapse(activeEntry.id, {
          origin: "user",
          userAction: true
        });
      } else if (activeEntry.parentId != null) {
        const parent = this.treeView.get(activeEntry.parentId);

        if (parent) {
          this._setActiveItem(parent, {
            origin: "user",
            userAction: true
          });
        }
      }

      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.selection.set([activeEntry.item], {
        origin: "user",
        userAction: true
      });
      return;
    }

    super._handleKeyDown(event, visibleItems);
  }

  _getVisibleItems() {
    return this.treeView.entries();
  }

  _hasChildren(id) {
    return this.treeView.hasChildren(id);
  }

  _getParentId(item) {
    return this.treeView.parentIdOf(item);
  }

  _normalizeItemId(idOrItem) {
    if (idOrItem && typeof idOrItem === "object") {
      return this.data.idOf(idOrItem);
    }

    return idOrItem;
  }

  _reconcileActiveItem() {
    const entries = this._getVisibleItems();

    if (entries.length === 0) {
      this._activeId = null;
      return;
    }

    if (this._activeId == null || !entries.some(entry => Object.is(entry.id, this._activeId))) {
      this._activeId = entries[0].id;
    }
  }

  _emitExpandEvent(type, id, options = {}) {
    if (options.silent) {
      return;
    }

    this.events.emit(type, {
      source: this,
      id,
      item: this.data.get(id) ?? null,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });
  }

  _createNodeMove(sourceId, targetId, position) {
    if (this._validatingNode || this._destroyingTree) return null;
    if (!NODE_DROP_POSITIONS.has(position)) {
      throw new TypeError(
        "TreeList node drop position must be before, inside, or after."
      );
    }

    const item = this.data.get(sourceId);
    const targetItem = this.data.get(targetId);

    if (!item || !targetItem || Object.is(sourceId, targetId)) {
      return null;
    }

    const oldParentId = this.treeView.parentIdOf(item);
    const parentId =
      position === "inside"
        ? targetId
        : this.treeView.parentIdOf(targetItem);

    if (
      Object.is(parentId, sourceId) ||
      this._isNodeDescendant(parentId, sourceId)
    ) {
      return null;
    }

    const oldSiblings = this.data
      .all()
      .filter(candidate =>
        Object.is(this.treeView.parentIdOf(candidate), oldParentId)
      );
    const siblings = this.data
      .all()
      .filter(candidate => {
        const id = this.data.idOf(candidate);
        return (
          !Object.is(id, sourceId) &&
          Object.is(this.treeView.parentIdOf(candidate), parentId)
        );
      });
    const oldIndex = oldSiblings.findIndex(candidate =>
      Object.is(this.data.idOf(candidate), sourceId)
    );
    const targetIndex = siblings.findIndex(candidate =>
      Object.is(this.data.idOf(candidate), targetId)
    );
    const index =
      position === "inside"
        ? siblings.length
        : targetIndex + (position === "after" ? 1 : 0);
    const move = {
      id: sourceId,
      item,
      targetId,
      targetItem,
      position,
      oldParentId,
      parentId,
      oldIndex,
      index
    };

    if (this.nodeDropValidator) {
      const watching = watchTreeData(this);
      this._validatingNode = true;
      try {
        if (this.nodeDropValidator({ source: this, ...move }) === false || !watching.current()) return null;
      } finally {
        this._validatingNode = false;
        watching.dispose();
      }
    }

    return move;
  }

  _isNodeDescendant(candidateId, ancestorId) {
    const visited = new Set();
    let currentId = candidateId;

    while (currentId != null && !visited.has(currentId)) {
      if (Object.is(currentId, ancestorId)) {
        return true;
      }

      visited.add(currentId);
      const current = this.data.get(currentId);

      if (!current) {
        return false;
      }

      currentId = this.treeView.parentIdOf(current);
    }

    return false;
  }
}

function buildMovedItems(items, move, parentField, rootParentId) {
  const movedItem = {
    ...move.item,
    [parentField]: move.parentId
  };
  const remaining = items.filter(item => item !== move.item);
  const siblings = remaining.filter(item =>
    Object.is(item[parentField] ?? rootParentId, move.parentId)
  );
  let insertionIndex;

  if (move.index < siblings.length) {
    insertionIndex = remaining.indexOf(siblings[move.index]);
  } else if (siblings.length > 0) {
    insertionIndex = remaining.indexOf(siblings.at(-1)) + 1;
  } else {
    insertionIndex = remaining.indexOf(move.targetItem) + 1;
  }

  const next = [...remaining];
  next.splice(Math.max(0, insertionIndex), 0, movedItem);
  return next;
}

function getItemText(item, textField) {
  if (typeof textField === "function") {
    return String(textField(item));
  }

  return String(item[textField] ?? item.id ?? "");
}

function toItemKey(id) {
  return `${typeof id}:${String(id)}`;
}

function assertTreeDataView(treeView) {
  const requiredMethods = [
    "entries",
    "get",
    "idOf",
    "parentIdOf",
    "hasChildren",
    "isExpanded",
    "expand",
    "collapse",
    "expandAll",
    "collapseAll"
  ];

  for (const method of requiredMethods) {
    if (typeof treeView?.[method] !== "function") {
      throw new TypeError("TreeList treeView must implement TreeDataView.");
    }
  }

  if (!treeView.events || typeof treeView.events.on !== "function") {
    throw new TypeError("TreeList treeView must expose EventBus.");
  }
}
