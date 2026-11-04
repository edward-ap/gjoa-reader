export function required(message = "Required") {
  return value => {
    if (value == null || String(value).trim() === "") {
      return {
        ok: false,
        severity: "error",
        message,
        code: "required"
      };
    }

    return true;
  };
}

export function email(message = "Invalid email address") {
  return value => {
    const text = value == null ? "" : String(value).trim();

    if (text === "") {
      return true;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      return {
        ok: false,
        severity: "error",
        message,
        code: "email"
      };
    }

    return true;
  };
}

export function valueInData(message = "Unknown value") {
  return (value, context = {}) => {
    if (value == null || String(value).trim() === "") {
      return true;
    }

    const control = context.control;

    if (!control?.data || typeof control.data.get !== "function") {
      throw new TypeError("valueInData validator requires a data-bound control.");
    }

    if (!control.data.get(value)) {
      return {
        ok: false,
        severity: "error",
        message,
        code: "valueInData"
      };
    }

    return true;
  };
}
