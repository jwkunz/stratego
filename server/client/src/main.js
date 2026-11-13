// Multiplayer client. All rules live on the server; this file only draws the view the server sends and turns clicks
// into messages. The board in a view always uses the shared ("canonical") cell numbering; each player's screen is
// rotated so their own camp is at the bottom (see boardview.js).
import '../../../single/web/src/style.css';
import './lobby.css';
import { createEffects, reduceMotion } from '../../../single/web/src/effects.js';
import { scoreboardHTML } from '../../../single/web/src/scoreboard.js';
import { boardMarkup } from '../../../single/web/src/boardview.js';
import { createZoom } from '../../../single/web/src/zoom.js';
import { SIZES, NAMES, RANK_ORDER, FLAG, BOMB, SPY, makeConfig, makeHexConfig, randomSetupFor, totalScore, armyTotal } from '../../../single/web/src/game.js';
import { HEX_SIZES, HEX_PLAYERS } from '../../../single/web/src/topology.js';

const $ = (id) => document.getElementById(id);
const boardEl = $('board'), sideEl = $('side'), statusEl = $('status'), leaveBtn = $('leave'), stageEl = $('stage'), wrapEl = $('boardwrap'), overlayEl = $('overlayhost');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cap = (w) => w[0].toUpperCase() + w.slice(1);
const label = (rank) => (rank === FLAG ? '🚩' : rank === BOMB ? '💣' : rank === SPY ? 'S' : String(rank));
const store = {
  get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } },
  set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch { /* private mode etc. */ } },
};
const fx = createEffects({ boardEl, renderPiece: (color, rank) => pieceHTML({ color, rank }) });
const zoomCtl = createZoom({ wrap: wrapEl, bar: $('zoombar'), apply: () => renderBoard() });

// ---- state -----------------------------------------------------------------------------------
let ws = null;
let connected = false;
let token = store.get('stratego.token', sessionStorage); // per tab, so two tabs can play each other
let myName = store.get('stratego.name') || '';
let rooms = [];
let view = null; // the server's view of my game, or null when I'm in the lobby
let cfg = null; // board configuration rebuilt from the view (topology, army)
let cfgKey = '';
let layout = null; // cell rectangles of the board as drawn (aims the effects)
let log = [];
let toast = '';
let toastTimer = null;
let lockUntil = 0; // clicks are ignored while a combat animation plays
let shake = null; // {cell, start, dur}: an enemy piece whose fog of war just lifted
let ui = freshUi();
/** What the "start a game" form currently says. */
const form = { mode: 'square', size: 10, hexSize: 'medium', players: 3, ai: 0, level: 'medium' };
function freshUi() { return { placed: {}, tray: null, pick: null, sel: null, targets: [] }; }

const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
const showError = (msg) => {
  toast = msg; render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast = ''; render(); }, 4000);
};

// ---- connection ------------------------------------------------------------------------------
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => send({ t: 'hello', name: myName, token });
  ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => { connected = false; render(); setTimeout(connect, 1500); };
  ws.onerror = () => ws.close();
}

/** The same configuration the server uses, rebuilt from what the view says (cached). */
function configOf(v) {
  const key = [v.mode, v.size, v.a, v.players.length, v.lakes.join(','), v.players.map((p) => p.team || '').join('')].join('|');
  if (key !== cfgKey) {
    cfgKey = key;
    cfg = v.mode === 'hex'
      ? makeHexConfig({ a: v.a, players: v.players.length, lakes: v.lakes, teams: v.players.map((p) => p.team) })
      : makeConfig(v.size, Array.from({ length: v.size * v.size }, (_, i) => v.lakes.includes(i)));
  }
  return cfg;
}

function onMessage(m) {
  let event = null;
  switch (m.t) {
    case 'welcome':
      connected = true;
      token = m.token; myName = m.name;
      store.set('stratego.token', token, sessionStorage); store.set('stratego.name', myName);
      break;
    case 'lobby':
      rooms = m.rooms;
      if (view) { view = null; log = []; ui = freshUi(); }
      break;
    case 'state': {
      const prev = view;
      view = m.view;
      configOf(view);
      event = m.event;
      if (!prev || prev.code !== view.code) { log = []; zoomCtl.reset(); }
      if (view.phase === 'setup' && (!prev || prev.phase !== 'setup')) ui = freshUi();
      if (view.phase === 'setup' && view.mySetup) ui.placed = { ...view.mySetup };
      ui.sel = null; ui.targets = [];
      if (event) log.unshift(...describe(event));
      shake = null;
      if (event && prev && prev.code === view.code) markReveal(event, prev);
      break;
    }
    case 'error':
      return showError(m.msg);
    default:
      return;
  }
  render();
  if (event) playEffects(event);
}

// ---- who is who ---------------------------------------------------------------------------------
const playerOf = (color) => view.players.find((p) => p.color === color);
const nameOf = (color) => { const p = playerOf(color); return p ? (p.name || `Seat ${p.seat + 1}`) : cap(color); };
const teamOf = (color) => (playerOf(color).team || color);
const sameTeam = (a, b) => teamOf(a) === teamOf(b);
const mePlayer = () => view.players.find((p) => p.isMe);

/** Log lines (oldest first) for an event. */
function describe(e) {
  const you = e.mine;
  const who = (color) => (color === view.you ? 'You' : esc(nameOf(color)));
  const lines = [];
  if (e.type === 'out') {
    const how = { left: 'left the game', abandoned: 'disconnected', resigned: 'resigned' }[e.reason] || 'dropped out';
    lines.push(`${who(e.owner)} ${how}.`);
  } else if (e.type === 'move') {
    if (you) lines.push(`You moved your ${NAMES[e.attacker]}.`);
    else lines.push(e.attacker !== undefined ? `${esc(nameOf(e.owner))} moved a ${NAMES[e.attacker]}${e.dist > 1 ? ` ${e.dist} squares` : ''}.` : `${esc(nameOf(e.owner))} moved a piece.`);
  } else {
    const a = you ? `Your ${NAMES[e.attacker]}` : `${esc(nameOf(e.owner))}'s ${NAMES[e.attacker]}`;
    const d = e.defenderOwner === view.you ? `your ${NAMES[e.defender]}` : `${esc(nameOf(e.defenderOwner))}'s ${NAMES[e.defender]}`;
    if (e.defender === BOMB) lines.push(e.result === 'win' ? `${a} defused ${d}!` : `${a} was blown up by ${d}.`);
    else if (e.defender === FLAG) lines.push(`${a} captured the flag!`);
    else lines.push(e.result === 'win' ? `${a} captured ${d}.` : e.result === 'lose' ? `${a} was defeated by ${d}.` : `${a} and ${d} were both eliminated.`);
  }
  for (const out of e.eliminated || []) {
    if (e.type === 'out' && out.player === e.owner) continue;
    lines.push(`${who(out.player)} ${out.player === view.you ? 'are' : 'is'} out: ${out.reason === 'flag' ? 'the flag was captured' : out.reason === 'blocked' ? 'no legal moves' : out.reason}.`);
  }
  return lines.reverse(); // the log is newest first and unshift(...) keeps this order
}

// ---- effects ----------------------------------------------------------------------------------
/** An enemy piece that just lost its fog of war shakes, after any fight animation on its square. */
function markReveal(event, prev) {
  if (reduceMotion() || event.type === 'out' || !prev.board) return;
  const now = view.board && view.board[event.to];
  if (!now || sameTeam(now.o, view.you) || !now.v) return;
  const was = event.type === 'move' ? prev.board[event.from]
    : event.result === 'lose' ? prev.board[event.to] : prev.board[event.from];
  if (was && was.v) return; // it was already face-up
  shake = { cell: event.to, start: performance.now() + (event.type === 'attack' ? fx.duration() : 0), dur: 650 };
}

/** Combat, explosion and victory animations for the event that just happened. */
function playEffects(event) {
  if (event.type !== 'attack' || !layout) return;
  const dur = fx.duration();
  lockUntil = performance.now() + dur;
  const rect = layout.place(event.to);
  fx.playCombat({
    cell: event.to, size: view.size || 0, rect, attacker: event.attacker, defender: event.defender, result: event.result,
    atkColor: event.owner, defColor: event.defenderOwner,
  }, dur);
  if (event.defender === BOMB && event.result === 'lose') fx.explode(event.to, view.size || 0, rect);
  if (view.phase === 'over' && view.result.reason === 'flag' && view.result.won) fx.confetti();
}

// ---- drawing ---------------------------------------------------------------------------------
function pieceHTML({ color, rank, seen = false, extra = '', style = '' }) {
  const visible = rank !== null && rank !== undefined;
  const cls = ['piece', color, visible ? '' : 'hidden', seen ? 'seen' : '', extra].join(' ');
  return `<div class="${cls}"${style ? ` style="${style}"` : ''}><span class="r">${visible ? label(rank) : '★'}</span><span class="n">${visible ? NAMES[rank] : ''}</span></div>`;
}

const remaining = (rank) => view.army[rank] - Object.values(ui.placed).filter((r) => r === rank).length;
const placedCount = () => Object.keys(ui.placed).length;
const viewCamp = () => (cfg.topo.kind === 'hex' ? cfg.topo.tips[view.seat] : view.seat);

function renderBoard() {
  const topo = cfg.topo;
  const setup = view.phase === 'setup';
  const zone = new Set(topo.zones[view.you]);
  const camp = {};
  if (topo.kind === 'hex') for (const p of topo.ids) for (const c of topo.zones[p]) camp[c] = p;
  const targets = new Set(ui.targets);
  const last = view.lastMove;
  const hexBoard = topo.kind === 'hex';

  const mk = boardMarkup(topo, viewCamp(), (i) => {
    const cls = [];
    if (topo.lakes[i]) cls.push('lake');
    if (camp[i]) cls.push(`camp-${camp[i]}`);
    if (setup && zone.has(i)) cls.push('zone');
    let inner = '';
    if (setup) {
      if (ui.placed[i] !== undefined) inner = pieceHTML({ color: view.you, rank: ui.placed[i], extra: `mine ${ui.pick === i ? 'sel' : ''}` });
    } else {
      const p = view.board[i];
      if (last && (last.from === i || last.to === i)) cls.push('last');
      if (targets.has(i)) { cls.push('target'); if (p) cls.push('enemy'); }
      if (p) {
        const mine = p.o === view.you;
        let shaking = '', style = '';
        if (shake && shake.cell === i) {
          const t = performance.now();
          if (t < shake.start + shake.dur) { shaking = 'shaking'; style = `animation-delay:${((shake.start - t) / 1000).toFixed(3)}s`; } else shake = null;
        }
        inner = pieceHTML({ color: p.o, rank: p.r, seen: p.v, style, extra: `${mine ? 'mine' : ''} ${ui.sel === i ? 'sel' : ''} ${shaking}` });
      }
    }
    return { cls, inner };
  });
  layout = mk;

  stageEl.classList.toggle('hexmode', hexBoard);
  $('zoombar').hidden = !hexBoard;
  boardEl.classList.toggle('hex', hexBoard);
  boardEl.classList.toggle('zoomed', hexBoard && zoomCtl.value >= 2);
  boardEl.classList.toggle('dense', !hexBoard && topo.n > 12);
  boardEl.classList.toggle('big', !hexBoard && topo.n > 10);
  if (hexBoard) {
    boardEl.style.gridTemplateColumns = boardEl.style.gridTemplateRows = '';
    for (const el of [stageEl, wrapEl, boardEl]) el.style.setProperty('--aspect', mk.aspect);
    boardEl.style.setProperty('--zoom', zoomCtl.value);
  } else {
    boardEl.style.gridTemplateColumns = boardEl.style.gridTemplateRows = `repeat(${topo.n}, minmax(0, 1fr))`;
  }
  boardEl.innerHTML = mk.html;
  boardEl.appendChild(fx.layer); // effects survive board re-renders

  overlayEl.innerHTML = view.phase === 'over' ? overlayHTML() : '';
}

function overlayHTML() {
  const r = view.result, won = r.won;
  const mine = mePlayer();
  const names = r.winners.map((c) => esc(nameOf(c))).join(' and ');
  const why = {
    flag: won ? 'The last enemy flag was captured.' : mine.out === 'flag' ? 'Your flag was captured.' : 'The last flag standing was not yours.',
    blocked: won ? 'Nobody else can move.' : 'You ran out of legal moves.',
    resigned: won ? 'Everybody else resigned.' : mine.out === 'resigned' ? 'You resigned.' : 'The others played on without you.',
    abandoned: won ? 'The others disconnected and dropped out.' : mine.out === 'abandoned' ? 'You were away too long.' : 'The game ended.',
    left: won ? 'Everybody else left the game.' : 'The game ended.',
  }[r.reason] || '';
  const humansLeft = view.players.some((p) => p.type === 'human' && p.left);
  const rematch = humansLeft ? '' : mine.rematch
    ? '<button disabled>Waiting for the others…</button>'
    : `<button class="primary" data-act="rematch">${view.players.some((p) => p.type === 'human' && p.rematch) ? 'Accept rematch' : 'Rematch'}</button>`;
  return `<div class="overlay"><h2>${won ? 'Victory!' : 'Defeat'}</h2><p>${why}</p>${won ? '' : `<p>${names} won.</p>`}
    <div class="row">${rematch}<button data-act="leave">Back to lobby</button></div></div>`;
}

const badge = (p) => (p.type === 'ai' ? '<span class="badge wait">computer</span>' : p.left ? '<span class="badge bad">left</span>' : p.connected ? '<span class="badge ok">online</span>' : '<span class="badge bad">disconnected</span>');
const optionList = (items, current) => items.map(([v, text]) => `<option value="${v}" ${String(v) === String(current) ? 'selected' : ''}>${text}</option>`).join('');
const LEVELS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
const TEAMS = [['', 'No team'], ['A', 'Team A'], ['B', 'Team B'], ['C', 'Team C']];

function chips(color, ranks) {
  const sorted = [...ranks].sort((a, b) => b - a);
  return `<div class="chips">${sorted.map((r) => `<span class="chip ${color}">${label(r)}</span>`).join('') || '<span class="chip" style="background:#39424f">none</span>'}</div>`;
}

function lobbySide() {
  const f = form;
  const modes = [['square', 'Square (classic)'], ['hex', 'Hextic']].map(([m, t]) => `<button data-form="mode" data-v="${m}" class="${f.mode === m ? 'on' : ''}">${t}</button>`).join('');
  const sizes = f.mode === 'square'
    ? SIZES.map((n) => `<button data-form="size" data-v="${n}" class="${f.size === n ? 'on' : ''}">${n}×${n}${n === 10 ? ' classic' : ''}</button>`).join('')
    : Object.entries(HEX_SIZES).map(([k, a]) => `<button data-form="hexSize" data-v="${k}" class="${f.hexSize === k ? 'on' : ''}">${cap(k)} · ${(a * (a + 1)) / 2} pieces</button>`).join('');
  const seatsN = f.mode === 'hex' ? f.players : 2;
  const counts = f.mode === 'hex' ? `<h2>Players</h2><div class="row sizes">${HEX_PLAYERS.map((n) => `<button data-form="players" data-v="${n}" class="${f.players === n ? 'on' : ''}">${n}</button>`).join('')}</div>` : '';
  const aiChoices = Array.from({ length: seatsN }, (_, k) => k).map((k) => `<button data-form="ai" data-v="${k}" class="${Math.min(f.ai, seatsN - 1) === k ? 'on' : ''}">${k}</button>`).join('');
  const list = rooms.length
    ? `<ul class="rooms">${rooms.map((r) => `<li><span><strong>${esc(r.host)}</strong> <span class="meta">${r.mode === 'hex' ? `Hextic ${esc(r.size)}, ${r.players} players` : `${r.size}×${r.size}`} · ${r.open} open seat${r.open === 1 ? '' : 's'}${r.ai ? ` · ${r.ai} computer${r.ai === 1 ? '' : 's'}` : ''} · ${esc(r.code)}</span></span><button data-join="${esc(r.code)}" class="primary">Join</button></li>`).join('')}</ul>`
    : '<p>No open games yet. Start one, or wait for another player to.</p>';
  return `<h2>Your name</h2>
    <div class="row"><input id="name" maxlength="20" value="${esc(myName)}" aria-label="Your name"><button id="rename">Save</button></div>
    <h2>Start a game</h2>
    <div class="row sizes">${modes}</div>
    <div class="row sizes">${sizes}</div>
    ${counts}
    <h2>Computer players</h2>
    <div class="form-row"><div class="row sizes" style="margin:0">${aiChoices}</div>
      <select data-form="level" aria-label="Computer difficulty">${optionList(LEVELS, f.level)}</select></div>
    <div class="row"><button class="primary" data-act="create">Create game</button></div>
    <h2>Open games</h2>${list}
    <h2>Join with a code</h2>
    <div class="row"><input id="code" maxlength="4" size="6" placeholder="ABCD" aria-label="Game code" style="text-transform:uppercase"><button id="joinCode">Join</button></div>`;
}

function waitingSide() {
  const open = view.players.filter((p) => p.type === 'open').length;
  const rows = view.players.map((p) => {
    const hostTag = p.type === 'human' && p.isMe && view.host ? ' <span class="tag host">host</span>' : '';
    let who;
    if (p.type === 'human') who = `<span class="who">${esc(p.name)}${p.isMe ? ' <em>(you)</em>' : ''}${hostTag}</span>${badge(p)}`;
    else if (!view.host) who = `<span class="who">${p.type === 'ai' ? esc(p.name) : 'Open seat'}</span>${p.type === 'ai' ? badge(p) : ''}`;
    else who = `<select data-seat="${p.seat}" data-field="type" aria-label="Seat ${p.seat + 1}">${optionList([['open', 'Open seat'], ['ai', 'Computer']], p.type)}</select>` +
      (p.type === 'ai' ? `<select data-seat="${p.seat}" data-field="level" aria-label="Difficulty of seat ${p.seat + 1}">${optionList(LEVELS, p.level)}</select>` : '<span class="who"></span>');
    const team = view.mode === 'hex'
      ? (view.host ? `<select data-seat="${p.seat}" data-field="team" aria-label="Team of seat ${p.seat + 1}">${optionList(TEAMS, p.team || '')}</select>` : (p.team ? `<span class="teamtag">${esc(p.team)}</span>` : ''))
      : '';
    return `<div class="seat"><span class="swatch ${p.color}"></span>${who}${team}</div>`;
  }).join('');
  const hostTools = view.host ? `<div class="row">
      ${open ? '<button data-act="fillAI">Fill the rest with computers</button>' : ''}
      ${(view.mode === 'hex' || view.size > 10) ? '<button data-act="lakes">🎲 Randomize lakes</button>' : ''}</div>` : '';
  return `<h2>Waiting for players</h2>
    <p>Game code</p><div class="code">${esc(view.code)}</div>
    <p>Other people on your network can open this page and pick your game from the list, or type the code. ${open} seat${open === 1 ? '' : 's'} still open.</p>
    <div class="seats">${rows}</div>${hostTools}
    <p class="muted">${view.mode === 'hex' ? `Hextic · ${esc(view.hexSize)} · ${view.players.length} players` : `${view.size}×${view.size} board`}</p>`;
}

function setupSide() {
  const total = placedCount(), need = armyTotal(cfg.army), me = mePlayer(), ready = me.ready;
  const tray = RANK_ORDER.map((r) => {
    const n = remaining(r);
    return `<button data-tray="${r}" class="${ui.tray === r ? 'on' : ''}" ${n && !ready ? '' : 'disabled'}>${pieceHTML({ color: view.you, rank: r })}<span>${NAMES[r]} ×${n}</span></button>`;
  }).join('');
  const lakes = view.host && (view.mode === 'hex' || view.size > 10) && !ready ? '<button data-act="lakes">🎲 Randomize lakes</button>' : '';
  const action = ready
    ? '<button data-act="unready">Change setup</button>'
    : `<button id="random">Random</button><button id="clear">Clear</button><button class="primary" data-act="ready" ${total === need ? '' : 'disabled'}>Ready</button>`;
  const others = view.players.map((p) => `<span class="swatch ${p.color}"></span><b>${esc(p.name)}</b>${p.team ? ` (team ${esc(p.team)})` : ''} ${p.ready ? '<span class="badge ok">ready</span>' : '<span class="badge wait">setting up</span>'}`).join('<br>');
  return `<h2>Set up your army (${total}/${need})</h2>
    <p class="matchup" style="display:block;line-height:1.9">${others}</p>
    <p>${ready ? 'You are ready. Waiting for the others…' : 'Pick a piece below, then click a cell in your highlighted territory. Click a placed piece to pick it up and move or swap it; double-click to return it to the tray.'}</p>
    <div class="tray">${tray}</div><div class="row">${lakes}${action}</div>`;
}

function playSide() {
  const me = mePlayer();
  const away = view.players.filter((p) => p.type === 'human' && !p.connected && !p.left && !p.isMe && p.alive);
  const awayNote = away.length ? `<p><span class="badge bad">disconnected</span> ${away.map((p) => esc(p.name)).join(', ')} ${away.length === 1 ? 'has' : 'have'} a couple of minutes to reconnect before dropping out.</p>` : '';
  const board = scoreboardHTML({
    players: view.players.map((p) => ({
      name: p.name, color: p.color, lost: view.dead[p.color], alive: p.alive, isMe: p.isMe, team: p.team, extra: badge(p),
    })),
    army: view.army,
  });
  const losses = view.players.length === 2
    ? (() => {
      const foe = view.players.find((p) => !p.isMe);
      return `<h2>Your losses <span class="pts">${totalScore(view.dead[view.you])} pts</span></h2>${chips(view.you, view.dead[view.you])}
        <h2>Enemy losses <span class="pts">${totalScore(view.dead[foe.color])} pts</span></h2>${chips(foe.color, view.dead[foe.color])}`;
    })()
    : `<h2>Losses</h2>${view.players.map((p) => `<div class="lossrow"><h3><span class="swatch ${p.color}"></span>${p.isMe ? 'You' : esc(p.name)}<span class="pts">${totalScore(view.dead[p.color])} pts</span></h3>${chips(p.color, view.dead[p.color])}</div>`).join('')}`;
  const resign = view.phase === 'play' && me.alive ? '<div class="row"><button data-act="resign">Resign</button></div>' : '';
  return `${board}${awayNote}${losses}${resign}<h2>Log</h2><ul id="log">${log.map((l) => `<li>${l}</li>`).join('')}</ul>`;
}

function statusText() {
  if (!connected) return 'Connecting to the server…';
  if (!view) return 'Lobby';
  const me = mePlayer();
  switch (view.phase) {
    case 'waiting': return 'Waiting for players';
    case 'setup': return me.ready ? 'Waiting for the others' : 'Place your pieces';
    case 'play':
      if (!me.alive) return 'You are out. Watching the rest of the game…';
      return view.turn === view.you ? `Your turn (${cap(view.you)})` : `${nameOf(view.turn)} is moving…`;
    default: return view.result.won ? 'You win!' : 'You lose.';
  }
}

function render() {
  const inBoard = !!view && view.phase !== 'waiting';
  stageEl.hidden = !inBoard;
  leaveBtn.hidden = !view;
  statusEl.textContent = statusText();
  if (inBoard) renderBoard();
  if (!connected) sideEl.innerHTML = '<p>Trying to reach the game server. This page reconnects automatically.</p>';
  else if (!view) sideEl.innerHTML = lobbySide();
  else if (view.phase === 'waiting') sideEl.innerHTML = waitingSide();
  else if (view.phase === 'setup') sideEl.innerHTML = setupSide();
  else sideEl.innerHTML = playSide();
  let t = document.querySelector('.toast');
  if (toast) {
    if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'alert'); document.body.appendChild(t); }
    t.textContent = toast;
  } else if (t) t.remove();
}

// ---- input -----------------------------------------------------------------------------------
function setupClick(i) {
  if (mePlayer().ready || !cfg.topo.zones[view.you].includes(i) || cfg.topo.lakes[i]) return;
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
  if (view.phase !== 'play' || view.turn !== view.you || performance.now() < lockUntil) return;
  if (ui.targets.includes(i)) { send({ t: 'move', from: ui.sel, to: i }); ui.sel = null; ui.targets = []; return; }
  const p = view.board[i];
  if (p && p.o === view.you && ui.sel !== i) {
    const to = view.moves.filter(([f]) => f === i).map(([, t]) => t);
    if (to.length) { ui.sel = i; ui.targets = to; return; }
  }
  ui.sel = null; ui.targets = [];
}

$('frame').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act) return action(act.dataset.act);
  const cell = e.target.closest('.cell');
  if (!cell || !view) return;
  const i = Number(cell.dataset.i);
  if (view.phase === 'setup') setupClick(i); else playClick(i);
  render();
});

$('frame').addEventListener('dblclick', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell || !view || view.phase !== 'setup' || mePlayer().ready) return;
  delete ui.placed[Number(cell.dataset.i)];
  ui.pick = null;
  render();
});

function action(name) {
  switch (name) {
    case 'create': {
      const f = form;
      const players = f.mode === 'hex' ? f.players : 2;
      send({ t: 'create', mode: f.mode, size: f.mode === 'hex' ? f.hexSize : f.size, players, ai: Math.min(f.ai, players - 1), level: f.level });
      break;
    }
    case 'ready': send({ t: 'setup', placements: ui.placed }); break;
    case 'unready': send({ t: 'unready' }); break;
    case 'lakes': send({ t: 'lakes' }); break;
    case 'fillAI': send({ t: 'fillAI', level: form.level }); break;
    case 'resign': if (confirm('Resign this game?')) send({ t: 'resign' }); break;
    case 'rematch': send({ t: 'rematch' }); break;
    case 'leave': send({ t: 'leave' }); break;
    default: break;
  }
}

sideEl.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.act) return action(t.dataset.act);
  if (t.dataset.form) {
    const k = t.dataset.form, v = t.dataset.v;
    form[k] = ['size', 'players', 'ai'].includes(k) ? Number(v) : v;
    if (k === 'mode' || k === 'players') form.ai = Math.min(form.ai, (form.mode === 'hex' ? form.players : 2) - 1);
    return render();
  }
  if (t.dataset.join) return send({ t: 'join', code: t.dataset.join });
  if (t.id === 'joinCode') return send({ t: 'join', code: $('code').value });
  if (t.id === 'rename') { myName = $('name').value; return send({ t: 'rename', name: myName }); }
  if (t.dataset.tray !== undefined) {
    const r = Number(t.dataset.tray);
    ui.tray = ui.tray === r ? null : r; ui.pick = null;
  } else if (t.id === 'random') { ui.placed = randomSetupFor(cfg, view.you); ui.tray = ui.pick = null; }
  else if (t.id === 'clear') { ui.placed = {}; ui.tray = ui.pick = null; }
  render();
});

sideEl.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.form === 'level') { form.level = t.value; return render(); }
  if (t.dataset.seat !== undefined) send({ t: 'seat', seat: Number(t.dataset.seat), [t.dataset.field]: t.value });
});

sideEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'code') send({ t: 'join', code: e.target.value });
  if (e.target.id === 'name') { myName = e.target.value; send({ t: 'rename', name: myName }); }
});

leaveBtn.addEventListener('click', () => {
  if (view && view.phase === 'play' && mePlayer().alive && !confirm('Leaving drops you out of the game. Leave anyway?')) return;
  send({ t: 'leave' });
});

$('ver').textContent = `online v${__APP_VERSION__}`;
render();
connect();
