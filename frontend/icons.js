import { icons } from 'dense-ui';
const paths = {
  pen: 'M4 16L16 4l4 4L8 20l-5 1zM13 7l4 4',
  eraser: 'M3 14l9-10 9 8-8 9H9zM8 9l9 8M13 21h8',
  select: 'M5 3v17l5-5 4 7 3-2-4-7 6-1z',
  arrow: 'M5 19L19 5M9 5h10v10', dashed: 'M5 19l3-3M11 13l3-3M17 7l2-2',
  'area-select': 'M4 8V4h4M12 4h4M20 4v4M20 12v4M20 20h-4M12 20H8M4 20v-4M4 12v-1',
  square: 'M4 4h16v16H4z', circle: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', ellipse: 'M22 12a10 7 0 1 1-20 0 10 7 0 0 1 20 0',
  palette: 'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1.8 1.8 0 0 1 1.3-3.1H18a3 3 0 0 0 3-3C21 6.8 17 3 12 3z M7 9h.01M11 6.5h.01M16 8h.01M6 14h.01',
  line: 'M5 19L19 5', rectangle: 'M4 5h16v14H4z', text: 'M5 6V4h14v2M12 4v16M8 20h8',
  settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  previous: 'M15 5L8 12l7 7', next: 'M9 5l7 7-7 7',
  minus: 'M5 12h14', plus: 'M5 12h14M12 5v14',
  single: 'M6 3h12v18H6z', facing: 'M3 3h8v18H3zM13 3h8v18h-8z',
  continuous: 'M6 2h12v8H6zM6 14h12v8H6z',
  library: 'M3 3h18v18H3zM9 3v18', down: 'M5 9l7 7 7-7'
};
for (const [name, d] of Object.entries(paths)) icons.register(`reader.${name}`, {
  viewBox: '0 0 24 24', nodes: [['path', { d, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }]]
});
icons.register('reader.light', { viewBox: '0 0 24 24', nodes: [['circle', { cx: 12, cy: 12, r: 6, fill: 'currentColor' }]] });
