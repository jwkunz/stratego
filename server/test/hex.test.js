import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, startServer, setupFor } from './helpers.js';

const withServer = (fn, lobbyOpts) => async () => {
  const s = await startServer(lobbyOpts);
  try { await fn(s); } finally { await s.game.close(); }
};
const me = (v) => v.players.find((p) => p.isMe);

/** One person plays against two computer players on a small hexagon board. */
async function soloVsComputers(url, extra = {}) {
  const a = await Client.connect(url, 'Alice');
  a.send({ t: 'create', mode: 'hex', size: 'small', players: 3, ai: 2, level: 'easy', ...extra });
  const { view } = await a.until((v) => v.phase === 'setup');
  return { a, view };
}

test('a hexagon game with computer seats goes straight to setup, and the computers are ready', withServer(async ({ url }) => {
  const { a, view } = await soloVsComputers(url);
  assert.equal(view.mode, 'hex');
  assert.equal(view.hexSize, 'small');
  assert.equal(view.a, 6);
  assert.deepEqual(view.players.map((p) => [p.color, p.type, p.ready]), [['red', 'human', false], ['blue', 'ai', true], ['green', 'ai', true]]);
  assert.deepEqual(view.players.map((p) => p.name), ['Alice', 'Computer 2', 'Computer 3']);
  assert.equal(view.you, 'red');
  assert.ok(view.lakes.length > 0);
  assert.equal(view.board, undefined, 'no board before the game starts');
  // the computers' setups must never be visible to the human: nothing in the view mentions their cells
  assert.equal('setup' in view, false);
  assert.ok(view.players.every((p) => !('setup' in p) && !('token' in p)), 'other seats expose neither their setup nor a session token');
  assert.equal(view.mySetup, null);
  a.close();
}));

test('computer players move on their own, in turn, and never see hidden information they should not', withServer(async ({ url }) => {
  const { a, view } = await soloVsComputers(url);
  a.send({ t: 'setup', placements: setupFor(view) });
  let v = (await a.until((x) => x.phase === 'play')).view;
  assert.equal(v.turn, 'red');
  assert.equal(v.board.filter((p) => p && p.o === 'blue').every((p) => p.r === null), true, 'enemy ranks are hidden');
  const owners = [];
  for (let round = 0; round < 6; round++) {
    const [from, to] = v.moves[Math.floor(Math.random() * v.moves.length)];
    a.send({ t: 'move', from, to });
    // two computer moves follow, then it is our turn again
    const seen = [];
    while (true) {
      const m = await a.next('state', () => true, 8000);
      if (m.event) seen.push(m.event.owner);
      if (m.view.phase !== 'play' || m.view.turn === 'red') { v = m.view; break; }
    }
    owners.push(seen);
    if (v.phase !== 'play') break;
  }
  assert.deepEqual(owners[0], ['red', 'blue', 'green'], 'the table plays in seat order');
  assert.ok(owners.length >= 3);
  a.close();
}));

test('seats: the host can add computers, set teams and difficulty; others cannot; bad teams are refused', withServer(async ({ url }) => {
  const host = await Client.connect(url, 'Host');
  host.send({ t: 'create', mode: 'hex', size: 'small', players: 4 });
  let v = (await host.state()).view;
  assert.deepEqual(v.players.map((p) => p.type), ['human', 'open', 'open', 'open']);
  const guest = await Client.connect(url, 'Guest');
  guest.send({ t: 'list' });
  const lobby = await guest.next('lobby', (m) => m.rooms.length === 1);
  assert.deepEqual([lobby.rooms[0].mode, lobby.rooms[0].size, lobby.rooms[0].players, lobby.rooms[0].open, lobby.rooms[0].ai], ['hex', 'small', 4, 3, 0]);
  guest.send({ t: 'join', code: v.code });
  await guest.state();
  guest.send({ t: 'seat', seat: 3, type: 'ai' });
  assert.match((await guest.next('error')).msg, /Only the host/);

  host.send({ t: 'seat', seat: 3, type: 'ai', level: 'hard', team: 'B' });
  v = (await host.state((x) => x.players[3].type === 'ai')).view;
  assert.deepEqual([v.players[3].level, v.players[3].team, v.players[3].name], ['hard', 'B', 'Computer 4']);
  host.send({ t: 'seat', seat: 1, type: 'ai' }); // a person sits there
  assert.match((await host.next('error')).msg, /taken by a person/);
  host.send({ t: 'seat', seat: 3, team: 'Z' });
  assert.match((await host.next('error')).msg, /Unknown team/);
  host.send({ t: 'seat', seat: 9, type: 'ai' });
  assert.match((await host.next('error')).msg, /No such seat/);
  // everybody on team A is refused
  host.send({ t: 'seat', seat: 0, team: 'A' }); await host.state();
  host.send({ t: 'seat', seat: 1, team: 'A' }); await host.state();
  host.send({ t: 'seat', seat: 2, team: 'A' });
  await host.state().catch(() => null); // seat 2 is open: this is accepted (team B seat 3 remains)
  host.send({ t: 'seat', seat: 3, team: 'A' });
  assert.match((await host.next('error')).msg, /two sides/);
  host.close(); guest.close();
}));

test('"fill with computers" starts the game; the host seat cannot be turned into a computer', withServer(async ({ url }) => {
  const host = await Client.connect(url, 'Host');
  host.send({ t: 'create', mode: 'hex', size: 'small', players: 5 });
  await host.state();
  host.send({ t: 'seat', seat: 0, type: 'ai' });
  assert.match((await host.next('error')).msg, /taken by a person/);
  host.send({ t: 'fillAI', level: 'easy' });
  const v = (await host.until((x) => x.phase === 'setup')).view;
  assert.deepEqual(v.players.map((p) => p.type), ['human', 'ai', 'ai', 'ai', 'ai']);
  assert.ok(v.players.slice(1).every((p) => p.level === 'easy' && p.ready));
  host.close();
}));

test('two people and a computer: joining fills the seats, setup validation uses each person\'s own camp', withServer(async ({ url }) => {
  const a = await Client.connect(url, 'Alice');
  a.send({ t: 'create', mode: 'hex', size: 'small', players: 3, ai: 1, level: 'easy' });
  const code = (await a.state()).view.code;
  const b = await Client.connect(url, 'Bob');
  b.send({ t: 'join', code });
  const [va, vb] = (await Promise.all([a.until((x) => x.phase === 'setup'), b.until((x) => x.phase === 'setup')])).map((m) => m.view);
  assert.deepEqual([va.you, vb.you], ['red', 'blue']);
  // Bob cannot place pieces in Alice's camp
  b.send({ t: 'setup', placements: setupFor(va) });
  assert.match((await b.next('error')).msg, /own territory/);
  a.send({ t: 'setup', placements: setupFor(va) });
  const mid = await a.state((x) => me(x).ready);
  assert.equal(mid.view.phase, 'setup');
  b.send({ t: 'setup', placements: setupFor(vb) });
  const [pa, pb] = (await Promise.all([a.until((x) => x.phase === 'play'), b.until((x) => x.phase === 'play')])).map((m) => m.view);
  assert.equal(pa.turn, 'red'); assert.equal(pb.turn, 'red');
  a.close(); b.close();
}));

test('teammates see each other\'s armies; opponents do not', withServer(async ({ url }) => {
  const a = await Client.connect(url, 'Alice');
  a.send({ t: 'create', mode: 'hex', size: 'small', players: 4, ai: 2, level: 'easy', teams: ['A', 'B', 'A', 'B'] });
  const code = (await a.state()).view.code;
  const b = await Client.connect(url, 'Bob'); // joins seat 1 (blue, team B)
  b.send({ t: 'join', code });
  const [va, vb] = (await Promise.all([a.until((x) => x.phase === 'setup'), b.until((x) => x.phase === 'setup')])).map((m) => m.view);
  assert.deepEqual(va.players.map((p) => p.team), ['A', 'B', 'A', 'B']);
  a.send({ t: 'setup', placements: setupFor(va) });
  b.send({ t: 'setup', placements: setupFor(vb) });
  const [pa, pb] = (await Promise.all([a.until((x) => x.phase === 'play'), b.until((x) => x.phase === 'play')])).map((m) => m.view);
  const ranksOf = (view, color) => view.board.filter((p) => p && p.o === color).map((p) => p.r);
  // Alice (red, team A): her ally is green (seat 3); blue and yellow are enemies
  assert.ok(ranksOf(pa, 'red').every(Number.isInteger));
  assert.ok(ranksOf(pa, 'green').every(Number.isInteger), 'an ally\'s army is visible');
  assert.ok(ranksOf(pa, 'blue').every((r) => r === null), 'enemies are hidden');
  assert.ok(ranksOf(pa, 'yellow').every((r) => r === null));
  // Bob (blue, team B): his ally is yellow
  assert.ok(ranksOf(pb, 'yellow').every(Number.isInteger));
  assert.ok(ranksOf(pb, 'red').every((r) => r === null));
  assert.ok(ranksOf(pb, 'green').every((r) => r === null));
  // allies cannot attack each other: none of Alice's legal moves ends on a green piece
  const green = new Set(pa.board.map((p, i) => (p && p.o === 'green' ? i : -1)).filter((i) => i >= 0));
  assert.ok(pa.moves.every(([, to]) => !green.has(to)));
  a.close(); b.close();
}));

test('when a person leaves a running hexagon game it carries on without them', withServer(async ({ url }) => {
  const a = await Client.connect(url, 'Alice');
  a.send({ t: 'create', mode: 'hex', size: 'small', players: 3, ai: 1, level: 'easy' });
  const code = (await a.state()).view.code;
  const b = await Client.connect(url, 'Bob');
  b.send({ t: 'join', code });
  const [va, vb] = (await Promise.all([a.until((x) => x.phase === 'setup'), b.until((x) => x.phase === 'setup')])).map((m) => m.view);
  a.send({ t: 'setup', placements: setupFor(va) });
  b.send({ t: 'setup', placements: setupFor(vb) });
  await Promise.all([a.until((x) => x.phase === 'play'), b.until((x) => x.phase === 'play')]);
  b.send({ t: 'leave' });
  const after = await a.state((x) => x.players[1].left);
  assert.equal(after.view.phase, 'play', 'the game goes on');
  assert.equal(after.view.players[1].out, 'left');
  assert.equal(after.view.players[1].alive, false);
  assert.ok(after.view.board.every((p) => !p || p.o !== 'blue'), 'their pieces leave the board');
  assert.equal(after.event.type, 'out');
  // Alice can still play, and the computer answers
  const v = (await a.until((x) => x.turn === 'red')).view;
  const [from, to] = v.moves[0];
  a.send({ t: 'move', from, to });
  const reply = await a.next('state', (m) => m.event && m.event.owner === 'green', 8000);
  assert.ok(reply);
  a.close();
}));

test('resigning drops you out but the others play on; the last person standing wins the game', withServer(async ({ url }) => {
  const a = await Client.connect(url, 'Alice');
  a.send({ t: 'create', mode: 'hex', size: 'small', players: 2, ai: 0 });
  const code = (await a.state()).view.code;
  const b = await Client.connect(url, 'Bob');
  b.send({ t: 'join', code });
  const [va, vb] = (await Promise.all([a.until((x) => x.phase === 'setup'), b.until((x) => x.phase === 'setup')])).map((m) => m.view);
  a.send({ t: 'setup', placements: setupFor(va) });
  b.send({ t: 'setup', placements: setupFor(vb) });
  await Promise.all([a.until((x) => x.phase === 'play'), b.until((x) => x.phase === 'play')]);
  b.send({ t: 'resign' });
  const over = await a.state((x) => x.phase === 'over');
  assert.deepEqual([over.view.result.won, over.view.result.reason, over.view.result.winners], [true, 'resigned', ['red']]);
  b.send({ t: 'resign' });
  assert.match((await b.next('error')).msg, /not in progress/);
  a.close(); b.close();
}));

test('rematch in a hexagon game rotates who moves first and puts the computers back to work', withServer(async ({ url }) => {
  const { a, view } = await soloVsComputers(url);
  a.send({ t: 'setup', placements: setupFor(view) });
  await a.until((x) => x.phase === 'play');
  a.send({ t: 'resign' });
  const over = await a.state((x) => x.phase === 'over');
  assert.equal(over.view.result.won, false);
  a.send({ t: 'rematch' });
  const again = await a.state((x) => x.phase === 'setup');
  assert.equal(again.view.players[1].ready, true);
  a.send({ t: 'setup', placements: setupFor(again.view) });
  // the second game starts with seat 2 (blue, a computer) moving first
  const start = await a.next('state', (m) => m.event && m.event.owner === 'blue', 8000);
  assert.ok(start);
  a.close();
}));

test('a room whose people have all gone disappears and its computers stop', withServer(async ({ url, http, game }) => {
  const { a, view } = await soloVsComputers(url);
  a.send({ t: 'setup', placements: setupFor(view) });
  await a.until((x) => x.phase === 'play');
  a.send({ t: 'leave' });
  await a.next('lobby');
  const h = await (await fetch(`${http}/health`)).json();
  assert.equal(h.games, 0);
  assert.equal([...game.lobby.rooms.values()].length, 0);
}));

test('a whole hexagon game: one person plays randomly against two computers', withServer(async ({ url }) => {
  const { a, view } = await soloVsComputers(url);
  a.send({ t: 'setup', placements: setupFor(view) });
  let v = (await a.until((x) => x.phase === 'play')).view;
  let plies = 0;
  while (v.phase === 'play' && plies < 1500) {
    if (v.turn === 'red' && v.moves.length) {
      const [from, to] = v.moves[Math.floor(Math.random() * v.moves.length)];
      a.send({ t: 'move', from, to });
      plies++;
    }
    v = (await a.next('state', () => true, 10000)).view;
  }
  if (v.phase === 'over') {
    assert.ok(v.result.winners.length >= 1);
    assert.ok(v.board.every((p) => !p || Number.isInteger(p.r)), 'revealed at the end');
  }
  a.close();
}, { maxMsgsPerSec: 100000 }));
