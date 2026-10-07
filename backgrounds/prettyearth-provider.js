/**
 * PrettyEarth background provider — Google Earth View gallery images.
 * Uses the standalone third-party module ../prettyearth.js (repo root) for
 * all the actual fetching; this file only adds Newey's background-provider
 * metadata around it.
 */

import { BaseBackgroundProvider, defineBackground } from '../js/module-api.js';
import { getPrettyEarthImageUrl, getRandomPrettyEarthImageUrl, PRETTY_EARTH_IDS } from '../prettyearth.js';

class PrettyEarthBackground extends BaseBackgroundProvider {
  static id = 'newey.background.prettyearth';
  static name = 'PrettyEarth';
  static description = 'Random satellite photo from the Google Earth View gallery.';
  static hasConfig = true;
  static defaultConfig = {
    country: '', // empty = any country (case-insensitive substring match)
  };
  static configSchema = [
    { key: 'country', label: 'Country filter', type: 'text', help: 'Only show images from this country (e.g. Australia). Empty = any.' },
  ];

  /**
   * @returns {Promise<{image:string,title:string,link:string,author:string,source:string}>}
   */
  async getBackground() {
    const country = (this.config.country || '').trim();
    if (country) {
      try {
        return await this.#fetchByCountry(country);
      } catch (err) {
        // A filter miss should never replace the current background with a
        // random shot — return "no image" and let the manager keep what's up.
        console.warn(`[PrettyEarth] no image found for "${country}" — keeping the current background:`, err.message ?? err);
        return null;
      }
    }

    try {
      const info = await getRandomPrettyEarthImageUrl();
      return this.#toBackground(info);
    } catch (err) {
      console.warn('[PrettyEarth] falling back after error:', err);
      return {
        image: 'https://picsum.photos/1920/1080?grayscale',
        title: 'Random photo (PrettyEarth unavailable)',
        link: 'https://earthview.withgoogle.com/',
        author: '',
        source: 'PrettyEarth',
      };
    }
  }

  /**
   * The PrettyEarth endpoint only exposes per-id JSON (which contains the
   * full image), so filtering by country means probing random ids for a
   * matching one. Probing downloads a whole image per attempt, so the
   * attempt count stays bounded.
   */
  async #fetchByCountry(country) {
    const wanted = country.toLowerCase();
    for (let attempt = 0; attempt < 40; attempt++) {
      const id = PRETTY_EARTH_IDS[Math.floor(Math.random() * PRETTY_EARTH_IDS.length)];
      const info = await getPrettyEarthImageUrl(id);
      const tags = [info.country, info.attribution].filter(Boolean).join(' ').toLowerCase();
      if (tags.includes(wanted)) return this.#toBackground(info);
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`No PrettyEarth image found for country "${country}"`);
  }

  #toBackground(info) {
    // "Australia" -> "Earth View #1003 · Australia"
    const place = info.country ? ` · ${info.country}` : '';
    return {
      image: info.url, // data:image/jpeg;base64 URI
      title: `Earth View #${info.id}${place}`,
      link: `https://earthview.withgoogle.com/${info.id}`,
      author: (info.attribution || '').replace(/\u00a9/g, '©'),
      source: 'PrettyEarth',
    };
  }
}

export default defineBackground(PrettyEarthBackground);
