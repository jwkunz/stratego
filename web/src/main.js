import './style.css';
import { SIZES, NAMES, RANK_ORDER, FLAG, BOMB, SPY, MARSHAL, rowOf, colOf, territory, armyTotal, enemyOf,
  createState, legalMoves, applyMove, randomSetup, makeConfig, randomLakes } from './game.js';
import { pickMove, DIFFICULTIES } from './ai.js';

const $ = (id) => document.getElementById(id);
const boardEl = $('board'), sideEl = $('side'), statusEl = $('status');
const fxLayer = document.createElement('div');
fxLayer.id = 'fx';

const label = (rank) => (rank === FLAG ? '🚩' : rank === BOMB ? '💣' : rank === SPY ? 'S' : String(rank));

/** Board configuration (size, lakes, army) chosen in setup; survives "New game". */
let cfg = makeConfig(10);
/** Opponent strength: 'easy' | 'medium' | 'hard'. */
let difficulty = 'medium';
const redRows = () => territory('red', cfg.size);

let ui;
let tab = 'game';
function reset() {
  fxLayer.replaceChildren();
  ui = { shakes: new Map(), lockUntil: 0, phase: 'setup', placed: {}, tray: null, pick: null, state: null, sel: null, targets: [], log: [], busy: false, timer: null };
}

const remaining = (rank) => cfg.army[rank] - Object.values(ui.placed).filter((r) => r === rank).length;
const placedCount = () => Object.keys(ui.placed).length;

function pieceHTML(p, { showAll = false, extra = '', style = '' } = {}) {
  const mine = p.owner === 'red';
  const visible = mine || p.revealed || showAll;
  const cls = ['piece', p.owner, visible ? '' : 'hidden', !mine && p.revealed && !showAll ? 'seen' : '', extra].join(' ');
  return `<div class="${cls}"${style ? ` style="${style}"` : ''}><span class="r">${visible ? label(p.rank) : '★'}</span><span class="n">${visible ? NAMES[p.rank] : ''}</span></div>`;
}

function renderBoard() {
  const play = ui.phase !== 'setup';
  const showAll = ui.phase === 'over';
  const n = cfg.size, zone = redRows();
  boardEl.style.gridTemplateColumns = boardEl.style.gridTemplateRows = `repeat(${n}, minmax(0, 1fr))`;
  boardEl.classList.toggle('dense', n > 12);
  boardEl.classList.toggle('big', n > 10);
  let html = '';
  for (let i = 0; i < n * n; i++) {
    const r = rowOf(i, n);
    const cls = ['cell'];
    let inner = '';
    let piece = null;
    if (cfg.lakes[i]) cls.push('lake');
    if (!play && zone.includes(r)) cls.push('zone');
    if (play) {
      piece = ui.state.board[i];
      const lm = ui.state.lastMove;
      if (lm && (lm.from === i || lm.to === i)) cls.push('last');
      if (ui.targets.includes(i)) { cls.push('target'); if (piece) cls.push('enemy'); }
    } else if (ui.placed[i] !== undefined) {
      piece = { owner: 'red', rank: ui.placed[i] };
    }
    if (piece) {
      const selected = play ? ui.sel === i : ui.pick === i;
      const mine = piece.owner === 'red';
      let shake = '', style = '';
      const sk = play && piece.id !== undefined ? ui.shakes.get(piece.id) : null;
      if (sk) {
        const t = performance.now();
        if (t < sk.start + sk.dur) { shake = 'shaking'; style = `animation-delay:${((sk.start - t) / 1000).toFixed(3)}s`; }
        else ui.shakes.delete(piece.id);
      }
      inner = pieceHTML(piece, { showAll, style, extra: `${selected ? 'sel' : ''} ${mine ? 'mine' : ''} ${shake}` });
    }
    html += `<div class="${cls.join(' ')}" data-i="${i}">${inner}</div>`;
  }
  if (ui.phase === 'over') {
    const won = ui.state.winner === 'red';
    const why = ui.state.winReason === 'flag' ? (won ? 'You captured the enemy flag.' : 'Your flag was captured.')
      : won ? 'The enemy has no legal moves.' : 'You have no legal moves.';
    html += `<div class="overlay"><h2>${won ? 'Victory!' : 'Defeat'}</h2><p>${why}</p><button class="primary" id="again">Play again</button></div>`;
  }
  boardEl.innerHTML = html;
  boardEl.appendChild(fxLayer); // effects live in a layer that survives re-renders
}

function chips(owner, ranks) {
  const sorted = [...ranks].sort((a, b) => b - a);
  return `<div class="chips">${sorted.map((r) => `<span class="chip ${owner}">${label(r)}</span>`).join('') || '<span class="chip" style="background:#39424f">none</span>'}</div>`;
}

function gameSide() {
  if (ui.phase === 'setup') {
    const total = placedCount(), need = armyTotal(cfg.army);
    const sizes = SIZES.map((n) =>
      `<button data-size="${n}" class="${cfg.size === n ? 'on' : ''}">${n}×${n}${n === 10 ? ' classic' : ''}</button>`).join('');
    const diffs = DIFFICULTIES.map((d) =>
      `<button data-diff="${d}" class="${difficulty === d ? 'on' : ''}">${d[0].toUpperCase() + d.slice(1)}</button>`).join('');
    const lakeBtn = cfg.size > 10 ? '<button id="lakes">🎲 Randomize lakes</button>' : '';
    const tray = RANK_ORDER.map((r) => {
      const n = remaining(r);
      return `<button data-tray="${r}" class="${ui.tray === r ? 'on' : ''}" ${n ? '' : 'disabled'}>
        ${pieceHTML({ owner: 'red', rank: r })}<span>${NAMES[r]} ×${n}</span></button>`;
    }).join('');
    statusEl.textContent = 'Place your pieces';
    return `<h2>Board size</h2>
      <div class="row sizes">${sizes}${lakeBtn}</div>
      <h2>Opponent difficulty</h2>
      <div class="row sizes">${diffs}</div>
      <h2>Set up your army (${total}/${need})</h2>
      <p>Pick a piece below, then click a square in your highlighted territory. Click a placed piece to pick it up and move or swap it; double-click to return it to the tray.</p>
      <div class="tray">${tray}</div>
      <div class="row"><button id="random">Random</button><button id="clear">Clear</button>
      <button id="start" class="primary" ${total === need ? '' : 'disabled'}>Start battle</button></div>`;
  }
  const s = ui.state;
  statusEl.textContent = ui.phase === 'over' ? (s.winner === 'red' ? 'You win!' : 'You lose.')
    : s.turn === 'red' ? 'Your turn (Red)' : 'Blue is thinking…';
  return `<h2>Your losses</h2>${chips('red', s.dead.red)}
    <h2>Enemy losses</h2>${chips('blue', s.dead.blue)}
    <h2>Log</h2><ul id="log">${ui.log.map((l) => `<li>${l}</li>`).join('')}</ul>`;
}

const HELP = {
  10: 'Strongest piece. Beats everything it attacks except a Bomb. Only the Spy can defeat it, and only by attacking first.',
  9: 'Beats Colonel and everything below. Loses to the Marshal and Bombs, and ties another General.',
  8: 'Beats Major and everything below. Loses to General, Marshal and Bombs.',
  7: 'Beats Captain and everything below. Loses to Colonel and higher, and to Bombs.',
  6: 'Beats Lieutenant and everything below. Loses to Major and higher, and to Bombs.',
  5: 'Beats Sergeant and everything below. Loses to Captain and higher, and to Bombs.',
  4: 'Beats Miner, Scout and Spy. Loses to Lieutenant and higher, and to Bombs.',
  3: 'The only piece that can defuse a Bomb. Beats Scout and Spy. Loses to Sergeant and higher.',
  2: 'Moves any number of empty squares in a straight line, like a rook, and can attack at the end of that move. Beats only the Spy and the Flag. Moving far reveals it as a Scout.',
  1: 'Weakest piece, loses to everything it attacks or is attacked by, with one exception: if the Spy attacks the Marshal, the Spy wins. If the Marshal attacks the Spy first, the Spy loses.',
  0: 'Cannot move. Capture the enemy Flag to win, and protect your own.',
  11: 'Cannot move. Any piece that attacks a Bomb is destroyed, except a Miner, which defuses it. Bombs are not destroyed when they win.',
};

function helpSide() {
  const rows = RANK_ORDER.map((r) => `<div class="help-row">
      ${pieceHTML({ owner: 'red', rank: r })}
      <div><strong>${NAMES[r]}</strong> <span class="muted">${r === BOMB ? 'no rank' : r === FLAG ? 'no rank' : 'rank ' + r} · ×${cfg.army[r]}</span>
      <div>${HELP[r]}</div></div></div>`).join('');
  return `<h2>How to play</h2>
    <ul class="rules">
      <li>Red (you) moves first. Each turn, move one piece one square up, down, left or right (Scouts may slide further). You cannot move onto your own pieces or into the lakes.</li>
      <li>Moving onto an enemy piece attacks it. Both pieces are revealed, then the higher rank wins and the loser is removed. Equal ranks are both removed.</li>
      <li>A winning attacker moves into the defender's square. If the defender wins, it stays where it is.</li>
      <li>You win by capturing the enemy Flag, or if the enemy has no legal moves on their turn.</li>
      <li>Two-square rule: a piece may not move back and forth between the same two squares more than 3 times in a row.</li>
      <li>Difficulty (chosen in setup): Easy plays carelessly and makes mistakes, Medium looks one move ahead using the odds of what each hidden piece is, and Hard searches several moves ahead while guessing at hidden pieces. Hard takes up to about half a second per move.</li>
      <li>Larger boards (12×12, 16×16, 20×20) have a deeper starting zone and a bigger army, in the same proportions as the classic 40 pieces. Lakes on those boards can be re-rolled during setup.</li>
      <li>Enemy pieces are hidden (★) until they fight or a Scout moves more than one square. Revealed pieces are marked with an eye.</li>
    </ul>
    <h2>Pieces (strongest first)</h2>${rows}`;
}

function renderSide() {
  const game = gameSide();
  const tabs = ['game', 'help'].map((t) =>
    `<button data-tab="${t}" class="tab ${tab === t ? 'on' : ''}">${t === 'game' ? 'Game' : 'Help'}</button>`).join('');
  sideEl.innerHTML = `<div class="tabs">${tabs}</div>` + (tab === 'help' ? helpSide() : game);
}

const render = () => { renderBoard(); renderSide(); };

function describe(e) {
  const you = e.owner === 'red';
  const who = you ? 'Your' : 'Blue';
  if (e.type === 'move') {
    if (you) return `You moved your ${NAMES[e.attacker]}.`;
    return e.dist > 1 ? `Blue moved a Scout ${e.dist} squares.` : 'Blue moved a piece.';
  }
  const a = `${who} ${NAMES[e.attacker]}`, d = `${you ? 'Blue' : 'your'} ${NAMES[e.defender]}`;
  if (e.defender === BOMB) return e.result === 'win' ? `${a} defused ${d}!` : `${a} was blown up by ${d}.`;
  if (e.defender === FLAG) return `${a} captured the flag!`;
  return e.result === 'win' ? `${a} captured ${d}.` : e.result === 'lose' ? `${a} was defeated by ${d}.` : `${a} and ${d} were both eliminated.`;
}

// ---------------------------------------------------------------------------------------------
// Combat animations. Each effect is a "ghost" of the piece drawn over the square where the fight
// happened (the real board has already moved on), so the piece can be destroyed on screen.
// ---------------------------------------------------------------------------------------------
const ANIM_MS = 1100;
const rand = (a, b) => a + Math.random() * (b - a);
const SPY_SVG = '<svg class="spysvg" viewBox="0 0 100 100"><g fill="#0d1016"><ellipse cx="50" cy="26" rx="27" ry="5.5"/>' +
  '<path d="M34 26Q34 7 50 7Q66 7 66 26Z"/><circle cx="50" cy="39" r="11"/><path d="M16 98Q18 56 50 51Q82 56 84 98Z"/></g>' +
  '<path d="M42 52L50 66L58 52" fill="none" stroke="#e8e6e1" stroke-width="2.5"/></svg>';
const XHAIR_SVG = '<svg class="xhair" viewBox="0 0 100 100"><g fill="none" stroke="#ff2a2a" stroke-width="4" stroke-linecap="round">' +
  '<circle cx="50" cy="50" r="30"/><circle cx="50" cy="50" r="4" fill="#ff2a2a"/><path d="M50 4V28M50 72V96M4 50H28M72 50H96"/></g></svg>';

const ghost = (owner, rank) => pieceHTML({ owner, rank, revealed: true }, { showAll: true });
const spyGhost = (owner) => `<div class="piece ${owner} spyp">${SPY_SVG}</div>`;

const FX = {
  // Winner cuts the weaker piece in two.
  slash: (o, r) => `<div class="half a">${ghost(o, r)}</div><div class="half b">${ghost(o, r)}</div><i class="slashline"></i>`,
  // Failed attacker breaks into shards.
  shatter: (o, r) => {
    let h = '';
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const cx = (x - 1.5) / 1.5, cy = (y - 1.5) / 1.5;
      h += `<div class="shard" style="clip-path:inset(${y * 25}% ${100 - (x + 1) * 25}% ${100 - (y + 1) * 25}% ${x * 25}%);` +
        `--dx:${Math.round(cx * 120 + rand(-25, 25))}%;--dy:${Math.round(cy * 120 + rand(0, 70))}%;--rot:${Math.round(rand(-200, 200))}deg">${ghost(o, r)}</div>`;
    }
    return h;
  },
  // A defused bomb melts away into dust.
  dissolve: (o, r) => {
    let h = `<div class="dis">${ghost(o, r)}</div>`;
    for (let k = 0; k < 14; k++) {
      h += `<i class="dust" style="left:${rand(20, 70).toFixed(0)}%;top:${rand(30, 70).toFixed(0)}%;--dx:${Math.round(rand(-60, 60))}%;--dy:${Math.round(rand(-150, -40))}%;animation-delay:${rand(0, 0.3).toFixed(2)}s"></i>`;
    }
    return h;
  },
  // Spy assassinates the Marshal: red crosshair locks on, then the Marshal collapses.
  crosshair: (o, r) => `<div class="tgt">${ghost(o, r)}</div><i class="hitflash"></i>${XHAIR_SVG}`,
  // A defeated Spy: a silhouette that cracks in two and falls apart.
  crack: (o) => `<div class="spyhalf a">${spyGhost(o)}</div><div class="spyhalf b">${spyGhost(o)}</div>` +
    '<svg class="crack" viewBox="0 0 100 100"><polyline pathLength="1" points="55,0 45,20 58,40 44,60 56,80 48,100"/></svg>',
};

const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** How long the combat animation for this event lasts (0 = none). */
const combatDuration = (e) => (e.type === 'attack' && !reduceMotion() ? ANIM_MS : 0);

function playCombat(e, dur) {
  if (!dur) return;
  const n = cfg.size, u = 100 / n;
  const defOwner = enemyOf(e.owner);
  const defDies = e.result !== 'lose', atkDies = e.result !== 'win', tie = defDies && atkDies;
  const defKind = e.defender === SPY ? 'crack' : e.attacker === SPY && e.defender === MARSHAL ? 'crosshair' : e.defender === BOMB ? 'dissolve' : 'slash';
  const atkKind = e.attacker === SPY ? 'crack' : 'shatter';
  const parts = [];
  if (defDies) parts.push([FX[defKind](defOwner, e.defender), tie ? 'transform:translateX(-24%) scale(.8);' : '']);
  if (atkDies) parts.push([FX[atkKind](e.owner, e.attacker), tie ? 'transform:translateX(24%) scale(.8);' : '']);
  for (const [html, extra] of parts) {
    const el = document.createElement('div');
    el.className = 'fxc';
    el.style.cssText = `left:${colOf(e.to, n) * u}%;top:${rowOf(e.to, n) * u}%;width:${u}%;height:${u}%;${extra}`;
    el.innerHTML = html;
    fxLayer.appendChild(el);
    setTimeout(() => el.remove(), dur + 50);
  }
}

/** Enemy pieces that just lost their fog of war shake (after any fight animation on their square). */
function markReveals(prev, next, event, dur) {
  const hidden = new Set();
  prev.board.forEach((p) => { if (p && p.owner !== 'red' && !p.revealed) hidden.add(p.id); });
  if (reduceMotion()) return;
  next.board.forEach((p, i) => {
    if (p && hidden.has(p.id) && p.revealed) {
      ui.shakes.set(p.id, { start: performance.now() + (event.type === 'attack' && i === event.to ? dur : 0), dur: 650 });
    }
  });
}

/** Screen flash, board shake and a particle burst on the bomb's square. */
function explode(cell) {
  if (reduceMotion()) return;
  const flash = document.createElement('div');
  flash.className = 'flash';
  flash.addEventListener('animationend', () => flash.remove());
  document.body.appendChild(flash);

  boardEl.classList.remove('shake');
  void boardEl.offsetWidth; // restart the animation if one is already running
  boardEl.classList.add('shake');
  setTimeout(() => boardEl.classList.remove('shake'), 700);

  const fx = document.createElement('div');
  fx.className = 'boom';
  const n = cfg.size, u = 100 / n;
  fx.style.left = `${colOf(cell, n) * u + u / 2}%`;
  fx.style.top = `${rowOf(cell, n) * u + u / 2}%`;
  fx.style.width = fx.style.height = `${u}%`;
  let parts = '<span class="blast">💥</span><span class="ring"></span>';
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2 + Math.random() * 0.4, d = 140 + Math.random() * 160;
    parts += `<i style="--dx:${Math.round(Math.cos(a) * d)}%;--dy:${Math.round(Math.sin(a) * d)}%;--s:${(0.5 + Math.random()).toFixed(2)}"></i>`;
  }
  fx.innerHTML = parts;
  fxLayer.appendChild(fx);
  setTimeout(() => fx.remove(), 1000);
}

/** Confetti rain over the whole screen. */
function confetti() {
  if (reduceMotion()) return;
  const layer = document.createElement('div');
  layer.className = 'confetti';
  const colors = ['#e0b84c', '#d94b3d', '#3f72cf', '#5fbf6a', '#f2f2f2', '#c76bd6'];
  let html = '';
  for (let k = 0; k < 160; k++) {
    const dur = 2.5 + Math.random() * 2.5;
    html += `<i style="left:${(Math.random() * 100).toFixed(1)}%;background:${colors[k % colors.length]};` +
      `width:${6 + Math.random() * 6 | 0}px;height:${8 + Math.random() * 8 | 0}px;` +
      `--sway:${(Math.random() * 160 - 80) | 0}px;--spin:${(Math.random() * 1080 - 540) | 0}deg;` +
      `animation-duration:${dur.toFixed(2)}s;animation-delay:${(Math.random() * 1.2).toFixed(2)}s"></i>`;
  }
  layer.innerHTML = html;
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 6200);
}

function commit({ state, event }) {
  const prev = ui.state;
  const dur = combatDuration(event);
  ui.state = state;
  ui.log.unshift(describe(event));
  ui.sel = null; ui.targets = [];
  markReveals(prev, state, event, dur);
  const blast = event.type === 'attack' && event.defender === BOMB && event.result === 'lose';
  if (state.winner) { ui.phase = 'over'; ui.busy = false; }
  else if (state.turn === 'blue') {
    ui.busy = true;
    ui.timer = setTimeout(() => {
      const m = pickMove(ui.state, 'blue', difficulty);
      ui.busy = false;
      commit(applyMove(ui.state, m));
    }, Math.max(600, dur + 200));
  }
  ui.lockUntil = performance.now() + dur;
  render();
  playCombat(event, dur);
  if (blast) explode(event.to);
  if (state.winner === 'red' && state.winReason === 'flag') confetti();
}

function setupClick(i) {
  if (!redRows().includes(rowOf(i, cfg.size)) || cfg.lakes[i]) return;
  const here = ui.placed[i];
  if (ui.tray !== null) {
    if (here !== undefined) { if (here === ui.tray) return; delete ui.placed[i]; }
    if (remaining(ui.tray) > 0) ui.placed[i] = ui.tray;
    if (remaining(ui.tray) === 0) ui.tray = null;
  } else if (ui.pick !== null) {
    const from = ui.pick;
    if (from !== i) {
      const moving = ui.placed[from];
      if (here !== undefined) ui.placed[from] = here; else delete ui.placed[from];
      ui.placed[i] = moving;
    }
    ui.pick = null;
  } else if (here !== undefined) {
    ui.pick = i;
  }
}

function playClick(i) {
  if (ui.busy || ui.phase !== 'play' || ui.state.turn !== 'red' || performance.now() < ui.lockUntil) return;
  const p = ui.state.board[i];
  if (ui.targets.includes(i)) { commit(applyMove(ui.state, { from: ui.sel, to: i })); return; }
  if (p && p.owner === 'red' && ui.sel !== i) {
    const moves = legalMoves(ui.state, 'red', i);
    if (moves.length) { ui.sel = i; ui.targets = moves.map((m) => m.to); render(); return; }
    ui.log.unshift('That piece cannot move.');
  }
  ui.sel = null; ui.targets = [];
  render();
}

boardEl.addEventListener('click', (e) => {
  if (e.target.id === 'again') { clearTimeout(ui.timer); reset(); render(); return; }
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const i = Number(cell.dataset.i);
  if (ui.phase === 'setup') { setupClick(i); render(); } else playClick(i);
});

boardEl.addEventListener('dblclick', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell || ui.phase !== 'setup') return;
  delete ui.placed[Number(cell.dataset.i)];
  ui.pick = null;
  render();
});

sideEl.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); return; }
  if (t.dataset.diff) {
    difficulty = t.dataset.diff;
  } else if (t.dataset.size) {
    cfg = makeConfig(Number(t.dataset.size));
    ui.placed = {}; ui.tray = ui.pick = null;
  } else if (t.id === 'lakes') {
    cfg = { ...cfg, lakes: randomLakes(cfg.size) };
    ui.placed = {}; ui.tray = ui.pick = null;
  } else if (t.dataset.tray !== undefined) {
    const r = Number(t.dataset.tray);
    ui.tray = ui.tray === r ? null : r; ui.pick = null;
  } else if (t.id === 'random') { ui.placed = randomSetup('red', cfg.size); ui.tray = ui.pick = null; }
  else if (t.id === 'clear') { ui.placed = {}; ui.tray = ui.pick = null; }
  else if (t.id === 'start') {
    ui.state = createState(ui.placed, randomSetup('blue', cfg.size), cfg);
    ui.phase = 'play'; ui.log = [`Battle begins against ${difficulty} Blue. Red moves first.`];
  }
  render();
});

$('new').addEventListener('click', () => { clearTimeout(ui.timer); reset(); render(); });

$('ver').textContent = `v${__APP_VERSION__}`;
reset();
render();
