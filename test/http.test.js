import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { SignJWT } from 'jose';
import { returnPath } from '../server/auth.js';
import { createHandler } from '../server/http.js';

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
    assert.deepEqual(landing.registration, { open: true, tokenValid: true });
    assert.equal(landing.user, null);
    assert.deepEqual(landing.meetup.divisions, [{ id: division, name: 'Antweight', open: true }]);
    assert.equal(landing.meetup.owner, undefined);
    assert.equal((await call(path, builder)).status, 403, 'a team account has no staff access');
    assert.equal((await call(path, admin, { type: 'teamRegister', revision: meetup.revision, division })).status, 400);

    const team = (data, cookie = builder) => call(register(''), cookie, { token, ...data });
    assert.equal((await team({ type: 'register', division, team: 'Hammer Bros', name: 'Crusher' })).status, 400, 'phone first');
    assert.equal((await team({ type: 'profile', phone: '050-123-4567', team: 'Hammer Bros' })).status, 200);
    assert.equal((await call('garage', null, { extension: 'png', bytes: png })).status, 401);
    const upload = await call('garage', builder, { extension: 'png', bytes: png });
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
    assert.equal((await call(entry.photo.slice(5), builder)).status, 200, 'the owner sees their own photo');
    assert.equal((await call(entry.photo.slice(5), other)).status, 404);
    meetup = await (await call(path, admin)).json();
    await staff({ type: 'publish', published: true });
    assert.equal((await call(entry.photo.slice(5))).status, 200, 'published robot photos are public');
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

test('sign-in only returns to a path on this site', () => {
  for (const path of ['/register/foundry/demo', '/register/abc/x?y=1', '/']) assert.equal(returnPath(path), path);
  for (const path of ['//evil.example', 'https://evil.example', '/\\evil.example', 'register', '', null, '/a b']) {
    assert.equal(returnPath(path), '/');
  }
});
