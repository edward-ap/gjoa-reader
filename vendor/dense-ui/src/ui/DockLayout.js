import { Panel } from "./Panel.js";
import { listenUntilPointerUp } from "../core/pointerTracking.js";
import { Layout } from "./Layout.js";
import { DockPanel } from "./DockPanel.js";
import { DockGroup } from "./DockGroup.js";

export class DockLayout extends Panel {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.css = options.css ?? "";
    this.className = options.className ?? "";
    this.areaSizes = {
      left: options.leftSize ?? 220,
      right: options.rightSize ?? 280,
      bottom: options.bottomSize ?? 150,
      ...options.areaSizes
    };
    this._contentElement = null;
    this._strips = {};
    this._panels = new Map();
    this._groups = {};
    this._mainLayout = null;
    this._middleLayout = null;
    this._autoHideLayer = null;
    this._autoHidePanel = null;
    this._autoHideRestoreParent = null;
    this._autoHideOutsideHandler = null;
    this._dragOverlay = null;
    this._dragState = null;
    this._dragTracking = null;
    this._areaNodes = {};
    this._areaGroupSeq = {
      left: 0,
      center: 0,
      right: 0,
      bottom: 0
    };
    this._workspaceNode = null;
    this._workspaceGroupSeq = 0;
    this._workspaceSplitSeq = 0;
    this._built = false;
    this._pendingPanels = options.panels ?? [];

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("div");
    root.className = ["dui-control", "dui-dock-layout", this.css, this.className]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;

    const content = document.createElement("div");
    content.className = "dui-dock-layout__content";
    this._contentElement = content;

    const leftStrip = createStrip("left");
    const rightStrip = createStrip("right");
    const bottomStrip = createStrip("bottom");
    const autoHideLayer = document.createElement("div");
    autoHideLayer.className = "dui-dock-auto-hide-layer";
    autoHideLayer.hidden = true;
    const dragOverlay = createDragOverlay();

    this._strips.left = leftStrip;
    this._strips.right = rightStrip;
    this._strips.bottom = bottomStrip;
    this._autoHideLayer = autoHideLayer;
    this._dragOverlay = dragOverlay;

    root.append(content, autoHideLayer, dragOverlay, leftStrip, rightStrip, bottomStrip);
    return root;
  }

  getContentElement() {
    return this._contentElement ?? this.element;
  }

  mount(container) {
    super.mount(container);
    this._build();

    for (const panel of this._pendingPanels) {
      this.addPanel(panel);
    }

    this._pendingPanels = [];
    return this;
  }

  addPanel(panelOrOptions) {
    this._assertMutable("addPanel");

    if (!this._built) {
      this._pendingPanels.push(panelOrOptions);
      return null;
    }

    const content =
      panelOrOptions instanceof DockPanel ? null : panelOrOptions.content ?? null;
    const panel =
      panelOrOptions instanceof DockPanel ? panelOrOptions : new DockPanel(panelOrOptions);

    if (this._panels.has(panel.id)) {
      throw new Error(`Duplicate dock panel id: ${panel.id}.`);
    }

    panel.area = normalizeArea(panel.area);
    this._panels.set(panel.id, panel);
    this._attachPanel(panel);

    if (content) {
      panel.attach(content);
    }

    this._wirePanel(panel);
    this._renderStrips();

    this.events.emit("panelAdd", {
      source: this,
      panel,
      panelId: panel.id,
      area: panel.area,
      origin: "api",
      userAction: false
    });

    return panel;
  }

  getPanel(id) {
    return this._panels.get(id) ?? null;
  }

  panels() {
    return Array.from(this._panels.values());
  }

  collapsePanel(idOrPanel, options = {}) {
    this._assertMutable("collapsePanel");

    const panel = this._normalizePanel(idOrPanel);

    if (!panel || panel.collapsed || panel.area === "center") {
      return false;
    }

    panel.collapsed = true;
    panel.dockStripArea = this._dockStripAreaForPanel(panel);
    panel._applyCollapsedState();
    this._groups[panel.area]?.sync({
      silent: true,
      origin: options.origin ?? "api"
    });
    this._syncAreaAfterPanelVisibility(panel.area, options);
    this._cleanupEmptyDockGroups(rootDockArea(panel.area), {
      origin: options.origin ?? "api"
    });
    this._renderStrips();
    this._emitPanelEvent("panelCollapse", panel, options);
    return true;
  }

  expandPanel(idOrPanel, options = {}) {
    this._assertMutable("expandPanel");

    const panel = this._normalizePanel(idOrPanel);

    if (!panel || !panel.collapsed) {
      return false;
    }

    if (panel.pinned === false) {
      return this.showAutoHidePanel(panel, options);
    }

    panel.collapsed = false;
    panel._applyCollapsedState();
    this._groups[panel.area]?.setActivePanel(panel.id, {
      silent: true,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });
    this._syncAreaAfterPanelVisibility(panel.area, options);
    this._renderStrips();
    this._emitPanelEvent("panelExpand", panel, options);
    return true;
  }

  togglePanel(idOrPanel, options = {}) {
    const panel = this._normalizePanel(idOrPanel);
    return panel?.collapsed ? this.expandPanel(panel, options) : this.collapsePanel(panel, options);
  }

  movePanel(idOrPanel, area, options = {}) {
    this._assertMutable("movePanel");

    const panel = this._normalizePanel(idOrPanel);
    const targetArea = this._normalizeDockArea(area);

    if (!panel || !this._groups[targetArea]) {
      return false;
    }

    const oldArea = panel.area;

    if (oldArea === targetArea && !panel.collapsed && panel.visible) {
      this._groups[targetArea]?.setActivePanel(panel.id, {
        silent: true,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
      return false;
    }

    if (this._autoHidePanel === panel) {
      this.hideAutoHidePanel({
        silent: true,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    this._groups[oldArea]?.removePanel(panel, {
      silent: true,
      origin: options.origin ?? "api"
    });

    panel.area = targetArea;
    panel.dockStripArea = null;
    panel.collapsed = false;
    panel.pinned = true;
    panel.element.dataset.duiDockArea = domDockArea(targetArea);
    panel.show({
      silent: true,
      origin: options.origin ?? "api"
    });
    panel._applyPinnedState?.();
    panel._applyCollapsedState();

    this._groups[targetArea].addPanel(panel, {
      silent: true,
      origin: options.origin ?? "api"
    });
    this._groups[targetArea].setActivePanel(panel.id, {
      silent: true,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });

    this._syncAreaAfterPanelVisibility(oldArea, options);
    this._syncAreaAfterPanelVisibility(targetArea, options);
    this._cleanupEmptyDockGroups(rootDockArea(oldArea), {
      origin: options.origin ?? "api"
    });
    this._groups[targetArea]?.setActivePanel(panel.id, {
      silent: true,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });
    this._renderStrips();

    this._emitPanelEvent("panelMove", panel, {
      ...options,
      oldArea,
      area: targetArea
    });
    return true;
  }

  splitPanel(idOrPanel, targetGroupId, side, options = {}) {
    this._assertMutable("splitPanel");

    const panel = this._normalizePanel(idOrPanel);
    const targetGroup = this._groups[targetGroupId];
    const splitSide = normalizeSplitSide(side);
    const targetRootArea = rootDockArea(targetGroupId);

    if (!panel || !targetGroup || !splitSide || !targetRootArea) {
      return false;
    }

    if (targetGroupId === "center") {
      const physicalArea = physicalDockAreaForCenterDrop(splitSide);

      if (!physicalArea) {
        return false;
      }

      return this.movePanel(panel, physicalArea, {
        ...options,
        dropMode: splitSide,
        splitTargetArea: targetGroupId
      });
    }

    if (
      panel.area === targetGroupId &&
      !panel.collapsed &&
      targetGroup.panels().filter(current => current.visible && !current.collapsed).length <= 1
    ) {
      targetGroup.setActivePanel(panel.id, {
        silent: true,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
      return false;
    }

    const newGroup = this._splitDockGroup(targetRootArea, targetGroupId, splitSide, options);

    if (!newGroup) {
      return false;
    }

    return this.movePanel(panel, newGroup.area, {
      ...options,
      dropMode: splitSide,
      splitTargetArea: targetGroupId
    });
  }

  showAutoHidePanel(idOrPanel, options = {}) {
    this._assertMutable("showAutoHidePanel");

    const panel = this._normalizePanel(idOrPanel);

    if (!panel || (panel.area === "center" && !panel.dockStripArea) || panel.visible === false) {
      return false;
    }

    if (this._autoHidePanel === panel) {
      return false;
    }

    this.hideAutoHidePanel({
      silent: true,
      origin: "system"
    });

    if (!panel.collapsed) {
      panel.collapsed = true;
      panel._applyCollapsedState();
    }

    panel.pinned = false;
    panel.dockStripArea = this._dockStripAreaForPanel(panel);
    panel._applyPinnedState?.();
    this._syncAreaAfterPanelVisibility(panel.area, {
      silent: true,
      origin: "system",
      reason: "auto-hide"
    });
    this._cleanupEmptyDockGroups(rootDockArea(panel.area), {
      origin: "system",
      reason: "auto-hide"
    });
    this._groups[panel.area]?.sync({
      silent: true,
      origin: "system",
      reason: "auto-hide"
    });

    this._autoHidePanel = panel;
    this._autoHideRestoreParent = panel.element?.parentElement ?? null;
    this._positionAutoHideLayer(this._dockStripAreaForPanel(panel));
    this._autoHideLayer.hidden = false;
    this._autoHideLayer.appendChild(panel.element);

    panel.element.classList.add("dui-dock-panel--auto-hide-active");
    panel.element.classList.remove("dui-collapsed", "dui-dock-panel--tab-hidden");
    panel.element.hidden = false;
    panel.element.removeAttribute("aria-hidden");
    panel.getContentElement().hidden = false;

    this._renderStrips();
    this._attachAutoHideOutsideHandler();
    this._emitPanelEvent("panelAutoHideShow", panel, options);
    return true;
  }

  hideAutoHidePanel(options = {}) {
    const panel = this._autoHidePanel;

    if (!panel) {
      return false;
    }

    const restoreParent = this._autoHideRestoreParent;

    panel.element.classList.remove("dui-dock-panel--auto-hide-active");

    if (restoreParent) {
      restoreParent.appendChild(panel.element);
    }

    panel._applyCollapsedState();
    this._groups[panel.area]?.sync({
      silent: true,
      origin: options.origin ?? "system"
    });

    this._autoHidePanel = null;
    this._autoHideRestoreParent = null;
    this._autoHideLayer.hidden = true;
    this._autoHideLayer.className = "dui-dock-auto-hide-layer";
    this._autoHideLayer.removeAttribute("style");
    this._detachAutoHideOutsideHandler();

    if (!options.silent) {
      this._emitPanelEvent("panelAutoHideHide", panel, options);
    }

    return true;
  }

  serializeState() {
    return {
      main: this._mainLayout?.serializeState() ?? null,
      middle: this._middleLayout?.serializeState() ?? null,
      groups: Object.fromEntries(
        Object.entries(this._groups).map(([area, group]) => [area, group.activePanelId])
      ),
      workspace: cloneWorkspaceNode(this._workspaceNode),
      areas: Object.fromEntries(
        ROOT_DOCK_AREAS.map(area => [area, cloneWorkspaceNode(this._areaNodes[area])])
      ),
      panels: this.panels().map(panel => ({
        id: panel.id,
        title: panel.title,
        area: panel.area,
        collapsed: panel.collapsed,
        visible: panel.visible,
        pinned: panel.pinned
      }))
    };
  }

  restoreState(state, options = {}) {
    this._assertMutable("restoreState");

    if (!state) {
      return this;
    }

    this._mainLayout?.restoreState(state.main, {
      ...options,
      silent: true
    });
    this._middleLayout?.restoreState(state.middle, {
      ...options,
      silent: true
    });

    if (state.areas && typeof state.areas === "object") {
      for (const area of ROOT_DOCK_AREAS) {
        this._restoreDockTree(area, state.areas[area], {
          ...options,
          silent: true,
          origin: "restore"
        });
      }
    } else if (state.workspace) {
      this._restoreWorkspaceTree(state.workspace, {
        ...options,
        silent: true,
        origin: "restore"
      });
    }

    for (const panelState of state.panels ?? []) {
      const panel = this.getPanel(panelState.id);

      if (!panel) {
        continue;
      }

      this._detachPanelFromGroups(panel, {
        silent: true,
        origin: "restore"
      });

      panel.area = this._normalizeDockArea(panelState.area);
      panel.collapsed = panelState.collapsed === true;
      panel.pinned = panelState.pinned !== false;
      panel._applyPinnedState?.();

      if (panelState.visible === false) {
        panel.hide({
          silent: true,
          origin: "restore"
        });
      } else {
        panel.show({
          silent: true,
          origin: "restore"
        });
      }

      this._attachPanel(panel);
      panel._applyCollapsedState();

      if (panel.collapsed) {
        this._collapseArea(panel.area, {
          silent: true,
          origin: "restore"
        });
      }
    }

    for (const [area, panelId] of Object.entries(state.groups ?? {})) {
      this._groups[area]?.setActivePanel(panelId, {
        silent: true,
        origin: "restore"
      });
    }

    this._renderStrips();

    if (!options.silent) {
      this.events.emit("stateRestore", {
        source: this,
        state,
        origin: options.origin ?? "restore",
        userAction: options.userAction === true
      });
    }

    return this;
  }

  _build() {
    if (this._built) {
      return;
    }

    this._mainLayout = new Layout({
      name: `${this.id}-main`,
      width: "100%",
      height: "100%",
      cols: [
        { name: "left", width: this.areaSizes.left, minSize: 96, collapsible: true },
        { name: "middle", flex: 1, minSize: 160 },
        { name: "right", width: this.areaSizes.right, minSize: 96, collapsible: true }
      ]
    });

    this._middleLayout = new Layout({
      name: `${this.id}-middle`,
      height: "100%",
      direction: "rows",
      rows: [
        { name: "center", flex: 1, minSize: 120 },
        { name: "bottom", height: this.areaSizes.bottom, minSize: 56, collapsible: true }
      ]
    });

    this.attach(this._mainLayout);
    this._mainLayout.cell("middle").attach(this._middleLayout);

    this._groups.left = new DockGroup({
      name: `${this.id}-left-group`,
      area: "left"
    });
    this._groups.center = new DockGroup({
      name: `${this.id}-center-group`,
      area: "center"
    });
    this._groups.right = new DockGroup({
      name: `${this.id}-right-group`,
      area: "right"
    });
    this._groups.bottom = new DockGroup({
      name: `${this.id}-bottom-group`,
      area: "bottom"
    });
    this._areaNodes.left = {
      type: "group",
      area: "left"
    };
    this._areaNodes.center = {
      type: "group",
      area: "center"
    };
    this._areaNodes.right = {
      type: "group",
      area: "right"
    };
    this._areaNodes.bottom = {
      type: "group",
      area: "bottom"
    };
    this._workspaceNode = this._areaNodes.center;

    this._mainLayout.cell("left").attach(this._groups.left);
    this._middleLayout.cell("center").attach(this._groups.center);
    this._mainLayout.cell("right").attach(this._groups.right);
    this._middleLayout.cell("bottom").attach(this._groups.bottom);

    for (const group of Object.values(this._groups)) {
      this._wireGroup(group);
    }

    this._built = true;

    for (const area of ["left", "right", "bottom"]) {
      this._collapseArea(area, {
        silent: true,
        origin: "system"
      });
    }
  }

  _attachPanel(panel) {
    const group = this._groups[panel.area];

    if (!group) {
      throw new Error(`Dock area not found: ${panel.area}.`);
    }

    if (panel.element) {
      panel.element.dataset.duiDockArea = domDockArea(panel.area);
    }

    if (!group.getPanel(panel.id)) {
      group.addPanel(panel, {
        silent: true,
        origin: "system"
      });
    }

    group.sync({
      silent: true,
      origin: "system"
    });

    this._syncAreaAfterPanelVisibility(panel.area, {
      silent: true,
      origin: "system"
    });
  }

  _splitDockGroup(rootArea, targetGroupId, side, options = {}) {
    const found = findWorkspaceNode(this._areaNodes[rootArea], targetGroupId);

    if (!found || found.node.type !== "group") {
      return null;
    }

    const targetGroup = this._groups[targetGroupId];
    const targetCell = targetGroup?.parent;

    if (!targetGroup?.element || !targetCell?.element) {
      return null;
    }

    const direction = side === "left" || side === "right" ? "cols" : "rows";
    const newGroupId = `${rootArea}-${++this._areaGroupSeq[rootArea]}`;
    this._workspaceGroupSeq = this._areaGroupSeq.center;
    const newGroup = new DockGroup({
      name: `${this.id}-${newGroupId}-group`,
      area: newGroupId
    });
    const splitLayout = new Layout({
      name: `${this.id}-${newGroupId}-split`,
      width: "100%",
      height: "100%",
      direction,
      cells: [
        { name: "first", flex: 1, minSize: 96 },
        { name: "second", flex: 1, minSize: 96 }
      ]
    });
    const newGroupNode = {
      type: "group",
      area: newGroupId
    };
    const splitNode = {
      type: "split",
      direction,
      side,
      size: null,
      children:
        side === "left" || side === "top"
          ? [newGroupNode, found.node]
          : [found.node, newGroupNode]
    };

    if (found.parent) {
      found.parent.children[found.index] = splitNode;
    } else {
      this._areaNodes[rootArea] = splitNode;
      this._syncWorkspaceAlias();
    }
    this._groups[newGroupId] = newGroup;

    targetCell._forgetControl(targetGroup);
    targetGroup.element.remove();
    targetCell.attach(splitLayout, {
      origin: options.origin ?? "api"
    });

    const firstCell = splitLayout.cell("first");
    const secondCell = splitLayout.cell("second");
    const targetFirst = side === "right" || side === "bottom";
    splitNode.layout = splitLayout;

    moveMountedControlToCell(targetFirst ? firstCell : secondCell, targetGroup);
    moveMountedControlToCell(targetFirst ? secondCell : firstCell, newGroup);
    syncWorkspaceSplitSize(splitNode);
    wireWorkspaceSplitSize(splitLayout, splitNode, this.disposables);
    this._wireGroup(newGroup);

    return newGroup;
  }

  _restoreWorkspaceTree(workspaceState, options = {}) {
    this._restoreDockTree("center", workspaceState, options);
  }

  _restoreDockTree(rootArea, treeState, options = {}) {
    const normalizedNode = normalizeDockTreeNode(treeState, rootArea);
    const dockNode = normalizedNode && workspaceNodeHasArea(normalizedNode, rootArea)
      ? normalizedNode
      : {
          type: "group",
          area: rootArea
        };

    this.hideAutoHidePanel({
      silent: true,
      origin: options.origin ?? "restore"
    });
    this._detachDockAreaPanels(rootArea, options);

    const rootCell = this._getAreaCell(rootArea);
    rootCell.clear();

    for (const area of Object.keys(this._groups)) {
      if (rootDockArea(area) === rootArea) {
        delete this._groups[area];
      }
    }

    this._areaNodes[rootArea] = cloneWorkspaceNode(dockNode);
    this._areaGroupSeq[rootArea] = Math.max(
      this._areaGroupSeq[rootArea],
      maxDockGroupSeq(dockNode, rootArea)
    );
    this._workspaceGroupSeq = this._areaGroupSeq.center;
    this._syncWorkspaceAlias();
    this._mountWorkspaceNode(this._areaNodes[rootArea], rootCell, options);
  }

  _detachWorkspacePanels(options = {}) {
    this._detachDockAreaPanels("center", options);
  }

  _detachDockAreaPanels(rootArea, options = {}) {
    for (const [area, group] of Object.entries(this._groups)) {
      if (rootDockArea(area) !== rootArea) {
        continue;
      }

      for (const panel of group.panels()) {
        group.removePanel(panel, {
          silent: true,
          origin: options.origin ?? "restore"
        });
        panel.element?.remove();
      }
    }
  }

  _detachPanelFromGroups(panel, options = {}) {
    for (const group of Object.values(this._groups)) {
      if (!group.getPanel(panel.id)) {
        continue;
      }

      group.removePanel(panel, {
        silent: true,
        origin: options.origin ?? "system"
      });
    }

    panel.element?.remove();
  }

  _mountWorkspaceNode(node, cell, options = {}) {
    if (node.type === "group") {
      const group = new DockGroup({
        name: `${this.id}-${node.area}-group`,
        area: node.area
      });

      this._groups[node.area] = group;
      cell.attach(group, {
        origin: options.origin ?? "restore"
      });
      this._wireGroup(group);
      return group;
    }

    const layout = new Layout({
      name: `${this.id}-workspace-split-${++this._workspaceSplitSeq}`,
      width: "100%",
      height: "100%",
      direction: node.direction,
      cells: [
        { name: "first", flex: 1, minSize: 96 },
        { name: "second", flex: 1, minSize: 96 }
      ]
    });

    cell.attach(layout, {
      origin: options.origin ?? "restore"
    });
    node.layout = layout;
    this._mountWorkspaceNode(node.children[0], layout.cell("first"), options);
    this._mountWorkspaceNode(node.children[1], layout.cell("second"), options);
    applyWorkspaceSplitSize(layout, node.size);
    syncWorkspaceSplitSize(node);
    wireWorkspaceSplitSize(layout, node, this.disposables);
    return layout;
  }

  _cleanupEmptyWorkspaceGroups(options = {}) {
    return this._cleanupEmptyDockGroups("center", options);
  }

  _cleanupEmptyDockGroups(rootArea, options = {}) {
    if (!rootArea || !this._areaNodes[rootArea]) {
      return false;
    }

    const nextWorkspaceNode = pruneEmptyWorkspaceGroups(this._areaNodes[rootArea], area =>
      area === rootArea || this._dockGroupHasExpandedPanels(area)
    ) ?? {
      type: "group",
      area: rootArea
    };
    const currentAreas = workspaceAreas(this._areaNodes[rootArea]);
    const nextAreas = workspaceAreas(nextWorkspaceNode);

    if (setsEqual(currentAreas, nextAreas)) {
      return false;
    }

    const dockPanels = this
      .panels()
      .filter(panel => rootDockArea(panel.area) === rootArea)
      .sort((left, right) => Number(!isExpandedPanel(left)) - Number(!isExpandedPanel(right)));

    this._restoreDockTree(rootArea, nextWorkspaceNode, {
      silent: true,
      origin: options.origin ?? "system"
    });

    for (const panel of dockPanels) {
      if (!this._groups[panel.area]) {
        panel.area = rootArea;
      }

      this._attachPanel(panel);
      panel._applyCollapsedState();
    }

    return true;
  }

  _workspaceGroupHasPanels(area) {
    return this._dockGroupHasPanels(area);
  }

  _dockGroupHasPanels(area) {
    return (this._groups[area]?.panels().length ?? 0) > 0;
  }

  _dockGroupHasExpandedPanels(area) {
    return this._groups[area]?.panels().some(panel => isExpandedPanel(panel)) === true;
  }

  _dockStripAreaForPanel(panel) {
    if (!panel) {
      return null;
    }

    return panel.dockStripArea ?? dockStripAreaForDockArea(panel.area, this._areaNodes);
  }

  _syncWorkspaceAlias() {
    this._workspaceNode = this._areaNodes.center;
  }

  _wirePanel(panel) {
    const header = panel.element?.querySelector(".dui-dock-panel__header");

    if (header && panel.movable !== false) {
      this.disposables.addEventListener(header, "pointerdown", event => {
        this._beginDockDrag(panel, event);
      });
    }

    this.disposables.add(
      panel.events.on("collapse", event => {
        if (this._autoHidePanel === panel) {
          this.hideAutoHidePanel({
            origin: event.origin,
            userAction: event.userAction
          });
          this._renderStrips();
          this._emitPanelEvent("panelCollapse", panel, event);
          return;
        }

        if (panel.area !== "center") {
          panel.dockStripArea = this._dockStripAreaForPanel(panel);
          this._groups[panel.area]?.sync({
            silent: true,
            origin: event.origin ?? "api"
          });
          this._syncAreaAfterPanelVisibility(panel.area, event);
          this._cleanupEmptyDockGroups(rootDockArea(panel.area), {
            origin: event.origin ?? "api"
          });
          this._renderStrips();
          this._emitPanelEvent("panelCollapse", panel, event);
        }
      })
    );

    this.disposables.add(
      panel.events.on("expand", event => {
        if (panel.pinned === false) {
          this.showAutoHidePanel(panel, event);
          return;
        }

        this._groups[panel.area]?.setActivePanel(panel.id, {
          silent: true,
          origin: event.origin ?? "api",
          userAction: event.userAction === true
        });
        this._syncAreaAfterPanelVisibility(panel.area, event);
        this._cleanupEmptyDockGroups(rootDockArea(panel.area), {
          origin: event.origin ?? "api"
        });
        this._renderStrips();
        this._emitPanelEvent("panelExpand", panel, event);
      })
    );

    this.disposables.add(
      panel.events.on("close", event => {
        if (this._autoHidePanel === panel) {
          this.hideAutoHidePanel({
            silent: true,
            origin: event.origin,
            userAction: event.userAction
          });
        }

        this._syncAreaAfterPanelVisibility(panel.area, event);
        this._cleanupEmptyDockGroups(rootDockArea(panel.area), {
          origin: event.origin ?? "api"
        });
        this._renderStrips();
        this._emitPanelEvent("panelClose", panel, event);
      })
    );

    this.disposables.add(
      panel.events.on("pinChange", event => {
        if (panel.area === "center") {
          return;
        }

        if (event.value === false) {
          panel.collapsed = true;
          panel.dockStripArea = this._dockStripAreaForPanel(panel);
          panel._applyCollapsedState();
          this._groups[panel.area]?.sync({
            silent: true,
            origin: event.origin ?? "api"
          });
          this._syncAreaAfterPanelVisibility(panel.area, event);
          this._cleanupEmptyDockGroups(rootDockArea(panel.area), {
            origin: event.origin ?? "api"
          });
          this._renderStrips();
          this._emitPanelEvent("panelUnpin", panel, event);
          return;
        }

        if (this._autoHidePanel === panel) {
          this.hideAutoHidePanel({
            silent: true,
            origin: event.origin,
            userAction: event.userAction
          });
        }

        panel.collapsed = false;
        panel._applyCollapsedState();
        this._groups[panel.area]?.setActivePanel(panel.id, {
          silent: true,
          origin: event.origin,
          userAction: event.userAction
        });
        this._syncAreaAfterPanelVisibility(panel.area, event);
        this._renderStrips();
        this._emitPanelEvent("panelPin", panel, event);
      })
    );
  }

  _wireGroup(group) {
    this.disposables.addEventListener(group.tabs.element, "pointerdown", event => {
      const close = event.target.closest?.("[data-dui-tab-close]");

      if (close) {
        return;
      }

      const tab = event.target.closest?.(".dui-tabbar__tab");

      if (!tab || !group.tabs.element.contains(tab)) {
        return;
      }

      const panel = this.getPanel(tab.dataset.duiTabId);

      if (!panel) {
        return;
      }

      this._beginDockTabDrag(panel, event);
    });
  }

  _collapseArea(area, options = {}) {
    const rootArea = rootDockArea(area);

    if (rootArea === "left" || rootArea === "right") {
      this._mainLayout.collapseCell(rootArea, options);
    } else if (rootArea === "bottom") {
      this._middleLayout.collapseCell("bottom", options);
    }
  }

  _expandArea(area, options = {}) {
    const rootArea = rootDockArea(area);

    if (rootArea === "left" || rootArea === "right") {
      this._mainLayout.expandCell(rootArea, options);
    } else if (rootArea === "bottom") {
      this._middleLayout.expandCell("bottom", options);
    }
  }

  _getAreaCell(area) {
    const rootArea = rootDockArea(area);

    if (rootArea === "center") {
      return this._middleLayout.cell("center");
    }

    if (rootArea === "bottom") {
      return this._middleLayout.cell("bottom");
    }

    return this._mainLayout.cell(rootArea);
  }

  _renderStrips() {
    for (const area of ["left", "right", "bottom"]) {
      const strip = this._strips[area];
      strip.replaceChildren();

      const panels = this.panels().filter(
        panel => this.options.showRestoreStrips !== false && this._dockStripAreaForPanel(panel) === area && panel.collapsed && panel.visible
      );
      strip.hidden = panels.length === 0;
      this.element?.classList.toggle(`dui-dock-layout--${area}-strip`, panels.length > 0);

      for (const panel of panels) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "dui-dock-strip__button";
        button.dataset.duiDockPanelId = panel.id;
        button.title = panel.title;

        const label = document.createElement("span");
        label.className = "dui-dock-strip__label";
        label.textContent = panel.title;
        button.appendChild(label);

        button.addEventListener("pointerdown", event => {
          this._beginDockStripDrag(panel, event, button);
        });

        button.addEventListener("click", () => {
          if (button.dataset.duiDockSuppressClick === "true") {
            delete button.dataset.duiDockSuppressClick;
            return;
          }

          const options = {
            origin: "user",
            userAction: true
          };

          if (panel.pinned === false) {
            this.showAutoHidePanel(panel, options);
          } else {
            this.expandPanel(panel, options);
          }
        });

        strip.appendChild(button);
      }
    }
  }

  _normalizePanel(idOrPanel) {
    return idOrPanel instanceof DockPanel ? idOrPanel : this.getPanel(idOrPanel);
  }

  _normalizeDockArea(area) {
    return this._groups[area] ? area : rootDockArea(area) ?? normalizeArea(area);
  }

  _emitPanelEvent(type, panel, options = {}) {
    this.events.emit(type, {
      source: this,
      type,
      panel,
      panelId: panel.id,
      area: options.area ?? panel.area,
      oldArea: options.oldArea ?? null,
      dropMode: options.dropMode ?? null,
      splitTargetArea: options.splitTargetArea ?? null,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });
  }

  _beginDockDrag(panel, event) {
    if (
      event.button !== 0 ||
      this.disabled ||
      panel.collapsed ||
      panel.visible === false ||
      panel.element?.classList.contains("dui-dock-panel--auto-hide-active") ||
      event.target.closest?.("[data-dui-dock-action]")
    ) {
      return;
    }

    event.preventDefault();
    this._startDockDrag(panel, event.clientX, event.clientY);
    this._dragTracking?.dispose();

    this._dragTracking = this.disposables.add(
      listenUntilPointerUp({
        target: document,
        options: true,
        move: moveEvent => {
          this._updateDockDrag(moveEvent.clientX, moveEvent.clientY);
        },
        up: upEvent => {
          this._dragTracking = null;
          this._finishDockDrag(upEvent);
        }
      })
    );
  }

  _beginDockTabDrag(panel, event) {
    if (
      event.button !== 0 ||
      this.disabled ||
      panel.collapsed ||
      panel.visible === false ||
      panel.element?.classList.contains("dui-dock-panel--auto-hide-active")
    ) {
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;
    this._dragTracking?.dispose();

    this._dragTracking = this.disposables.add(
      listenUntilPointerUp({
        target: document,
        options: true,
        move: moveEvent => {
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;

          if (!started && Math.hypot(dx, dy) < 5) {
            return;
          }

          if (!started) {
            started = true;
            moveEvent.preventDefault();
            this._startDockDrag(panel, moveEvent.clientX, moveEvent.clientY);
            return;
          }

          this._updateDockDrag(moveEvent.clientX, moveEvent.clientY);
        },
        up: upEvent => {
          this._dragTracking = null;

          if (started) {
            this._finishDockDrag(upEvent);
          }
        }
      })
    );
  }

  _beginDockStripDrag(panel, event, button) {
    if (
      event.button !== 0 ||
      this.disabled ||
      panel.visible === false
    ) {
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    let started = false;
    this._dragTracking?.dispose();

    this._dragTracking = this.disposables.add(
      listenUntilPointerUp({
        target: document,
        options: true,
        move: moveEvent => {
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;

          if (!started && Math.hypot(dx, dy) < 5) {
            return;
          }

          if (!started) {
            started = true;
            button.dataset.duiDockSuppressClick = "true";
            moveEvent.preventDefault();
            this._startDockDrag(panel, moveEvent.clientX, moveEvent.clientY);
            return;
          }

          this._updateDockDrag(moveEvent.clientX, moveEvent.clientY);
        },
        up: upEvent => {
          this._dragTracking = null;

          if (started) {
            this._finishDockDrag(upEvent);
          }
        }
      })
    );
  }

  _startDockDrag(panel, clientX, clientY) {
    this.hideAutoHidePanel({
      silent: true,
      origin: "system",
      reason: "drag"
    });

    this._groups[panel.area]?.setActivePanel(panel.id, {
      silent: true,
      origin: "system",
      reason: "drag"
    });

    this._dragState = {
      panel,
      sourceArea: panel.area,
      targetArea: panel.area,
      dropMode: "tab",
      targetGroup: panel.area,
      activeZone: null
    };

    this.element.classList.add("dui-dock-layout--dragging");
    this._dragOverlay.hidden = false;
    this._dragOverlay.querySelector(".dui-dock-drag-title").textContent = panel.title;
    this._renderGroupDropZones();
    this._updateDockDrag(clientX, clientY);

    this.events.emit("panelDragStart", {
      source: this,
      type: "panelDragStart",
      panel,
      panelId: panel.id,
      area: panel.area,
      origin: "user",
      userAction: true
    });
  }

  _updateDockDrag(clientX, clientY) {
    if (!this._dragState || !this._dragOverlay) {
      return;
    }

    const zone = document
      .elementFromPoint(clientX, clientY)
      ?.closest?.("[data-dui-dock-drop-area]");
    const resolvedArea =
      zone?.dataset.duiDockResolvedArea ?? zone?.dataset.duiDockDropArea ?? null;
    const dropMode =
      zone?.dataset.duiDockDropMode ?? zone?.dataset.duiDockDropKind ?? null;
    const targetGroup = zone?.dataset.duiDockTargetGroup ?? null;
    const targetArea =
      targetGroup && this._groups[targetGroup]
        ? targetGroup
        : resolvedArea && this._groups[resolvedArea]
          ? resolvedArea
          : null;

    this._dragState.targetArea = targetArea;
    this._dragState.dropMode = targetArea ? dropMode : null;
    this._dragState.targetGroup =
      targetArea && targetGroup && this._groups[targetGroup] ? targetGroup : null;
    this._dragState.activeZone = targetArea ? zone : null;

    for (const item of this._dragOverlay.querySelectorAll("[data-dui-dock-drop-area]")) {
      item.classList.toggle("dui-active", item === this._dragState.activeZone);
    }
  }

  _finishDockDrag(event) {
    const state = this._dragState;

    if (!state) {
      return;
    }

    const targetArea = state.targetArea;
    const dropMode = state.dropMode;
    const targetGroup = state.targetGroup;
    this._dragState = null;
    this.element.classList.remove("dui-dock-layout--dragging");
    this._dragOverlay.hidden = true;
    this._clearGroupDropZones();

    for (const item of this._dragOverlay.querySelectorAll("[data-dui-dock-drop-area]")) {
      item.classList.remove("dui-active");
    }

    if (targetGroup && isSplitDropMode(dropMode)) {
      this.splitPanel(state.panel, targetGroup, dropMode, {
        origin: "user",
        userAction: true,
        dropMode
      });
    } else if (targetArea) {
      this.movePanel(state.panel, targetArea, {
        origin: "user",
        userAction: true,
        dropMode
      });
    }

    this.events.emit("panelDragEnd", {
      source: this,
      type: "panelDragEnd",
      panel: state.panel,
      panelId: state.panel.id,
      area: state.panel.area,
      targetArea,
      targetGroup,
      dropMode,
      origin: "user",
      userAction: true,
      nativeEvent: event
    });
  }

  _renderGroupDropZones() {
    const host = this._dragOverlay?.querySelector(".dui-dock-group-drop-zones");

    if (!host || !this.element) {
      return;
    }

    host.replaceChildren();
    const layoutRect = this.element.getBoundingClientRect();

    for (const [area, group] of Object.entries(this._groups)) {
      if (!group.element) {
        continue;
      }

      const rect = group.element.getBoundingClientRect();

      if (rect.width < 32 || rect.height < 32) {
        continue;
      }

      const zone = document.createElement("div");
      zone.className = `dui-dock-group-drop-zone dui-dock-group-drop-zone--${area}`;
      zone.style.left = `${Math.round(rect.left - layoutRect.left + 8)}px`;
      zone.style.top = `${Math.round(rect.top - layoutRect.top + 8)}px`;
      zone.style.width = `${Math.max(32, Math.round(rect.width - 16))}px`;
      zone.style.height = `${Math.max(32, Math.round(rect.height - 16))}px`;

      for (const mode of ["top", "left", "tab", "right", "bottom"]) {
        const part = document.createElement("div");
        part.className = `dui-dock-group-drop-part dui-dock-group-drop-part--${mode}`;
        part.dataset.duiDockDropArea = area;
        part.dataset.duiDockDropMode = mode;
        part.dataset.duiDockTargetGroup = area;
        part.dataset.duiDockResolvedArea = area;
        part.textContent = mode === "tab" ? `${area} tab` : mode;
        zone.appendChild(part);
      }

      host.appendChild(zone);
    }
  }

  _clearGroupDropZones() {
    this._dragOverlay?.querySelector(".dui-dock-group-drop-zones")?.replaceChildren();
  }

  _syncAreaAfterPanelVisibility(area, options = {}) {
    const group = this._groups[area];
    const rootArea = rootDockArea(area);

    group?.sync({
      silent: true,
      origin: options.origin ?? "system"
    });

    if (rootArea === "center") {
      return;
    }

    const visibleExpanded = this
      .panels()
      .some(panel => rootDockArea(panel.area) === rootArea && panel.visible && !panel.collapsed);

    if (visibleExpanded) {
      this._expandArea(rootArea, {
        silent: true,
        origin: options.origin ?? "system"
      });
    } else {
      this._collapseArea(rootArea, {
        silent: true,
        origin: options.origin ?? "system"
      });
    }
  }

  _positionAutoHideLayer(area) {
    const layer = this._autoHideLayer;
    const rootArea = rootDockArea(area);

    if (!layer) {
      return;
    }

    layer.className = `dui-dock-auto-hide-layer dui-dock-auto-hide-layer--${rootArea}`;
    layer.removeAttribute("style");

    if (rootArea === "left") {
      layer.style.left = "var(--dui-dock-strip-size)";
      layer.style.top = "0";
      layer.style.bottom = this._hasVisibleStrip("bottom") ? "var(--dui-dock-strip-size)" : "0";
      layer.style.width = normalizeCssSize(this.areaSizes.left);
    } else if (rootArea === "right") {
      layer.style.right = "var(--dui-dock-strip-size)";
      layer.style.top = "0";
      layer.style.bottom = this._hasVisibleStrip("bottom") ? "var(--dui-dock-strip-size)" : "0";
      layer.style.width = normalizeCssSize(this.areaSizes.right);
    } else if (rootArea === "bottom") {
      layer.style.left = this._hasVisibleStrip("left") ? "var(--dui-dock-strip-size)" : "0";
      layer.style.right = this._hasVisibleStrip("right") ? "var(--dui-dock-strip-size)" : "0";
      layer.style.bottom = "var(--dui-dock-strip-size)";
      layer.style.height = normalizeCssSize(this.areaSizes.bottom);
    }
  }

  _hasVisibleStrip(area) {
    return this._strips[area]?.hidden === false;
  }

  _attachAutoHideOutsideHandler() {
    this._detachAutoHideOutsideHandler();

    this._autoHideOutsideHandler = event => {
      if (!this._autoHidePanel) {
        return;
      }

      const target = event.target;
      const inLayer = this._autoHideLayer?.contains(target);
      const inStrip = Object.values(this._strips).some(strip => strip.contains(target));

      if (inLayer || inStrip) {
        return;
      }

      this.hideAutoHidePanel({
        origin: "user",
        userAction: true
      });
    };

    document.addEventListener("pointerdown", this._autoHideOutsideHandler, true);
  }

  _detachAutoHideOutsideHandler() {
    if (!this._autoHideOutsideHandler) {
      return;
    }

    document.removeEventListener("pointerdown", this._autoHideOutsideHandler, true);
    this._autoHideOutsideHandler = null;
  }

  destroy() {
    this._dragTracking?.dispose();
    this._dragTracking = null;

    if (this._dragState) {
      this._dragState = null;
    }

    this._detachAutoHideOutsideHandler();
    super.destroy();
  }
}

function createStrip(area) {
  const strip = document.createElement("div");
  strip.className = `dui-dock-strip dui-dock-strip--${area}`;
  strip.dataset.duiDockStrip = area;
  strip.hidden = true;
  return strip;
}

function createDragOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "dui-dock-drag-overlay";
  overlay.hidden = true;

  const title = document.createElement("div");
  title.className = "dui-dock-drag-title";

  const groupZones = document.createElement("div");
  groupZones.className = "dui-dock-group-drop-zones";

  const zones = document.createElement("div");
  zones.className = "dui-dock-drop-zones";

  for (const area of ["left", "right", "center", "bottom"]) {
    const zone = document.createElement("div");
    zone.className = `dui-dock-drop-zone dui-dock-drop-zone--${area}`;
    zone.dataset.duiDockDropArea = area;
    zone.dataset.duiDockDropMode = "area";
    zone.dataset.duiDockResolvedArea = area;
    zone.textContent = area;
    zones.appendChild(zone);
  }

  overlay.append(title, groupZones, zones);
  return overlay;
}

const ROOT_DOCK_AREAS = ["left", "center", "right", "bottom"];

function normalizeArea(area) {
  return ROOT_DOCK_AREAS.includes(area) ? area : "center";
}

function normalizeSplitSide(side) {
  return ["left", "right", "top", "bottom"].includes(side) ? side : null;
}

function isSplitDropMode(mode) {
  return normalizeSplitSide(mode) != null;
}

function isWorkspaceArea(area) {
  return rootDockArea(area) === "center";
}

function isDockTreeArea(area) {
  return rootDockArea(area) != null;
}

function isExpandedPanel(panel) {
  return panel?.visible === true && panel.collapsed !== true;
}

function rootDockArea(area) {
  const value = String(area ?? "");

  if (ROOT_DOCK_AREAS.includes(value)) {
    return value;
  }

  const match = /^(left|center|right|bottom)-\d+$/.exec(value);
  return match?.[1] ?? null;
}

function domDockArea(area) {
  if (/^center-\d+$/.test(String(area))) {
    return area;
  }

  return rootDockArea(area) ?? normalizeArea(area);
}

function physicalDockAreaForCenterDrop(side) {
  if (side === "left" || side === "right" || side === "bottom") {
    return side;
  }

  return null;
}

function resolveGroupDropArea(groupArea, mode) {
  if (mode === "tab") {
    return groupArea;
  }

  if (mode === "left" || mode === "right" || mode === "bottom") {
    return mode;
  }

  if (mode === "top") {
    return "center";
  }

  return groupArea;
}

function findWorkspaceNode(node, area, parent = null, index = -1) {
  if (!node) {
    return null;
  }

  if (node.type === "group" && node.area === area) {
    return {
      node,
      parent,
      index
    };
  }

  if (node.type !== "split") {
    return null;
  }

  for (let childIndex = 0; childIndex < node.children.length; childIndex += 1) {
    const found = findWorkspaceNode(node.children[childIndex], area, node, childIndex);

    if (found) {
      return found;
    }
  }

  return null;
}

function normalizeDockTreeNode(node, rootArea, seen = new Set()) {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (node.type === "group") {
    const area = String(node.area ?? "");

    if (!isDockTreeArea(area) || rootDockArea(area) !== rootArea || seen.has(area)) {
      return null;
    }

    seen.add(area);
    return {
      type: "group",
      area
    };
  }

  if (node.type !== "split" || !Array.isArray(node.children) || node.children.length !== 2) {
    return null;
  }

  const direction = node.direction === "rows" ? "rows" : "cols";
  const first = normalizeDockTreeNode(node.children[0], rootArea, seen);
  const second = normalizeDockTreeNode(node.children[1], rootArea, seen);

  if (!first || !second) {
    return null;
  }

  return {
    type: "split",
    direction,
    side: normalizeSplitSide(node.side) ?? (direction === "rows" ? "bottom" : "right"),
    size: normalizeWorkspaceSplitSize(node.size),
    children: [first, second]
  };
}

function workspaceNodeHasArea(node, area) {
  if (!node) {
    return false;
  }

  if (node.type === "group") {
    return node.area === area;
  }

  return node.children.some(child => workspaceNodeHasArea(child, area));
}

function workspaceAreas(node, areas = new Set()) {
  if (!node) {
    return areas;
  }

  if (node.type === "group") {
    areas.add(node.area);
    return areas;
  }

  for (const child of node.children) {
    workspaceAreas(child, areas);
  }

  return areas;
}

function dockStripAreaForDockArea(area, areaNodes) {
  const rootArea = rootDockArea(area);

  if (!rootArea) {
    return null;
  }

  if (rootArea !== "center") {
    return rootArea;
  }

  if (area === "center") {
    return null;
  }

  return dockStripAreaFromTree(areaNodes.center, area);
}

function dockStripAreaFromTree(node, area, inherited = null) {
  if (!node) {
    return null;
  }

  if (node.type === "group") {
    return node.area === area ? inherited : null;
  }

  const sideChildIndex = node.side === "left" || node.side === "top" ? 0 : 1;

  for (let index = 0; index < node.children.length; index += 1) {
    const childSide = index === sideChildIndex ? normalizeStripSide(node.side) : inherited;
    const found = dockStripAreaFromTree(node.children[index], area, childSide);

    if (found) {
      return found;
    }
  }

  return null;
}

function normalizeStripSide(side) {
  if (side === "left" || side === "right" || side === "bottom") {
    return side;
  }

  if (side === "top") {
    return "bottom";
  }

  return null;
}

function pruneEmptyWorkspaceGroups(node, keepGroup) {
  if (!node) {
    return null;
  }

  if (node.type === "group") {
    return keepGroup(node.area) ? cloneWorkspaceNode(node) : null;
  }

  const first = pruneEmptyWorkspaceGroups(node.children[0], keepGroup);
  const second = pruneEmptyWorkspaceGroups(node.children[1], keepGroup);

  if (first && second) {
    const size = readWorkspaceSplitSize(node);
    const pruned = {
      type: "split",
      direction: node.direction,
      side: node.side,
      children: [first, second]
    };

    if (size) {
      pruned.size = size;
    }

    return pruned;
  }

  return first ?? second;
}

function cloneWorkspaceNode(node) {
  if (!node) {
    return null;
  }

  if (node.type === "group") {
    return {
      type: "group",
      area: node.area
    };
  }

  const size = readWorkspaceSplitSize(node);
  const snapshot = {
    type: "split",
    direction: node.direction,
    side: node.side,
    children: node.children.map(child => cloneWorkspaceNode(child))
  };

  if (size) {
    snapshot.size = size;
  }

  return snapshot;
}

function maxDockGroupSeq(node, rootArea) {
  if (!node) {
    return 0;
  }

  if (node.type === "group") {
    const pattern = new RegExp(`^${rootArea}-(\\d+)$`);
    const match = pattern.exec(String(node.area));
    return match ? Number(match[1]) : 0;
  }

  return Math.max(...node.children.map(child => maxDockGroupSeq(child, rootArea)));
}

function setsEqual(left, right) {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

function normalizeWorkspaceSplitSize(size) {
  if (!size || typeof size !== "object") {
    return null;
  }

  const first = normalizePositiveSize(size.first);
  const second = normalizePositiveSize(size.second);

  if (first == null && second == null) {
    return null;
  }

  return {
    first,
    second
  };
}

function normalizePositiveSize(size) {
  const value = Number(size);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function readWorkspaceSplitSize(node) {
  const live = node.layout ? getLayoutSplitSize(node.layout) : null;
  return live ?? normalizeWorkspaceSplitSize(node.size);
}

function getLayoutSplitSize(layout) {
  const first = layout.getCell?.("first");
  const second = layout.getCell?.("second");

  if (!first || !second) {
    return null;
  }

  return normalizeWorkspaceSplitSize({
    first: first.getLayoutSize(),
    second: second.getLayoutSize()
  });
}

function syncWorkspaceSplitSize(node) {
  node.size = readWorkspaceSplitSize(node);
}

function applyWorkspaceSplitSize(layout, size) {
  const normalized = normalizeWorkspaceSplitSize(size);

  if (!normalized) {
    return;
  }

  if (normalized.first != null) {
    layout.setCellSize("first", normalized.first, {
      silent: true,
      origin: "restore"
    });
  }

  if (normalized.second != null) {
    layout.setCellSize("second", normalized.second, {
      silent: true,
      origin: "restore"
    });
  }
}

function wireWorkspaceSplitSize(layout, node, disposables) {
  const update = () => {
    syncWorkspaceSplitSize(node);
  };

  disposables.add(layout.events.on("resize", update));
  disposables.add(layout.events.on("resizeEnd", update));
}

function moveMountedControlToCell(cell, control) {
  const host = cell.getContentElement();

  if (!control.mounted) {
    control.mount(host);
  } else if (control.element?.parentElement !== host) {
    host.appendChild(control.element);
  }

  cell.addControl(control);
  return control;
}

function normalizeCssSize(value) {
  return typeof value === "number" ? `${value}px` : String(value);
}
