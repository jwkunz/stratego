import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, startServer, startedPair, bothReady, setupFor, configOf } from './helpers.js';
import { randomSetup, randomSetupFor, makeHexConfig } from '../../single/web/src/game.js';

const withServer = (fn, lobbyOpts) => async () => {
  const s = await startServer(lobbyOpts);
  try { await fn(s); } finally { await s.game.close(); }
};
const me = (v) => v.players.find((p) => p.isMe);

test('hello gives a token and the lobby lists open games', withServer(async ({ url }) => {
  const a = await Client.connect(url, 'Alice');
  assert.ok(a.token && a.token.length >= 32);
  const b = await Client.connect(url, 'Bob');
  a.send({ t: 'create', size: 12 });
  const lobby = await b.next('lobby', (m) => m.rooms.length === 1);
  assert.deepEqual(lobby.rooms.map((r) => [r.host, r.mode, r.size, r.players, r.open, r.ai]), [['Alice', 'square', 12, 2, 1, 0]]);
  assert.equal(lobby.rooms[0].code.length, 4);
}));

test('creating and joining a classic game puts both people in setup with opposite colours', withServer(async ({ url }) => {
  const { a, b } = await startedPair(url);
  assert.deepEqual([a.color, b.color].sort(), ['blue', 'red']);
  assert.equal(a.view.mode, 'square');
  assert.deepEqual(a.view.players.map((p) => p.color), ['red', 'blue']);
  const c = await Client.connect(url, 'Carol');
  c.send({ t: 'list' });
  assert.equal((await c.next('lobby')).rooms.length, 0, 'a full game is no longer listed');
}));

test('setups are validated', withServer(async ({ url }) => {
  const { red, blue } = await startedPair(url);
  const bad = async (client, placements, re) => {
    client.send({ t: 'setup', placements });
    assert.match((await client.next('error')).msg, re);
  };
  await bad(red, {}, /all of your pieces/);
  const mine = randomSetup('red', 10);
  const keys = Object.keys(mine);
  const outside = { ...mine }; delete outside[keys[0]]; outside[0] = mine[keys[0]]; // cell 0 is blue's territory
  await bad(red, outside, /own territory/);
  const wrongArmy = { ...mine }; wrongArmy[keys[0]] = 11; wrongArmy[keys[1]] = 11;
  await bad(red, wrongArmy, /right army|Unknown/);
  await bad(blue, randomSetup('red', 10), /own territory/);
  await bad(red, [1, 2, 3], /Invalid/);
}));

test('opponent ranks stay hidden until revealed', withServer(async ({ url }) => {
  const pair = await startedPair(url);
  const [rv, bv] = await bothReady(pair);
  for (const v of [rv, bv]) {
    const own = v.board.filter((p) => p && p.o === v.you);
    const theirs = v.board.filter((p) => p && p.o !== v.you);
    assert.equal(own.length, 40); assert.equal(theirs.length, 40);
    assert.ok(own.every((p) => Number.isInteger(p.r)), 'own ranks are visible');
    assert.ok(theirs.every((p) => p.r === null && p.v === false), 'enemy ranks must not leak');
  }
  assert.equal(rv.turn, 'red'); assert.equal(bv.turn, 'red');
  assert.ok(rv.moves.length > 0); assert.equal(bv.moves.length, 0);
}));

test('turn order and move legality are enforced; quiet moves do not leak the mover\'s rank', withServer(async ({ url }) => {
  const pair = await startedPair(url);
  const [rv] = await bothReady(pair);
  pair.blue.send({ t: 'move', from: 0, to: 10 });
  assert.match((await pair.blue.next('error')).msg, /not your turn/);
  pair.red.send({ t: 'move', from: 0, to: 1 });
  assert.match((await pair.red.next('error')).msg, /Illegal/);
  pair.red.send({ t: 'move', from: 'x', to: 'y' });
  assert.match((await pair.red.next('error')).msg, /Illegal/);

  const [from, to] = rv.moves[0];
  pair.red.send({ t: 'move', from, to });
  const [afterRed, afterBlue] = await Promise.all([pair.red.next('state'), pair.blue.next('state')]);
  assert.equal(afterRed.view.turn, 'blue'); assert.equal(afterBlue.view.turn, 'blue');
  assert.equal(afterRed.event.type, 'move');
  assert.equal(afterRed.event.mine, true); assert.equal(afterBlue.event.mine, false);
  assert.equal(afterRed.event.owner, 'red');
  assert.equal(afterBlue.event.attacker, undefined, 'a quiet move must not leak the mover\'s rank');
  assert.notEqual(afterRed.event.attacker, undefined);
  const seen = afterBlue.view.board[to];
  assert.ok(seen && seen.o === 'red' && seen.r === null && seen.m === true);
}));

test('resigning ends the game and reveals the board', withServer(async ({ url }) => {
  const pair = await startedPair(url);
  await bothReady(pair);
  pair.blue.send({ t: 'resign' });
  const [r, b] = await Promise.all([pair.red.state((v) => v.phase === 'over'), pair.blue.state((v) => v.phase === 'over')]);
  assert.deepEqual([r.view.result.won, b.view.result.won], [true, false]);
  assert.equal(r.view.result.reason, 'resigned');
  assert.ok(r.view.board.every((p) => !p || Number.isInteger(p.r)), 'everything is revealed at the end');
  assert.equal(r.view.players.find((p) => p.color === 'blue').out, 'resigned');
}));

test('rematch needs everyone and swaps the sides on the classic board', withServer(async ({ url }) => {
  const pair = await startedPair(url);
  await bothReady(pair);
  pair.red.send({ t: 'resign' });
  await pair.red.state((v) => v.phase === 'over');
  pair.red.send({ t: 'rematch' });
  const waiting = await pair.red.state((v) => me(v).rematch);
  assert.equal(waiting.view.phase, 'over');
  pair.blue.send({ t: 'rematch' });
  const [r, b] = await Promise.all([pair.red.state((v) => v.phase === 'setup'), pair.blue.state((v) => v.phase === 'setup')]);
  assert.equal(r.view.you, 'blue'); assert.equal(b.view.you, 'red');
}));

test('lakes can be re-rolled by the host on big boards only', withServer(async ({ url }) => {
  const small = await startedPair(url, 10);
  small.a.send({ t: 'lakes' });
  assert.match((await small.a.next('error')).msg, /fixed lakes/);
  const big = await startedPair(url, 12);
  const host = big.a, guest = big.b;
  guest.send({ t: 'lakes' });
  assert.match((await guest.next('error')).msg, /Only the host/);
  host.send({ t: 'lakes' });
  const [x, y] = await Promise.all([host.state(), guest.state()]);
  assert.deepEqual(x.view.lakes, y.view.lakes);
}));

test('a player can reconnect with their token and gets the same game back', withServer(async ({ url }) => {
  const pair = await startedPair(url);
  await bothReady(pair);
  const token = pair.blue.token;
  pair.blue.close();
  const gone = await pair.red.state((v) => v.players.some((p) => p.color === 'blue' && !p.connected));
  assert.equal(gone.view.phase, 'play');
  const back = new Client(url, 'Bob', token);
  await back.opened;
  back.send({ t: 'hello', token });
  const st = await back.state((v) => v.phase === 'play');
  assert.equal(st.view.you, pair.blue.color);
  const again = await pair.red.state((v) => v.players.every((p) => p.connected));
  assert.ok(again.view);
}));

test('a player who stays away drops out after the grace period', withServer(async ({ url }) => {
  const pair = await startedPair(url);
  await bothReady(pair);
  pair.blue.close();
  const over = await pair.red.state((v) => v.phase === 'over');
  assert.deepEqual([over.view.result.won, over.view.result.reason], [true, 'abandoned']);
}, { graceMs: 150 }));

test('leaving mid-game drops you out; leaving a waiting room deletes it', withServer(async ({ url }) => {
  const pair = await startedPair(url);
  await bothReady(pair);
  pair.red.send({ t: 'leave' });
  const over = await pair.blue.state((v) => v.phase === 'over');
  assert.equal(over.view.result.reason, 'left');
  assert.ok(over.view.players.find((p) => p.color === pair.red.color).left);
  pair.blue.send({ t: 'rematch' });
  assert.match((await pair.blue.next('error')).msg, /No rematch/);

  const c = await Client.connect(url, 'Carol');
  c.send({ t: 'create', size: 10 });
  await c.state();
  c.send({ t: 'leave' });
  assert.equal((await c.next('lobby')).rooms.length, 0);
}));

test('protocol abuse is rejected politely', withServer(async ({ url }) => {
  const raw = new Client(url, 'Raw');
  await raw.opened;
  raw.send({ t: 'create', size: 10 });
  assert.match((await raw.next('error')).msg, /hello/);
  raw.ws.send('not json');
  assert.match((await raw.next('error')).msg, /Bad message/);
  raw.send({ t: 'hello', name: '<b>Evil\u0007</b> name that is far too long to keep' });
  const w = await raw.next('welcome');
  assert.ok(!/[<>\u0007]/.test(w.name) && w.name.length <= 20);
  for (const [msg, re] of [
    [{ t: 'create', size: 7 }, /Unsupported board size/],
    [{ t: 'create', mode: 'hex', size: 'huge' }, /Unsupported board size/],
    [{ t: 'create', mode: 'hex', players: 9 }, /2 to 6/],
    [{ t: 'create', mode: 'hex', players: 3, ai: 3 }, /at least one human/],
    [{ t: 'create', mode: 'hex', players: 3, level: 'godlike' }, /difficulty/],
    [{ t: 'create', mode: 'hex', players: 4, teams: ['A', 'A', 'A', 'A'] }, /two sides/],
    [{ t: 'create', mode: 'hex', players: 3, teams: ['Z'] }, /Invalid teams/],
    [{ t: 'join', code: 'ZZZZ' }, /No game/],
    [{ t: 'bogus' }, /not in a game/],
  ]) {
    raw.send(msg);
    assert.match((await raw.next('error')).msg, re, JSON.stringify(msg));
  }
}));

test('cross-origin WebSocket connections are refused, same-origin ones are fine', withServer(async ({ url, port }) => {
  const evil = new Client(url, 'Evil', undefined, { Origin: 'http://evil.example' });
  await assert.rejects(evil.opened);
  const ok = new Client(url, 'Ok', undefined, { Origin: `http://127.0.0.1:${port}` });
  await ok.opened;
  ok.close();
}));

test('http: health endpoint, missing client, no traversal, no writes', withServer(async ({ http }) => {
  const h = await fetch(`${http}/health`);
  assert.equal(h.status, 200);
  assert.equal((await h.json()).ok, true);
  assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(`${http}/`)).status, 503);
  assert.equal((await fetch(`${http}/..%2f..%2fetc%2fpasswd`)).status, 403);
  assert.equal((await fetch(`${http}/`, { method: 'POST' })).status, 405);
}));

test('two random players can play a whole classic game through the server', withServer(async ({ url }) => {
  const pair = await startedPair(url);
  const [rv, bv] = await bothReady(pair);
  const views = { red: rv, blue: bv };
  const cur = { red: pair.red, blue: pair.blue };
  for (let moves = 0; moves < 6000; moves++) {
    const mover = views.red.turn;
    const list = views[mover].moves;
    assert.ok(list.length > 0, 'the player to move always has a move');
    const [from, to] = list[Math.floor(Math.random() * list.length)];
    cur[mover].send({ t: 'move', from, to });
    const [a, b] = await Promise.all([pair.red.next('state'), pair.blue.next('state')]);
    views.red = a.view; views.blue = b.view;
    if (a.view.phase === 'over') {
      assert.ok(['flag', 'blocked'].includes(a.view.result.reason));
      assert.notEqual(a.view.result.won, b.view.result.won);
      return;
    }
  }
}, { maxMsgsPerSec: 100000 }));

test('flooding a connection gets it dropped', withServer(async ({ url }) => {
  const c = await Client.connect(url, 'Spammer');
  for (let i = 0; i < 400; i++) c.send({ t: 'list' });
  assert.equal(await c.closed, 1008);
}, { maxMsgsPerSec: 100 }));

test('every hex army is valid for the setup checks', () => {
  for (const players of [2, 3, 4, 5, 6]) {
    const cfg = makeHexConfig({ a: 6, players });
    for (const id of cfg.players) assert.ok(Object.keys(randomSetupFor(cfg, id)).length > 0);
  }
  assert.ok(configOf);
});
