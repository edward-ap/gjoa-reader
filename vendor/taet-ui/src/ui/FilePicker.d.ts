import { EditorControl } from './EditorControl.js';
import type { EditorControlOptions, EditorValueApi } from './EditorControl.js';
import type { ControlEvent, MutationOptions, VisibilityOptions } from '../core/index.js';
export interface FileMetadata {
  name: string;
  size: number | null;
  type: string;
  lastModified: number | null;
  relativePath: string;
}
export interface FileMetadataInput extends Partial<FileMetadata> { path?: string; webkitRelativePath?: string }
export type FilePickerValue<M extends boolean = false> = M extends true ? FileMetadata[] : FileMetadata | null;
export type FilePickerWriteValue<M extends boolean = false> = M extends true
  ? readonly (FileMetadataInput | File | string | null | undefined)[] | null | undefined
  : FileMetadataInput | File | string | null | undefined;
export interface FilePickerValueApi<M extends boolean = false> extends EditorValueApi<FilePickerValue<M>> {
  set(value: FilePickerWriteValue<M>, options?: MutationOptions): boolean;
}
export interface FilePickerEvents<M extends boolean = false, C extends object = object> {
  beforeOpen: ControlEvent<FilePicker<M, C>>;
}
export interface FilePickerOptions<M extends boolean = false, C extends object = object>
  extends Omit<EditorControlOptions<FilePickerValue<M>, C, FilePicker<M, C>>, 'value' | 'emptyValue'> {
  multiple?: M;
  value?: FilePickerWriteValue<M>;
  emptyValue?: FilePickerWriteValue<M>;
  accept?: string;
  directory?: boolean;
  webkitdirectory?: boolean;
  buttonText?: string;
  clearable?: boolean;
  placeholder?: string;
  displayMode?: 'name' | 'count';
}
/** Experimental: metadata values are separate from browser-selected File handles. */
export declare class FilePicker<M extends boolean = false, C extends object = object>
  extends EditorControl<FilePickerValue<M>, C, FilePickerEvents<M, C>> {
  constructor(...args: true extends M ? [options: FilePickerOptions<M, C> & { multiple: M }] : [options?: FilePickerOptions<M, C>]);
  constructor(...args: true extends M ? [container: HTMLElement | string, options: FilePickerOptions<M, C> & { multiple: M }] :
    [container: HTMLElement | string, options?: FilePickerOptions<M, C>]);
  readonly value: Readonly<FilePickerValueApi<M>>;
  readonly multiple: M;
  accept: string;
  directory: boolean;
  buttonText: string;
  clearable: boolean;
  placeholder: string;
  displayMode: 'name' | 'count';
  openPicker(options?: VisibilityOptions): boolean;
  clearFiles(options?: MutationOptions): boolean;
  getFiles(): File[];
  protected _setValue(value: FilePickerWriteValue<M>, options?: MutationOptions): boolean;
}
