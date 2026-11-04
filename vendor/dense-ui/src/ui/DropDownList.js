import { SelectInput } from "./SelectInput.js";

// Compatibility surface for custom renderers, descriptions and other advanced popup options.
export class DropDownList extends SelectInput {
  get _alwaysUsePopup() {
    return true;
  }
}
