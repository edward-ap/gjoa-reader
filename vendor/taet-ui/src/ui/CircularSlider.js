import { TrackBar } from './TrackBar.js';

/** Experimental circular range editor. Clockwise from six o'clock, without wrapping. */
export class CircularSlider extends TrackBar {
  constructor(containerOrOptions = {}, maybeOptions) {
    const mounted = typeof containerOrOptions === 'string' ||
      (typeof HTMLElement !== 'undefined' && containerOrOptions instanceof HTMLElement);
    const options = mounted ? maybeOptions ?? {} : containerOrOptions;
    super({...options, orientation:'horizontal', invert:false, invertLayout:false,
      scale:'none', showValue:true});
    if (mounted) this.mount(containerOrOptions);
  }

  createElement() {
    const root = super.createElement();
    root.classList.add('dui-circular-slider');
    const dial = root.querySelector('.dui-trackbar__content');
    dial.classList.add('dui-circular-slider__dial');
    this._input.setAttribute('aria-label', this.label || this.name || 'Value');
    this._valueElement.setAttribute('aria-hidden', 'true');
    this._syncInput(this._value);
    let pointer = null, previous = 0, position = 0;
    const fraction = event => {
      const box = dial.getBoundingClientRect();
      const x = event.clientX - box.left - box.width / 2;
      const y = event.clientY - box.top - box.height / 2;
      if (Math.hypot(x,y) < box.width * .12) return null;
      return ((Math.atan2(y,x) - Math.PI / 2 + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2);
    };
    const apply = () => this._setValue(this.min + position * (this.max-this.min), {origin:'user',userAction:true});
    this.disposables.addEventListener(dial, 'pointerdown', event => {
      if (event.button !== 0 || pointer !== null || this.disabled || this.isReadOnly()) return;
      const next = fraction(event); if (next === null) return;
      event.preventDefault(); this._input.focus();
      pointer = event.pointerId; previous = next;
      position = next < .015 && this._getValuePercent(this._value) > 50 ? 1 : next;
      dial.setPointerCapture(pointer); apply();
    });
    this.disposables.addEventListener(dial, 'pointermove', event => {
      if (pointer !== event.pointerId || this.disabled || this.isReadOnly()) return;
      const next = fraction(event); if (next === null) return;
      let delta = next - previous;
      if (delta > .5) delta -= 1;
      if (delta < -.5) delta += 1;
      previous = next;
      position = Math.max(0, Math.min(1, position + delta)); apply();
    });
    const end = event => {
      if (event.pointerId !== pointer) return;
      if (dial.hasPointerCapture(pointer)) dial.releasePointerCapture(pointer);
      pointer = null;
    };
    for (const type of ['pointerup','pointercancel','lostpointercapture']) this.disposables.addEventListener(dial,type,end);
    this.disposables.add(() => { if (pointer !== null && dial.hasPointerCapture(pointer)) dial.releasePointerCapture(pointer); });
    return root;
  }

  _renderValue() {
    if (!this._valueElement) return;
    const percent = this._getValuePercent(this._value);
    const text = this.valueFormatter ? this._formatValue(this._value) : `${Math.round(percent)}%`;
    this._valueElement.textContent = text;
    this._input?.setAttribute('aria-valuetext', text);
    this._valueElement.parentElement.style.setProperty('--dui-circular-percent', `${percent}%`);
  }
}
