import { Panel } from "./Panel.js";
import { TabBar } from "./TabBar.js";

export class DockGroup extends Panel {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.area = options.area ?? "center";
    this.css = options.css ?? "";
    this._contentElement = null;
    this._panels = new Map();
    this._panelSubscriptions = new Map();
    this._pendingPanels = options.panels ?? [];
    this.activePanelId = options.activePanelId ?? null;
    this.tabs = new TabBar({
      name: `${this.id}-tabs`,
      allowCloseLast: true,
      closable: false
    });

    this.disposables.add(
      this.tabs.events.on("change", event => {
        this.setActivePanel(event.id, {
          origin: event.origin,
          userAction: event.userAction
        });
      })
    );

    this.disposables.add(
      this.tabs.events.on("beforeClose", event => {
        const panel = this.getPanel(event.id);

        if (!panel) {
          return;
        }

        event.cancel = true;
        panel.close({
          origin: event.origin,
          userAction: event.userAction
        });
      })
    );

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  createElement() {
    const root = document.createElement("div");
    root.className = ["dui-control", "dui-dock-group", this.css, this.className]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;
    root.dataset.duiDockArea = this.area;

    const content = document.createElement("div");
    content.className = "dui-dock-group__content";
    this._contentElement = content;

    this.tabs.mount(root);
    root.appendChild(content);
    this._syncTabVisibility();
    return root;
  }

  mount(container) {
    super.mount(container);

    for (const panel of this._pendingPanels) {
      this.addPanel(panel);
    }

    this._pendingPanels = [];
    return this;
  }

  destroy() {
    if (!this.tabs.destroyed) {
      this.tabs.destroy();
    }

    super.destroy();
  }

  getContentElement() {
    return this._contentElement ?? this.element;
  }

  addPanel(panel, options = {}) {
    this._assertMutable("addPanel");

    if (!this.element) {
      this._pendingPanels.push(panel);
      return panel;
    }

    if (this._panels.has(panel.id)) {
      throw new Error(`Duplicate dock group panel id: ${panel.id}.`);
    }

    const host = this.getContentElement();

    this._panels.set(panel.id, panel);

    if (!panel.mounted) {
      panel.mount(host);
    } else if (panel.element?.parentElement !== host) {
      host.appendChild(panel.element);
    }

    this.addControl(panel);

    if (!this._panelSubscriptions.has(panel.id)) {
      const subscription = panel.events.on("titleChange", () => {
        this.sync({
          silent: true,
          origin: "system"
        });
      });

      this._panelSubscriptions.set(panel.id, subscription);
      this.disposables.add(subscription);
    }

    this.sync({
      silent: true,
      origin: "system"
    });

    if (!options.silent) {
      this.events.emit("panelAdd", {
        source: this,
        panel,
        panelId: panel.id,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return panel;
  }

  removePanel(panelOrId, options = {}) {
    this._assertMutable("removePanel");

    const panel = typeof panelOrId === "string" ? this.getPanel(panelOrId) : panelOrId;

    if (!panel || !this._panels.has(panel.id)) {
      return null;
    }

    this._panels.delete(panel.id);
    this.tabs.removeTab(panel.id, {
      force: true,
      silent: true,
      origin: options.origin ?? "system"
    });

    const subscription = this._panelSubscriptions.get(panel.id);

    if (subscription) {
      subscription.dispose();
      this._panelSubscriptions.delete(panel.id);
    }

    this._forgetControl(panel);

    if (options.destroy === true) {
      panel.destroy();
    }

    this.sync({
      silent: true,
      origin: options.origin ?? "system"
    });

    if (!options.silent) {
      this.events.emit("panelRemove", {
        source: this,
        panel,
        panelId: panel.id,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return panel;
  }

  getPanel(id) {
    return this._panels.get(id) ?? null;
  }

  panels() {
    return Array.from(this._panels.values());
  }

  setActivePanel(id, options = {}) {
    this._assertMutable("setActivePanel");

    const panel = this.getPanel(id);

    if (!panel || !this._isPanelInTabs(panel)) {
      return false;
    }

    if (this.activePanelId === id) {
      this.tabs.setActive(id, {
        silent: true,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
      this._syncPanelVisibility();
      return false;
    }

    const oldPanelId = this.activePanelId;
    this.activePanelId = id;
    this.tabs.setActive(id, {
      silent: true,
      origin: options.origin ?? "api",
      userAction: options.userAction === true
    });
    this._syncPanelVisibility();

    if (!options.silent) {
      this.events.emit("activePanelChange", {
        source: this,
        oldPanelId,
        panelId: id,
        oldPanel: oldPanelId ? this.getPanel(oldPanelId) : null,
        panel,
        origin: options.origin ?? "api",
        userAction: options.userAction === true
      });
    }

    return true;
  }

  sync(options = {}) {
    this._assertMutable("sync");

    if (!this.element) {
      return this;
    }

    const tabPanels = this._tabPanels();
    const tabPanelIds = new Set(tabPanels.map(panel => panel.id));

    for (const tab of this.tabs.all()) {
      if (!tabPanelIds.has(tab.id)) {
        this.tabs.removeTab(tab.id, {
          force: true,
          silent: true,
          origin: options.origin ?? "system"
        });
      }
    }

    for (const panel of tabPanels) {
      const tab = this.tabs.getTab(panel.id);
      const tabModel = {
        id: panel.id,
        text: panel.title,
        title: panel.title,
        closeable: panel.closeable === true
      };

      if (tab) {
        this.tabs.updateTab(panel.id, tabModel, {
          silent: true,
          origin: options.origin ?? "system"
        });
      } else {
        this.tabs.addTab(tabModel, {
          silent: true,
          origin: options.origin ?? "system"
        });
      }
    }

    if (!this.activePanelId || !tabPanelIds.has(this.activePanelId)) {
      this.activePanelId = this.tabs.activeId && tabPanelIds.has(this.tabs.activeId)
        ? this.tabs.activeId
        : tabPanels[0]?.id ?? null;
    }

    if (this.activePanelId) {
      this.tabs.setActive(this.activePanelId, {
        silent: true,
        origin: options.origin ?? "system"
      });
    }

    this._syncPanelVisibility();
    this._syncTabVisibility();
    return this;
  }

  _syncPanelVisibility() {
    for (const panel of this.panels()) {
      if (!panel.element) {
        continue;
      }

      const hiddenInGroup = panel.id !== this.activePanelId || !this._isPanelInTabs(panel);
      panel.element.hidden = hiddenInGroup;
      panel.element.classList.toggle("dui-dock-panel--tab-hidden", hiddenInGroup);

      if (hiddenInGroup) {
        panel.element.setAttribute("aria-hidden", "true");
      } else {
        panel.element.removeAttribute("aria-hidden");
      }
    }
  }

  _syncTabVisibility() {
    const tabCount = this._tabPanels().length;

    this.element?.classList.toggle("dui-dock-group--single", tabCount <= 1);

    if (this.tabs.element) {
      this.tabs.element.hidden = tabCount <= 1;
    }
  }

  _tabPanels() {
    return this.panels().filter(panel => this._isPanelInTabs(panel));
  }

  _isPanelInTabs(panel) {
    return panel.visible && !panel.collapsed;
  }
}
