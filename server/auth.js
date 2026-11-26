import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { requireValue } from './bracket.js';
import { DEMO_TEAM } from './demo.js';
import { email, text } from './meetup.js';

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const tokenPart = () => randomBytes(32).toString('base64url');
const demoUser = { email: 'organizer@battlescene.test', name: 'Alex Morgan', role: 'admin' };
const sessionName = 'battlescene_session';
const stateName = 'battlescene_login';
// Local demo mode only: set by "Continue with Google" on a registration page, so the next requests act as the demo team.
const demoAsName = 'battlescene_demo_as';

// Where to send the browser after signing in: a path on this site, never another origin.
export function returnPath(value) {
  return typeof value === 'string' && /^\/(?![/\\])[^\s\\]*$/.test(value) && value.length <= 300 ? value : '/';
}
const failedPath = path => path + (path.includes('?') ? '&' : '?') + 'login=failed';

function cookie(request, name) {
  return (request.headers.get('cookie') || '').split(';').map(value => value.trim())
    .find(value => value.startsWith(name + '='))?.slice(name.length + 1);
}

function setCookie(request, name, value, seconds) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return name + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + seconds + secure;
}

export function authService({ env, local, store }) {
  const localDemo = local && !env.GOOGLE_CLIENT_ID;
  const ready = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.APP_ORIGIN
    && (env.SESSION_SECRET?.length ?? 0) >= 32 && env.BOOTSTRAP_ADMIN_EMAIL);
  const secret = new TextEncoder().encode(env.SESSION_SECRET ?? '');
  const redirectUri = env.APP_ORIGIN?.replace(/\/$/, '') + '/api/auth/callback';

  async function sign(audience, payload, expiration) {
    return new SignJWT(payload).setProtectedHeader({ alg: 'HS256' })
      .setIssuer('battlescene').setAudience(audience).setIssuedAt().setExpirationTime(expiration).sign(secret);
  }
  async function decode(request, name, audience) {
    const value = cookie(request, name);
    if (!value || !ready) return null;
    try {
      return (await jwtVerify(value, secret, { issuer: 'battlescene', audience, algorithms: ['HS256'] })).payload;
    } catch {
      return null;
    }
  }

  // roles.json holds the managers, a short history of access changes, and the id of every meetup. `registry()` reads
  // it exactly, for anything about to change it or to decide on the very latest; `roles()` is the copy that answers
  // every other request, and costs no storage read while the file is unchanged (see cache.js).
  async function registry() {
    const record = await store().read('roles.json');
    return { value: record?.value ?? { managers: [] }, etag: record?.etag };
  }
  const roles = async () => (await store().relaxed('roles.json'))?.value ?? { managers: [] };

  // Every change to roles.json goes through here. `change` gets the current value and returns the new one, or
  // nothing to leave the file alone; it runs again if another write lands first. Returns the value now stored.
  async function updateRegistry(change) {
    for (let attempt = 0; ; attempt++) {
      const { value, etag } = await registry();
      const next = await change(value);
      if (!next) return value;
      try {
        await store().write('roles.json', next, etag);
        return next;
      } catch (error) {
        if (error.status !== 409 || attempt >= 3) throw error;
      }
    }
  }

  async function actor(request) {
    if (localDemo) return cookie(request, demoAsName) === 'team' ? DEMO_TEAM : demoUser;
    const session = await decode(request, sessionName, 'staff');
    if (!session) return null;
    const address = email(session.email);
    const admin = address === email(env.BOOTSTRAP_ADMIN_EMAIL);
    const role = admin ? 'admin' : (await roles()).managers.includes(address) ? 'manager' : null;
    return { email: address, name: text(session.name) || address, role };
  }

  function redirect(location, cookies = []) {
    const headers = new Headers({ location, 'cache-control': 'no-store' });
    for (const value of cookies) headers.append('set-cookie', value);
    return new Response(null, { status: 302, headers });
  }

  async function login(request) {
    const query = new URL(request.url).searchParams;
    const returnTo = returnPath(query.get('returnTo'));
    if (localDemo) {
      const team = query.get('as') === 'team';
      return redirect(returnTo, [setCookie(request, demoAsName, team ? 'team' : '', team ? 43200 : 0)]);
    }
    requireValue(ready, 'Google sign-in needs deployment credentials.', 503);
    const state = tokenPart();
    const nonce = tokenPart();
    const verifier = tokenPart();
    const signed = await sign('google-login', { state, nonce, verifier, returnTo }, '10m');
    const target = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    target.search = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code',
      scope: 'openid email profile', state, nonce,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return redirect(target.href, [setCookie(request, stateName, signed, 600)]);
  }

  async function callback(request) {
    const logoutState = setCookie(request, stateName, '', 0);
    let back = '/';
    try {
      const query = new URL(request.url).searchParams;
      const saved = await decode(request, stateName, 'google-login');
      back = returnPath(saved?.returnTo);
      const code = query.get('code');
      requireValue(saved && code && saved.state === query.get('state'), 'Sign-in expired. Try again.', 400);
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
          code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: saved.verifier,
        }),
      });
      requireValue(tokenResponse.ok, 'Google could not complete sign-in.', 400);
      const { id_token: token } = await tokenResponse.json();
      const { payload } = await jwtVerify(token, googleKeys, {
        issuer: ['accounts.google.com', 'https://accounts.google.com'], audience: env.GOOGLE_CLIENT_ID,
        algorithms: ['RS256'],
      });
      requireValue(payload.nonce === saved.nonce && payload.email_verified === true && email(payload.email),
        'Google did not verify this account.', 403);
      const session = await sign('staff', { email: email(payload.email), name: text(payload.name) }, '12h');
      return redirect(back, [logoutState, setCookie(request, sessionName, session, 43200)]);
    } catch {
      return redirect(failedPath(back), [logoutState]);
    }
  }
  return {
    actor, callback, demoUser, localDemo, login, ready, registry, roles, updateRegistry,
    logout: request => redirect('/', [setCookie(request, sessionName, '', 0), setCookie(request, demoAsName, '', 0)]),
  };
}
