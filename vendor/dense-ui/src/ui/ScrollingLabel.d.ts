import { LabelText } from './display-contracts.js';
import type { LabelTextOptions } from './display-contracts.js';
export interface ScrollingLabelOptions extends LabelTextOptions {
 /** Pixels per second, default 35. */ speed?:number;
 /** Gap in pixels, default 48. */ gap?:number;
 /** Initial pause in milliseconds, default 1000. */ startDelay?:number;
 paused?:boolean;
}
export declare class ScrollingLabel extends LabelText {
 constructor(options?:ScrollingLabelOptions);
 constructor(container:HTMLElement|string,options?:ScrollingLabelOptions);
 readonly speed:number; readonly gap:number; readonly startDelay:number; readonly paused:boolean;
 setPaused(paused:boolean):this;
 setSpeed(speed:number):this;
 setGap(gap:number):this;
}
