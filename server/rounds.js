// "Rounds (2 losses out)": every robot with fewer than two losses fights once per round, paired with robots on the
// same record. An odd count leaves one robot sitting out (stored as a robot-vs-bye match, so the bracket resolver
// treats it as an automatic advance). Robots only ever run one round ahead of each other, and sit-outs go to the robots
// with the fewest, which keeps every live robot's battle count within one of the others.
//
// The next round fills in as battles end: robots on the same record who are waiting are paired straight away, and the
// rest are paired once the current round's last battle is decided. Pure functions only: the client imports this through
// server/bracket.js, and callers pass in the resolved bracket.

const SEARCH_STEPS = 20000;
const pairKey = (first, second) => [first, second].sort().join('|');

// Robots from the same team are paired like a rematch: only when no other pairing works.
function teammates(robots) {
  const keys = new Set();
  const byTeam = new Map();
  for (const robot of robots) {
    const team = (robot.team ?? '').trim().toLowerCase();
    byTeam.set(team, [...(byTeam.get(team) ?? []), robot]);
  }
  for (const group of byTeam.values()) {
    group.forEach((first, index) => group.slice(index + 1).forEach(second => keys.add(pairKey(first.id, second.id))));
  }
  return keys;
}

// Each entered robot's record, plus the latest round it is in and whether that battle is still undecided.
// Seeds follow roster order among the robots entered in round 1.
function records(division, bracket) {
  const matches = division.matches.filter(match => match.side === 'R');
  const entered = new Set(matches.filter(match => match.round === 1)
    .flatMap(match => match.slots.filter(slot => slot.kind === 'robot').map(slot => slot.id)));
  const entries = division.robots.filter(robot => entered.has(robot.id)).map((robot, seed) => ({
    id: robot.id, seed, wins: 0, losses: 0, battles: 0, sitOuts: 0, out: null, round: 0, busy: false,
    withdrawn: robot.withdrawn === true,
  }));
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  for (const stored of matches) {
    const match = bracket.get(stored.id);
    for (const id of match.entrants) {
      const entry = byId.get(id);
      if (entry && match.round >= entry.round) Object.assign(entry, { round: match.round, busy: !match.settled });
    }
    if (match.state === 'bye') {
      const entry = byId.get(match.winner);
      if (entry) entry.sitOuts++;
    } else if (match.state === 'done') {
      const winner = byId.get(match.winner);
      const loser = byId.get(match.loser);
      if (winner) Object.assign(winner, { wins: winner.wins + 1, battles: winner.battles + 1 });
      if (loser) {
        Object.assign(loser, { losses: loser.losses + 1, battles: loser.battles + 1 });
        if (loser.losses === 2) loser.out = match.round;
      }
    }
  }
  return entries.map(entry => {
    const out = entry.out ?? (entry.withdrawn ? entry.round : null);
    return { ...entry, out, alive: out === null };
  });
}

export function roundStandings(division, bracket) {
  return records(division, bracket).map(({ busy, round, ...entry }) => entry);
}

export function roundsFinished(division, bracket) {
  const matches = division.matches.filter(match => match.side === 'R');
  return matches.length > 0 && matches.every(match => bracket.get(match.id).settled)
    && records(division, bracket).filter(entry => entry.alive).length <= 1;
}

// The highest unpaired robot meets the robot half its record group below it (seed 1 vs n/2 + 1 on an even group),
// then the rest of its group, then robots on the next record. Rematches are avoided when any pairing allows it.
function search(pool, met, avoidRematches, budget) {
  if (!pool.length) return [];
  if (--budget.steps < 0) return null;
  const [first, ...rest] = pool;
  const group = rest.filter(entry => entry.losses === first.losses);
  const others = rest.filter(entry => entry.losses !== first.losses);
  const half = Math.max(Math.floor((group.length + 1) / 2) - 1, 0);
  const candidates = [...group.slice(half), ...group.slice(0, half).reverse(), ...others];
  for (const partner of candidates) {
    if (avoidRematches && met.has(pairKey(first.id, partner.id))) continue;
    const remaining = search(rest.filter(entry => entry !== partner), met, avoidRematches, budget);
    if (remaining) return [[first.id, partner.id], ...remaining];
  }
  return null;
}

// The robot that should sit out: fewest sit-outs, then from the odd record group, then most losses, then lowest seed.
function sitOutChoice(pool) {
  const fewest = Math.min(...pool.map(entry => entry.sitOuts));
  const oddGroup = losses => pool.filter(entry => entry.losses === losses).length % 2;
  return pool.filter(entry => entry.sitOuts === fewest)
    .toSorted((a, b) => oddGroup(b.losses) - oddGroup(a.losses) || b.losses - a.losses || b.seed - a.seed)[0];
}

// players: robots as { id, seed, losses, sitOuts }. Returns { pairs: [[id, id]...], sitOut: id | null }.
export function pairRound(players, met = new Set()) {
  const pool = players.toSorted((a, b) => a.losses - b.losses || a.seed - b.seed);
  const sitOut = pool.length % 2 ? sitOutChoice(pool) : null;
  if (sitOut) pool.splice(pool.indexOf(sitOut), 1);
  const pairs = search(pool, met, true, { steps: SEARCH_STEPS }) ?? search(pool, met, false, { steps: Infinity });
  return { pairs, sitOut: sitOut?.id ?? null };
}

function roundMatches(round, start, { pairs, sitOut }, stage) {
  const robot = id => ({ kind: 'robot', id });
  const slots = [...pairs.map(pair => pair.map(robot)), ...(sitOut ? [[robot(sitOut), { kind: 'bye' }]] : [])];
  return slots.map((pair, index) => ({
    id: 'R' + round + '-' + (start + index + 1), side: 'R', round, slots: pair, ...(stage && { stage }),
  }));
}

export function firstRound(robots) {
  const pairing = pairRound(robots.map((robot, seed) => ({ id: robot.id, seed, losses: 0, sitOuts: 0 })), teammates(robots));
  return roundMatches(1, 0, pairing, robots.length === 2 ? 'final' : undefined);
}

// Early pairs for the next round while some of the current round's battles are undecided. Only robots on the same
// record who have not met are paired. If the next round might need a sit-out (an odd count, or an undecided battle
// between an unbeaten robot and a one-loss robot, where who survives depends on the result), one waiting robot with
// the fewest sit-outs is held back so the sit-out can still go to a robot that is due one.
function earlyPairs(waiting, busy, ahead, alive, met) {
  let survivors = waiting.length + ahead.length;
  let certain = true;
  const counted = new Set();
  for (const entry of busy) {
    if (counted.has(entry.match)) continue;
    counted.add(entry.match);
    const [first, second] = busy.filter(item => item.match === entry.match);
    if (!second) { survivors++; continue; }
    if (first.losses === second.losses) survivors += first.losses ? 1 : 2;
    else certain = false;
  }
  const pool = waiting.toSorted((a, b) => a.losses - b.losses || a.seed - b.seed);
  // A later withdrawal can make an even round odd, so also hold one back whenever sit-out counts already differ.
  const fewest = Math.min(...alive.map(entry => entry.sitOuts));
  const unequal = alive.some(entry => entry.sitOuts !== fewest);
  if (!certain || survivors % 2 || unequal) {
    const reserve = pool.filter(entry => entry.sitOuts === fewest)
      .toSorted((a, b) => b.losses - a.losses || b.seed - a.seed)[0];
    if (reserve) pool.splice(pool.indexOf(reserve), 1);
  }
  const pairs = [];
  const used = new Set();
  for (const first of pool) {
    if (used.has(first)) continue;
    const partner = pool.find(entry => entry !== first && !used.has(entry) && entry.losses === first.losses
      && !met.has(pairKey(first.id, entry.id)));
    if (!partner) continue;
    used.add(first).add(partner);
    pairs.push([first.id, partner.id]);
  }
  return pairs;
}

// New matches for the next round: early pairs while the current round is still being fought, and everyone else
// once its last battle is decided. Returns an empty list when there is nothing to pair yet.
export function nextRound(division, bracket) {
  const matches = division.matches.filter(match => match.side === 'R');
  if (!matches.length) return [];
  const entries = records(division, bracket);
  const alive = entries.filter(entry => entry.alive);
  if (alive.length < 2) return [];
  const current = Math.min(...alive.map(entry => entry.round));
  const target = current + 1;
  const waiting = alive.filter(entry => entry.round === current && !entry.busy);
  const ahead = alive.filter(entry => entry.round === target);
  const start = matches.filter(match => match.round === target).length;
  const met = new Set([...matches.map(match => bracket.get(match.id).entrants)
    .filter(entrants => entrants.length === 2 && entrants.every(Boolean)).map(([first, second]) => pairKey(first, second)),
  ...teammates(division.robots)]);
  const busy = alive.filter(entry => entry.round === current && entry.busy).map(entry => ({
    ...entry, match: matches.find(match => match.round === current
      && bracket.get(match.id).entrants.includes(entry.id))?.id,
  }));
  if (busy.length) return roundMatches(target, start, { pairs: earlyPairs(waiting, busy, ahead, alive, met), sitOut: null });
  if (!waiting.length) return [];
  const stage = !ahead.length && waiting.length === 2 ? (matches.some(match => match.stage) ? 'decider' : 'final') : undefined;
  return roundMatches(target, start, pairRound(waiting, met), stage);
}
