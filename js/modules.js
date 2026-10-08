/**
 * Newey — module registry & loader.
 *
 * The registry knows every module available to the dashboard. Built-ins are
 * imported statically (bundled with the extension). Additional drop-in
 * modules can be registered with registerModulePrimer() without touching
 * the core.
 */

import { BaseWidget, BaseBackgroundProvider, ModuleError } from './module-api.js';
import clockModule from '../widgets/clock.js';
import weatherModule from '../widgets/weather.js';
import prettyearthProvider from '../backgrounds/prettyearth-provider.js';
import bingProvider from '../backgrounds/bing-provider.js';

const BUILTIN_PRIMERS = [
  async () => clockModule,
  async () => weatherModule,
  async () => prettyearthProvider,
  async () => bingProvider,
];

export class ModuleRegistry {
  #modules = new Map();

  /**
   * Run module primers (async functions returning a module class) in
   * parallel. A broken primer logs an error and is skipped so it can never
   * take the whole dashboard down.
   */
  async importModules(primers) {
    const results = await Promise.allSettled(
      primers.map(async (primer) => {
        const moduleClass = await primer();
        this.registerModule(moduleClass);
      })
    );
    for (const res of results) {
      if (res.status === 'rejected') console.error('[Newey] failed to load module:', res.reason);
    }
  }

  loadBuiltins() {
    return this.importModules(BUILTIN_PRIMERS);
  }

  /** Register one module class. Kinds are inferred from the base class. */
  registerModule(cls) {
    if (!cls || typeof cls !== 'function') throw new ModuleError('module must be a class');
    if (!cls.id) throw new ModuleError('a module needs a static "id"');
    if (!cls.name) throw new ModuleError(`module "${cls.id}" needs a static "name"`);
    cls.kind = cls.prototype instanceof BaseWidget
      ? 'widget'
      : cls.prototype instanceof BaseBackgroundProvider ? 'background' : null;
    if (!cls.kind) {
      throw new ModuleError(`module "${cls.id}" must extend BaseWidget or BaseBackgroundProvider`);
    }
    this.#modules.set(cls.id, cls);
  }

  get(id) {
    return this.#modules.get(id);
  }

  list(type) {
    return [...this.#modules.values()].filter((m) => (type ? m.kind === type : true));
  }

  /**
   * Add a new module at runtime. A primer is any async function returning a
   * module class, e.g.:
   *
   *   registry.registerModulePrimer(async () => (await import('../modules/my-thing.js')).default);
   */
  async registerModulePrimer(primer) {
    await this.importModules([primer]);
  }
}
