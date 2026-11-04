import { ChannelColorPicker, cmykToRgb, rgbToCmyk } from './channelColorPicker.js';
export class CMYKColorPicker extends ChannelColorPicker {
 _channelMax() { return 100; }
 _channelDefinitions() { return [['C','Cyan','#00b6c8'],['M','Magenta','#d830c8'],['Y','Yellow','#d5b800'],['K','Black','var(--dui-color-text)']]; }
 getCmyk() { return rgbToCmyk(this.getRgb()); }
 setCmyk(cyan,magenta,yellow,black,options={}) {
  const {red,green,blue}=cmykToRgb(cyan,magenta,yellow,black);return this.setRgb(red,green,blue,options);
 }
}
