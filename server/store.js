import * as vercelBlob from '@vercel/blob';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { requireValue } from './bracket.js';

export function createStore({ local, directory, blob = vercelBlob }) {
  if (!local) {
    const { del, get, list, put } = blob;
    const token = process.env.BLOB_READ_WRITE_TOKEN;
    requireValue(token || process.env.BLOB_STORE_ID, 'Link a private Vercel Blob store to this project: set '
      + 'BLOB_READ_WRITE_TOKEN, or link the store through OIDC so BLOB_STORE_ID is set.', 503);
    // The SDK prefers an explicit token over OIDC, so pass it whenever one is set. Without one, leave it out
    // and the SDK authenticates with the project's OIDC identity and BLOB_STORE_ID.
    const auth = token ? { token } : {};
    return {
      // `cached` reads through Blob's CDN cache: repeat reads are not counted as operations, but an overwrite can
      // take up to a minute to show. Use it only for files that are never overwritten (images) or for readers
      // that can live with that delay; anything that will be written back must be read exactly.
      async read(path, binary = false, cached = false) {
        const item = await get(path, { ...auth, access: 'private', useCache: cached });
        if (!item) return null;
        const response = new Response(item.stream);
        return {
          value: binary ? new Uint8Array(await response.arrayBuffer()) : await response.json(),
          // Large JSON is served compressed with a weak ETag (W/"…"), but put's ifMatch only
          // accepts the strong form. The tag inside is the same, so drop the weak marker.
          etag: item.blob.etag.replace(/^W\//, ''),
        };
      },
      async write(path, value, expected, contentType = 'application/json') {
        try {
          return await put(path, contentType === 'application/json' ? JSON.stringify(value) : value, {
            ...auth, access: 'private', contentType, addRandomSuffix: false,
            allowOverwrite: Boolean(expected), ...(expected ? { ifMatch: expected } : {}),
          });
        } catch (error) {
          if (error instanceof vercelBlob.BlobPreconditionFailedError || /already exists/i.test(error.message)) {
            requireValue(false, 'A newer change was saved. Review the latest state and try again.', 409);
          }
          throw error;
        }
      },
      async paths(prefix) {
        let cursor;
        const paths = [];
        do {
          const page = await list({ ...auth, prefix, cursor, limit: 100 });
          paths.push(...page.blobs.map(blob => blob.pathname));
          cursor = page.hasMore ? page.cursor : undefined;
        } while (cursor);
        return paths;
      },
      // Deletes one object, or everything under a prefix ending in "/". One object needs no listing, and a
      // listing is a counted operation while a delete is free.
      async remove(path) {
        if (!path.endsWith('/')) {
          await del([path], auth);
          return;
        }
        const targets = [];
        let cursor;
        do {
          const page = await list({ ...auth, prefix: path, cursor, limit: 1000 });
          targets.push(...page.blobs.map(item => item.pathname).filter(name => name.startsWith(path)));
          cursor = page.hasMore ? page.cursor : undefined;
        } while (cursor);
        if (targets.length) await del(targets, auth);
      },
    };
  }

  const root = resolve(directory || '.battlescene/data');
  // Reads, writes and deletes take turns. A write must see the file as the previous write left it, and on Windows
  // renaming a file into place fails while another request still has the old one open for reading.
  let pending = Promise.resolve();
  function inTurn(work) {
    const run = pending.then(work);
    pending = run.catch(() => {});
    return run;
  }
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  async function load(path, binary) {
    try {
      const bytes = await readFile(join(root, path));
      return { value: binary ? bytes : JSON.parse(bytes.toString()), etag: hash(bytes) };
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return null;
    }
  }
  return {
    read: (path, binary = false) => inTurn(() => load(path, binary)),
    write: (path, value, expected, contentType = 'application/json') => inTurn(async () => {
      const prior = await load(path, contentType !== 'application/json');
      requireValue((prior?.etag ?? null) === (expected ?? null),
        'A newer change was saved. Review the latest state and try again.', 409);
      const destination = join(root, path);
      const temporary = destination + '.' + randomUUID() + '.tmp';
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(temporary, contentType === 'application/json' ? JSON.stringify(value) : value);
      await rename(temporary, destination);
    }),
    // Deletes one file, or a whole directory when the path ends in "/".
    remove: path => inTurn(() => rm(join(root, path), { recursive: true, force: true })),
    async paths(prefix) {
      try {
        const entries = await readdir(join(root, prefix));
        return entries.filter(entry => !entry.endsWith('.tmp')).map(entry => prefix + entry);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return [];
      }
    },
  };
}
