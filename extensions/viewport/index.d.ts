// SPDX-License-Identifier: MIT
// Derived from Dense UI; copyright (c) 2026 Edward Aponasko.
// See LICENSE and provenance.json beside this local extension.
import { BaseControl } from 'dense-ui/foundation';
import type { BaseControlOptions, ControlEvent, EventHandler, MutationOptions } from 'dense-ui/foundation';

export interface Point { x: number; y: number }
export interface RasterSize { width: number; height: number }
export type ViewportFitMode = 'fit' | 'fit-width' | 'fit-height' | 'actual' | 'manual';
export type RasterStatus = 'empty' | 'rendering' | 'ready' | 'error';
export interface ViewportState {
  zoom: number; pan: Point; fitMode: ViewportFitMode; contentSize: RasterSize;
  viewportSize: RasterSize; devicePixelRatio: number; renderStatus: RasterStatus; hasRaster: boolean;
}
export interface RasterRequest extends Readonly<Required<Pick<MutationOptions, 'origin' | 'userAction'>>> {
  readonly contentWidth: number; readonly contentHeight: number;
  readonly viewportWidth: number; readonly viewportHeight: number;
  readonly targetWidth: number; readonly targetHeight: number;
  readonly zoom: number; readonly devicePixelRatio: number;
  readonly signal: AbortSignal; readonly requestId: number; readonly reason: string;
}
export type RasterImage = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | ImageData;
/** owned transfers an ImageBitmap to the viewport; other image sources stay borrowed. */
export interface RasterResult { image: RasterImage; owned?: boolean }
export type RasterRenderer = (request: RasterRequest) => RasterResult | Promise<RasterResult>;
export interface ViewportEvent extends ControlEvent<RenderViewport> { silent: false }
export interface ViewportChange extends ViewportEvent { oldValue: ViewportState; newValue: ViewportState; reason: string }
export interface ContentSizeChange extends ViewportEvent { oldValue: RasterSize; newValue: RasterSize }
export interface RenderViewportEvents {
  beforeViewportChange: ViewportChange & { cancel: boolean }; viewportChange: ViewportChange; afterViewportChange: ViewportChange;
  beforeContentChange: ContentSizeChange & { cancel: boolean }; contentChange: ContentSizeChange; afterContentChange: ContentSizeChange;
  renderStart: ViewportEvent & { request: RasterRequest };
  renderComplete: ViewportEvent & { request: RasterRequest; rasterWidth: number; rasterHeight: number };
  renderError: ViewportEvent & { request: RasterRequest; error: unknown; hasRaster: boolean };
}
export interface RenderViewportOptions extends BaseControlOptions<RenderViewport> {
  renderer?: RasterRenderer | null; contentWidth?: number; contentHeight?: number;
  fitMode?: ViewportFitMode; zoom?: number; minZoom?: number; maxZoom?: number;
  renderDelay?: number; maxRasterPixels?: number; maxRasterDimension?: number;
  wheelZoom?: 'ctrl' | 'always' | 'none'; panEnabled?: boolean; ariaLabel?: string; css?: string; className?: string;
  onBeforeViewportChange?: EventHandler<RenderViewportEvents['beforeViewportChange']>;
  onViewportChange?: EventHandler<ViewportChange>; onAfterViewportChange?: EventHandler<ViewportChange>;
  onBeforeContentChange?: EventHandler<RenderViewportEvents['beforeContentChange']>;
  onContentChange?: EventHandler<ContentSizeChange>; onAfterContentChange?: EventHandler<ContentSizeChange>;
  onRenderStart?: EventHandler<RenderViewportEvents['renderStart']>;
  onRenderComplete?: EventHandler<RenderViewportEvents['renderComplete']>;
  onRenderError?: EventHandler<RenderViewportEvents['renderError']>;
}
export declare class RenderViewport extends BaseControl<RenderViewportEvents, HTMLElement> {
  constructor(options?: RenderViewportOptions);
  constructor(container: HTMLElement | string, options?: RenderViewportOptions);
  readonly zoom: number; readonly pan: Point; readonly fitMode: ViewportFitMode;
  readonly contentSize: RasterSize; readonly viewportSize: RasterSize; readonly devicePixelRatio: number;
  readonly renderStatus: RasterStatus; readonly lastError: unknown; readonly hasRaster: boolean;
  getViewportState(): ViewportState;
  setRenderer(renderer: RasterRenderer | null, options?: MutationOptions): boolean;
  setContentSize(width: number, height: number, options?: MutationOptions): boolean;
  setZoom(zoom: number, options?: MutationOptions & { anchor?: Point }): boolean;
  zoomBy(factor: number, options?: MutationOptions & { anchor?: Point }): boolean;
  fit(mode?: Exclude<ViewportFitMode, 'manual'>, options?: MutationOptions): boolean;
  panTo(x: number, y: number, options?: MutationOptions): boolean;
  panBy(x: number, y: number, options?: MutationOptions): boolean;
  center(options?: MutationOptions): boolean;
  viewportToContent(x: number, y: number): Point; contentToViewport(x: number, y: number): Point;
  refresh(options?: MutationOptions & { reason?: string }): Promise<boolean>;
}

