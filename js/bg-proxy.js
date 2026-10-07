/**
 * Background fetch proxy.
 * Page scripts send {type:'fetch', url, headers, as}; hosts are restricted by
 * the "host_permissions" block in manifest.json, which is the single place to
 * declare which remote origins Newey may talk to.
 */

const ALLOWED_HOSTS = [
  ['www.gstatic.com', 'gstatic.com'],
  ['api.met.no', 'met.no'],
  ['geocoding-api.open-meteo.com', 'open-meteo.com'],
  ['www.bing.com', 'bing.com'],
];

const allowed = (url) => {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_HOSTS.some(([host, suffix]) => u.hostname === host || u.hostname.endsWith('.' + suffix));
  } catch {
    return false;
  }
};

async function doFetch(url, headers, as) {
  const res = await fetch(url, { headers: headers ?? undefined, credentials: 'omit' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  if (as === 'blob') return await res.blob();
  if (as === 'text') return await res.text();
  return await res.json();
}

const RESPONSE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'fetch') return false;
  (async () => {
    if (!allowed(msg.url)) {
      sendResponse({ ok: false, error: `origin not allowed: ${msg.url}` });
      return;
    }
    const key = `${msg.url}|${JSON.stringify(msg.headers ?? {})}`;
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now()) {
      sendResponse({ ok: true, data: hit.value });
      return;
    }
    try {
      const value = await doFetch(msg.url, msg.headers, msg.as);
      if (msg.as !== 'blob') cache.set(key, { value, exp: Date.now() + RESPONSE_TTL_MS });
      sendResponse({ ok: true, data: value });
    } catch (err) {
      // serve stale on failure
      if (hit) {
        sendResponse({ ok: true, data: hit.value, stale: true, error: String(err?.message ?? err) });
      } else {
        sendResponse({ ok: false, error: err?.message ?? String(err) });
      }
    }
  })();
  return true;
});
