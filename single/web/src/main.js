import './style.css';
import { SIZES, NAMES, RANK_ORDER, FLAG, BOMB, SPY, armyTotal, totalScore,
  createStateN, legalMoves, applyMove, randomSetupFor, makeConfig, makeHexConfig, rerollHexLakes, randomLakes } from './game.js';
import { HEX_SIZES, HEX_PLAYERS } from './topology.js';
import { pickMove, DIFFICULTIES } from './ai.js';
import { createEffects, reduceMotion } from './effects.js';
import { scoreboardHTML } from './scoreboard.js';
import { boardMarkup } from './boardview.js';
import { createZoom } from './zoom.js';

const $ = (id) => document.getElementById(id);
const boardEl = $('board'), sideEl = $('side'), statusEl = $('status'), stageEl = $('stage'), wrapEl = $('boardwrap'), frameEl = $('frame'), overlayEl = $('overlayhost');
const fx = createEffects({ boardEl, renderPiece: (color, rank) => pieceHTML({ owner: color, rank, revealed: true }, { showAll: true }) });
const fxLayer = fx.layer;
const HUMAN = 'red'; // you always play the first seat, red, at the bottom of the board

const label = (rank) => (rank === FLAG ? '🚩' : rank === BOMB ? '💣' : rank === SPY ? 'S' : String(rank));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanName = (raw) => String(raw ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 20) || 'Player';
const cap = (w) => w[0].toUpperCase() + w.slice(1);
const stored = (() => { try { return localStorage.getItem('stratego.name'); } catch { return null; } })();
/** The human player's display name (remembered between sessions). */
let playerName = cleanName(stored);
const saveName = () => { try { localStorage.setItem('stratego.name', playerName); } catch { /* storage unavailable */ } };

// ---- game setup choices (survive "New game") -------------------------------------------------------------------
/** 'square' (the classic board) or 'hex' (hexagon star, 2-6 players). */
let mode = 'square';
let squareSize = 10;
/** Board configuration (topology, army, players, teams) chosen in setup. */
let cfg = makeConfig(10);
/** Opponent strength on the square board: 'easy' | 'medium' | 'hard'. */
let difficulty = 'medium';
/** Hex settings: camp size, player count, and one entry per seat (seat 0 is you; the others are computers). */
const hex = { size: 'medium', players: 3, seats: [{ team: '' }, { level: 'medium', team: '' }, { level: 'medium', team: '' }] };
const zoomCtl = createZoom({ wrap: wrapEl, bar: $('zoombar'), apply: () => renderBoard() });
let layout = null; // placement of cells from the last board render (used to aim effects)

const TEAM_LABELS = ['A', 'B', 'C'];
const isHex = () => mode === 'hex';
const seatOf = (player) => cfg.players.indexOf(player);
const levelOf = (player) => (isHex() ? hex.seats[seatOf(player)].level : difficulty);
const aiName = (player) => (cfg.players.length > 2 ? `Computer ${seatOf(player) + 1} (${cap(levelOf(player))})` : `Computer (${cap(levelOf(player))})`);
const nameOf = (player) => (player === HUMAN ? playerName : aiName(player));
const teamsFromSeats = () => Object.fromEntries(cfg.players.map((p, i) => [p, (isHex() && hex.seats[i].team) || p]));
/** Teams are only valid if they leave at least two sides to fight each other. */
const teamsOk = () => new Set(Object.values(teamsFromSeats())).size >= 2;

function newHexConfig() {
  cfg = makeHexConfig({ a: HEX_SIZES[hex.size], players: hex.players });
}

let ui;
let tab = 'game';
function reset() {
  fxLayer.replaceChildren();
  ui = { shakes: new Map(), lockUntil: 0, phase: 'setup', placed: {}, tray: null, pick: null, state: null, sel: null, targets: [], log: [], busy: false, timer: null };
}

const remaining = (rank) => cfg.army[rank] - Object.values(ui.placed).filter((r) => r === rank).length;
const placedCount = () => Object.keys(ui.placed).length;

/** `ally`: the viewer's teammates' pieces are visible too. */
function pieceHTML(p, { showAll = false, extra = '', style = '', ally = false } = {}) {
  const mine = p.owner === HUMAN;
  const visible = mine || ally || p.revealed || showAll;
  const cls = ['piece', p.owner, visible ? '' : 'hidden', p.revealed && !showAll ? 'seen' : '', extra].join(' ');
  return `<div class="${cls}"${style ? ` style="${style}"` : ''}><span class="r">${visible ? label(p.rank) : '★'}</span><span class="n">${visible ? NAMES[p.rank] : ''}</span></div>`;
}

function renderBoard() {
  const play = ui.phase !== 'setup';
  const state = ui.state;
  const topo = play ? state.topo : cfg.topo;
  const showAll = ui.phase === 'over';
  const hexBoard = topo.kind === 'hex';
  const zone = new Set(topo.zones[HUMAN]);
  const camp = {};
  if (hexBoard) for (const p of topo.ids) for (const c of topo.zones[p]) camp[c] = p;
  const targets = new Set(ui.targets);

  const view = boardMarkup(topo, 0, (i) => {
    const cls = [];
    if (topo.lakes[i]) cls.push('lake');
    if (camp[i]) cls.push(`camp-${camp[i]}`);
    if (!play && zone.has(i)) cls.push('zone');
    let piece = null;
    if (play) {
      piece = state.board[i];
      const lm = state.lastMove;
      if (lm && (lm.from === i || lm.to === i)) cls.push('last');
      if (targets.has(i)) { cls.push('target'); if (piece) cls.push('enemy'); }
    } else if (ui.placed[i] !== undefined) {
      piece = { owner: HUMAN, rank: ui.placed[i] };
    }
    let inner = '';
    if (piece) {
      const selected = play ? ui.sel === i : ui.pick === i;
      const mine = piece.owner === HUMAN;
      let shake = '', style = '';
      const sk = play && piece.id !== undefined ? ui.shakes.get(piece.id) : null;
      if (sk) {
        const t = performance.now();
        if (t < sk.start + sk.dur) { shake = 'shaking'; style = `animation-delay:${((sk.start - t) / 1000).toFixed(3)}s`; }
        else ui.shakes.delete(piece.id);
      }
      const ally = play && state.teams[piece.owner] === state.teams[HUMAN];
      inner = pieceHTML(piece, { showAll, style, ally, extra: `${selected ? 'sel' : ''} ${mine ? 'mine' : ''} ${shake}` });
    }
    return { cls, inner };
  });
  layout = view;

  stageEl.classList.toggle('hexmode', hexBoard);
  $('zoombar').hidden = !hexBoard;
  boardEl.classList.toggle('hex', hexBoard);
  boardEl.classList.toggle('zoomed', hexBoard && zoomCtl.value >= 2);
  boardEl.classList.toggle('dense', !hexBoard && topo.n > 12);
  boardEl.classList.toggle('big', !hexBoard && topo.n > 10);
  if (hexBoard) {
    boardEl.style.gridTemplateColumns = boardEl.style.gridTemplateRows = '';
    wrapEl.style.setProperty('--aspect', view.aspect);
    boardEl.style.setProperty('--aspect', view.aspect);
    boardEl.style.setProperty('--zoom', zoomCtl.value);
    stageEl.style.setProperty('--aspect', view.aspect);
  } else {
    boardEl.style.gridTemplateColumns = boardEl.style.gridTemplateRows = `repeat(${topo.n}, minmax(0, 1fr))`;
  }
  boardEl.innerHTML = view.html;
  boardEl.appendChild(fxLayer); // effects live in a layer that survives re-renders

  if (ui.phase === 'over') {
    const s = ui.state;
    const won = s.winners.includes(HUMAN);
    const team = s.teams[HUMAN] !== HUMAN;
    const why = won
      ? (s.winReason === 'flag' ? `${team ? 'Your team' : 'You'} captured the last enemy flag.` : 'Nobody else can move.')
      : s.outReason[HUMAN] === 'flag' ? 'Your flag was captured.' : 'You ran out of legal moves.';
    const winners = s.winners.map((p) => esc(nameOf(p))).join(' and ');
    overlayEl.innerHTML = `<div class="overlay"><h2>${won ? 'Victory!' : 'Defeat'}</h2><p>${why}</p>${won ? '' : `<p>${winners} won.</p>`}<button class="primary" id="again">Play again</button></div>`;
  } else {
    overlayEl.innerHTML = '';
  }
}

function chips(owner, ranks) {
  const sorted = [...ranks].sort((a, b) => b - a);
  return `<div class="chips">${sorted.map((r) => `<span class="chip ${owner}">${label(r)}</span>`).join('') || '<span class="chip" style="background:#39424f">none</span>'}</div>`;
}

const optionList = (items, current) => items.map(([v, text]) => `<option value="${v}" ${v === current ? 'selected' : ''}>${text}</option>`).join('');

function seatRows() {
  const teamChoices = [['', 'No team'], ...TEAM_LABELS.map((t) => [t, `Team ${t}`])];
  return cfg.players.map((p, i) => {
    const seat = hex.seats[i];
    const who = i === 0 ? `<span class="who">${esc(playerName)} <em>(you)</em></span>`
      : `<span class="who">Computer ${i + 1}</span><select data-seat="${i}" data-field="level" aria-label="Difficulty of seat ${i + 1}">${optionList(DIFFICULTIES.map((d) => [d, cap(d)]), seat.level)}</select>`;
    return `<div class="seat"><span class="swatch ${p}"></span>${who}<select data-seat="${i}" data-field="team" aria-label="Team of seat ${i + 1}">${optionList(teamChoices, seat.team)}</select></div>`;
  }).join('');
}

function gameSide() {
  if (ui.phase === 'setup') {
    const total = placedCount(), need = armyTotal(cfg.army);
    const modes = [['square', 'Square (classic)'], ['hex', 'Hexagon']].map(([m, t]) => `<button data-mode="${m}" class="${mode === m ? 'on' : ''}">${t}</button>`).join('');
    let options;
    if (isHex()) {
      const sizes = Object.entries(HEX_SIZES).map(([k, a]) => `<button data-hexsize="${k}" class="${hex.size === k ? 'on' : ''}">${cap(k)} · ${(a * (a + 1)) / 2} pieces</button>`).join('');
      const counts = HEX_PLAYERS.map((n) => `<button data-hexplayers="${n}" class="${hex.players === n ? 'on' : ''}">${n}</button>`).join('');
      options = `<h2>Camp size</h2><div class="row sizes">${sizes}</div>
        <h2>Players</h2><div class="row sizes">${counts}<button id="lakes">🎲 Randomize lakes</button></div>
        <h2>Seats</h2><div class="seats">${seatRows()}</div>
        ${teamsOk() ? '' : '<p class="warn">Everyone is on the same team. Put at least two sides against each other.</p>'}`;
    } else {
      const sizes = SIZES.map((n) => `<button data-size="${n}" class="${squareSize === n ? 'on' : ''}">${n}×${n}${n === 10 ? ' classic' : ''}</button>`).join('');
      const diffs = DIFFICULTIES.map((d) => `<button data-diff="${d}" class="${difficulty === d ? 'on' : ''}">${cap(d)}</button>`).join('');
      options = `<h2>Board size</h2><div class="row sizes">${sizes}${squareSize > 10 ? '<button id="lakes">🎲 Randomize lakes</button>' : ''}</div>
        <h2>Opponent difficulty</h2><div class="row sizes">${diffs}</div>`;
    }
    const tray = RANK_ORDER.map((r) => {
      const n = remaining(r);
      return `<button data-tray="${r}" class="${ui.tray === r ? 'on' : ''}" ${n ? '' : 'disabled'}>
        ${pieceHTML({ owner: HUMAN, rank: r })}<span>${NAMES[r]} ×${n}</span></button>`;
    }).join('');
    const teams = teamsFromSeats();
    const matchup = cfg.players.map((p) => `<span class="swatch ${p}"></span><b>${esc(nameOf(p))}</b>${teams[p] !== p ? ` (team ${esc(teams[p])})` : ''}`).join(' vs ');
    statusEl.textContent = 'Place your pieces';
    return `<h2>Your name</h2>
      <div class="row"><input id="pname" maxlength="20" value="${esc(playerName)}" aria-label="Your name"></div>
      <h2>Grid</h2><div class="row sizes">${modes}</div>
      ${options}
      <h2>Set up your army (${total}/${need})</h2>
      <p class="matchup">${matchup}</p>
      <p>Pick a piece below, then click a ${isHex() ? 'cell' : 'square'} in your highlighted territory. Click a placed piece to pick it up and move or swap it; double-click to return it to the tray.</p>
      <div class="tray">${tray}</div>
      <div class="row"><button id="random">Random</button><button id="clear">Clear</button>
      <button id="start" class="primary" ${total === need && teamsOk() ? '' : 'disabled'}>Start battle</button></div>`;
  }
  const s = ui.state;
  const outNote = !s.alive[HUMAN] && !s.winner;
  statusEl.textContent = ui.phase === 'over' ? (s.winners.includes(HUMAN) ? 'You win!' : 'You lose.')
    : outNote ? 'You are out. Watching the rest of the game…'
      : s.turn === HUMAN ? `Your turn (${cap(HUMAN)})` : `${cap(s.turn)} is thinking…`;
  const board = scoreboardHTML({
    players: s.players.map((p) => ({
      name: nameOf(p), color: p, lost: s.dead[p], alive: s.alive[p], isMe: p === HUMAN,
      team: s.teams[p] !== p ? s.teams[p] : null,
    })),
    army: s.army,
  });
  let losses;
  if (s.players.length === 2) {
    const foe = s.players[1];
    losses = `<h2>Your losses <span class="pts">${totalScore(s.dead[HUMAN])} pts</span></h2>${chips(HUMAN, s.dead[HUMAN])}
      <h2>Enemy losses <span class="pts">${totalScore(s.dead[foe])} pts</span></h2>${chips(foe, s.dead[foe])}`;
  } else {
    losses = `<h2>Losses</h2>${s.players.map((p) => `<div class="lossrow"><h3><span class="swatch ${p}"></span>${p === HUMAN ? 'You' : esc(nameOf(p))}<span class="pts">${totalScore(s.dead[p])} pts</span></h3>${chips(p, s.dead[p])}</div>`).join('')}`;
  }
  return `${board}${losses}<h2>Log</h2><ul id="log">${ui.log.map((l) => `<li>${l}</li>`).join('')}</ul>`;
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
      ${pieceHTML({ owner: HUMAN, rank: r })}
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
      <li>Enemy pieces are hidden (★) until they fight or a Scout moves more than one square. A revealed piece is marked with an eye, on your pieces too: it means the enemy has seen it and knows what it is.</li>
      <li>Scoring: each lost piece is worth its rank (Spy 1 up to Marshal 10), and the Losses panel totals the points each side has lost. Bombs and the Flag are not scored.</li>
    </ul>
    <h2>Hexagon mode</h2>
    <ul class="rules">
      <li>Choose <b>Hexagon</b> under Grid. The board is a hexagonal arena with one triangular camp per player (2 to 6 players). Every piece moves to any of its <b>six</b> neighbouring cells, and Scouts slide in a straight line along any of the six directions.</li>
      <li>You are Red, at the bottom. Every other seat is a computer player; give each its own difficulty. Camp size (Small, Medium, Large) sets how many pieces each army has.</li>
      <li>Everyone moves in turn around the table. A player is <b>out</b> when their Flag is captured or when they have no legal move on their turn, and their pieces leave the board. The last player or team standing wins.</li>
      <li><b>Teams:</b> give seats the same team to play together. Teammates cannot attack each other and you can see your teammates' pieces. Different teams fight as usual.</li>
      <li>Use the + / − / Fit buttons to zoom the board and scroll it to see the pieces larger.</li>
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
  const you = e.owner === HUMAN;
  if (e.type === 'move') {
    if (you) return `You moved your ${NAMES[e.attacker]}.`;
    return e.dist > 1 ? `${cap(e.owner)} moved a Scout ${e.dist} squares.` : `${cap(e.owner)} moved a piece.`;
  }
  const a = `${you ? 'Your' : `${cap(e.owner)}'s`} ${NAMES[e.attacker]}`;
  const d = `${e.defenderOwner === HUMAN ? 'your' : `${cap(e.defenderOwner)}'s`} ${NAMES[e.defender]}`;
  if (e.defender === BOMB) return e.result === 'win' ? `${a} defused ${d}!` : `${a} was blown up by ${d}.`;
  if (e.defender === FLAG) return `${a} captured the flag!`;
  return e.result === 'win' ? `${a} captured ${d}.` : e.result === 'lose' ? `${a} was defeated by ${d}.` : `${a} and ${d} were both eliminated.`;
}

const eliminationLine = ({ player, reason }) =>
  `${player === HUMAN ? 'You are' : `${cap(player)} is`} out: ${reason === 'flag' ? 'the flag was captured' : 'no legal moves'}.`;

// Combat / victory animations live in effects.js (shared with the multiplayer client).
/** How long the combat animation for this event lasts (0 = none). */
const combatDuration = (e) => (e.type === 'attack' ? fx.duration() : 0);

const playCombat = (e, dur) => fx.playCombat({
  cell: e.to, size: cfg.size, rect: layout.kind === 'hex' ? layout.place(e.to) : null,
  attacker: e.attacker, defender: e.defender, result: e.result,
  atkColor: e.owner, defColor: e.defenderOwner,
}, dur);

/** Enemy pieces that just lost their fog of war shake (after any fight animation on their square). */
function markReveals(prev, next, event, dur) {
  const hidden = new Set();
  prev.board.forEach((p) => { if (p && prev.teams[p.owner] !== prev.teams[HUMAN] && !p.revealed) hidden.add(p.id); });
  if (reduceMotion()) return;
  next.board.forEach((p, i) => {
    if (p && hidden.has(p.id) && p.revealed) {
      ui.shakes.set(p.id, { start: performance.now() + (event.type === 'attack' && i === event.to ? dur : 0), dur: 650 });
    }
  });
}

/** Lets a computer player take the turn after a short pause (shorter when several computers play in a row). */
function scheduleComputer(state, dur) {
  const player = state.turn;
  ui.busy = true;
  const pause = !state.alive[HUMAN] ? 200 : state.players.length > 2 ? 380 : 600;
  ui.timer = setTimeout(() => {
    const m = pickMove(ui.state, player, levelOf(player));
    ui.busy = false;
    commit(applyMove(ui.state, m));
  }, Math.max(pause, dur + 200));
}

function commit({ state, event }) {
  const prev = ui.state;
  const dur = combatDuration(event);
  ui.state = state;
  ui.log.unshift(describe(event));
  for (const out of event.eliminated) ui.log.unshift(eliminationLine(out));
  ui.sel = null; ui.targets = [];
  markReveals(prev, state, event, dur);
  const blast = event.type === 'attack' && event.defender === BOMB && event.result === 'lose';
  if (state.winner) { ui.phase = 'over'; ui.busy = false; }
  else if (state.turn !== HUMAN) scheduleComputer(state, dur);
  else ui.busy = false;
  ui.lockUntil = performance.now() + dur;
  render();
  playCombat(event, dur);
  if (blast) fx.explode(event.to, cfg.size, layout.kind === 'hex' ? layout.place(event.to) : null);
  if (state.winners.includes(HUMAN) && state.winReason === 'flag') fx.confetti();
}

function setupClick(i) {
  if (!cfg.topo.zones[HUMAN].includes(i) || cfg.topo.lakes[i]) return;
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
  if (ui.busy || ui.phase !== 'play' || ui.state.turn !== HUMAN || performance.now() < ui.lockUntil) return;
  const p = ui.state.board[i];
  if (ui.targets.includes(i)) { commit(applyMove(ui.state, { from: ui.sel, to: i })); return; }
  if (p && p.owner === HUMAN && ui.sel !== i) {
    const moves = legalMoves(ui.state, HUMAN, i);
    if (moves.length) { ui.sel = i; ui.targets = moves.map((m) => m.to); render(); return; }
    ui.log.unshift('That piece cannot move.');
  }
  ui.sel = null; ui.targets = [];
  render();
}

frameEl.addEventListener('click', (e) => {
  if (e.target.id === 'again') { clearTimeout(ui.timer); reset(); render(); return; }
  const cell = e.target.closest('.cell');
  if (!cell) return;
  const i = Number(cell.dataset.i);
  if (ui.phase === 'setup') { setupClick(i); render(); } else playClick(i);
});

frameEl.addEventListener('dblclick', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell || ui.phase !== 'setup') return;
  delete ui.placed[Number(cell.dataset.i)];
  ui.pick = null;
  render();
});

// ---- setup panel -------------------------------------------------------------------------------------------------
function resizeSeats() {
  while (hex.seats.length < hex.players) hex.seats.push({ level: 'medium', team: '' });
  hex.seats.length = hex.players;
}

sideEl.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); return; }
  const clearPlacement = () => { ui.placed = {}; ui.tray = ui.pick = null; };
  if (t.dataset.mode) {
    mode = t.dataset.mode; zoomCtl.reset();
    if (isHex()) newHexConfig(); else cfg = makeConfig(squareSize);
    clearPlacement();
  } else if (t.dataset.diff) {
    difficulty = t.dataset.diff;
  } else if (t.dataset.size) {
    squareSize = Number(t.dataset.size);
    cfg = makeConfig(squareSize);
    clearPlacement();
  } else if (t.dataset.hexsize) {
    hex.size = t.dataset.hexsize; zoomCtl.reset(); newHexConfig(); clearPlacement();
  } else if (t.dataset.hexplayers) {
    hex.players = Number(t.dataset.hexplayers); resizeSeats(); zoomCtl.reset(); newHexConfig(); clearPlacement();
  } else if (t.id === 'lakes') {
    if (isHex()) cfg = rerollHexLakes(cfg); else cfg = makeConfig(squareSize, randomLakes(squareSize));
    clearPlacement();
  } else if (t.dataset.tray !== undefined) {
    const r = Number(t.dataset.tray);
    ui.tray = ui.tray === r ? null : r; ui.pick = null;
  } else if (t.id === 'random') { ui.placed = randomSetupFor(cfg, HUMAN); ui.tray = ui.pick = null; }
  else if (t.id === 'clear') { clearPlacement(); }
  else if (t.id === 'start') {
    cfg = { ...cfg, teams: teamsFromSeats() };
    const setups = { [HUMAN]: ui.placed };
    for (const p of cfg.players) if (p !== HUMAN) setups[p] = randomSetupFor(cfg, p);
    ui.state = createStateN(setups, cfg);
    ui.phase = 'play';
    ui.log = [`${cfg.players.map((p) => esc(p === HUMAN ? playerName : cap(p))).join(' vs ')}. ${cap(HUMAN)} moves first.`];
  }
  render();
});

sideEl.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'pname') { playerName = cleanName(t.value); saveName(); render(); return; }
  if (t.dataset.seat !== undefined) { hex.seats[Number(t.dataset.seat)][t.dataset.field] = t.value; render(); }
});

$('new').addEventListener('click', () => { clearTimeout(ui.timer); reset(); render(); });

$('ver').textContent = `v${__APP_VERSION__}`;
reset();
render();
