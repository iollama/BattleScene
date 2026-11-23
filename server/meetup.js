import { randomBytes, randomUUID } from 'node:crypto';
import { DEFAULT_LANGUAGE, isLanguage } from '../shared/i18n.js';
import { CLASS_DISPLAY_LAYOUTS, DEFAULT_DISPLAY_LAYOUT, DISPLAY_LAYOUTS, MAX_VENUE_DISPLAYS, normalizeDisplayLayout } from '../shared/displays.js';
import {
  affectedMatches, arenaState, buildBracket, canSwapSlots, frozenMatchChanges, isArenaActive, placementList,
  requireValue, resolveBracket, scheduleMatches,
} from './bracket.js';
import { DEMO_TEAM, demoClassNames, demoLook, demoRobots, MAX_WEIGHT_CLASSES, nextArenaName } from './demo.js';
import { nextRound, roundStandings } from './rounds.js';

export const text = (value, max = 80) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const id = () => randomUUID().slice(0, 18);
export const defaultTheme = { accent: '#8fd0ff', background: '#0e1318', tone: 'light', logo: '' };
export const email = value => text(value, 254).toLowerCase();
const field = (value, label, max) => {
  const result = text(value, max);
  requireValue(result, 'Enter ' + label + '.');
  return result;
};
const color = value => /^#[0-9a-f]{6}$/i.test(value ?? '');
export const registrationToken = () => randomBytes(16).toString('base64url');
const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

// A robot photo is an image uploaded to this meetup or one of the bundled demo renders.
export const DEMO_PHOTO = /^\/demo-robots\/\d{1,2}\.svg$/;
function photo(value, meetupId) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean) return '';
  const prefix = '/api/assets/' + meetupId + '/';
  const asset = clean.startsWith(prefix) && /^[a-f0-9-]{18}\.(png|jpg|webp)$/.test(clean.slice(prefix.length));
  requireValue(asset || DEMO_PHOTO.test(clean), 'Upload the robot photo again.');
  return clean;
}

export function phone(value) {
  const clean = text(value, 24);
  requireValue(/^\+?[0-9][0-9 ()-]{5,22}$/.test(clean) && clean.replace(/\D/g, '').length >= 6, 'Enter a phone number.');
  return clean;
}

// Optional robot details. A key that is missing from `data` leaves the stored value alone.
function setDetails(meetup, robot, data) {
  if ('weapon' in data) {
    const weapon = text(data.weapon, 40);
    if (weapon) robot.weapon = weapon;
    else delete robot.weapon;
  }
  if ('photo' in data) {
    const image = photo(data.photo, meetup.id);
    if (image) robot.photo = image;
    else delete robot.photo;
  }
}

// Team and robot name together must be unique within a weight class, so one team can enter several robots.
const robotKey = (team, name) => team.toLowerCase() + '\u0000' + name.toLowerCase();
function requireUnique(division, team, name, except) {
  requireValue(!division.robots.some(robot => robot !== except && robotKey(robot.team, robot.name) === robotKey(team, name)),
    team + ' already has a robot called ' + name + ' in ' + division.name + '.');
}

function url(value, asset = false) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (!clean) return '';
  requireValue(clean.length <= 2000, 'Use a link of 2,000 characters or fewer.');
  if (asset && /^\/api\/assets\/[a-z0-9-]+\/[a-f0-9-]+\.(png|jpg|webp)$/.test(clean)) return clean;
  let parsed;
  try {
    parsed = new URL(clean);
  } catch { /* Input is validated below. */ }
  requireValue(parsed && ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password,
    'Enter a valid HTTP or HTTPS link.');
  requireValue(parsed.href.length <= 2000, 'Use a link of 2,000 characters or fewer.');
  return parsed.href;
}

function qr(value) {
  const title = text(value?.title);
  const link = url(value?.url);
  requireValue(Boolean(title) === Boolean(link), 'Enter both a QR title and destination.');
  return title ? { title, url: link } : null;
}

function settings(data) {
  const name = field(data.name, 'a meetup name');
  const date = text(data.date, 10);
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString().slice(0, 10) === date, 'Enter a valid date.');
  const timezone = field(data.timezone, 'a timezone', 64);
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
  } catch {
    requireValue(false, 'Enter a timezone such as Asia/Jerusalem.');
  }
  const language = data.language ?? DEFAULT_LANGUAGE;
  requireValue(isLanguage(language), 'Choose English or Hebrew for the display language.');
  return { name, date, timezone, language, duration: duration(data.duration ?? 180), lastCall: callLength(data.lastCall ?? DEFAULT_LAST_CALL) };
}

export const DEFAULT_LAST_CALL = 120;
function callLength(value) {
  const seconds = Number(value);
  requireValue(Number.isInteger(seconds) && seconds >= 10 && seconds <= 900, 'Enter a last call from 10 to 900 seconds.');
  return seconds;
}

function duration(value) {
  const seconds = Number(value);
  requireValue(Number.isInteger(seconds) && seconds >= 1 && seconds <= 3600, 'Enter a duration from 1 to 3600 seconds.');
  return seconds;
}

// New meetups start with one Ringmaster display, which staff can edit or remove like any other.
export function newMeetup(data, actor) {
  const ringmaster = { id: id(), name: 'Ringmaster', layout: DEFAULT_DISPLAY_LAYOUT, division: '', rounds: '', qr: null };
  return {
    id: id(), revision: 0, ...settings(data), owner: actor.email, managers: [],
    published: false, complete: false, divisions: [], screens: [ringmaster], spectatorScreenId: null, theme: { ...defaultTheme },
    qr: null, registration: { open: false, token: registrationToken() }, audit: [], updatedAt: Date.now(),
  };
}

const BRACKET_FORMATS = ['single', 'double', 'rounds'];
const bracketFormat = value => BRACKET_FORMATS.includes(value) ? value : 'single';

function addDivision(meetup, data) {
  requireValue(meetup.divisions.length < MAX_WEIGHT_CLASSES, 'This meetup has reached the weight-class limit.');
  const name = field(data.name, 'a weight class name');
  const arena = field(data.arena, 'an arena name');
  requireValue(!meetup.divisions.some(item => item.name.toLowerCase() === name.toLowerCase()
    || item.arena.toLowerCase() === arena.toLowerCase()), 'Use a unique class and arena name.');
  const division = {
    id: id(), name, arena, format: bracketFormat(data.format),
    active: true, robots: [], matches: [], queue: [], qr: null,
  };
  meetup.divisions.push(division);
  return division;
}

// Super admins can add practice classes, each with its own arena and checked-in robots. Brackets are left to
// the Generate step so the format can still be chosen.
function addDemoData(meetup, data, actor) {
  requireValue(actor.role === 'admin', 'Only a super admin can add demo data.', 403);
  requireValue(!meetup.complete, 'Reopen the meetup to add demo data.', 409);
  const room = MAX_WEIGHT_CLASSES - meetup.divisions.length;
  requireValue(room > 0, 'This meetup has reached the weight-class limit.');
  const counts = data.classes;
  requireValue(Array.isArray(counts) && counts.length >= 1 && counts.length <= room
    && counts.every(count => Number.isInteger(count) && count >= 2 && count <= 64),
  `Add 1 to ${room} demo classes, each with 2 to 64 robots.`);
  const names = demoClassNames(meetup.divisions.map(item => item.name), counts.length);
  counts.forEach((count, index) => {
    const arena = nextArenaName(meetup.divisions.map(item => item.arena));
    const division = addDivision(meetup, { name: names[index], arena, format: 'single' });
    addRobots(meetup, division, demoRobots(count, meetup.divisions.flatMap(item => item.robots).map(robot => robot.team)));
  });
  return { classes: names, robots: counts.reduce((total, count) => total + count, 0) };
}

function divisionById(meetup, key) {
  const division = meetup.divisions.find(item => item.id === key);
  requireValue(division, 'Weight class not found.', 404);
  return division;
}

const started = division => division.matches.some(match => match.timer || match.result);
const lookupMatch = (division, key) => {
  const match = division.matches.find(item => item.id === key);
  requireValue(match, 'Match not found.', 404);
  return match;
};

// Only checked-in robots enter the bracket. Until the first battle, roster and check-in changes rebuild it.
const contenders = division => division.robots.filter(robot => robot.checkedIn && !robot.withdrawn);

function reseed(division) {
  if (!division.matches.length) return;
  const entrants = contenders(division);
  division.matches = entrants.length >= 2 ? buildBracket(entrants, division.format) : [];
  division.queue = scheduleMatches(division.matches);
}

function generate(division, data) {
  requireValue(!started(division), 'An active bracket can be edited using slot swaps.');
  const entrants = contenders(division);
  requireValue(entrants.length >= 2, 'Check in at least two robots before generating the bracket.');
  division.format = bracketFormat(data.format);
  division.matches = buildBracket(entrants, division.format);
  division.queue = scheduleMatches(division.matches);
  return division.robots.filter(robot => !entrants.includes(robot)).map(robot => robot.id);
}

function lastCall(meetup, division, data, now) {
  const match = lookupMatch(division, data.match);
  if (data.call === false) {
    requireValue(match.call, 'This battle has no last call.');
    delete match.call;
    return;
  }
  requireValue(isArenaActive(division), 'Activate this arena before calling robots.');
  requireValue(!match.timer && !match.result, 'Only upcoming battles can be called.');
  requireValue(!match.held, 'Release the hold before calling robots.');
  const resolved = arenaState(division).bracket.get(match.id);
  requireValue(resolved.state === 'ready', 'Both opponents must be known before a last call.');
  requireValue(!division.matches.some(item => item.call && item !== match), 'This arena already has a last call running.');
  match.call = { startedAt: now, duration: (meetup.lastCall ?? DEFAULT_LAST_CALL) * 1000 };
}

function withdraw(division, data) {
  const robot = division.robots.find(item => item.id === data.robot);
  requireValue(robot, 'Robot not found.', 404);
  requireValue(started(division), 'Before the first battle, check the robot out or remove it instead.');
  requireValue(!robot.withdrawn, 'This robot has already withdrawn.');
  requireValue(division.matches.some(match => match.slots.some(slot => slot.kind === 'robot' && slot.id === robot.id)),
    'This robot is not in the bracket.');
  requireValue(!arenaState(division).current?.entrants.includes(robot.id), 'This robot is fighting. Record the result first.');
  robot.withdrawn = true;
  robot.checkedIn = false;
}

// Ends last calls for battles that started or were decided, and forfeits every battle a withdrawn robot reaches,
// including ones that only become known after other results. Returns the ids of the battles it forfeited.
function settleAttendance(division, now) {
  const forfeits = [];
  const withdrawn = new Set(division.robots.filter(robot => robot.withdrawn).map(robot => robot.id));
  for (;;) {
    const bracket = resolveBracket(division);
    for (const stored of division.matches) {
      if (stored.call && bracket.get(stored.id).state !== 'ready') delete stored.call;
    }
    const next = division.matches.find(stored => {
      const match = bracket.get(stored.id);
      return match.state === 'ready' && match.entrants.some(robotId => withdrawn.has(robotId));
    });
    if (!next) return forfeits;
    const { entrants } = bracket.get(next.id);
    const winner = entrants.find(robotId => !withdrawn.has(robotId)) ?? entrants[0];
    next.result = { winner, entrants: [...entrants], method: 'forfeit', withdrawal: true, at: now };
    delete next.call;
    delete next.held;
    forfeits.push(next.id);
  }
}

// Adds robots to a class and returns them. Entries may carry a weapon and photo; teams also pass owner and contact.
function addRobots(meetup, division, entries, extra = {}) {
  requireValue(!started(division), 'Registration for this class is locked after its first battle.');
  requireValue(Array.isArray(entries) && entries.length > 0 && entries.length <= 64
    && division.robots.length + entries.length <= 64, 'Add up to 64 robots per weight class.');
  const added = entries.map(entry => {
    const robot = { id: id(), team: field(entry?.team, 'a team name'), name: field(entry?.name, 'a robot name'),
      checkedIn: entry.checkedIn === true };
    requireUnique(division, robot.team, robot.name);
    setDetails(meetup, robot, { weapon: entry.weapon, photo: entry.photo });
    Object.assign(robot, extra);
    division.robots.push(robot);
    return robot;
  });
  reseed(division);
  return added;
}

function editRobot(meetup, division, data) {
  const index = division.robots.findIndex(robot => robot.id === data.robot);
  requireValue(index >= 0, 'Robot not found.', 404);
  const robot = division.robots[index];
  if (data.type === 'checkIn') {
    requireValue(!robot.withdrawn, 'This robot has withdrawn from the event.');
    requireValue(data.checkedIn === true || !arenaState(division).current?.entrants.includes(robot.id),
      'This robot is currently fighting.');
    robot.checkedIn = data.checkedIn === true;
    if (!started(division)) reseed(division);
    return;
  }
  if (data.type === 'renameRobot') {
    const team = field(data.team, 'a team name');
    const name = field(data.name, 'a robot name');
    requireUnique(division, team, name, robot);
    Object.assign(robot, { team, name });
    setDetails(meetup, robot, data);
    if ('owner' in data) {
      const owner = email(data.owner);
      requireValue(!owner || validEmail(owner), 'Enter a valid owner email address.');
      if (owner !== (robot.owner ?? '')) {
        delete robot.contact;
        delete robot.savedId;
      }
      if (owner) robot.owner = owner;
      else delete robot.owner;
    }
    return;
  }
  requireValue(!started(division), 'The class roster and seeds are locked after its first battle.');
  if (data.type === 'removeRobot') {
    division.robots.splice(index, 1);
  } else {
    const destination = Number(data.seed) - 1;
    requireValue(Number.isInteger(destination) && destination >= 0 && destination < division.robots.length, 'Choose a valid seed.');
    division.robots.splice(index, 1);
    division.robots.splice(destination, 0, robot);
  }
  reseed(division);
}

// Team self-registration. Teams act on their own robots only; a robot's owner is the Google account that registered it.
const contact = (actor, data) => ({ name: text(actor.name) || actor.email, phone: phone(data.contact?.phone) });

function ownRobot(division, data, actor) {
  const robot = division.robots.find(item => item.id === data.robot);
  requireValue(robot, 'Robot not found.', 404);
  requireValue(actor.email && robot.owner === actor.email, 'This robot belongs to another account.', 403);
  return robot;
}

function teamRegister(meetup, division, data, actor) {
  requireValue(actor.email, 'Sign in with Google to register.', 401);
  requireValue(meetup.registration?.open, 'Registration for this meetup is closed.', 409);
  requireValue(typeof data.token === 'string' && data.token === meetup.registration.token,
    'This registration link is no longer valid. Ask the organizer for the new link.', 403);
  const extra = { owner: actor.email, contact: contact(actor, data) };
  const savedId = text(data.savedId, 24);
  if (savedId) extra.savedId = savedId;
  const [robot] = addRobots(meetup, division, [{ team: data.team, name: data.name, weapon: data.weapon, photo: data.photo }], extra);
  return robot;
}

// Returns the class the robot is in afterwards. Moving to another class is only possible before either has started.
function teamEdit(meetup, division, data, actor) {
  const robot = ownRobot(division, data, actor);
  const team = field(data.team, 'a team name');
  const name = field(data.name, 'a robot name');
  const target = data.to && data.to !== division.id ? divisionById(meetup, data.to) : division;
  if (target !== division) {
    requireValue(!started(division) && !started(target), 'Weight classes are locked after their first battle.', 409);
    requireValue(target.robots.length < 64, 'That weight class is full.', 409);
  }
  requireUnique(target, team, name, robot);
  Object.assign(robot, { team, name });
  setDetails(meetup, robot, data);
  if (data.contact) robot.contact = contact(actor, data);
  if (target !== division) {
    division.robots.splice(division.robots.indexOf(robot), 1);
    robot.checkedIn = false;
    target.robots.push(robot);
    reseed(division);
    reseed(target);
  }
  return target;
}

function teamCancel(division, data, actor) {
  const robot = ownRobot(division, data, actor);
  requireValue(!started(division), 'This class has started. Ask the organizer to withdraw the robot.', 409);
  division.robots.splice(division.robots.indexOf(robot), 1);
  reseed(division);
  return robot;
}

// Refreshes the staff contact details on every robot this account owns here, after the team changes its phone number.
function teamContact(meetup, data, actor) {
  requireValue(actor.email, 'Sign in with Google to continue.', 401);
  const details = contact(actor, data);
  for (const robot of meetup.divisions.flatMap(item => item.robots).filter(item => item.owner === actor.email)) {
    robot.contact = details;
  }
}

function changeRegistration(meetup, data) {
  meetup.registration ??= { open: false, token: registrationToken() };
  if (typeof data.open === 'boolean') meetup.registration.open = data.open;
  if (data.regenerate === true) meetup.registration.token = registrationToken();
  return { open: meetup.registration.open, regenerated: data.regenerate === true };
}

function changeSlots(division, data) {
  const first = lookupMatch(division, data.first);
  const second = lookupMatch(division, data.second);
  const { firstSlot, secondSlot } = data;
  requireValue([0, 1].includes(firstSlot) && [0, 1].includes(secondSlot)
    && (first !== second || firstSlot !== secondSlot), 'Choose two different bracket slots.');
  requireValue(!first.timer && !second.timer && !first.result && !second.result,
    'Only unstarted matchups can be rearranged.');
  requireValue(canSwapSlots(first, firstSlot, second, secondSlot), 'Choose slots in the same bracket and round.');
  const source = first.slots[firstSlot];
  first.slots[firstSlot] = second.slots[secondSlot];
  second.slots[secondSlot] = source;
  requireValue(!frozenMatchChanges(division).length, 'This swap changes a match that has already started.');
}

function changeQueue(division, data) {
  const index = division.queue.indexOf(data.match);
  const destination = division.queue.indexOf(data.before);
  requireValue(index >= 0 && destination >= 0 && index !== destination, 'Choose a different queue position.');
  const match = lookupMatch(division, data.match);
  const target = lookupMatch(division, data.before);
  requireValue([match, target].every(item => !item.timer && !item.result), 'Only upcoming battles can be reordered.');
  division.queue.splice(index, 1);
  division.queue.splice(destination, 0, match.id);
}

function pauseTimer(timer, now) {
  timer.remaining = Math.max(0, timer.remaining - Math.max(0, now - timer.startedAt));
  timer.startedAt = null;
}

function changeArenaStatus(division, data, now) {
  requireValue(typeof data.active === 'boolean', 'Choose whether the arena is active.');
  const timer = division.matches.find(match => match.timer)?.timer;
  if (!data.active && timer?.startedAt != null) pauseTimer(timer, now);
  division.active = data.active;
}

function changeTimer(meetup, division, data, now) {
  const match = lookupMatch(division, data.match);
  if (data.type === 'start' || data.type === 'resume') {
    requireValue(isArenaActive(division), 'Activate this arena before starting its clock.');
  }
  if (data.type === 'start') {
    const arena = arenaState(division);
    requireValue(!arena.current, 'Finish the current battle first.', 409);
    const upcoming = arena.bracket.get(match.id);
    requireValue(arena.ready(upcoming), 'Check in both robots and release any hold before starting.');
    const total = duration(data.duration ?? meetup.duration) * 1000;
    match.timer = { entrants: upcoming.entrants, duration: total, remaining: total, startedAt: now };
    return;
  }
  const timer = match.timer;
  requireValue(timer && !match.result, 'This battle has no active timer.', 409);
  if (data.type === 'reset') {
    timer.startedAt = null;
    timer.remaining = timer.duration;
  } else if (data.type === 'pause') {
    requireValue(timer.startedAt !== null, 'The timer is already paused.');
    pauseTimer(timer, now);
  } else {
    requireValue(timer.startedAt === null && timer.remaining > 0, 'Pause or reset the timer before restarting it.');
    timer.startedAt = now;
  }
}

function recordResult(division, data, actor, now) {
  const match = lookupMatch(division, data.match);
  const resolved = arenaState(division).bracket.get(match.id);
  const previous = match.result;
  const method = data.method === 'forfeit' ? 'forfeit' : 'winner';
  requireValue(resolved.entrants.length === 2 && resolved.entrants.every(Boolean)
    && resolved.entrants.includes(data.winner), 'Select one of the two robots as winner.');
  requireValue(previous || match.timer || (method === 'forfeit' && resolved.state === 'ready'),
    'Start the battle first or record a forfeit.');
  match.result = { winner: data.winner, entrants: [...resolved.entrants], method, at: now };
  delete match.timer;
  if (division.format === 'rounds') {
    return { match: match.id, previous: previous ?? null, result: match.result,
      rollback: repairLaterRounds(division, match, previous && previous.winner !== data.winner, actor, data) };
  }
  const downstream = frozenMatchChanges(division);
  let rollback = [];
  if (downstream.length) {
    const affected = affectedMatches(division, match);
    const canConfirm = actor.role === 'admin';
    requireValue(canConfirm && data.confirm === true,
      canConfirm ? 'This correction requires rolling back later battles.' : 'A super admin must confirm this rollback.',
      409, { affected: affected.map(item => item.id), canConfirm });
    rollback = affected.map(item => ({ id: item.id, result: item.result ?? null, timer: item.timer ?? null }));
    for (const item of affected) {
      delete item.result;
      delete item.timer;
    }
    requireValue(!frozenMatchChanges(division).length, 'The bracket could not be corrected safely.', 409);
  }
  return { match: match.id, previous: previous ?? null, result: match.result, rollback };
}

// A corrected winner changes the records later rounds were paired from, so those rounds are dropped and paired again.
// Rolling back battles that already started needs a super admin, as in the brackets.
function repairLaterRounds(division, match, winnerChanged, actor, data) {
  const later = division.matches.filter(item => item.round > match.round);
  if (!winnerChanged || !later.length) return [];
  const affected = later.filter(item => item.result || item.timer);
  if (affected.length) {
    const canConfirm = actor.role === 'admin';
    requireValue(canConfirm && data.confirm === true,
      canConfirm ? 'This correction requires rolling back later battles.' : 'A super admin must confirm this rollback.',
      409, { affected: affected.map(item => item.id), canConfirm });
  }
  division.matches = division.matches.filter(item => item.round <= match.round);
  division.queue = division.queue.filter(key => division.matches.some(item => item.id === key));
  return affected.map(item => ({ id: item.id, result: item.result ?? null, timer: item.timer ?? null }));
}

// Rounds format: once every battle in the latest round is settled, pair the next one (repeating in case a
// withdrawal forfeit settles that round too). Returns the new match ids.
function pairRounds(division, now, forfeits) {
  const paired = [];
  for (;;) {
    forfeits.push(...settleAttendance(division, now));
    if (division.format !== 'rounds') return paired;
    const added = nextRound(division, resolveBracket(division));
    if (!added.length) return paired;
    division.matches.push(...added);
    division.queue.push(...added.map(item => item.id));
    paired.push(...added.map(item => item.id));
  }
}

function saveDisplay(meetup, data) {
  const layout = normalizeDisplayLayout(data.layout);
  requireValue(typeof layout === 'string' && Object.hasOwn(DISPLAY_LAYOUTS, layout), 'Choose a valid display layout.');
  const classId = CLASS_DISPLAY_LAYOUTS.includes(layout) ? divisionById(meetup, data.division).id : '';
  const rounds = text(data.rounds, 24);
  requireValue(!rounds || /^(W|L|F|R)\d+$/.test(rounds), 'Choose a valid bracket round.');
  const name = field(data.name, 'a display name');
  const index = meetup.screens.findIndex(screen => screen.id === data.screen);
  requireValue(index >= 0 || meetup.screens.length < MAX_VENUE_DISPLAYS, `Configure up to ${MAX_VENUE_DISPLAYS} venue displays.`);
  const screen = { id: meetup.screens[index]?.id ?? id(), name, layout, division: classId, rounds, qr: qr(data.qr) };
  if (index < 0) meetup.screens.push(screen);
  else meetup.screens[index] = screen;
  if (data.spectator === true) meetup.spectatorScreenId = screen.id;
  if (data.spectator === false && meetup.spectatorScreenId === screen.id) meetup.spectatorScreenId = null;
}

export function updateMeetup(current, data, actor, registry, now = Date.now()) {
  const meetup = structuredClone(current);
  const division = data.division ? divisionById(meetup, data.division) : null;
  const divisionActions = ['editDivision', 'removeDivision', 'addRobots', 'checkIn', 'renameRobot', 'removeRobot', 'moveSeed',
    'generate', 'swapSlots', 'moveMatch', 'hold', 'lastCall', 'withdraw', 'start', 'pause', 'resume', 'reset', 'result',
    'teamRegister', 'teamEdit', 'teamCancel'];
  requireValue(!divisionActions.includes(data.type) || division, 'Select a weight class.');
  const changes = { type: data.type, by: actor.email, at: now, division: division?.id ?? null };
  if (typeof data.match === 'string') changes.match = data.match;
  if (meetup.complete && divisionActions.includes(data.type)) {
    requireValue(false, 'Reopen the meetup before changing tournament data.', 409);
  }
  switch (data.type) {
    case 'settings':
      Object.assign(meetup, settings(data));
      break;
    case 'publish':
      meetup.published = data.published === true;
      break;
    case 'complete':
      if (data.complete) {
        const active = meetup.divisions.filter(item => item.robots.length);
        requireValue(active.length > 0 && active.every(item => placementList(item).length),
          'Finish every populated weight class before completing the meetup.');
      }
      meetup.complete = data.complete === true;
      changes.complete = meetup.complete;
      // A finished meetup no longer needs its change history; drop it to keep the record small.
      // The completion entry is appended below, so the log restarts from here.
      if (meetup.complete) meetup.audit = [];
      break;
    case 'addDivision':
      requireValue(!meetup.complete, 'Reopen the meetup to add a class.');
      addDivision(meetup, data);
      break;
    case 'demoData':
      Object.assign(changes, addDemoData(meetup, data, actor));
      break;
    case 'registration':
      Object.assign(changes, changeRegistration(meetup, data));
      break;
    case 'teamRegister': {
      const robot = teamRegister(meetup, division, data, actor);
      Object.assign(changes, { robot: robot.id, robotName: robot.name });
      break;
    }
    case 'teamEdit': {
      const target = teamEdit(meetup, division, data, actor);
      Object.assign(changes, { robot: data.robot, robotName: text(data.name) });
      if (target !== division) {
        changes.to = target.id;
        pairRounds(target, now, []);
      }
      break;
    }
    case 'teamCancel':
      changes.robotName = teamCancel(division, data, actor).name;
      break;
    case 'teamContact':
      teamContact(meetup, data, actor);
      break;
    case 'editDivision': {
      const name = field(data.name, 'a weight class name');
      const arena = field(data.arena, 'an arena name');
      requireValue(!meetup.divisions.some(item => item !== division
        && (item.name.toLowerCase() === name.toLowerCase() || item.arena.toLowerCase() === arena.toLowerCase())),
      'Use a unique class and arena name.');
      Object.assign(division, { name, arena });
      break;
    }
    case 'removeDivision':
      meetup.divisions = meetup.divisions.filter(item => item.id !== division.id);
      for (const screen of meetup.screens.filter(item => item.division === division.id)) {
        Object.assign(screen, { layout: DEFAULT_DISPLAY_LAYOUT, division: '', rounds: '' });
      }
      Object.assign(changes, { divisionName: division.name, arena: division.arena });
      break;
    case 'addRobots':
      addRobots(meetup, division, data.robots);
      break;
    case 'checkIn':
    case 'renameRobot':
    case 'removeRobot':
    case 'moveSeed':
      editRobot(meetup, division, data);
      break;
    case 'generate':
      changes.leftOut = generate(division, data);
      break;
    case 'lastCall':
      lastCall(meetup, division, data, now);
      changes.match = data.match;
      changes.call = data.call !== false;
      break;
    case 'withdraw':
      withdraw(division, data);
      changes.robot = data.robot;
      break;
    case 'swapSlots':
      changeSlots(division, data);
      Object.assign(changes, { first: data.first, firstSlot: data.firstSlot, second: data.second, secondSlot: data.secondSlot });
      break;
    case 'moveMatch':
      changeQueue(division, data);
      break;
    case 'hold': {
      const match = lookupMatch(division, data.match);
      requireValue(!match.timer && !match.result, 'Only upcoming battles can be held.');
      match.held = data.held === true;
      if (match.held) delete match.call;
      break;
    }
    case 'arenaStatus':
      requireValue(division, 'Select an arena.');
      changeArenaStatus(division, data, now);
      changes.active = division.active;
      break;
    case 'start':
    case 'pause':
    case 'resume':
    case 'reset':
      changeTimer(meetup, division, data, now);
      break;
    case 'result':
      Object.assign(changes, recordResult(division, data, actor, now));
      break;
    case 'theme':
      requireValue(color(data.accent) && color(data.background), 'Choose valid colors.');
      meetup.theme = { accent: data.accent, background: data.background, tone: data.tone === 'dark' ? 'dark' : 'light',
        logo: url(data.logo, true) };
      break;
    case 'meetupQr':
      meetup.qr = qr(data.qr);
      break;
    case 'arenaQr':
      requireValue(division, 'Select an arena.');
      division.qr = qr(data.qr);
      break;
    case 'saveDisplay':
      saveDisplay(meetup, data);
      break;
    case 'removeDisplay':
      meetup.screens = meetup.screens.filter(screen => screen.id !== data.screen);
      if (meetup.spectatorScreenId === data.screen) meetup.spectatorScreenId = null;
      break;
    case 'assign':
    case 'transfer': {
      const target = email(data.email);
      requireValue(registry.managers.includes(target), 'Authorize this manager before assigning them.');
      changes.email = target;
      if (data.type === 'transfer') {
        requireValue(actor.role === 'admin', 'Only a super admin can transfer ownership.', 403);
        meetup.managers = [...new Set([...meetup.managers, meetup.owner])].filter(item => item !== target);
        meetup.owner = target;
      } else if (target !== meetup.owner && !meetup.managers.includes(target)) {
        meetup.managers.push(target);
      }
      break;
    }
    case 'unassign':
      requireValue(actor.role === 'admin' || meetup.owner === actor.email,
        'Only the meetup owner or a super admin can remove a manager.', 403);
      changes.email = email(data.email);
      meetup.managers = meetup.managers.filter(item => item !== email(data.email));
      break;
    default:
      requireValue(false, 'Unknown meetup action.');
  }
  if (division && meetup.divisions.includes(division)) {
    const forfeits = [];
    const paired = pairRounds(division, now, forfeits);
    if (forfeits.length) changes.forfeits = forfeits;
    if (paired.length) changes.paired = paired;
  }
  meetup.revision++;
  meetup.updatedAt = now;
  meetup.audit.push(changes);
  return meetup;
}

// Meetups saved before the Hangar HUD redesign kept the old amber defaults; show them with the current defaults.
// Background images are no longer offered, so a previously saved one is dropped.
const legacyDefaultColors = { accent: '#f5b944', background: '#101316' };
export function currentTheme({ image, ...theme }) {
  const legacy = theme.accent?.toLowerCase() === legacyDefaultColors.accent
    && theme.background?.toLowerCase() === legacyDefaultColors.background;
  return legacy ? { ...theme, accent: defaultTheme.accent, background: defaultTheme.background } : theme;
}

export function publicMeetup(meetup) {
  const { id, name, date, timezone, complete, qr, screens, revision, updatedAt } = meetup;
  return {
    id, name, date, timezone, complete, theme: currentTheme(meetup.theme), qr, revision, updatedAt,
    language: meetup.language ?? DEFAULT_LANGUAGE,
    screens: screens.map(screen => ({ ...screen, layout: normalizeDisplayLayout(screen.layout) })),
    spectatorScreenId: meetup.spectatorScreenId ?? null,
    divisions: meetup.divisions.map(division => {
      const { bracket, current, next, ready } = arenaState(division);
      return {
        id: division.id, name: division.name, arena: division.arena, format: division.format, qr: division.qr,
        active: isArenaActive(division),
        robots: division.robots.map(({ id, team, name, weapon, photo, withdrawn }) => ({
          id, team, name, ...(weapon && { weapon }), ...(photo && { photo }), ...(withdrawn && { withdrawn: true }),
        })),
        matches: [...bracket.values()].map(match => ({ ...match, ready: ready(match) })),
        current: current?.id, next: next?.id, placements: placementList(division, bracket),
        ...(division.format === 'rounds' && { standings: roundStandings(division, bracket) }),
      };
    }),
  };
}

export function staffMeetup(meetup) {
  const publishedFields = publicMeetup(meetup);
  return { ...meetup, theme: publishedFields.theme, screens: publishedFields.screens, language: publishedFields.language,
    registration: meetup.registration ?? { open: false, token: null }, divisions: meetup.divisions.map((division, index) => ({
    ...division, ...publishedFields.divisions[index], robots: division.robots,
  })) };
}

export function demoMeetup(actor) {
  const meetup = newMeetup({ name: 'Foundry Fight Night', date: new Date().toISOString().slice(0, 10),
    timezone: 'Asia/Jerusalem', duration: 180 }, actor);
  meetup.id = 'foundry';
  meetup.published = true;
  // The demo registration link is /register/foundry/demo. "Continue with Google" signs in as the demo team.
  meetup.registration = { open: true, token: 'demo' };
  const classes = [
    ['Antweight', 'Arena Alpha', 'double', [
      ['Team Ironclad', 'Scrapjaw'], ['Faultline Robotics', 'Aftershock'], ['Mako Works', 'Riptide'],
      ['Project Ember', 'Hot Wire'], ['Gearbox Garage', 'Deadbolt'], ['Northstar', 'Sidewinder'],
      ['Bench Test', 'Static'], ['Voltage Club', 'Blackout'],
    ]],
    ['Beetleweight', 'Arena Bravo', 'single', [
      ['Night Shift', 'Nightcrawler'], ['Arc Engineering', 'Arc Flash'], ['Hammer Lab', 'Anvil'],
      ['Horizon', 'Jackknife'], ['Ratchet Team', 'Overdrive'], ['Rogue Bots', 'Wrecking Ball'],
    ]],
    ['Featherweight', 'Arena Charlie', 'single', [
      ['Team Atlas', 'Titan'], ['Carbon Works', 'Carbon Copy'], ['Redline', 'Rev Limit'], ['Block Party', 'Cinderblock'],
    ]],
  ];
  let look = 0;
  for (const [name, arena, format, entries] of classes) {
    const division = addDivision(meetup, { name, arena, format });
    addRobots(meetup, division, entries.map(([team, name]) => ({ team, name, checkedIn: true, ...demoLook(look++) })));
    division.matches = buildBracket(division.robots, format);
    division.queue = scheduleMatches(division.matches);
  }
  saveDisplay(meetup, { name: 'Main hall', layout: 'bracket', division: meetup.divisions[0].id });
  // Two Featherweight entries belong to the demo team account, so its registration page has robots to edit.
  for (const robot of meetup.divisions[2].robots.slice(0, 2)) {
    Object.assign(robot, { owner: DEMO_TEAM.email, contact: { name: DEMO_TEAM.name, phone: '050-555-0100' } });
  }
  return meetup;
}
