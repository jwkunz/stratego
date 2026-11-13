import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeHexConfig, createStateN, legalMoves, applyMove, randomSetupFor, sameTeam, FLAG, MINER, SCOUT,
} from '../src/game.js';
import { pickMove, DIFFICULTIES } from '../src/ai.js';

const SERGEANT = 4, CAPTAIN = 6, MAJOR = 7;
const cell = (cfg, q, r) => cfg.topo.index.get(q * 1000 + r);
function scene(cfg, pieces, revealed = []) {
  const s = createStateN({}, cfg);
  const board = s.board.slice();
  pieces.forEach(([player, rank, q, r], k) => {
    board[cell(cfg, q, r)] = { id: 7000 + k, owner: player, rank, revealed: revealed.includes(k), moved: false };
  });
  return { ...s, board };
}
const inList = (moves, m) => moves.some((x) => x.from === m.from && x.to === m.to);

test('every difficulty plays legal moves on every hex player count, with and without teams', () => {
  const layouts = [[2, null], [3, null], [4, ['A', 'B', 'A', 'B']], [5, null], [6, ['A', 'A', 'A', 'B', 'B', 'B']]];
  for (const [players, teams] of layouts) {
    const cfg = makeHexConfig({ a: 6, players, teams });
    const s = createStateN(Object.fromEntries(cfg.players.map((p) => [p, randomSetupFor(cfg, p)])), cfg);
    for (const level of DIFFICULTIES) {
      const m = pickMove(s, s.turn, level, { timeMs: 30 });
      assert.ok(m && inList(legalMoves(s, s.turn), m), `${level} with ${players} players`);
    }
  }
});

test('on a hex board all levels grab an exposed enemy flag', () => {
  const cfg = makeHexConfig({ a: 6, players: 3, lakes: [] });
  const s = scene(cfg, [
    ['red', MINER, 0, 0], ['red', FLAG, 0, 4], ['blue', FLAG, 1, 0], ['blue', SCOUT, -3, 3], ['green', FLAG, 0, -4], ['green', SCOUT, -3, -1],
  ], [2, 4, 5]); // blue's flag is face up, and green's pieces are known so there is no hidden danger
  for (const level of ['medium', 'hard']) {
    const m = pickMove(s, 'red', level, { timeMs: 40 });
    assert.equal(m.to, cell(cfg, 1, 0), level);
  }
});

// A Captain can take a revealed Sergeant, but a revealed Major next door would take the Captain back.
function poisoned() {
  const cfg = makeHexConfig({ a: 6, players: 2, lakes: [] });
  return {
    cfg,
    s: scene(cfg, [
      ['blue', CAPTAIN, 0, 0], ['blue', FLAG, 0, -5], ['blue', SCOUT, -2, -2],
      ['red', SERGEANT, 1, 0], ['red', MAJOR, 2, 0], ['red', FLAG, 0, 5],
    ], [3, 4]),
  };
}

test('hard sees the recapture on a hex board; medium takes the poisoned piece', () => {
  const { cfg, s } = poisoned();
  const poisonedMove = (m) => m.from === cell(cfg, 0, 0) && m.to === cell(cfg, 1, 0);
  for (let k = 0; k < 5; k++) assert.ok(poisonedMove(pickMove(s, 'blue', 'medium')), 'medium');
  for (let k = 0; k < 5; k++) assert.ok(!poisonedMove(pickMove(s, 'blue', 'hard', { timeMs: 60 })), 'hard');
});

test('hard never attacks teammates and respects its time budget on the largest board', () => {
  const cfg = makeHexConfig({ a: 8, players: 6, teams: ['A', 'B', 'C', 'A', 'B', 'C'] });
  let s = createStateN(Object.fromEntries(cfg.players.map((p) => [p, randomSetupFor(cfg, p)])), cfg);
  const t = performance.now();
  const m = pickMove(s, s.turn, 'hard', { timeMs: 100 });
  assert.ok(performance.now() - t < 1500, `took ${performance.now() - t}ms`);
  assert.ok(inList(legalMoves(s, s.turn), m));
  for (let ply = 0; ply < 120 && !s.winner; ply++) {
    const mv = pickMove(s, s.turn, ply % 2 ? 'medium' : 'easy', { timeMs: 20 });
    const target = s.board[mv.to];
    if (target) assert.ok(!sameTeam(s, s.turn, target.owner), 'no friendly fire');
    s = applyMove(s, mv).state;
  }
});

test('computer players can play whole hex games against each other', () => {
  for (const [players, teams] of [[3, null], [4, ['A', 'B', 'A', 'B']], [2, null]]) {
    const cfg = makeHexConfig({ a: 6, players, teams });
    let s = createStateN(Object.fromEntries(cfg.players.map((p) => [p, randomSetupFor(cfg, p)])), cfg);
    let plies = 0, captures = 0;
    while (!s.winner && plies < 4000) {
      const m = pickMove(s, s.turn, 'medium');
      assert.ok(m, 'someone to move always has a move');
      const r = applyMove(s, m);
      if (r.event.type === 'attack') captures++;
      s = r.state;
      plies++;
    }
    assert.ok(captures > 5, `there is real fighting with ${players} players`);
    if (s.winner) assert.ok(s.winners.includes(s.winner));
  }
});
