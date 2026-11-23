// Team self-registration API.
// - /api/register/<meetupId>: a team's robots in one meetup. Reading or registering needs the meetup's secret token;
//   a signed-in owner can always reach the robots they already have there.
// - /api/garage: the saved robots and photos that follow a Google account from meetup to meetup.
// Saved data lives in users/<key>.json and photos/<key>/<file>. A robot entered in a meetup is a copy: its photo is copied
// into assets/<meetupId>/ under the same file name, so deleting a meetup never removes a team's saved photos.
import { createHash } from 'node:crypto';
import { requireValue } from './bracket.js';
import { currentTheme, DEMO_PHOTO, id, phone, text, updateMeetup } from './meetup.js';

const MAX_SAVED = 50;
const MAX_PHOTOS = 60;
const imageFile = /^[a-f0-9-]{18}\.(png|jpg|webp)$/;
const GARAGE = '/api/garage/';
export const userKey = address => createHash('sha256').update(address).digest('hex').slice(0, 24);
const started = division => division.matches.some(match => match.timer || match.result);

export function teamRoutes({ store, findMeetup, cacheChange, dataPath, readImage, formats, json, body }) {
  const userPath = actor => 'users/' + userKey(actor.email) + '.json';
  const photoDir = actor => 'photos/' + userKey(actor.email) + '/';
  const person = actor => ({ email: actor.email, name: actor.name });

  async function readUser(actor) {
    if (!actor) return { user: null };
    const record = await store().read(userPath(actor));
    return { user: record?.value ?? { email: actor.email, name: actor.name, phone: '', team: '', robots: [] }, etag: record?.etag };
  }
  const writeUser = (actor, user, etag) => store().write(userPath(actor), { ...user, name: actor.name }, etag);

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

  // Copies an image unless the destination already has it.
  async function copy(from, to) {
    if (await store().read(to, true)) return;
    const item = await store().read(from, true);
    requireValue(item, 'Upload the robot photo again.');
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
  }

  // Applies one team action to the meetup, retrying when another write lands first, so teams never see a conflict.
  async function change(key, actor, action) {
    for (let attempt = 0; ; attempt++) {
      const { value: meetup, etag } = await findMeetup(key);
      const updated = updateMeetup(meetup, { ...action, revision: meetup.revision }, person(actor), { managers: [] });
      try {
        await store().write(dataPath(key), updated, etag);
        await cacheChange(key);
        return updated;
      } catch (error) {
        if (error.status !== 409 || attempt >= 3) throw error;
      }
    }
  }

  // Robots staff assigned to this account join its garage the first time the team opens the meetup, and pick up
  // the team's phone number for staff.
  async function adopt(key, meetup, actor, record) {
    const { user } = record;
    const entries = owned(meetup, actor);
    const missing = entries.filter(({ robot }) => !user.robots.some(saved => saved.id === savedKey(robot)));
    for (const { robot } of missing.slice(0, MAX_SAVED - user.robots.length)) {
      remember(user, savedKey(robot), { team: robot.team, name: robot.name, weapon: robot.weapon ?? '',
        photo: await garagePhoto(actor, key, robot.photo) });
    }
    if (missing.length) await writeUser(actor, user, record.etag);
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
      registration: { open: Boolean(registration.open) && !meetup.complete, tokenValid },
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

  async function read(key, token, actor) {
    let { value: meetup } = await findMeetup(key);
    requireAccess(meetup, token, actor);
    const record = await readUser(actor);
    if (actor) meetup = await adopt(key, meetup, actor, record);
    return json(view(meetup, token, actor, record.user));
  }

  async function write(key, data, actor) {
    requireValue(actor, 'Sign in with Google to continue.', 401);
    const { value: meetup } = await findMeetup(key);
    const token = typeof data.token === 'string' ? data.token : '';
    requireAccess(meetup, token, actor);
    const { user, etag } = await readUser(actor);
    const fields = () => ({ team: text(data.team), name: text(data.name), weapon: text(data.weapon, 40) });
    if (data.type === 'profile') {
      user.phone = phone(data.phone);
      user.team = text(data.team);
      await writeUser(actor, user, etag);
      if (owned(meetup, actor).length) await change(key, actor, { type: 'teamContact', contact: { phone: user.phone } });
    } else if (data.type === 'register') {
      requireValue(user.phone, 'Add your phone number first.');
      const savedId = user.robots.some(saved => saved.id === data.savedId) ? data.savedId : id();
      remember(structuredClone(user), savedId, {});
      const photo = await meetupPhoto(actor, key, data.photo, null);
      await change(key, actor, { type: 'teamRegister', division: data.division, token, ...fields(), photo,
        contact: { phone: user.phone }, savedId });
      remember(user, savedId, { ...fields(), photo: await garagePhoto(actor, key, photo) });
      await writeUser(actor, user, etag);
    } else if (data.type === 'edit') {
      const entry = owned(meetup, actor).find(({ robot }) => robot.id === data.robot);
      requireValue(entry, 'Robot not found.', 404);
      const photo = await meetupPhoto(actor, key, data.photo, entry.robot.photo);
      await change(key, actor, { type: 'teamEdit', division: entry.division.id, robot: entry.robot.id, to: data.to,
        ...fields(), photo, ...(user.phone && { contact: { phone: user.phone } }) });
      if (user.robots.some(saved => saved.id === savedKey(entry.robot)) || user.robots.length < MAX_SAVED) {
        remember(user, savedKey(entry.robot), { ...fields(), photo: await garagePhoto(actor, key, photo) });
        await writeUser(actor, user, etag);
      }
    } else if (data.type === 'cancel') {
      const entry = owned(meetup, actor).find(({ robot }) => robot.id === data.robot);
      requireValue(entry, 'Robot not found.', 404);
      await change(key, actor, { type: 'teamCancel', division: entry.division.id, robot: entry.robot.id });
    } else if (data.type === 'forget') {
      const saved = user.robots.find(item => item.id === data.saved);
      requireValue(saved, 'Saved robot not found.', 404);
      user.robots = user.robots.filter(item => item !== saved);
      await writeUser(actor, user, etag);
      if (saved.photo?.startsWith(GARAGE) && !user.robots.some(item => item.photo === saved.photo)) {
        await store().remove(photoDir(actor) + saved.photo.slice(GARAGE.length));
      }
    } else {
      requireValue(false, 'Unknown registration action.');
    }
    return read(key, token, actor);
  }

  // Photos are uploaded to the team's garage first and copied into a meetup when a robot is saved there.
  // Uploads that were never saved are cleared once the garage holds too many files.
  async function upload(data, actor) {
    requireValue(actor, 'Sign in with Google to continue.', 401);
    const { image, extension } = readImage(data);
    let files = await store().paths(photoDir(actor));
    if (files.length >= MAX_PHOTOS) {
      const { user } = await readUser(actor);
      const kept = new Set(user.robots.map(saved => saved.photo).filter(Boolean));
      for (const path of files.filter(path => !kept.has(GARAGE + path.split('/').at(-1)))) await store().remove(path);
      files = await store().paths(photoDir(actor));
      requireValue(files.length < MAX_PHOTOS, 'Remove a saved robot before uploading more photos.', 409);
    }
    const file = id() + '.' + extension;
    await store().write(photoDir(actor) + file, image, undefined, formats[extension]);
    return json({ url: GARAGE + file }, 201);
  }

  async function photo(file, actor) {
    requireValue(actor && imageFile.test(file ?? ''), 'Image not found.', 404);
    const item = await store().read(photoDir(actor) + file, true);
    requireValue(item, 'Image not found.', 404);
    return new Response(item.value, { headers: {
      'content-type': formats[file.split('.').at(-1)], 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=3600',
    } });
  }

  return async function handle(request, actor, section, key, action) {
    const reading = request.method === 'GET';
    requireValue(!action, 'Page not found.', 404);
    if (section === 'garage') {
      if (reading) return photo(key, actor);
      requireValue(!key, 'Page not found.', 404);
      return upload(await body(request), actor);
    }
    if (reading) return read(key, new URL(request.url).searchParams.get('token') ?? '', actor);
    return write(key, await body(request), actor);
  };
}
