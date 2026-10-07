/**
 * Newey — layout & positioning.
 *
 * The dashboard is a 12-column grid (cell height fixed in px, rows grow
 * downwards). Each widget instance stores its own {x, y, w, h} cell
 * coordinates. GridLayout owns placement physics (first-fit packing,
 * collision bumping) and renders absolutely-positioned cards; the
 * WidgetManager supplies the card DOM via a factory.
 *
 * Pixel math for a cell rect (w columns wide, h rows tall):
 *   left   = x * (cellW + gap)
 *   top    = y * (cellH + gap)
 *   width  = w * cellW + (w - 1) * gap
 *   height = h * cellH + (h - 1) * gap   (only when the user pinned it —
 *           by default cards auto-size to their content, item.autoHeight)
 */

import { deepClone } from './utils.js';

export const MAX_COLUMNS = 12;

const clampW = (w) => Math.min(Math.max(1, Math.round(w ?? 2)), MAX_COLUMNS);

/**
 * First-fit packs boxes ({id, w, h, x?, y?}). Items with a stored position
 * that fits keep it; the rest are placed in the first free spot (top-left,
 * like MagicMirror regions). Returns a Map id -> {x, y}.
 */
export function packBoxes(items, { maxColumns = MAX_COLUMNS } = {}) {
  const used = [];
  const overlap = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const fits = (box) =>
    box.x >= 0 && box.y >= 0 &&
    box.x + box.w <= maxColumns &&
    !used.some((b) => overlap(box, b));

  for (const item of [...items].sort((a, b) => (a.y ?? 1e9) - (b.y ?? 1e9))) {
    const box = { id: item.id, x: item.x, y: item.y, w: clampW(item.w), h: item.h ?? 1 };
    if (Number.isFinite(box.x) && Number.isFinite(box.y) && fits(box)) used.push(box);
  }
  for (const item of items) {
    if (used.some((b) => b.id === item.id)) continue;
    const box = { id: item.id, w: clampW(item.w), h: item.h ?? 1 };
    for (let y = 0; ; y++) {
      let done = false;
      for (let x = 0; x + box.w <= maxColumns; x++) {
        if (fits({ ...box, x, y })) {
          used.push({ ...box, x, y });
          done = true;
          break;
        }
      }
      if (done) break;
    }
  }
  return new Map(used.map(({ id, x, y }) => [id, { x, y }]));
}

export class GridLayout {
  constructor({ layoutSection, gap = 20, padding = 40, cellHeight = 100 }) {
    this.section = layoutSection;
    this.gap = gap;
    this.padding = padding;
    this.cellHeight = cellHeight;
    this.root = null;
    this.cardFactory = null;
    this.cards = new Map(); // widget id -> card element
  }

  get layout() {
    return this.section.value ?? { widgets: [] };
  }

  /**
   * Height of a widget in grid rows, as far as placement physics is
   * concerned. Pinned cards use their row count; auto-fit cards only occupy
   * the rows their rendered content actually covers (a snug clock is one
   * row tall, not the two its record may still claim).
   */
  #effH(w) {
    if (w.autoHeight === false) return w.height ?? 1;
    const card = this.cards.get(w.id);
    const px = card ? card.offsetHeight : (w.height ?? 1) * this.cellHeight;
    return Math.max(1, Math.ceil(px / (this.cellHeight + this.gap)));
  }

  /** Public hook for interactions (Alt+Shift+wheel, grip drags). */
  effHeightUnits(id) {
    const w = this.layout.widgets.find((x) => x.id === id);
    return w ? this.#effH(w) : null;
  }

  attach(root) {
    this.root = root;
    root.classList.add('grid-root');
    this.section.subscribe(() => this.render());
    window.addEventListener('resize', () => this.render());
    this.render();
  }

  get cellW() {
    const width = this.root ? this.root.clientWidth - this.padding * 2 : 1280 - this.padding * 2;
    return Math.max(1, width / MAX_COLUMNS);
  }

  setCardFactory(factory) {
    this.cardFactory = factory;
    this.render();
  }

  /**
   * Rebuilds positioned cards, reusing existing card elements so widget DOM
   * (timers, live content) survives re-renders. Cards for removed widgets
   * are dropped.
   */
  render() {
    if (!this.root || !this.cardFactory) return;
    const seen = new Set();

    for (const item of this.layout.widgets) {
      const pos = item.position ?? { x: 0, y: 0 };
      seen.add(item.id);

      let card = this.cards.get(item.id);
      if (!card) {
        card = this.cardFactory(item);
        this.cards.set(item.id, card);
        this.root.appendChild(card);
      }
      card.style.left = `${pos.x * (this.cellW + this.gap) + this.padding}px`;
      card.style.top = `${pos.y * (this.cellHeight + this.gap) + this.padding}px`;
      card.style.width = `${item.width * this.cellW + (item.width - 1) * this.gap}px`;
      // Auto-height cards hug their content; only a pinned height maps the
      // stored row count to pixels.
      if (item.autoHeight === false) {
        const h = item.height ?? 1;
        card.style.height = `${h * this.cellHeight + (h - 1) * this.gap}px`;
      } else {
        card.style.height = 'auto';
      }
    }

    for (const [id, card] of [...this.cards]) {
      if (!seen.has(id)) {
        card.remove();
        this.cards.delete(id);
      }
    }
  }

  /** Point in client coords -> closest grid cell (unclamped). */
  cellFromPoint(clientX, clientY) {
    const rect = this.root.getBoundingClientRect();
    return {
      x: Math.round((clientX - rect.left - this.padding) / (this.cellW + this.gap)),
      y: Math.max(0, Math.round((clientY - rect.top - this.padding) / (this.cellHeight + this.gap))),
    };
  }

  /** Raw pixel preview of a card being dragged. */
  previewDrag(id, leftPx, topPx) {
    const card = this.cards.get(id);
    if (!card) return;
    card.style.left = `${leftPx}px`;
    card.style.top = `${topPx}px`;
  }

  /**
   * After a move/resize, any widget overlapping the target loses its stored
   * position and is repacked into the first free spot.
   */
  #bumpOverlaps(widgets, targetId) {
    const target = widgets.find((w) => w.id === targetId);
    if (!target) return;
    const th = this.#effH(target);
    let changed = false;
    for (const w of widgets) {
      if (w === target) continue;
      const wh = this.#effH(w);
      const overlaps =
        w.position.x < target.position.x + target.width &&
        w.position.x + w.width > target.position.x &&
        w.position.y < target.position.y + th &&
        w.position.y + wh > target.position.y;
      if (overlaps) {
        w.position = { x: undefined, y: undefined }; // forces re-pack
        changed = true;
      }
    }
    if (!changed) return;
    const packed = packBoxes(widgets.map((w) => ({
      id: w.id, x: w.position.x, y: w.position.y, w: w.width, h: this.#effH(w),
    })));
    for (const w of widgets) w.position = packed.get(w.id) ?? w.position;
  }

  /**
   * Commit a move: clamp into the grid, then bump overlapping widgets out of
   * the way.
   */
  moveWidget(id, x, y, { commit = true } = {}) {
    const widgets = deepClone(this.layout.widgets);
    const target = widgets.find((w) => w.id === id);
    if (!target) return null;

    target.position.x = Math.min(Math.max(0, x), MAX_COLUMNS - clampW(target.width));
    target.position.y = Math.max(0, y);
    this.#bumpOverlaps(widgets, id);

    if (commit) this.section.overwrite({ ...this.layout, widgets });
    return target.position;
  }

  /**
   * Grow/shrink a widget by `delta` columns. Vertical width-changes pin the
   * height (autoHeight = false); explicit height changes come through
   * resizeWidgetHeight.
   */
  resizeWidget(id, delta, { commit = true } = {}) {
    const widgets = deepClone(this.layout.widgets);
    const target = widgets.find((w) => w.id === id);
    if (!target) return;
    target.width = clampW(target.width + delta);
    this.#bumpOverlaps(widgets, id);
    if (commit) this.section.overwrite({ ...this.layout, widgets });
  }

  /** Set a widget's height in rows and stop auto-sizing it. */
  resizeWidgetHeight(id, h, { commit = true } = {}) {
    const widgets = deepClone(this.layout.widgets);
    const target = widgets.find((w) => w.id === id);
    if (!target) return;
    target.height = Math.max(1, Math.min(8, Math.round(h)));
    // never pin a card smaller than its rendered content
    const card = this.cards.get(id);
    if (card) {
      const contentPx = card.scrollHeight;
      while (
        target.height < 8 &&
        target.height * this.cellHeight + (target.height - 1) * this.gap < contentPx
      ) target.height += 1;
      if (
        target.height * this.cellHeight + (target.height - 1) * this.gap < contentPx
      ) return; // not satisfiable — keep current state
    }
    target.autoHeight = false;
    this.#bumpOverlaps(widgets, id);
    if (commit) this.section.overwrite({ ...this.layout, widgets });
  }

  /** Return a widget to content-snug auto sizing. */
  setAutoHeight(id, { commit = true } = {}) {
    const widgets = deepClone(this.layout.widgets);
    const target = widgets.find((w) => w.id === id);
    if (!target || target.autoHeight !== false) return;
    target.autoHeight = true;
    if (commit) this.section.overwrite({ ...this.layout, widgets });
  }

  /** Add a widget record at the first free spot. Returns the stored record. */
  addWidget(record, { commit = true } = {}) {
    const widgets = deepClone(this.layout.widgets);
    const packed = packBoxes([
      // existing widgets: their effective (rendered) row usage
      ...widgets.map((w) => ({ id: w.id, x: w.position?.x, y: w.position?.y, w: w.width, h: this.#effH(w) })),
      // the new one has no DOM yet — its declared default rows is the guess
      { id: record.id, w: record.width, h: record.height },
    ]);
    const position = packed.get(record.id);
    const entry = { ...record, position };
    widgets.push(entry);
    if (commit) this.section.overwrite({ ...this.layout, widgets });
    return entry;
  }

  removeWidget(id, { commit = true } = {}) {
    const widgets = this.layout.widgets.filter((w) => w.id !== id);
    if (commit) this.section.overwrite({ ...this.layout, widgets });
  }
}
