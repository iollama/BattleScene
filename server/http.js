import { Buffer } from 'node:buffer';
import { dangerouslyDeleteByTag } from '@vercel/functions';
import { authService } from './auth.js';
import { requireValue } from './bracket.js';
import { withCache } from './cache.js';
import { demoMeetup, email, id, newMeetup, publicImages, publicMeetup, staffMeetup, updateMeetup } from './meetup.js';
import { createStore } from './store.js';
import { teamRoutes } from './teams.js';
import { describeActivity } from '../shared/activity.js';

const dataPath = meetup => 'meetups/' + meetup + '.json';
const meetupId = path => path.slice('meetups/'.length, -'.json'.length);
// How old a copy may be (see cache.js): for staff polling the open meetup, and for the lists of meetups and activity.
const STAFF_WINDOW = 30_000;
const LIST_WINDOW = 300_000;
// A meetup counts as in use for this long after its last change. Its display feed is then read exactly.
const IN_USE = 7_200_000;
const tag = meetup => 'battlescene-' + meetup;
const imageTag = meetup => tag(meetup) + '-images';
// The edge-cache tags a saved change makes stale: always the watch feed, and the images too when one of them stops
// being public (the meetup was unpublished or deleted, or a photo or logo was replaced or removed).
export function staleTags(key, before, after) {
  const kept = publicImages(after);
  const lost = [...publicImages(before)].some(image => !kept.has(image));
  return lost ? [tag(key), imageTag(key)] : [tag(key)];
}
// Public images are cached by URL at the edge, so only the URL form the rewrite in vercel.json produces is served.
// On Vercel the function sees the original path plus "?path=<route>&route=<route>"; locally there is no query.
// Any other spelling of the same route, such as an added parameter, would be a new cache key and a new download.
function canonical(url, path) {
  const route = encodeURIComponent(path);
  return url.pathname === '/api/' + path && ['', '?path=' + route, '?path=' + route + '&route=' + route].includes(url.search);
}
const goodId = /^[a-z0-9-]{3,48}$/;
const formats = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const assetFile = /^[a-f0-9-]{18}\.(png|jpg|webp)$/;
const canManage = (meetup, actor) => actor?.role === 'admin'
  || (actor?.role === 'manager' && (meetup.owner === actor.email || meetup.managers.includes(actor.email)));
const json = (value, status = 200, headers = {}) => Response.json(value, {
  status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
});

// `backend` replaces the store underneath the cache; tests pass one that counts storage operations.
export function createHandler({ local = false, env = process.env, directory, backend } = {}) {
  let storage;
  const store = () => storage ??= withCache(backend ?? createStore({ local, directory }));
  const auth = authService({ env, local, store });
  let demoSetup;

  async function ensureDemo() {
    if (!auth.localDemo) return;
    demoSetup ??= (async () => {
      if (!await store().read(dataPath('foundry'))) {
        await store().write(dataPath('foundry'), demoMeetup(auth.demoUser));
      }
      await listMeetups(['foundry']);
    })().catch(error => {
      demoSetup = undefined;
      throw error;
    });
    await demoSetup;
  }

  // roles.json lists the id of every meetup, so a request that names any other id is refused without reading storage.
  // A meetup is written first and listed second, and is taken off the list only when it is deleted or an exact read
  // finds it gone, so a listed id whose file is missing was deleted.
  // This returns the list after adding `ids` to it, building it from storage on a deployment that predates it.
  let building;
  async function listMeetups(ids) {
    const listed = (await auth.roles()).meetups;
    if (listed && ids.every(item => listed.includes(item))) return listed;
    building ??= auth.updateRegistry(async value => {
      const known = value.meetups ?? (await store().paths('meetups/')).map(meetupId);
      const missing = ids.filter(item => !known.includes(item));
      return value.meetups && !missing.length ? null : { ...value, meetups: [...known, ...missing] };
    }).finally(() => { building = undefined; });
    const { meetups } = await building;
    return ids.every(item => meetups.includes(item)) ? meetups : listMeetups(ids);
  }

  async function readMeetups() {
    const paths = await store().paths('meetups/');
    await listMeetups(paths.map(meetupId));
    const records = await Promise.all(paths.map(item => store().recent(item, LIST_WINDOW)));
    return records.map(item => item?.value).filter(Boolean);
  }

  // The exact record with its etag: for every save, and for staff who ask for the very latest.
  async function findMeetup(key) {
    requireValue(goodId.test(key ?? ''), 'Meetup not found.', 404);
    const record = await store().read(dataPath(key));
    requireValue(record, 'Meetup not found.', 404);
    return record;
  }

  // A copy at most `window` old, current on the server that saved it: for staff polling and signed-in team pages.
  async function recentMeetup(key, window = STAFF_WINDOW) {
    requireValue(goodId.test(key ?? ''), 'Meetup not found.', 404);
    const record = await store().recent(dataPath(key), window);
    requireValue(record, 'Meetup not found.', 404);
    return record.value;
  }

  // The meetup as shown to a caller without staff access. Only a listed id is looked up at all, and then from a copy
  // that costs no storage read while the meetup is unchanged, so no number of such requests can use up the allowance.
  const confirmed = new Set();
  async function glance(key) {
    requireValue(goodId.test(key ?? '') && (await listMeetups([])).includes(key), 'Meetup not found.', 404);
    const record = await store().relaxed(dataPath(key));
    if (record) return record.value;
    // Listed but missing. One exact read confirms it, once per server, and then the id comes off the list.
    if (!confirmed.has(key)) {
      confirmed.add(key);
      const exact = await store().read(dataPath(key));
      if (exact) return exact.value;
      await auth.updateRegistry(value => value.meetups?.includes(key)
        ? { ...value, meetups: value.meetups.filter(item => item !== key) } : null).catch(() => {});
    }
    requireValue(false, 'Meetup not found.', 404);
  }

  // Delete (not just mark stale) the cached watch feed, so the next screen poll gets the change.
  // invalidateByTag would serve the old copy once more while it revalidates, costing a full poll.
  async function cacheChange(key, before, after) {
    if (local || !env.VERCEL) return;
    try {
      await dangerouslyDeleteByTag(staleTags(key, before, after), { revalidationDeadlineSeconds: 0 });
    } catch (error) {
      console.warn('Could not refresh the spectator cache:', error.message);
    }
  }

  async function body(request) {
    const raw = await request.text();
    requireValue(raw.length <= 750_000, 'Request is too large.', 413);
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      requireValue(false, 'Invalid request body.');
    }
    requireValue(value && typeof value === 'object' && !Array.isArray(value), 'Invalid request body.');
    return value;
  }

  function checkOrigin(request) {
    const actual = request.headers.get('origin');
    const allowed = (env.APP_ORIGIN && !local ? new URL(env.APP_ORIGIN) : new URL(request.url)).origin;
    requireValue(actual === allowed, 'Request origin is not allowed.', 403);
  }

  // An uploaded image is public once the meetup is published if it is the logo or a robot's photo. Staff can always
  // see it, and a team can see its own robots' photos.
  async function asset(request, key, filename) {
    requireValue(assetFile.test(filename ?? ''), 'Image not found.', 404);
    const meetup = await glance(key);
    const address = '/api/assets/' + key + '/' + filename;
    const isPublic = publicImages(meetup).has(address);
    const actor = isPublic ? null : await auth.actor(request);
    const owns = actor && meetup.divisions.some(division => division.robots
      .some(robot => robot.photo === address && robot.owner === actor.email));
    requireValue(isPublic || canManage(meetup, actor) || owns, 'Image not found.', 404);
    // Uploaded images are never overwritten, so they are read through Blob's cache.
    const item = await store().read('assets/' + key + '/' + filename, true, true);
    requireValue(item, 'Image not found.', 404);
    // A public image is the same for everyone: browsers keep it for a day and the edge for five minutes, and the
    // edge copy is dropped by tag as soon as the image stops being public.
    const caching = isPublic ? { 'cache-control': 'public, max-age=86400', 'Vercel-CDN-Cache-Control': 'public, s-maxage=300',
      'Vercel-Cache-Tag': imageTag(key) } : { 'cache-control': 'no-store' };
    return new Response(item.value, { headers: {
      'content-type': formats[filename.split('.').at(-1)], 'x-content-type-options': 'nosniff', ...caching,
    } });
  }

  function readImage(data) {
    requireValue(Object.hasOwn(formats, data.extension) && typeof data.bytes === 'string', 'Choose a PNG, JPEG or WebP image.');
    const image = Buffer.from(data.bytes, 'base64');
    const header = image.subarray(0, 12);
    const valid = data.extension === 'png' ? header.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
      : data.extension === 'jpg' ? header.subarray(0, 3).toString('hex') === 'ffd8ff'
        : header.subarray(0, 4).toString() === 'RIFF' && header.subarray(8).toString() === 'WEBP';
    requireValue(valid && image.length <= 500_000, 'Choose a valid image up to 500 KB.');
    return { image, extension: data.extension };
  }

  async function upload(key, data) {
    const { image } = readImage(data);
    const path = 'assets/' + key + '/' + id() + '.' + data.extension;
    await store().write(path, image, undefined, formats[data.extension]);
    return json({ url: '/api/' + path }, 201);
  }

  async function remove(meetup, data, actor) {
    requireValue(actor.role === 'admin' || meetup.owner === actor.email,
      'Only the meetup owner or a super admin can delete it.', 403);
    requireValue(data.revision === meetup.revision, 'Someone saved a change. Review the refreshed meetup and try again.', 409);
    requireValue(typeof data.name === 'string' && data.name.trim() === meetup.name, 'Type the meetup name to confirm.');
    await store().remove('assets/' + meetup.id + '/');
    await store().remove(dataPath(meetup.id));
    await cacheChange(meetup.id, meetup, null);
    try {
      await auth.updateRegistry(value => ({
        ...value, meetups: value.meetups?.filter(item => item !== meetup.id),
        history: [...(value.history ?? []), { type: 'deleteMeetup', name: meetup.name, by: actor.email, at: Date.now() }].slice(-200),
      }));
    } catch (error) {
      console.warn('Could not record the meetup deletion:', error.message);
    }
    return json({ deleted: meetup.id });
  }

  const teams = teamRoutes({ store, findMeetup, recentMeetup, glance, cacheChange, dataPath, readImage, formats, json, body });

  async function handle(request) {
    const url = new URL(request.url);
    const path = url.pathname === '/api/dispatch' ? url.searchParams.get('path') : url.pathname.slice(5);
    const [section, key, action, ...extra] = (path ?? '').split('/');
    const read = request.method === 'GET';
    requireValue(read || request.method === 'POST', 'Method not allowed.', 405);
    requireValue(!extra.length, 'Page not found.', 404);
    if (!read) checkOrigin(request);
    if (section === 'auth') {
      if (read && key === 'login') return auth.login(request);
      if (read && key === 'callback') return auth.callback(request);
      if (!read && key === 'logout') return auth.logout(request);
    }
    await ensureDemo();
    if (section === 'watch' && read && !action) {
      // Displays and phones poll this feed. The edge keeps the answer until the next save deletes it (cacheChange),
      // so the function runs once per save and once every 20 seconds as a safety net.
      // - A meetup in use is read exactly here, as it always was, so a display never shows an older state.
      // - One nobody has changed for two hours is served from the copy that costs no read: a screen left on
      //   overnight would otherwise read storage every 20 seconds.
      // - Any URL but the one the rewrite produces gets that copy too, and no edge caching. A re-spelled URL would be
      //   a fresh cache key, and must not be able to cost a read.
      const copy = await glance(key);
      requireValue(copy.published, 'This meetup is currently private.', 404);
      const exactUrl = canonical(url, path ?? '');
      const meetup = exactUrl && Date.now() - copy.updatedAt < IN_USE ? (await findMeetup(key)).value : copy;
      requireValue(meetup.published, 'This meetup is currently private.', 404);
      return json(publicMeetup(meetup), 200, exactUrl ? {
        etag: '"' + meetup.revision + '"', 'cache-control': 'public, max-age=0, must-revalidate',
        'Vercel-CDN-Cache-Control': 'public, s-maxage=20',
        'Vercel-Cache-Tag': tag(meetup.id),
      } : {});
    }
    if (section === 'assets' && read) {
      requireValue(canonical(url, path ?? ''), 'Image not found.', 404);
      return asset(request, key, action);
    }
    const actor = await auth.actor(request);
    if (section === 'session' && read) return json({ user: actor, demo: auth.localDemo, configured: auth.ready });
    // Team registration works for any signed-in Google account, and its landing page for signed-out visitors.
    // In local demo mode everyone is the demo admin, so registration pages start signed out until "Continue with Google"
    // switches to the demo team.
    if ((section === 'register' && key) || section === 'garage') {
      return teams(request, auth.localDemo && actor === auth.demoUser ? null : actor, section, key, action);
    }
    requireValue(actor?.role, actor ? 'This Google account has no staff access.' : 'Sign in with Google to continue.', actor ? 403 : 401);
    if (section === 'roles' && !key) {
      requireValue(actor.role === 'admin', 'Only a super admin can manage staff access.', 403);
      if (read) return json((await auth.registry()).value);
      const data = await body(request);
      const target = email(data.email);
      requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target), 'Enter a valid email address.');
      return json(await auth.updateRegistry(value => {
        const managers = new Set(value.managers);
        if (data.authorize === true) managers.add(target);
        else managers.delete(target);
        const history = [...(value.history ?? []), {
          type: data.authorize === true ? 'authorizeManager' : 'revokeManager', email: target, by: actor.email, at: Date.now(),
        }].slice(-200);
        return { ...value, managers: [...managers].sort(), history };
      }));
    }
    if (section === 'activity' && !key && read) {
      const meetups = (await readMeetups()).filter(item => canManage(item, actor));
      const entries = meetups.flatMap(meetup => meetup.audit.slice(-100).map(entry => ({
        at: entry.at, by: entry.by, meetupId: meetup.id, meetupName: meetup.name, timezone: meetup.timezone,
        ...describeActivity(entry, meetup),
      })));
      if (actor.role === 'admin') {
        const staff = (await auth.roles()).history ?? [];
        entries.push(...staff.map(entry => ({
          at: entry.at, by: entry.by, meetupId: null, meetupName: null, timezone: null, ...describeActivity(entry, null),
        })));
      }
      return json(entries.sort((a, b) => b.at - a.at).slice(0, 150));
    }
    if (section === 'meetups' && !key) {
      if (read) {
        const meetups = (await readMeetups()).filter(item => canManage(item, actor))
          .map(({ id, name, date, published, complete, updatedAt }) => ({ id, name, date, published, complete, updatedAt }))
          .sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt - a.updatedAt);
        return json(meetups);
      }
      const meetup = newMeetup(await body(request), actor);
      await store().write(dataPath(meetup.id), meetup);
      await listMeetups([meetup.id]);
      return json(staffMeetup(meetup), 201);
    }
    if (section === 'meetups' && key && read && !action) {
      // The dashboard polls this. A copy up to 30 seconds old will do (it is current on the server that saved);
      // "?fresh=1" asks for an exact read, which the dashboard does after a conflict and on its Refresh button.
      const meetup = url.searchParams.get('fresh') === '1' ? (await findMeetup(key)).value : await recentMeetup(key);
      requireValue(canManage(meetup, actor), 'You are not assigned to this meetup.', 403);
      return json(staffMeetup(meetup));
    }
    if (section === 'meetups' && key) {
      const { value: meetup, etag } = await findMeetup(key);
      requireValue(canManage(meetup, actor), 'You are not assigned to this meetup.', 403);
      if (!read && action === 'image') return upload(key, await body(request));
      if (!read && action === 'delete') return remove(meetup, await body(request), actor);
      if (!read && !action) {
        const data = await body(request);
        requireValue(typeof data.type === 'string' && !data.type.startsWith('team'), 'Unknown meetup action.');
        requireValue(data.revision === meetup.revision, 'Someone saved a change. Review the refreshed meetup and try again.', 409);
        const registry = ['assign', 'transfer'].includes(data.type) ? (await auth.registry()).value : { managers: [] };
        const updated = updateMeetup(meetup, data, actor, registry);
        await store().write(dataPath(key), updated, etag);
        await cacheChange(key, meetup, updated);
        return json(staffMeetup(updated));
      }
    }
    requireValue(false, 'Page not found.', 404);
  }

  return async request => {
    try {
      return await handle(request);
    } catch (error) {
      const status = error.status ?? 500;
      if (status >= 500 && !error.status) console.error('BattleScene request failed:', error);
      return json({ error: error.status ? error.message : 'The service could not complete this request.', details: error.details }, status);
    }
  };
}
