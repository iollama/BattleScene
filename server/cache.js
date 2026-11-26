// An in-memory layer over a store (see store.js). It remembers the JSON documents this server has read or written,
// so that requests which only need a recent copy don't each cost a storage read. Storage reads are the scarce
// resource on Vercel's free plan, and without this a flood of requests, or one forgotten browser tab, uses them up.
//
// There are three ways to read a JSON document:
//   read(path)            Exact, straight from the store, with its etag. Always used before a write.
//   recent(path, window)  The remembered copy if this server read it exactly, or wrote it, within `window` ms.
//                         Otherwise an exact read. Current on the server that saved; other servers trail by at
//                         most the window.
//   relaxed(path)         The remembered copy if it was checked within RELAXED ms. Otherwise a read through Blob's
//                         cache, which is not counted while the file is unchanged but can trail an overwrite by a
//                         minute. For callers who must never be able to cost a read: anyone without a staff role.
// recent() and relaxed() return { value } with no etag, so nothing can be written back from them.
// Values are copied on the way in and on the way out, because callers change what they read.

export const RELAXED = 60_000;
// Blob's cache can serve the previous file for up to a minute after an overwrite. For this long after its own write,
// this server trusts what it wrote over what a cached read returns.
const SETTLING = 90_000;
const LIMIT = 300;

export function withCache(backend, { now = Date.now } = {}) {
  // path -> { value (null: no such file), exact: last exact read or own write, checked: last check of any kind,
  // wrote: this server's last write }. Kept in order of use, oldest first.
  const entries = new Map();

  function keep(path, value, times) {
    const entry = { exact: 0, checked: 0, wrote: 0, ...entries.get(path), ...times, value: structuredClone(value ?? null) };
    entries.delete(path);
    entries.set(path, entry);
    if (entries.size > LIMIT) entries.delete(entries.keys().next().value);
    return entry;
  }
  function find(path) {
    const entry = entries.get(path);
    if (entry) {
      entries.delete(path);
      entries.set(path, entry);
    }
    return entry;
  }
  const hand = entry => entry.value === null ? null : { value: structuredClone(entry.value) };

  async function read(path, binary = false, cached = false) {
    const record = await backend.read(path, binary, cached);
    if (!binary && !cached) keep(path, record?.value, { exact: now(), checked: now() });
    return record;
  }

  return {
    read,
    paths: prefix => backend.paths(prefix),
    async write(path, value, expected, contentType = 'application/json') {
      try {
        const result = await backend.write(path, value, expected, contentType);
        if (contentType === 'application/json') keep(path, value, { exact: now(), checked: now(), wrote: now() });
        return result;
      } catch (error) {
        // Whatever happened, the remembered copy can no longer be assumed to match the store.
        entries.delete(path);
        throw error;
      }
    },
    async remove(path) {
      await backend.remove(path);
      if (path.endsWith('/')) {
        for (const key of [...entries.keys()]) if (key.startsWith(path)) entries.delete(key);
      } else {
        keep(path, null, { exact: now(), checked: now(), wrote: now() });
      }
    },
    async recent(path, window) {
      const entry = find(path);
      if (entry && now() - entry.exact <= window) return hand(entry);
      const record = await read(path);
      return record ? { value: record.value } : null;
    },
    async relaxed(path) {
      const entry = find(path);
      if (entry && now() - entry.checked <= RELAXED) return hand(entry);
      if (entry && now() - entry.wrote <= SETTLING) {
        entry.checked = now();
        return hand(entry);
      }
      const record = await backend.read(path, false, true);
      return hand(keep(path, record?.value, { checked: now() }));
    },
  };
}
