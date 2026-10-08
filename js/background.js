/**
 * Newey — background manager.
 *
 * Draws the active background provider's image across two stacked layers
 * (for cross-fades), shows image info in the bottom-right corner, keeps the
 * last image in sessionStorage for instantly-painted new tabs, and estimates
 * image brightness to pick a readable text theme.
 */

const SNAPSHOT_KEY = 'newey.background.last';

export class BackgroundManager {
  constructor({ registry, settingsSection }) {
    this.registry = registry;
    this.section = settingsSection;
    this.rotateTimer = null;
    this.current = null; // { providerId, info }
  }

  get settings() {
    return this.section.value ?? {};
  }

  async start() {
    this.root = document.getElementById('background');
    this.layerA = document.getElementById('background-a');
    this.layerB = document.getElementById('background-b');
    this.credit = document.getElementById('background-credit');
    if (!this.root || !this.layerA || !this.layerB || !this.credit) return;

    this.root.classList.add('background--loading');

    // instantly paint the last-seen image before anything is fetched
    try {
      const snap = JSON.parse(sessionStorage.getItem(SNAPSHOT_KEY) || 'null');
      if (snap?.providerId === this.settings.backgroundId && snap?.info?.image) {
        this.#paint(snap.info, { instant: true });
      }
    } catch { /* corrupt snapshot — ignore */ }

    this.section.subscribe(() => this.#restart());
    this.root.addEventListener('newey:refresh-background', () => this.#load());
    this.#restart();
  }

  #restart() {
    if (this.rotateTimer) clearInterval(this.rotateTimer);
    this.rotateTimer = null;
    this.#load();
    if (this.settings.rotateMinutes > 0) {
      this.rotateTimer = setInterval(() => this.#load(), this.settings.rotateMinutes * 60 * 1000);
    }
  }

  async #load() {
    const providerClass = this.registry.get(this.settings.backgroundId);
    if (!providerClass) return;
    const provider = new providerClass(this.settings.backgroundConfigs?.[this.settings.backgroundId] ?? {});

    try {
      const info = await provider.getBackground();
      if (!info) return; // provider chose to keep the current background
      info.image = await this.#preload(info.image); // wait until decodable
      this.#paint(info);
      this.current = { providerId: this.settings.backgroundId, info };
      try {
        sessionStorage.setItem(SNAPSHOT_KEY, JSON.stringify(this.current));
      } catch { /* quota exceeded — ignore */ }
    } catch (err) {
      console.error('[Newey] background provider failed:', err);
      this.#showError(err);
    }
  }

  /** Resolves once the image is decodable; rejects broken URLs quickly. */
  #preload(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(url);
      img.onerror = () => reject(new Error('image failed to load'));
      img.decoding = 'async';
      img.src = url;
    });
  }

  #paint(info, { instant = false } = {}) {
    // back layer takes the new image, then the front flag flips to fade it in
    const frontIsB = this.root.dataset.front === 'b';
    const back = frontIsB ? this.layerA : this.layerB;
    back.style.backgroundImage = `url("${info.image.replace(/"/g, '%22')}")`;
    if (instant) this.root.classList.add('background--no-anim');
    this.root.dataset.front = frontIsB ? 'a' : 'b';
    this.root.classList.remove('background--loading');
    this.root.classList.remove('background--no-anim');

    if (this.credit) {
      const link = info.link || '#';
      // Line 1: display name (link). Line 2: copyright/attribution on its
      // own line under the other info, for every provider.
      this.credit.innerHTML = `
        <a href="${escapeAttr(link)}" target="_blank" rel="noreferrer noopener"
           title="Open image source">${escapeHtml(info.title || 'Background image')}</a>
        ${info.author ? `<span class="credit-author">${escapeHtml(info.author)}</span>` : ''}
      `;
      this.credit.classList.remove('hidden');
    }

    this.#estimateBrightness(info.image)
      .then((light) => document.documentElement.classList.toggle('theme-light', light))
      .catch(() => {});
  }

  #showError(err) {
    this.root?.classList.remove('background--loading');
    this.root?.classList.add('background--error');
    if (this.credit) {
      this.credit.innerHTML = `<small>background unavailable: ${escapeHtml(String(err?.message ?? err))}</small>`;
      this.credit.classList.remove('hidden');
    }
  }

  /**
   * Luma estimation on a tiny offscreen canvas; returns true when the image
   * is light enough for dark text. Fails (and keeps default theme) for
   * opaque non-CORS images.
   */
  async #estimateBrightness(imageUrl) {
    const blob = await this.#fetchAsBlob(imageUrl);
    const bmp = await createImageBitmap(blob);
    const size = 24;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);
    bmp.close?.();

    let lumaSum = 0;
    let weight = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3] / 255;
      lumaSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) * a;
      weight += a;
    }
    if (weight < 10) return false;
    return lumaSum / weight > 186;
  }

  async #fetchAsBlob(imageUrl) {
    if (imageUrl.startsWith('data:')) {
      return await (await fetch(imageUrl)).blob();
    }
    const { proxiedFetch } = await import('./utils.js');
    return await proxiedFetch(imageUrl, { as: 'blob' });
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const escapeAttr = (s) => escapeHtml(s);
