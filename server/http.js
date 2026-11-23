import { Buffer } from 'node:buffer';
import { dangerouslyDeleteByTag } from '@vercel/functions';
import { authService } from './auth.js';
import { requireValue } from './bracket.js';
import { demoMeetup, email, id, newMeetup, publicMeetup, staffMeetup, updateMeetup } from './meetup.js';
import { createStore } from './store.js';
import { teamRoutes } from './teams.js';
import { describeActivity } from '../shared/activity.js';

const dataPath = meetup => 'meetups/' + meetup + '.json';
const tag = meetup => 'battlescene-' + meetup;
const goodId = /^[a-z0-9-]{3,48}$/;
const formats = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
const assetFile = /^[a-f0-9-]{18}\.(png|jpg|webp)$/;
const canManage = (meetup, actor) => actor?.role === 'admin'
  || (actor?.role === 'manager' && (meetup.owner === actor.email || meetup.managers.includes(actor.email)));
const json = (value, status = 200, headers = {}) => Response.json(value, {
  status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
});

export function createHandler({ local = false, env = process.env, directory } = {}) {
  let storage;
  const store = () => storage ??= createStore({ local, directory });
  const auth = authService({ env, local, store });
  let demoSetup;

  async function ensureDemo() {
    if (!auth.localDemo) return;
    demoSetup ??= (async () => {
      if (!await store().read(dataPath('foundry'))) {
        await store().write(dataPath('foundry'), demoMeetup(auth.demoUser));
      }
    })().catch(error => {
      demoSetup = undefined;
      throw error;
    });
    await demoSetup;
  }

  async function readMeetups() {
    const paths = await store().paths('meetups/');
    const records = await Promise.all(paths.map(item => store().read(item)));
    return records.map(item => item?.value).filter(Boolean);
  }

  async function findMeetup(key) {
    requireValue(goodId.test(key), 'Meetup not found.', 404);
    const record = await store().read(dataPath(key));
    requireValue(record, 'Meetup not found.', 404);
    return record;
  }

  // Delete (not just mark stale) the cached watch feed, so the next screen poll gets the change.
  // invalidateByTag would serve the old copy once more while it revalidates, costing a full poll.
  async function cacheChange(meetup) {
    if (local || !env.VERCEL) return;
    try {
      await dangerouslyDeleteByTag(tag(meetup), { revalidationDeadlineSeconds: 0 });
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
    const { value: meetup } = await findMeetup(key);
    const address = '/api/assets/' + key + '/' + filename;
    const robots = meetup.divisions.flatMap(division => division.robots).filter(robot => robot.photo === address);
    const isPublic = meetup.published && (meetup.theme.logo === address || robots.length > 0);
    const actor = isPublic ? null : await auth.actor(request);
    requireValue(isPublic || canManage(meetup, actor) || (actor && robots.some(robot => robot.owner === actor.email)),
      'Image not found.', 404);
    const item = await store().read('assets/' + key + '/' + filename, true);
    requireValue(item, 'Image not found.', 404);
    return new Response(item.value, { headers: {
      'content-type': formats[filename.split('.').at(-1)],
      'x-content-type-options': 'nosniff', 'cache-control': isPublic ? 'private, max-age=3600' : 'no-store',
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
    await cacheChange(meetup.id);
    try {
      const registry = await auth.registry();
      const history = [...(registry.value.history ?? []),
        { type: 'deleteMeetup', name: meetup.name, by: actor.email, at: Date.now() }].slice(-200);
      await store().write('roles.json', { ...registry.value, history }, registry.etag);
    } catch (error) {
      console.warn('Could not record the meetup deletion:', error.message);
    }
    return json({ deleted: meetup.id });
  }

  const teams = teamRoutes({ store, findMeetup, cacheChange, dataPath, readImage, formats, json, body });

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
      const { value: meetup } = await findMeetup(key);
      requireValue(meetup.published, 'This meetup is currently private.', 404);
      const etag = '"' + meetup.revision + '"';
      return json(publicMeetup(meetup), 200, {
        etag, 'cache-control': 'public, max-age=0, must-revalidate',
        'Vercel-CDN-Cache-Control': 'public, s-maxage=20',
        'Vercel-Cache-Tag': tag(meetup.id),
      });
    }
    if (section === 'assets' && read) return asset(request, key, action);
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
      const registry = await auth.registry();
      if (read) return json(registry.value);
      const data = await body(request);
      const target = email(data.email);
      requireValue(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target), 'Enter a valid email address.');
      const managers = new Set(registry.value.managers);
      if (data.authorize === true) managers.add(target);
      else managers.delete(target);
      const history = [...(registry.value.history ?? []), {
        type: data.authorize === true ? 'authorizeManager' : 'revokeManager', email: target, by: actor.email, at: Date.now(),
      }].slice(-200);
      const value = { managers: [...managers].sort(), history };
      await store().write('roles.json', value, registry.etag);
      return json(value);
    }
    if (section === 'activity' && !key && read) {
      const meetups = (await readMeetups()).filter(item => canManage(item, actor));
      const entries = meetups.flatMap(meetup => meetup.audit.slice(-100).map(entry => ({
        at: entry.at, by: entry.by, meetupId: meetup.id, meetupName: meetup.name, timezone: meetup.timezone,
        ...describeActivity(entry, meetup),
      })));
      if (actor.role === 'admin') {
        const staff = (await auth.registry()).value.history ?? [];
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
      return json(staffMeetup(meetup), 201);
    }
    if (section === 'meetups' && key) {
      const { value: meetup, etag } = await findMeetup(key);
      requireValue(canManage(meetup, actor), 'You are not assigned to this meetup.', 403);
      if (read && !action) return json(staffMeetup(meetup));
      if (!read && action === 'image') return upload(key, await body(request));
      if (!read && action === 'delete') return remove(meetup, await body(request), actor);
      if (!read && !action) {
        const data = await body(request);
        requireValue(typeof data.type === 'string' && !data.type.startsWith('team'), 'Unknown meetup action.');
        requireValue(data.revision === meetup.revision, 'Someone saved a change. Review the refreshed meetup and try again.', 409);
        const registry = ['assign', 'transfer'].includes(data.type) ? (await auth.registry()).value : { managers: [] };
        const updated = updateMeetup(meetup, data, actor, registry);
        await store().write(dataPath(key), updated, etag);
        await cacheChange(key);
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
