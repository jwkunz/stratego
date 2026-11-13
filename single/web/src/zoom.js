// Zoom and scroll for big boards (hexagon star). The board element is `zoom` times as wide as its frame; the frame scrolls.
export const ZOOMS = [1, 1.5, 2, 3, 4];

/**
 * @param {object} o
 * @param {HTMLElement} o.wrap   the scrollable frame around the board
 * @param {HTMLElement} o.bar    the zoom bar with buttons data-zoom="out" | "fit" | "in"
 * @param {(zoom: number) => void} o.apply  re-draws the board at the new zoom (read `zoom.value`)
 */
export function createZoom({ wrap, bar, apply }) {
  let zoom = 1;
  const set = (next) => {
    const cx = (wrap.scrollLeft + wrap.clientWidth / 2) / (wrap.scrollWidth || 1);
    const cy = (wrap.scrollTop + wrap.clientHeight / 2) / (wrap.scrollHeight || 1);
    zoom = next;
    apply(zoom);
    // keep whatever was in the middle of the frame in the middle
    wrap.scrollLeft = cx * wrap.scrollWidth - wrap.clientWidth / 2;
    wrap.scrollTop = cy * wrap.scrollHeight - wrap.clientHeight / 2;
  };
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const at = ZOOMS.indexOf(zoom);
    if (b.dataset.zoom === 'fit') set(1);
    else if (b.dataset.zoom === 'in') set(ZOOMS[Math.min(ZOOMS.length - 1, at + 1)]);
    else set(ZOOMS[Math.max(0, at - 1)]);
  });
  return { get value() { return zoom; }, reset() { zoom = 1; }, set };
}
