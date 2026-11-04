import { SelectInput } from './SelectInput.js';
import type { DefaultItemId, ItemId } from '../core/index.js';
/** Experimental SelectInput compatibility variant that always uses its custom popup. */
export declare class DropDownList<T extends object = Record<string, unknown>, I extends ItemId = DefaultItemId<T>, C extends object = object>
  extends SelectInput<T, I, C> {}
