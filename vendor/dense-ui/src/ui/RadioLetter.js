import { RadioGroup } from "./RadioGroup.js";

export class RadioLetter extends RadioGroup {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);
    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super({
      ...options,
      css: ["dui-radio-letter", options.css].filter(Boolean).join(" "),
      markerField: options.markerField ?? "letter",
      markerStyle: "letter"
    });

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }
}
