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
 *
 * Columns are whole cells, but vertical placement is pixel-true: a card's
 * stored y is a fractional row and an auto-fit card only occupies
 * h = (rendered px + gap) / (cellH + gap) rows. A card released flush under
 * a neighbour therefore lands exactly `gap` px below it instead of being
 * forced down to the next whole row.
 */

import { deepClone } from './utils.js';

export const MAX_COLUMNS = 12;

const clampW = (w) => Math.min(Math.max(1, Math.round(w ?? 2)), MAX_COLUMNS);

/** Release points within this distance (rows) of a snug spot snap to it. */
const SNAP_TOLERANCE = 0.6;

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
    // Candidate tops: the grid origin and the bottom edge of every placed
    // box — including fractional bottoms, so snug gaps get used too.
    const tops = [0, ...used.map((b) => b.y + b.h)].sort((a, b) => a - b);
    let done = false;
    for (const y of tops) {
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
  /** Watches cards so content growth re-settles the cards below them. */
  #cardObserver = null;
  #gravityFrame = null;

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
    if (w.autoHeight === false) return Math.max(1, w.height ?? 1);
    // Pixel-true: an auto-fit card only occupies (px + gap) rows of pitch,
    // so a card released flush under it lands exactly one gap below instead
    // of being forced to the next whole row.
    const card = this.cards.get(w.id);
    if (!card) return Math.max(0.1, w.height ?? 1);
    return Math.max(0.1, (card.offsetHeight + this.gap) / (this.cellHeight + this.gap));
  }

  /** Public hook for interactions (Alt+Shift+wheel, grip drags): whole rows. */
  effHeightUnits(id) {
    const w = this.layout.widgets.find((x) => x.id === id);
    return w ? Math.max(1, Math.ceil(this.#effH(w))) : null;
  }

  attach(root) {
    this.root = root;
    root.classList.add('grid-root');
    this.section.subscribe(() => this.render());
    window.addEventListener('resize', () => this.render());
    this.#cardObserver = new ResizeObserver(() => this.#settleContent());
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
      this.#cardObserver?.observe(card);
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
        this.#cardObserver?.unobserve(card);
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
   * Resolve overlaps with gravity: cards only ever move straight DOWN in
   * their own columns — nothing is teleported to a first-fit slot. For each
   * pair that overlaps both horizontally and vertically, the upper card
   * keeps its spot and the lower one slides flush below it (ties keep the
   * earlier list entry). Needs at most a couple of sweeps because a card
   * can only be pushed further down, never up.
   * Mutates the given widget records in place.
   */
  #settle(widgets) {
    let guard = 0;
    let moved = true;
    while (moved && guard++ < 50) {
      moved = false;
      const order = [...widgets].sort(
        (a, b) => a.position.y - b.position.y || widgets.indexOf(a) - widgets.indexOf(b)
      );
      for (let i = 0; i < order.length; i++) {
        const a = order[i];
        let pushTo = a.position.y;
        for (let j = 0; j < i; j++) {
          const b = order[j];
          if (b.position.x >= a.position.x + a.width ||
              b.position.x + b.width <= a.position.x) continue;
          pushTo = Math.max(pushTo, b.position.y + this.#effH(b));
        }
        if (pushTo > a.position.y) { a.position.y = pushTo; moved = true; }
      }
    }
  }

  /**
   * Release magnet: columns quantise to whole cells, but vertical releases
   * are fractional. Flush-under / flush-over neighbours are preferred when
   * one is within SNAP_TOLERANCE of the release (so dropping a card "just
   * under" a neighbour always snugs, never rounds a full row away); the
   * whole-row line is the fallback that keeps the grid feel in open space.
   */
  #snapY(widgets, target) {
    const raw = target.position.y;
    const th = this.#effH(target);
    const xHits = (w) => w !== target &&
      w.position.x < target.position.x + target.width &&
      w.position.x + w.width > target.position.x;
    const overlapsAt = (yy) => widgets.some((w) => xHits(w) &&
      yy < w.position.y + this.#effH(w) && yy + th > w.position.y);
    const land = (c) => Math.abs(c - raw) <= SNAP_TOLERANCE && !overlapsAt(c);

    const flush = [];
    for (const w of widgets) {
      if (!xHits(w)) continue;
      flush.push(w.position.y + this.#effH(w)); // flush under
      const above = w.position.y - th; // flush over
      if (above >= 0) flush.push(above);
    }
    flush.sort((a, b) => Math.abs(a - raw) - Math.abs(b - raw));
    if (flush.length && Math.abs(flush[0] - raw) <= SNAP_TOLERANCE) {
      const snug = flush.find(land);
      if (snug !== undefined) return snug;
    }
    const row = Math.round(raw);
    if (Math.abs(row - raw) <= SNAP_TOLERANCE && !overlapsAt(row)) return row;
    return raw;
  }

  /**
   * Persist the given widget list, syncing each auto-fit card's fractional
   * rendered height into its record so a cold boot (no DOM yet) can pack the
   * same picture.
   */
  #commit(widgets) {
    for (const w of widgets) {
      if (w.autoHeight !== false && this.cards.has(w.id)) {
        w.height = this.#effH(w);
      }
    }
    this.section.overwrite({ ...this.layout, widgets });
  }

  /**
   * Batched (one per frame) re-settle when a rendered card changes size —
   * e.g. a Notes card growing while typing pushes the cards below it down.
   */
  #settleContent() {
    if (this.#gravityFrame) return;
    this.#gravityFrame = requestAnimationFrame(() => {
      this.#gravityFrame = null;
      if (document.querySelector('.widget--dragging, .widget--resizing')) return;
      const widgets = this.layout.widgets;
      if (!widgets.length) return;
      const snapshot = (list) => list.map((w) => `${w.id}:${w.position.y}:${w.height}`).join('|');
      const next = deepClone(widgets);
      this.#settle(next);
      if (snapshot(next) !== snapshot(widgets)) this.#commit(next);
    });
  }

  /**
   * Commit a move: clamp into the grid, magnet onto a snug landing if the
   * release was within tolerance of one, then push anything now overlapped
   * straight down. Whole-row drops stay whole-row in open space; drops near
   * a neighbour land pixel-flush against it instead of jumping a full row.
   */
  moveWidget(id, x, y, { commit = true } = {}) {
    const widgets = deepClone(this.layout.widgets);
    const target = widgets.find((w) => w.id === id);
    if (!target) return null;

    target.position.x = Math.min(Math.max(0, x), MAX_COLUMNS - clampW(target.width));
    target.position.y = Math.max(0, y);
    if (commit) target.position.y = this.#snapY(widgets, target);
    this.#settle(widgets);

    if (commit) this.#commit(widgets);
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
    this.#settle(widgets);
    if (commit) this.#commit(widgets);
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
    this.#settle(widgets);
    if (commit) this.#commit(widgets);
  }

  /** Return a widget to content-snug auto sizing. */
  setAutoHeight(id, { commit = true } = {}) {
    const widgets = deepClone(this.layout.widgets);
    const target = widgets.find((w) => w.id === id);
    if (!target || target.autoHeight !== false) return;
    target.autoHeight = true;
    this.#settle(widgets);
    if (commit) this.#commit(widgets);
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
    if (commit) this.#commit(widgets);
    return entry;
  }

  removeWidget(id, { commit = true } = {}) {
    const widgets = this.layout.widgets.filter((w) => w.id !== id);
    if (commit) this.section.overwrite({ ...this.layout, widgets });
  }
}
