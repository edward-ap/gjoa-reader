import { LabelText } from "./LabelText.js";

export class ReadonlyText extends LabelText {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};
    const css = ["dui-readonly-text", options.css].filter(Boolean).join(" ");

    if (hasContainer) {
      super(containerOrOptions, { ...options, css, role: options.role ?? "text" });
    } else {
      super({ ...options, css, role: options.role ?? "text" });
    }
  }
}
