// Pure categorical chart geometry; no DOM or runtime dependencies.
export const chartTypes = ['line', 'spline', 'area', 'candlestick', 'ohlc', 'column', 'stackedColumn', 'stackedColumn100', 'bar'];

export function normalizeChartSeries(series) {
  if (!Array.isArray(series)) throw new TypeError('Chart series must be an array.');
  const ids = new Set();
  return series.map(s => {
    const fields = s?.ohlc;
    if (fields != null && (!fields || !['open','high','low','close'].every(key => typeof fields[key] === 'string' && fields[key])))
      throw new TypeError('OHLC mapping requires open, high, low and close field names.');
    const valueField = s?.valueField ?? fields?.close;
    if (!s || typeof s.id !== 'string' || !s.id || ids.has(s.id) || typeof valueField !== 'string' || !valueField)
      throw new TypeError('Each Chart series needs a unique nonempty id and a valueField.');
    ids.add(s.id);
    return Object.freeze({ id: s.id, valueField, ...(fields ? {ohlc:Object.freeze({open:fields.open,high:fields.high,low:fields.low,close:fields.close})} : {}), label: String(s.label ?? s.id),
      color: s.color == null ? null : String(s.color), hidden: s.hidden === true });
  });
}

export function chartModel(items, series, type, includeZero) {
  const visible = series.filter(s => !s.hidden);
  const financial = type === 'candlestick' || type === 'ohlc';
  if (financial) {
    let min = Infinity, max = -Infinity;
    const rows = items.map(item => visible.map(s => {
      const fields = s.ohlc ?? {open:'open',high:'high',low:'low',close:s.valueField};
      const ohlc = Object.fromEntries(Object.entries(fields).map(([key,field]) => [key,item[field]]));
      const {open,high,low,close} = ohlc;
      if (!Object.values(ohlc).every(v=>typeof v==='number' && Number.isFinite(v)) || low>Math.min(open,close) || high<Math.max(open,close)) return null;
      min=Math.min(min,low);max=Math.max(max,high);
      return {series:s,raw:close,value:close,start:open,end:close,ohlc};
    }));
    [min,max] = chartDomain(min,max,includeZero===true);
    return {rows,series:visible,min,max,stacked:false,percent:false,financial:true};
  }
  const stacked = type === 'stackedColumn' || type === 'stackedColumn100';
  const percent = type === 'stackedColumn100';
  const zero = includeZero !== false || stacked || type === 'column' || type === 'bar';
  let min = zero ? 0 : Infinity, max = zero ? 0 : -Infinity;
  const rows = items.map(item => {
    const values = visible.map(s => typeof item[s.valueField] === 'number' && Number.isFinite(item[s.valueField]) ? item[s.valueField] : null);
    // Scale before summing to avoid overflow while normalizing large percentages.
    const magnitude = Math.max(0, ...values.map(v => Math.abs(v ?? 0)));
    const positive = values.reduce((n,v) => n + (v > 0 ? v / magnitude : 0), 0);
    const negative = values.reduce((n,v) => n + (v < 0 ? -v / magnitude : 0), 0);
    let up = 0, down = 0;
    return values.map((raw, index) => {
      if (raw == null) return null;
      const value = percent ? raw === 0 ? 0 : (raw / magnitude) / (raw > 0 ? positive : negative) * 100 : raw;
      const start = stacked ? value >= 0 ? up : down : 0;
      const end = start + value;
      if (!Number.isFinite(end)) throw new RangeError('Chart stacked values exceed the finite numeric range.');
      if (stacked) { if (value >= 0) up = end; else down = end; }
      min = Math.min(min, ...(zero ? [start,end] : [end])); max = Math.max(max, ...(zero ? [start,end] : [end]));
      return { series: visible[index], raw, value, start, end };
    });
  });
  [min,max] = chartDomain(min,max,zero);
  return { rows, series: visible, min, max, stacked, percent };
}

function chartDomain(min,max,zero) {
  if (min === Infinity) return [0,1];
  if (min === 0 && max === 0) return [0,1];
  if (zero) {min=Math.min(0,min);max=Math.max(0,max);}
  if(min===max) {
    const delta=Math.max(Math.abs(min)*.01,1e-6);
    return [Number.isFinite(min-delta)?min-delta:min,Number.isFinite(max+delta)?max+delta:max];
  }
  if(!zero) {
    const pad=(max/2-min/2)*.1;
    min=Number.isFinite(min-pad)?min-pad:min;max=Number.isFinite(max+pad)?max+pad:max;
  }
  return [min,max];
}

export function chartAreaPath(points, baseline) {
  let path='',segment=[];
  const flush=()=>{if(segment.length){path+=chartPath(segment,false)+`L${segment.at(-1).x},${baseline}L${segment[0].x},${baseline}Z`;segment=[];}};
  for(const point of points){if(point)segment.push(point);else flush();}flush();return path;
}

export function chartFraction(value, min, max) {
  const magnitude = Math.max(Math.abs(min), Math.abs(max), 1);
  return (value / magnitude - min / magnitude) / (max / magnitude - min / magnitude);
}

// Monotone cubic Hermite interpolation: never invent a peak between data points.
export function chartPath(points, smooth) {
  let path = '', segment = [];
  const flush = () => {
    if (!segment.length) return;
    path += `M${segment[0].x},${segment[0].y}`;
    const slopes = segment.slice(1).map((p,i) => (p.y - segment[i].y) / (p.x - segment[i].x));
    const tangents = segment.map((p,i) => {
      if (i === 0) return slopes[0] ?? 0;
      if (i === segment.length - 1) return slopes[i-1];
      const a = slopes[i-1], b = slopes[i];
      return a * b <= 0 ? 0 : 2 * a * b / (a + b);
    });
    for (let i = 1; i < segment.length; i++) {
      const a = segment[i-1], b = segment[i], dx = (b.x-a.x)/3;
      path += smooth ? `C${a.x+dx},${a.y+dx*tangents[i-1]} ${b.x-dx},${b.y-dx*tangents[i]} ${b.x},${b.y}` : `L${b.x},${b.y}`;
    }
    segment = [];
  };
  for (const p of points) { if (p) segment.push(p); else flush(); }
  flush();
  return path;
}

export {svgNode} from './svg.js';
