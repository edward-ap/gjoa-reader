import { DataStore } from "../core/DataStore.js";
import { TreeDataView } from "../core/TreeDataView.js";
import { normalizeMutationOptions } from "../core/mutationOptions.js";

const positions = new Set(["before", "inside", "after"]);
const sameId = (left, right) => left === right || Object.is(left, right);
const sameRows = (left, right) => left.length === right.length && left.every((row, index) => row === right[index]);
const alive = grid => grid && !grid.destroyed && !grid._destroyingGrid && !grid._destroyingTree && !grid.events?.destroyed;
const base = (targetId = null, position = "inside") => ({ accepted:false, reason:null, ids:[], subtreeIds:[],
  targetId:targetId ?? null, position, parentId:null, notificationErrors:[] });
const hidden = (result, name, value) => Object.defineProperty(result, name, { value });

function availability(grid, token) {
  if (!alive(grid)) return "destroyed";
  if (grid.nodeReorderEnabled !== true) return "node-reorder-disabled";
  if (grid.disabled) return "disabled";
  if (grid._editing || grid._startingEdit || grid._committingEdit || grid._commitSession) return "editing";
  if (grid._movingNodes && grid._movingNodes !== token) return "busy";
  const data = grid.data, view = grid.treeView;
  if (!(data instanceof DataStore) || data.constructor !== DataStore ||
      data.parse !== DataStore.prototype.parse || data.batch !== DataStore.prototype.batch ||
      data._parse !== DataStore.prototype._parse || data._batch !== DataStore.prototype._batch) return "unsupported-store";
  if (!(view instanceof TreeDataView) || view.constructor !== TreeDataView || view.data !== data) return "unsupported-view";
  if (data.destroyed || view.destroyed) return "destroyed";
  if (data._transaction || data._beforeDepth || data._transferLock || view._buildingProjection) return "busy";
  return null;
}

function contextOf(grid, token) {
  const data = grid.data, view = grid.treeView;
  return { grid, token, data, view, revision:data._revision, sourceArray:data._items,
    idField:data.idField, getId:data.getId, columns:grid.columns, columnModel:grid.columnModel,
    treeColumnId:grid.treeColumnId, gridParentField:grid.parentField, gridRootParentId:grid.rootParentId,
    parentField:view.parentField, rootParentId:view.rootParentId,
    viewParentField:view.parentField, viewRootParentId:view.rootParentId, filter:view._filter, sort:view.getSort(),
    entries:view._entries, expansion:view._expansionRevision };
}

function schemaCurrent(context) {
  const {grid,data,view} = context;
  return alive(grid) && !grid.disabled && !grid._editing && !grid._startingEdit && !grid._committingEdit &&
    grid.nodeReorderEnabled === true && grid.data === data && grid.treeView === view &&
    !data.destroyed && !view.destroyed && data.idField === context.idField && data.getId === context.getId &&
    grid.columns === context.columns && grid.columnModel === context.columnModel && grid.treeColumnId === context.treeColumnId &&
    grid.parentField === context.gridParentField && grid.rootParentId === context.gridRootParentId &&
    view.parentField === context.viewParentField && view.rootParentId === context.viewRootParentId &&
    view._filter === context.filter && view.getSort() === context.sort &&
    (context.token ? grid._movingNodes === context.token : !grid._movingNodes);
}

function current(context) {
  return schemaCurrent(context) && context.data._revision === context.revision &&
    context.data._items === context.sourceArray && context.view._entries === context.entries &&
    context.view._expansionRevision === context.expansion && context.structure?.() !== false &&
    context.data._revision === context.revision;
}

function descendants(graph, roots) {
  const result = new Set(), pending = [...roots];
  while (pending.length) {
    const id = pending.pop();
    if (result.has(id)) continue;
    result.add(id);
    pending.push(...(graph.children.get(id) ?? []));
  }
  return result;
}

function sources(grid, ids, token) {
  const result = base();
  const reject = reason => ({ ...result, reason });
  try {
    const unavailable = availability(grid, token);
    if (unavailable) return reject(unavailable);
    if (!Array.isArray(ids) || !ids.length || ids.some(id => typeof id !== "string" && typeof id !== "number")) return reject("invalid-ids");
    const context = contextOf(grid, token), rows = grid.data.all(), rowIds = [], byId = new Map(), parents = new Map(), children = new Map();
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index], id = context.data.idOf(row,index);
      if (!current(context)) return reject("stale");
      if (!sameId(id,context.data.idOf(row)) || !current(context)) return reject("unstable-ids");
      if (byId.has(id)) return reject("invalid-tree");
      rowIds.push(id); byId.set(id,row);
      const parentId = row[context.parentField] ?? context.rootParentId;
      if (!current(context)) return reject("stale");
      parents.set(id,parentId);
      const siblings = children.get(parentId) ?? []; siblings.push(id); children.set(parentId,siblings);
    }
    if (byId.has(context.rootParentId)) return reject("invalid-tree");
    for (const parentId of parents.values()) {
      if (!sameId(parentId,context.rootParentId) && !byId.has(parentId)) return reject("invalid-tree");
    }
    const checked = new Set();
    for (const id of rowIds) {
      let next = id; const chain = new Set();
      while (!sameId(next,context.rootParentId) && !checked.has(next)) {
        if (chain.has(next)) return reject("invalid-tree");
        chain.add(next); next = parents.get(next);
      }
      for (const member of chain) checked.add(member);
    }
    const wanted = new Set(ids);
    if ([...wanted].some(id => !byId.has(id))) return reject("missing-id");
    const roots = rowIds.filter(id => {
      if (!wanted.has(id)) return false;
      let parentId = parents.get(id);
      while (!sameId(parentId,context.rootParentId)) {
        if (wanted.has(parentId)) return false;
        parentId = parents.get(parentId);
      }
      return true;
    });
    const graph = {rowIds,byId,parents,children}, moving = descendants(graph,roots);
    Object.assign(result,{accepted:true, ids:roots, subtreeIds:rowIds.filter(id=>moving.has(id)),
      items:roots.map(id=>byId.get(id)), sourceItems:rows, parentId:context.rootParentId});
    hidden(result,"_context",context); hidden(result,"_graph",graph); hidden(result,"_moving",moving);
    return result;
  } catch (error) {
    result.notificationErrors.push(error);
    return reject("callback-error");
  }
}

/** Complete local source description, independent of a prospective drop target. */
export function describeTreeGridMoveSources(grid, ids) {
  return sources(grid,ids,undefined);
}

function plan(grid, ids, targetId, position, token) {
  const result = base(targetId,position), description = sources(grid,ids,token);
  const reject = reason => {
    const rejected = { ...result, reason };
    hidden(rejected,"_sources",description);
    return rejected;
  };
  result.notificationErrors.push(...description.notificationErrors);
  if (!description.accepted) return reject(description.reason);
  const context = description._context, graph = description._graph, moving = description._moving;
  result.parentId = context.rootParentId;
  try {
    if (!positions.has(position)) return reject("invalid-position");
    if (targetId === undefined || (targetId !== null && typeof targetId !== "string" && typeof targetId !== "number")) return reject("invalid-target");
    if (targetId === null && position !== "inside") return reject("invalid-target");
    if (targetId !== null && !graph.byId.has(targetId)) return reject("missing-target");
    if (targetId !== null && moving.has(targetId)) return reject("cycle");
    if (position !== "inside" && context.sort != null) return reject("sorted-order");
    const parentId = targetId === null ? context.rootParentId : position === "inside" ? targetId : graph.parents.get(targetId);
    const rootSet = new Set(description.ids), replacement = new Map();
    for (const id of description.ids) {
      const row = graph.byId.get(id);
      replacement.set(id, sameId(graph.parents.get(id),parentId) ? row : {...row,[context.parentField]:parentId});
      if (!current(context)) return reject("stale");
    }
    const rest = [], block = [], restIds = [];
    description.sourceItems.forEach((row,index)=>{
      const id = graph.rowIds[index];
      if (moving.has(id)) block.push(replacement.get(id) ?? row);
      else {rest.push(row);restIds.push(id)}
    });
    let insertion = rest.length;
    if (targetId !== null) {
      const targetIndex = restIds.indexOf(targetId);
      if (position === "before") insertion = targetIndex;
      else if (position === "after") insertion = targetIndex + 1;
      else insertion = restIds.reduce((last,id,index)=>sameId(graph.parents.get(id),targetId)?index+1:last,targetIndex+1);
    }
    const nextItems = [...rest.slice(0,insertion),...block,...rest.slice(insertion)];
    const expectedIds = new Map(description.sourceItems.map((row,index)=>[row,graph.rowIds[index]]));
    for (const [id,row] of replacement) expectedIds.set(row,id);
    const nextChildren = new Map();
    for (let index=0;index<nextItems.length;index++) {
      const row=nextItems[index],id=context.data.idOf(row,index);
      if (!current(context)) return reject("stale");
      if (!sameId(context.data.idOf(row),id) || !current(context) || !sameId(expectedIds.get(row),id)) return reject("unstable-ids");
      const parent=rootSet.has(id)?parentId:graph.parents.get(id),siblings=nextChildren.get(parent)??[];
      siblings.push(id);nextChildren.set(parent,siblings);
    }
    const sameTree = graph.children.size === nextChildren.size && [...graph.children].every(([parent,children])=>{
      const next=nextChildren.get(parent);return next && children.length===next.length && children.every((id,index)=>sameId(id,next[index]));
    });
    if (sameTree) return reject("noop");
    context.structure = () => {
      for (let index=0;index<description.sourceItems.length;index++) {
        const row=description.sourceItems[index],id=graph.rowIds[index];
        if (!sameId(context.data.idOf(row,index),id) || !sameId(row[context.parentField]??context.rootParentId,graph.parents.get(id))) return false;
      }
      for (let index=0;index<nextItems.length;index++) {
        const row=nextItems[index],id=expectedIds.get(row),parent=rootSet.has(id)?parentId:graph.parents.get(id);
        if (!sameId(context.data.idOf(row,index),id) || !sameId(row[context.parentField]??context.rootParentId,parent)) return false;
      }
      return true;
    };
    if (!current(context)) return reject("stale");
    Object.assign(result,{accepted:true,reason:null,ids:[...description.ids],subtreeIds:[...description.subtreeIds],parentId,
      items:[...description.items],sourceItems:[...description.sourceItems],nextItems});
    hidden(result,"_context",context);hidden(result,"_sources",description);
    return result;
  } catch (error) {
    result.notificationErrors.push(error); return reject("callback-error");
  }
}

/** Side-effect-free planning: source array order determines sibling order. */
export function planTreeGridMove(grid, ids, targetId, position = "inside") {
  return plan(grid,ids,targetId,position,undefined);
}

function publish(grid, result, mutation, nativeEvent, currentOwner) {
  if (mutation.silent || !alive(grid) || grid._reportingNodeMove) return;
  grid._reportingNodeMove = true;
  try {
    const snapshot={...result,ids:[...result.ids],subtreeIds:[...result.subtreeIds],notificationErrors:[...result.notificationErrors]};
    grid.events._emitCollect("nodeMove", {source:grid,result:snapshot,origin:mutation.origin,userAction:mutation.userAction,nativeEvent},
      result.notificationErrors,currentOwner);
  } finally { grid._reportingNodeMove=false; }
}

/** One preflighted parse and one history batch; committed observer errors are reported. */
export function moveTreeGridNodes(grid, ids, targetId, position = "inside", options = {}) {
  const result=base(targetId,position),token={};
  let mutation={silent:false,origin:"api",userAction:false},nativeEvent=null,context,committed=false,postRevision,holding=false,previousHold;
  const releaseSelection = () => {
    if (!holding) return;
    holding=false;
    if (grid._nodeMoveSelectionHold===token) {
      if (previousHold===undefined) delete grid._nodeMoveSelectionHold;
      else grid._nodeMoveSelectionHold=previousHold;
    }
    if (alive(grid) && grid.data===context.data && grid.treeView===context.view && !context.data.destroyed && !context.view.destroyed) {
      try {grid._reconcileSelection?.()} catch(error) {result.notificationErrors.push(error)}
    }
  };
  const busy=Boolean(grid?._movingNodes);
  if (!busy && grid) grid._movingNodes=token;
  try {
    mutation=normalizeMutationOptions(options);nativeEvent=options?.nativeEvent??null;
    const planned=plan(grid,ids,targetId,position,busy?undefined:token),known=planned._sources;
    Object.assign(result,{reason:planned.reason,parentId:planned.parentId,
      ids:[...(known?.ids??[])],subtreeIds:[...(known?.subtreeIds??[])]});
    result.notificationErrors.push(...planned.notificationErrors);
    if (!planned.accepted) return result;
    context=planned._context;
    const selection=grid.selection,selectionAttempt=grid._selectionAttempt,activeId=grid._activeId;
    if (!current(context)) {result.reason="stale";return result}
    if (!mutation.silent) {
      const event={source:grid,ids:[...planned.ids],subtreeIds:[...planned.subtreeIds],items:[...planned.items],
        targetId:result.targetId,position,parentId:result.parentId,cancel:false,reason:null,
        origin:mutation.origin,userAction:mutation.userAction,nativeEvent};
      grid.events._emitCollect("beforeNodeMove",event,result.notificationErrors,()=>current(context)&&!result.notificationErrors.length&&!event.cancel);
      if (result.notificationErrors.length) {result.reason="callback-error";return result}
      if (!current(context)) {result.reason="stale";return result}
      if (event.cancel) {result.reason=typeof event.reason==="string"&&event.reason?event.reason:"veto";return result}
    }
    const storeOptions={silent:mutation.silent,origin:mutation.origin,userAction:mutation.userAction};
    const applied=context.data._parse(planned.nextItems,storeOptions,()=>{committed=true}, {
      current:()=>current(context),
      commit:apply=>{
        previousHold=grid._nodeMoveSelectionHold;grid._nodeMoveSelectionHold=token;holding=true;
        return context.data._batch(apply,storeOptions,{notificationErrors:result.notificationErrors});
      }
    });
    if (!applied && !committed) {result.reason=current(context)?"veto":"stale";return result}
    result.accepted=committed;result.reason=committed?null:"veto";postRevision=context.data._revision;
    const postCurrent=()=>schemaCurrent(context)&&context.data._revision===postRevision&&sameRows(context.data.all(),planned.nextItems);
    if (committed && postCurrent() && position==="inside" && targetId!==null && options.expandTarget!==false) {
      try {
        if (typeof grid.expand==="function") grid.expand(targetId,storeOptions);
        else context.view.expand(targetId,storeOptions);
      } catch(error) {result.notificationErrors.push(error)}
    }
    releaseSelection();
    if (committed && postCurrent() && selection && !selection.destroyed && grid.selection===selection && grid._selectionAttempt===selectionAttempt) {
      if (activeId!=null && grid._activeId==null && context.view.has(activeId) &&
          selection.get().some(item=>sameId(context.data.idOf(item),activeId))) grid._activeId=activeId;
      grid._syncSelectionState?.();
      if (postCurrent()) grid._renderStatusBar?.();
    }
    return result;
  } catch(error) {
    result.notificationErrors.push(error);result.accepted=committed;result.reason=committed?null:"callback-error";
    return result;
  } finally {
    try {
      releaseSelection();
      const revision=grid?.data?._revision,entries=grid?.treeView?._entries,columns=grid?.columns;
      publish(grid,result,mutation,nativeEvent,()=>alive(grid)&&grid.data?._revision===revision&&grid.treeView?._entries===entries&&grid.columns===columns);
    } finally {
      if (grid?._movingNodes===token) grid._movingNodes=false;
    }
  }
}
