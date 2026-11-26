import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { SignJWT } from 'jose';
import { returnPath } from '../server/auth.js';
import { createHandler, staleTags } from '../server/http.js';
import { createStore } from '../server/store.js';
import { userKey } from '../server/teams.js';

test('staff access, draft isolation, and simultaneous writes through the HTTP API', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'battlescene-'));
  const origin = 'http://localhost:5173';
  const env = {
    APP_ORIGIN: origin, GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-client-secret',
    SESSION_SECRET: 'local-test-signing-key-at-least-32-characters', BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
  };
  const handle = createHandler({ local: true, env, directory });
  async function session(email) {
    const token = await new SignJWT({ email }).setProtectedHeader({ alg: 'HS256' }).setIssuer('battlescene')
      .setAudience('staff').setExpirationTime('5m').sign(new TextEncoder().encode(env.SESSION_SECRET));
    return 'battlescene_session=' + token;
  }
  const call = (path, cookie, data) => handle(new Request(origin + '/api/' + path, {
    headers: { origin, ...(cookie ? { cookie } : {}) },
    ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }),
  }));
  try {
    const [admin, manager, other] = await Promise.all(['admin@example.com', 'manager@example.com', 'other@example.com'].map(session));
    for (const email of ['manager@example.com', 'other@example.com']) {
      assert.equal((await call('roles', admin, { email, authorize: true })).status, 200);
    }
    assert.equal((await call('roles', manager)).status, 403);
    const created = await call('meetups', manager, { name: 'Local league', timezone: 'UTC', date: '2026-11-21' });
    assert.equal(created.status, 201);
    const event = await created.json();
    const path = 'meetups/' + event.id;
    assert.equal((await call(path, other)).status, 403);
    assert.equal((await call('watch/' + event.id)).status, 404);
    const competing = await Promise.all([
      call(path, manager, { type: 'publish', revision: event.revision, published: true }),
      call(path, admin, { type: 'publish', revision: event.revision, published: true }),
    ]);
    assert.deepEqual(competing.map(response => response.status).sort(), [200, 409]);
    const view = await (await call('watch/' + event.id)).json();
    assert.equal(view.revision, 1);
    assert.equal(view.owner, undefined);
    assert.equal(view.audit, undefined);
    assert.equal(view.language, 'en');
    const upload = await call(path + '/image', manager, {
      extension: 'png',
      bytes: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4lYAAAAASUVORK5CYII=',
    });
    assert.equal(upload.status, 201);
    const uploaded = (await upload.json()).url;
    assert.equal((await call(uploaded.slice(5))).status, 404);
    assert.equal((await call(uploaded.slice(5), manager)).headers.get('content-type'), 'image/png');
    const theme = await call(path, manager, {
      type: 'theme', revision: 1, accent: '#eeeeee', background: '#141414', tone: 'light', logo: uploaded,
    });
    assert.equal(theme.status, 200);
    assert.equal((await call(uploaded.slice(5))).status, 200);
    const display = await call(path, manager, {
      type: 'saveDisplay', revision: 2, name: 'Tournament TV', layout: 'ladders',
    });
    assert.equal(display.status, 200);
    const screens = (await (await call('watch/' + event.id)).json()).screens;
    assert.deepEqual(screens.map(({ name, layout, division }) => ({ name, layout, division })),
      [{ name: 'Ringmaster', layout: 'ringmaster', division: '' }, { name: 'Tournament TV', layout: 'ladders', division: '' }]);
    const roles = await (await call('roles', admin)).json();
    assert.deepEqual(roles.history.map(({ type, email, by }) => ({ type, email, by })), [
      { type: 'authorizeManager', email: 'manager@example.com', by: 'admin@example.com' },
      { type: 'authorizeManager', email: 'other@example.com', by: 'admin@example.com' },
    ]);
    const adminActivity = await (await call('activity', admin)).json();
    assert.deepEqual(adminActivity.map(entry => entry.at), adminActivity.map(entry => entry.at).toSorted((a, b) => b - a));
    assert.ok(adminActivity.some(entry => entry.title === 'Manager authorized' && entry.detail === 'other@example.com' && entry.meetupId === null));
    assert.ok(adminActivity.some(entry => entry.title === 'Save display' && entry.meetupName === 'Local league'));
    const managerActivity = await (await call('activity', manager)).json();
    assert.ok(managerActivity.length > 0);
    assert.ok(managerActivity.every(entry => entry.meetupId === event.id));
    assert.deepEqual(await (await call('activity', other)).json(), []);
    assert.equal((await call('activity')).status, 401);
    assert.equal((await call('activity', await session('stranger@example.com'))).status, 403);

    const doomed = await (await call('meetups', manager, { name: 'Spare night', timezone: 'UTC', date: '2026-11-22' })).json();
    const doomedPath = 'meetups/' + doomed.id;
    assert.equal((await call(doomedPath, admin, { type: 'assign', revision: 0, email: 'other@example.com' })).status, 200);
    let doomedState = await call(doomedPath, manager, { type: 'publish', revision: 1, published: true });
    assert.equal(doomedState.status, 200);
    const asset = (await (await call(doomedPath + '/image', manager, {
      extension: 'png',
      bytes: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4lYAAAAASUVORK5CYII=',
    })).json()).url;
    assert.equal((await call(doomedPath + '/delete', other, { revision: 2, name: 'Spare night' })).status, 403);
    assert.equal((await call(doomedPath + '/delete', manager, { revision: 1, name: 'Spare night' })).status, 409);
    assert.equal((await call(doomedPath + '/delete', manager, { revision: 2, name: 'Spare' })).status, 400);
    assert.equal((await call(doomedPath + '/delete', manager, { revision: 2 })).status, 400);
    doomedState = await call(doomedPath + '/delete', manager, { revision: 2, name: ' Spare night ' });
    assert.deepEqual(await doomedState.json(), { deleted: doomed.id });
    assert.equal((await call(doomedPath, manager)).status, 404);
    assert.equal((await call('watch/' + doomed.id)).status, 404);
    assert.equal((await call(asset.slice(5), manager)).status, 404);
    assert.ok(!(await (await call('meetups', manager)).json()).some(item => item.id === doomed.id));
    assert.ok((await (await call('meetups', manager)).json()).some(item => item.id === event.id));
    assert.ok((await (await call('activity', admin)).json())
      .some(entry => entry.title === 'Meetup deleted' && entry.detail === 'Spare night' && entry.by === 'manager@example.com'));

    assert.equal((await call('roles', admin, { email: 'manager@example.com', authorize: false })).status, 200);
    assert.equal((await call(path, manager)).status, 403);
    assert.equal((await (await call('roles', admin)).json()).history.at(-1).type, 'revokeManager');
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.match(basename(directory), /^battlescene-[a-z0-9]+$/i);
    await rm(directory, { recursive: true, force: true });
  }
});

test('teams register through the secret link, keep a garage, and see only their own robots', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'battlescene-'));
  const origin = 'http://localhost:5173';
  const env = {
    APP_ORIGIN: origin, GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-client-secret',
    SESSION_SECRET: 'local-test-signing-key-at-least-32-characters', BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
  };
  const handle = createHandler({ local: true, env, directory });
  async function session(email) {
    const token = await new SignJWT({ email, name: email.split('@')[0] }).setProtectedHeader({ alg: 'HS256' }).setIssuer('battlescene')
      .setAudience('staff').setExpirationTime('5m').sign(new TextEncoder().encode(env.SESSION_SECRET));
    return 'battlescene_session=' + token;
  }
  const call = (path, cookie, data) => handle(new Request(origin + '/api/' + path, {
    headers: { origin, ...(cookie ? { cookie } : {}) },
    ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }),
  }));
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4lYAAAAASUVORK5CYII=';
  try {
    const [admin, builder, other] = await Promise.all(['admin@example.com', 'builder@example.com', 'other@example.com'].map(session));
    let meetup = await (await call('meetups', admin, { name: 'Open night', timezone: 'UTC', date: '2026-11-21' })).json();
    const path = 'meetups/' + meetup.id;
    const staff = async data => {
      const response = await call(path, admin, { revision: meetup.revision, ...data });
      assert.equal(response.status, 200, JSON.stringify(data));
      meetup = await response.json();
      return meetup;
    };
    await staff({ type: 'addDivision', name: 'Antweight', arena: 'Arena Alpha' });
    await staff({ type: 'addRobots', division: meetup.divisions[0].id, robots: [{ team: 'Staff Team', name: 'Walk-in', photo: '/demo-robots/2.svg' }] });
    await staff({ type: 'registration', open: true });
    const division = meetup.divisions[0].id;
    let token = meetup.registration.token;
    const register = path => 'register/' + meetup.id + (path ?? '?token=' + token);

    assert.equal((await call(register('?token=wrong'))).status, 404);
    const landing = await (await call(register())).json();
    assert.deepEqual(landing.registration, { open: true, tokenValid: true, limit: 5 });
    assert.equal(landing.user, null);
    assert.deepEqual(landing.meetup.divisions, [{ id: division, name: 'Antweight', open: true }]);
    assert.equal(landing.meetup.owner, undefined);
    assert.equal((await call(path, builder)).status, 403, 'a team account has no staff access');
    assert.equal((await call(path, admin, { type: 'teamRegister', revision: meetup.revision, division })).status, 400);

    const team = (data, cookie = builder) => call(register(''), cookie, { token, ...data });
    assert.equal((await team({ type: 'register', division, team: 'Hammer Bros', name: 'Crusher' })).status, 400, 'phone first');
    assert.equal((await team({ type: 'profile', phone: '050-123-4567', team: 'Hammer Bros' })).status, 200);
    const photo = { meetup: meetup.id, token, extension: 'png', bytes: png };
    assert.equal((await call('garage', null, photo)).status, 401);
    assert.equal((await call('garage', builder, { extension: 'png', bytes: png })).status, 404, 'an upload needs the registration link');
    assert.equal((await call('garage', builder, { ...photo, token: 'wrong' })).status, 404);
    const upload = await call('garage', builder, photo);
    assert.equal(upload.status, 201);
    const garageUrl = (await upload.json()).url;
    assert.match(garageUrl, /^\/api\/garage\/[a-f0-9-]{18}\.png$/);
    assert.equal((await call(garageUrl.slice(5), builder)).headers.get('content-type'), 'image/png');
    assert.equal((await call(garageUrl.slice(5), other)).status, 404);

    let state = await (await team({ type: 'register', division, team: 'Hammer Bros', name: 'Crusher', weapon: 'Drum', photo: garageUrl })).json();
    assert.equal(state.entries.length, 1);
    const [entry] = state.entries;
    assert.equal(entry.photo, '/api/assets/' + meetup.id + '/' + garageUrl.split('/').at(-1));
    assert.deepEqual(state.garage.map(({ name, photo, entered }) => ({ name, photo, entered })),
      [{ name: 'Crusher', photo: garageUrl, entered: true }]);
    assert.deepEqual(state.profile, { phone: '050-123-4567', team: 'Hammer Bros' });

    assert.equal((await call(entry.photo.slice(5))).status, 404, 'photos stay private while the meetup is a draft');
    const ownView = await call(entry.photo.slice(5), builder);
    assert.equal(ownView.status, 200, 'the owner sees their own photo');
    assert.equal(ownView.headers.get('cache-control'), 'no-store');
    assert.equal(ownView.headers.get('vercel-cdn-cache-control'), null, 'a private photo is never cached at the edge');
    assert.equal((await call(entry.photo.slice(5), other)).status, 404);

    // A team can't attach an image it doesn't own by naming a file that already sits in the meetup.
    const staffImage = (await (await call(path + '/image', admin, { extension: 'png', bytes: png })).json()).url;
    const staffFile = staffImage.split('/').at(-1);
    const borrowed = await team({ type: 'register', division, team: 'Hammer Bros', name: 'Borrower', photo: '/api/garage/' + staffFile });
    assert.equal(borrowed.status, 400);
    assert.match((await borrowed.json()).error, /photo again/);
    assert.equal((await call(staffImage.slice(5), builder)).status, 404, 'the staff image stays out of reach');
    assert.equal((await call('garage/' + staffFile, builder)).status, 404, 'and is not copied into the garage');
    assert.equal((await call(staffImage.slice(5), admin)).status, 200);
    meetup = await (await call(path, admin)).json();
    await staff({ type: 'publish', published: true });
    const publicView = await call(entry.photo.slice(5));
    assert.equal(publicView.status, 200, 'published robot photos are public');
    assert.equal(publicView.headers.get('cache-control'), 'public, max-age=86400');
    assert.equal(publicView.headers.get('vercel-cdn-cache-control'), 'public, s-maxage=300');
    assert.equal(publicView.headers.get('vercel-cache-tag'), 'battlescene-' + meetup.id + '-images');
    // Only the URL Vercel's rewrite produces is served, so a re-spelled URL can't be a fresh cache key.
    const route = entry.photo.slice(5);
    const rewritten = encodeURIComponent(route);
    assert.equal((await call(route + '?path=' + rewritten + '&route=' + rewritten)).status, 200);
    for (const variant of [route + '?v=1', route + '?v=1&path=' + rewritten + '&route=' + rewritten,
      route + '?path=' + route + '&route=' + route, route + '?path=' + rewritten.replace('a', '%61') + '&route=' + rewritten,
      'dispatch?path=' + rewritten]) {
      assert.equal((await call(variant)).status, 404, variant);
    }
    const watch = await (await call('watch/' + meetup.id)).json();
    assert.deepEqual(watch.divisions[0].robots.map(({ name, weapon, photo, owner, contact }) => ({ name, weapon, photo, owner, contact })), [
      { name: 'Walk-in', weapon: undefined, photo: '/demo-robots/2.svg', owner: undefined, contact: undefined },
      { name: 'Crusher', weapon: 'Drum', photo: entry.photo, owner: undefined, contact: undefined },
    ]);

    // Two teams registering at the same moment both get in: the server retries the losing write.
    assert.equal((await team({ type: 'profile', phone: '052 765 4321' }, other)).status, 200);
    const [first, second] = await Promise.all([
      team({ type: 'register', division, team: 'Hammer Bros', name: 'Crusher Jr' }),
      team({ type: 'register', division, team: 'Other Crew', name: 'Spinner' }, other),
    ]);
    assert.deepEqual([first.status, second.status], [200, 200]);
    assert.equal((await call(path, admin).then(response => response.json())).divisions[0].robots.length, 4);

    state = await (await team({ type: 'edit', robot: entry.id, team: 'Hammer Bros', name: 'Crusher Prime', weapon: 'Drum', photo: entry.photo })).json();
    assert.ok(state.entries.some(item => item.name === 'Crusher Prime' && item.photo === entry.photo));
    assert.ok(state.garage.some(item => item.name === 'Crusher Prime' && item.photo === garageUrl), 'edits update the garage');
    assert.equal((await team({ type: 'edit', robot: entry.id, team: 'X', name: 'Y' }, other)).status, 404);

    // A new link locks strangers out but not the robots' owners. A staff-assigned owner gets the robot in their garage.
    meetup = await (await call(path, admin)).json();
    const walkIn = meetup.divisions[0].robots.find(robot => robot.name === 'Walk-in');
    await staff({ type: 'renameRobot', division, robot: walkIn.id, team: 'Staff Team', name: 'Walk-in', owner: 'late@example.com' });
    const oldToken = token;
    await staff({ type: 'registration', regenerate: true });
    token = meetup.registration.token;
    assert.notEqual(token, oldToken);
    const late = await session('late@example.com');
    assert.equal((await call(register('?token=' + oldToken))).status, 404);
    assert.equal((await call(register('?token=' + oldToken), await session('nobody@example.com'))).status, 404);
    const kept = await (await call(register('?token=' + oldToken), builder)).json();
    assert.equal(kept.registration.tokenValid, false);
    assert.equal(kept.entries.length, 2);
    assert.equal((await call(register(''), builder, { token: oldToken, type: 'register', division, team: 'Hammer Bros', name: 'Third' })).status, 403);
    const adopted = await (await call(register(), late)).json();
    assert.deepEqual(adopted.garage.map(({ name, photo }) => ({ name, photo })), [{ name: 'Walk-in', photo: '/demo-robots/2.svg' }]);

    state = await (await team({ type: 'cancel', robot: state.entries.find(item => item.name === 'Crusher Jr').id })).json();
    assert.equal(state.entries.length, 1);
    assert.equal(state.garage.length, 2, 'cancelling keeps the saved robot');

    // Deleting the meetup removes its copies, but the garage and its photos stay with the account.
    meetup = await (await call(path, admin)).json();
    assert.equal((await call(path + '/delete', admin, { revision: meetup.revision, name: 'Open night' })).status, 200);
    assert.equal((await call(entry.photo.slice(5))).status, 404);
    assert.equal((await call(garageUrl.slice(5), builder)).status, 200);
    const next = await (await call('meetups', admin, { name: 'Next night', timezone: 'UTC', date: '2026-12-21' })).json();
    const nextToken = (await (await call('meetups/' + next.id, admin, { type: 'registration', revision: 0, open: true })).json()).registration.token;
    const fresh = await (await call('register/' + next.id + '?token=' + nextToken, builder)).json();
    assert.deepEqual(fresh.garage.map(item => item.name).sort(), ['Crusher Jr', 'Crusher Prime']);
    assert.equal(fresh.entries.length, 0);
    const forgotten = await (await call('register/' + next.id, builder, { token: nextToken, type: 'forget',
      saved: fresh.garage.find(item => item.name === 'Crusher Prime').id })).json();
    assert.deepEqual(forgotten.garage.map(item => item.name), ['Crusher Jr']);
    assert.equal((await call(garageUrl.slice(5), builder)).status, 404, 'forgetting a robot removes its photo');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('team accounts are rationed: uploads and changes per day, POSTs per hour', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'battlescene-'));
  const origin = 'http://localhost:5173';
  const env = {
    APP_ORIGIN: origin, GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-client-secret',
    SESSION_SECRET: 'local-test-signing-key-at-least-32-characters', BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
  };
  const handle = createHandler({ local: true, env, directory });
  async function session(email) {
    const token = await new SignJWT({ email, name: email.split('@')[0] }).setProtectedHeader({ alg: 'HS256' }).setIssuer('battlescene')
      .setAudience('staff').setExpirationTime('5m').sign(new TextEncoder().encode(env.SESSION_SECRET));
    return 'battlescene_session=' + token;
  }
  const call = (path, cookie, data) => handle(new Request(origin + '/api/' + path, {
    headers: { origin, ...(cookie ? { cookie } : {}) },
    ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }),
  }));
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4lYAAAAASUVORK5CYII=';
  const stored = async email => (await readdir(join(directory, 'photos', userKey(email)))).length;
  try {
    const admin = await session('admin@example.com');
    let meetup = await (await call('meetups', admin, { name: 'Open night', timezone: 'UTC', date: '2026-11-21' })).json();
    meetup = await (await call('meetups/' + meetup.id, admin, { type: 'registration', revision: 0, open: true })).json();
    const token = meetup.registration.token;
    const photo = { meetup: meetup.id, token, extension: 'png', bytes: png };

    // 30 uploads a day. Uploads that no saved robot uses are kept to the latest 20.
    const uploader = await session('uploader@example.com');
    const statuses = [];
    for (let index = 0; index < 31; index++) statuses.push((await call('garage', uploader, photo)).status);
    assert.deepEqual(statuses, [...Array(30).fill(201), 429]);
    assert.equal(await stored('uploader@example.com'), 20);

    // Uploads sent at the same moment can't slip past the daily count.
    const racer = await session('racer@example.com');
    const raced = (await Promise.all(Array.from({ length: 40 }, () => call('garage', racer, photo)))).map(response => response.status);
    assert.deepEqual([raced.filter(status => status === 201).length, raced.filter(status => status === 429).length], [30, 10]);
    assert.equal(await stored('racer@example.com'), 20);

    // Once registration closes, an account with no robots here can't upload any more.
    const late = await session('late@example.com');
    assert.equal((await call('meetups/' + meetup.id, admin, { type: 'registration', revision: 1, open: false })).status, 200);
    assert.equal((await call('garage', late, photo)).status, 409);
    assert.equal((await call('meetups/' + meetup.id, admin, { type: 'registration', revision: 2, open: true })).status, 200);

    // 60 POSTs an hour, whether or not they get as far as being counted for the day.
    const looper = await session('looper@example.com');
    const forget = () => call('register/' + meetup.id, looper, { token, type: 'forget', saved: 'nothing' });
    for (let index = 0; index < 60; index++) assert.equal((await forget()).status, 404);
    const limited = await forget();
    assert.equal(limited.status, 429);
    assert.match((await limited.json()).error, /short time/);

    // 100 changes a day, counted in the account's file. Yesterday's count doesn't carry over.
    const profile = { token, type: 'profile', phone: '050-123-4567', team: 'Busy' };
    const seed = (email, day) => mkdir(join(directory, 'users'), { recursive: true }).then(() => writeFile(
      join(directory, 'users', userKey(email) + '.json'),
      JSON.stringify({ email, name: 'busy', phone: '', team: '', robots: [], usage: { day, actions: 100, uploads: 0 } })));
    await seed('busy@example.com', new Date().toISOString().slice(0, 10));
    const refused = await call('register/' + meetup.id, await session('busy@example.com'), profile);
    assert.equal(refused.status, 429);
    assert.match((await refused.json()).error, /a lot of changes today/);
    await seed('rested@example.com', '2026-01-01');
    assert.equal((await call('register/' + meetup.id, await session('rested@example.com'), profile)).status, 200);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a saved change makes the image cache stale only when an image stops being public', () => {
  const photo = name => '/api/assets/abc/' + name;
  const meetup = { id: 'abc', published: true, theme: { logo: photo('logo.png') },
    divisions: [{ robots: [{ photo: photo('one.png') }, { photo: '/demo-robots/1.svg' }, {}] }] };
  const withRobots = robots => ({ ...meetup, divisions: [{ robots }] });
  const feed = ['battlescene-abc'];
  const both = ['battlescene-abc', 'battlescene-abc-images'];
  assert.deepEqual(staleTags('abc', meetup, meetup), feed);
  assert.deepEqual(staleTags('abc', meetup, withRobots([{ photo: photo('one.png') }, { photo: photo('two.png') }])), feed, 'a new photo');
  assert.deepEqual(staleTags('abc', { ...meetup, published: false }, meetup), feed, 'publishing');
  assert.deepEqual(staleTags('abc', meetup, withRobots([{ photo: photo('two.png') }])), both, 'a replaced photo');
  assert.deepEqual(staleTags('abc', meetup, { ...meetup, theme: { logo: '' } }), both, 'a removed logo');
  assert.deepEqual(staleTags('abc', meetup, { ...meetup, published: false }), both, 'unpublishing');
  assert.deepEqual(staleTags('abc', meetup, null), both, 'deleting');
});

// A handler over a store that counts what reaches storage. `exact` reads are the ones Vercel counts; `cached` reads
// go through Blob's cache and are free while the file is unchanged.
const testEnv = {
  APP_ORIGIN: 'http://localhost:5173', GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-client-secret',
  SESSION_SECRET: 'local-test-signing-key-at-least-32-characters', BOOTSTRAP_ADMIN_EMAIL: 'admin@example.com',
};
function service(directory, env = testEnv) {
  const files = createStore({ local: true, directory });
  const counts = { exact: 0, cached: 0, write: 0, list: 0 };
  const backend = {
    read: (path, binary, cached) => { counts[cached ? 'cached' : 'exact']++; return files.read(path, binary, cached); },
    write: (...parts) => { counts.write++; return files.write(...parts); },
    remove: path => files.remove(path),
    paths: prefix => { counts.list++; return files.paths(prefix); },
  };
  const handle = createHandler({ local: true, env, directory, backend });
  const origin = testEnv.APP_ORIGIN;
  return {
    counts,
    reset() { Object.assign(counts, { exact: 0, cached: 0, write: 0, list: 0 }); },
    call: (path, cookie, data) => handle(new Request(origin + '/api/' + path, {
      headers: { origin, ...(cookie ? { cookie } : {}) },
      ...(data === undefined ? {} : { method: 'POST', body: JSON.stringify(data) }),
    })),
    session: async email => 'battlescene_session=' + await new SignJWT({ email, name: email.split('@')[0] })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer('battlescene').setAudience('staff').setExpirationTime('5m')
      .sign(new TextEncoder().encode(testEnv.SESSION_SECRET)),
  };
}
const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4lYAAAAASUVORK5CYII=';
const statuses = async (count, request) => {
  const seen = new Set();
  for (let index = 0; index < count; index++) seen.add((await request(index)).status);
  return [...seen].sort();
};

test('requests without a staff role cannot make the server read storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'battlescene-'));
  try {
    const app = service(directory);
    const { call } = app;
    const [admin, builder, stranger, prober] = await Promise.all(
      ['admin@example.com', 'builder@example.com', 'stranger@example.com', 'prober@example.com'].map(app.session));
    let meetup = await (await call('meetups', admin, { name: 'Open night', timezone: 'UTC', date: '2026-11-21' })).json();
    const path = 'meetups/' + meetup.id;
    const staff = async data => { meetup = await (await call(path, admin, { revision: meetup.revision, ...data })).json(); };
    await staff({ type: 'addDivision', name: 'Antweight', arena: 'Arena Alpha' });
    await staff({ type: 'registration', open: true });
    await staff({ type: 'publish', published: true });
    const token = meetup.registration.token;
    const register = 'register/' + meetup.id;
    assert.equal((await call(register, builder, { token, type: 'profile', phone: '050-123-4567', team: 'Hammer Bros' })).status, 200);
    const photo = (await (await call('garage', builder, { meetup: meetup.id, token, extension: 'png', bytes: tinyPng })).json()).url;
    const entry = (await (await call(register, builder, { token, type: 'register', division: meetup.divisions[0].id,
      team: 'Hammer Bros', name: 'Crusher', photo })).json()).entries[0];
    assert.equal((await call(entry.photo.slice(5))).status, 200);
    assert.equal((await call('watch/' + meetup.id)).status, 200);

    // A thousand requests of the kinds anyone can send: made-up meetup ids, made-up image names, wrong links, a
    // re-spelled feed URL. Signed out, and signed in with Google accounts that have no access.
    app.reset();
    const image = index => String(index).padStart(8, '0') + '-aaaa-bbbb.png';
    assert.deepEqual(await statuses(150, index => call('watch/nope-' + index)), [404]);
    assert.deepEqual(await statuses(150, index => call('assets/' + meetup.id + '/' + image(index))), [404]);
    assert.deepEqual(await statuses(100, index => call('assets/nope-' + index + '/' + image(index))), [404]);
    assert.deepEqual(await statuses(150, index => call(register + '?token=wrong' + index)), [404]);
    assert.deepEqual(await statuses(100, index => call('register/nope-' + index + '?token=x', stranger)), [404]);
    assert.deepEqual(await statuses(100, index => call(register + '?token=wrong' + index, stranger)), [404]);
    assert.deepEqual(await statuses(100, () => call('session', stranger)), [200]);
    assert.deepEqual(await statuses(50, () => call('meetups', stranger)), [403]);
    assert.deepEqual(await statuses(30, () => call(register, stranger, { token: 'wrong', type: 'profile', phone: '050-123-4567' })), [404]);
    assert.deepEqual(await statuses(20, () => call('garage', stranger, { meetup: meetup.id, token: 'wrong', extension: 'png', bytes: tinyPng })), [404]);
    const busted = await call('watch/' + meetup.id + '?bust=1');
    assert.deepEqual([busted.status, busted.headers.get('cache-control'), busted.headers.get('vercel-cdn-cache-control')], [200, 'no-store', null]);
    assert.deepEqual(await statuses(49, index => call('watch/' + meetup.id + '?bust=' + index)), [200]);
    assert.deepEqual(app.counts, { exact: 0, cached: 0, write: 0, list: 0 });

    // A signed-in account asking for photos it doesn't have reads storage 20 times an hour, then is refused unread.
    assert.deepEqual(await statuses(60, index => call('garage/' + image(index), prober)), [404]);
    assert.deepEqual(app.counts, { exact: 0, cached: 20, write: 0, list: 0 });

    // What the app itself needs still reads. A meetup in use: the display feed is read exactly every time.
    app.reset();
    const feed = await call('watch/' + meetup.id);
    assert.deepEqual((await feed.json()).divisions[0].robots.map(robot => robot.name), ['Crusher']);
    assert.equal(feed.headers.get('vercel-cdn-cache-control'), 'public, s-maxage=20');
    assert.equal(app.counts.exact, 1);
    // Staff polling is answered from the copy this server already holds; "fresh" forces an exact read.
    app.reset();
    for (let index = 0; index < 10; index++) assert.equal((await call(path, admin)).status, 200);
    assert.equal((await call('meetups', admin)).status, 200);
    assert.deepEqual([app.counts.exact, app.counts.write], [0, 0]);
    assert.equal((await call(path + '?fresh=1', admin)).status, 200);
    assert.equal(app.counts.exact, 1);
    // The team's own page, reopened: nothing to read either.
    app.reset();
    assert.equal((await (await call(register + '?token=' + token, builder)).json()).entries.length, 1);
    assert.deepEqual(app.counts, { exact: 0, cached: 0, write: 0, list: 0 });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a display left on a meetup nobody is changing costs no storage reads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'battlescene-'));
  try {
    let app = service(directory);
    const admin = await app.session('admin@example.com');
    let meetup = await (await app.call('meetups', admin, { name: 'Last week', timezone: 'UTC', date: '2026-11-14' })).json();
    meetup = await (await app.call('meetups/' + meetup.id, admin, { type: 'publish', revision: 0, published: true })).json();
    // Age the saved meetup by three hours, then start a new server: nothing is remembered yet.
    const file = join(directory, 'meetups', meetup.id + '.json');
    await writeFile(file, JSON.stringify({ ...JSON.parse(await readFile(file, 'utf8')), updatedAt: Date.now() - 3 * 3_600_000 }));
    app = service(directory);
    for (let index = 0; index < 200; index++) assert.equal((await app.call('watch/' + meetup.id)).status, 200);
    assert.deepEqual(app.counts, { exact: 0, cached: 2, write: 0, list: 0 }, 'one free read each of the meetup and of roles.json');

    // The first save puts it back in use: the same server reads the feed exactly again, and sees the change at once.
    const saved = await app.call('meetups/' + meetup.id, admin, { type: 'meetupQr', revision: meetup.revision, qr: null });
    assert.equal(saved.status, 200);
    app.reset();
    assert.equal((await (await app.call('watch/' + meetup.id)).json()).revision, meetup.revision + 1);
    assert.equal(app.counts.exact, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('roles.json lists every meetup: built for an old deployment, repaired by listing, pruned when a meetup is gone', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'battlescene-'));
  const roles = async change => {
    const file = join(directory, 'roles.json');
    const value = JSON.parse(await readFile(file, 'utf8'));
    if (change) await writeFile(file, JSON.stringify(change(value)));
    return value;
  };
  try {
    let app = service(directory);
    const admin = await app.session('admin@example.com');
    assert.equal((await app.call('roles', admin, { email: 'manager@example.com', authorize: true })).status, 200);
    const meetup = await (await app.call('meetups', admin, { name: 'Old night', timezone: 'UTC', date: '2026-11-21' })).json();
    assert.equal((await app.call('meetups/' + meetup.id, admin, { type: 'publish', revision: 0, published: true })).status, 200);
    assert.deepEqual((await roles()).meetups, [meetup.id]);
    assert.deepEqual((await roles()).managers, ['manager@example.com'], 'listing a meetup keeps the managers');
    assert.equal((await app.call('roles', admin, { email: 'second@example.com', authorize: true })).status, 200);
    assert.deepEqual((await roles()).meetups, [meetup.id], 'and changing the managers keeps the list');

    // A deployment from before the list existed: the first request builds it from one storage listing.
    await roles(({ meetups, ...rest }) => rest);
    app = service(directory);
    assert.equal((await app.call('watch/' + meetup.id)).status, 200);
    assert.equal(app.counts.list, 1);
    assert.deepEqual((await roles()).meetups, [meetup.id]);

    // An id that fell off the list is unreachable to the public until staff next list their meetups.
    await roles(value => ({ ...value, meetups: [] }));
    app = service(directory);
    assert.equal((await app.call('watch/' + meetup.id)).status, 404);
    assert.equal((await app.call('meetups', admin)).status, 200);
    assert.equal((await app.call('watch/' + meetup.id)).status, 200);
    assert.deepEqual((await roles()).meetups, [meetup.id]);

    // A listed id with no meetup behind it is confirmed gone by one exact read, then taken off the list.
    await roles(value => ({ ...value, meetups: [...value.meetups, 'ghost-meetup'] }));
    app = service(directory);
    assert.equal((await app.call('watch/ghost-meetup')).status, 404);
    assert.deepEqual((await roles()).meetups, [meetup.id]);
    app.reset();
    assert.deepEqual(await statuses(50, () => app.call('watch/ghost-meetup')), [404]);
    assert.deepEqual(app.counts, { exact: 0, cached: 0, write: 0, list: 0 });

    // Deleting a meetup takes it off the list in the same write as the history entry.
    assert.equal((await app.call('meetups/' + meetup.id + '/delete', admin, { revision: 1, name: 'Old night' })).status, 200);
    assert.deepEqual((await roles()).meetups, []);
    assert.equal((await roles()).history.at(-1).type, 'deleteMeetup');
    assert.equal((await app.call('watch/' + meetup.id)).status, 404);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('the local demo meetup is listed, and listed again after it is deleted and the server restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'battlescene-'));
  try {
    let app = service(directory, {});
    assert.equal((await app.call('watch/foundry')).status, 200);
    const demo = await (await app.call('meetups/foundry')).json();
    assert.equal((await app.call('meetups/foundry/delete', null, { revision: demo.revision, name: demo.name })).status, 200);
    assert.equal((await app.call('watch/foundry')).status, 404);
    app = service(directory, {});
    assert.equal((await app.call('watch/foundry')).status, 200);
    assert.equal((await app.call('register/foundry?token=demo')).status, 200);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('sign-in only returns to a path on this site', () => {
  for (const path of ['/register/foundry/demo', '/register/abc/x?y=1', '/']) assert.equal(returnPath(path), path);
  for (const path of ['//evil.example', 'https://evil.example', '/\\evil.example', 'register', '', null, '/a b']) {
    assert.equal(returnPath(path), '/');
  }
});
