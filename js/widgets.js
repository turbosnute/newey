/**
 * Newey — widget manager.
 *
 * Owns the live widget instances: creating them when the grid needs a card,
 * mounting their DOM, syncing them with the persisted layout, and tearing
 * them down when a layout record disappears.
 */

import { el, deepMerge } from './utils.js';
import { makeInteractive } from './interaction.js';

export class WidgetManager {
  constructor({ registry, layoutSection, grid, onConfigure }) {
    this.registry = registry;
    this.section = layoutSection;
    this.grid = grid;
    this.onConfigure = onConfigure;
    this.instances = new Map(); // widget id -> { instance, item }
    this.sync = this.sync.bind(this);
  }

  get layout() {
    return this.section.value ?? { widgets: [] };
  }

  start() {
    // The grid asks for a card per layout record; building the card also
    // creates and starts the widget instance.
    this.grid.setCardFactory((item) => this.#buildCard(item));
    this.section.subscribe(this.sync);
  }

  /** Stop instances whose layout record disappeared. */
  sync() {
    const alive = new Set(this.layout.widgets.map((w) => w.id));
    for (const [id, rec] of [...this.instances]) {
      rec.item = this.layout.widgets.find((w) => w.id === id) ?? rec.item;
      if (!alive.has(id)) {
        this.instances.delete(id);
        try {
          rec.instance?.stop?.();
        } catch (err) {
          console.error('[Newey] widget stop failed:', err);
        }
      }
    }
  }

  #buildCard(item) {
    const moduleClass = this.registry.get(item.moduleId);

    const card = el('div', {
      class: 'widget',
      'data-id': item.id,
      'data-module': item.moduleId,
    });
    const body = el('div', { class: 'widget-body' });
    const toolbar = el('div', { class: 'widget-toolbar' });
    const grip = el('div', { class: 'widget-resize', title: 'Drag to resize' });

    if (moduleClass?.configSchema?.length) {
      toolbar.append(el('button', {
        class: 'widget-btn widget-btn--config',
        type: 'button',
        title: 'Configure',
        onclick: (e) => {
          e.stopPropagation();
          this.onConfigure?.(item.id);
        },
        html: ICONS.gear,
      }));
    }
    toolbar.append(el('button', {
      class: 'widget-btn widget-btn--remove',
      type: 'button',
      title: 'Remove',
      onclick: (e) => {
        e.stopPropagation();
        this.remove(item.id);
      },
      html: ICONS.close,
    }));

    card.append(toolbar, body, grip);

    if (!moduleClass) {
      body.innerHTML = `<div class="widget-error">Unknown module &quot;${escapeIt(item.moduleId)}&quot;</div>`;
      return card;
    }

    const instance = new moduleClass({
      id: item.id,
      config: deepMerge(moduleClass.defaultConfig ?? {}, item.config ?? {}),
    });
    instance.container = card;
    instance.body = body;
    this.instances.set(item.id, { instance, item });

    makeInteractive({
      card,
      getItem: () => this.instances.get(item.id)?.item ?? item,
      grid: this.grid,
      manager: this,
    });

    Promise.resolve()
      .then(() => instance.start())
      .then(() => instance.onRender?.())
      .catch((err) => {
        console.error(`[Newey] widget "${moduleClass.name}" failed:`, err);
        body.innerHTML = `<div class="widget-error">${escapeIt(moduleClass.name)} failed to start<br><small>${escapeIt(String(err?.message ?? err))}</small></div>`;
      });

    return card;
  }

  add(moduleId) {
    const moduleClass = this.registry.get(moduleId);
    if (!moduleClass || moduleClass.kind !== 'widget') return;
    return this.grid.addWidget({
      id: `${moduleId}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      moduleId,
      width: moduleClass.defaultWidth,
      height: moduleClass.defaultHeight,
      config: {},
    });
  }

  remove(id) {
    this.grid.removeWidget(id);
  }

  applyConfig(id, config) {
    const widget = this.layout.widgets.find((w) => w.id === id);
    if (!widget) return;
    const widgets = this.layout.widgets.map((w) =>
      w.id === id ? { ...w, config } : w
    );
    this.section.overwrite({ ...this.layout, widgets });

    const rec = this.instances.get(id);
    if (rec?.instance) {
      rec.instance.onConfigUpdate(config);
      rec.instance.onRender?.();
    }
  }
}

const ICONS = {
  gear:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zm8.3 3.4 1.6-1.3-1.5-2.5-2 .7a6.6 6.6 0 0 0-1.6-1l-.3-2.1h-2.9l-.3 2.1a6.6 6.6 0 0 0-1.6 1l-2-.7-1.5 2.5 1.6 1.3-1.6 1.3 1.5 2.5 2-.7a6.6 6.6 0 0 0 1.6 1l.3 2.1h2.9l.3-2.1a6.6 6.6 0 0 0 1.6-1l2 .7 1.5-2.5-1.6-1.3z" fill="currentColor"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>',
};

const escapeIt = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
