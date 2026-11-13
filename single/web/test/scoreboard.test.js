import test from 'node:test';
import assert from 'node:assert/strict';
import { armyScore, armyFor, INITIAL, BOMB, FLAG } from '../src/game.js';
import { materialBalance, scoreboardHTML } from '../src/scoreboard.js';

test('armyScore sums ranks and ignores bombs and the flag', () => {
  // classic: 1 spy + 8 scouts*2 + 5 miners*3 + 4*4 + 4*5 + 4*6 + 3*7 + 2*8 + 9 + 10
  assert.equal(armyScore(INITIAL), 1 + 16 + 15 + 16 + 20 + 24 + 21 + 16 + 9 + 10);
  assert.ok(armyScore(armyFor(16)) > armyScore(armyFor(12)));
});

test('material balance picks the side that has lost fewer points', () => {
  const even = materialBalance(INITIAL, [], []);
  assert.deepEqual([even.diff, even.leader], [0, null]);
  const ahead = materialBalance(INITIAL, [2], [10, BOMB]);
  assert.equal(ahead.leader, 'me');
  assert.equal(ahead.diff, 8);
  assert.equal(materialBalance(INITIAL, [9], [3, 2]).leader, 'opp');
  assert.equal(materialBalance(INITIAL, [BOMB, FLAG], [BOMB]).leader, null, 'bombs and flags are not scored');
});

test('scoreboard marks the leader, shows names and escapes them', () => {
  const html = scoreboardHTML({
    me: { name: 'Jake', color: 'red', lost: [2] },
    opp: { name: '<img onerror=x>', color: 'blue', lost: [10] },
    army: INITIAL,
  });
  assert.match(html, /sp me lead/);
  assert.match(html, /leads by 8/);
  assert.match(html, /Jake/);
  assert.ok(!html.includes('<img'), 'names must be escaped');
  assert.match(html, /&lt;img onerror=x&gt;/);
  assert.match(scoreboardHTML({ me: { name: 'A', color: 'red', lost: [] }, opp: { name: 'B', color: 'blue', lost: [] }, army: INITIAL }), /Material is even/);
});
