import { ColorPicker, normalizeHexColor } from './ColorPicker.js';
import { TrackBar } from './TrackBar.js';
import { Button } from './Button.js';
import { localize } from './localize.js';

const percent = value => Math.min(100, Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0));
export function cmykToRgb(cyan, magenta, yellow, black) {
  const k = percent(black)/100;
  const values = [cyan,magenta,yellow].map(value=>Math.round(255*(1-percent(value)/100)*(1-k)));
  return {red:values[0],green:values[1],blue:values[2]};
}
export function rgbToCmyk({red,green,blue}) {
  const maximum = Math.max(red,green,blue);
  if (!maximum) return {cyan:0,magenta:0,yellow:0,black:100};
  return {cyan:(1-red/maximum)*100,magenta:(1-green/maximum)*100,yellow:(1-blue/maximum)*100,black:(1-maximum/255)*100};
}

/** Internal shared presentation. Public values remain canonical RGB hex strings. */
export class ChannelColorPicker extends ColorPicker {
  _createPopupContent() {
    const content = document.createElement('div');
    content.className = 'dui-color-picker__panel dui-channel-color__panel';
    const sample = document.createElement('div'); sample.className='dui-channel-color__sample';
    const preview = document.createElement('div'); preview.className='dui-channel-color__preview';
    preview.setAttribute('aria-label', localize(this.options,'Color preview')); preview.setAttribute('role','img');
    const hex = document.createElement('input'); hex.type='text'; hex.spellcheck=false;
    hex.setAttribute('aria-label',localize(this.options,'Hex color')); hex.className='dui-channel-color__hex';
    sample.append(preview,hex); content.append(sample);
    this._preview=preview; this._hexInput=hex; this._channelControls=[];
    const channels=document.createElement('div'); channels.className='dui-channel-color__channels';content.append(channels);
    for (const [letter,label,color] of this._channelDefinitions()) {
      const host=document.createElement('div'); host.className='dui-channel-color__channel';
      host.style.setProperty('--dui-channel-color',color);channels.append(host);
      const slider=new TrackBar({label:localize(this.options,label),min:0,max:this._channelMax(),step:1,orientation:'vertical',showValue:true,valuePosition:'top',scale:'none'});
      const caption=new Button({text:letter,css:'dui-channel-color__letter',onClick:()=>slider.focus()}); caption.mount(host);
      caption.element.setAttribute('aria-label',localize(this.options,`${label} channel`)); slider.mount(host);
      this._channelControls.push({slider,caption});
      this.disposables.add(slider.events.on('change',()=>{
        if (this.destroyed || this.disabled || this.isReadOnly()) return;
        const values=this._channelControls.map(item=>item.slider.value.get());
        const rgb=this._channelMax()===255 ? {red:values[0],green:values[1],blue:values[2]} : cmykToRgb(...values);
        this._draftColor=normalizeHexColor(`rgb(${rgb.red},${rgb.green},${rgb.blue})`);
        this._hexInput.value=this._draftColor;this._hexInput.removeAttribute('aria-invalid');this._renderDraft();
      }));
    }
    const hint=document.createElement('div');hint.className='dui-channel-color__hint';
    hint.textContent=localize(this.options,'Enter to select · Esc to cancel');content.append(hint);
    this.disposables.addEventListener(hex,'input',()=>{
      try { this._draftColor=normalizeHexColor(hex.value);hex.removeAttribute('aria-invalid');this._syncChannels();this._renderDraft(); }
      catch { hex.setAttribute('aria-invalid','true'); }
    });
    if(this.allowEmpty) {
      const clear=new Button({text:localize(this.options,'Clear'),onClick:()=>{this._draftColor='';this._hexInput.value='';this._hexInput.removeAttribute('aria-invalid');this._syncChannels();this._renderDraft();}});
      clear.mount(sample);this._clearDraft=clear;
    }
    this._syncPopup(); return content;
  }
  _syncPopup() {
    if(!this._channelControls) return;
    this._draftColor=this._value || '';this._hexInput.value=this._draftColor;
    this._hexInput.removeAttribute('aria-invalid');this._syncChannels();this._renderDraft();
  }
  _syncChannels() {
    const hex=this._draftColor || '#000000';
    const rgb={red:parseInt(hex.slice(1,3),16),green:parseInt(hex.slice(3,5),16),blue:parseInt(hex.slice(5,7),16)};
    const values=this._channelMax()===255 ? Object.values(rgb) : Object.values(rgbToCmyk(rgb));
    this._channelControls.forEach(({slider},i)=>slider.value.set(Math.round(values[i]),{silent:true}));
  }
  _renderDraft() {
    this._preview.style.backgroundColor=this._draftColor || '';
    this._preview.classList.toggle('dui-color-picker__preview--empty',!this._draftColor);
  }
  destroy() {
    for(const {slider,caption} of this._channelControls ?? []) {slider.destroy();caption.destroy();}
    this._channelControls=null;this._clearDraft?.destroy();this._clearDraft=null;super.destroy();
  }
}
