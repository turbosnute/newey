/**
 * Newey — card interactions.
 *
 * - drag anywhere on a card (except interactive elements) to move it; it
 *   follows the cursor and snaps to the grid on release
 * - drag the bottom-right grip to change the card's width in columns
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
    grid.resizeWidget(id, e.deltaY < 0 ? 1 : -1);
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
      // where should the card's top-left land?
      const x = Math.round(
        (ev.clientX - grabOffsetX - rootRect.left - grid.padding) / (grid.cellW + grid.gap)
      );
      const y = Math.max(0, Math.round(
        (ev.clientY - grabOffsetY - rootRect.top - grid.padding) / (grid.cellHeight + grid.gap)
      ));
      grid.moveWidget(id, x, y);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function startResize(e) {
    const startX = e.clientX;
    const startWidth = getItem().width;
    const startCol = getItem().position?.x ?? 0;
    card.classList.add('widget--resizing');

    const onMove = (ev) => {
      const deltaCols = Math.round((ev.clientX - startX) / (grid.cellW + grid.gap));
      const newWidth = Math.min(Math.max(1, startWidth + deltaCols), MAX_COLUMNS - startCol);
      card.style.width = `${newWidth * grid.cellW + (newWidth - 1) * grid.gap}px`;
      card.dataset.previewWidth = String(newWidth);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      card.classList.remove('widget--resizing');
      const preview = Number(card.dataset.previewWidth || 0);
      delete card.dataset.previewWidth;
      if (preview && preview !== startWidth) {
        grid.resizeWidget(id, preview - startWidth);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }
}
