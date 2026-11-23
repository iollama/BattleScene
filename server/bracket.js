import { firstRound as firstPairedRound, roundStandings, roundsFinished } from './rounds.js';

export function requireValue(condition, message, status = 400, details) {
  if (!condition) throw Object.assign(new Error(message), { status, details });
}

const bye = () => ({ kind: 'bye' });
const from = (kind, match) => ({ kind, id: match.id });

// Bracket positions of each seed (1-based), for a bracket padded to a power of two.
function seedPositions(count) {
  const size = 2 ** Math.ceil(Math.log2(Math.max(count, 2)));
  let seeds = [1, 2];
  for (let width = 4; width <= size; width *= 2) {
    seeds = seeds.flatMap(seed => [seed, width + 1 - seed]);
  }
  return seeds;
}

const teamOf = robot => (robot.team ?? '').trim().toLowerCase();

// Reorders seeded robots so teammates don't meet early. Two teammates cost more the earlier their bracket positions
// let them meet, and a round-1 meeting costs more than every later one together. For each teammate pair that still
// costs something, the lower seed swaps with the nearest seed that lowers the total, so the order staff chose changes
// as little as possible.
export function spreadTeams(robots) {
  const order = [...robots];
  const seeds = seedPositions(order.length);
  const position = new Map(seeds.map((seed, index) => [seed, index]));
  const rounds = Math.log2(seeds.length);
  const weight = (first, second) => {
    const round = Math.floor(Math.log2(position.get(first + 1) ^ position.get(second + 1))) + 1;
    return round === 1 ? 4 ** rounds : 2 ** (rounds - round);
  };
  // What the robots at `first` and `second` cost together with their teammates (their shared pair counted once).
  const share = (first, second) => {
    let sum = 0;
    order.forEach((robot, other) => {
      if (other !== first && teamOf(robot) === teamOf(order[first])) sum += weight(first, other);
      if (other !== second && other !== first && teamOf(robot) === teamOf(order[second])) sum += weight(second, other);
    });
    return sum;
  };
  for (let pass = 0; pass < 4; pass++) {
    let improved = false;
    for (let index = 1; index < order.length; index++) {
      if (!order.slice(0, index).some(robot => teamOf(robot) === teamOf(order[index]))) continue;
      const candidates = order.map((robot, other) => other)
        .filter(other => other > 0 && other !== index && teamOf(order[other]) !== teamOf(order[index]))
        .sort((a, b) => Math.abs(a - index) - Math.abs(b - index) || b - a);
      for (const other of candidates) {
        const before = share(index, other);
        [order[index], order[other]] = [order[other], order[index]];
        if (share(index, other) < before) {
          improved = true;
          break;
        }
        [order[index], order[other]] = [order[other], order[index]];
      }
    }
    if (!improved) break;
  }
  return order;
}

export function buildBracket(entrants, format) {
  requireValue(entrants.length >= 2, 'Register at least two robots in this weight class.');
  if (format === 'rounds') return firstPairedRound(entrants);
  const robots = spreadTeams(entrants);
  const seeds = seedPositions(robots.length);
  const matches = [];
  function add(side, round, slots) {
    const index = matches.filter(match => match.side === side && match.round === round).length;
    const match = { id: side + round + '-' + (index + 1), side, round, slots };
    matches.push(match);
    return match;
  }
  function pair(sources, side, round) {
    return sources.flatMap((source, index) => index % 2 === 0
      ? [add(side, round, [source, sources[index + 1]])]
      : []);
  }
  const firstRound = seeds.map(seed => robots[seed - 1]
    ? { kind: 'robot', id: robots[seed - 1].id }
    : bye());
  const winners = [pair(firstRound, 'W', 1)];
  while (winners.at(-1).length > 1) {
    winners.push(pair(winners.at(-1).map(match => from('winner', match)), 'W', winners.length + 1));
  }
  if (format === 'double') {
    const winnersFinal = winners.at(-1)[0];
    let lowerFinal;
    if (winners.length === 1) {
      lowerFinal = from('loser', winnersFinal);
    } else {
      let round = 1;
      let lower = pair(winners[0].map(match => from('loser', match)), 'L', round++);
      for (const upper of winners.slice(1)) {
        lower = lower.map((match, index) => add('L', round, [
          from('winner', match),
          from('loser', upper[upper.length > 1 ? index ^ 1 : index]),
        ]));
        round++;
        if (lower.length > 1) {
          lower = pair(lower.map(match => from('winner', match)), 'L', round++);
        }
      }
      lowerFinal = from('winner', lower[0]);
    }
    const final = add('F', 1, [from('winner', winnersFinal), lowerFinal]);
    add('F', 2, [from('winner', final), from('loser', final)]);
  }
  return skipByes(matches);
}

// Padding to a power of two leaves battles a bye has already decided: a robot facing a bye moves straight on,
// and two byes leave nothing to fight. Those battles are dropped and their slots point at the real source, so the
// bracket only holds battles that can be fought. Rounds and match ids are then renumbered to stay contiguous.
function skipByes(matches) {
  const decided = new Map();
  const follow = source => decided.get(source.id)?.[source.kind] ?? source;
  const kept = [];
  for (const match of matches) {
    match.slots = match.slots.map(follow);
    const present = match.slots.filter(slot => slot.kind !== 'bye');
    if (present.length === 2) kept.push(match);
    else decided.set(match.id, { winner: present[0] ?? bye(), loser: bye() });
  }
  const ids = new Map();
  const rounds = new Map();
  const counts = new Map();
  for (const match of kept) {
    const sideRounds = rounds.get(match.side) ?? new Map();
    rounds.set(match.side, sideRounds);
    if (!sideRounds.has(match.round)) sideRounds.set(match.round, sideRounds.size + 1);
    match.round = sideRounds.get(match.round);
    const key = match.side + match.round;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    ids.set(match.id, key + '-' + counts.get(key));
    match.id = ids.get(match.id);
  }
  for (const match of kept) {
    match.slots = match.slots.map(slot => ids.has(slot.id) && slot.kind !== 'robot' ? { ...slot, id: ids.get(slot.id) } : slot);
  }
  return kept;
}

export function resolveBracket(division) {
  const resolved = new Map();
  function lookup(source) {
    if (source.kind === 'bye') return null;
    if (source.kind === 'robot') return source.id;
    const parent = resolved.get(source.id);
    return parent?.settled ? parent[source.kind] : undefined;
  }
  for (const match of division.matches) {
    const entrants = match.slots.map(lookup);
    const known = entrants.every(entrant => entrant !== undefined);
    let state = 'pending';
    let winner = null;
    let loser = null;
    if (match.side === 'F' && match.round === 2) {
      const final = resolved.get(match.slots[0].id);
      if (!final?.result || final.winner !== final.entrants[1]) {
        resolved.set(match.id, { ...match, entrants: [], state: 'inactive', settled: false });
        continue;
      }
    }
    if (match.result) {
      state = 'done';
      winner = match.result.winner;
      loser = entrants.find(entrant => entrant && entrant !== winner) ?? null;
    } else if (match.timer) {
      state = 'running';
    } else if (known) {
      const present = entrants.filter(Boolean);
      state = present.length === 2 ? 'ready' : present.length === 1 ? 'bye' : 'void';
      if (state === 'bye') winner = present[0];
    }
    resolved.set(match.id, {
      ...match, entrants, winner, loser, state,
      settled: ['done', 'bye', 'void'].includes(state),
    });
  }
  return resolved;
}

// Slots swap within one bracket side and round. Robots that skipped a bye sit in later winners rounds, so any two
// robot seeds in the winners bracket can also trade places (moving a seeded robot into an opening battle).
export function canSwapSlots(first, firstSlot, second, secondSlot) {
  if (first.side === 'F' || first.side !== second.side) return false;
  if (first.round === second.round) return true;
  return first.side === 'W' && first.slots[firstSlot]?.kind === 'robot' && second.slots[secondSlot]?.kind === 'robot';
}

export const isArenaActive = division => division.active !== false;

export function arenaState(division) {
  const bracket = resolveBracket(division);
  const checkedIn = new Set(division.robots.filter(robot => robot.checkedIn).map(robot => robot.id));
  const queue = division.queue.map(id => bracket.get(id)).filter(Boolean);
  const ready = match => match.state === 'ready' && !match.held
    && match.entrants.every(id => checkedIn.has(id));
  return {
    bracket, queue, ready,
    current: queue.find(match => match.state === 'running'),
    next: isArenaActive(division) ? queue.find(ready) : undefined,
  };
}

export function placementList(division, bracket = resolveBracket(division)) {
  if (!division.matches.length) return [];
  if (division.format === 'rounds') return roundPlacements(division, bracket);
  const matches = [...bracket.values()];
  const final = matches.at(-1);
  const deciding = final.state === 'inactive' ? matches.at(-2) : final;
  if (!deciding?.settled || !deciding.winner) return [];
  const results = [{ place: 1, ids: [deciding.winner] }];
  if (deciding.loser) results.push({ place: 2, ids: [deciding.loser] });
  const placed = new Set(results.flatMap(result => result.ids));
  const side = division.format === 'double' ? 'L' : 'W';
  const rounds = [...new Set(matches.filter(match => match.side === side).map(match => match.round))].reverse();
  for (const round of rounds) {
    const ids = matches.filter(match => match.side === side && match.round === round)
      .map(match => match.loser).filter(id => id && !placed.has(id));
    if (ids.length) {
      results.push({ place: placed.size + 1, ids });
      ids.forEach(id => placed.add(id));
    }
  }
  return results;
}

// Winners and losers rounds alternate; a battle is never queued ahead of the battles feeding it (that matters once
// skipped byes have removed a whole losers round). Ties keep bracket order, which lists feeders first.
// Rounds format: the last robot standing wins; everyone else ranks by the round they went out in (ties share a place).
function roundPlacements(division, bracket) {
  if (!roundsFinished(division, bracket)) return [];
  const standings = roundStandings(division, bracket);
  const groups = [standings.filter(entry => entry.alive)];
  const rounds = [...new Set(standings.filter(entry => !entry.alive).map(entry => entry.out))].sort((a, b) => b - a);
  for (const round of rounds) groups.push(standings.filter(entry => entry.out === round));
  let placed = 0;
  return groups.filter(group => group.length).map(group => {
    const place = placed + 1;
    placed += group.length;
    return { place, ids: group.map(entry => entry.id) };
  });
}

export function scheduleMatches(matches) {
  const sequence = new Map();
  for (const match of matches) {
    const base = match.side === 'W' ? match.round * 2 - 1 : match.side === 'L' ? match.round + 1
      : match.side === 'R' ? match.round : 100 + match.round;
    const feeders = match.slots.filter(slot => slot.kind === 'winner' || slot.kind === 'loser')
      .map(slot => sequence.get(slot.id) ?? 0);
    sequence.set(match.id, Math.max(base, ...feeders));
  }
  return matches.toSorted((a, b) => sequence.get(a.id) - sequence.get(b.id)).map(match => match.id);
}

export function frozenMatchChanges(division) {
  return [...resolveBracket(division).values()].filter(match => {
    const stored = match.result?.entrants ?? match.timer?.entrants;
    return stored && (stored.some((id, index) => id !== match.entrants[index]) || match.state === 'inactive');
  });
}

export function affectedMatches(division, first) {
  const affected = new Set([first.id]);
  for (const match of division.matches) {
    if (match.slots.some(slot => ['winner', 'loser'].includes(slot.kind) && affected.has(slot.id))) {
      affected.add(match.id);
    }
  }
  return division.matches.filter(match => match !== first && affected.has(match.id) && (match.result || match.timer));
}
