const stroke = { fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" };

export const coreIcons = {
  "more-vertical": { viewBox: "0 0 6 18", nodes: [3, 9, 15].map(cy => ["circle", { cx: 3, cy, r: 1, fill: "currentColor" }]) },
  "chart-select": icon([path("M5 3v17l5-5 4 7 3-2-4-6h7Z")]),
  "chart-line": icon([path("M4 19 20 5"),circle(4,19,2),circle(20,5,2)]),
  "chart-horizontal": icon([path("M3 12h18")]),
  "chart-vertical": icon([path("M12 3v18")]),
  "chart-rectangle": icon([rect(3,5,18,14,0)]),
  "chart-text": icon([path("M4 6V3h16v3M12 3v18M8 21h8")]),
  "chart-undo": icon([path("m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12")]),
  "chart-redo": icon([path("m16 4 5 5-5 5M21 9H10a6 6 0 0 0 0 12")]),
  copy: icon([rect(8, 8, 12, 13, 1), path("M16 8V3H3v13h5")]),
  export: icon([path("M12 16V3m-5 5 5-5 5 5M5 16v5h14v-5")]),
  trash: icon([path("M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7")]),
  upload: icon([path("M7 18H6a4 4 0 0 1-.6-8A7 7 0 0 1 19 9a4.5 4.5 0 0 1-.5 9H17M12 21V11m-4 4 4-4 4 4")]),
  play: icon([["path", { d: "M7 4v16l13-8z", fill: "currentColor" }]]),
  stop: icon([["rect", { x: 5, y: 5, width: 14, height: 14, fill: "currentColor" }]]),
  save: icon([path("M5 3h12l2 2v16H5z"), path("M8 3v6h8V3M8 21v-8h8v8")]),
  validate: icon([path("m5 12 4 4L19 6")]),
  import: icon([path("M12 3v12m-5-5 5 5 5-5M5 21h14")]),
  check: icon([path("m5 12 4 4L19 6")]),
  add: icon([path("M12 5v14M5 12h14")]),
  remove: icon([path("M5 12h14")]),
  search: icon([circle(11, 11, 7), path("m20 20-4-4")]),
  edit: icon([path("M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4")]),
  "zoom-in": icon([circle(10, 10, 6), path("M14.5 14.5 21 21M10 7v6M7 10h6")]),
  "zoom-out": icon([circle(10, 10, 6), path("M14.5 14.5 21 21M7 10h6")]),
  fit: icon([path("M8 4H4v4M16 4h4v4M4 16v4h4M20 16v4h-4"), rect(8, 8, 8, 8, 0)]),
  grid: icon([rect(4, 4, 16, 16, 0), path("M4 10h16M4 16h16M10 4v16M16 4v16")]),
  eyedropper: icon([path("m14 4 6 6M16 2l6 6-9 9-4-4zM10 16l-5 5H2v-3l5-5")]),
  filter: icon([path("M4 5h16l-6 7v6l-4 2v-8z")]),
  calendar: icon([rect(3, 5, 18, 16, 2), path("M16 3v4M8 3v4M3 10h18")]),
  clock: icon([circle(12, 12, 9), path("M12 7v5l3 2")]),
  "chevron-down": icon([["path", { d: "m6 9 6 7 6-7z", fill: "currentColor" }]]),
  "chevron-up": icon([["path", { d: "m6 15 6-7 6 7z", fill: "currentColor" }]]),
  "chevron-left": icon([path("m15 18-6-6 6-6")]),
  "chevron-right": icon([path("m9 18 6-6-6-6")]),
  folder: icon([path("M3 6h7l2 2h9v11H3z")]),
  file: icon([path("M6 3h8l4 4v14H6zM14 3v5h4")]),
  workspace: icon([rect(3, 4, 18, 16, 2), path("M3 9h18M8 9v11")]),
  source: icon([path("M5 5h14v14H5zM8 9h8M8 13h8M8 17h5")]),
  mapping: icon([circle(7, 7, 3), circle(17, 17, 3), path("M9 9l6 6")]),
  warning: icon([path("M12 3 2 21h20zM12 9v5M12 18h.01")]),
  info: icon([circle(12, 12, 9), path("M12 11v6M12 7h.01")]),
  settings: icon([
    path("M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21h-4v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3.1 14H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3.1V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.1v4h-.1a1.7 1.7 0 0 0-1.5 1z")
  ]),
  "theme-light": icon([
    ["circle", { cx: 12, cy: 12, r: 7, fill: "#fff", stroke: "#111", "stroke-width": 1.5 }]
  ]),
  "theme-dark": icon([
    ["circle", { cx: 12, cy: 12, r: 7, fill: "#111", stroke: "#111", "stroke-width": 1.5 }]
  ]),
  "page-first": icon([path("m11 7-5 5 5 5M18 7l-5 5 5 5")]),
  "page-last": icon([path("m6 7 5 5-5 5M13 7l5 5-5 5")]),
  "window.close": icon([path("M4 4l16 16M20 4 4 20")]),
  "window.minimize": icon([path("M4 18h16")]),
  "window.maximize": icon([rect(5, 5, 14, 14, 0)]),
  "window.restore": icon([rect(4, 8, 12, 12, 0), path("M8 8V4h12v12h-4")]),
  "window.pin": icon([path("M12 17v5M5 3h14M7 3v7l-3 3v2h16v-2l-3-3V3")]),
  "window.unpin": icon([path("M12 17v5M5 3h14M7 3v5M17 3v7l3 3v2H9M3 3l18 18")]),
  "window.dock": icon([rect(4, 4, 16, 16, 0), path("M14 4v16")]),
  "window.undock": icon([rect(4, 8, 12, 12, 0), path("M9 4h11v11M13 11l7-7")])
};

function icon(nodes) {
  return { viewBox: "0 0 24 24", nodes };
}

function path(d) {
  return ["path", { ...stroke, d }];
}

function circle(cx, cy, r) {
  return ["circle", { ...stroke, cx, cy, r }];
}

function rect(x, y, width, height, rx) {
  return ["rect", { ...stroke, x, y, width, height, rx }];
}
