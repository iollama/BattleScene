import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { BlobError, BlobPreconditionFailedError } from '@vercel/blob';
import { createStore } from '../server/store.js';

// A stand-in for the Vercel Blob SDK. Like the real service, it serves large
// JSON reads compressed with a weak ETag (W/"…"), while put's ifMatch only
// accepts the strong ETag and rejects anything else with
// BlobPreconditionFailedError.
// Every call's options land in `calls`, so tests can check how the store authenticates.
function fakeBlob() {
  const blobs = new Map();
  const calls = [];
  return {
    calls,
    async get(path, options) {
      calls.push(options);
      const blob = blobs.get(path);
      if (!blob) return null;
      const compressed = blob.body.length > 1024;
      return { stream: new Response(blob.body).body, blob: { etag: compressed ? 'W/' + blob.etag : blob.etag } };
    },
    async put(path, body, options) {
      calls.push(options);
      const current = blobs.get(path);
      if (options.ifMatch && options.ifMatch !== current?.etag) throw new BlobPreconditionFailedError();
      if (current && !options.allowOverwrite) throw new BlobError('This blob already exists');
      const etag = '"' + createHash('md5').update(body).digest('hex') + '"';
      blobs.set(path, { body, etag });
      return { pathname: path, etag };
    },
    async list(options = {}) {
      calls.push(options);
      const { prefix = '' } = options;
      return { blobs: [...blobs.keys()].filter(pathname => pathname.startsWith(prefix)).map(pathname => ({ pathname })), hasMore: false };
    },
    async del(paths, options) {
      calls.push(options);
      for (const path of [].concat(paths)) blobs.delete(path);
    },
  };
}

// Sets the Blob credentials for one test and restores the previous values afterwards.
function withEnv(t, values) {
  const keys = ['BLOB_READ_WRITE_TOKEN', 'BLOB_STORE_ID'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const apply = settings => {
    for (const key of keys) {
      if (settings[key] === undefined) delete process.env[key];
      else process.env[key] = settings[key];
    }
  };
  apply(values);
  t.after(() => apply(saved));
}

const testToken = 'vercel_blob_rw_teststore_secret';

async function exercise(store) {
  await store.write('meetups/one.json', { revision: 0 });
  const record = await store.read('meetups/one.json');
  await store.write('meetups/one.json', { revision: 1 }, record.etag);
  assert.deepEqual(await store.paths('meetups/'), ['meetups/one.json']);
  await store.remove('meetups/one.json');
  assert.deepEqual(await store.paths(''), []);
}

test('Blob store keeps saving a meetup once it is large enough to be read back compressed', async t => {
  withEnv(t, { BLOB_READ_WRITE_TOKEN: testToken });
  const store = createStore({ local: false, blob: fakeBlob() });
  const path = 'meetups/large.json';
  await store.write(path, { revision: 0, robots: 'robot '.repeat(500) });

  const first = await store.read(path);
  await store.write(path, { ...first.value, revision: 1 }, first.etag);
  const second = await store.read(path);
  assert.equal(second.value.revision, 1);
  await store.write(path, { ...second.value, revision: 2 }, second.etag);
  assert.equal((await store.read(path)).value.revision, 2);

  await assert.rejects(store.write(path, { revision: 3 }, first.etag), { status: 409 });
  await assert.rejects(store.write(path, { revision: 3 }), { status: 409 });
});

test('Blob store removes one object or everything under a prefix', async t => {
  withEnv(t, { BLOB_READ_WRITE_TOKEN: testToken });
  const store = createStore({ local: false, blob: fakeBlob() });
  for (const path of ['meetups/one.json', 'meetups/one-more.json', 'assets/one/a.png', 'assets/one/b.png', 'assets/onex/c.png']) {
    await store.write(path, { path });
  }
  await store.remove('assets/one/');
  await store.remove('meetups/one.json');
  assert.deepEqual((await store.paths('')).sort(), ['assets/onex/c.png', 'meetups/one-more.json']);
});

test('Blob store passes the read-write token on every call when one is set, even with OIDC available', async t => {
  withEnv(t, { BLOB_READ_WRITE_TOKEN: testToken, BLOB_STORE_ID: 'store_test' });
  const blob = fakeBlob();
  await exercise(createStore({ local: false, blob }));
  assert.ok(blob.calls.length >= 6);
  assert.ok(blob.calls.every(options => options.token === testToken));
});

test('Blob store leaves the token out for an OIDC-linked store', async t => {
  withEnv(t, { BLOB_READ_WRITE_TOKEN: undefined, BLOB_STORE_ID: 'store_test' });
  const blob = fakeBlob();
  await exercise(createStore({ local: false, blob }));
  assert.ok(blob.calls.length >= 6);
  assert.ok(blob.calls.every(options => !Object.hasOwn(options, 'token')));
});

test('Blob store refuses to start without a token or a store id', t => {
  withEnv(t, { BLOB_READ_WRITE_TOKEN: undefined, BLOB_STORE_ID: undefined });
  assert.throws(() => createStore({ local: false, blob: fakeBlob() }), { status: 503, message: /BLOB_STORE_ID/ });
});
