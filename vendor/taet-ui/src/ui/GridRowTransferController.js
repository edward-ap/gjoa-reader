import {normalizeMutationOptions} from "../core/mutationOptions.js";
import {DataStore} from "../core/DataStore.js";
const MIME = "application/x-dense-ui-grid-rows";
let active = null;
let sequence = 0;
const same = (a,b) => a.length === b.length && a.every((item,i) => item === b[i]);
function available(g) {
  return Boolean(g && !g.destroyed && !g._destroyingGrid && !g.disabled && !g._editing &&
    !g.dataProvider && g.data?.constructor === DataStore && !g.data.destroyed && !g.view.destroyed &&
    !g.groups.destroyed && !g.groups.hasAny());
}
function schema(a,b) {
  if (a.data.idField !== b.data.idField || a.data.getId !== b.data.getId || a.columns.length !== b.columns.length) return false;
  return a.columns.every(c => b.columns.some(t => t.id === c.id && (t.field ?? t.id) === (c.field ?? c.id) && t.value === c.value));
}
function reason(source,target,ids,mapped=false) {
  if (!available(source) || !source._rowTransferOptions.drag) return "source-unavailable";
  if (!available(target) || !target._rowTransferOptions?.accept) return "target-unavailable";
  if (source === target || source.data === target.data) return "same-store";
  if (!mapped && !schema(source,target)) return "schema-mismatch";
  if ([source.data,target.data].some(s => s._transaction || s._beforeDepth || s._transferLock)) return "busy";
  if (!mapped && ids.some(id => target.data._itemsById.has(id))) return "id-conflict";
  return null;
}
export function transferGridRows(source,target,ids,options={}) {
  const mutation=normalizeMutationOptions(options);
  const mode = options.mode ?? source.rowTransferMode;
  const errors = [];
  let result = {accepted:false,mode,ids:[],sourceIds:[],reason:null,notificationErrors:errors};
  const report = () => {
    for (const [owner,role] of [[source,"source"],[target,"target"]]) {
      if (owner?._rowTransferOptions && !owner.destroyed && !owner._destroyingGrid && owner.events?._emitCollect) owner.events._emitCollect("rowTransfer",
        {source:owner,sourceGrid:source,targetGrid:target,role,result,origin:mutation.origin,userAction:mutation.userAction},result.notificationErrors,
        ()=>!owner.destroyed && !owner._destroyingGrid);
    }
    return result;
  };
  const reject = value => {result.reason=value;return report();};
  if (!target || !Array.isArray(ids) || !ids.length) return reject("invalid-ids");
  const problem = reason(source,target,ids,Boolean(options.mapItem));
  if (problem) return reject(problem);
  const sourceData=source.data,targetData=target.data,sourceView=source.view,targetView=target.view;
  const sourceColumns=source.columns,targetColumns=target.columns;
  const visible=source.view.all(),targetVisible=target.view.all();
  const sourceVersion=source.view._projectionVersion,targetVersion=target.view._projectionVersion;
  if (ids.some(id => !visible.includes(source.data.get(id)))) return reject("not-visible");
  const current=()=>available(source)&&available(target)&&source.data===sourceData&&target.data===targetData&&
    source.view===sourceView&&target.view===targetView&&source.columns===sourceColumns&&target.columns===targetColumns&&
    source.view._projectionVersion===sourceVersion&&target.view._projectionVersion===targetVersion&&
    same(visible,source.view.all())&&same(targetVisible,target.view.all());
  const before=proposal=>{
    for (const [owner,role] of [[target,"target"],[source,"source"]]) {
      if (!current()) return false;
      const event={source:owner,sourceGrid:source,targetGrid:target,role,...proposal,origin:mutation.origin,userAction:mutation.userAction,cancel:false,reason:null};
      owner.events.emit("beforeRowTransfer",event);
      if (event.cancel || !current()) {result.reason=event.reason ?? "veto";return false;}
    }
    return true;
  };
  const hookReason=result;
  result=sourceData._transferTo(targetData,ids,{...options,...mutation,mode},{current,before});
  if (!result.accepted && hookReason.reason) result.reason=hookReason.reason;
  return report();
}
export class GridRowTransferController {
  constructor(grid) { this.grid=grid;this.preview=null; }
  attach(body) {
    const g=this.grid;
    if (!g._rowTransferOptions.drag && !g._rowTransferOptions.accept) return;
    for (const [name,fn] of [["dragstart",e=>this.start(e)],["dragover",e=>this.over(e)],["drop",e=>this.drop(e)],
      ["dragleave",e=>{if(!body.contains(e.relatedTarget))this.clear();}]]) g.disposables.addEventListener(body,name,fn);
    for (const name of ["dragend","drop"]) g.disposables.addEventListener(document,name,()=>this.finish());
    g.disposables.addEventListener(document,"keydown",e=>{if(e.key==="Escape")this.finish();});
    g.disposables.addEventListener(window,"blur",()=>this.finish());
  }
  syncIndicator(cell) {
    const g=this.grid;
    const enabled=Boolean(g?.indicatorGutterEnabled&&g._rowTransferOptions.drag&&available(g));
    cell.draggable=enabled;
    cell.classList.toggle("dui-grid__indicator--transfer",enabled);
    if(enabled)cell.title=`Drag this service cell to ${g.rowTransferMode} selected rows to another table`;
    else cell.removeAttribute("title");
  }
  sync() {
    for(const cell of this.grid?._body?.querySelectorAll(".dui-grid__row > .dui-grid__indicator-body")??[])this.syncIndicator(cell);
  }
  start(e) {
    if (!e.target.closest?.(".dui-grid__row > .dui-grid__indicator--transfer")) return;
    e.stopPropagation();
    const g=this.grid,row=e.target.closest(".dui-grid__row[data-dui-grid-row-id]"),item=row&&g._getItemFromRow(row);
    if(!available(g)||!g.indicatorGutterEnabled||!g._rowTransferOptions.drag||!item||!e.dataTransfer){e.preventDefault();return;}
    active?.controller.finish();
    const data=g.data,view=g.view,columns=g.columns,revision=data._revision,version=view._projectionVersion,initialMode=g.rowTransferMode;
    const id=data.idOf(item), selected=g.getSelectedIds(), alreadySelected=selected.includes(id);
    const intact=()=>available(g)&&g.data===data&&g.view===view&&g.columns===columns&&data._revision===revision&&
      view._projectionVersion===version&&g.rowTransferMode===initialMode&&data.get(id)===item&&view.get(id)===item;
    if(!intact()){e.preventDefault();return;}
    if(!alreadySelected)g.setSelectedIds([id],{origin:"user",userAction:true});
    if(!intact()||!same(g.getSelectedIds(),alreadySelected?selected:[id])){e.preventDefault();return;}
    const ids=g.getSelectedIds(),mode=g.rowTransferMode;
    const session={controller:this,grid:g,ids,mode,token:`dui-${++sequence}-${Math.random().toString(36).slice(2)}`,subscriptions:[],targets:new Set()};
    session.current=()=>intact()&&same(g.getSelectedIds(),ids);
    active=session;
    g.element.classList.add("dui-grid--row-transferring");
    const ghost=document.createElement("div");ghost.className="dui-grid__transfer-ghost";ghost.textContent=`${ids.length} row${ids.length===1?"":"s"} | ${mode}`;
    g.element.append(ghost);session.ghost=ghost;
    e.dataTransfer.setData(MIME,session.token);
    // Some native WebKit bridges retain only standard text flavors. This is an
    // opaque session token, never serialized rows or arbitrary text ingestion.
    e.dataTransfer.setData("text/plain",session.token);e.dataTransfer.effectAllowed=mode;
    e.dataTransfer.setDragImage?.(ghost,0,0);
    session.subscriptions.push(g.events.on("sortChange",()=>this.finish()));
    for(const model of [g.data,g.view,g.columnModel,g.selection,g.groups])session.subscriptions.push(model.events.on("invalidate",()=>this.finish()));
  }
  session(e,drop=false) {
    const s=active;
    if(s&&!s.current()){s.controller.finish();return null;}
    if(!s)return null;
    const types=Array.from(e.dataTransfer?.types??[]);
    if(!types.includes(MIME)&&!types.includes("text/plain"))return null;
    if(drop&&e.dataTransfer.getData(MIME)!==s.token&&e.dataTransfer.getData("text/plain")!==s.token)return null;
    return s;
  }
  over(e) {
    const s=this.session(e);if(!s)return;
    const problem=reason(s.grid,this.grid,s.ids);
    e.preventDefault();e.stopPropagation();
    e.dataTransfer.dropEffect=problem?"none":s.mode;
    this.clear();this.preview={body:this.grid._body,session:s};s.targets.add(this);
    s.ghost.textContent=`${s.ids.length} rows | ${s.mode}${problem?" | "+problem:""}`;
    this.preview.body.classList.add(problem?"dui-grid__transfer-target--invalid":"dui-grid__transfer-target--valid");
    this.preview.body.dataset.duiTransferReason=problem??`${s.mode} ${s.ids.length} rows`;
  }
  drop(e) {
    const s=this.session(e,true);if(!s)return;
    e.preventDefault();e.stopPropagation();
    const source=s.grid,ids=[...s.ids],mode=s.mode;
    s.controller.finish();
    if(!this.grid?.destroyed)source.transferRowsTo(this.grid,ids,{mode,origin:"user",userAction:true});
  }
  clear() {
    const body=this.preview?.body;
    body?.classList.remove("dui-grid__transfer-target--valid","dui-grid__transfer-target--invalid");
    if(body)delete body.dataset.duiTransferReason;
    const s=this.preview?.session;if(s&&active===s)s.ghost.textContent=`${s.ids.length} rows | ${s.mode}`;this.preview=null;
  }
  finish() {
    if(active?.controller===this){const s=active;active=null;s.grid.element?.classList.remove("dui-grid--row-transferring");for(const sub of s.subscriptions)sub.dispose();for(const target of s.targets)target.clear();s.ghost?.remove();}
    this.clear();
  }
  destroy() {this.finish();this.grid=null;}
}
