// Who is ahead on material? Shared by the single-player game and the multiplayer client.
// Material is counted on the same scale as the loss totals: a piece is worth its rank (Spy 1 ... Marshal 10);
// bombs and flags are not scored. All armies start equal, so "ahead" simply means "has lost fewer points".
// With teams, the teams' combined material is compared.
import { armyScore, totalScore } from './game.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Two-player material balance.
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
 * Material standings for any number of players.
 * players: [{ name, color, lost: number[], alive?: boolean, team?: string|null, isMe?: boolean, extra?: html }]
 * Players with the same non-empty `team` are compared as one group; everybody else is a group of one.
 * Returns { rows (with .rem, .group, .leader), groups: [{key, total, alive}], leader: key|null, lead: number }.
 */
export function standings(army, players) {
  const start = armyScore(army);
  const rows = players.map((p, i) => ({ ...p, rem: p.alive === false ? 0 : start - totalScore(p.lost), group: p.team || `solo-${i}` }));
  const groups = new Map();
  for (const r of rows) {
    const g = groups.get(r.group) || { key: r.group, total: 0, alive: false, size: 0 };
    g.total += r.rem; g.size++; g.alive = g.alive || r.alive !== false;
    groups.set(r.group, g);
  }
  const live = [...groups.values()].filter((g) => g.alive).sort((a, b) => b.total - a.total);
  const leader = live.length && (live.length === 1 || live[0].total > live[1].total) ? live[0].key : null;
  const lead = leader ? live[0].total - (live[1] ? live[1].total : 0) : 0;
  rows.forEach((r) => { r.leader = r.group === leader; });
  return { rows, groups: [...groups.values()], leader, lead, teamGame: [...groups.values()].some((g) => g.size > 1) };
}

/**
 * HTML for the scoreboard: remaining material for everyone, a balance bar, and the leader highlighted.
 * Either { me, opp, army } for two players, or { players, army } for any number (see `standings`).
 */
export function scoreboardHTML({ me, opp, players, army }) {
  const list = players || [{ ...me, isMe: true }, { ...opp }];
  const st = standings(army, list);
  const total = st.rows.reduce((s, r) => s + r.rem, 0);
  const firstOfLeader = st.rows.findIndex((r) => r.leader);
  const row = (r, i) => `<div class="sp ${r.isMe ? 'me' : 'opp'} ${r.leader ? 'lead' : ''} ${r.alive === false ? 'out' : ''}">
      <span class="swatch ${r.color}"></span>
      <span class="who">${r.leader ? '👑 ' : ''}${esc(r.name)}${r.isMe ? '<em> (you)</em>' : ''}</span>${st.teamGame && r.team ? `<span class="teamtag" title="Team ${esc(r.team)}">${esc(r.team)}</span>` : ''}${r.extra || ''}
      ${r.leader && i === firstOfLeader ? `<span class="tag">${st.teamGame && st.groups.find((g) => g.key === r.group).size > 1 ? 'team ' : ''}leads by ${st.lead}</span>` : ''}
      ${r.alive === false ? '<span class="tag out">out</span>' : `<span class="rem" title="Points of material remaining">${r.rem}</span>`}</div>`;
  const bar = st.rows.filter((r) => r.rem > 0).map((r) => `<i class="${r.color}" style="width:${total ? (r.rem / total) * 100 : 0}%"></i>`).join('');
  const leaderName = st.rows.find((r) => r.leader);
  const note = st.leader
    ? `${leaderName.isMe ? 'You are' : (st.teamGame && leaderName.team ? `Team ${esc(leaderName.team)} is` : `${esc(leaderName.name)} is`)} ahead on material`
    : 'Material is even';
  return `<div class="score" aria-label="Material">
    ${st.rows.map(row).join('')}
    <div class="bar" role="img" aria-label="Material balance ${st.rows.map((r) => r.rem).join(' to ')}">${bar}</div>
    <div class="muted-note">${note} · points left, pieces count their rank</div>
  </div>`;
}
