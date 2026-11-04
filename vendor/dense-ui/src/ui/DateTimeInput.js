import { EditorControl } from "./EditorControl.js";
import { overlayManager } from "../core/OverlayManager.js";
import { renderIcon } from "./Icon.js";

class DateTimeInputBase extends EditorControl {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super({
      ...options,
      emptyValue: ""
    });

    this.placeholder = options.placeholder ?? "";
    this.min = options.min ?? null;
    this.max = options.max ?? null;
    this.step = Number(options.step ?? this.defaultStep);
    this._labelElement = null;
    this._group = null;
    this._iconElement = null;
    this._pickerButton = null;
    this.overlayManager = options.overlayManager ?? overlayManager;

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  get inputType() {
    return "text";
  }

  get inputMode() {
    return "text";
  }

  get pickerText() {
    return "...";
  }

  get pickerTitle() {
    return "Open picker";
  }

  get leadingIconType() {
    return "";
  }

  get defaultStep() {
    return 60;
  }

  createElement() {
    const root = document.createElement("label");
    root.className = ["dui-control", "dui-text-field", "dui-date-time-input", this.css]
      .filter(Boolean)
      .join(" ");
    root.dataset.duiControlId = this.id;

    const label = document.createElement("span");
    label.className = "dui-text-field__label";
    label.textContent = this.label;

    const group = document.createElement("span");
    group.className = "dui-date-time-input__group";

    const icon = document.createElement("span");
    icon.className = ["dui-date-time-input__icon", this.leadingIconType && `dui-date-time-input__icon--${this.leadingIconType}`]
      .filter(Boolean)
      .join(" ");
    icon.hidden = this.leadingIconType === "";
    renderIcon(icon, this.leadingIconType === "time" ? "clock" : this.leadingIconType);

    const input = document.createElement("input");
    input.className = "dui-text-field__input dui-date-time-input__input";
    input.type = this.inputType;
    input.inputMode = this.inputMode;
    input.placeholder = this.placeholder;
    input.value = this._toInputValue(this._value);
    input.disabled = this.disabled;
    input.readOnly = this.isReadOnly();
    input.required = this.isRequired();
    input.dataset.duiFocusTarget = "true";
    this._applyNativeInputLimits(input);

    const pickerButton = document.createElement("button");
    pickerButton.className = "dui-date-time-input__button";
    pickerButton.type = "button";
    pickerButton.textContent = "";
    pickerButton.title = this.pickerTitle;
    pickerButton.setAttribute("aria-label", this.pickerTitle);
    pickerButton.setAttribute("aria-haspopup", "dialog");
    pickerButton.setAttribute("aria-expanded", "false");
    pickerButton.disabled = this.disabled;
    renderIcon(pickerButton, "chevron-down");

    group.append(icon, input, pickerButton);
    this._appendExtraButtons(group);

    const message = document.createElement("div");
    message.className = "dui-text-field__message";
    message.setAttribute("role", "tooltip");
    message.hidden = true;

    root.append(label, group, message);
    this._labelElement = label;
    this._group = group;
    this._iconElement = icon;
    this._input = input;
    this._pickerButton = pickerButton;
    this._message = message;

    this.disposables.addEventListener(input, "input", () => {
      this._setValue(this._fromInputValue(input.value), {
        origin: "user",
        userAction: true
      });
    });

    this.disposables.addEventListener(input, "blur", () => {
      this._syncInput(this._value);
    });

    this.disposables.addEventListener(pickerButton, "click", event => {
      event.preventDefault();
      this._openPicker();
    });

    this.disposables.addEventListener(window, "resize", () => this._positionPickerOverlay());
    this.disposables.addEventListener(document, "scroll", () => this._positionPickerOverlay(), true);

    this._wirePickerOpenEvents(input);

    return root;
  }

  destroy() {
    if (this.destroyed || this._destroyingPicker) return;
    this._destroyingPicker = true;
    const picker = this._picker;
    try { this._hidePicker(); }
    finally {
      try { super.destroy(); }
      finally {
        picker?.remove();
        this._picker = null;
        this._calendarTitle = null;
        this._calendarGrid = null;
        this._hourWheel = null;
        this._minuteWheel = null;
        this._modeColumn = null;
        this._upButton = null;
        this._downButton = null;
        this._pendingValue = null;
        this._labelElement = null;
        this._group = null;
        this._iconElement = null;
        this._pickerButton = null;
      }
    }
  }

  _normalizeValue(value) {
    if (value == null || value === "") {
      return "";
    }

    if (value instanceof Date && !Number.isNaN(value.valueOf())) {
      return this._dateToValue(value);
    }

    return this._normalizeStringValue(String(value));
  }

  _normalizeStringValue(value) {
    return value;
  }

  _dateToValue(date) {
    return date.toISOString();
  }

  _toInputValue(value) {
    return value ?? "";
  }

  _fromInputValue(value) {
    return value;
  }

  _syncInput(value) {
    if (this._input) {
      const inputValue = this._toInputValue(value);

      if (this._input.value !== inputValue) {
        this._input.value = inputValue;
      }
    }
  }

  _syncStateToInput() {
    if (!this._input) {
      return;
    }

    this._input.readOnly = this.isReadOnly();
    this._input.required = this.isRequired();

    if (this._pickerButton) {
      this._pickerButton.disabled = this.disabled || this.isReadOnly();
    }
  }

  _renderLabel() {
    if (this._labelElement) {
      this._labelElement.textContent = this.label;
    }
  }

  _applyNativeInputLimits(input) {
    if (this.min != null) {
      input.min = String(this.min);
    }

    if (this.max != null) {
      input.max = String(this.max);
    }

    if (Number.isFinite(this.step) && this.step > 0) {
      input.step = String(this.step);
    }
  }

  _appendExtraButtons(_group) {}

  _wirePickerOpenEvents(_input) {}

  _hidePicker() {}

  _showPickerOverlay() {
    const picker = this._picker, group = this._group;
    if (this.destroyed || this._destroyingPicker || !picker || !group) return false;
    const root = this.overlayManager.getRoot();
    if (this.destroyed || this._destroyingPicker || this._picker !== picker || this._group !== group) return false;
    root.appendChild(picker);
    picker.hidden = false;
    this.overlayManager.open(this, {
      element: this._picker,
      anchor: this._group,
      modal: false,
      closeOnOutsideClick: true,
      closeOnEscape: true,
      restoreFocus: false,
      requestClose: request => {
        const localEscape = request.reason === "escape" &&
          (this._picker?.contains(request.nativeEvent?.target) || this.element?.contains(request.nativeEvent?.target));
        this._hidePicker({ origin: "user", userAction: true, reason: request.reason });
        if (localEscape) this._restorePickerFocus();
      }
    });
    if (this.destroyed || this._destroyingPicker || this._picker !== picker || picker.hidden) return false;
    this._pickerButton?.setAttribute("aria-expanded", "true");
    this._positionPickerOverlay();
    return true;
  }

  _restorePickerFocus() {
    if (this.destroyed || this._destroyingPicker || this.disabled || this.isReadOnly() || !this._input?.isConnected || !this._picker?.hidden) return;
    const active = document.activeElement;
    if (active === document.body || this._picker.contains(active) || this.element?.contains(active)) {
      this._input.focus({ preventScroll: true });
    }
  }

  _hidePickerOverlay() {
    const picker = this._picker;
    if (!picker) return false;
    // Commit local visibility before close callbacks: they may destroy this
    // control or reopen the same picker. Do not mutate owned DOM afterward.
    picker.hidden = true;
    this._pickerButton?.setAttribute("aria-expanded", "false");
    this.overlayManager.close(this, { restoreFocus: false });
    return true;
  }

  _positionPickerOverlay() {
    if (!this._picker || this._picker.hidden || !this._group?.isConnected) return false;
    const anchor = this._group.getBoundingClientRect();
    const picker = this._picker.getBoundingClientRect();
    const gap = 2;
    const viewportGap = 4;
    let top = anchor.bottom + gap;
    if (top + picker.height > window.innerHeight - viewportGap && anchor.top >= picker.height + gap) {
      top = anchor.top - picker.height - gap;
    }
    let left = anchor.right - picker.width;
    left = Math.max(viewportGap, Math.min(left, window.innerWidth - picker.width - viewportGap));
    top = Math.max(viewportGap, Math.min(top, window.innerHeight - picker.height - viewportGap));
    this._picker.style.left = `${Math.round(left)}px`;
    this._picker.style.top = `${Math.round(top)}px`;
    return true;
  }

  _openPicker() {
    if (!this._input || this.disabled || this.isReadOnly()) {
      return;
    }

    if (typeof this._input.showPicker === "function") {
      this._input.showPicker();
    } else {
      this._input.focus();
    }
  }
}

export class DateInput extends DateTimeInputBase {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this._picker = null;
    this._calendarTitle = null;
    this._calendarGrid = null;
    this._viewDate = parseDateValue(this._value)?.date ?? new Date();

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  get inputType() {
    return "text";
  }

  get pickerText() {
    return "Cal";
  }

  get pickerTitle() {
    return "Open calendar";
  }

  get leadingIconType() {
    return "calendar";
  }

  _normalizeStringValue(value) {
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : value;
  }

  _dateToValue(date) {
    return formatDateParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
  }

  _appendExtraButtons(group) {
    const picker = document.createElement("div");
    picker.className = "dui-date-time-picker dui-date-picker";
    picker.hidden = true;

    const calendar = this._createCalendarShell();
    picker.append(calendar.root);
    this._picker = picker;
    this._calendarTitle = calendar.title;
    this._calendarGrid = calendar.grid;

    this.disposables.addEventListener(calendar.prev, "click", event => {
      event.preventDefault();
      this._moveMonth(-1);
    });

    this.disposables.addEventListener(calendar.next, "click", event => {
      event.preventDefault();
      this._moveMonth(1);
    });

    this.disposables.addEventListener(calendar.clear, "click", event => {
      event.preventDefault();
      this._setValue("", {
        origin: "user",
        userAction: true
      });
      if (this.destroyed) return;
      this._renderPicker();
    });

    this.disposables.addEventListener(calendar.today, "click", event => {
      event.preventDefault();
      const now = new Date();
      this._setDatePart(formatDateParts(now.getFullYear(), now.getMonth() + 1, now.getDate()));
    });
  }

  _wirePickerOpenEvents(input) {
    this.disposables.addEventListener(input, "keydown", event => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        this._showPicker();
      }
    });
  }

  _openPicker() {
    if (this.destroyed || this._destroyingPicker || this.disabled || this.isReadOnly()) {
      return;
    }

    if (!this._picker || this._picker.hidden) {
      this._showPicker();
      return;
    }

    this._hidePicker();
  }

  _showPicker() {
    if (this.destroyed || this._destroyingPicker || this.disabled || this.isReadOnly() || !this._picker) {
      return;
    }

    this._renderPicker();
    if (this._showPickerOverlay()) this._input?.focus();
  }

  _hidePicker() {
    if (this._picker) {
      this._hidePickerOverlay();
    }
  }

  _createCalendarShell() {
    const root = document.createElement("div");
    root.className = "dui-date-time-picker__calendar";

    const header = document.createElement("div");
    header.className = "dui-date-time-picker__calendar-header";

    const prev = document.createElement("button");
    prev.className = "dui-date-time-picker__nav";
    prev.type = "button";
    renderIcon(prev, "chevron-left");
    prev.setAttribute("aria-label", "Previous month");

    const title = document.createElement("button");
    title.className = "dui-date-time-picker__title";
    title.type = "button";

    const next = document.createElement("button");
    next.className = "dui-date-time-picker__nav";
    next.type = "button";
    renderIcon(next, "chevron-right");
    next.setAttribute("aria-label", "Next month");

    header.append(prev, title, next);

    const weekdays = document.createElement("div");
    weekdays.className = "dui-date-time-picker__weekdays";

    for (const [index, day] of ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].entries()) {
      const item = document.createElement("span");
      item.textContent = day;
      item.classList.toggle("dui-weekend", index === 0 || index === 6);
      weekdays.append(item);
    }

    const grid = document.createElement("div");
    grid.className = "dui-date-time-picker__days";

    const footer = document.createElement("div");
    footer.className = "dui-date-time-picker__footer";

    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Clear";

    const today = document.createElement("button");
    today.type = "button";
    today.textContent = "Today";

    footer.append(clear, today);
    root.append(header, weekdays, grid, footer);

    return {
      root,
      prev,
      title,
      next,
      grid,
      clear,
      today
    };
  }

  _renderPicker() {
    this._renderCalendar();
  }

  _renderCalendar() {
    renderCalendar({
      viewDate: this._viewDate,
      selectedDateText: parseDateValue(this._value)?.dateText ?? "",
      title: this._calendarTitle,
      grid: this._calendarGrid,
      onSelect: value => this._setDatePart(value)
    });
  }

  _setDatePart(dateText) {
    this._setValue(dateText, {
      origin: "user",
      userAction: true
    });
    if (this.destroyed) return;
    this._viewDate = parseDateValue(this._value)?.date ?? this._viewDate;
    this._hidePicker();
    this._restorePickerFocus();
  }

  _moveMonth(delta) {
    this._viewDate = new Date(this._viewDate.getFullYear(), this._viewDate.getMonth() + delta, 1);
    this._renderCalendar();
  }
}

export class TimeInput extends DateTimeInputBase {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.hourMode = normalizeHourMode(options);
    this.hour12 = this.hourMode === "12";
    this.stepMinutes = Math.max(1, Number(options.stepMinutes ?? options.minuteStep ?? 15));
    this._upButton = null;
    this._downButton = null;
    this._picker = null;
    this._hourWheel = null;
    this._minuteWheel = null;
    this._modeColumn = null;
    this._pendingValue = null;

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  get inputType() {
    return "text";
  }

  get inputMode() {
    return "numeric";
  }

  get pickerText() {
    return "Time";
  }

  get pickerTitle() {
    return "Focus time";
  }

  get leadingIconType() {
    return "time";
  }

  _normalizeStringValue(value) {
    return normalizeTimeValue(value);
  }

  _dateToValue(date) {
    return formatTimeParts(date.getHours(), date.getMinutes());
  }

  _toInputValue(value) {
    if (this.hourMode === "12") {
      return formatTime12(value);
    }

    if (this.hourMode === "1-24") {
      return formatTime24(value);
    }

    return value;
  }

  _fromInputValue(value) {
    return normalizeTimeValue(value, {
      hourMode: this.hourMode
    });
  }

  _appendExtraButtons(group) {
    const stepper = document.createElement("span");
    stepper.className = "dui-date-time-input__stepper";

    const up = document.createElement("button");
    up.className = "dui-date-time-input__step";
    up.type = "button";
    renderIcon(up, "add");
    up.title = "Increase time";
    up.setAttribute("aria-label", "Increase time");

    const down = document.createElement("button");
    down.className = "dui-date-time-input__step";
    down.type = "button";
    renderIcon(down, "remove");
    down.title = "Decrease time";
    down.setAttribute("aria-label", "Decrease time");

    stepper.append(up, down);
    group.append(stepper);
    this._upButton = up;
    this._downButton = down;

    const picker = document.createElement("div");
    picker.className = "dui-time-picker";
    picker.hidden = true;

    const hourWheel = document.createElement("div");
    hourWheel.className = "dui-time-picker__wheel dui-scrollable";
    hourWheel.setAttribute("aria-label", "Hours");

    const minuteWheel = document.createElement("div");
    minuteWheel.className = "dui-time-picker__wheel dui-scrollable";
    minuteWheel.setAttribute("aria-label", "Minutes");

    const modeColumn = document.createElement("div");
    modeColumn.className = "dui-time-picker__modes";
    modeColumn.setAttribute("aria-label", "Time mode");

    const actions = this._createPickerActions();

    picker.append(hourWheel, minuteWheel, modeColumn, actions);
    this._picker = picker;
    this._hourWheel = hourWheel;
    this._minuteWheel = minuteWheel;
    this._modeColumn = modeColumn;

    this.disposables.addEventListener(up, "click", event => {
      event.preventDefault();
      this._stepTime(1);
    });

    this.disposables.addEventListener(down, "click", event => {
      event.preventDefault();
      this._stepTime(-1);
    });
  }

  _syncStateToInput() {
    super._syncStateToInput();

    const disabled = this.disabled || this.isReadOnly();

    if (this._upButton) {
      this._upButton.disabled = disabled;
    }

    if (this._downButton) {
      this._downButton.disabled = disabled;
    }

    for (const button of this._picker?.querySelectorAll("button") ?? []) {
      button.disabled = disabled;
    }
  }

  _wirePickerOpenEvents(input) {
    this.disposables.addEventListener(input, "keydown", event => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        this._showPicker();
      }
    });
  }

  _openPicker() {
    if (this.destroyed || this._destroyingPicker || this.disabled || this.isReadOnly()) {
      return;
    }

    if (!this._picker || this._picker.hidden) {
      this._showPicker();
      return;
    }

    this._hidePicker();
  }

  _showPicker() {
    if (this.destroyed || this._destroyingPicker || this.disabled || this.isReadOnly() || !this._picker) {
      return;
    }

    if (this._picker.hidden) {
      this._pendingValue = this._value || "00:00";
    }

    this._renderPicker();
    if (this._showPickerOverlay()) this._input?.focus();
  }

  _hidePicker() {
    if (this._picker) {
      this._syncInput(this._value);
      this._pendingValue = null;
      this._hidePickerOverlay();
    }
  }

  _closePicker() {
    if (this._picker) {
      this._pendingValue = null;
      this._hidePickerOverlay();
    }
  }

  _stepTime(direction) {
    if (this.disabled || this.isReadOnly()) {
      return;
    }

    const nextValue = addMinutes(this._value || "00:00", direction * this.stepMinutes);
    this._setValue(nextValue, {
      origin: "user",
      userAction: true
    });
    if (this.destroyed) return;
    if (!this._picker?.hidden) {
      this._pendingValue = this._value;
    }
    this._renderPicker();
  }

  _renderPicker() {
    if (!this._picker || !this._hourWheel || !this._minuteWheel || !this._modeColumn) {
      return;
    }

    const pickerValue = this._getPickerValue();
    const { hours, minutes } = getTimeParts(pickerValue);
    const activeMode = this.hourMode;
    const suffix = hours >= 12 ? "PM" : "AM";
    const hourItems = activeMode === "12" ? range(1, 12) : range(1, 24);
    const activeHour = activeMode === "12" ? hours % 12 || 12 : hours === 0 ? 24 : hours;
    const minuteItems = range(0, 59, Math.max(1, Math.min(30, this.stepMinutes)));

    this._hourWheel.replaceChildren(
      ...hourItems.map(hour =>
        this._createPickerButton(String(hour).padStart(2, "0"), activeHour === hour, () => {
          this._setTimeFromPicker(hour, minutes);
        })
      )
    );

    this._minuteWheel.replaceChildren(
      ...minuteItems.map(minute =>
        this._createPickerButton(String(minute).padStart(2, "0"), minutes === minute, () => {
          this._setTimeFromPicker(activeHour, minute);
        })
      )
    );

    this._modeColumn.replaceChildren(
      this._createPickerButton("AM", activeMode === "12" && suffix === "AM", () => {
        this._setPickerMode("AM");
      }),
      this._createPickerButton("PM", activeMode === "12" && suffix === "PM", () => {
        this._setPickerMode("PM");
      }),
      this._createPickerButton("24", activeMode !== "12", () => {
        this._setPickerMode("24");
      })
    );
  }

  _createPickerButton(text, active, onClick) {
    const button = document.createElement("button");
    button.className = "dui-time-picker__item";
    button.type = "button";
    button.textContent = text;
    button.classList.toggle("dui-time-picker__mode-24", text === "24");
    button.classList.toggle("dui-active", active);
    button.disabled = this.disabled || this.isReadOnly();
    button.addEventListener("click", event => {
      event.preventDefault();
      onClick();
    });
    return button;
  }

  _createPickerActions() {
    const actions = document.createElement("div");
    actions.className = "dui-picker-actions";

    const ok = document.createElement("button");
    ok.className = "dui-picker-actions__button";
    ok.type = "button";
    ok.textContent = "OK";

    const cancel = document.createElement("button");
    cancel.className = "dui-picker-actions__button";
    cancel.type = "button";
    cancel.textContent = "Cancel";

    actions.append(ok, cancel);

    this.disposables.addEventListener(ok, "click", event => {
      event.preventDefault();
      this._confirmPicker();
    });

    this.disposables.addEventListener(cancel, "click", event => {
      event.preventDefault();
      this._cancelPicker();
    });

    return actions;
  }

  _getPickerValue() {
    return this._pendingValue ?? this._value ?? "00:00";
  }

  _previewPickerValue(value) {
    this._pendingValue = value;
    this._syncInput(value);
    this._renderPicker();
  }

  _confirmPicker() {
    const nextValue = this._getPickerValue();
    this._setValue(nextValue, {
      origin: "user",
      userAction: true
    });
    if (this.destroyed) return;
    this._closePicker();
    this._restorePickerFocus();
  }

  _cancelPicker() {
    this._hidePicker();
    this._restorePickerFocus();
  }

  _setTimeFromPicker(hour, minute) {
    let nextHour = hour;

    if (this.hourMode === "12") {
      const currentSuffix = getTimeParts(this._getPickerValue()).hours >= 12 ? "PM" : "AM";

      if (nextHour === 12) {
        nextHour = 0;
      }

      if (currentSuffix === "PM") {
        nextHour += 12;
      }
    } else if (nextHour === 24) {
      nextHour = 0;
    }

    this._previewPickerValue(formatTimeParts(nextHour, minute));
  }

  _setPickerMode(mode) {
    const { hours, minutes } = getTimeParts(this._getPickerValue());

    if (mode === "24") {
      this.hourMode = "1-24";
      this.hour12 = false;
      this._syncInput(this._getPickerValue());
      this._renderPicker();
      return;
    }

    this.hourMode = "12";
    this.hour12 = true;

    let nextHours = hours;

    if (mode === "AM" && hours >= 12) {
      nextHours = hours - 12;
    }

    if (mode === "PM" && hours < 12) {
      nextHours = hours + 12;
    }

    this._previewPickerValue(formatTimeParts(nextHours, minutes));
  }
}

export class DateTimeInput extends DateTimeInputBase {
  constructor(containerOrOptions = {}, maybeOptions) {
    const hasContainer =
      typeof containerOrOptions === "string" ||
      (typeof HTMLElement !== "undefined" && containerOrOptions instanceof HTMLElement);

    const options = hasContainer ? maybeOptions ?? {} : containerOrOptions ?? {};

    super(options);

    this.hourMode = normalizeHourMode(options);
    this.hour12 = this.hourMode === "12";
    this.stepMinutes = Math.max(1, Number(options.stepMinutes ?? options.minuteStep ?? 15));
    this._picker = null;
    this._calendarTitle = null;
    this._calendarGrid = null;
    this._hourWheel = null;
    this._minuteWheel = null;
    this._modeColumn = null;
    this._viewDate = parseDateTimeValue(this._value)?.date ?? new Date();
    this._pendingValue = null;

    if (hasContainer) {
      this.mount(containerOrOptions);
    }
  }

  get inputType() {
    return "text";
  }

  get pickerText() {
    return "Cal";
  }

  get pickerTitle() {
    return "Open date and time picker";
  }

  get leadingIconType() {
    return "calendar";
  }

  _normalizeStringValue(value) {
    const normalized = value.replace(" ", "T");
    const match = normalized.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
    return match ? match[1] : normalized;
  }

  _toInputValue(value) {
    return value ? value.replace("T", " ") : "";
  }

  _fromInputValue(value) {
    return this._normalizeStringValue(value);
  }

  _dateToValue(date) {
    return `${formatDateParts(date.getFullYear(), date.getMonth() + 1, date.getDate())}T${formatTimeParts(
      date.getHours(),
      date.getMinutes()
    )}`;
  }

  _appendExtraButtons(group) {
    const picker = document.createElement("div");
    picker.className = "dui-date-time-picker";
    picker.hidden = true;

    const calendar = document.createElement("div");
    calendar.className = "dui-date-time-picker__calendar";

    const calendarHeader = document.createElement("div");
    calendarHeader.className = "dui-date-time-picker__calendar-header";

    const prev = document.createElement("button");
    prev.className = "dui-date-time-picker__nav";
    prev.type = "button";
    renderIcon(prev, "chevron-left");
    prev.setAttribute("aria-label", "Previous month");

    const title = document.createElement("button");
    title.className = "dui-date-time-picker__title";
    title.type = "button";

    const next = document.createElement("button");
    next.className = "dui-date-time-picker__nav";
    next.type = "button";
    renderIcon(next, "chevron-right");
    next.setAttribute("aria-label", "Next month");

    calendarHeader.append(prev, title, next);

    const weekdays = document.createElement("div");
    weekdays.className = "dui-date-time-picker__weekdays";

    for (const [index, day] of ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].entries()) {
      const item = document.createElement("span");
      item.textContent = day;
      item.classList.toggle("dui-weekend", index === 0 || index === 6);
      weekdays.append(item);
    }

    const grid = document.createElement("div");
    grid.className = "dui-date-time-picker__days";

    const footer = document.createElement("div");
    footer.className = "dui-date-time-picker__footer";

    const clear = document.createElement("button");
    clear.type = "button";
    clear.textContent = "Clear";

    const today = document.createElement("button");
    today.type = "button";
    today.textContent = "Today";

    footer.append(clear, today);
    calendar.append(calendarHeader, weekdays, grid, footer);

    const time = document.createElement("div");
    time.className = "dui-date-time-picker__time";

    const timeTitle = document.createElement("div");
    timeTitle.className = "dui-date-time-picker__time-title";
    timeTitle.textContent = "Time";

    const timeBody = document.createElement("div");
    timeBody.className = "dui-date-time-picker__time-body";

    const hourWheel = document.createElement("div");
    hourWheel.className = "dui-time-picker__wheel dui-scrollable";
    hourWheel.setAttribute("aria-label", "Hours");

    const minuteWheel = document.createElement("div");
    minuteWheel.className = "dui-time-picker__wheel dui-scrollable";
    minuteWheel.setAttribute("aria-label", "Minutes");

    const modeColumn = document.createElement("div");
    modeColumn.className = "dui-time-picker__modes";
    modeColumn.setAttribute("aria-label", "Time mode");

    const actions = this._createPickerActions();

    timeBody.append(hourWheel, minuteWheel, modeColumn);
    time.append(timeTitle, timeBody, actions);
    picker.append(calendar, time);
    this._picker = picker;
    this._calendarTitle = title;
    this._calendarGrid = grid;
    this._hourWheel = hourWheel;
    this._minuteWheel = minuteWheel;
    this._modeColumn = modeColumn;

    this.disposables.addEventListener(prev, "click", event => {
      event.preventDefault();
      this._moveMonth(-1);
    });

    this.disposables.addEventListener(next, "click", event => {
      event.preventDefault();
      this._moveMonth(1);
    });

    this.disposables.addEventListener(clear, "click", event => {
      event.preventDefault();
      this._previewPickerValue("");
      this._renderPicker();
    });

    this.disposables.addEventListener(today, "click", event => {
      event.preventDefault();
      const now = new Date();
      this._setDatePart(formatDateParts(now.getFullYear(), now.getMonth() + 1, now.getDate()));
    });
  }

  _syncStateToInput() {
    super._syncStateToInput();

    for (const button of this._picker?.querySelectorAll("button") ?? []) {
      button.disabled = this.disabled || this.isReadOnly();
    }
  }

  _wirePickerOpenEvents(input) {
    this.disposables.addEventListener(input, "keydown", event => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        this._showPicker();
      }
    });
  }

  _openPicker() {
    if (this.destroyed || this._destroyingPicker || this.disabled || this.isReadOnly()) {
      return;
    }

    if (!this._picker || this._picker.hidden) {
      this._showPicker();
      return;
    }

    this._hidePicker();
  }

  _showPicker() {
    if (this.destroyed || this._destroyingPicker || this.disabled || this.isReadOnly() || !this._picker) {
      return;
    }

    if (this._picker.hidden) {
      this._pendingValue = this._value || this._defaultDateTimeValue();
    }

    this._renderPicker();
    if (this._showPickerOverlay()) this._input?.focus();
  }

  _hidePicker() {
    if (this._picker) {
      this._syncInput(this._value);
      this._pendingValue = null;
      this._hidePickerOverlay();
    }
  }

  _closePicker() {
    if (this._picker) {
      this._pendingValue = null;
      this._hidePickerOverlay();
    }
  }

  _renderPicker() {
    if (!this._picker) {
      return;
    }

    this._renderCalendar();
    this._renderTimePicker();
  }

  _renderCalendar() {
    renderCalendar({
      viewDate: this._viewDate,
      selectedDateText: parseDateTimeValue(this._getPickerValue())?.dateText ?? "",
      title: this._calendarTitle,
      grid: this._calendarGrid,
      onSelect: value => this._setDatePart(value)
    });
  }

  _renderTimePicker() {
    if (!this._hourWheel || !this._minuteWheel || !this._modeColumn) {
      return;
    }

    const parts = parseDateTimeValue(this._getPickerValue()) ?? {
      hours: 0,
      minutes: 0
    };
    const activeMode = this.hourMode;
    const suffix = parts.hours >= 12 ? "PM" : "AM";
    const hourItems = activeMode === "12" ? range(1, 12) : range(1, 24);
    const activeHour = activeMode === "12" ? parts.hours % 12 || 12 : parts.hours === 0 ? 24 : parts.hours;
    const minuteItems = range(0, 59, Math.max(1, Math.min(30, this.stepMinutes)));

    this._hourWheel.replaceChildren(
      ...hourItems.map(hour =>
        this._createPickerButton(String(hour).padStart(2, "0"), activeHour === hour, () => {
          this._setTimeFromPicker(hour, parts.minutes);
        })
      )
    );

    this._minuteWheel.replaceChildren(
      ...minuteItems.map(minute =>
        this._createPickerButton(String(minute).padStart(2, "0"), parts.minutes === minute, () => {
          this._setTimeFromPicker(activeHour, minute);
        })
      )
    );

    this._modeColumn.replaceChildren(
      this._createPickerButton("AM", activeMode === "12" && suffix === "AM", () => {
        this._setPickerMode("AM");
      }),
      this._createPickerButton("PM", activeMode === "12" && suffix === "PM", () => {
        this._setPickerMode("PM");
      }),
      this._createPickerButton("24", activeMode !== "12", () => {
        this._setPickerMode("24");
      })
    );
  }

  _createPickerButton(text, active, onClick) {
    const button = document.createElement("button");
    button.className = "dui-time-picker__item";
    button.type = "button";
    button.textContent = text;
    button.classList.toggle("dui-time-picker__mode-24", text === "24");
    button.classList.toggle("dui-active", active);
    button.disabled = this.disabled || this.isReadOnly();
    button.addEventListener("click", event => {
      event.preventDefault();
      onClick();
    });
    return button;
  }

  _createPickerActions() {
    const actions = document.createElement("div");
    actions.className = "dui-picker-actions dui-date-time-picker__actions";

    const ok = document.createElement("button");
    ok.className = "dui-picker-actions__button";
    ok.type = "button";
    ok.textContent = "OK";

    const cancel = document.createElement("button");
    cancel.className = "dui-picker-actions__button";
    cancel.type = "button";
    cancel.textContent = "Cancel";

    actions.append(ok, cancel);

    this.disposables.addEventListener(ok, "click", event => {
      event.preventDefault();
      this._confirmPicker();
    });

    this.disposables.addEventListener(cancel, "click", event => {
      event.preventDefault();
      this._cancelPicker();
    });

    return actions;
  }

  _defaultDateTimeValue() {
    return `${formatDateParts(
      this._viewDate.getFullYear(),
      this._viewDate.getMonth() + 1,
      this._viewDate.getDate()
    )}T00:00`;
  }

  _getPickerValue() {
    return this._pendingValue ?? this._value ?? this._defaultDateTimeValue();
  }

  _previewPickerValue(value) {
    this._pendingValue = value;
    this._syncInput(value);
    this._viewDate = parseDateTimeValue(value)?.date ?? this._viewDate;
    this._renderPicker();
  }

  _confirmPicker() {
    const nextValue = this._getPickerValue();
    this._setValue(nextValue, {
      origin: "user",
      userAction: true
    });
    if (this.destroyed) return;
    this._closePicker();
    this._restorePickerFocus();
  }

  _cancelPicker() {
    this._viewDate = parseDateTimeValue(this._value)?.date ?? this._viewDate;
    this._hidePicker();
    this._restorePickerFocus();
  }

  _setDatePart(dateText) {
    const parts = parseDateTimeValue(this._getPickerValue());
    const timeText = parts ? formatTimeParts(parts.hours, parts.minutes) : "00:00";
    this._previewPickerValue(`${dateText}T${timeText}`);
  }

  _setTimeFromPicker(hour, minute) {
    let nextHour = hour;

    if (this.hourMode === "12") {
      const currentHours = parseDateTimeValue(this._getPickerValue())?.hours ?? 0;
      const currentSuffix = currentHours >= 12 ? "PM" : "AM";

      if (nextHour === 12) {
        nextHour = 0;
      }

      if (currentSuffix === "PM") {
        nextHour += 12;
      }
    } else if (nextHour === 24) {
      nextHour = 0;
    }

    const parts = parseDateTimeValue(this._getPickerValue());
    const dateText =
      parts?.dateText ??
      formatDateParts(this._viewDate.getFullYear(), this._viewDate.getMonth() + 1, this._viewDate.getDate());
    this._previewPickerValue(`${dateText}T${formatTimeParts(nextHour, minute)}`);
  }

  _setPickerMode(mode) {
    const parts = parseDateTimeValue(this._getPickerValue()) ?? {
      dateText: formatDateParts(this._viewDate.getFullYear(), this._viewDate.getMonth() + 1, this._viewDate.getDate()),
      hours: 0,
      minutes: 0
    };

    if (mode === "24") {
      this.hourMode = "1-24";
      this.hour12 = false;
      this._syncInput(this._getPickerValue());
      this._renderPicker();
      return;
    }

    this.hourMode = "12";
    this.hour12 = true;

    let nextHours = parts.hours;

    if (mode === "AM" && parts.hours >= 12) {
      nextHours = parts.hours - 12;
    }

    if (mode === "PM" && parts.hours < 12) {
      nextHours = parts.hours + 12;
    }

    this._previewPickerValue(`${parts.dateText}T${formatTimeParts(nextHours, parts.minutes)}`);
  }

  _moveMonth(delta) {
    this._viewDate = new Date(this._viewDate.getFullYear(), this._viewDate.getMonth() + delta, 1);
    this._renderCalendar();
  }
}

function normalizeTimeValue(value, options = {}) {
  return normalizeTimeValueWithOptions(value, options);
}

function parseDateValue(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  return {
    dateText: formatDateParts(year, month, day),
    date: new Date(year, month - 1, day)
  };
}

function parseDateTimeValue(value) {
  const match = String(value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = clampNumber(match[4], 0, 23);
  const minutes = clampNumber(match[5], 0, 59);

  return {
    dateText: formatDateParts(year, month, day),
    date: new Date(year, month - 1, day),
    hours,
    minutes
  };
}

function renderCalendar({ viewDate, selectedDateText, title, grid, onSelect }) {
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const today = new Date();

  title.textContent = `${monthName(month)} ${year}`;
  grid.replaceChildren();

  const firstDay = new Date(year, month, 1);
  const start = new Date(year, month, 1 - firstDay.getDay());

  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);

    const value = formatDateParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const button = document.createElement("button");
    button.className = "dui-date-time-picker__day";
    button.type = "button";
    button.textContent = String(date.getDate());
    button.classList.toggle("dui-muted", date.getMonth() !== month);
    button.classList.toggle("dui-weekend", date.getDay() === 0 || date.getDay() === 6);
    button.classList.toggle("dui-active", selectedDateText === value);
    button.classList.toggle(
      "dui-today",
      date.getFullYear() === today.getFullYear() &&
        date.getMonth() === today.getMonth() &&
        date.getDate() === today.getDate()
    );
    button.addEventListener("click", event => {
      event.preventDefault();
      onSelect(value);
    });
    grid.append(button);
  }
}

function normalizeTimeValueWithOptions(value, options = {}) {
  const text = String(value ?? "").trim();

  if (text === "") {
    return "";
  }

  const ampmMatch = text.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);

  if (ampmMatch) {
    let hours = Number(ampmMatch[1]);
    const minutes = Number(ampmMatch[2] ?? 0);
    const suffix = ampmMatch[3].toUpperCase();

    if (hours === 12) {
      hours = 0;
    }

    if (suffix === "PM") {
      hours += 12;
    }

    return formatTimeParts(hours, minutes);
  }

  const match = text.match(/^(\d{1,2})(?::(\d{2}))?$/);

  if (!match) {
    return text;
  }

  let hours = Number(match[1]);
  const minutes = Number(match[2] ?? 0);

  if (options.hourMode === "1-24" && hours === 24) {
    hours = 0;
  }

  return formatTimeParts(hours, minutes);
}

function formatTime12(value) {
  if (!value) {
    return "";
  }

  const [hoursText, minutesText] = value.split(":");
  const hours24 = Number(hoursText);
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  return `${String(hours12).padStart(2, "0")}:${minutesText ?? "00"} ${suffix}`;
}

function formatTime24(value) {
  if (!value) {
    return "";
  }

  const [hoursText, minutesText] = value.split(":");
  const hours24 = Number(hoursText);
  const displayHour = hours24 === 0 ? 24 : hours24;
  return `${String(displayHour).padStart(2, "0")}:${minutesText ?? "00"}`;
}

function addMinutes(value, minutes) {
  const normalized = normalizeTimeValue(value);
  const parts = getTimeParts(normalized);
  const current = parts.hours * 60 + parts.minutes;
  const next = (current + minutes + 24 * 60) % (24 * 60);
  return formatTimeParts(Math.floor(next / 60), next % 60);
}

function getTimeParts(value) {
  const normalized = normalizeTimeValue(value) || "00:00";
  const [hoursText, minutesText] = normalized.split(":");
  return {
    hours: clampNumber(hoursText, 0, 23),
    minutes: clampNumber(minutesText, 0, 59)
  };
}

function range(start, end, step = 1) {
  const values = [];

  for (let value = start; value <= end; value += step) {
    values.push(value);
  }

  return values;
}

function monthName(month) {
  return [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December"
  ][month];
}

function normalizeHourMode(options = {}) {
  if (options.hourMode === "12" || options.mode === "12" || options.hour12 === true || options.format === "12") {
    return "12";
  }

  if (
    options.hourMode === "1-24" ||
    options.hourMode === "24" ||
    options.mode === "1-24" ||
    options.mode === "24" ||
    options.hour24 === true ||
    options.format === "24"
  ) {
    return "1-24";
  }

  return "0-23";
}

function formatDateParts(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatTimeParts(hours, minutes) {
  const safeHours = clampNumber(hours, 0, 23);
  const safeMinutes = clampNumber(minutes, 0, 59);
  return `${String(safeHours).padStart(2, "0")}:${String(safeMinutes).padStart(2, "0")}`;
}

function clampNumber(value, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.trunc(number)));
}
