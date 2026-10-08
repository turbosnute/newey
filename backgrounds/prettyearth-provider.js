/**
 * PrettyEarth background provider — Google Earth View gallery images.
 * Uses the standalone third-party module ../prettyearth.js (repo root) for
 * all the actual fetching; this file only adds Newey's background-provider
 * metadata around it.
 */

import { BaseBackgroundProvider, defineBackground } from '../js/module-api.js';
import { getPrettyEarthImageUrl, getRandomPrettyEarthImageUrl, PRETTY_EARTH_IDS } from '../prettyearth.js';

// Earth View source images are 800px wide; meters per pixel at Mercator zoom z
// and latitude lat: 156543.03392 * cos(lat) / 2^z (verified against the
// `bounds` field of the prettyearth-examples files).
const EARTH_VIEW_WIDTH_PX = 800;
const MERCATOR_MPP_Z0 = 156543.03392;
const EARTH_FOV_DEG = 35; // Google Earth web share-link field of view

/**
 * Human-readable place name for a PrettyEarth image, in order of preference:
 * geocode locality + country (e.g. "Miami Beach, United States", or just
 * "Crimea" when the geocode only has a country), then top-level region +
 * country (e.g. "Västra Götaland County, Sweden"), and only as a last
 * resort the raw "Earth View #id".
 * @param {object} info - result of getPrettyEarthImageUrl()
 * @returns {string}
 */
export function prettyEarthDisplayName(info) {
  const g = info.geocode;
  if (g) {
    const parts = [g.locality, g.country].filter(Boolean);
    if (parts.length) return parts.join(', ');
  }
  const fallback = [info.region, info.country].filter(Boolean);
  if (fallback.length) return fallback.join(', ');
  return `Earth View #${info.id}`;
}

/**
 * Google Earth web link centred on the image's coordinates. When the zoom
 * of the source imagery is known, the camera distance is derived from the
 * 800px source width so Google Earth shows roughly the same patch of
 * ground as the original Earth View crop.
 * @param {object} info - result of getPrettyEarthImageUrl()
 * @returns {string}
 */
export function prettyEarthLink(info) {
  const num = (n, places = 6) => Number(Number(n).toFixed(places)).toString();
  if (!Number.isFinite(info.lat) || !Number.isFinite(info.lng)) {
    return `https://earthview.withgoogle.com/${info.id}`;
  }
  let distance = 5000; // neutral overview distance when zoom is unknown
  if (Number.isFinite(info.zoom)) {
    const metersPerPixel = (MERCATOR_MPP_Z0 * Math.cos((info.lat * Math.PI) / 180)) / 2 ** info.zoom;
    const groundWidth = EARTH_VIEW_WIDTH_PX * metersPerPixel;
    distance = groundWidth / (2 * Math.tan(((EARTH_FOV_DEG / 2) * Math.PI) / 180));
  }
  const altitude = Number.isFinite(info.elevation) ? info.elevation : 0;
  return (
    `https://earth.google.com/web/@${num(info.lat, 7)},${num(info.lng, 7)},${num(altitude)}a,` +
    `${num(distance)}d,${EARTH_FOV_DEG}y,0h,0t,0r`
  );
}

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
      const tags = [info.country, info.region, info.geocode?.locality, info.attribution]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (tags.includes(wanted)) return this.#toBackground(info);
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`No PrettyEarth image found for country "${country}"`);
  }

  /**
   * @returns {{image:string,title:string,link:string,author:string,source:string}}
   *   `title` is the place name (never the Earth View id when a place is
   *   known), `link` opens the spot in Google Earth, and `author` is the
   *   copyright attribution.
   */
  #toBackground(info) {
    return {
      image: info.url, // data:image/jpeg;base64 URI
      title: prettyEarthDisplayName(info),
      link: prettyEarthLink(info),
      author: (info.attribution || '').replace(/\u00a9/g, '©'),
      source: 'PrettyEarth',
    };
  }
}

export default defineBackground(PrettyEarthBackground);
