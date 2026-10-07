/**
 * Newey — settings storage.
 * State lives in chrome.storage.local (falling back to localStorage when the
 * page runs outside the extension, e.g. during development). API is async
 * either way, and all writes are debounced per key id.
 */

import { deepClone, deepMerge } from './utils.js';

const STORAGE_PREFIX = 'newey.';

const storage = chrome?.storage?.local
  ? { get: (k) => chrome.storage.local.get(k).then((o) => o?.[k]), set: (k, v) => chrome.storage.local.set({ [k]: v }) }
  : {
      get: async (k) => localStorage.getItem(k) === null ? undefined : JSON.parse(localStorage.getItem(k)),
      set: async (k, v) => localStorage.setItem(k, JSON.stringify(v)),
    };

/**
 * Section — one persisted settings object ({key, defaults}). Subscriptions
 * fire with the merged value whenever the section is written.
 */
export class Section {
  constructor({ key, defaults = {}, updateStrategy }) {
    this.key = key;
    this.defaults = defaults;
    this.updateStrategy = updateStrategy;
    this.subs = new Set();
  }

  getKey() {
    return STORAGE_PREFIX + this.key;
  }

  async load() {
    const stored = await storage.get(this.getKey());
    this.value = this.updateStrategy
      ? this.updateStrategy(deepClone(this.defaults), stored)
      : deepMerge(this.defaults, stored);
    await storage.set(this.getKey(), this.value);
    return this.value;
  }

  async update(patch) {
    this.value = deepMerge(this.value ?? deepClone(this.defaults), patch);
    await storage.set(this.getKey(), this.value);
    this.emit(this.value);
  }

  /** Replace the whole value — used for full layout writes. */
  async overwrite(value) {
    this.value = value;
    await storage.set(this.getKey(), this.value);
    this.emit(this.value);
  }

  subscribe(fn) {
    this.subs.add(fn);
    return () => this.subs.delete(fn);
  }

  emit(value) {
    this.subs.forEach((fn) => {
      try { fn(value); } catch (err) { console.error('[Newey] section subscriber failed:', err); }
    });
  }
}
