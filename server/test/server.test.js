import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, startServer, startedPair } from './helpers.js';
import { randomSetup, armyFor, territory } from '../../single/web/src/game.js';

const withServer = (fn, lobbyOpts) => async () => {
  const s = await startServer(lobbyOpts);
  try { await fn(s); } finally { await s.game.close(); }
};

async function bothReady({ red, blue }, size = 10) {
  red.send({ t: 'setup', placements: randomSetup('red', size) });
  blue.send({ t: 'setup', placements: randomSetup('blue', size) });
  const [r, b] = await Promise.all([red.state((v) => v.phase === 'play'), blue.state((v) => v.phase === 'play')]);
  return [r.view, b.view];
}

test('hello gives a token and the lobby lists open games', withServer(async ({ url }) => {
  const a = await Client.connect(url, 'Alice');
  assert.ok(a.token && a.token.length >= 32);
  const first = await a.next('lobby').catch(() => null); // may already have arrived with welcome
  const b = await Client.connect(url, 'Bob');
  a.send({ t: 'create', size: 12 });
  const lobby = await b.next('lobby', (m) => m.rooms.length === 1);
  assert.deepEqual(lobby.rooms.map((r) => [r.host, r.size]), [['Alice', 12]]);
  assert.equal(lobby.rooms[0].code.length, 4);
  void first;
}));

test('creating and joining puts both players in setup with opposite colours', withServer(async ({ url }) => {
  const { a, b } = await startedPair(url);
  assert.notEqual(a.color, b.color);
  assert.deepEqual([a.color, b.color].sort(), ['blue', 'red']);
  // the game is no longer open
  const c = await Client.connect(url, 'Carol');
  c.send({ t: 'list' });
  const lobby = await c.next('lobby');
  assert.equal(lobby.rooms.length, 0);
}));

test('setups are validated', withServer(async ({ url }) => {
  const { red, blue } = await startedPair(url);
  const bad = async (client, placements, re) => {
    client.send({ t: 'setup', placements });
    const e = await client.next('error');
    assert.match(e.msg, re);
  };
  await bad(red, {}, /all of your pieces/);
  const mine = randomSetup('red', 10);
  const [firstKey] = Object.keys(mine);
  const outside = { ...mine }; delete outside[firstKey]; outside[0] = mine[firstKey]; // square 0 is blue's territory
  await bad(red, outside, /own territory/);
  const wrongArmy = { ...mine }; const keys = Object.keys(mine); wrongArmy[keys[0]] = 11; wrongArmy[keys[1]] = 11;
  await bad(red, wrongArmy, /right army|Unknown/);
  await bad(blue, randomSetup('red', 10), /own territory/); // red's squares are not blue's
  await bad(red, [1, 2, 3], /Invalid/);
}));

test('opponent ranks stay hidden until revealed', withServer(async ({ url }) => {
  const pair = await startedPair(url);
  const [rv, bv] = await bothReady(pair);
  for (const [v, mine] of [[rv, 'red'], [bv, 'blue']]) {
    const own = v.board.filter((p) => p && p.o === 'me');
    const theirs = v.board.filter((p) => p && p.o === 'opp');
    assert.equal(own.length, 40); assert.equal(theirs.length, 40);
    assert.ok(own.every((p) => Number.isInteger(p.r)), `${mine} sees own ranks`);
    assert.ok(theirs.every((p) => p.r === null && p.v === false), `${mine} must not see enemy ranks`);
  }
  assert.equal(rv.turn, 'me'); assert.equal(bv.turn, 'opp');
  assert.ok(rv.moves.length > 0); assert.equal(bv.moves.length, 0);
}));

test('turn order and move legality are enforced', withServer(async ({ url }) => {
  const pair = await startedPair(url);
  const [rv] = await bothReady(pair);
  pair.blue.send({ t: 'move', from: 0, to: 10 });
  assert.match((await pair.blue.next('error')).msg, /not your turn/);
  pair.red.send({ t: 'move', from: 0, to: 1 }); // not red's piece
  assert.match((await pair.red.next('error')).msg, /Illegal/);
  pair.red.send({ t: 'move', from: 'x', to: 'y' });
  assert.match((await pair.red.next('error')).msg, /Illegal/);

  const [from, to] = rv.moves[0];
  pair.red.send({ t: 'move', from, to });
  const [afterRed, afterBlue] = await Promise.all([pair.red.next('state'), pair.blue.next('state')]);
  assert.equal(afterRed.view.turn, 'opp'); assert.equal(afterBlue.view.turn, 'me');
  assert.deepEqual(afterRed.event.type, 'move');
  assert.equal(afterRed.event.mine, true); assert.equal(afterBlue.event.mine, false);
  assert.equal(afterBlue.event.attacker, undefined, 'a quiet move must not leak the mover\'s rank');
  assert.equal(afterRed.event.attacker !== undefined, true);
  // the moved piece is now flagged as moved but still unknown to the opponent
  const seen = afterBlue.view.board[to];
  assert.ok(seen && seen.o === 'opp' && seen.r === null && seen.m === true);
}));

test('resigning ends the game and reveals the board', withServer(async ({ url }) => {
  const pair = await startedPair(url);
  await bothReady(pair);
  pair.blue.send({ t: 'resign' });
  const [r, b] = await Promise.all([pair.red.state((v) => v.phase === 'over'), pair.blue.state((v) => v.phase === 'over')]);
  assert.deepEqual([r.view.result, b.view.result].map((x) => [x.winner, x.reason]), [['me', 'resigned'], ['opp', 'resigned']]);
  assert.ok(r.view.board.every((p) => !p || Number.isInteger(p.r)), 'everything is revealed at the end');
}));

test('rematch needs both players and swaps the sides', withServer(async ({ url }) => {
  const pair = await startedPair(url);
  await bothReady(pair);
  pair.red.send({ t: 'resign' });
  await pair.red.state((v) => v.phase === 'over');
  pair.red.send({ t: 'rematch' });
  const waiting = await pair.red.state((v) => v.rematch.me);
  assert.equal(waiting.view.phase, 'over');
  pair.blue.send({ t: 'rematch' });
  const [r, b] = await Promise.all([pair.red.state((v) => v.phase === 'setup'), pair.blue.state((v) => v.phase === 'setup')]);
  assert.equal(r.view.you, 'blue'); assert.equal(b.view.you, 'red');
}));

test('lakes can be re-rolled by the host on big boards only', withServer(async ({ url }) => {
  const small = await startedPair(url, 10);
  const host = small.a;
  host.send({ t: 'lakes' });
  assert.match((await host.next('error')).msg, /fixed lakes/);
  const big = await startedPair(url, 12);
  big.b.send({ t: 'lakes' });
  assert.match((await big.b.next('error')).msg, /Only the host/);
  big.a.send({ t: 'lakes' });
  const [x, y] = await Promise.all([big.a.state(), big.b.state()]);
  assert.deepEqual(x.view.lakes, y.view.lakes);
}));

test('a player can reconnect with their token and gets the same game back', withServer(async ({ url }) => {
  const pair = await startedPair(url);
  await bothReady(pair);
  const token = pair.blue.token;
  pair.blue.close();
  const gone = await pair.red.state((v) => v.opp && !v.opp.connected);
  assert.equal(gone.view.phase, 'play');
  const back = new Client(url, 'Bob', token);
  await back.opened;
  back.send({ t: 'hello', token });
  const st = await back.state((v) => v.phase === 'play');
  assert.equal(st.view.you, pair.blue.color);
  const again = await pair.red.state((v) => v.opp && v.opp.connected);
  assert.ok(again.view.opp.connected);
}));

test('a player who stays away forfeits after the grace period', withServer(async ({ url }) => {
  const pair = await startedPair(url);
  await bothReady(pair);
  pair.blue.close();
  const over = await pair.red.state((v) => v.phase === 'over');
  assert.deepEqual([over.view.result.winner, over.view.result.reason], ['me', 'abandoned']);
}, { graceMs: 150 }));

test('leaving mid-game forfeits; leaving a waiting room deletes it', withServer(async ({ url }) => {
  const pair = await startedPair(url);
  await bothReady(pair);
  pair.red.send({ t: 'leave' });
  const over = await pair.blue.state((v) => v.phase === 'over');
  assert.equal(over.view.result.reason, 'left');
  assert.equal(over.view.opp.left, true);
  pair.blue.send({ t: 'rematch' });
  assert.match((await pair.blue.next('error')).msg, /No rematch/);

  const c = await Client.connect(url, 'Carol');
  c.send({ t: 'create', size: 10 });
  await c.state();
  c.send({ t: 'leave' });
  const lobby = await c.next('lobby');
  assert.equal(lobby.rooms.length, 0);
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
  raw.send({ t: 'create', size: 7 });
  assert.match((await raw.next('error')).msg, /Unsupported board size/);
  raw.send({ t: 'join', code: 'ZZZZ' });
  assert.match((await raw.next('error')).msg, /No game/);
  raw.send({ t: 'bogus' });
  assert.match((await raw.next('error')).msg, /not in a game/);
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
  assert.equal((await fetch(`${http}/`)).status, 503); // test server has no built client
  assert.equal((await fetch(`${http}/..%2f..%2fetc%2fpasswd`)).status, 403);
  assert.equal((await fetch(`${http}/`, { method: 'POST' })).status, 405);
}));

test('two random players can play a whole game through the server', withServer(async ({ url }) => {
  const pair = await startedPair(url);
  let [rv, bv] = await bothReady(pair);
  const views = { red: rv, blue: bv };
  let moves = 0;
  const cur = { red: pair.red, blue: pair.blue };
  while (moves < 6000) {
    const mover = views.red.turn === 'me' ? 'red' : 'blue';
    const list = views[mover].moves;
    assert.ok(list.length > 0, 'the player to move always has a move');
    const [from, to] = list[Math.floor(Math.random() * list.length)];
    cur[mover].send({ t: 'move', from, to });
    const [a, b] = await Promise.all([pair.red.next('state'), pair.blue.next('state')]);
    views.red = a.view; views.blue = b.view; moves++;
    if (a.view.phase === 'over') {
      assert.ok(['flag', 'blocked'].includes(a.view.result.reason));
      assert.notEqual(a.view.result.winner, b.view.result.winner);
      return;
    }
  }
  // not finishing in 6000 random plies is acceptable; the point is that nothing broke
}, { maxMsgsPerSec: 100000 }));

test('flooding a connection gets it dropped', withServer(async ({ url }) => {
  const c = await Client.connect(url, 'Spammer');
  for (let i = 0; i < 400; i++) c.send({ t: 'list' });
  assert.equal(await c.closed, 1008);
}, { maxMsgsPerSec: 100 }));

test('army counts match the engine for every size', () => {
  for (const n of [10, 12, 16, 20]) {
    const s = randomSetup('red', n);
    assert.equal(Object.keys(s).length, Object.values(armyFor(n)).reduce((x, y) => x + y, 0));
    assert.ok(territory('red', n).length > 0);
  }
});
