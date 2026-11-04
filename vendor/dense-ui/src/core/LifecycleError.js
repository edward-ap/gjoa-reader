export class LifecycleError extends Error {
  constructor(message, control, operation) {
    super(message);
    this.name = "LifecycleError";
    this.control = control;
    this.controlId = control?.id ?? null;
    this.operation = operation ?? null;
  }
}
