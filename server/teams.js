// Team self-registration API.
// - /api/register/<meetupId>: a team's robots in one meetup. Reading or registering needs the meetup's secret token;
//   a signed-in owner can always reach the robots they already have there.
// - /api/garage: the saved robots and photos that follow a Google account from meetup to meetup.
// Saved data lives in users/<key>.json and photos/<key>/<file>. A robot entered in a meetup is a copy: its photo is copied
// into assets/<meetupId>/ under the same file name, so deleting a meetup never removes a team's saved photos.
// Any Google account can sign in, so every route here is rationed: an account's file counts its changes and uploads
// per day, and this server's memory holds it to one request at a time and a number of POSTs per hour.
import { createHash } from 'node:crypto';
import { requireValue } from './bracket.js';
import { currentTheme, DEMO_PHOTO, id, MAX_TEAM_ROBOTS, phone, requireTeamRoom, text, updateMeetup } from './meetup.js';

const MAX_SAVED = 50;
// Uploads that no saved robot uses yet. Beyond this many, the oldest are deleted.
const MAX_LOOSE_UPLOADS = 20;
const MAX_DAILY_ACTIONS = 100;
const MAX_DAILY_UPLOADS = 30;
const MAX_HOURLY_POSTS = 60;
// Requests for garage photos that don't exist: each one reads storage, so an account gets only this many an hour.
const MAX_HOURLY_MISSES = 20;
// How old a copy of an account's file may be when it is only being shown or pre-checked (see cache.js).
const USER_WINDOW = 600_000;
const imageFile = /^[a-f0-9-]{18}\.(png|jpg|webp)$/;
const GARAGE = '/api/garage/';
export const userKey = address => createHash('sha256').update(address).digest('hex').slice(0, 24);
const started = division => division.matches.some(match => match.timer || match.result);

// Counts one change or one photo upload against the account's allowance for today (UTC).
function spend(user, kind) {
  const day = new Date().toISOString().slice(0, 10);
  if (user.usage?.day !== day) user.usage = { day, actions: 0, uploads: 0 };
  const uploads = kind === 'uploads';
  requireValue(user.usage[kind] < (uploads ? MAX_DAILY_UPLOADS : MAX_DAILY_ACTIONS), 'You have '
    + (uploads ? 'uploaded a lot of photos' : 'made a lot of changes') + ' today. Try again tomorrow, or ask the organizer for help.', 429);
  user.usage[kind]++;
}

// Counts events per account over the last hour, in this server's memory.
function hourly() {
  const times = new Map();
  const recent = key => (times.get(key) ?? []).filter(time => Date.now() - time < 3_600_000);
  return {
    count: key => recent(key).length,
    add(key) {
      const kept = [...recent(key), Date.now()];
      times.delete(key);
      times.set(key, kept);
      if (times.size > 5000) times.delete(times.keys().next().value);
    },
  };
}

// The routes take three kinds of meetup read from http.js: `glance` (for anyone: listed ids only, and never a
// storage read while the meetup is unchanged), `recentMeetup` (a copy at most 30 seconds old) and `findMeetup`
// (exact, with an etag). Every request is checked against the glance copy before anything is read exactly.
export function teamRoutes({ store, findMeetup, recentMeetup, glance, cacheChange, dataPath, readImage, formats, json, body }) {
  const userPath = actor => 'users/' + userKey(actor.email) + '.json';
  const photoDir = actor => 'photos/' + userKey(actor.email) + '/';
  const person = actor => ({ email: actor.email, name: actor.name });
  const blank = actor => ({ email: actor.email, name: actor.name, phone: '', team: '', robots: [] });

  // The account's file, exactly, for a request that will save it.
  async function readUser(actor) {
    const record = await store().read(userPath(actor));
    return { user: record?.value ?? blank(actor), etag: record?.etag };
  }
  // A copy for showing the page and for checking the daily allowance before anything is read exactly.
  const recentUser = async actor => (await store().recent(userPath(actor), USER_WINDOW))?.value ?? blank(actor);
  const writeUser = (actor, user, etag) => store().write(userPath(actor), { ...user, name: actor.name }, etag);

  // An account's POSTs run one after another on this server, at most MAX_HOURLY_POSTS an hour. Without the queue,
  // parallel requests would each read the same daily counter and all pass; without the hourly limit, requests
  // that fail before they are counted could repeat without end.
  const turns = new Map();
  const posts = hourly();
  const misses = hourly();
  function inTurn(actor, work) {
    requireValue(posts.count(actor.email) < MAX_HOURLY_POSTS, 'Too many changes in a short time. Wait a little and try again.', 429);
    posts.add(actor.email);
    const run = (turns.get(actor.email) ?? Promise.resolve()).then(work);
    const settled = run.catch(() => {});
    turns.set(actor.email, settled);
    settled.then(() => { if (turns.get(actor.email) === settled) turns.delete(actor.email); });
    return run;
  }

  const owned = (meetup, actor) => actor ? meetup.divisions.flatMap(division => division.robots
    .filter(robot => robot.owner === actor.email).map(robot => ({ robot, division }))) : [];
  const savedKey = robot => robot.savedId ?? robot.id;

  function requireAccess(meetup, token, actor) {
    const registration = meetup.registration ?? {};
    const tokenValid = Boolean(registration.token) && token === registration.token;
    requireValue(tokenValid || owned(meetup, actor).length,
      'This registration link is not valid. Ask the organizer for the current link.', 404);
    return tokenValid;
  }

  // Copies an image unless the destination already has it. The source is read first: naming a file that exists
  // only at the destination (someone else's image in the meetup) must be refused, not treated as already copied.
  async function copy(from, to) {
    const item = await store().read(from, true);
    requireValue(item, 'Upload the robot photo again.');
    if (await store().read(to, true)) return;
    try {
      await store().write(to, item.value, undefined, formats[to.split('.').at(-1)]);
    } catch (error) {
      if (error.status !== 409) throw error;
    }
  }

  // The photo to store on a meetup robot: a garage photo is copied into the meetup's assets.
  async function meetupPhoto(actor, key, value, current) {
    if (typeof value !== 'string' || !value) return '';
    if (value === current || DEMO_PHOTO.test(value)) return value;
    const file = value.startsWith(GARAGE) ? value.slice(GARAGE.length) : '';
    requireValue(imageFile.test(file), 'Upload the robot photo again.');
    await copy(photoDir(actor) + file, 'assets/' + key + '/' + file);
    return '/api/assets/' + key + '/' + file;
  }

  // The photo to keep on a saved robot: a meetup photo is copied into the garage.
  async function garagePhoto(actor, key, value) {
    if (!value || DEMO_PHOTO.test(value) || value.startsWith(GARAGE)) return value || '';
    const prefix = '/api/assets/' + key + '/';
    const file = value.startsWith(prefix) ? value.slice(prefix.length) : '';
    if (!imageFile.test(file)) return '';
    await copy('assets/' + key + '/' + file, photoDir(actor) + file);
    return GARAGE + file;
  }

  function remember(user, savedId, fields) {
    let saved = user.robots.find(item => item.id === savedId);
    if (!saved) {
      requireValue(user.robots.length < MAX_SAVED, 'Your garage is full. Remove a saved robot first.', 409);
      saved = { id: savedId };
      user.robots.push(saved);
    }
    Object.assign(saved, fields);
    // A photo a saved robot uses is no longer a loose upload.
    if (fields.photo && user.uploads) user.uploads = user.uploads.filter(file => GARAGE + file !== fields.photo);
  }

  // Deletes a garage photo once no saved robot uses it.
  async function discard(actor, user, photo) {
    if (photo?.startsWith(GARAGE) && !user.robots.some(item => item.photo === photo)) {
      await store().remove(photoDir(actor) + photo.slice(GARAGE.length));
    }
  }

  // Applies one team action to the meetup, retrying when another write lands first, so teams never see a conflict.
  async function change(key, actor, action) {
    for (let attempt = 0; ; attempt++) {
      const { value: meetup, etag } = await findMeetup(key);
      const updated = updateMeetup(meetup, { ...action, revision: meetup.revision }, person(actor), { managers: [] });
      try {
        await store().write(dataPath(key), updated, etag);
        await cacheChange(key, meetup, updated);
        return updated;
      } catch (error) {
        if (error.status !== 409 || attempt >= 3) throw error;
      }
    }
  }

  // Robots staff assigned to this account join its garage the first time the team opens the meetup, and pick up
  // the team's phone number for staff. Opening the page writes only when one of those actually changed something.
  async function adopt(key, meetup, actor, record) {
    const { user } = record;
    const entries = owned(meetup, actor);
    const missing = entries.filter(({ robot }) => !user.robots.some(saved => saved.id === savedKey(robot)));
    const added = missing.slice(0, Math.max(MAX_SAVED - user.robots.length, 0));
    for (const { robot } of added) {
      remember(user, savedKey(robot), { team: robot.team, name: robot.name, weapon: robot.weapon ?? '',
        photo: await garagePhoto(actor, key, robot.photo) });
    }
    if (added.length) await writeUser(actor, user, record.etag);
    if (user.phone && entries.some(({ robot }) => robot.contact?.phone !== user.phone)) {
      return change(key, actor, { type: 'teamContact', contact: { phone: user.phone } });
    }
    return meetup;
  }

  function view(meetup, token, actor, user) {
    const tokenValid = requireAccess(meetup, token, actor);
    const registration = meetup.registration ?? { open: false };
    const theme = currentTheme(meetup.theme);
    const entries = owned(meetup, actor);
    return {
      meetup: {
        id: meetup.id, name: meetup.name, date: meetup.date, language: meetup.language ?? 'en',
        published: meetup.published, complete: meetup.complete, accent: theme.accent,
        logo: meetup.published || !theme.logo.startsWith('/api/') ? theme.logo : '',
        divisions: meetup.divisions.map(division => ({ id: division.id, name: division.name,
          open: !started(division) && division.robots.length < 64 })),
      },
      registration: { open: Boolean(registration.open) && !meetup.complete, tokenValid, limit: MAX_TEAM_ROBOTS },
      user: actor ? person(actor) : null,
      profile: user ? { phone: user.phone, team: user.team } : null,
      entries: entries.map(({ robot, division }) => ({
        id: robot.id, team: robot.team, name: robot.name, weapon: robot.weapon ?? '', photo: robot.photo ?? '',
        division: division.id, checkedIn: robot.checkedIn, withdrawn: robot.withdrawn === true, locked: started(division),
      })),
      garage: (user?.robots ?? []).map(saved => ({
        ...saved, entered: entries.some(({ robot }) => savedKey(robot) === saved.id),
      })),
    };
  }

  // Whether opening the page would write: a robot to add to the garage, or a phone number to copy onto robots.
  function needsAdopting(meetup, actor, user) {
    const entries = owned(meetup, actor);
    const unsaved = entries.some(({ robot }) => !user.robots.some(saved => saved.id === savedKey(robot)));
    return (unsaved && user.robots.length < MAX_SAVED)
      || Boolean(user.phone && entries.some(({ robot }) => robot.contact?.phone !== user.phone));
  }

  async function read(key, token, actor) {
    const copy = await glance(key);
    requireAccess(copy, token, actor);
    if (!actor) return json(view(copy, token, null, null));
    let meetup = await recentMeetup(key);
    let user = await recentUser(actor);
    // Only when opening the page has something to write are the two files read exactly.
    if (needsAdopting(meetup, actor, user)) {
      const record = await readUser(actor);
      meetup = await adopt(key, (await findMeetup(key)).value, actor, record);
      user = record.user;
    }
    return json(view(meetup, token, actor, user));
  }

  async function write(key, data, actor) {
    const token = typeof data.token === 'string' ? data.token : '';
    // The link and today's allowance are checked on copies first, so a request that fails either reads nothing.
    requireAccess(await glance(key), token, actor);
    if (data.type !== 'cancel') spend(await recentUser(actor), 'actions');
    const { value: meetup } = await findMeetup(key);
    requireAccess(meetup, token, actor);
    const { user, etag } = await readUser(actor);
    // Each branch below saves the account's file, which carries this count. Cancelling doesn't, and isn't counted:
    // it can only undo a registration, which was.
    if (data.type !== 'cancel') spend(user, 'actions');
    const fields = () => ({ team: text(data.team), name: text(data.name), weapon: text(data.weapon, 40) });
    if (data.type === 'profile') {
      user.phone = phone(data.phone);
      user.team = text(data.team);
      await writeUser(actor, user, etag);
      if (owned(meetup, actor).length) await change(key, actor, { type: 'teamContact', contact: { phone: user.phone } });
    } else if (data.type === 'register') {
      requireValue(user.phone, 'Add your phone number first.');
      // Checked here as well as in the reducer, so a refused registration copies no photo.
      requireTeamRoom(meetup, actor.email);
      const savedId = user.robots.some(saved => saved.id === data.savedId) ? data.savedId : id();
      const before = user.robots.find(saved => saved.id === savedId)?.photo;
      remember(structuredClone(user), savedId, {});
      const photo = await meetupPhoto(actor, key, data.photo, null);
      await change(key, actor, { type: 'teamRegister', division: data.division, token, ...fields(), photo,
        contact: { phone: user.phone }, savedId });
      remember(user, savedId, { ...fields(), photo: await garagePhoto(actor, key, photo) });
      await writeUser(actor, user, etag);
      await discard(actor, user, before);
    } else if (data.type === 'edit') {
      const entry = owned(meetup, actor).find(({ robot }) => robot.id === data.robot);
      requireValue(entry, 'Robot not found.', 404);
      const photo = await meetupPhoto(actor, key, data.photo, entry.robot.photo);
      await change(key, actor, { type: 'teamEdit', division: entry.division.id, robot: entry.robot.id, to: data.to,
        ...fields(), photo, ...(user.phone && { contact: { phone: user.phone } }) });
      const saved = user.robots.find(item => item.id === savedKey(entry.robot));
      const before = saved?.photo;
      if (saved || user.robots.length < MAX_SAVED) {
        remember(user, savedKey(entry.robot), { ...fields(), photo: await garagePhoto(actor, key, photo) });
      }
      await writeUser(actor, user, etag);
      await discard(actor, user, before);
    } else if (data.type === 'cancel') {
      const entry = owned(meetup, actor).find(({ robot }) => robot.id === data.robot);
      requireValue(entry, 'Robot not found.', 404);
      await change(key, actor, { type: 'teamCancel', division: entry.division.id, robot: entry.robot.id });
    } else if (data.type === 'forget') {
      const saved = user.robots.find(item => item.id === data.saved);
      requireValue(saved, 'Saved robot not found.', 404);
      user.robots = user.robots.filter(item => item !== saved);
      await writeUser(actor, user, etag);
      await discard(actor, user, saved.photo);
    } else {
      requireValue(false, 'Unknown registration action.');
    }
    return read(key, token, actor);
  }

  // Photos are uploaded to the team's garage first and copied into a meetup when a robot is saved there. An upload
  // needs the same access as registering: an open, valid link, or robots the account already has in that meetup.
  async function upload(data, actor) {
    const { image, extension } = readImage(data);
    const meetup = await glance(typeof data.meetup === 'string' ? data.meetup : '');
    const tokenValid = requireAccess(meetup, typeof data.token === 'string' ? data.token : '', actor);
    requireValue(owned(meetup, actor).length || (tokenValid && meetup.registration.open && !meetup.complete),
      'Registration for this meetup is closed.', 409);
    spend(await recentUser(actor), 'uploads');
    const { user, etag } = await readUser(actor);
    spend(user, 'uploads');
    const file = id() + '.' + extension;
    const loose = [...(user.uploads ?? []), file];
    const dropped = loose.splice(0, Math.max(loose.length - MAX_LOOSE_UPLOADS, 0));
    user.uploads = loose;
    // The count and the file name are saved before the photo. Whatever happens next, the upload has been counted
    // and the file can be found again to delete it.
    await writeUser(actor, user, etag);
    for (const name of dropped) await discard(actor, user, GARAGE + name);
    await store().write(photoDir(actor) + file, image, undefined, formats[extension]);
    return json({ url: GARAGE + file }, 201);
  }

  async function photo(file, actor) {
    requireValue(actor && imageFile.test(file ?? '') && misses.count(actor.email) < MAX_HOURLY_MISSES, 'Image not found.', 404);
    // Photos are never overwritten, so they are read through Blob's cache.
    const item = await store().read(photoDir(actor) + file, true, true);
    if (!item) misses.add(actor.email);
    requireValue(item, 'Image not found.', 404);
    return new Response(item.value, { headers: {
      'content-type': formats[file.split('.').at(-1)], 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=3600',
    } });
  }

  return async function handle(request, actor, section, key, action) {
    const reading = request.method === 'GET';
    requireValue(!action, 'Page not found.', 404);
    if (reading) return section === 'garage' ? photo(key, actor) : read(key, new URL(request.url).searchParams.get('token') ?? '', actor);
    requireValue(section !== 'garage' || !key, 'Page not found.', 404);
    requireValue(actor, 'Sign in with Google to continue.', 401);
    const data = await body(request);
    return inTurn(actor, () => section === 'garage' ? upload(data, actor) : write(key, data, actor));
  };
}
