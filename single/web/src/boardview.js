// Draws a board (square grid or hexagon star) as HTML. Shared by the single-player game and the multiplayer client.
//
// `cellInfo(i)` is called for every cell (canonical index i) and returns { cls: string[], inner: string }.
// The result gives the cells' markup, the on-screen rectangle of every cell (for effects) and the board's proportions.
import { boardLayout } from './topology.js';

/**
 * @param {object} topo      a topology (see topology.js)
 * @param {number} viewCamp  who is looking: for hex boards the camp index (0..5) of the viewer, whose camp is drawn at
 *                           the bottom; for square boards 1 means "turned half a turn" (the second player's view)
 */
export function boardMarkup(topo, viewCamp, cellInfo) {
  const layout = boardLayout(topo, viewCamp);
  const cells = [];
  if (topo.kind === 'square') {
    const flip = viewCamp === 1;
    for (let d = 0; d < topo.cells; d++) {
      const i = flip ? topo.cells - 1 - d : d;
      const { cls, inner } = cellInfo(i);
      cells.push(`<div class="${['cell', ...cls].join(' ')}" data-i="${i}">${inner}</div>`);
    }
    return { kind: 'square', n: topo.n, aspect: 1, place: layout.place, html: cells.join('') };
  }
  for (let i = 0; i < topo.cells; i++) {
    const { cls, inner } = cellInfo(i);
    const [q, r] = topo.coords[i];
    const p = layout.place(i);
    const shade = `s${(((q - r) % 3) + 3) % 3}`; // three subtle tones so neighbouring hexes are easy to tell apart
    cells.push(`<div class="${['cell', 'hex', shade, ...cls].join(' ')}" data-i="${i}" ` +
      `style="left:${p.left.toFixed(3)}%;top:${p.top.toFixed(3)}%;width:${p.w.toFixed(3)}%;height:${p.h.toFixed(3)}%">${inner}</div>`);
  }
  return { kind: 'hex', aspect: layout.aspect, place: layout.place, html: cells.join('') };
}
