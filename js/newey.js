/**
 * Newey — dashboard core.
 *
 * Boot order:
 *   1. defaults are declared here (only place that knows what a fresh
 *      dashboard looks like)
 *   2. settings sections load from storage and merge over defaults
 *   3. module registry imports all built-in modules
 *   4. background manager starts using the active provider
 *   5. grid + widget manager bring the layout to life
 *   6. settings panel + toolbar open last
 */

import { Section } from './storage.js';
import { ModuleRegistry } from './modules.js';
import { GridLayout, packBoxes, MAX_COLUMNS } from './grid.js';
import { BackgroundManager } from './background.js';
import { WidgetManager } from './widgets.js';
import { SettingsPanel } from './settings.js';
import { el, deepClone } from './utils.js';

const widgetId = (moduleId, tag) => `${moduleId}.${tag}`;

/** What a brand-new dashboard looks like. */
const DEFAULTS = {
  layout: {
    widgets: [
      { id: widgetId('newey.widget.clock', 'main'), moduleId: 'newey.widget.clock', width: 4, height: 2, autoHeight: true, config: {}, position: { x: 0, y: 0 } },
      { id: widgetId('newey.widget.weather', 'home'), moduleId: 'newey.widget.weather', width: 4, height: 3, autoHeight: true, config: {}, position: { x: 4, y: 0 } },
    ],
  },
  settings: {
    backgroundId: 'newey.background.prettyearth',
    rotateMinutes: 30,
    backgroundConfigs: {},
  },
};

function layoutUpdateStrategy(defaults, stored) {
  if (!stored || !Array.isArray(stored.widgets)) return defaults;
  const widgets = [];
  const packed = packBoxes(stored.widgets.map((w) => ({
    id: w.id, x: w.position?.x, y: w.position?.y, w: w.width, h: w.height,
  })));
  for (const w of stored.widgets) {
    widgets.push({
      ...w,
      width: Math.min(Math.max(1, Math.round(w.width ?? 2)), MAX_COLUMNS),
      // height stays fractional: auto cards occupy a fractional number of
      // rows and reload must reproduce the pixel-true live layout
      height: Number.isFinite(w.height) ? Math.max(0.1, w.height) : 2,
      autoHeight: w.autoHeight ?? true,
      position: packed.get(w.id) ?? { x: 0, y: 0 },
      config: w.config ?? {},
    });
  }
  return { widgets };
}

async function main() {
  // 2 — persisted sections over default state
  const layoutSection = new Section({ key: 'layout', defaults: deepClone(DEFAULTS.layout), updateStrategy: layoutUpdateStrategy });
  const settingsSection = new Section({ key: 'settings', defaults: deepClone(DEFAULTS.settings) });
  await Promise.all([layoutSection.load(), settingsSection.load()]);

  // 3 — import every module
  const registry = new ModuleRegistry();
  await registry.loadBuiltins();

  // 4 — background

  // 5 — layout
  const grid = new GridLayout({ layoutSection });
  grid.attach(document.getElementById('dashboard'));

  const manager = new WidgetManager({
    registry,
    layoutSection,
    grid,
    onConfigure: (id) => settingsPanel.openWidgetConfig(id),
  });

  let settingsPanel; // forward-declared for the callback above
  settingsPanel = new SettingsPanel({
    registry,
    settingsSection,
    layoutSection,
    widgetManager: manager,
    defaults: {
      backgroundId: DEFAULTS.settings.backgroundId,
      rotateMinutes: DEFAULTS.settings.rotateMinutes,
      layout: DEFAULTS.layout,
    },
  });

  manager.start();
  settingsPanel.start();

  // Widgets may persist their own config (e.g. the Notes editor): they
  // dispatch `newey:widget-config` on their card and it is routed to the
  // widget manager like a settings-panel save.
  document.getElementById('dashboard').addEventListener('newey:widget-config', (e) => {
    const { id, config } = e.detail ?? {};
    if (id && config) manager.applyConfig(id, config);
  });

  const background = new BackgroundManager({ registry, settingsSection });
  await background.start();

  // 6 — toolbar (settings open, refresh background)
  const toolbar = el('div', { id: 'toolbar' }, [
    el('button', {
      class: 'toolbar-btn',
      type: 'button',
      title: 'Refresh background',
      'aria-label': 'Refresh background',
      onclick: () => document.getElementById('background')?.dispatchEvent(new CustomEvent('newey:refresh-background')),
      html: REFRESH_ICON,
    }),
    el('button', {
      class: 'toolbar-btn',
      type: 'button',
      title: 'Settings',
      'aria-label': 'Open dashboard settings',
      onclick: () => settingsPanel.toggle(),
      html: SETTINGS_ICON,
    }),
  ]);
  document.body.appendChild(toolbar);
}

const REFRESH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M20 3v4h-4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SETTINGS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8zm8.3 3.4 1.6-1.3-1.5-2.5-2 .7a6.6 6.6 0 0 0-1.6-1l-.3-2.1h-2.9l-.3 2.1a6.6 6.6 0 0 0-1.6 1l-2-.7-1.5 2.5 1.6 1.3-1.6 1.3 1.5 2.5 2-.7a6.6 6.6 0 0 0 1.6 1l.3 2.1h2.9l.3-2.1a6.6 6.6 0 0 0 1.6-1l2 .7 1.5-2.5-1.6-1.3z" fill="currentColor"/></svg>';

main().catch((err) => {
  console.error('[Newey] fatal boot error:', err);
  if (typeof document !== 'undefined' && document.body) {
    document.body.innerHTML = `<div class="boot-error">Newey failed to start<br><small>${String(err?.message ?? err)}</small></div>`;
  }
});
