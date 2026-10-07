/**
 * Newey — settings panel.
 *
 * A slide-in panel with three groups:
 *   - Widgets: list of available widget types with an Add button
 *   - Background: provider picker + provider config + rotation interval
 *   - Maintenance: reset dashboard
 *
 * Per-widget options are edited in a small modal, built generically from the
 * module's static configSchema (so new widgets get a working settings UI for
 * free).
 */

import { el, debounce } from './utils.js';

const ROTATE_OPTIONS = [0, 10, 30, 60];

export class SettingsPanel {
  constructor({ registry, settingsSection, widgetManager, layoutSection, defaults }) {
    this.registry = registry;
    this.settings = settingsSection;
    this.layout = layoutSection;
    this.manager = widgetManager;
    this.defaults = defaults;

    this.root = el('aside', { id: 'settings-panel', 'aria-label': 'Dashboard settings' });
    document.body.appendChild(this.root);
    this.settings.subscribe(() => this.#render());

    this.modal = el('aside', { id: 'widget-config-modal', 'aria-label': 'Widget settings', hidden: true });
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.closeModal();
    });
    document.body.appendChild(this.modal);
  }

  start() {
    this.#render();
  }

  get visible() {
    return this.root.classList.contains('open');
  }

  toggle() {
    this.root.classList.toggle('open');
    this.#render();
  }

  closeModal() {
    this.modal.hidden = true;
    this.modal.innerHTML = '';
  }

  openWidgetConfig(id) {
    const item = this.layout.value.widgets.find((w) => w.id === id);
    const moduleClass = item && this.registry.get(item.moduleId);
    if (!moduleClass) return;

    const form = this.#buildForm({
      schema: moduleClass.configSchema ?? [],
      values: { ...(moduleClass.defaultConfig ?? {}), ...(item.config ?? {}) },
      onSubmit: (config) => {
        this.manager.applyConfig(id, config);
        this.closeModal();
      },
    });

    const card = el('form', { class: 'modal-card' }, [
      el('h3', { class: 'settings-subtitle', text: `${moduleClass.name} settings` }),
      form,
      el('div', { class: 'form-actions' }, [
        el('button', { type: 'button', class: 'btn btn--ghost', text: 'Cancel', onclick: () => this.closeModal() }),
        el('button', { type: 'submit', class: 'btn btn--primary', form: form.id, text: 'Save' }),
      ]),
    ]);

    this.modal.innerHTML = '';
    this.modal.append(card);
    this.modal.hidden = false;
  }

  #render() {
    const open = this.visible;
    this.root.innerHTML = '';
    this.root.append(
      el('h2', { class: 'settings-title', text: 'Dashboard settings' }),
      this.#renderWidgets(),
      this.#renderBackground(),
      this.#renderMaintenance(),
      el('button', {
        class: 'settings-close',
        type: 'button',
        title: 'Close settings',
        'aria-label': 'Close settings',
        onclick: () => this.toggle(),
        html: CLOSE_ICON,
      })
    );
    this.root.classList.toggle('open', open);
  }

  #renderWidgets() {
    const box = el('section', { class: 'settings-group' }, el('h3', { class: 'settings-subtitle', text: 'Widgets' }));
    for (const mod of this.registry.list('widget')) {
      box.append(el('div', { class: 'widget-type' }, [
        el('div', { class: 'widget-type__info' }, [
          el('strong', { text: mod.name }),
          el('small', { text: mod.description ?? '' }),
        ]),
        el('button', {
          class: 'btn btn--ghost',
          type: 'button',
          text: 'Add',
          onclick: () => this.manager.add(mod.id),
        }),
      ]));
    }
    const hint = el('p', {
      class: 'settings-hint',
      text: 'Drag a widget to move it. Drag its bottom-right grip to resize.',
    });
    box.append(hint);
    return box;
  }

  #renderBackground() {
    const box = el('section', { class: 'settings-group' }, el('h3', { class: 'settings-subtitle', text: 'Background' }));
    const current = this.settings.value ?? {};

    const providerPick = el('select', { class: 'input', 'aria-label': 'Background provider' });
    for (const mod of this.registry.list('background')) {
      providerPick.append(el('option', { value: mod.id, text: `${mod.name} — ${mod.description ?? ''}` }));
    }
    providerPick.value = current.backgroundId ?? this.defaults.backgroundId;
    providerPick.addEventListener('change', () => this.settings.update({ backgroundId: providerPick.value }));

    const rotatePick = el('select', { class: 'input', 'aria-label': 'Rotate background' });
    for (const mins of ROTATE_OPTIONS) {
      rotatePick.append(el('option', {
        value: String(mins),
        text: mins === 0 ? 'Never' : `Every ${mins} min`,
      }));
    }
    rotatePick.value = String(current.rotateMinutes ?? this.defaults.rotateMinutes);
    rotatePick.addEventListener('change', () => this.settings.update({ rotateMinutes: Number(rotatePick.value) }));

    box.append(
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Provider' }), providerPick]),
      el('label', { class: 'field' }, [el('span', { class: 'field__label', text: 'Rotate image' }), rotatePick])
    );

    const activeProvider = this.registry.get(current.backgroundId ?? this.defaults.backgroundId);
    const providerConfig = current.backgroundConfigs?.[activeProvider?.id] ?? {};
    if (activeProvider?.configSchema?.length) {
      const form = this.#buildForm({
        schema: activeProvider.configSchema,
        values: { ...(activeProvider.defaultConfig ?? {}), ...providerConfig },
        live: true,
        onSubmit: (config) => {
          this.settings.update({
            backgroundConfigs: { [activeProvider.id]: config },
          });
        },
      });
      box.append(el('div', { class: 'settings-subform' }, form));
    }
    return box;
  }

  #renderMaintenance() {
    return el('section', { class: 'settings-group' }, el('h3', { class: 'settings-subtitle', text: 'Maintenance' }), el('button', {
      class: 'btn btn--ghost',
      type: 'button',
      text: 'Reset dashboard layout',
      onclick: () => {
        if (!confirm('Remove all widgets and restore the default dashboard?')) return;
        this.layout.overwrite(JSON.parse(JSON.stringify(this.defaults.layout)));
        this.#render();
      },
    }));
  }

  #collect = null;

  /**
   * Generic schema-driven form. Fields:
   *   { key, label, type: 'text'|'search'|'checkbox'|'select', options?, suggest?, help? }
   * `suggest(query)` returns [{label, value, extra?}] for type 'search'.
   * `live: true` re-renders previews as inputs change (used for background).
   */
  #buildForm({ schema, values, live = false, onSubmit }) {
    const formId = `f${Math.random().toString(36).slice(2)}`;
    const form = el('form', { id: formId, class: 'form' });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      onSubmit(this.#collect());
    });

    const submitLive = live
      ? debounce(() => onSubmit(this.#collect()), 350)
      : null;

    const state = {};
    const inputs = {};

    for (const field of schema) {
      const value = values[field.key];
      let input;

      if (field.type === 'checkbox') {
        input = el('input', { type: 'checkbox' });
        input.checked = !!value;
      } else if (field.type === 'select') {
        input = el('select', { class: 'input' });
        for (const opt of field.options) {
          input.append(el('option', { value: String(opt.value), text: opt.label }));
        }
        input.value = value === undefined ? String(field.options[0]?.value ?? '') : String(value);
      } else if (field.type === 'search') {
        input = el('input', { type: 'search', class: 'input', placeholder: field.placeholder ?? 'Search…', list: `${formId}-${field.key}` });
        input.value = value ?? '';
        const datalist = el('datalist', { id: `${formId}-${field.key}` });
        form.append(datalist);
        if (field.suggest) {
          const run = debounce(async () => {
            const q = input.value.trim();
            if (q.length < 2) return;
            try {
              const results = await field.suggest(q);
              state[field.key] = results; // remember for extra() lookup
              datalist.innerHTML = '';
              for (const r of results) {
                datalist.append(el('option', { value: r.value, label: r.label }));
              }
              submitLive?.();
            } catch { /* suggestions are best-effort */ }
          }, 250);
          input.addEventListener('input', run);
        }
      } else {
        input = el('input', { type: field.type ?? 'text', class: 'input' });
        input.value = value ?? '';
      }

      if (live) input.addEventListener('change', () => submitLive?.());

      inputs[field.key] = { field, input };
      // Checkbox rows sit inline with their label (help text below); other
      // fields keep the label-above-input stack.
      const check = field.type === 'checkbox';
      const label = el('label', { class: `field${check ? ' field--check' : ''}` });
      if (check) {
        label.append(input, el('span', { class: 'field__label', text: field.label }));
      } else {
        label.append(el('span', { class: 'field__label', text: field.label }), input);
      }
      if (field.help) label.append(el('small', { class: 'field__help', text: field.help }));
      form.append(label);
    }

    this.#collect = () => {
      const out = {};
      const extras = {};
      for (const [key, { field, input }] of Object.entries(inputs)) {
        if (field.type === 'checkbox') {
          out[key] = input.checked;
        } else if (field.type === 'select') {
          out[key] = input.value;
        } else if (field.type === 'search' && Array.isArray(state[key])) {
          out[key] = input.value;
          const chosen = state[key].find((r) => r.value === input.value);
          if (chosen?.extra) Object.assign(extras, chosen.extra);
        } else {
          out[key] = input.value;
        }
      }
      return { ...out, ...extras };
    };

    return form;
  }
}

const CLOSE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none"/></svg>';
