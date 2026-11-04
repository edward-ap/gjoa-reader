import type {ThemeColors} from './ThemeApplicator.js';
import {BaseControl} from '../core/index.js';
import type {BaseControlOptions,ControlEvent} from '../core/index.js';
export interface ThemeDefinition {
 version?: 1 | 2; preset?: 'clear'; foundation?: 'light' | 'dark';
 accentForeground?: 'auto' | 'light' | 'dark'; lockBase?: boolean;
 harmony?: {type:string;baseHue:number;spread:number;harmonyStrength:number;lockGeometry:boolean;spokeOffsets?:number[]};
 baseTone?: {space:'oklch';L:number;C:number};
 surfaceTint?:number;borderContrast?:number;stateIntensity?:number;
 [key:string]:unknown;
}
export interface ThemePreset {name:string;definition:ThemeDefinition;id?:string;readOnly?:boolean}
export interface GeneratedTheme extends ThemeColors {definition:ThemeDefinition;tokens:Record<string,string>;[key:string]:unknown}
export interface ThemeDesignerHost {
 getPresetDirectory?(request:{signal:AbortSignal}):unknown|Promise<unknown>;
 openPresetExplorer?(request:{directory:unknown;purpose:'open'|'copy';signal:AbortSignal}):ThemePreset|null|Promise<ThemePreset|null>;
 applyPreset?(request:{preset:ThemePreset;theme:GeneratedTheme;signal:AbortSignal}):void|Promise<void>;
}
export interface ThemeDesignerChange extends ControlEvent<ThemeDesigner> {preset:ThemePreset;theme:GeneratedTheme}
export interface ThemeDesignerOptions extends BaseControlOptions {
 preset?:ThemePreset;host?:ThemeDesignerHost;
 /** Include the demonstration preview (default false). Compact mode sizes to content. */
 preview?:boolean;
 /** Hide preset collection commands when the host owns a single draft. Default true. */
 toolbar?:boolean;
 /** Maximum active anchors; larger presets are adapted to this limit. Default 4. */
 maxColors?:1|2|3|4;
 /** Notification timeout in milliseconds (default 5000); 0 keeps it until dismissed. */
 notificationDuration?:number;
 /** Opt-in persistence. Omit for instance-local in-memory presets. */
 storage?:Pick<Storage,'getItem'|'setItem'>;
 onChange?:(event:ThemeDesignerChange)=>void;
}
/** Experimental. Include taet-ui/taet-ui.css. No iframe, network, native bridge or global theme mutation. */
export declare class ThemeDesigner extends BaseControl<{change:ThemeDesignerChange}> {
 constructor(options?:ThemeDesignerOptions);
 constructor(container:HTMLElement|string,options?:ThemeDesignerOptions);
 getPreset():ThemePreset;getPresets():ThemePreset[];getTheme():GeneratedTheme;
 setPreset(preset:ThemePreset):this;
 connectHost(host:ThemeDesignerHost|null):()=>void;
}
