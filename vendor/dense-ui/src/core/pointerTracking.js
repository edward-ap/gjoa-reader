export function listenUntilPointerUp({
  target,
  move,
  up,
  options = false
} = {}) {
  if (!target || typeof target.addEventListener !== "function") {
    throw new TypeError("listenUntilPointerUp() requires an event target.");
  }

  let disposed = false;

  const dispose = () => {
    if (disposed) {
      return;
    }

    disposed = true;
    target.removeEventListener("pointermove", handleMove, options);
    target.removeEventListener("pointerup", handleUp, options);
  };

  const handleMove = event => {
    if (!disposed) {
      move?.(event);
    }
  };

  const handleUp = event => {
    dispose();
    up?.(event);
  };

  target.addEventListener("pointermove", handleMove, options);
  target.addEventListener("pointerup", handleUp, options);

  return {
    dispose,
    off: dispose
  };
}
