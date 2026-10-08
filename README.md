# Newey

A modular dashboard for every new browser tab — a small, private take on
[MagicMirror²](https://magicmirror.builders) that lives entirely inside a
Chrome extension.

![Newey dashboard layout](icon128.png)

Open a new tab and you get a full-screen dashboard: a background photo, live
widgets, and an info line about the image. Every piece is a *module* you can
add, configure, move, resize, swap out, or remove — your layout is remembered
per browser profile.

## Features

- **Modular architecture** — the dashboard is assembled from standalone,
  self-describing modules (widgets + background providers) loaded through a
  registry.
- **Widgets included**
  - *Digital clock* — time, date, 12/24 h, seconds, centered or left
    alignment, several sizes/formats.
  - *Weather* — current conditions and hourly outlook (12 or 24 h labels)
    from
    [api.met.no](https://api.met.no) for a searched city or, with the
    "Use my current location" option, the browser's geolocation; shows wind,
    humidity, precipitation and day/night icons.
- **Background providers included**
  - *PrettyEarth* — random satellite photo from the Google Earth View
    gallery via the standalone [prettyearth.js](prettyearth.js) module,
    with an optional country filter. The display name is the photo's place
    (geocoded locality + country when the data has it, otherwise region +
    country), and the link opens that spot in Google Earth with the camera
    distance matched to the source zoom.
  - *Bing* — today's bing.com homepage image.
- **Image info** — the bottom-right corner shows the current background's
  title as a link, with the copyright/attribution on its own line beneath.
- **Theme awareness** — Newey measures the background brightness and flips
  between light and dark text automatically.
- **Zero build step** — plain ES modules, no bundler, no dependencies.

## Install (unpacked extension)

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** and select this folder
4. Open a new tab

To develop on plain `http://` or even `file://` (no background proxy —
network calls must be CORS-enabled, which all bundled providers are):

```powershell
# optional: run the static checks (imports every module)
node tools/check-modules.mjs
# regenerate the icon
node tools/make-icon.js
```

## Layout basics

- Add a widget via **Settings → Widgets → Add**.
- Drag a widget anywhere to move it (grid: 12 columns, snap on release).
- Cards automatically fit their height to the content, and placement uses
  that *rendered* height — a slim box can sit right above or below a taller
  one without being pushed away. Drag the grip in a widget's bottom-right
  corner to resize it (horizontal: width in columns, vertical: height in
  rows, which pins it), or hover a widget and use **Shift + mouse wheel**
  (add **Alt** for height, then **Ctrl** to return a card to auto-height).
- The weather widget's "Use my current location" uses the browser's
  geolocation. If the permission was dismissed, allow it via
  **chrome://extensions → Newey → Site settings → Location** and reopen the
  tab. While location is unavailable the widget falls back to its last known
  position and shows a note.
- Click a widget's gear icon to configure it, the ✕ to remove it.
- Background, provider options, and rotation interval live under
  **Settings → Background**.

## Architecture

```
manifest.json            extension manifest (MV3)
newtab.html              page shell
prettyearth.js           standalone 3rd-party module (repo root)
js/
  main.js                boot: defaults → storage → registry → managers
  module-api.js          BaseWidget, BaseBackgroundProvider, define*()
  modules.js             registry & loader (primers keep it modular)
  storage.js             persisted sections over chrome.storage.local
  grid.js                12-column layout, first-fit packing, drag/resize math
  widgets.js             instance manager (create/start/stop, config apply)
  interaction.js         pointer drag & resize behaviour
  background.js          two-layer cross-fade, image info, brightness theme
  settings.js            settings panel + schema-driven forms
  utils.js               fetch proxy helper, cache, DOM helpers
  bg-proxy.js            MV3 service worker: whitelisted fetch proxy
backgrounds/
  prettyearth-provider.js  adapter: wires prettyearth.js into the provider API
  bing-provider.js         adapter for bing.com's daily image
widgets/
  clock.js               digital clock widget
  weather.js             met.no weather widget
css/dashboard.css        dashboard theme
tools/                   import check + icon generator (Node)
```

### Writing a widget module

A widget is one ES module that subclasses `BaseWidget` and describes itself
with static metadata plus a declarative `configSchema`:

```js
import { BaseWidget, defineWidget } from '../js/module-api.js';

class HelloWidget extends BaseWidget {
  static id = 'example.hello';
  static name = 'Hello';
  static description = 'Says hello.';
  static defaultWidth = 3;
  static defaultHeight = 2;
  static defaultConfig = { name: 'world' };
  static configSchema = [
    { key: 'name', label: 'Your name', type: 'text' },
  ];

  async start() {
    this.setBody(`<h1>Hello ${this.config.name}</h1>`);
  }
}

export default defineWidget(HelloWidget);
```

Register it in [js/modules.js](js/modules.js) (or call
`registry.registerModulePrimer()` from anywhere):

```js
import helloWidget from '../widgets/hello.js';
const BUILTIN_PRIMERS = [async () => clockModule, /* … */,
                         async () => helloWidget];
```

The life-cycle is:

| method | when it runs |
|---|---|
| `start()` | when the instance is created (fetch data, start timers) |
| `onRender()` | when its card is (re)mounted; fill `this.body` |
| `onConfigUpdate(cfg)` | after the user saves settings in the panel |
| `stop()` | before removal; timers from `this.every()` are cleared automatically |

Helpers on every instance: `this.body`, `this.container`, `this.config`,
`this.every(fn, ms)`, `this.sleep(ms)`, `this.setBody(html)`.

### Writing a background provider

Same pattern with `BaseBackgroundProvider`:

```js
import { BaseBackgroundProvider, defineBackground } from '../js/module-api.js';

class MyProvider extends BaseBackgroundProvider {
  static id = 'example.mine';
  static name = 'Mine';
  static configSchema = [{ key: 'q', label: 'Query', type: 'text' }];

  async getBackground() {
    return { image: 'https://…/photo.jpg',  // URL or data URI
             title: 'A photo', link: 'https://…',
             author: 'Someone', source: 'Mine' };
  }
}
export default defineBackground(MyProvider);
```

The manager cross-fades between layers, writes the info line, snapshots the
image for the next tab, and schedules rotation per the user's interval.

### Network & privacy

All network access happens through a small allow-list:

- page code calls `proxiedFetch()` from [js/utils.js](js/utils.js)
- in the packaged extension the request goes through the
  [js/bg-proxy.js](js/bg-proxy.js) service worker, which fetches only the
  origins whitelisted in [manifest.json](manifest.json) `host_permissions`
  and caches responses for 10 minutes
- outside the extension (dev servers) plain `fetch()` is used

met.no requires a self-identifying `User-Agent` and geocoding uses the free
[Open-Meteo geocoder](https://open-meteo.com/en/docs/geocoding-api); neither
needs an API key and nothing is sent anywhere else.

## Defaults & reset

A fresh dashboard gets a clock and weather widget plus PrettyEarth
backgrounds rotating every 30 minutes. **Settings → Maintenance → Reset**
restores that layout.

## Licence

Provided as-is for personal use. Background photos belong to their
respective authors and are shown with attribution; see the info line in the
bottom-right corner of a running dashboard.
