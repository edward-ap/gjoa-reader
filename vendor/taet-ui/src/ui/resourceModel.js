/** Validate a flat resource tree before replacing the visible model. */
export function validateResources(items) {
  if (!Array.isArray(items)) throw new TypeError("Resource items must be an array.");
  const map = new Map();
  const result = items.map(item => {
    if (!item || !(typeof item.id === "string" || typeof item.id === "number" && Number.isFinite(item.id)) ||
        typeof item.name !== "string" || !item.name.trim() || !["folder", "file"].includes(item.kind)) {
      throw new TypeError("Resources require a string/finite-number id, nonempty name and folder/file kind.");
    }
    if (map.has(item.id)) throw new Error("Duplicate resource id.");
    const copy = { ...item, parentId: item.parentId ?? null };
    map.set(copy.id, copy);
    return copy;
  });
  const visited = new Set();
  for (const item of result) {
    let node = item;
    const path = new Set();
    while (node && !visited.has(node.id)) {
      if (path.has(node.id)) throw new Error("Resource tree contains a cycle.");
      path.add(node.id);
      if (node.parentId == null) break;
      const parent = map.get(node.parentId);
      if (!parent || parent.kind !== "folder") throw new Error("Resource parent must be an existing folder.");
      node = parent;
    }
    for (const id of path) visited.add(id);
  }
  return result;
}

let sequence = 0;
export function resourceId(items) {
  const ids = new Set(items.map(item => item.id));
  let id;
  do { id = `resource-${++sequence}`; } while (ids.has(id));
  return id;
}

/** Stateless, in-memory provider. No native filesystem or OS clipboard access. */
export class MemoryResourceProvider {
  canExecute(command) { return !["importFile", "addExisting", "properties"].includes(command); }
  execute(request) {
    const { command, id, parentId = null, clipboard } = request;
    let items = validateResources(request.items);
    const item = items.find(node => Object.is(node.id, id));
    const requireItem = () => { if (!item) throw new Error("Resource no longer exists."); };
    const requireParent = () => {
      if (parentId != null && !items.some(node => Object.is(node.id, parentId) && node.kind === "folder")) {
        throw new Error("Destination must be a folder.");
      }
    };
    const name = String(request.name ?? "").trim();
    const checkName = (value, parent, except) => {
      if (!value) throw new Error("Enter a name.");
      if (items.some(node => Object.is(node.parentId, parent) && !Object.is(node.id, except) && node.name === value)) {
        throw new Error("A resource with this name already exists here.");
      }
    };
    if (command === "create") {
      requireParent(); checkName(name, parentId);
      const created = { id: resourceId(items), parentId, name, kind: request.kind ?? "folder" };
      items.push(created);
      return { items, selectId: created.id };
    }
    if (command === "rename") {
      requireItem(); checkName(name, item.parentId, id);
      return { items: items.map(node => Object.is(node.id, id) ? { ...node, name } : node), selectId: id };
    }
    if (["delete", "move", "copy"].includes(command)) {
      const sourceId = command === "delete" ? id : clipboard?.id ?? id;
      const source = items.find(node => Object.is(node.id, sourceId));
      if (!source) throw new Error("Source no longer exists.");
      const children = new Map();
      for (const node of items) { const group = children.get(node.parentId) ?? []; group.push(node); children.set(node.parentId, group); }
      const subtree = [source];
      for (let i = 0; i < subtree.length; i++) subtree.push(...(children.get(subtree[i].id) ?? []));
      const ids = new Set(subtree.map(node => node.id));
      if (command === "delete") return { items: items.filter(node => !ids.has(node.id)), selectId: source.parentId };
      requireParent();
      if (ids.has(parentId)) throw new Error("Cannot paste a resource into itself or a descendant.");
      checkName(source.name, parentId, command === "move" ? sourceId : undefined);
      if (command === "move") return { items: items.map(node => Object.is(node.id, sourceId) ? { ...node, parentId } : node), selectId: sourceId };
      const mapping = new Map();
      for (const node of subtree) {
        const copy = { ...node, id: resourceId(items), parentId: Object.is(node.id, sourceId) ? parentId : mapping.get(node.parentId) };
        mapping.set(node.id, copy.id); items.push(copy);
      }
      return { items, selectId: mapping.get(sourceId) };
    }
    if (["refresh", "open"].includes(command)) return null;
    throw new Error(`Unsupported resource operation: ${command}`);
  }
}
