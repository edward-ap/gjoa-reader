const VALID_ORIGINS = new Set([
  "user",
  "api",
  "command",
  "import",
  "restore",
  "undo",
  "redo",
  "host",
  "system"
]);

export function normalizeMutationOptions(options = {}) {
  if (!options || typeof options !== "object") {
    options = {};
  }

  let origin = options.origin;
  let userAction = options.userAction === true;

  if (origin == null) {
    origin = userAction ? "user" : "api";
  }

  if (!VALID_ORIGINS.has(origin)) {
    throw new TypeError(`Invalid mutation origin: ${String(origin)}.`);
  }

  if (origin === "user") {
    userAction = true;
  }

  return {
    silent: options.silent === true,
    userAction,
    origin,
    reason: options.reason,
    operation: options.operation
  };
}

export function isUserOrigin(options = {}) {
  return normalizeMutationOptions(options).origin === "user";
}
