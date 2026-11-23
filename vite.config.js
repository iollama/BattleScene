import { defineConfig, loadEnv } from 'vite';
import { Readable } from 'node:stream';
import { createHandler } from './server/http.js';

function localApi(env) {
  const options = { local: true, env, directory: env.BATTLESCENE_DATA_DIRECTORY };
  const handlers = new WeakMap();
  // The native config loader doesn't reload modules the config imports, so in dev the API is
  // loaded through Vite's module graph instead: edits under server/ or shared/ apply on the next request.
  async function devHandler(server) {
    const { createHandler: create } = await server.ssrLoadModule('/server/http.js');
    if (!handlers.has(create)) handlers.set(create, create(options));
    return handlers.get(create);
  }
  let previewHandler;
  function attach(server, dev) {
    server.middlewares.use(async (incoming, outgoing, next) => {
      if (!incoming.url?.startsWith('/api/')) return next();
      let handle;
      try { handle = dev ? await devHandler(server) : previewHandler ??= createHandler(options); }
      catch (error) { return next(error); }
      const request = new Request('http://' + incoming.headers.host + incoming.url, {
        method: incoming.method,
        headers: incoming.headers,
        ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}),
      });
      const response = await handle(request);
      outgoing.statusCode = response.status;
      for (const [key, value] of response.headers) {
        if (key !== 'set-cookie') outgoing.setHeader(key, value);
      }
      const cookies = response.headers.getSetCookie();
      if (cookies.length) outgoing.setHeader('set-cookie', cookies);
      if (response.body) Readable.fromWeb(response.body).pipe(outgoing);
      else outgoing.end();
    });
  }
  return {
    name: 'battlescene-local-api',
    configureServer: server => attach(server, true),
    configurePreviewServer: server => attach(server, false),
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [localApi({ ...process.env, ...loadEnv(mode, process.cwd(), '') })],
  server: { strictPort: true },
}));
