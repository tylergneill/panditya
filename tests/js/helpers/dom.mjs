// Shared helpers for tests that need a browser DOM (jsdom).
import { JSDOM } from 'jsdom';

/**
 * A fresh jsdom window. Pass `html` for the body and `url` for location.
 * `pretendToBeVisual` gives us requestAnimationFrame.
 */
export function makeDom(html = '<!DOCTYPE html><body></body>', { url = 'http://localhost/' } = {}) {
  return new JSDOM(html, { url, pretendToBeVisual: true });
}

/** Wait for queued promise callbacks to run. */
export const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/** Wait `ms` milliseconds of real time. */
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Fire a keydown with `key` on `el`; returns the event so tests can check defaultPrevented. */
export function key(window, el, keyName) {
  const event = new window.KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true });
  el.dispatchEvent(event);
  return event;
}

/** Type `text` into an input the way a user would (sets value, fires input). */
export function type(window, input, text) {
  input.focus();
  input.value = text;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}
