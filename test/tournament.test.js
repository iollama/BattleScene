import assert from 'node:assert/strict';
import test from 'node:test';
import { arenaState, buildBracket, placementList, resolveBracket, spreadTeams } from '../server/bracket.js';
import { newMeetup, publicMeetup, staffMeetup, updateMeetup } from '../server/meetup.js';
import { pairRound } from '../server/rounds.js';
import { describeActivity } from '../shared/activity.js';

const manager = { email: 'manager@example.com', role: 'manager' };
const admin = { email: 'admin@example.com', role: 'admin' };
const registry = { managers: [manager.email] };
const meetupData = { name: 'Event', date: '2026-11-21', timezone: 'Asia/Jerusalem' };

function createClass(meetup, name, count, format = 'single') {
  const dispatch = action => { meetup = updateMeetup(meetup, action, manager, registry, 1000); };
  dispatch({ type: 'addDivision', name, arena: name + ' arena', format });
  const division = meetup.divisions.at(-1).id;
  dispatch({ type: 'addRobots', division, robots: Array.from({ length: count }, (_, index) => ({
    team: name + ' team ' + index, name: name + ' bot ' + index, checkedIn: true,
  })) });
  dispatch({ type: 'generate', division, format });
  return meetup;
}

test('single and double elimination terminate and assign each robot a placement', () => {
  for (const format of ['single', 'double']) {
    for (let count = 2; count <= 32; count++) {
      let meetup = createClass(newMeetup(meetupData, manager), 'Antweight', count, format);
      const key = meetup.divisions[0].id;
      const losses = new Map();
      let played = 0;
      while (!placementList(meetup.divisions[0]).length) {
        const match = arenaState(meetup.divisions[0]).next;
        assert.ok(match, format + ' ' + count + ' must always have a playable battle');
        assert.notEqual(match.entrants[0], match.entrants[1]);
        match.entrants.forEach(id => assert.ok((losses.get(id) ?? 0) < (format === 'single' ? 1 : 2)));
        const winner = match.side === 'F' && match.round === 1 ? match.entrants[1] : match.entrants[0];
        const loser = match.entrants.find(id => id !== winner);
        losses.set(loser, (losses.get(loser) ?? 0) + 1);
        meetup = updateMeetup(meetup, { type: 'result', method: 'forfeit', division: key, match: match.id, winner }, manager, registry);
        played++;
        assert.ok(played <= count * 2);
      }
      assert.equal(played, format === 'single' ? count - 1 : count * 2 - 1);
      const placements = placementList(meetup.divisions[0]);
      assert.equal(new Set(placements.flatMap(item => item.ids)).size, count);
      assert.equal(losses.get(placements[0].ids[0]) ?? 0, format === 'single' ? 0 : 1);
    }
  }
});

test('brackets skip battles a bye already decides and keep rounds contiguous', () => {
  for (const format of ['single', 'double']) {
    for (let count = 2; count <= 32; count++) {
      const division = createClass(newMeetup(meetupData, manager), 'Antweight', count, format).divisions[0];
      const label = format + ' ' + count;
      assert.equal(division.matches.length, format === 'single' ? count - 1 : count * 2 - 1, label);
      assert.ok(division.matches.every(match => match.slots.every(slot => slot.kind !== 'bye')), label);
      assert.ok([...resolveBracket(division).values()].every(match => !['bye', 'void'].includes(match.state)), label);
      for (const side of ['W', 'L', 'F']) {
        const matches = division.matches.filter(match => match.side === side);
        const rounds = [...new Set(matches.map(match => match.round))];
        assert.deepEqual(rounds, rounds.map((_, index) => index + 1), label + ' ' + side);
        for (const round of rounds) {
          const ids = matches.filter(match => match.round === round).map(match => match.id);
          assert.deepEqual(ids, ids.map((_, index) => side + round + '-' + (index + 1)), label);
        }
      }
      const position = new Map(division.queue.map((id, index) => [id, index]));
      for (const match of division.matches) {
        for (const slot of match.slots.filter(item => item.kind === 'winner' || item.kind === 'loser')) {
          assert.ok(position.get(slot.id) < position.get(match.id), label + ' queues ' + slot.id + ' before ' + match.id);
        }
      }
    }
  }
  const eighteen = createClass(newMeetup(meetupData, manager), 'Antweight', 18, 'double').divisions[0];
  const roundSizes = side => Object.values(Object.groupBy(eighteen.matches.filter(match => match.side === side), match => match.round))
    .map(matches => matches.length);
  assert.deepEqual(roundSizes('W'), [2, 8, 4, 2, 1]);
  assert.deepEqual(roundSizes('L'), [2, 4, 4, 2, 2, 1, 1]);
});

test('a robot seeded past the opening round can be swapped into an opening battle', () => {
  let meetup = createClass(newMeetup(meetupData, manager), 'Antweight', 5);
  const division = meetup.divisions[0];
  const opening = division.matches.find(match => match.round === 1);
  const seeded = division.matches.find(match => match.round === 2 && match.slots[0].kind === 'robot');
  const moved = seeded.slots[0].id;
  meetup = updateMeetup(meetup, { type: 'swapSlots', division: division.id,
    first: seeded.id, firstSlot: 0, second: opening.id, secondSlot: 0 }, manager, registry);
  assert.equal(resolveBracket(meetup.divisions[0]).get(opening.id).entrants[0], moved);
  assert.throws(() => updateMeetup(meetup, { type: 'swapSlots', division: division.id,
    first: seeded.id, firstSlot: 1, second: opening.id, secondSlot: 1 }, manager, registry), /same bracket and round/);
});

test('three arenas time battles independently while an active bracket is rearranged', () => {
  const names = ['Antweight', 'Beetleweight', 'Featherweight'];
  let meetup = names.reduce((event, name) => createClass(event, name, 8), newMeetup(meetupData, manager));
  const dispatch = (data, actor = manager, now = 2000) => { meetup = updateMeetup(meetup, data, actor, registry, now); };
  for (const division of meetup.divisions) {
    dispatch({ type: 'start', division: division.id, match: arenaState(division).next.id, duration: 30 });
  }
  const [first, second, third] = meetup.divisions;
  const action = { division: first.id };
  const firstMatch = arenaState(first).current;
  const next = arenaState(first).next;
  dispatch({ ...action, type: 'swapSlots', first: next.id, firstSlot: 0, second: 'W1-3', secondSlot: 1 });
  assert.deepEqual(arenaState(meetup.divisions[0]).current.timer, firstMatch.timer);
  assert.throws(() => dispatch({ ...action, type: 'swapSlots', first: firstMatch.id, firstSlot: 0, second: next.id, secondSlot: 1 }), /unstarted/);
  dispatch({ ...action, type: 'moveMatch', match: 'W1-3', before: next.id });
  assert.equal(arenaState(meetup.divisions[0]).next.id, 'W1-3');
  dispatch({ ...action, type: 'pause', match: firstMatch.id }, manager, 5000);
  assert.equal(arenaState(meetup.divisions[0]).current.timer.remaining, 27000);
  assert.deepEqual(meetup.divisions[1], second);
  assert.deepEqual(meetup.divisions[2], third);
  dispatch({ ...action, type: 'result', match: firstMatch.id, winner: firstMatch.entrants[0] });
  assert.equal(arenaState(meetup.divisions[0]).bracket.get(firstMatch.id).state, 'done');
  assert.equal(meetup.divisions.filter(division => arenaState(division).current).length, 2);
});

test('a correction involving a running downstream match requires super admin confirmation', () => {
  let meetup = createClass(newMeetup(meetupData, manager), 'Antweight', 4);
  const division = meetup.divisions[0].id;
  const dispatch = (data, actor = manager) => { meetup = updateMeetup(meetup, { division, ...data }, actor, registry); };
  for (let games = 0; games < 2; games++) {
    const match = arenaState(meetup.divisions[0]).next;
    dispatch({ type: 'result', method: 'forfeit', match: match.id, winner: match.entrants[0] });
  }
  const final = arenaState(meetup.divisions[0]).next;
  dispatch({ type: 'start', match: final.id });
  const first = arenaState(meetup.divisions[0]).bracket.get('W1-1');
  const correction = { type: 'result', match: first.id, winner: first.entrants[1] };
  assert.throws(() => dispatch({ ...correction, confirm: true }), error =>
    error.status === 409 && !error.details.canConfirm && error.details.affected.includes(final.id));
  assert.throws(() => dispatch(correction, admin), error => error.status === 409 && error.details.canConfirm);
  dispatch({ ...correction, confirm: true }, admin);
  assert.equal(meetup.audit.at(-1).previous.winner, first.winner);
  assert.equal(meetup.audit.at(-1).rollback[0].id, final.id);
  assert.equal(arenaState(meetup.divisions[0]).next.id, final.id);
});

test('deactivating an arena pauses its clock and preserves its queue', () => {
  let meetup = createClass(newMeetup(meetupData, manager), 'Antweight', 4);
  meetup = createClass(meetup, 'Beetleweight', 4);
  const [target, other] = meetup.divisions;
  delete target.active;
  const next = arenaState(target).next;
  assert.equal(publicMeetup(meetup).divisions[0].active, true);
  const dispatch = (data, now) => {
    meetup = updateMeetup(meetup, { division: target.id, ...data }, manager, registry, now);
  };
  dispatch({ type: 'arenaStatus', active: false }, 1000);
  assert.throws(() => dispatch({ type: 'start', match: next.id }, 1000), /Activate this arena/);
  assert.equal(publicMeetup(meetup).divisions[0].next, undefined);
  dispatch({ type: 'arenaStatus', active: true }, 1000);
  dispatch({ type: 'start', match: next.id, duration: 30 }, 2000);
  dispatch({ type: 'arenaStatus', active: false }, 5000);
  const closed = meetup.divisions[0];
  assert.equal(arenaState(closed).current.timer.remaining, 27000);
  assert.equal(arenaState(closed).current.timer.startedAt, null);
  assert.deepEqual(closed.queue, target.queue);
  assert.deepEqual(meetup.divisions[1], other);
  assert.throws(() => dispatch({ type: 'resume', match: next.id }, 6000), /Activate this arena/);
  dispatch({ type: 'arenaStatus', active: true }, 7000);
  assert.equal(arenaState(meetup.divisions[0]).current.timer.startedAt, null);
  dispatch({ type: 'resume', match: next.id }, 8000);
  assert.equal(arenaState(meetup.divisions[0]).current.timer.startedAt, 8000);
  assert.equal(arenaState(meetup.divisions[0]).current.timer.remaining, 27000);
});

test('removing a weight class switches its displays to Ringmaster and preserves the other class', () => {
  let meetup = createClass(newMeetup(meetupData, manager), 'Antweight', 4);
  meetup = createClass(meetup, 'Beetleweight', 4);
  const [target, other] = meetup.divisions;
  const dispatch = data => { meetup = updateMeetup(meetup, data, manager, registry); };
  dispatch({ type: 'start', division: target.id, match: arenaState(target).next.id });
  dispatch({ type: 'saveDisplay', name: 'Antweight TV', layout: 'bracket', division: target.id, rounds: 'W1',
    qr: { title: 'Venue information', url: 'https://example.com/venue' } });
  dispatch({ type: 'saveDisplay', name: 'Beetleweight TV', layout: 'battle', division: other.id });
  dispatch({ type: 'saveDisplay', name: 'Main TV', layout: 'ladders' });
  const [ringmaster, targetScreen, ...otherScreens] = meetup.screens;

  const removal = { type: 'removeDivision', division: target.id };
  assert.throws(() => updateMeetup({ ...meetup, complete: true }, removal, manager, registry), /Reopen the meetup/);
  dispatch(removal);

  assert.deepEqual(meetup.divisions, [other]);
  assert.deepEqual(meetup.screens, [
    ringmaster,
    { ...targetScreen, layout: 'ringmaster', division: '', rounds: '' },
    ...otherScreens,
  ]);
  assert.deepEqual(publicMeetup(meetup).divisions.map(item => item.id), [other.id]);
  assert.equal(meetup.audit.at(-1).divisionName, target.name);
  assert.throws(() => dispatch(removal), /Weight class not found/);
});

test('completing a meetup clears its activity log, and reopening adds to the fresh log', () => {
  let meetup = createClass(newMeetup(meetupData, manager), 'Antweight', 2);
  const dispatch = data => { meetup = updateMeetup(meetup, data, manager, registry, 5000); };
  assert.throws(() => dispatch({ type: 'complete', complete: true }), /Finish every populated weight class/);
  const division = meetup.divisions[0];
  const match = arenaState(division).next;
  dispatch({ type: 'result', method: 'forfeit', division: division.id, match: match.id, winner: match.entrants[0] });
  assert.ok(meetup.audit.length > 2);

  dispatch({ type: 'complete', complete: true });
  assert.deepEqual(meetup.audit, [{ type: 'complete', by: manager.email, at: 5000, division: null, complete: true }]);
  assert.equal(meetup.divisions[0].matches[0].result.winner, match.entrants[0]);

  dispatch({ type: 'complete', complete: false });
  assert.deepEqual(meetup.audit.map(entry => entry.complete), [true, false]);
});

test('the public spectator display can be reassigned and cleared', () => {
  let meetup = newMeetup(meetupData, manager);
  delete meetup.spectatorScreenId;
  const dispatch = data => { meetup = updateMeetup(meetup, data, manager, registry); };
  const save = data => dispatch({ type: 'saveDisplay', ...data });
  const selected = () => publicMeetup(meetup).spectatorScreenId;

  assert.equal(selected(), null);
  const ringmaster = meetup.screens[0].id;
  save({ name: 'Lobby', layout: 'ringmaster', spectator: true });
  const first = meetup.screens[1].id;
  assert.equal(selected(), first);
  save({ screen: first, name: 'Lobby screen', layout: 'ringmaster' });
  assert.equal(selected(), first);
  save({ name: 'Audience', layout: 'ladders', spectator: true });
  const second = meetup.screens[2].id;
  assert.equal(selected(), second);
  save({ screen: first, name: 'Lobby screen', layout: 'ringmaster', spectator: false });
  assert.equal(selected(), second);
  save({ screen: second, name: 'Audience', layout: 'ladders', spectator: false });
  assert.equal(selected(), null);
  save({ screen: first, name: 'Lobby screen', layout: 'ringmaster', spectator: true });
  dispatch({ type: 'removeDisplay', screen: first });
  assert.equal(selected(), null);
  assert.deepEqual(meetup.screens.map(screen => screen.id), [ringmaster, second]);
});

test('saved Ring view displays open as Ringmaster with their existing IDs', () => {
  const meetup = newMeetup(meetupData, manager);
  const screen = { id: 'lobby', name: 'Lobby', layout: 'arenas', division: '', rounds: '', qr: null };
  meetup.screens = [screen];
  meetup.spectatorScreenId = screen.id;

  for (const read of [publicMeetup, staffMeetup]) {
    const data = read(meetup);
    assert.deepEqual(data.screens, [{ ...screen, layout: 'ringmaster' }]);
    assert.equal(data.spectatorScreenId, screen.id);
  }
  assert.equal(meetup.screens[0].layout, 'arenas');

  const updated = updateMeetup(meetup, { type: 'saveDisplay', screen: screen.id, name: 'Lobby TV', layout: 'arenas' }, manager, registry);
  assert.deepEqual(updated.screens, [{ ...screen, name: 'Lobby TV', layout: 'ringmaster' }]);
  assert.equal(updated.spectatorScreenId, screen.id);
});

test('a new meetup starts with a Ringmaster display that is not the spectator view', () => {
  const meetup = newMeetup(meetupData, manager);
  assert.equal(meetup.screens.length, 1);
  const { id, ...screen } = meetup.screens[0];
  assert.ok(id);
  assert.deepEqual(screen, { name: 'Ringmaster', layout: 'ringmaster', division: '', rounds: '', qr: null });
  assert.equal(meetup.spectatorScreenId, null);
  assert.deepEqual(publicMeetup(meetup).screens, meetup.screens);
});

test('a meetup supports ten displays and can edit Ringmaster at capacity', () => {
  let meetup = newMeetup(meetupData, manager);
  const dispatch = data => { meetup = updateMeetup(meetup, data, manager, registry); };
  for (let index = 2; index <= 10; index++) {
    dispatch({ type: 'saveDisplay', name: `Screen ${index}`, layout: 'ringmaster' });
  }
  assert.equal(meetup.screens.length, 10);
  const extra = { type: 'saveDisplay', name: 'Extra screen', layout: 'ringmaster' };
  assert.throws(() => dispatch(extra), /Configure up to 10 venue displays/);

  const screen = meetup.screens[0].id;
  dispatch({ ...extra, screen, name: 'Main screen', spectator: true });
  assert.equal(meetup.screens.length, 10);
  const publicData = publicMeetup(meetup);
  assert.equal(publicData.spectatorScreenId, screen);
  assert.deepEqual(publicData.screens[0], { id: screen, name: 'Main screen', layout: 'ringmaster', division: '', rounds: '', qr: null });

  dispatch({ type: 'removeDisplay', screen });
  dispatch(extra);
  assert.equal(meetup.screens.length, 10);
  assert.equal(meetup.screens.at(-1).layout, 'ringmaster');
});

test('meetups saved with the old amber default theme show the current default colors and no background image', () => {
  const meetup = newMeetup(meetupData, manager);
  const legacy = { ...meetup, theme: { ...meetup.theme, accent: '#F5B944', background: '#101316', logo: '/logo.png', image: '/bg.png' } };
  for (const read of [publicMeetup, staffMeetup]) {
    assert.deepEqual(read(meetup).theme, meetup.theme);
    assert.deepEqual(read(legacy).theme, { ...meetup.theme, logo: '/logo.png' });
  }
  const custom = { ...meetup, theme: { ...meetup.theme, accent: '#f5b944', background: '#222222' } };
  assert.equal(publicMeetup(custom).theme.accent, '#f5b944');
});

function attendanceClass(format, count = 4, checkedIn = true) {
  let meetup = newMeetup(meetupData, manager);
  const dispatch = (action, actor = manager, now = 1000) => {
    meetup = updateMeetup(meetup, { division: meetup.divisions[0]?.id, ...action }, actor, registry, now);
    return meetup;
  };
  dispatch({ type: 'addDivision', name: 'Antweight', arena: 'Arena Alpha', format });
  dispatch({ type: 'addRobots', robots: Array.from({ length: count }, (_, index) => ({
    team: 'Team ' + index, name: 'Bot ' + index, checkedIn,
  })) });
  const robot = index => meetup.divisions[0].robots[index];
  const match = key => publicMeetup(meetup).divisions[0].matches.find(item => item.id === key);
  return { dispatch, robot, match, get meetup() { return meetup; } };
}

test('the bracket is generated from checked-in robots only and follows check-ins until the first battle', () => {
  const event = attendanceClass('single', 4, false);
  assert.throws(() => event.dispatch({ type: 'generate', format: 'single' }), /Check in at least two robots/);
  for (const index of [0, 1, 2]) event.dispatch({ type: 'checkIn', robot: event.robot(index).id, checkedIn: true });
  event.dispatch({ type: 'generate', format: 'single' });
  const inBracket = () => new Set(event.meetup.divisions[0].matches.flatMap(item => item.slots)
    .filter(slot => slot.kind === 'robot').map(slot => slot.id));
  assert.deepEqual([...inBracket()].sort(), [0, 1, 2].map(index => event.robot(index).id).sort());
  assert.deepEqual(event.meetup.audit.at(-1).leftOut, [event.robot(3).id]);

  event.dispatch({ type: 'checkIn', robot: event.robot(3).id, checkedIn: true });
  assert.equal(inBracket().size, 4);
  event.dispatch({ type: 'checkIn', robot: event.robot(2).id, checkedIn: false });
  assert.equal(inBracket().size, 3);

  event.dispatch({ type: 'checkIn', robot: event.robot(2).id, checkedIn: true });
  event.dispatch({ type: 'start', match: 'W1-1' });
  event.dispatch({ type: 'result', match: 'W1-1', winner: event.match('W1-1').entrants[0] });
  event.dispatch({ type: 'checkIn', robot: event.robot(3).id, checkedIn: false });
  assert.equal(inBracket().size, 4);
  assert.throws(() => event.dispatch({ type: 'addRobots', robots: [{ team: 'Late', name: 'Latecomer' }] }), /locked/);
});

test('a last call counts down on an upcoming battle and ends when it starts, is held, or is decided', () => {
  const event = attendanceClass('single');
  event.dispatch({ type: 'settings', ...meetupData, duration: 180, lastCall: 90 });
  assert.equal(event.meetup.lastCall, 90);
  assert.throws(() => event.dispatch({ type: 'settings', ...meetupData, lastCall: 5 }), /last call from 10 to 900/);
  event.dispatch({ type: 'generate', format: 'single' });
  assert.throws(() => event.dispatch({ type: 'lastCall', match: 'W2-1', call: true }), /opponents must be known/);

  event.dispatch({ type: 'lastCall', match: 'W1-1', call: true }, manager, 5000);
  assert.deepEqual(event.match('W1-1').call, { startedAt: 5000, duration: 90_000 });
  assert.throws(() => event.dispatch({ type: 'lastCall', match: 'W1-2', call: true }), /already has a last call/);
  event.dispatch({ type: 'lastCall', match: 'W1-1', call: false });
  assert.equal(event.match('W1-1').call, undefined);

  event.dispatch({ type: 'lastCall', match: 'W1-1', call: true });
  event.dispatch({ type: 'start', match: 'W1-1' });
  assert.equal(event.match('W1-1').call, undefined);
  event.dispatch({ type: 'result', match: 'W1-1', winner: event.match('W1-1').entrants[0] });

  event.dispatch({ type: 'lastCall', match: 'W1-2', call: true });
  event.dispatch({ type: 'hold', match: 'W1-2', held: true });
  assert.equal(event.match('W1-2').call, undefined);
  event.dispatch({ type: 'hold', match: 'W1-2', held: false });

  event.dispatch({ type: 'lastCall', match: 'W1-2', call: true }, manager, 6000);
  const [present] = event.match('W1-2').entrants;
  event.dispatch({ type: 'result', match: 'W1-2', winner: present, method: 'forfeit' }, manager, 96_000);
  assert.equal(event.match('W1-2').call, undefined);
  assert.deepEqual([event.match('W1-2').result.method, event.match('W1-2').winner], ['forfeit', present]);
});

test('withdrawing a robot forfeits its remaining battles, including later losers-bracket battles', () => {
  const event = attendanceClass('double');
  event.dispatch({ type: 'generate', format: 'double' });
  const id = index => event.robot(index).id;
  assert.throws(() => event.dispatch({ type: 'withdraw', robot: id(0) }), /check the robot out or remove it/);

  const opening = event.match('W1-1').entrants;
  event.dispatch({ type: 'start', match: 'W1-1' });
  assert.throws(() => event.dispatch({ type: 'withdraw', robot: opening[1] }), /fighting/);
  event.dispatch({ type: 'result', match: 'W1-1', winner: opening[0] });

  const loser = opening[1];
  event.dispatch({ type: 'withdraw', robot: loser });
  assert.equal(publicMeetup(event.meetup).divisions[0].robots.find(robot => robot.id === loser).withdrawn, true);
  assert.throws(() => event.dispatch({ type: 'checkIn', robot: loser, checkedIn: true }), /withdrawn/);

  const second = event.match('W1-2').entrants;
  event.dispatch({ type: 'start', match: 'W1-2' });
  event.dispatch({ type: 'result', match: 'W1-2', winner: second[0] });
  const losersOpening = event.match('L1-1');
  assert.equal(losersOpening.state, 'done');
  assert.deepEqual([losersOpening.result.method, losersOpening.result.winner], ['forfeit', second[1]]);
  assert.equal(losersOpening.result.withdrawal, true);
  assert.deepEqual(event.meetup.audit.at(-1).forfeits, ['L1-1']);
});

// Plays a rounds class to the end. order: 'queue' takes the arena's next battle; 'random' takes any ready battle, so
// early-paired next-round battles often run before the current round ends.
function playRounds(count, order, seed = count) {
  let meetup = createClass(newMeetup(meetupData, manager), 'Antweight', count, 'rounds');
  const key = meetup.divisions[0].id;
  const label = 'rounds ' + count + ' ' + order + ' ' + seed;
  let random = seed * 7919 + 17;
  const pick = length => (random = (random * 1103515245 + 12345) % 2147483648) % length;
  let played = 0;
  while (!placementList(meetup.divisions[0]).length) {
    const division = publicMeetup(meetup).divisions[0];
    const alive = division.standings.filter(entry => entry.alive);
    const sitOuts = alive.map(entry => entry.sitOuts);
    assert.ok(Math.max(...sitOuts) - Math.min(...sitOuts) <= 1, label + ' sit-outs ' + sitOuts);
    const ready = division.matches.filter(match => match.state === 'ready');
    const match = order === 'queue' ? arenaState(meetup.divisions[0]).next : ready[pick(ready.length)];
    assert.ok(match, label + ' must always have a playable battle');
    const winner = match.entrants[pick(2)];
    meetup = updateMeetup(meetup, { type: 'result', method: 'forfeit', division: key, match: match.id, winner }, manager, registry);
    played++;
    assert.ok(played <= count * 2, label + ' terminates');
  }
  const { matches, standings, placements } = publicMeetup(meetup).divisions[0];
  assert.ok([count * 2 - 2, count * 2 - 1].includes(played), label + ' played ' + played);
  assert.equal(new Set(placements.flatMap(item => item.ids)).size, count, label);
  assert.ok(standings.find(entry => entry.id === placements[0].ids[0]).losses <= 1, label);
  assert.ok(standings.filter(entry => !entry.alive).every(entry => entry.losses === 2), label);
  // Every robot is in exactly one battle or sit-out in each round until it goes out, so robots still in at any round
  // differ only by their sit-outs, which never differ by more than one.
  const last = Math.max(...matches.map(match => match.round));
  for (const entry of standings) {
    const rounds = matches.filter(match => match.entrants.includes(entry.id)).map(match => match.round);
    assert.deepEqual(rounds, Array.from({ length: entry.out ?? last }, (_, index) => index + 1), label + ' rounds of ' + entry.id);
  }
  const [first, second] = placements.map(item => standings.find(entry => entry.id === item.ids[0]));
  assert.ok(Math.abs(first.battles - second.battles) <= 1, label + ' finalists ' + first.battles + ' vs ' + second.battles);
  return meetup;
}

test('rounds format: everyone left fights each round, two losses are out, and live robots stay within one battle', () => {
  for (let count = 2; count <= 32; count++) {
    playRounds(count, 'queue');
    for (let seed = 1; seed <= 4; seed++) playRounds(count, 'random', seed);
  }
});

test('rounds format pairs next-round battles as soon as robots on the same record are free', () => {
  const event = attendanceClass('rounds', 8);
  event.dispatch({ type: 'generate', format: 'rounds' });
  const division = () => event.meetup.divisions[0];
  const [first, second] = ['R1-1', 'R1-2'].map(key => event.match(key).entrants);
  event.dispatch({ type: 'result', method: 'forfeit', match: 'R1-1', winner: first[0] });
  assert.equal(division().matches.length, 4);
  event.dispatch({ type: 'result', method: 'forfeit', match: 'R1-2', winner: second[0] });
  assert.deepEqual(event.meetup.audit.at(-1).paired, ['R2-1', 'R2-2']);
  assert.deepEqual(event.match('R2-1').entrants, [first[0], second[0]]);
  assert.deepEqual(event.match('R2-2').entrants, [first[1], second[1]]);
  assert.equal(arenaState(division()).next.id, 'R1-3');
  event.dispatch({ type: 'hold', match: 'R1-3', held: true });
  event.dispatch({ type: 'hold', match: 'R1-4', held: true });
  assert.equal(arenaState(division()).next.id, 'R2-1');
  event.dispatch({ type: 'hold', match: 'R1-3', held: false });
  for (const key of ['R1-3', 'R1-4']) event.dispatch({ type: 'result', method: 'forfeit', match: key, winner: event.match(key).entrants[0] });
  assert.deepEqual(division().matches.filter(match => match.round === 2).map(match => match.id), ['R2-1', 'R2-2', 'R2-3', 'R2-4']);
});

test('rounds format holds back a robot due a sit-out while pairing the next round early', () => {
  const event = attendanceClass('rounds', 5);
  event.dispatch({ type: 'generate', format: 'rounds' });
  const sitting = event.match('R1-3').winner;
  const [winner, loser] = event.match('R1-1').entrants;
  event.dispatch({ type: 'result', method: 'forfeit', match: 'R1-1', winner });
  assert.deepEqual(event.match('R2-1').entrants.toSorted(), [sitting, winner].toSorted());
  assert.equal(event.meetup.divisions[0].matches.filter(match => match.round === 2).length, 1);
  event.dispatch({ type: 'result', method: 'forfeit', match: 'R1-2', winner: event.match('R1-2').entrants[0] });
  const sitOut = publicMeetup(event.meetup).divisions[0].matches.find(match => match.round === 2 && match.state === 'bye');
  assert.ok(sitOut && sitOut.winner !== sitting);
  assert.ok([loser, ...event.match('R1-2').entrants].includes(sitOut.winner));
});

test('rounds format pairs seeds top half against bottom half and gives an odd seed out a sit-out', () => {
  const even = createClass(newMeetup(meetupData, manager), 'Antweight', 8, 'rounds').divisions[0];
  const seed = id => even.robots.findIndex(robot => robot.id === id) + 1;
  assert.deepEqual(even.matches.map(match => match.slots.map(slot => seed(slot.id))), [[1, 5], [2, 6], [3, 7], [4, 8]]);
  const odd = publicMeetup(createClass(newMeetup(meetupData, manager), 'Antweight', 5, 'rounds')).divisions[0];
  const sitOut = odd.matches.at(-1);
  assert.equal(sitOut.state, 'bye');
  assert.equal(sitOut.winner, odd.robots[4].id);
  assert.equal(odd.matches.filter(match => match.state === 'ready').length, 2);
});

test('rounds pairing avoids a rematch when another pairing exists', () => {
  const players = ['a', 'b', 'c', 'd'].map((id, seed) => ({ id, seed, losses: 0, sitOuts: 0 }));
  assert.deepEqual(pairRound(players).pairs, [['a', 'c'], ['b', 'd']]);
  assert.deepEqual(pairRound(players, new Set(['a|c'])).pairs, [['a', 'd'], ['b', 'c']]);
  assert.deepEqual(pairRound(players.slice(0, 2), new Set(['a|b'])).pairs, [['a', 'b']]);
});

test('rounds format pairs the next round automatically and re-pairs it after a corrected result', () => {
  const event = attendanceClass('rounds');
  event.dispatch({ type: 'generate', format: 'rounds' });
  for (const key of ['R1-1', 'R1-2']) {
    event.dispatch({ type: 'result', method: 'forfeit', match: key, winner: event.match(key).entrants[0] });
  }
  assert.deepEqual(event.meetup.audit.at(-1).paired, ['R2-1', 'R2-2']);
  assert.deepEqual(event.meetup.divisions[0].queue.slice(-2), ['R2-1', 'R2-2']);
  const before = event.match('R2-1').entrants;
  event.dispatch({ type: 'result', method: 'forfeit', match: 'R1-1', winner: event.match('R1-1').entrants[1] });
  assert.notDeepEqual(event.match('R2-1').entrants, before);
  assert.deepEqual(event.meetup.audit.at(-1).rollback, []);

  event.dispatch({ type: 'start', match: 'R2-1' });
  const correction = { type: 'result', method: 'forfeit', match: 'R1-1', winner: event.match('R1-1').entrants[0] };
  assert.throws(() => event.dispatch(correction), error => error.status === 409 && !error.details.canConfirm
    && error.details.affected.includes('R2-1'));
  event.dispatch({ ...correction, confirm: true }, admin);
  assert.equal(event.meetup.audit.at(-1).rollback[0].id, 'R2-1');
  assert.equal(event.match('R2-1').state, 'ready');
});

test('rounds format: a withdrawn robot forfeits its battle and is never paired again', () => {
  const event = attendanceClass('rounds', 6);
  event.dispatch({ type: 'generate', format: 'rounds' });
  event.dispatch({ type: 'result', method: 'forfeit', match: 'R1-1', winner: event.match('R1-1').entrants[0] });
  const leaving = event.match('R1-3').entrants[1];
  event.dispatch({ type: 'withdraw', robot: leaving });
  assert.equal(event.match('R1-3').result.withdrawal, true);
  for (const key of ['R1-2']) {
    event.dispatch({ type: 'result', method: 'forfeit', match: key, winner: event.match(key).entrants[0] });
  }
  const second = event.meetup.divisions[0].matches.filter(match => match.round === 2);
  assert.ok(second.length && second.every(match => match.slots.every(slot => slot.id !== leaving)));
  const standing = publicMeetup(event.meetup).divisions[0].standings.find(entry => entry.id === leaving);
  assert.deepEqual([standing.withdrawn, standing.alive, standing.out], [true, false, 1]);
});

test('rounds format round 1 follows check-ins until the first battle and accepts a round display focus', () => {
  const event = attendanceClass('rounds', 5, false);
  for (let index = 0; index < 4; index++) event.dispatch({ type: 'checkIn', robot: event.robot(index).id, checkedIn: true });
  event.dispatch({ type: 'generate', format: 'rounds' });
  assert.equal(event.meetup.divisions[0].matches.length, 2);
  event.dispatch({ type: 'checkIn', robot: event.robot(4).id, checkedIn: true });
  assert.equal(event.meetup.divisions[0].matches.length, 3);
  assert.equal(event.match('R1-3').state, 'bye');
  event.dispatch({ type: 'saveDisplay', name: 'Rounds', layout: 'bracket', division: event.meetup.divisions[0].id, rounds: 'R1' });
  assert.equal(event.meetup.screens.at(-1).rounds, 'R1');
});

test('a super admin can fill a meetup with demo classes of checked-in robots', () => {
  let meetup = newMeetup(meetupData, manager);
  meetup = updateMeetup(meetup, { type: 'demoData', classes: [18, 6] }, admin, registry, 2000);
  assert.deepEqual(meetup.divisions.map(({ name, arena, format, robots, matches }) => ({ name, arena, format, robots: robots.length, matches: matches.length })), [
    { name: 'Antweight', arena: 'Arena 1', format: 'single', robots: 18, matches: 0 },
    { name: 'Beetleweight', arena: 'Arena 2', format: 'single', robots: 6, matches: 0 },
  ]);
  const robots = meetup.divisions.flatMap(division => division.robots);
  assert.ok(robots.every(robot => robot.checkedIn && robot.team && robot.name));
  assert.equal(new Set(robots.map(robot => robot.team.toLowerCase())).size, robots.length);
  assert.deepEqual(meetup.audit.at(-1), { type: 'demoData', by: admin.email, at: 2000, division: null,
    classes: ['Antweight', 'Beetleweight'], robots: 24 });
  assert.deepEqual(describeActivity(meetup.audit.at(-1), meetup), { title: 'Demo data added', detail: 'Antweight, Beetleweight · 24 robots' });

  // A second fill adds classes alongside the first, with new names, arenas, and teams.
  meetup = updateMeetup(meetup, { type: 'demoData', classes: [4] }, admin, registry);
  assert.deepEqual(meetup.divisions.map(division => division.name + ' / ' + division.arena),
    ['Antweight / Arena 1', 'Beetleweight / Arena 2', 'Featherweight / Arena 3']);
  const teams = meetup.divisions.flatMap(division => division.robots).map(robot => robot.team.toLowerCase());
  assert.equal(new Set(teams).size, 28);
});

test('demo data skips names already in use and stays unique at the class and roster limits', () => {
  let meetup = createClass(newMeetup(meetupData, manager), 'Beetleweight', 2);
  meetup = updateMeetup(meetup, { type: 'editDivision', division: meetup.divisions[0].id, name: 'Beetleweight', arena: 'Arena 2' }, manager, registry);
  meetup = updateMeetup(meetup, { type: 'demoData', classes: [2, 2] }, admin, registry);
  assert.deepEqual(meetup.divisions.map(division => division.name + ' / ' + division.arena),
    ['Beetleweight / Arena 2', 'Antweight / Arena 1', 'Featherweight / Arena 3']);

  let full = newMeetup(meetupData, manager);
  full = updateMeetup(full, { type: 'demoData', classes: Array(12).fill(64) }, admin, registry);
  assert.equal(full.divisions.length, 12);
  assert.equal(new Set(full.divisions.map(division => division.name)).size, 12);
  const teams = full.divisions.flatMap(division => division.robots).map(robot => robot.team.toLowerCase());
  assert.equal(teams.length, 768);
  assert.equal(new Set(teams).size, 768);
  assert.throws(() => updateMeetup(full, { type: 'demoData', classes: [2] }, admin, registry), /weight-class limit/);
});

test('demo data is limited to super admins, open meetups, and valid counts', () => {
  const meetup = newMeetup(meetupData, manager);
  assert.throws(() => updateMeetup(meetup, { type: 'demoData', classes: [18, 6] }, manager, registry), { status: 403 });
  assert.throws(() => updateMeetup({ ...meetup, complete: true }, { type: 'demoData', classes: [4] }, admin, registry), /Reopen the meetup/);
  for (const classes of [[], [1], [65], [2.5], ['8'], Array(13).fill(2), undefined]) {
    assert.throws(() => updateMeetup(meetup, { type: 'demoData', classes }, admin, registry), /Add 1 to 12 demo classes/);
  }
});

test('the display language defaults to English, can be changed later, and reaches the public feed', () => {
  let meetup = newMeetup(meetupData, manager);
  assert.equal(meetup.language, 'en');
  assert.equal(publicMeetup(meetup).language, 'en');
  meetup = updateMeetup(meetup, { type: 'settings', ...meetupData, language: 'he' }, manager, registry, 1000);
  assert.equal(meetup.language, 'he');
  assert.equal(publicMeetup(meetup).language, 'he');
  assert.equal(newMeetup({ ...meetupData, language: 'he' }, manager).language, 'he');
  assert.throws(() => updateMeetup(meetup, { type: 'settings', ...meetupData, language: 'fr' }, manager, registry, 1000),
    /English or Hebrew/);
  const { language, ...legacy } = meetup;
  assert.equal(publicMeetup(legacy).language, 'en');
});

const team = { email: 'builder@example.com', name: 'Dana Builder', role: null };
const stranger = { email: 'stranger@example.com', name: 'Someone Else', role: null };

function registrationEvent() {
  const event = attendanceClass('single', 2);
  event.dispatch({ type: 'addDivision', name: 'Beetleweight', arena: 'Arena Bravo', format: 'single' });
  event.dispatch({ type: 'registration', open: true });
  const register = (data, actor = team) => event.dispatch({ type: 'teamRegister', token: event.meetup.registration.token,
    team: 'Hammer Bros', name: 'Crusher', contact: { phone: '050-123-4567' }, ...data }, actor);
  return { ...event, register, get meetup() { return event.meetup; } };
}

test('one team can enter several robots in a class, but not two robots with the same name', () => {
  const event = attendanceClass('single', 1);
  event.dispatch({ type: 'addRobots', robots: [{ team: 'Hammer Bros', name: 'Anvil' }, { team: 'hammer bros', name: 'Mallet' }] });
  assert.throws(() => event.dispatch({ type: 'addRobots', robots: [{ team: 'HAMMER BROS', name: 'anvil' }] }), /already has a robot called/);
  const anvil = event.meetup.divisions[0].robots.find(robot => robot.name === 'Anvil');
  const rename = data => event.dispatch({ type: 'renameRobot', robot: anvil.id, team: 'Hammer Bros', name: 'Anvil', ...data });
  assert.throws(() => rename({ name: 'Mallet' }), /already has a robot called/);
  rename({ weapon: ' Hammer ', owner: 'Builder@Example.com' });
  const stored = () => event.meetup.divisions[0].robots.find(robot => robot.id === anvil.id);
  assert.equal(stored().weapon, 'Hammer');
  assert.equal(stored().owner, 'builder@example.com');
  assert.throws(() => rename({ owner: 'nope' }), /valid owner email/);
  assert.throws(() => rename({ photo: 'https://example.com/robot.png' }), /photo again/);
  assert.throws(() => rename({ photo: '/api/assets/another-meetup/0123456789abcdef01.webp' }), /photo again/);
  rename({ photo: '/api/assets/' + event.meetup.id + '/0123456789abcdef01.webp' });
  rename({ photo: '/demo-robots/3.svg' });
  const shown = publicMeetup(event.meetup).divisions[0].robots.find(robot => robot.id === anvil.id);
  assert.deepEqual(shown, { id: anvil.id, team: 'Hammer Bros', name: 'Anvil', weapon: 'Hammer', photo: '/demo-robots/3.svg' });
  rename({ weapon: '', photo: '', owner: '' });
  assert.deepEqual(Object.keys(stored()).sort(), ['checkedIn', 'id', 'name', 'team']);
});

test('teams register through the open link with a valid token, and only edit their own robots', () => {
  const event = registrationEvent();
  const [first, second] = event.meetup.divisions;
  assert.throws(() => event.register({ division: first.id, token: 'wrong' }), { status: 403 });
  assert.throws(() => event.register({ division: first.id, contact: { phone: 'call me' } }), /phone number/);
  event.register({ division: first.id, weapon: 'Drum', savedId: 'saved-1' });
  const robot = event.meetup.divisions[0].robots.at(-1);
  assert.deepEqual({ ...robot, id: undefined }, { id: undefined, team: 'Hammer Bros', name: 'Crusher', checkedIn: false,
    weapon: 'Drum', owner: team.email, contact: { name: 'Dana Builder', phone: '050-123-4567' }, savedId: 'saved-1' });
  event.register({ division: first.id, name: 'Crusher Jr' });
  assert.throws(() => event.register({ division: first.id }), /already has a robot called/);
  const view = publicMeetup(event.meetup).divisions[0].robots.find(item => item.id === robot.id);
  assert.equal(view.owner, undefined);
  assert.equal(view.contact, undefined);
  assert.equal(staffMeetup(event.meetup).divisions[0].robots.find(item => item.id === robot.id).contact.phone, '050-123-4567');

  const edit = (data, actor = team) => event.dispatch({ type: 'teamEdit', division: first.id, robot: robot.id,
    team: 'Hammer Bros', name: 'Crusher', ...data }, actor);
  assert.throws(() => edit({ weapon: 'Axe' }, stranger), { status: 403 });
  assert.throws(() => event.dispatch({ type: 'teamCancel', division: first.id, robot: robot.id }, stranger), { status: 403 });
  edit({ weapon: 'Axe', photo: '/demo-robots/1.svg' });
  assert.equal(event.meetup.divisions[0].robots.find(item => item.id === robot.id).weapon, 'Axe');
  edit({ to: second.id });
  assert.ok(event.meetup.divisions[1].robots.some(item => item.id === robot.id));
  assert.equal(event.meetup.audit.at(-1).to, second.id);
  event.dispatch({ type: 'teamCancel', division: second.id, robot: robot.id }, team);
  assert.ok(!event.meetup.divisions.some(division => division.robots.some(item => item.id === robot.id)));
  assert.deepEqual(event.meetup.audit.slice(-2).map(entry => describeActivity(entry, event.meetup).title),
    ['Team updated a robot', 'Team cancelled a robot']);

  event.dispatch({ type: 'teamContact', contact: { phone: '+972 50 999 9999' } }, team);
  assert.ok(event.meetup.divisions[0].robots.filter(item => item.owner === team.email)
    .every(item => item.contact.phone === '+972 50 999 9999'));
});

test('one account registers up to five robots in a meetup, counting robots staff assigned to it', () => {
  const event = registrationEvent();
  const [first, second] = event.meetup.divisions;
  const mine = () => event.meetup.divisions.flatMap(division => division.robots).filter(robot => robot.owner === team.email);
  for (let index = 0; index < 5; index++) event.register({ division: index < 3 ? first.id : second.id, name: 'Entry ' + index });
  assert.throws(() => event.register({ division: second.id, name: 'Sixth' }), { status: 409, message: /up to 5 robots/ });
  assert.equal(mine().length, 5);
  // Another account and staff are not held back by this account's cap.
  event.register({ division: second.id, name: 'Rival' }, stranger);
  event.dispatch({ type: 'addRobots', division: second.id, robots: [{ team: 'Hammer Bros', name: 'Staff entry' }] });
  // Cancelling frees a place, and a robot staff hand to the account takes one.
  event.dispatch({ type: 'teamCancel', division: second.id, robot: mine().at(-1).id }, team);
  event.dispatch({ type: 'renameRobot', robot: event.robot(0).id, team: 'Team 0', name: 'Bot 0', owner: team.email });
  assert.throws(() => event.register({ division: second.id, name: 'Sixth' }), /up to 5 robots/);
});

test('the activity log keeps the newest 500 changes', () => {
  let meetup = newMeetup(meetupData, manager);
  for (let index = 0; index < 520; index++) {
    meetup = updateMeetup(meetup, { type: 'publish', published: index % 2 === 0 }, manager, registry, index);
  }
  assert.equal(meetup.revision, 520);
  assert.equal(meetup.audit.length, 500);
  assert.deepEqual([meetup.audit[0].at, meetup.audit.at(-1).at], [20, 519]);
});

test('team registration closes with the switch, a new link, a started class, or a completed meetup', () => {
  const event = registrationEvent();
  const [first, second] = event.meetup.divisions;
  const token = event.meetup.registration.token;
  assert.ok(token.length >= 20);
  assert.equal(publicMeetup(event.meetup).registration, undefined);
  event.dispatch({ type: 'registration', regenerate: true });
  assert.notEqual(event.meetup.registration.token, token);
  assert.equal(event.meetup.audit.at(-1).token, undefined);
  assert.throws(() => event.register({ division: first.id, token }), /no longer valid/);
  event.register({ division: first.id });
  event.dispatch({ type: 'registration', open: false });
  assert.throws(() => event.register({ division: first.id, name: 'Other' }), /closed/);
  event.dispatch({ type: 'registration', open: true });
  const robot = event.meetup.divisions[0].robots.at(-1);
  event.dispatch({ type: 'checkIn', robot: robot.id, checkedIn: true });
  event.dispatch({ type: 'generate', format: 'single' });
  event.dispatch({ type: 'start', match: event.meetup.divisions[0].queue[0] });
  assert.throws(() => event.register({ division: first.id, name: 'Late' }), /locked/);
  assert.throws(() => event.dispatch({ type: 'teamCancel', division: first.id, robot: robot.id }, team), /started/);
  assert.throws(() => event.dispatch({ type: 'teamEdit', division: first.id, robot: robot.id, team: 'Hammer Bros',
    name: 'Crusher', to: second.id }, team), /locked/);
  event.dispatch({ type: 'teamEdit', division: first.id, robot: robot.id, team: 'Hammer Bros', name: 'Crusher', weapon: 'Hammer' }, team);
  assert.equal(event.meetup.divisions[0].robots.find(item => item.id === robot.id).weapon, 'Hammer');
  assert.equal(describeActivity({ type: 'registration', open: true }, event.meetup).title, 'Team registration opened');
  assert.equal(describeActivity({ type: 'registration', open: true, regenerated: true }, event.meetup).title,
    'Registration link regenerated');
  const { registration, ...legacy } = event.meetup;
  assert.deepEqual(staffMeetup(legacy).registration, { open: false, token: null });
  const reopened = updateMeetup(legacy, { type: 'registration', open: true }, manager, registry, 1000);
  assert.ok(reopened.registration.open && reopened.registration.token);
});

test('seeding keeps teammates out of opening battles together and apart for as long as it can', () => {
  const robots = teams => teams.map((name, index) => ({ id: 'r' + index, team: name }));
  const openers = (list, format) => buildBracket(list, format).filter(match => match.side === 'W' && match.round === 1)
    .map(match => match.slots.map(slot => list.find(robot => robot.id === slot.id)?.team));
  for (const format of ['single', 'double']) {
    for (const teams of [['A', 'A', 'B', 'C'], ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'A'], ['A', 'A', 'A', 'B', 'B', 'C', 'D', 'E', 'F']]) {
      for (const [first, second] of openers(robots(teams), format)) assert.notEqual(first, second, format + ' ' + teams.join(''));
    }
  }
  const unique = robots(['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(spreadTeams(unique).map(robot => robot.id), unique.map(robot => robot.id));
  assert.equal(spreadTeams(robots(['A', 'A', 'B', 'C']))[0].id, 'r0', 'the top seed stays on top');
  // Two A robots in an 8-robot bracket end up in different halves, so they can only meet in the final.
  const spread = spreadTeams(robots(['A', 'A', 'B', 'C', 'D', 'E', 'F', 'G']));
  const halves = [[1, 8, 4, 5], [2, 7, 3, 6]].map(seeds => seeds.map(seed => spread[seed - 1].team));
  assert.ok(halves.every(half => half.filter(name => name === 'A').length === 1));
  assert.equal(spreadTeams(robots(['A', 'A'])).length, 2);
});

test('rounds format pairs teammates only when nothing else works', () => {
  let meetup = newMeetup(meetupData, manager);
  const dispatch = action => { meetup = updateMeetup(meetup, { division: meetup.divisions[0]?.id, ...action }, manager, registry, 1000); };
  dispatch({ type: 'addDivision', name: 'Antweight', arena: 'Arena Alpha', format: 'rounds' });
  dispatch({ type: 'addRobots', robots: ['A', 'A', 'B', 'B', 'C', 'C'].map((name, index) => ({
    team: 'Team ' + name, name: 'Bot ' + index, checkedIn: true,
  })) });
  dispatch({ type: 'generate', format: 'rounds' });
  const teamOf = id => meetup.divisions[0].robots.find(robot => robot.id === id).team;
  for (const match of meetup.divisions[0].matches) {
    const [first, second] = match.slots.map(slot => slot.id);
    assert.notEqual(teamOf(first), teamOf(second));
  }
  const players = [{ id: 'x', seed: 0, losses: 0, sitOuts: 0 }, { id: 'y', seed: 1, losses: 0, sitOuts: 0 }];
  assert.equal(pairRound(players, new Set(['x|y'])).pairs.length, 1, 'teammates still meet when they are the only two left');
});
