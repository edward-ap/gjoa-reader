import { ListPortProvider } from "./ListPortProvider.js";

export class TreeListPortProvider extends ListPortProvider {
  constructor(tree, options = {}) {
    if (!tree?.treeView) throw new TypeError("TreeListPortProvider requires a TreeList.");
    super(tree, options);
  }
}
