import { BaseControl } from '../core/BaseControl.js';
import type { BaseControlOptions, ControlEvent, VisibilityOptions } from '../core/BaseControl.js';
export interface FileUploadEntry {
 id: string; name: string; size: number; type: string; lastModified: number; relativePath: string;
 status: 'queued' | 'uploading' | 'uploaded' | 'error' | 'canceled'; progress: number; error: string | null; result: unknown;
}
export interface FileUploadContext { signal: AbortSignal; entry: FileUploadEntry; onProgress(fraction: number): void }
export interface FileUploadOptions extends BaseControlOptions {
 translate?: (text: string, params: Record<string, unknown>) => string;
 accept?: string; maxFiles?: number; maxFileSize?: number; maxTotalSize?: number;
 allowDuplicates?: boolean; autoUpload?: boolean; concurrency?: number; label?: string; dropText?: string;
 upload?: (file: File, context: FileUploadContext) => unknown | Promise<unknown>;
}
export interface FileUploadRejection { file: File | null; name?: string; code: string; message: string }
export interface FileUploadEvents {
 beforeAdd: ControlEvent<FileUpload> & { file: File; cancel: boolean };
 add: ControlEvent<FileUpload> & { file: File; entry: FileUploadEntry };
 reject: ControlEvent<FileUpload> & FileUploadRejection;
 remove: ControlEvent<FileUpload> & { id: string };
 cancel: ControlEvent<FileUpload> & { id: string };
 uploadStart: ControlEvent<FileUpload> & { file: File; entry: FileUploadEntry };
 uploadSuccess: ControlEvent<FileUpload> & { entry: FileUploadEntry; result: unknown };
 uploadError: ControlEvent<FileUpload> & { entry: FileUploadEntry; error: unknown };
 complete: ControlEvent<FileUpload> & { entries: FileUploadEntry[] };
}
export declare class FileUpload extends BaseControl<FileUploadEvents> {
 constructor(options?: FileUploadOptions);
 constructor(container: HTMLElement | string, options?: FileUploadOptions);
 readonly busy: boolean;
 autoUpload: boolean;
 getEntries(): FileUploadEntry[];
 getFiles(): File[];
 getFile(id: string): File | null;
 addFiles(files: Iterable<File> | ArrayLike<File>, options?: VisibilityOptions): { accepted: FileUploadEntry[]; rejected: FileUploadRejection[] };
 start(): Promise<FileUploadEntry[]>;
 retry(id: string): boolean;
 cancel(id?: string): void;
 remove(id: string): boolean;
 clear(): void;
 openPicker(): boolean;
 linkDropArea(target: HTMLElement | string): { dispose(): void };
}
