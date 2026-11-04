import { BaseControl } from '../core/BaseControl.js';
import { DataStore } from '../core/DataStore.js';
import { chartTypes, normalizeChartSeries, chartModel, chartFraction, chartPath, chartAreaPath, svgNode } from './chartGeometry.js';

/** Experimental dependency-free categorical chart. Rendering is invalidation-driven. */
export class Chart extends BaseControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const mounted = typeof containerOrOptions === 'string' || (typeof HTMLElement !== 'undefined' && containerOrOptions instanceof HTMLElement);
    const options = mounted ? maybeOptions ?? {} : containerOrOptions;
    super({ ...options, height: options.height ?? 320 });
    this.type = validateType(options.type ?? 'line');
    this.markers = options.markers === true;
    this.wickCaps = options.wickCaps === true;
    this.includeZero = options.includeZero;
    this.label = String(options.label ?? 'Chart');
    this.categoryField = options.categoryField ?? 'label';
    this.legend = options.legend !== false;
    this._series = normalizeChartSeries(options.series ?? []);
    this._ownsData = !options.data;
    this.data = options.data ?? new DataStore({ idField: options.idField, getId: options.getId });
    this._frame = null;
    this._marks = [];
    this.disposables.add(this.data.events.on('invalidate', () => this._requestRender()));
    this._bindOptionEvent('itemClick', options.onItemClick);
    this._bindOptionEvent('seriesVisibilityChange', options.onSeriesVisibilityChange);
    if (mounted) this.mount(containerOrOptions);
  }

  createElement() {
    const root = document.createElement('div');
    root.className = ['dui-control', 'dui-chart', this.options.css].filter(Boolean).join(' ');
    root.dataset.duiControlId = this.id;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', this.label);
    this._legend = document.createElement('div');
    this._legend.className = 'dui-chart__legend';
    this._plot = document.createElement('div');
    this._plot.className = 'dui-chart__plot';
    this._svg = svgNode('svg', { role: 'group', 'aria-label': this.label });
    this._plot.append(this._svg);
    root.append(this._legend, this._plot);
    this.disposables.addEventListener(this._legend, 'click', event => {
      const button = event.target.closest('button');
      if (button && !this.disabled) {
        button.focus({ preventScroll: true });
        if (!this.destroyed) this.setSeriesVisible(button.dataset.series, button.getAttribute('aria-pressed') !== 'true', { origin: 'user', userAction: true });
      }
    });
    this.disposables.addEventListener(this._svg, 'click', event => this._activate(event.target.closest('[data-point]')));
    this.disposables.addEventListener(this._svg, 'keydown', event => {
      const target = event.target.closest('[data-point]');
      if (!target || this.disabled) return;
      let index = Number(target.dataset.point);
      if (['ArrowRight', 'ArrowDown'].includes(event.key)) index++;
      else if (['ArrowLeft', 'ArrowUp'].includes(event.key)) index--;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = this._marks.length-1;
      else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); this._activate(target); return; }
      else return;
      event.preventDefault();
      index = (index + this._marks.length) % this._marks.length;
      target.setAttribute('tabindex', '-1');
      const next = this._svg.querySelector(`[data-point="${index}"]`);
      next?.setAttribute('tabindex', '0'); next?.focus();
    });
    const observer = new ResizeObserver(() => this._requestRender());
    observer.observe(this._plot);
    this.disposables.add(() => observer.disconnect());
    return root;
  }

  mount(container) { super.mount(container); if (!this.destroyed) this._render(); return this; }
  refresh() { super.refresh(); this._render(); return this; }
  getSeries() { return this._series.map(s => ({ ...s, ...(s.ohlc ? {ohlc:{...s.ohlc}} : {}) })); }
  setSeries(series) { this._assertMutable('setSeries'); this._series = normalizeChartSeries(series); this._requestRender(); return this; }
  setType(type) { this._assertMutable('setType'); this.type = validateType(type); this._requestRender(); return this; }
  setMarkers(markers) { this._assertMutable('setMarkers'); this.markers = markers === true; this._requestRender(); return this; }
  setWickCaps(caps) { this._assertMutable('setWickCaps'); this.wickCaps = caps === true; this._requestRender(); return this; }
  setSeriesVisible(id, visible, options = {}) {
    this._assertMutable('setSeriesVisible');
    const series = this._series.find(s => s.id === id);
    if (!series) throw new Error(`Unknown Chart series: ${id}`);
    const hidden = !visible;
    if (series.hidden === hidden) return false;
    this._series = this._series.map(s => s.id === id ? Object.freeze({ ...s, hidden }) : s);
    this._requestRender();
    if (!options.silent) this.events.emit('seriesVisibilityChange', { source: this, seriesId: id, visible: !hidden,
      origin: options.origin ?? 'api', userAction: options.userAction === true });
    return true;
  }

  _requestRender() {
    if (this.destroyed || !this.mounted || this._frame != null) return;
    this._frame = requestAnimationFrame(() => { this._frame = null; if (!this.destroyed) this._render(); });
  }
  _color(series) {
    return series.color ?? `var(--dui-chart-series-${this._series.findIndex(s => s.id === series.id) % 6 + 1})`;
  }
  _activate(element) {
    if (!element || this.disabled || this.destroyed) return;
    const point = this._marks[Number(element.dataset.point)];
    if (point) this.events.emit('itemClick', { source: this, ...point, origin: 'user', userAction: true });
  }
  _applyDisabledState() {
    super._applyDisabledState();
    this._requestRender();
  }

  _render() {
    if (!this._svg || this.destroyed) return;
    let items = this.data.all(), model, problem = '';
    try { model = chartModel(items, this._series, this.type, this.includeZero); }
    catch (error) {
      if (!(error instanceof RangeError)) throw error;
      problem = 'Values exceed the supported numeric range';
      items = []; model = chartModel(items, this._series, this.type, this.includeZero);
    }
    const oldFocus = document.activeElement;
    const focusPoint = this._svg.contains(oldFocus) ? this._marks[Number(oldFocus.dataset.point)] : null;
    const focusSeries = this._legend.contains(oldFocus) ? oldFocus.dataset.series : null;
    this._legend.replaceChildren(); this._legend.hidden = !this.legend;
    for (const series of this._series) {
      const button = document.createElement('button'); button.type = 'button';
      button.dataset.series = series.id; button.textContent = series.label;
      button.setAttribute('aria-pressed', String(!series.hidden)); button.disabled = this.disabled;
      button.style.setProperty('--dui-chart-color', this._color(series));
      this._legend.append(button);
      if (series.id === focusSeries) button.focus({ preventScroll: true });
    }
    const width = Math.max(240, this._plot.clientWidth || 640), height = Math.max(140, this._plot.clientHeight || 260);
    const horizontal = this.type === 'bar', line = ['line','spline','area'].includes(this.type);
    const left = horizontal ? 100 : 64, right = width-20, top = 16, bottom = height-40;
    const w = right-left, h = bottom-top;
    const scale = v => horizontal ? left + chartFraction(v,model.min,model.max)*w : bottom-chartFraction(v,model.min,model.max)*h;
    const slot = (horizontal ? h : w) / Math.max(1,items.length);
    const category = i => horizontal ? top + slot*(i+.5) : left + slot*(i+.5);
    this._svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this._svg.replaceChildren(svgNode('title', {}, this.label)); this._marks = [];
    const axes = svgNode('g', { 'aria-hidden': 'true', class: 'dui-chart__axes' }); this._svg.append(axes);
    for (let i=0;i<=4;i++) {
      const t = i/4, value = model.min*(1-t)+model.max*t, position = scale(value);
      axes.append(svgNode('line', horizontal ? { x1:position,x2:position,y1:top,y2:bottom } : { x1:left,x2:right,y1:position,y2:position }));
      const digits=Math.min(12,Math.max(0,Math.ceil(-Math.log10(model.max/4-model.min/4))+1));
      const tick=Number(value.toFixed(digits)).toString();
      axes.append(svgNode('text', { x:horizontal?position:left-8,y:horizontal?bottom+20:position+4,'text-anchor':horizontal?'middle':'end' }, tick+(model.percent?'%':'')));
    }
    // Thin labels rather than overlapping all categories; all values remain in point tooltips.
    const labelWidth = items.reduce((size,item,i)=>Math.max(size,Math.min(12,String(item[this.categoryField] ?? this.data.idOf(item,i)).length)*7+16),32);
    const stride = Math.max(1,Math.ceil(items.length / Math.max(1,Math.floor((horizontal?h:w)/(horizontal?26:labelWidth)))));
    items.forEach((item,i) => {
      if (i % stride !== 0) return;
      const label = String(item[this.categoryField] ?? this.data.idOf(item,i));
      const text = svgNode('text', { x:horizontal?left-8:category(i),y:horizontal?category(i)+4:bottom+20,'text-anchor':horizontal?'end':'middle' }, label.length>12?`${label.slice(0,11)}…`:label);
      text.append(svgNode('title', {}, label)); axes.append(text);
    });
    const zero = scale(Math.max(model.min,Math.min(model.max,0)));
    axes.append(svgNode('line', { class:'dui-chart__zero', ...(horizontal?{x1:zero,x2:zero,y1:top,y2:bottom}:{x1:left,x2:right,y1:zero,y2:zero}) }));
    model.series.forEach((series, si) => {
      const color = this._color(series), points = [];
      items.forEach((item, i) => {
        const datum = model.rows[i][si];
        if (!datum) { points.push(null); return; }
        const x = category(i), y = scale(datum.end);
        points.push({x,y});
        let mark;
        if (model.financial) {
          const {open,high,low,close} = datum.ohlc;
          const thickness = Math.min(26,slot*.7/model.series.length);
          const cx = x + (si-(model.series.length-1)/2)*thickness;
          const yo=scale(open), yc=scale(close), yh=scale(high), yl=scale(low), half=thickness*.4;
          mark = svgNode('g',{class:'dui-chart__financial','data-direction':close>open?'up':close<open?'down':'flat'});
          mark.append(svgNode('line',{x1:cx,x2:cx,y1:yh,y2:yl,class:'dui-chart__wick'}));
          if(this.type==='ohlc') {
            mark.append(svgNode('path',{d:`M${cx-half},${yo}H${cx}M${cx},${yc}H${cx+half}`,class:'dui-chart__ohlc-ticks'}));
          } else {
            if(open===close)mark.append(svgNode('line',{x1:cx-half,x2:cx+half,y1:yo,y2:yo,class:'dui-chart__doji'}));
            else mark.append(svgNode('rect',{x:cx-half,y:Math.min(yo,yc),width:half*2,height:Math.abs(yo-yc),class:'dui-chart__candle-body'}));
            if(this.wickCaps)mark.append(svgNode('path',{d:`M${cx-half},${yh}H${cx+half}M${cx-half},${yl}H${cx+half}`,class:'dui-chart__wick-caps'}));
          }
          mark.append(svgNode('rect',{x:cx-thickness/2,y:Math.min(yh,yl)-3,width:thickness,height:Math.max(6,Math.abs(yl-yh)+6),class:'dui-chart__financial-hit'}));
        } else if (line) {
          mark = svgNode('circle', { cx:x,cy:y,r:this.markers?4:6, class:`dui-chart__point${this.markers?'':' dui-chart__point--hit'}` });
        } else {
          const count = model.stacked ? 1 : model.series.length, thickness = slot*.76/count;
          const offset = -slot*.38 + (model.stacked?0:si*thickness);
          const a = scale(datum.start), b = scale(datum.end);
          mark = svgNode('rect', horizontal ? {x:Math.min(a,b),y:x+offset,width:Math.abs(b-a),height:thickness} : {x:x+offset,y:Math.min(a,b),width:thickness,height:Math.abs(b-a)});
        }
        mark.style.setProperty('--dui-chart-color',color);
        mark.classList.add('dui-chart__mark');
        const categoryLabel = String(item[this.categoryField] ?? this.data.idOf(item,i));
        const description = `${series.label}, ${categoryLabel}: ${datum.ohlc ? `Open ${datum.ohlc.open}, High ${datum.ohlc.high}, Low ${datum.ohlc.low}, Close ${datum.ohlc.close}` : `${datum.raw}${model.percent?` (${numberText(datum.value)}%)`:''}`}`;
        const point = { item, id:this.data.idOf(item,i), seriesId:series.id, value:datum.raw, category:categoryLabel, ...(datum.ohlc?{ohlc:{...datum.ohlc}}:{}) };
        const index = this._marks.push(point)-1;
        mark.setAttribute('data-point',String(index)); mark.setAttribute('role','button');
        mark.setAttribute('tabindex', !this.disabled && index===0 ? '0':'-1');
        mark.setAttribute('aria-label',description); mark.setAttribute('aria-disabled',String(this.disabled));
        mark.append(svgNode('title',{},description)); this._svg.append(mark);
      });
      if (line) {
        const path = svgNode('path',{d:chartPath(points,this.type==='spline'),class:'dui-chart__line','aria-hidden':'true'});
        path.style.stroke=color; this._svg.insertBefore(path,this._svg.children[2] ?? null);
        if(this.type==='area') {
          const area=svgNode('path',{d:chartAreaPath(points,zero),class:'dui-chart__area','aria-hidden':'true'});
          area.style.fill=color;this._svg.insertBefore(area,path);
        }
      }
    });
    if (!this._marks.length) this._svg.append(svgNode('text',{x:width/2,y:height/2,'text-anchor':'middle',class:'dui-chart__empty'},problem || 'No data'));
    if (focusPoint && !this.disabled) {
      const index = this._marks.findIndex(p=>p.id===focusPoint.id && p.seriesId===focusPoint.seriesId);
      const target = this._svg.querySelector(`[data-point="${Math.max(0,index)}"]`);
      this._svg.querySelector('[tabindex="0"]')?.setAttribute('tabindex','-1');
      target?.setAttribute('tabindex','0'); target?.focus({preventScroll:true});
    }
  }
  destroy() {
    if (this.destroyed || this._destroying) return;
    if (this._frame != null) cancelAnimationFrame(this._frame);
    this._frame = null;
    super.destroy();
    if (this._ownsData) this.data.destroy();
    this._svg = this._plot = this._legend = null; this._marks = [];
  }
}
function validateType(type) { if (!chartTypes.includes(type)) throw new TypeError(`Unknown Chart type: ${type}`); return type; }
function numberText(value) { return Number(value.toPrecision(4)).toString(); }
