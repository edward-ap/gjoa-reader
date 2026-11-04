import { renderIcon } from "./Icon.js";

const ACTION_LABELS = Object.freeze({
  close:"Close",
  minimize:"Minimize",
  collapse:"Collapse",
  pin:"Pin",
  unpin:"Unpin",
  dock:"Dock",
  undock:"Undock",
  maximize:"Maximize",
  restore:"Restore"
});

export function createHeaderAction(action, options = {}) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = ["dui-header-action", options.className].filter(Boolean).join(" ");

  if (options.command) {
    button.dataset.duiHeaderCommand = options.command;
  }

  setHeaderAction(button, action, options);
  return button;
}

export function setHeaderAction(button, action, options = {}) {
  if (!(button instanceof HTMLElement)) {
    throw new TypeError("Header action button must be an HTMLElement.");
  }

  const normalized = normalizeHeaderAction(action);
  const label = options.label ?? ACTION_LABELS[normalized];
  button.dataset.duiHeaderAction = normalized;
  button.title = options.tooltip ?? label;
  button.setAttribute("aria-label", label);
  renderIcon(button, normalized === "collapse" ? "window.minimize" : `window.${normalized}`);

  if (options.pressed == null) {
    button.removeAttribute("aria-pressed");
  } else {
    button.setAttribute("aria-pressed", String(options.pressed === true));
  }

  button.classList.toggle("dui-active", options.active === true);
  return button;
}

export function headerActionLabel(action) {
  return ACTION_LABELS[normalizeHeaderAction(action)];
}

function normalizeHeaderAction(action) {
  const normalized = String(action ?? "").trim().toLowerCase();

  if (!Object.prototype.hasOwnProperty.call(ACTION_LABELS, normalized)) {
    throw new TypeError(`Unsupported header action: ${action}.`);
  }

  return normalized;
}
