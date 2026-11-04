import { LabelText } from "./LabelText.js";

export class StatusText extends LabelText {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};
    const css = ["dui-status-text", options.css].filter(Boolean).join(" ");

    if (hasContainer) {
      super(containerOrOptions, { ...options, css });
    } else {
      super({ ...options, css });
    }
  }
}
