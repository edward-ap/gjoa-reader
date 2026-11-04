import { ProgressBar } from './ProgressBar.js';
import { svgNode } from './chartGeometry.js';

/** A read-only semicircular range display using the standard editor value API. */
export class Gauge extends ProgressBar {
  constructor(containerOrOptions = {}, maybeOptions) {
    const mounted = typeof containerOrOptions === 'string' || (typeof HTMLElement !== 'undefined' && containerOrOptions instanceof HTMLElement);
    const options = mounted ? maybeOptions ?? {} : containerOrOptions;
    super({ ...options, orientation:'horizontal', labelPosition:options.labelPosition ?? 'top' });
    if (mounted) this.mount(containerOrOptions);
  }
  createElement() {
    const root = super.createElement();
    if (this.destroyed) return root;
    root.classList.add('dui-gauge');
    const svg = svgNode('svg',{viewBox:'0 0 240 150','aria-hidden':'true'});
    const arc = 'M20 120 A100 100 0 0 1 220 120';
    svg.append(svgNode('path',{d:arc,class:'dui-gauge__track'}));
    this._arc = svgNode('path',{d:arc,pathLength:100,class:'dui-gauge__fill'});
    this._needle = svgNode('line',{x1:120,y1:120,x2:40,y2:120,class:'dui-gauge__needle'});
    this._minText = svgNode('text',{x:20,y:145,'text-anchor':'middle'});
    this._maxText = svgNode('text',{x:220,y:145,'text-anchor':'middle'});
    svg.append(this._arc,this._needle,svgNode('circle',{cx:120,cy:120,r:4,class:'dui-gauge__hub'}),this._minText,this._maxText);
    this._fillElement.remove(); this._fillTextElement.remove();
    this._trackElement.prepend(svg);
    this._trackElement.setAttribute('role','meter');
    this._syncInput(this._value); this._renderLabel();
    return root;
  }
  _syncInput(value) {
    super._syncInput(value);
    if (this.destroyed || !this._arc) return;
    const percent = this._getPercent(value);
    this._arc.setAttribute('stroke-dasharray',`${percent} 100`);
    this._needle.setAttribute('transform',`rotate(${percent*1.8} 120 120)`);
    this._minText.textContent=String(this.min); this._maxText.textContent=String(this.max);
  }
  _renderLabel() {
    super._renderLabel();
    this._trackElement?.setAttribute('aria-label',this.label || this.name || 'Gauge');
  }
  setRange(min,max,options={}) {
    const changed = super.setRange(min,max,options);
    if (!this.destroyed) this._syncInput(this._value);
    return changed;
  }
  destroy() { super.destroy(); this._arc=this._needle=this._minText=this._maxText=null; }
}
