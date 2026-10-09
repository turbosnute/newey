/**
 * Newey — card interactions.
 *
 * - drag anywhere on a card (except interactive elements) to move it; it
 *   follows the cursor and snaps to the grid on release
 * - drag the bottom-right grip to change the card's size: horizontal for
 *   width (columns), vertical for height (rows — auto-fit is suspended)
 * - Shift+wheel resizes width; Alt+Shift+wheel resizes height
 */

import { MAX_COLUMNS } from './grid.js';

const INTERACTIVE_SELECTOR = 'button, a, input, select, textarea, label, [contenteditable]';

export function makeInteractive({ card, getItem, grid, manager }) {
  void manager;
  const id = getItem()?.id;
  if (!id) return;

  card.addEventListener('wheel', (e) => {
    if (!e.shiftKey) return; // Shift+wheel resizes; plain scroll never hijacked
    e.preventDefault();
    const item = getItem();
    if (e.altKey) {
      // Alt+Shift+wheel: height in rows (pins it); Ctrl drops back to snug
      if (e.ctrlKey) { grid.setAutoHeight(id); return; }
      const shown = grid.effHeightUnits(id) ?? item.height ?? 1;
      const next = Math.max(1, shown + (e.deltaY < 0 ? 1 : -1));
      if (next !== shown || item.autoHeight === false) grid.resizeWidgetHeight(id, next);
    } else {
      grid.resizeWidget(id, e.deltaY < 0 ? 1 : -1);
    }
  }, { passive: false });

  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest(INTERACTIVE_SELECTOR)) return;
    startDrag(e);
  });

  card.querySelector('.widget-resize')?.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startResize(e);
  });

  function startDrag(e) {
    const startRect = card.getBoundingClientRect();
    const grabOffsetX = e.clientX - startRect.left;
    const grabOffsetY = e.clientY - startRect.top;
    card.classList.add('widget--dragging');

    const onMove = (ev) => {
      grid.previewDrag(
        id,
        startRect.left + (ev.clientX - e.clientX),
        startRect.top + (ev.clientY - e.clientY)
      );
    };

    const onUp = (ev) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      card.classList.remove('widget--dragging');

      const rootRect = grid.root.getBoundingClientRect();
      // x quantises to whole columns; y stays FRACTIONAL so the release
      // magnet in moveWidget can land the card flush against a neighbour
      // instead of being pre-rounded to a whole row.
      const x = Math.round(
        (ev.clientX - grabOffsetX - rootRect.left - grid.padding) / (grid.cellW + grid.gap)
      );
      const y = Math.max(0,
        (ev.clientY - grabOffsetY - rootRect.top - grid.padding) / (grid.cellHeight + grid.gap)
      );
      grid.moveWidget(id, x, y);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function startResize(e) {
    const startX = e.clientX;
    const startY = e.clientY;
    const startRect = card.getBoundingClientRect();
    const startWidth = getItem().width;
    const shown = grid.effHeightUnits(id) ?? getItem().height ?? 1;
    const startCol = getItem().position?.x ?? 0;
    card.classList.add('widget--resizing');

    let previewW = startWidth;
    let previewH = shown;

    const onMove = (ev) => {
      const deltaCols = Math.round((ev.clientX - startX) / (grid.cellW + grid.gap));
      previewW = Math.min(Math.max(1, startWidth + deltaCols), MAX_COLUMNS - startCol);
      card.style.width = `${previewW * grid.cellW + (previewW - 1) * grid.gap}px`;

      const deltaRows = Math.round((ev.clientY - startY) / (grid.cellHeight + grid.gap));
      previewH = Math.max(1, shown + deltaRows);
      const pxH = previewH * grid.cellHeight + (previewH - 1) * grid.gap;
      const shownH = Math.max(pxH, startRect.height);
      card.style.height = `${shownH}px`;
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      card.classList.remove('widget--resizing');

      if (previewW !== startWidth) {
        grid.resizeWidget(id, previewW - startWidth);
      }
      if (previewH !== shown) {
        const rowPx = (h) => h * grid.cellHeight + (h - 1) * grid.gap;
        if (previewH < shown && rowPx(previewH) < startRect.height) {
          // can't pin below content — go back to snug
          grid.setAutoHeight(id);
        } else {
          grid.resizeWidgetHeight(id, previewH);
        }
      } else if (previewW === startWidth) {
        grid.render(); // no-op drag: restore auto/pinned height
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
}
