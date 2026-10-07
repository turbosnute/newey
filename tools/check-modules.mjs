// Quick static sanity check: imports every module file to catch syntax
// errors and bad import paths without booting a browser.
//
//   node tools/check-modules.mjs

import { pathToFileURL } from 'node:url';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const files = [
  'js/utils.js',
  'js/module-api.js',
  'js/storage.js',
  'js/grid.js',
  'js/interaction.js',
  'js/widgets.js',
  'js/settings.js',
  'js/background.js',
  'js/main.js', // side effects avoided: main() throws but only after import completes
  'js/bg-proxy.js',
  'widgets/clock.js',
  'widgets/weather.js',
  'backgrounds/prettyearth-provider.js',
  'backgrounds/bing-provider.js',
];

// stub the bits Node doesn't have that modules touch at import time
globalThis.chrome = undefined;

let failures = 0;
for (const rel of files) {
  try {
    await import(pathToFileURL(join(root, rel)).href);
    console.log(`ok    ${rel}`);
  } catch (err) {
    const fatal = /document is not defined|window is not defined|localStorage is not defined|Cannot read properties of undefined/.test(String(err));
    if (fatal) {
      console.log(`skip  ${rel} (browser-only: ${err.message.split('\n')[0]})`);
    } else {
      failures++;
      console.error(`FAIL  ${rel}\n      ${err.message.split('\n').slice(0, 3).join('\n      ')}`);
    }
  }
}
if (failures) process.exit(1);
console.log('module check done');
