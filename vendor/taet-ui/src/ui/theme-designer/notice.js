import {IconButton} from '../IconButton.js';

// Instance-owned, non-modal feedback. Kept outside normal layout via the top layer.
export function createNotice(root, duration = 5000) {
 duration = Number.isFinite(duration) && duration >= 0 ? duration : 5000;
 const element = document.createElement('div');
 element.className = 'dui-designer-notice';
 element.setAttribute('popover', 'manual');
 const style = document.createElement('style');
 style.textContent = `
.dui-designer-notice {position:fixed;inset:auto 18px 18px auto;margin:0;box-sizing:border-box;width:360px;max-width:calc(100vw - 36px);max-height:calc(100dvh - 36px);overflow:auto;padding:14px 44px 14px 16px;border:0;border-radius:3px;background:#b4232e;color:#fff;box-shadow:0 3px 14px #0003;font:14px/1.45 var(--dui-font-family, sans-serif);overflow-wrap:anywhere;}
.dui-designer-notice[data-kind="success"] {background:#087b49;}
.dui-designer-notice:popover-open {animation:dui-designer-notice-enter 160ms ease-out;}
.dui-designer-notice strong {display:block;margin-bottom:4px;}
.dui-designer-notice .dui-icon-button {position:absolute;right:8px;top:8px;width:28px;height:28px;padding:4px;background:transparent;color:#fff;border:0;}
.dui-designer-notice .dui-icon-button:hover {background:#ffffff24;color:#fff;}
.dui-designer-notice .dui-icon-button:focus-visible {outline:2px solid white;outline-offset:-2px;}
@keyframes dui-designer-notice-enter {from {transform:translateY(14px);opacity:0;}to {transform:translateY(0);opacity:1;}}
@media(prefers-reduced-motion:reduce) {.dui-designer-notice:popover-open {animation:none;}}
`;
 const content = document.createElement('div'), title = document.createElement('strong'), text = document.createElement('span');
 content.setAttribute('aria-atomic','true');content.append(title,text);
 element.append(style,content);root.append(element);
 let timer=null, remaining=duration, started=0, disposed=false, hovered=false, opener=null;
 const abort=new AbortController();
 // A busy toolbar temporarily disables its focused button. Remember it before
 // that transition, rather than treating document.body as the return target.
 root.addEventListener('focusin',event=>{if(!element.contains(event.target))opener=event.target;},{signal:abort.signal});
 function stop(){if(timer!==null){clearTimeout(timer);timer=null;remaining=Math.max(0,remaining-(performance.now()-started));}}
 function dismiss(){const restore=element.contains(document.activeElement);stop();if(element.matches(':popover-open'))element.hidePopover();if(restore&&opener?.isConnected)opener.focus();}
 function resume(){if(disposed||!duration||hovered||element.contains(document.activeElement)||!element.matches(':popover-open'))return;stop();started=performance.now();timer=setTimeout(dismiss,remaining);}
 const close=new IconButton(element,{text:'Dismiss notification',icon:'window.close',onClick:dismiss});
 element.addEventListener('pointerenter',()=>{hovered=true;stop();},{signal:abort.signal});
 element.addEventListener('pointerleave',()=>{hovered=false;resume();},{signal:abort.signal});
 element.addEventListener('focusin',stop,{signal:abort.signal});
 element.addEventListener('focusout',()=>queueMicrotask(resume),{signal:abort.signal});
 return {
  show(message,kind='error'){
   if(disposed)return;
   stop();remaining=duration;
   if(document.activeElement!==document.body&&document.activeElement!==document.documentElement&&!element.contains(document.activeElement))opener=document.activeElement;
   const success=kind==='success';element.dataset.kind=success?'success':'error';
   content.setAttribute('role',success?'status':'alert');
   title.textContent=success?'Success':'Error';text.textContent=String(message);
   queueMicrotask(()=>{if(disposed||!element.isConnected)return;if(!element.matches(':popover-open'))element.showPopover();resume();});
  },
  destroy(){if(disposed)return;disposed=true;stop();abort.abort();close.destroy();element.remove();}
 };
}
