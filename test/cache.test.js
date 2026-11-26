import assert from 'node:assert/strict';
import test from 'node:test';
import { withCache } from '../server/cache.js';

// A stand-in store that counts what reaches it. Like Vercel Blob, a read through its cache (`cached`) can return the
// previous version of a file: here it lags until settle() is called.
function fakeStore(files = {}) {
  const live = new Map(Object.entries(files));
  let behind = new Map(live);
  const counts = { exact: 0, cached: 0, write: 0 };
  return {
    counts, live, failing: false,
    reset() { Object.assign(counts, { exact: 0, cached: 0, write: 0 }); },
    settle() { behind = new Map(live); },
    async read(path, binary = false, cached = false) {
      counts[cached ? 'cached' : 'exact']++;
      const source = cached ? behind : live;
      return source.has(path) ? { value: structuredClone(source.get(path)), etag: 'etag-' + JSON.stringify(source.get(path)) } : null;
    },
    async write(path, value) {
      counts.write++;
      if (this.failing) throw Object.assign(new Error('A newer change was saved.'), { status: 409 });
      live.set(path, structuredClone(value));
    },
    async remove(path) {
      for (const key of [...live.keys()]) if (path.endsWith('/') ? key.startsWith(path) : key === path) live.delete(key);
    },
    async paths(prefix) { return [...live.keys()].filter(key => key.startsWith(prefix)); },
  };
}

function clocked(files) {
  const store = fakeStore(files);
  const clock = { time: 1_000_000 };
  return { store, clock, cache: withCache(store, { now: () => clock.time }) };
}

test('an exact read reaches the store and carries its etag; a recent read reuses it inside the window', async () => {
  const { store, clock, cache } = clocked({ 'meetups/a.json': { revision: 1 } });
  const exact = await cache.read('meetups/a.json');
  assert.deepEqual(exact, { value: { revision: 1 }, etag: 'etag-{"revision":1}' });
  assert.deepEqual(await cache.recent('meetups/a.json', 30_000), { value: { revision: 1 } }, 'no etag: nothing can be written back from it');
  clock.time += 30_000;
  await cache.recent('meetups/a.json', 30_000);
  assert.equal(store.counts.exact, 1);

  // Past the window it reads exactly again, and so sees a change another server made.
  store.live.set('meetups/a.json', { revision: 2 });
  clock.time += 1;
  assert.deepEqual(await cache.recent('meetups/a.json', 30_000), { value: { revision: 2 } });
  assert.equal(store.counts.exact, 2);
  assert.equal(await cache.recent('meetups/none.json', 30_000), null);
  assert.equal(await cache.recent('meetups/none.json', 30_000), null, 'a missing file is remembered too');
  assert.deepEqual(store.counts, { exact: 3, cached: 0, write: 0 });
});

test('a relaxed read never reads exactly, and checks again only after a minute', async () => {
  const { store, clock, cache } = clocked({ 'roles.json': { managers: ['a@example.com'] } });
  for (let index = 0; index < 50; index++) assert.deepEqual(await cache.relaxed('roles.json'), { value: { managers: ['a@example.com'] } });
  assert.deepEqual(store.counts, { exact: 0, cached: 1, write: 0 });
  clock.time += 60_001;
  await cache.relaxed('roles.json');
  assert.deepEqual(store.counts, { exact: 0, cached: 2, write: 0 });

  // A change made by another server shows once Blob's cache has caught up and the minute has passed.
  store.live.set('roles.json', { managers: [] });
  store.settle();
  assert.deepEqual((await cache.relaxed('roles.json')).value.managers, ['a@example.com']);
  clock.time += 60_001;
  assert.deepEqual((await cache.relaxed('roles.json')).value.managers, []);
  assert.equal(store.counts.exact, 0);
});

test('a server sees its own saves at once, and trusts them while Blob\'s cache is still catching up', async () => {
  const { store, clock, cache } = clocked({ 'meetups/a.json': { revision: 1 } });
  await cache.relaxed('meetups/a.json');
  await cache.write('meetups/a.json', { revision: 2 }, 'etag');
  store.reset();
  assert.deepEqual(await cache.relaxed('meetups/a.json'), { value: { revision: 2 } });
  assert.deepEqual(await cache.recent('meetups/a.json', 30_000), { value: { revision: 2 } });
  // A minute on, a cached read would still return revision 1 (the fake store has not settled). It is not asked.
  clock.time += 61_000;
  assert.deepEqual(await cache.relaxed('meetups/a.json'), { value: { revision: 2 } });
  assert.deepEqual(store.counts, { exact: 0, cached: 0, write: 0 });
  // Once the cache has had time to settle, it is consulted again.
  store.settle();
  clock.time += 61_000;
  assert.deepEqual(await cache.relaxed('meetups/a.json'), { value: { revision: 2 } });
  assert.deepEqual(store.counts, { exact: 0, cached: 1, write: 0 });
});

test('values are copied on the way in and on the way out', async () => {
  const { cache } = clocked({ 'users/u.json': { robots: [{ name: 'Crusher' }] } });
  const first = await cache.recent('users/u.json', 600_000);
  first.value.robots.push({ name: 'Intruder' });
  first.value.robots[0].name = 'Changed';
  assert.deepEqual((await cache.recent('users/u.json', 600_000)).value, { robots: [{ name: 'Crusher' }] });

  const saved = { robots: [{ name: 'Anvil' }] };
  await cache.write('users/u.json', saved, 'etag');
  saved.robots[0].name = 'Changed after saving';
  assert.deepEqual((await cache.relaxed('users/u.json')).value, { robots: [{ name: 'Anvil' }] });
  const exact = await cache.read('users/u.json');
  exact.value.robots.length = 0;
  assert.deepEqual((await cache.recent('users/u.json', 600_000)).value, { robots: [{ name: 'Anvil' }] });
});

test('a failed write forgets the copy, and a delete is remembered', async () => {
  const { store, cache } = clocked({ 'meetups/a.json': { revision: 1 }, 'assets/a/one.png': 1, 'meetups/b.json': { revision: 5 } });
  await cache.read('meetups/a.json');
  store.failing = true;
  await assert.rejects(cache.write('meetups/a.json', { revision: 2 }, 'old'), { status: 409 });
  store.failing = false;
  store.live.set('meetups/a.json', { revision: 3 });
  store.reset();
  assert.deepEqual(await cache.recent('meetups/a.json', 30_000), { value: { revision: 3 } }, 'read again, not assumed');
  assert.equal(store.counts.exact, 1);

  await cache.remove('meetups/a.json');
  store.reset();
  assert.equal(await cache.recent('meetups/a.json', 30_000), null);
  assert.equal(await cache.relaxed('meetups/a.json'), null);
  assert.deepEqual(store.counts, { exact: 0, cached: 0, write: 0 });

  await cache.read('meetups/b.json');
  await cache.remove('meetups/');
  assert.equal(await cache.recent('meetups/b.json', 30_000), null);
  assert.deepEqual(await cache.paths('assets/'), ['assets/a/one.png']);
});

test('images and cached reads pass straight through, and only 300 documents are remembered', async () => {
  const { store, cache } = clocked({ 'assets/a/one.png': 'bytes' });
  await cache.read('assets/a/one.png', true);
  await cache.read('assets/a/one.png', true, true);
  await cache.read('assets/a/one.png', true);
  assert.deepEqual(store.counts, { exact: 2, cached: 1, write: 0 });

  for (let index = 0; index < 301; index++) await cache.write('users/' + index + '.json', { index }, undefined);
  store.reset();
  await cache.recent('users/300.json', 30_000);
  assert.equal(store.counts.exact, 0);
  await cache.recent('users/0.json', 30_000);
  assert.equal(store.counts.exact, 1, 'the oldest was dropped');
});
