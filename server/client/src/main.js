// Multiplayer client. All rules live on the server; this file only draws the view the server sends and
// turns clicks into messages. Board coordinates from the server are always "red at the bottom"; the blue player's
// board is shown rotated 180 degrees so everyone plays from the bottom of their own screen.
import '../../../single/web/src/style.css';
import './lobby.css';
import { SIZES, NAMES, RANK_ORDER, FLAG, BOMB, SPY, territory, rowOf, randomSetup, totalScore } from '../../../single/web/src/game.js';

const $ = (id) => document.getElementById(id);
const boardEl = $('board'), sideEl = $('side'), statusEl = $('status'), leaveBtn = $('leave');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const label = (rank) => (rank === FLAG ? '🚩' : rank === BOMB ? '💣' : rank === SPY ? 'S' : String(rank));
const store = {
  get: (k, s = localStorage) => { try { return s.getItem(k); } catch { return null; } },
  set: (k, v, s = localStorage) => { try { s.setItem(k, v); } catch { /* private mode etc. */ } },
};

// ---- state -----------------------------------------------------------------------------------
let ws = null;
let connected = false;
let token = store.get('stratego.token', sessionStorage); // per tab, so two tabs can play each other
let myName = store.get('stratego.name') || '';
let rooms = [];
let view = null; // the server's view of my game, or null when I'm in the lobby
let log = [];
let toast = '';
let toastTimer = null;
let ui = freshUi();
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

function onMessage(m) {
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
      if (!prev || prev.code !== view.code) log = [];
      if (view.phase === 'setup' && (!prev || prev.phase !== 'setup')) ui = freshUi();
      if (view.phase === 'setup' && view.mySetup) ui.placed = { ...view.mySetup };
      ui.sel = null; ui.targets = [];
      if (m.event) log.unshift(describe(m.event));
      break;
    }
    case 'error':
      return showError(m.msg);
    default:
      return;
  }
  render();
}

function describe(e) {
  const opp = esc(view.opp ? view.opp.name : 'Opponent');
  if (e.type === 'move') {
    if (e.mine) return `You moved your ${NAMES[e.attacker]}.`;
    return e.attacker !== undefined ? `${opp} moved a ${NAMES[e.attacker]} ${e.dist} squares.` : `${opp} moved a piece.`;
  }
  const a = e.mine ? `Your ${NAMES[e.attacker]}` : `${opp}'s ${NAMES[e.attacker]}`;
  const d = e.mine ? `${opp}'s ${NAMES[e.defender]}` : `your ${NAMES[e.defender]}`;
  if (e.defender === BOMB) return e.result === 'win' ? `${a} defused ${d}!` : `${a} was blown up by ${d}.`;
  if (e.defender === FLAG) return `${a} captured the flag!`;
  return e.result === 'win' ? `${a} captured ${d}.` : e.result === 'lose' ? `${a} was defeated by ${d}.` : `${a} and ${d} were both eliminated.`;
}

// ---- drawing ---------------------------------------------------------------------------------
function pieceHTML({ color, rank, seen = false, extra = '' }) {
  const visible = rank !== null && rank !== undefined;
  const cls = ['piece', color, visible ? '' : 'hidden', seen ? 'seen' : '', extra].join(' ');
  return `<div class="${cls}"><span class="r">${visible ? label(rank) : '★'}</span><span class="n">${visible ? NAMES[rank] : ''}</span></div>`;
}

const remaining = (rank) => view.army[rank] - Object.values(ui.placed).filter((r) => r === rank).length;
const placedCount = () => Object.keys(ui.placed).length;
const armyTotal = () => Object.values(view.army).reduce((a, b) => a + b, 0);
const oppColor = () => (view.you === 'red' ? 'blue' : 'red');
const flipped = () => view.you === 'blue';
/** Squares are mirrored for the blue player; the mapping is its own inverse. */
const mirror = (i) => (flipped() ? view.size * view.size - 1 - i : i);

function renderBoard() {
  const n = view.size, lakes = new Set(view.lakes), zone = new Set(territory(view.you, n));
  const setup = view.phase === 'setup';
  const targets = new Set(ui.targets);
  const last = view.lastMove;
  boardEl.style.gridTemplateColumns = boardEl.style.gridTemplateRows = `repeat(${n}, minmax(0, 1fr))`;
  boardEl.classList.toggle('dense', n > 12);
  boardEl.classList.toggle('big', n > 10);
  let html = '';
  for (let d = 0; d < n * n; d++) {
    const i = mirror(d);
    const cls = ['cell'];
    if (lakes.has(i)) cls.push('lake');
    if (setup && zone.has(rowOf(i, n))) cls.push('zone');
    let inner = '';
    if (setup) {
      if (ui.placed[i] !== undefined) inner = pieceHTML({ color: view.you, rank: ui.placed[i], extra: `mine ${ui.pick === i ? 'sel' : ''}` });
    } else {
      const p = view.board[i];
      if (last && (last.from === i || last.to === i)) cls.push('last');
      if (targets.has(i)) { cls.push('target'); if (p) cls.push('enemy'); }
      if (p) {
        const mine = p.o === 'me';
        inner = pieceHTML({ color: mine ? view.you : oppColor(), rank: p.r, seen: p.v, extra: `${mine ? 'mine' : ''} ${ui.sel === i ? 'sel' : ''}` });
      }
    }
    html += `<div class="${cls.join(' ')}" data-d="${d}">${inner}</div>`;
  }
  if (view.phase === 'over') html += overlayHTML();
  boardEl.innerHTML = html;
}

function overlayHTML() {
  const r = view.result, won = r.winner === 'me';
  const why = {
    flag: won ? 'You captured the enemy flag.' : 'Your flag was captured.',
    blocked: won ? 'Your opponent has no legal moves.' : 'You have no legal moves.',
    resigned: won ? 'Your opponent resigned.' : 'You resigned.',
    abandoned: won ? 'Your opponent disconnected and forfeited.' : 'You were away too long and forfeited.',
    left: won ? 'Your opponent left the game.' : 'You left the game.',
  }[r.reason] || '';
  const canRematch = view.opp && !view.opp.left;
  const rematch = !canRematch ? '' : view.rematch.me
    ? '<button disabled>Waiting for opponent…</button>'
    : `<button class="primary" data-act="rematch">${view.rematch.opp ? 'Accept rematch' : 'Rematch'}</button>`;
  return `<div class="overlay"><h2>${won ? 'Victory!' : 'Defeat'}</h2><p>${why}</p>
    <div class="row">${rematch}<button data-act="leave">Back to lobby</button></div></div>`;
}

const badge = (p) => (p.left ? '<span class="badge bad">left</span>' : p.connected ? '<span class="badge ok">online</span>' : '<span class="badge bad">disconnected</span>');

function chips(color, ranks) {
  const sorted = [...ranks].sort((a, b) => b - a);
  return `<div class="chips">${sorted.map((r) => `<span class="chip ${color}">${label(r)}</span>`).join('') || '<span class="chip" style="background:#39424f">none</span>'}</div>`;
}

function lobbySide() {
  const sizes = SIZES.map((n) => `<button data-create="${n}">${n}×${n}${n === 10 ? ' classic' : ''}</button>`).join('');
  const list = rooms.length
    ? `<ul class="rooms">${rooms.map((r) => `<li><span><strong>${esc(r.host)}</strong> <span class="muted">${r.size}×${r.size} · ${esc(r.code)}</span></span><button data-join="${esc(r.code)}" class="primary">Join</button></li>`).join('')}</ul>`
    : '<p>No open games yet. Start one, or wait for another player to.</p>';
  return `<h2>Your name</h2>
    <div class="row"><input id="name" maxlength="20" value="${esc(myName)}" aria-label="Your name"><button id="rename">Save</button></div>
    <h2>Start a game</h2><p>Pick a board size. Another player on your network can then join you.</p>
    <div class="row sizes">${sizes}</div>
    <h2>Open games</h2>${list}
    <h2>Join with a code</h2>
    <div class="row"><input id="code" maxlength="4" size="6" placeholder="ABCD" aria-label="Game code" style="text-transform:uppercase"><button id="joinCode">Join</button></div>`;
}

function waitingSide() {
  const lakes = view.host && view.size > 10 ? '<button data-act="lakes">🎲 Randomize lakes</button>' : '';
  return `<h2>Waiting for an opponent…</h2>
    <p>Game code</p><div class="code">${esc(view.code)}</div>
    <p>Another player on your network can open this page and pick your game from the list, or type the code.</p>
    <div class="row"><span class="muted">${view.size}×${view.size} board</span>${lakes}</div>`;
}

function setupSide() {
  const total = placedCount(), need = armyTotal(), ready = view.me.ready;
  const tray = RANK_ORDER.map((r) => {
    const n = remaining(r);
    return `<button data-tray="${r}" class="${ui.tray === r ? 'on' : ''}" ${n && !ready ? '' : 'disabled'}>${pieceHTML({ color: view.you, rank: r })}<span>${NAMES[r]} ×${n}</span></button>`;
  }).join('');
  const lakes = view.host && view.size > 10 && !ready ? '<button data-act="lakes">🎲 Randomize lakes</button>' : '';
  const action = ready
    ? '<button data-act="unready">Change setup</button>'
    : `<button id="random">Random</button><button id="clear">Clear</button><button class="primary" data-act="ready" ${total === need ? '' : 'disabled'}>Ready</button>`;
  return `<h2>You are ${view.you === 'red' ? 'Red' : 'Blue'} vs ${esc(view.opp.name)} ${badge(view.opp)}</h2>
    <h2>Set up your army (${total}/${need})</h2>
    <p>${ready ? 'You are ready. Waiting for your opponent…' : 'Pick a piece below, then click a square in your highlighted territory. Click a placed piece to pick it up and move or swap it; double-click to return it to the tray.'}
      ${view.opp.ready ? '<span class="badge ok">opponent ready</span>' : '<span class="badge wait">opponent setting up</span>'}</p>
    <div class="tray">${tray}</div><div class="row">${lakes}${action}</div>`;
}

function playSide() {
  const away = !view.opp.connected && !view.opp.left
    ? '<p><span class="badge bad">Opponent disconnected</span> They have a couple of minutes to reconnect before forfeiting.</p>' : '';
  const resign = view.phase === 'play' ? '<div class="row"><button data-act="resign">Resign</button></div>' : '';
  return `<h2>${esc(view.opp.name)} ${badge(view.opp)} <span class="pts">${view.you === 'red' ? 'Blue' : 'Red'}</span></h2>${away}
    <h2>Your losses <span class="pts">${totalScore(view.dead.me)} pts</span></h2>${chips(view.you, view.dead.me)}
    <h2>Enemy losses <span class="pts">${totalScore(view.dead.opp)} pts</span></h2>${chips(oppColor(), view.dead.opp)}
    ${resign}<h2>Log</h2><ul id="log">${log.map((l) => `<li>${l}</li>`).join('')}</ul>`;
}

function statusText() {
  if (!connected) return 'Connecting to the server…';
  if (!view) return 'Lobby';
  switch (view.phase) {
    case 'waiting': return 'Waiting for an opponent';
    case 'setup': return view.me.ready ? 'Waiting for your opponent' : 'Place your pieces';
    case 'play': return view.turn === 'me' ? `Your turn (${view.you === 'red' ? 'Red' : 'Blue'})` : `${view.opp.name}'s turn`;
    default: return view.result.winner === 'me' ? 'You win!' : 'You lose.';
  }
}

function render() {
  const inBoard = !!view && view.phase !== 'waiting';
  boardEl.hidden = !inBoard;
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
  const n = view.size;
  if (view.me.ready || !territory(view.you, n).includes(rowOf(i, n)) || view.lakes.includes(i)) return;
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
  if (view.phase !== 'play' || view.turn !== 'me') return;
  if (ui.targets.includes(i)) { send({ t: 'move', from: ui.sel, to: i }); ui.sel = null; ui.targets = []; return; }
  const p = view.board[i];
  if (p && p.o === 'me' && ui.sel !== i) {
    const to = view.moves.filter(([f]) => f === i).map(([, t]) => t);
    if (to.length) { ui.sel = i; ui.targets = to; return; }
  }
  ui.sel = null; ui.targets = [];
}

boardEl.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]');
  if (act) return action(act.dataset.act);
  const cell = e.target.closest('.cell');
  if (!cell || !view) return;
  const i = mirror(Number(cell.dataset.d));
  if (view.phase === 'setup') setupClick(i); else playClick(i);
  render();
});

boardEl.addEventListener('dblclick', (e) => {
  const cell = e.target.closest('.cell');
  if (!cell || !view || view.phase !== 'setup' || view.me.ready) return;
  delete ui.placed[mirror(Number(cell.dataset.d))];
  ui.pick = null;
  render();
});

function action(name) {
  switch (name) {
    case 'ready': send({ t: 'setup', placements: ui.placed }); break;
    case 'unready': send({ t: 'unready' }); break;
    case 'lakes': send({ t: 'lakes' }); break;
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
  if (t.dataset.create) return send({ t: 'create', size: Number(t.dataset.create) });
  if (t.dataset.join) return send({ t: 'join', code: t.dataset.join });
  if (t.id === 'joinCode') return send({ t: 'join', code: $('code').value });
  if (t.id === 'rename') { myName = $('name').value; return send({ t: 'rename', name: myName }); }
  if (t.dataset.tray !== undefined) {
    const r = Number(t.dataset.tray);
    ui.tray = ui.tray === r ? null : r; ui.pick = null;
  } else if (t.id === 'random') { ui.placed = randomSetup(view.you, view.size); ui.tray = ui.pick = null; }
  else if (t.id === 'clear') { ui.placed = {}; ui.tray = ui.pick = null; }
  render();
});

sideEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'code') send({ t: 'join', code: e.target.value });
  if (e.target.id === 'name') { myName = e.target.value; send({ t: 'rename', name: myName }); }
});

leaveBtn.addEventListener('click', () => {
  if (view && view.phase === 'play' && !confirm('Leaving forfeits the game. Leave anyway?')) return;
  send({ t: 'leave' });
});

$('ver').textContent = `online v${__APP_VERSION__}`;
render();
connect();
