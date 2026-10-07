/**
 * Newey — small shared utilities.
 * Runs both as a chrome-extension:// page and (for development) from a plain
 * http server, so it avoids anything tied to a bundler or a server.
 */

export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export function deepMerge(base, patch) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!patch) return out;
  for (const [k, v] of Object.entries(patch)) {
    if (
      out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]) &&
      v && typeof v === 'object' && !Array.isArray(v)
    ) {
      out[k] = deepMerge(out[k], v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v; // trusted, internal templates only
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (typeof v === 'boolean') { if (v) node.setAttribute(k, ''); }
    else if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

const HAS_CHROME = typeof chrome !== 'undefined' && !!chrome?.runtime?.id;
const FORBIDDEN_HEADERS = ['user-agent', 'referer', 'host', 'cookie'];

/**
 * Fetch via the background service worker (bypasses CORS for hosts the
 * extension trusts) with a fallback to a plain page fetch.
 * opts: {as: 'json'|'blob'|'text', headers, timeout}
 */
export async function proxiedFetch(url, opts = {}) {
  const { as = 'json', headers, timeout = 20000 } = opts;
  if (HAS_CHROME) {
    try {
      const res = await chrome.runtime.sendMessage({ type: 'fetch', url, headers, as, timeout });
      if (res?.ok) return res.data;
      if (res?.error && !res.stale) throw new Error(String(res.error));
      if (res?.stale) return res.data; // network hiccup — last good copy
    } catch (err) {
      if (/Could not establish connection|Extension context invalidated|message port closed/i.test(String(err?.message))) {
        throw err; // service worker unreachable — page fetch would fail CORS too
      }
      // worker threw for another reason; still try a direct page fetch below
    }
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    // Forbidden header names (e.g. User-Agent) are not settable from a page;
    // drop them to avoid console noise in the direct-fetch fallback.
    const cleanHeaders = Object.fromEntries(
      Object.entries(headers ?? {}).filter(([k]) => !FORBIDDEN_HEADERS.includes(k.toLowerCase()))
    );
    const res = await fetch(url, { headers: cleanHeaders, signal: ctrl.signal, mode: 'cors', credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return as === 'blob' ? await res.blob() : as === 'text' ? await res.text() : await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function cToF(c) {
  return c * 9 / 5 + 32;
}

export function formatTemp(c, unit) {
  return `${Math.round(unit === 'f' ? cToF(c) : c)}°`;
}

/**
 * Per-key in-memory cache with TTL. get(key, ttlMs, fn) resolves fn()'s value
 * and serves it from cache while fresh; on refresh failure it keeps serving
 * the last good value (like MagicMirror's fetchers).
 */
export function createTTLCache() {
  const store = new Map();
  return {
    async get(key, ttlMs, fn) {
      const now = Date.now();
      const hit = store.get(key);
      if (hit && hit.exp > now) return hit.val;
      try {
        const val = await fn();
        store.set(key, { val, exp: Date.now() + ttlMs });
        return val;
      } catch (err) {
        if (hit) return hit.val;
        throw err;
      }
    },
  };
}
