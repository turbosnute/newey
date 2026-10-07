/**
 * Bing background provider — today's bing.com homepage image.
 */

import { BaseBackgroundProvider, defineBackground } from '../js/module-api.js';
import { proxiedFetch } from '../js/utils.js';

const BING_ARCHIVE_URL = 'https://www.bing.com/HPImageArchive.aspx?format=js&idx=0&n=1&uhd=1';

class BingBackground extends BaseBackgroundProvider {
  static id = 'newey.background.bing';
  static name = 'Bing';
  static description = "Today's bing.com homepage image, updated daily.";
  static hasConfig = false;
  static defaultConfig = {};

  async getBackground() {
    const data = await proxiedFetch(BING_ARCHIVE_URL, { as: 'json' });
    const image = data?.images?.[0];
    if (!image?.url) throw new Error('Bing: no image in archive response');

    const imageUrl = image.url.startsWith('http')
      ? image.url
      : `https://www.bing.com${image.url}`;

    // The copyright line looks like "Caption (© Author / Agency)".
    const m = /^(.*?)\s*\((.*)\)\s*$/.exec(image.copyright || '');
    const title = (m?.[1] ?? image.copyright ?? '').trim();
    const author = (m?.[2] ?? '').replace(/\u00a9/g, '©').trim();

    return {
      image: imageUrl,
      title,
      link: image.copyrightlink || 'https://www.bing.com/',
      author,
      source: 'Bing',
    };
  }
}

export default defineBackground(BingBackground);
