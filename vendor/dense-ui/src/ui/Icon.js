import { IconRegistry } from "../core/IconRegistry.js";
import { coreIcons } from "./icons/core-icons.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const ALLOWED_TAGS = new Set(["path", "circle", "rect", "line", "polyline", "polygon", "ellipse"]);
const ALLOWED_ATTRIBUTES = new Set([
  "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "width", "height",
  "points", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "fill-rule", "clip-rule",
  "opacity", "transform"
]);

export const icons = new IconRegistry(coreIcons);

export function createIcon(name, options = {}) {
  const definition = (options.registry ?? icons).resolve(name);

  if (!definition) {
    throw new Error(`Unknown icon "${name}".`);
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("dui-icon");
  if (options.className) svg.classList.add(...String(options.className).split(/\s+/).filter(Boolean));
  svg.setAttribute("viewBox", definition.viewBox);
  svg.setAttribute("focusable", "false");

  if (options.label) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", String(options.label));
  } else {
    svg.setAttribute("aria-hidden", "true");
  }

  for (const [tagName, attributes] of definition.nodes) {
    if (!ALLOWED_TAGS.has(tagName)) throw new Error(`Unsupported icon node "${tagName}".`);
    const node = document.createElementNS(SVG_NS, tagName);
    for (const [attribute, value] of Object.entries(attributes)) {
      if (!ALLOWED_ATTRIBUTES.has(attribute)) throw new Error(`Unsupported icon attribute "${attribute}".`);
      node.setAttribute(attribute, String(value));
    }
    svg.append(node);
  }

  return svg;
}

export function renderIcon(host, name, options = {}) {
  host.replaceChildren();
  host.hidden = !name;
  if (name) host.append(createIcon(name, options));
  return host;
}
