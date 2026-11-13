// Combat and victory animations, shared by the single-player game and the multiplayer client.
//
// Each combat effect is a "ghost" of a piece drawn over the square where the fight happened (the real board has
// already moved on), so the piece can be destroyed on screen. Effects live in one overlay layer that is
// re-attached after every board render, so re-drawing the board never cuts an animation short.
//
// The caller supplies `renderPiece(color, rank)`: HTML for a face-up piece of that colour (no eye marker).
import { SPY, MARSHAL, BOMB } from './game.js';

export const ANIM_MS = 1100;

const rand = (a, b) => a + Math.random() * (b - a);

const SPY_SVG = '<svg class="spysvg" viewBox="0 0 100 100"><g fill="#0d1016"><ellipse cx="50" cy="26" rx="27" ry="5.5"/>' +
  '<path d="M34 26Q34 7 50 7Q66 7 66 26Z"/><circle cx="50" cy="39" r="11"/><path d="M16 98Q18 56 50 51Q82 56 84 98Z"/></g>' +
  '<path d="M42 52L50 66L58 52" fill="none" stroke="#e8e6e1" stroke-width="2.5"/></svg>';
const XHAIR_SVG = '<svg class="xhair" viewBox="0 0 100 100"><g fill="none" stroke="#ff2a2a" stroke-width="4" stroke-linecap="round">' +
  '<circle cx="50" cy="50" r="30"/><circle cx="50" cy="50" r="4" fill="#ff2a2a"/><path d="M50 4V28M50 72V96M4 50H28M72 50H96"/></g></svg>';

export const reduceMotion = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * @param {object} opts
 * @param {HTMLElement} opts.boardEl      the board element (shaken by explosions; the effects layer is placed inside it)
 * @param {(color: string, rank: number) => string} opts.renderPiece
 */
export function createEffects({ boardEl, renderPiece }) {
  const layer = document.createElement('div');
  layer.id = 'fx';

  const spyGhost = (color) => `<div class="piece ${color} spyp">${SPY_SVG}</div>`;

  const FX = {
    // Winner cuts the weaker piece in two.
    slash: (c, r) => `<div class="half a">${renderPiece(c, r)}</div><div class="half b">${renderPiece(c, r)}</div><i class="slashline"></i>`,
    // Failed attacker breaks into shards.
    shatter: (c, r) => {
      let h = '';
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
        const cx = (x - 1.5) / 1.5, cy = (y - 1.5) / 1.5;
        h += `<div class="shard" style="clip-path:inset(${y * 25}% ${100 - (x + 1) * 25}% ${100 - (y + 1) * 25}% ${x * 25}%);` +
          `--dx:${Math.round(cx * 120 + rand(-25, 25))}%;--dy:${Math.round(cy * 120 + rand(0, 70))}%;--rot:${Math.round(rand(-200, 200))}deg">${renderPiece(c, r)}</div>`;
      }
      return h;
    },
    // A defused bomb melts away into dust.
    dissolve: (c, r) => {
      let h = `<div class="dis">${renderPiece(c, r)}</div>`;
      for (let k = 0; k < 14; k++) {
        h += `<i class="dust" style="left:${rand(20, 70).toFixed(0)}%;top:${rand(30, 70).toFixed(0)}%;--dx:${Math.round(rand(-60, 60))}%;--dy:${Math.round(rand(-150, -40))}%;animation-delay:${rand(0, 0.3).toFixed(2)}s"></i>`;
      }
      return h;
    },
    // Spy assassinates the Marshal: red crosshair locks on, then the Marshal collapses.
    crosshair: (c, r) => `<div class="tgt">${renderPiece(c, r)}</div><i class="hitflash"></i>${XHAIR_SVG}`,
    // A defeated Spy: a silhouette that cracks in two and falls apart.
    crack: (c) => `<div class="spyhalf a">${spyGhost(c)}</div><div class="spyhalf b">${spyGhost(c)}</div>` +
      '<svg class="crack" viewBox="0 0 100 100"><polyline pathLength="1" points="55,0 45,20 58,40 44,60 56,80 48,100"/></svg>',
  };

  /** Length of a combat animation in ms (0 when the user prefers reduced motion). */
  const duration = () => (reduceMotion() ? 0 : ANIM_MS);

  /**
   * Plays the effect for an attack. `cell` is the on-screen square index of the fight and `size` the board width.
   * info: { cell, size, attacker, defender, result: 'win'|'lose'|'tie', atkColor, defColor }
   */
  function playCombat(info, dur) {
    if (!dur) return;
    const { cell, size: n, rect, attacker, defender, result, atkColor, defColor } = info;
    const box = rect || { left: (cell % n) * (100 / n), top: Math.floor(cell / n) * (100 / n), w: 100 / n, h: 100 / n };
    const defDies = result !== 'lose', atkDies = result !== 'win', tie = defDies && atkDies;
    const defKind = defender === SPY ? 'crack' : attacker === SPY && defender === MARSHAL ? 'crosshair' : defender === BOMB ? 'dissolve' : 'slash';
    const atkKind = attacker === SPY ? 'crack' : 'shatter';
    const parts = [];
    if (defDies) parts.push([FX[defKind](defColor, defender), tie ? 'transform:translateX(-24%) scale(.8);' : '']);
    if (atkDies) parts.push([FX[atkKind](atkColor, attacker), tie ? 'transform:translateX(24%) scale(.8);' : '']);
    for (const [html, extra] of parts) {
      const el = document.createElement('div');
      el.className = 'fxc';
      el.style.cssText = `left:${box.left}%;top:${box.top}%;width:${box.w}%;height:${box.h}%;${extra}`;
      el.innerHTML = html;
      layer.appendChild(el);
      setTimeout(() => el.remove(), dur + 50);
    }
  }

  /**
   * Screen flash, board shake and a particle burst on the bomb's square: on-screen index `cell` of an n-wide square
   * board, or an explicit `rect` ({left, top, w, h} in % of the board) for other shapes.
   */
  function explode(cell, n, rect) {
    if (reduceMotion()) return;
    const flash = document.createElement('div');
    flash.className = 'flash';
    flash.addEventListener('animationend', () => flash.remove());
    document.body.appendChild(flash);

    boardEl.classList.remove('shake');
    void boardEl.offsetWidth; // restart the animation if one is already running
    boardEl.classList.add('shake');
    setTimeout(() => boardEl.classList.remove('shake'), 700);

    const boom = document.createElement('div');
    boom.className = 'boom';
    const box = rect || { left: (cell % n) * (100 / n), top: Math.floor(cell / n) * (100 / n), w: 100 / n, h: 100 / n };
    boom.style.left = `${box.left + box.w / 2}%`;
    boom.style.top = `${box.top + box.h / 2}%`;
    boom.style.width = `${box.w}%`;
    boom.style.height = `${box.h}%`;
    let parts = '<span class="blast">💥</span><span class="ring"></span>';
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 + Math.random() * 0.4, d = 140 + Math.random() * 160;
      parts += `<i style="--dx:${Math.round(Math.cos(a) * d)}%;--dy:${Math.round(Math.sin(a) * d)}%;--s:${(0.5 + Math.random()).toFixed(2)}"></i>`;
    }
    boom.innerHTML = parts;
    layer.appendChild(boom);
    setTimeout(() => boom.remove(), 1000);
  }

  /** Confetti rain over the whole screen. */
  function confetti() {
    if (reduceMotion()) return;
    const el = document.createElement('div');
    el.className = 'confetti';
    const colors = ['#e0b84c', '#d94b3d', '#3f72cf', '#5fbf6a', '#f2f2f2', '#c76bd6'];
    let html = '';
    for (let k = 0; k < 160; k++) {
      const dur = 2.5 + Math.random() * 2.5;
      html += `<i style="left:${(Math.random() * 100).toFixed(1)}%;background:${colors[k % colors.length]};` +
        `width:${6 + Math.random() * 6 | 0}px;height:${8 + Math.random() * 8 | 0}px;` +
        `--sway:${(Math.random() * 160 - 80) | 0}px;--spin:${(Math.random() * 1080 - 540) | 0}deg;` +
        `animation-duration:${dur.toFixed(2)}s;animation-delay:${(Math.random() * 1.2).toFixed(2)}s"></i>`;
    }
    el.innerHTML = html;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6200);
  }

  return { layer, duration, playCombat, explode, confetti };
}
