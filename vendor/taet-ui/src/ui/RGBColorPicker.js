import { ChannelColorPicker } from './channelColorPicker.js';
export class RGBColorPicker extends ChannelColorPicker {
 _channelMax() { return 255; }
 _channelDefinitions() { return [['R','Red','#ed3434'],['G','Green','#159447'],['B','Blue','#4269f5']]; }
}
