// A lightweight protocol shared by tables and the optional control editor catalog.
export const GRID_EDITOR_FACTORY = Symbol.for("dui.gridEditorFactory");

export function isGridEditorFactory(value) {
  return Boolean(value && typeof value === "object" &&
    value[GRID_EDITOR_FACTORY] === true && typeof value.createCellEditor === "function");
}
