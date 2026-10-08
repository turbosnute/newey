/**
 * Newey — module API.
 *
 * The dashboard is built from small standalone building blocks ("modules")
 * in two flavours:
 *
 *   Widget            — a positioned card on the dashboard showing live data
 *                       (clock, weather, …). Described by one ES-module file:
 *                       a subclass of BaseWidget plus `defineWidget()` metadata.
 *                       A widget type can be added many times.
 *
 *   BackgroundProvider — fetches a background image (PrettyEarth, Bing, …).
 *                       Described the same way with `defineBackground()`.
 *                       Only one is active, but they are freely swappable.
 *
 * Module files stay inert until the core imports them, so the architecture
 * keeps drop-in modules from running uncontrolled top-level code.
 */

/** Per-instance base functionality shared by all widgets. */
export class BaseWidget {
  static id = 'newey.widget.base';
  static name = 'Base widget';
  static description = 'Base class for widgets';
  static defaultWidth = 3;
  static defaultHeight = 2;
  static defaultConfig = {};
  /** Declarative settings UI: [{key, label, type, options?, help?}] */
  static configSchema = [];

  /**
   * @param {{id?:string, config?:object, width?:number, position?:object}} props
   */
  constructor({ id, config = {}, width, position } = {}) {
    this.id = id || this.generateId();
    this.config = config;
    this.width = Number.isFinite(width) ? width : this.constructor.defaultWidth;
    this.position = position || {};
    this.container = null; // DOM root, managed by core
    this.body = null;      // ready-to-fill content element
    this._timers = [];
  }

  /** URL-safe, unique, persistable instance id. */
  generateId() {
    return `${this.constructor.id.replace(/[^a-z0-9-]/gi, '')}_${Date.now().toString(36)}${Math
      .random()
      .toString(36)
      .slice(2, 8)}`;
  }

  /** Timers registered here are cleaned up automatically by core on stop(). */
  every(cb, ms) {
    const t = setInterval(cb, ms);
    this._timers.push(t);
    return t;
  }

  sleep(ms) {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this._timers.push(t);
    });
  }

  setBody(html) {
    if (this.body) this.body.innerHTML = html;
  }

  /** Called once when the widget instance enters the dashboard. */
  async start() {}

  /** Called once the DOM node exists; fill this.body. */
  onRender() {}

  /** Called before the instance is removed/reloaded. */
  async stop() {
    this._timers.forEach((t) => {
      clearInterval(t);
      clearTimeout(t);
    });
    this._timers = [];
  }

  /** Called whenever the user changes this instance's config. */
  onConfigUpdate(newConfig) {
    this.config = newConfig;
  }
}

/**
 * Base class for background providers. Implementations override getBackground()
 * and the static metadata; element attach/rotation is handled by core.
 */
export class BaseBackgroundProvider {
  static id = 'newey.background.base';
  static name = 'Base background provider';
  static description = 'Base class for background providers';
  static hasConfig = false;
  static defaultConfig = {};
  /** Declarative settings UI: [{key, label, type, options?, help?}] */
  static configSchema = [];

  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Fetch a background image. Return null to keep the current background
   * (e.g. a filtered search found nothing this round).
   * @returns {Promise<null|{image: string, title: string, link: string,
   *                     author?: string, source?: string}>|void>}
   *   image: URL or data-URI usable as a CSS background.
   *   title: display name of the image (shown as a link).
   *   author: copyright/attribution, rendered on its own line beneath the title.
   */
  async getBackground() {
    throw new Error('Provider must implement getBackground()');
  }
}

/**
 * Attach display metadata to a module class. Module files do:
 *
 *   export default defineWidget(MyWidget, { id, name, description,
 *                                            defaultWidth, defaultConfig });
 *
 * Metadata lives on the class itself so the dashboard can list/launch module
 * types without instantiating them.
 */
export function defineWidget(cls, meta) {
  Object.assign(cls, meta);
  if (!cls.id) throw new Error('defineWidget: metadata must include a unique "id"');
  return cls;
}

/** Same as defineWidget but for background providers. */
export function defineBackground(cls, meta) {
  Object.assign(cls, meta);
  if (!cls.id) throw new Error('defineBackground: metadata must include a unique "id"');
  return cls;
}

/**
 * Custom error type so the core can tell "this module is known but badly
 * described" from transient network errors.
 */
export class ModuleError extends Error {}
