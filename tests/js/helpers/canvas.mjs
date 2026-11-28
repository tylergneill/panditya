// A recording stand-in for CanvasRenderingContext2D, shared by the drawing tests.

/** A stand-in CanvasRenderingContext2D that logs calls and property sets. */
export function recordingContext() {
  const log = [];
  const state = {};
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop === 'log') return log;
      if (prop === 'measureText') return text => ({ width: String(text).length * 7 });
      if (prop in target) return target[prop];
      return (...args) => log.push([prop, ...args]);
    },
    set(target, prop, value) {
      target[prop] = value;
      log.push([`set:${prop}`, value]);
      return true;
    },
  });
  return ctx;
}
