// Who is ahead on material? Shared by the single-player game and the multiplayer client.
// Material is counted on the same scale as the loss totals: a piece is worth its rank (Spy 1 ... Marshal 10);
// bombs and flags are not scored. Both armies start equal, so "ahead" simply means "has lost fewer points".
import { armyScore, totalScore } from './game.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * @param {{[rank:number]:number}} army  starting army (rank -> count) of each side
 * @param {number[]} lostMe   ranks I have lost
 * @param {number[]} lostOpp  ranks my opponent has lost
 * @returns {{me:number, opp:number, diff:number, leader:'me'|'opp'|null}}  points of material left; diff > 0 favours me
 */
export function materialBalance(army, lostMe, lostOpp) {
  const start = armyScore(army);
  const me = start - totalScore(lostMe);
  const opp = start - totalScore(lostOpp);
  const diff = me - opp;
  return { me, opp, diff, leader: diff > 0 ? 'me' : diff < 0 ? 'opp' : null };
}

/**
 * HTML for the scoreboard: both players, remaining material, a balance bar, and the leader highlighted.
 * `me` / `opp`: { name, color: 'red'|'blue', lost: number[], extra?: trusted HTML shown after the name }.
 */
export function scoreboardHTML({ me, opp, army }) {
  const b = materialBalance(army, me.lost, opp.lost);
  const share = b.me + b.opp > 0 ? Math.round((b.me / (b.me + b.opp)) * 100) : 50;
  const row = (who, p, side, tag) => `<div class="sp ${side} ${b.leader === side ? 'lead' : ''}">
      <span class="swatch ${p.color}"></span>
      <span class="who">${b.leader === side ? '👑 ' : ''}${esc(p.name)}${who ? `<em> (${who})</em>` : ''}</span>${p.extra || ''}
      ${b.leader === side ? `<span class="tag">leads by ${Math.abs(b.diff)}</span>` : ''}
      <span class="rem" title="Points of material remaining">${tag}</span></div>`;
  return `<div class="score" aria-label="Material">
    ${row('you', me, 'me', b.me)}
    <div class="bar" role="img" aria-label="Material balance ${b.me} to ${b.opp}"><i class="${me.color}" style="width:${share}%"></i><i class="${opp.color}" style="width:${100 - share}%"></i></div>
    ${row('', opp, 'opp', b.opp)}
    <div class="muted-note">${b.leader ? `${b.leader === 'me' ? 'You are' : esc(opp.name) + ' is'} ahead on material` : 'Material is even'} · points left, pieces count their rank</div>
  </div>`;
}
