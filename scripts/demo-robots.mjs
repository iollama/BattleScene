#!/usr/bin/env node
/**
 * Writes public/demo-robots/1.svg … 12.svg: stand-in "studio photos" of small
 * combat robots, used as demo robot photos on venue screens.
 *
 * Each robot is a tiny 3D scene (boxes, extrusions, cylinders, a dome) seen by a
 * fixed camera, lit by a key light, a fill and an ice-blue rim light, and drawn
 * as flat SVG shapes with gradients. The arena floor, back wall and contact
 * shadow are projected with the same camera. Output is deterministic.
 *
 *   node scripts/demo-robots.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'demo-robots');
const S = 512;
const D2R = Math.PI / 180;

// ---------- math ----------
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const avg = (ps) => mul(ps.reduce(add, [0, 0, 0]), 1 / ps.length);
const rotX = ([x, y, z], t) => [x, y * Math.cos(t) + z * Math.sin(t), z * Math.cos(t) - y * Math.sin(t)];
const rotY = ([x, y, z], t) => [x * Math.cos(t) + z * Math.sin(t), y, z * Math.cos(t) - x * Math.sin(t)];

function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hull2(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length > 1 && cr(lo.at(-2), lo.at(-1), q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length > 1 && cr(hi.at(-2), hi.at(-1), q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

function simplify(pts, tol) {
  // Douglas-Peucker on a closed ring (keeps the first point).
  const ring = (a) => {
    if (a.length < 3) return a;
    let best = 0, idx = 0;
    const [p, q] = [a[0], a.at(-1)];
    const dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy) || 1;
    for (let i = 1; i < a.length - 1; i++) {
      const d = Math.abs((a[i][0] - p[0]) * dy - (a[i][1] - p[1]) * dx) / L;
      if (d > best) { best = d; idx = i; }
    }
    if (best <= tol) return [p, q];
    return ring(a.slice(0, idx + 1)).slice(0, -1).concat(ring(a.slice(idx)));
  };
  const half = Math.floor(pts.length / 2);
  return ring(pts.slice(0, half + 1)).slice(0, -1).concat(ring(pts.slice(half).concat([pts[0]])).slice(0, -1));
}

function clipRect(poly, u0, u1, v0, v1) {
  const edges = [[(p) => p[0] - u0, 0, u0], [(p) => u1 - p[0], 0, u1], [(p) => p[1] - v0, 1, v0], [(p) => v1 - p[1], 1, v1]];
  let out = poly;
  for (const [inside] of edges) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length], da = inside(a), db = inside(b);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    if (!out.length) break;
  }
  return out;
}

// ---------- colour ----------
const lin = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map((v) => (v / 255) ** 2.2);
};
const toHex = (c) => {
  const h = c.map((v) => Math.round(255 * Math.min(1, Math.max(0, v)) ** (1 / 2.2)).toString(16).padStart(2, '0'));
  return h.every((x) => x[0] === x[1]) ? `#${h[0][0]}${h[1][0]}${h[2][0]}` : `#${h.join('')}`;
};
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const WHITE = [1, 1, 1];
const RIMC = lin('#8fd0ff');

const f = (n) => {
  let s = String(Math.round(n * 10) / 10);
  if (s === '-0') s = '0';
  return s.replace(/^(-?)0\./, '$1.');
};
const fi = (n) => String(Math.round(n) || 0);
const pd = (pts, close = true) => `M${pts.map((p) => `${fi(p[0])} ${fi(p[1])}`).join(' ')}${close ? 'Z' : ''}`;
const seg = (a, b) => `M${fi(a[0])} ${fi(a[1])}L${fi(b[0])} ${fi(b[1])}`;
const area2 = (p) => p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2;

// ---------- materials ----------
const mat = (hex, ks = 0.3, sh = 24, metal = 0) => ({ c: lin(hex), ks, sh, metal });
const STEEL = mat('#9aa3ac', 0.8, 14, 0.75);
const DARKSTEEL = mat('#5b626a', 0.6, 14, 0.6);
const BRIGHT = mat('#d6dde3', 0.9, 10, 0.6);
const ALU = mat('#c2c8ce', 0.55, 9, 0.5);
const RUBBER = mat('#1e2023', 0.16, 5);
const BLACK = mat('#2b2e33', 0.18, 10);
const INNER = mat('#17191c', 0.1, 6);

// ---------- scene objects ----------
const face = (pts, m) => ({ pts, m, dec: [] });
const poly = (faces, zb = 0) => ({ kind: 'poly', faces, zb });

function box(x0, x1, y0, y1, z0, z1, m) {
  const P = (x, y, z) => [x, y, z];
  const fc = {
    top: face([P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)], m),
    bottom: face([P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1)], m),
    front: face([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], m),
    back: face([P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0)], m),
    right: face([P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)], m),
    left: face([P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], m),
  };
  const o = poly(Object.values(fc));
  o.f = fc;
  return o;
}

// Extrude a side profile [[z, y], …] across x0..x1. Faces: L, R (caps), s[i] (edge i → i+1).
function extX(prof, x0, x1, m) {
  const L = face(prof.map(([z, y]) => [x0, y, z]), m);
  const R = face(prof.map(([z, y]) => [x1, y, z]), m);
  const s = prof.map((p, i) => {
    const q = prof[(i + 1) % prof.length];
    return face([[x0, p[1], p[0]], [x0, q[1], q[0]], [x1, q[1], q[0]], [x1, p[1], p[0]]], m);
  });
  const o = poly([L, R, ...s]);
  o.f = { L, R, s };
  return o;
}

function pyramid(base, apex, m) {
  const faces = [face([...base].reverse(), m)];
  base.forEach((p, i) => faces.push(face([p, base[(i + 1) % base.length], apex], m)));
  return poly(faces);
}

function xf(o, fn) {
  for (const fc of o.faces) {
    fc.pts = fc.pts.map(fn);
    for (const d of fc.dec) { if (d.pts) d.pts = d.pts.map(fn); if (d.bolt) d.bolt = fn(d.bolt); }
  }
  return o;
}
const frame = (o, ex, ey, ez) => (p) => add(o, add(mul(ex, p[0]), add(mul(ey, p[1]), mul(ez, p[2]))));

const cyl = (c, a, r, h, m, extra = {}) => ({ kind: 'cyl', c, a: norm(a), r, h, m, rings: [], ...extra });
const cylP = (p0, p1, r, m, extra) => cyl(mul(add(p0, p1), 0.5), sub(p1, p0), r, len(sub(p1, p0)) / 2, m, extra);

function wheel(c, side, r, w, hub, extra = {}) {
  return cyl(c, [side, 0, 0], r, w / 2, RUBBER, {
    stops: 3,
    rings: [
      { k: 0.8, m: mat('#2a2d31', 0.2, 6), off: 0.3 },
      { k: 0.62, m: hub, off: 0.8 },
      { k: 0.28, m: DARKSTEEL, off: 1.4 },
    ],
    bolts: { n: 5, k: 0.45, r: 0.055, off: 1.0 },
    outer: true,
    ...extra,
  });
}

// Decals: drawn on top of their face when the face is visible.
const bil = (fc, u, v) => {
  const [a, b, c, d] = fc.pts;
  return add(add(mul(a, (1 - u) * (1 - v)), mul(b, u * (1 - v))), add(mul(c, u * v), mul(d, (1 - u) * v)));
};
const dq = (fc, u0, u1, v0, v1, st) => fc.dec.push({ pts: [bil(fc, u0, v0), bil(fc, u1, v0), bil(fc, u1, v1), bil(fc, u0, v1)], ...st });
const duv = (fc, uvs, st) => fc.dec.push({ pts: uvs.map(([u, v]) => bil(fc, u, v)), ...st });
const d3 = (fc, pts, st) => fc.dec.push({ pts, ...st });
const bolts = (fc, uvs, r = 2.6) => uvs.forEach(([u, v]) => fc.dec.push({ bolt: bil(fc, u, v), r }));
const bolts3 = (fc, pts, r = 2.6) => pts.forEach((p) => fc.dec.push({ bolt: p, r }));
const corners = (a, b) => [[a, b], [1 - a, b], [1 - a, 1 - b], [a, 1 - b]];
function hazard(fc, [u0, u1, v0, v1], n, st, slant = 0.5) {
  const w = (u1 - u0) / n;
  for (let k = -2; k < n + 2; k++) {
    const a = u0 + k * w, sl = slant * (u1 - u0) / n * 1.2;
    const q = clipRect([[a, v0], [a + w / 2, v0], [a + w / 2 + sl, v1], [a + sl, v1]], u0, u1, v0, v1);
    if (q.length > 2) duv(fc, q, st);
  }
}
const HL = (op = 0.16) => ({ fill: '#fff', op });

// ---------- renderer ----------
function render(cfg) {
  const objs = cfg.build();
  const rand = prng(cfg.seed);

  // finalize normals
  const all3 = [];
  for (const o of objs) {
    if (o.kind === 'poly') {
      const oc = avg(o.faces.flatMap((fc) => fc.pts));
      o.center = oc;
      for (const fc of o.faces) {
        let n = [0, 0, 0];
        fc.pts.forEach((p, i) => {
          const q = fc.pts[(i + 1) % fc.pts.length];
          n = add(n, [(p[1] - q[1]) * (p[2] + q[2]), (p[2] - q[2]) * (p[0] + q[0]), (p[0] - q[0]) * (p[1] + q[1])]);
        });
        n = norm(n);
        fc.c = avg(fc.pts);
        if (dot(n, sub(fc.c, oc)) < 0) n = mul(n, -1);
        fc.n = n;
        all3.push(...fc.pts);
      }
    } else if (o.kind === 'cyl' || o.kind === 'prism') {
      const up = Math.abs(o.a[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      o.e1 ??= norm(cross(o.a, up));
      o.e2 ??= cross(o.a, o.e1);
      o.center = o.c;
      const prof = o.kind === 'prism' ? o.prof : Array.from({ length: 16 }, (_, i) => [o.r * Math.cos(i / 16 * 2 * Math.PI), o.r * Math.sin(i / 16 * 2 * Math.PI)]);
      for (const s of [-1, 1]) for (const [x, y] of prof) all3.push(add(add(o.c, mul(o.a, s * o.h)), add(mul(o.e1, x), mul(o.e2, y))));
    } else if (o.kind === 'dome') {
      o.center = add(o.c, [0, o.H * 0.35, 0]);
      for (let i = 0; i <= 8; i++) for (let j = 0; j < 24; j++) {
        const t = (i / 8) * Math.PI / 2, ph = (j / 24) * 2 * Math.PI;
        all3.push(add(o.c, [o.R * Math.sin(t) * Math.cos(ph), o.H * Math.cos(t), o.R * Math.sin(t) * Math.sin(ph)]));
      }
    }
  }

  // camera
  let [x0, x1, z0, z1, ymax] = [Infinity, -Infinity, Infinity, -Infinity, 0];
  for (const p of all3) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); ymax = Math.max(ymax, p[1]); }
  const Rr = Math.max(x1 - x0, z1 - z0) / 2;
  const T = [(x0 + x1) / 2, ymax * 0.4, (z0 + z1) / 2];
  const az = cfg.az * D2R, el = cfg.el * D2R, D = Rr * 5.5;
  const CAM = add(T, [D * Math.sin(az) * Math.cos(el), D * Math.sin(el), D * Math.cos(az) * Math.cos(el)]);
  const w = norm(sub(CAM, T)), u = norm(cross([0, 1, 0], w)), v = cross(w, u);
  const raw = (p) => { const d = sub(p, CAM); const zc = -dot(d, w); return [dot(d, u) / zc, -dot(d, v) / zc, zc]; };
  const depth = (p) => -dot(sub(p, CAM), w);

  const K = Rr * 2.6;
  const KEY = add(T, add(mul(u, -1.0 * K), add(mul(v, 1.3 * K), mul(w, 0.9 * K))));
  const KEYD = len(sub(KEY, T));
  const FILL = norm(add(mul(u, 0.8), add(mul(v, 0.1), w)));
  const RIM = norm(add(mul(u, 0.9), add(mul(v, 0.55), mul(w, -0.75))));

  // fit robot into frame
  let [bx0, bx1, by0, by1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const p of all3) { const r = raw(p); bx0 = Math.min(bx0, r[0]); bx1 = Math.max(bx1, r[0]); by0 = Math.min(by0, r[1]); by1 = Math.max(by1, r[1]); }
  const sc = Math.min((cfg.fw ?? 0.74) * S / (bx1 - bx0), 0.64 * S / (by1 - by0));
  const ox = S / 2 - sc * (bx0 + bx1) / 2, oy = (cfg.cy ?? 266) - sc * (by0 + by1) / 2;
  const P = (p) => { const r = raw(p); return [ox + sc * r[0], oy + sc * r[1]]; };
  const pxAt = (p) => sc / raw(p)[2];

  function shade(p, n, m) {
    const Lv = sub(KEY, p), d = len(Lv), L = mul(Lv, 1 / d);
    const att = Math.min(1.7, (KEYD / d) ** 2);
    const diff = Math.max(0, dot(n, L)) * att;
    const fil = Math.max(0, dot(n, FILL)) * 0.2;
    const V = norm(sub(CAM, p)), H = norm(add(L, V));
    const sp = m.ks * Math.max(0, dot(n, H)) ** m.sh * att;
    const rim = Math.max(0, dot(n, RIM)) ** 2 * 0.3;
    const sky = Math.max(0, n[1]) * 0.05;
    const spc = mixc(WHITE, m.c, m.metal);
    // soft roll-off so bright faces keep their hue instead of clipping to pastel
    return [0, 1, 2].map((i) => 1 - Math.exp(-1.35 * (m.c[i] * (0.03 + sky + diff * 0.95 + fil) + spc[i] * sp + RIMC[i] * rim)));
  }

  // defs registry (deduped)
  const defs = [], defIds = new Map();
  const def = (body) => {
    if (!defIds.has(body)) { const id = `g${defIds.size}`; defIds.set(body, id); defs.push(body.replace('§', id)); }
    return defIds.get(body);
  };
  const stopsXml = (st) => st.map(([o, c, op]) => `<stop${o ? ` offset="${f(Math.round(o * 1000) / 1000).replace(/^\.(\d)$/, '.$1')}"` : ''} stop-color="${c}"${op !== undefined && op < 1 ? ` stop-opacity="${f(op)}"` : ''}/>`).join('');
  const linG = (a, b, st) => `url(#${def(`<linearGradient id="§" href="#u" x1="${fi(a[0])}" y1="${fi(a[1])}" x2="${fi(b[0])}" y2="${fi(b[1])}">${stopsXml(st)}</linearGradient>`)})`;
  const radG = (c, r, st, extra = '') => `url(#${def(`<radialGradient id="§" href="#v" cx="${fi(c[0])}" cy="${fi(c[1])}" r="${fi(r)}"${extra}>${stopsXml(st)}</radialGradient>`)})`;
  const bbG = (st, kind = 'linearGradient', attrs = 'x2="0" y2="1"') => `url(#${def(`<${kind} id="§" ${attrs}>${stopsXml(st)}</${kind}>`)})`;

  // Least-squares linear colour fit over a polygon → flat colour or 2-stop gradient.
  function fill(pts3, pts2, n, m, minArea = 1000) {
    const cols = pts3.map((p) => shade(p, n, m));
    const mean = [0, 1, 2].map((i) => cols.reduce((s, c) => s + c[i], 0) / cols.length);
    if (Math.abs(area2(pts2)) < minArea) return toHex(mean);
    const cx = pts2.reduce((s, p) => s + p[0], 0) / pts2.length, cy = pts2.reduce((s, p) => s + p[1], 0) / pts2.length;
    let sxx = 0, syy = 0, sxy = 0;
    const sxv = [0, 0, 0], syv = [0, 0, 0];
    pts2.forEach((p, k) => {
      const dx = p[0] - cx, dy = p[1] - cy;
      sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
      for (let i = 0; i < 3; i++) { sxv[i] += dx * (cols[k][i] - mean[i]); syv[i] += dy * (cols[k][i] - mean[i]); }
    });
    const det = sxx * syy - sxy * sxy;
    if (det < 1e-6) return toHex(mean);
    const b = [0, 1, 2].map((i) => (syy * sxv[i] - sxy * syv[i]) / det);
    const c = [0, 1, 2].map((i) => (sxx * syv[i] - sxy * sxv[i]) / det);
    let gx = lum(b), gy = lum(c);
    const gl = Math.hypot(gx, gy);
    if (gl < 1e-7) return toHex(mean);
    gx /= gl; gy /= gl;
    const ts = pts2.map((p) => (p[0] - cx) * gx + (p[1] - cy) * gy);
    const t0 = Math.min(...ts), t1 = Math.max(...ts);
    const at = (t) => [0, 1, 2].map((i) => mean[i] + b[i] * gx * t + c[i] * gy * t);
    const h0 = toHex(at(t0)), h1 = toHex(at(t1));
    const rgb = (h) => (h.length === 4 ? [...h.slice(1)].map((x) => parseInt(x + x, 16)) : [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)));
    const [q0, q1] = [rgb(h0), rgb(h1)];
    if (Math.max(...q0.map((x, i) => Math.abs(x - q1[i]))) < 9) return toHex(mean);
    return linG([cx + gx * t0, cy + gy * t0], [cx + gx * t1, cy + gy * t1], [[0, h0], [1, h1]]);
  }

  const out = [];
  let rimLines = [], keyLines = [];
  const flushLights = () => {
    if (rimLines.length) out.push(`<path class="r" d="${rimLines.join('')}"/>`);
    if (keyLines.length) out.push(`<path class="k" d="${keyLines.join('')}"/>`);
    rimLines = []; keyLines = [];
  };
  const RIM2 = [0.8, -0.6], KEY2 = [-0.5, -0.87];

  function edgeLights(vis) {
    const count = new Map();
    const key = (p) => p.map((x) => x.toFixed(2)).join(',');
    for (const { fc } of vis) fc.pts.forEach((p, i) => {
      const q = fc.pts[(i + 1) % fc.pts.length];
      const k = [key(p), key(q)].sort().join('|');
      count.set(k, (count.get(k) ?? 0) + 1);
    });
    for (const { fc, p2 } of vis) {
      const c2 = [p2.reduce((s, p) => s + p[0], 0) / p2.length, p2.reduce((s, p) => s + p[1], 0) / p2.length];
      fc.pts.forEach((p, i) => {
        const j = (i + 1) % fc.pts.length;
        const a = p2[i], b = p2[j];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 5) return;
        let nx = (b[1] - a[1]) / L, ny = -(b[0] - a[0]) / L;
        const mx = (a[0] + b[0]) / 2 - c2[0], my = (a[1] + b[1]) / 2 - c2[1];
        if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
        const sil = count.get([key(p), key(fc.pts[j])].sort().join('|')) === 1;
        if (sil && nx * RIM2[0] + ny * RIM2[1] > 0.3) rimLines.push(seg(a, b));
        else if (L > 12 && nx * KEY2[0] + ny * KEY2[1] > 0.55 && dot(fc.n, v) > -0.2) keyLines.push(seg(a, b));
      });
    }
  }

  const boltUse = (p, r) => { const q = P(p); out.push(`<circle cx="${f(q[0])}" cy="${f(q[1])}" r="${f(Math.max(0.6, r * pxAt(p)))}"/>`); };

  function drawDecals(fc) {
    for (const d of fc.dec) {
      if (d.bolt) { boltUse(d.bolt, d.r); continue; }
      const p2 = d.pts.map(P);
      if (d.m) out.push(`<path d="${pd(p2)}" fill="${fill(d.pts, p2, fc.n, d.m)}"/>`);
      else out.push(`<path d="${pd(p2)}" fill="${d.fill}"${d.op < 1 ? ` fill-opacity="${f(d.op)}"` : ''}/>`);
    }
  }

  let culled = () => false;
  function drawPoly(o) {
    const vis = [];
    for (const fc of o.faces) {
      if (dot(fc.n, sub(CAM, fc.c)) <= 1e-6) continue;
      const p2 = fc.pts.map(P);
      if (culled(p2)) continue;
      const fl = fill(fc.pts, p2, fc.n, fc.m);
      out.push(`<path d="${pd(p2)}" fill="${fl}" stroke="${fl}"/>`);
      drawDecals(fc);
      vis.push({ fc, p2 });
    }
    edgeLights(vis);
    flushLights();
  }

  function ell(c3, e1, e2, r) {
    const a1 = P(add(c3, mul(e1, r))), a2 = P(sub(c3, mul(e1, r))), b1 = P(add(c3, mul(e2, r))), b2 = P(sub(c3, mul(e2, r)));
    const c = [(a1[0] + a2[0] + b1[0] + b2[0]) / 4, (a1[1] + a2[1] + b1[1] + b2[1]) / 4];
    const A = [(a1[0] - a2[0]) / 2, (a1[1] - a2[1]) / 2], B = [(b1[0] - b2[0]) / 2, (b1[1] - b2[1]) / 2];
    const sxx = A[0] ** 2 + B[0] ** 2, syy = A[1] ** 2 + B[1] ** 2, sxy = A[0] * A[1] + B[0] * B[1];
    const dd = Math.sqrt(Math.max(0, (sxx - syy) ** 2 / 4 + sxy ** 2));
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { c, A, B, rx: Math.sqrt((sxx + syy) / 2 + dd), ry: Math.max(0.3, Math.sqrt(Math.max(0, (sxx + syy) / 2 - dd))), th };
  }
  const at2 = (E, t) => [E.c[0] + E.A[0] * Math.cos(t) + E.B[0] * Math.sin(t), E.c[1] + E.A[1] * Math.cos(t) + E.B[1] * Math.sin(t)];
  const arcTo = (E, a, m, b) => {
    const cr = (m[0] - a[0]) * (b[1] - m[1]) - (m[1] - a[1]) * (b[0] - m[0]);
    return `A${f(E.rx)} ${f(E.ry)} ${f(E.th / D2R)} 0 ${cr > 0 ? 1 : 0} ${f(b[0])} ${f(b[1])}`;
  };
  const ellPath = (E) => {
    const a = [E.c[0] + E.rx * Math.cos(E.th), E.c[1] + E.rx * Math.sin(E.th)], b = [2 * E.c[0] - a[0], 2 * E.c[1] - a[1]];
    const r = `A${f(E.rx)} ${f(E.ry)} ${f(E.th / D2R)} 1 1 `;
    return `M${f(a[0])} ${f(a[1])}${r}${f(b[0])} ${f(b[1])}${r}${f(a[0])} ${f(a[1])}Z`;
  };
  const discFill = (c3, n, e1, e2, r, m, minArea) => {
    const s3 = Array.from({ length: 12 }, (_, i) => add(c3, add(mul(e1, r * Math.cos(i * Math.PI / 6)), mul(e2, r * Math.sin(i * Math.PI / 6)))));
    return fill(s3, s3.map(P), n, m, minArea);
  };

  function capDecor(o, cc, n) {
    for (const rg of o.rings) {
      const c3 = add(cc, mul(n, rg.off ?? 0.5));
      const E = ell(c3, o.e1, o.e2, o.r * rg.k);
      out.push(`<path d="${ellPath(E)}" fill="${discFill(c3, n, o.e1, o.e2, o.r * rg.k, rg.m, rg.k > 0.5 ? 500 : 1e9)}"/>`);
    }
    if (o.bolts) {
      const { n: nb, k, r, off } = o.bolts;
      for (let i = 0; i < nb; i++) {
        const t = (i / nb) * 2 * Math.PI + 0.3;
        boltUse(add(add(cc, mul(n, off)), add(mul(o.e1, o.r * k * Math.cos(t)), mul(o.e2, o.r * k * Math.sin(t)))), o.r * r);
      }
    }
  }

  function drawCyl(o) {
    const { c, a, r, h, m, e1, e2 } = o;
    const c0 = sub(c, mul(a, h)), c1 = add(c, mul(a, h));
    const E0 = ell(c0, e1, e2, r), E1 = ell(c1, e1, e2, r);
    const t = [E1.c[0] - E0.c[0], E1.c[1] - E0.c[1]], tl = Math.hypot(t[0], t[1]);
    if (tl > 0.4) {
      const det = E1.A[0] * E1.B[1] - E1.B[0] * E1.A[1];
      let psi;
      if (Math.abs(det) < 1e-3) psi = Math.abs(E1.A[0] * -t[1] + E1.A[1] * t[0]) > Math.abs(E1.B[0] * -t[1] + E1.B[1] * t[0]) ? 0 : Math.PI / 2;
      else {
        const q0 = (E1.B[1] * t[0] - E1.B[0] * t[1]) / det, q1 = (-E1.A[1] * t[0] + E1.A[0] * t[1]) / det;
        psi = Math.atan2(-q0, q1);
      }
      const side = (E, sign) => {
        const T = [at2(E, psi)[0] - E.c[0], at2(E, psi)[1] - E.c[1]];
        let mm = [at2(E, psi + Math.PI / 2)[0] - E.c[0], at2(E, psi + Math.PI / 2)[1] - E.c[1]];
        if ((mm[0] * t[0] + mm[1] * t[1]) * sign < 0) mm = [-mm[0], -mm[1]];
        return { T, mm };
      };
      const s1 = side(E1, 1), s0 = side(E0, -1);
      const A1 = [E1.c[0] + s1.T[0], E1.c[1] + s1.T[1]], B1 = [E1.c[0] - s1.T[0], E1.c[1] - s1.T[1]];
      const A0 = [E0.c[0] + s0.T[0], E0.c[1] + s0.T[1]], B0 = [E0.c[0] - s0.T[0], E0.c[1] - s0.T[1]];
      const d = `M${f(A0[0])} ${f(A0[1])}L${f(A1[0])} ${f(A1[1])}${arcTo(E1, A1, [E1.c[0] + s1.mm[0], E1.c[1] + s1.mm[1]], B1)}L${f(B0[0])} ${f(B0[1])}${arcTo(E0, B0, [E0.c[0] + s0.mm[0], E0.c[1] + s0.mm[1]], A0)}Z`;
      // gradient across the axis
      const perp = [-t[1] / tl, t[0] / tl];
      const Em = { c: [(E0.c[0] + E1.c[0]) / 2, (E0.c[1] + E1.c[1]) / 2], A: E0.A.map((x, i) => (x + E1.A[i]) / 2), B: E0.B.map((x, i) => (x + E1.B[i]) / 2) };
      const Tm = [(s0.T[0] + s1.T[0]) / 2, (s0.T[1] + s1.T[1]) / 2];
      let tp = Tm[0] * perp[0] + Tm[1] * perp[1];
      const nAt = (ps) => add(mul(e1, Math.cos(ps)), mul(e2, Math.sin(ps)));
      const dir = dot(nAt(psi + Math.PI / 2), sub(CAM, c)) > 0 ? 1 : -1;
      const n = o.stops ?? 6;
      let st = [];
      for (let k = 0; k < n; k++) {
        const ps = psi + dir * Math.PI * (0.02 + 0.96 * k / (n - 1));
        const nn = nAt(ps), q = at2(Em, ps);
        const off = ((q[0] - Em.c[0]) * perp[0] + (q[1] - Em.c[1]) * perp[1]);
        st.push([off, toHex(shade(add(c, mul(nn, r)), nn, m))]);
      }
      if (tp < 0) { tp = -tp; }
      st = st.map(([off, col]) => [Math.min(1, Math.max(0, (tp - off) / (2 * tp))), col]).sort((x, y) => x[0] - y[0]);
      const g = linG([Em.c[0] + perp[0] * tp, Em.c[1] + perp[1] * tp], [Em.c[0] - perp[0] * tp, Em.c[1] - perp[1] * tp], st);
      out.push(`<path d="${d}" fill="${g}"/>`);
      // rim light on whichever silhouette line faces right/up
      const tlen = Math.hypot(Tm[0], Tm[1]) || 1, facing = (Tm[0] * RIM2[0] + Tm[1] * RIM2[1]) / tlen;
      if (facing > 0.3) rimLines.push(seg(A0, A1));
      else if (facing < -0.3) rimLines.push(seg(B0, B1));
    }
    const capPos = dot(a, sub(CAM, c1)) > 0;
    const cn = capPos ? a : mul(a, -1), cc = capPos ? c1 : c0, E = capPos ? E1 : E0;
    const outerCap = !o.outer || dot(cn, [cc[0] - T[0], 0, cc[2] - T[2]]) > 0;
    out.push(`<path d="${ellPath(E)}" fill="${discFill(cc, cn, e1, e2, r, o.capM ?? m, outerCap && o.m !== RUBBER ? 60 : 1e9)}"/>`);
    flushLights();
    if (outerCap) capDecor(o, cc, cn);
  }

  function drawPrism(o) {
    const { c, a, e1, e2, prof, h, m } = o;
    const cn = dot(a, sub(CAM, c)) > 0 ? a : mul(a, -1);
    const pn = add(c, mul(cn, h)), pf = add(c, mul(cn, -h));
    const at3 = (base, [x, y]) => add(base, add(mul(e1, x), mul(e2, y)));
    const near = prof.map((q) => at3(pn, q)), far = prof.map((q) => at3(pf, q));
    const ccw = area2(prof) > 0;
    const groups = new Map();
    prof.forEach((q, i) => {
      const j = (i + 1) % prof.length, r2 = prof[j];
      const dx = r2[0] - q[0], dy = r2[1] - q[1];
      const n2 = ccw ? [dy, -dx] : [-dy, dx];
      const n3 = norm(add(mul(e1, n2[0]), mul(e2, n2[1])));
      const mid = avg([near[i], near[j], far[i], far[j]]);
      if (dot(n3, sub(CAM, mid)) <= 0) return;
      let quad = [P(near[i]), P(near[j]), P(far[j]), P(far[i])];
      if (area2(quad) < 0) quad = quad.reverse();
      const col = toHex(shade(mid, n3, m).map((x) => (Math.round(x ** (1 / 2.2) * 40) / 40) ** 2.2));
      groups.set(col, (groups.get(col) ?? '') + pd(quad));
    });
    for (const [col, d] of groups) out.push(`<path d="${d}" fill="${col}" stroke="${col}"/>`);
    const n2 = near.map(P);
    out.push(`<path d="${pd(n2)}" fill="${fill(near, n2, cn, m)}"/>`);
    for (const d of o.capDec ?? []) {
      const c3 = add(pn, mul(cn, d.off ?? 0.4));
      if (d.ring) {
        const E = ell(c3, e1, e2, d.ring);
        out.push(`<path d="${ellPath(E)}" fill="${d.fill ?? discFill(c3, cn, e1, e2, d.ring, d.m, 40)}"${d.op ? ` fill-opacity="${d.op}"` : ''}/>`);
      }
      if (d.bolts) for (let i = 0; i < d.bolts; i++) {
        const t = (i / d.bolts) * 2 * Math.PI;
        boltUse(add(c3, add(mul(e1, d.k * Math.cos(t)), mul(e2, d.k * Math.sin(t)))), d.r);
      }
      if (d.poly) {
        const p3 = d.poly.map((q) => at3(c3, q)), p2 = p3.map(P);
        out.push(`<path d="${pd(p2)}" fill="${d.fill ?? fill(p3, p2, cn, d.m)}"${d.op ? ` fill-opacity="${d.op}"` : ''}/>`);
      }
    }
  }

  function drawDome(o) {
    const { c, R, H, m } = o;
    const pts = [], samples = [];
    for (let i = 0; i <= 12; i++) for (let j = 0; j < 64; j++) {
      const t = (i / 12) * Math.PI / 2, ph = (j / 64) * 2 * Math.PI;
      const p = add(c, [R * Math.sin(t) * Math.cos(ph), H * Math.cos(t), R * Math.sin(t) * Math.sin(ph)]);
      const n = norm([Math.sin(t) * Math.cos(ph) / R, Math.cos(t) / H, Math.sin(t) * Math.sin(ph) / R]);
      const p2 = P(p);
      pts.push(p2);
      if (dot(n, sub(CAM, p)) > 0) samples.push({ p2, col: shade(p, n, m) });
    }
    const hl = simplify(hull2(pts), 0.35);
    let best = samples[0];
    for (const s of samples) if (lum(s.col) > lum(best.col)) best = s;
    const h2 = best.p2;
    const rmax = Math.max(...hl.map((q) => Math.hypot(q[0] - h2[0], q[1] - h2[1])));
    const bins = Array.from({ length: 8 }, () => [0, 0, 0, 0]);
    for (const s of samples) {
      const k = Math.min(7, Math.floor((Math.hypot(s.p2[0] - h2[0], s.p2[1] - h2[1]) / rmax) * 8));
      for (let i = 0; i < 3; i++) bins[k][i] += s.col[i];
      bins[k][3]++;
    }
    const st = [[0, toHex(best.col)]];
    bins.forEach((b, k) => { if (b[3]) st.push([(k + 0.5) / 8, toHex(b.slice(0, 3).map((x) => x / b[3]))]); });
    out.push(`<path d="${pd(hl)}" fill="${radG(h2, rmax, st)}"/>`);
    // seams (visible parts of latitude rings)
    for (const tt of o.seams ?? []) {
      const t = tt * Math.PI / 2;
      const seg = [];
      for (let j = 0; j <= 96; j++) {
        const ph = (j / 96) * 2 * Math.PI;
        const p = add(c, [R * Math.sin(t) * Math.cos(ph), H * Math.cos(t), R * Math.sin(t) * Math.sin(ph)]);
        const n = norm([Math.sin(t) * Math.cos(ph) / R, Math.cos(t) / H, Math.sin(t) * Math.sin(ph) / R]);
        seg.push(dot(n, sub(CAM, p)) > 0.02 * len(sub(CAM, p)) ? P(p) : null);
      }
      let d = '', run = [];
      const flush = () => { if (run.length > 1) d += pd(simplify(run, 0.3).length > 2 ? run.filter((_, i) => i % 3 === 0 || i === run.length - 1) : run, false); run = []; };
      for (const q of seg) { if (q) run.push(q); else flush(); }
      flush();
      if (d) out.push(`<path d="${d}" fill="none" stroke="#000" stroke-opacity=".45" stroke-width="1.6"/><path d="${d}" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width=".8" transform="translate(0 1.2)"/>`);
    }
    // rim light sheen
    const cx = hl.reduce((s, q) => s + q[0], 0) / hl.length;
    const xr = Math.max(...hl.map((q) => q[0])), yt = Math.min(...hl.map((q) => q[1]));
    out.push(`<path d="${pd(hl)}" fill="${linG([cx, (yt + h2[1]) / 2 + 40], [xr, yt], [[0.45, '#8fd0ff', 0], [1, '#8fd0ff', 0.4]])}"/>`);
  }

  // ---------- backdrop ----------
  const tint = cfg.tint ?? '#8fd0ff';
  const Tf = [T[0], 0, T[2]];
  const wh = norm([w[0], 0, w[2]]);
  // place the back wall so its base sits at y≈WY on screen
  const WY = cfg.wallY ?? 150;
  let lo = Rr * 1.3, hi = Rr * 60;
  for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (P(sub(Tf, mul(wh, mid)))[1] > WY) lo = mid; else hi = mid; }
  const Dw = lo;
  const wallBase = sub(Tf, mul(wh, Dw));
  const wy = P(wallBase)[1];
  const wallAt = (s, y) => add(add(wallBase, mul(u, s)), [0, y, 0]);

  const bg = [];
  bg.push(`<path d="M0 0H512V${f(wy)}H0Z" fill="${bbG([[0, '#07090c'], [1, cfg.wall ?? '#121921']], 'linearGradient', `x2="0" y2="1"`)}"/>`);
  bg.push(`<path d="M0 ${f(wy)}H512V512H0Z" fill="${bbG([[0, '#0c1116'], [0.45, cfg.floor ?? '#17202a'], [1, '#1d2732']])}"/>`);
  // wall panels, kick plate and LED strip
  const panel = Rr * 1.1, seams = [], seamsL = [];
  for (let k = -14; k <= 14; k++) {
    const s = (k + 0.31) * panel;
    const a = P(wallAt(s, 0)), b = P(wallAt(s, Rr * 9));
    if (Math.max(a[0], b[0]) < -5 || Math.min(a[0], b[0]) > 517) continue;
    seams.push(seg(a, b));
    seamsL.push(seg([a[0] + 1.2, a[1]], [b[0] + 1.2, b[1]]));
  }
  const kick = P(wallAt(0, Rr * 0.28))[1], led = P(wallAt(0, Rr * 0.9))[1];
  bg.push(`<path d="M0 ${f(kick)}H512V${f(wy)}H0Z" fill="#1a232d"/>`);
  bg.push(`<path d="${seams.join('')}" stroke="#05070a" stroke-width="1.6" stroke-opacity=".8"/><path d="${seamsL.join('')}" stroke="#33414f" stroke-width=".7" stroke-opacity=".45"/>`);
  bg.push(`<path d="M0 ${f(kick)}H512" stroke="#33414f" stroke-width="1" stroke-opacity=".7"/>`);
  const glowH = Math.max(14, (wy - led) * 0.9);
  bg.push(`<path d="M0 ${f(led - glowH)}H512V${f(led + glowH)}H0Z" fill="${bbG([[0, tint, 0], [0.5, tint, 0.16], [1, tint, 0]])}"/>`);
  bg.push(`<path d="M0 ${f(led)}H512" stroke="${tint}" stroke-width="1.6" stroke-opacity=".75"/>`);
  bg.push(`<path d="M0 ${f(wy)}H512" stroke="#000" stroke-width="2" stroke-opacity=".6"/>`);

  // spot pool on the floor
  const poolE = ell([T[0], 0, T[2]], [1, 0, 0], [0, 0, 1], Rr * 2.2);
  bg.push(`<path d="${ellPath(poolE)}" fill="${bbG([[0, '#8aa0b4', 0.5], [0.35, '#6f8396', 0.3], [0.7, tint, 0.07], [1, tint, 0]], 'radialGradient', '')}"/>`);

  // floor plate seams (perspective grid), clipped at the wall and near the camera
  const rot = (cfg.gridRot ?? 0) * D2R, gs = Rr * (cfg.grid ?? 1.35);
  const gu = [Math.cos(rot), 0, Math.sin(rot)], gv = [-Math.sin(rot), 0, Math.cos(rot)];
  const goff = [0.37, 0.61];
  const lines = [];
  const clipSeg = (p, q) => {
    // keep the part in front of the wall and well in front of the camera
    let t0 = 0, t1 = 1;
    const lim = (fa, fb) => { if (fa < 0 && fb < 0) return false; if (fa < 0) t0 = Math.max(t0, fa / (fa - fb)); else if (fb < 0) t1 = Math.min(t1, fa / (fa - fb)); return true; };
    const wall = (x) => dot(sub(x, Tf), wh) + Dw - 0.5;
    const near = (x) => depth(x) - D * 0.25;
    if (!lim(wall(p), wall(q)) || !lim(near(p), near(q)) || t0 >= t1) return null;
    const a = add(p, mul(sub(q, p), t0)), b = add(p, mul(sub(q, p), t1));
    // project and clip to the frame
    let A = P(a), B = P(b);
    let s0 = 0, s1 = 1;
    const dx = B[0] - A[0], dy = B[1] - A[1];
    for (const [pp, qq] of [[-dx, A[0] + 4], [dx, 516 - A[0]], [-dy, A[1] - wy], [dy, 516 - A[1]]]) {
      if (pp === 0) { if (qq < 0) return null; continue; }
      const r = qq / pp;
      if (pp < 0) s0 = Math.max(s0, r); else s1 = Math.min(s1, r);
    }
    if (s0 >= s1) return null;
    return [[A[0] + dx * s0, A[1] + dy * s0], [A[0] + dx * s1, A[1] + dy * s1]];
  };
  const ext = Rr * 40;
  for (const [dirA, dirB, off] of [[gu, gv, goff[0]], [gv, gu, goff[1]]]) {
    for (let k = -30; k <= 30; k++) {
      const base = add(Tf, mul(dirB, (k + off) * gs));
      const seg = clipSeg(add(base, mul(dirA, -ext)), add(base, mul(dirA, ext)));
      if (seg) lines.push(seg);
    }
  }
  const gl = lines.map(([a, b]) => seg(a, b)).join('');
  const glL = lines.map(([a, b]) => seg([a[0], a[1] + 1.3], [b[0], b[1] + 1.3])).join('');
  const gFadeD = linG([0, wy], [0, 512], [[0, '#020304', 0], [0.3, '#020304', 0.45], [1, '#020304', 0.85]]);
  const gFadeL = linG([0, wy], [0, 512], [[0, '#4a5d70', 0], [0.3, '#4a5d70', 0.25], [1, '#4a5d70', 0.5]]);
  bg.push(`<path d="${gl}" stroke="${gFadeD}" stroke-width="2.2"/><path d="${glL}" stroke="${gFadeL}" stroke-width=".8"/>`);

  // scuffs and tyre marks
  const scuffs = [];
  for (let i = 0; i < 5; i++) {
    const ang = rand() * 2 * Math.PI, rad = Rr * (1.1 + rand() * 2.2);
    const p0 = add(Tf, [Math.cos(ang) * rad, 0, Math.sin(ang) * rad]);
    const dirv = rand() * 2 * Math.PI, L = Rr * (1.2 + rand() * 1.6), bend = (rand() - 0.5) * L * 0.8;
    const dv = [Math.cos(dirv), 0, Math.sin(dirv)], nv = [-dv[2], 0, dv[0]];
    const p1 = add(add(p0, mul(dv, L / 2)), mul(nv, bend)), p2 = add(p0, mul(dv, L));
    const pts = [p0, p1, p2];
    if (pts.some((p) => dot(sub(p, Tf), wh) + Dw < 0 || depth(p) < D * 0.3)) continue;
    const [a, b, c] = pts.map(P);
    scuffs.push(`M${f(a[0])} ${f(a[1])}Q${f(b[0])} ${f(b[1])} ${f(c[0])} ${f(c[1])}`);
  }
  for (let i = 0; i < 9; i++) {
    const ang = rand() * 2 * Math.PI, rad = Rr * (0.9 + rand() * 2.6);
    const p0 = add(Tf, [Math.cos(ang) * rad, 0, Math.sin(ang) * rad]);
    const dv = rand() * 2 * Math.PI, L = Rr * (0.15 + rand() * 0.4);
    const p1 = add(p0, [Math.cos(dv) * L, 0, Math.sin(dv) * L]);
    if (dot(sub(p0, Tf), wh) + Dw < 0 || depth(p0) < D * 0.3) continue;
    const a = P(p0), b = P(p1);
    scuffs.push(seg(a, b));
  }
  if (scuffs.length) bg.push(`<path d="${scuffs.join('')}" fill="none" stroke="#a9bccd" stroke-opacity=".1" stroke-width="1.1" stroke-linecap="round"/>`);

  // contact shadow from the robot's ground footprint
  const foot = hull2(all3.map((p) => [p[0], p[2]]));
  const fc2 = [foot.reduce((s, p) => s + p[0], 0) / foot.length, foot.reduce((s, p) => s + p[1], 0) / foot.length];
  const kdir = norm([T[0] - KEY[0], 0, T[2] - KEY[2]]);
  const shadowPath = (k, shift) => pd(foot.map(([x, z]) => P([fc2[0] + (x - fc2[0]) * k + kdir[0] * shift, 0, fc2[1] + (z - fc2[1]) * k + kdir[2] * shift])));
  bg.push(`<path d="${shadowPath(1.3, Rr * 0.22)}" fill="#000" fill-opacity=".6" filter="url(#sb)"/>`);
  bg.push(`<path d="${shadowPath(0.94, Rr * 0.04)}" fill="#000" fill-opacity=".85" filter="url(#ss)"/>`);

  // ---------- robot ----------
  const order = objs.map((o) => ({ o, d: depth(o.center) + (o.zb ?? 0) })).sort((a, b) => b.d - a.d);
  // Silhouettes of convex parts, used to skip anything a nearer part fully covers.
  const ring = (o) => Array.from({ length: 16 }, (_, i) => [Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)]);
  for (const it of order) {
    const o = it.o;
    if (o.kind === 'poly') it.hull = hull2(o.faces.flatMap((fc) => fc.pts.map(P)));
    else if (o.kind === 'cyl') it.hull = hull2([-1, 1].flatMap((sg) => ring().map(([x, y]) => P(add(add(o.c, mul(o.a, sg * o.h)), add(mul(o.e1, x * o.r), mul(o.e2, y * o.r)))))));
  }
  const inside = (h, q) => h.length > 2 && h.every((a, i) => { const b = h[(i + 1) % h.length]; return (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) >= 1; });
  order.forEach((it, i) => { it.covered = (pts) => order.slice(i + 1).some((j) => j.hull && pts.every((q) => inside(j.hull, q))); });
  for (const it of order) {
    const o = it.o;
    culled = it.covered;
    if (o.kind === 'cyl' && it.hull && culled(it.hull)) continue;
    if (o.kind === 'poly') drawPoly(o);
    else if (o.kind === 'cyl') drawCyl(o);
    else if (o.kind === 'prism') drawPrism(o);
    else if (o.kind === 'dome') drawDome(o);
  }

  const vign = bbG([[0.5, '#000', 0], [1, '#000', 0.62]], 'radialGradient', 'cx=".5" cy=".48" r=".75"');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">` +
    `<style>.r,.k{fill:none;stroke-linecap:round}.r{stroke:#a9dcff;stroke-opacity:.75;stroke-width:1.3}.k{stroke:#fff;stroke-opacity:.22;stroke-width:.9}</style>` +
    `<defs><linearGradient id="u" gradientUnits="userSpaceOnUse"/><radialGradient id="v" gradientUnits="userSpaceOnUse"/>${defs.join('')}` +
    `<filter id="sb" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${f(Rr * sc / D * 0.09 + 4)}"/></filter>` +
    `<filter id="ss" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter>` +
    `<filter id="gr" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".85" numOctaves="2" seed="${cfg.seed % 97}"/><feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 -1.6 1.05"/></filter>` +
    `<radialGradient id="bg" fx=".35" fy=".3"><stop offset=".1" stop-color="#f2f6f9"/><stop offset="1" stop-color="#3e464e"/></radialGradient>` +
    `</defs>` +
    bg.join('') +
    `<g stroke-width=".6" stroke-linejoin="round">${groupBolts(out)}</g>` +
    `<rect width="512" height="512" filter="url(#gr)" opacity=".05"/>` +
    `<rect width="512" height="512" fill="${vign}"/>` +
    `</svg>\n`;
  return svg;
}

function groupBolts(parts) {
  let res = '', run = '';
  for (const p of parts) {
    if (p.startsWith('<circle')) { run += p; continue; }
    if (run) { res += `<g fill="url(#bg)" stroke="#000" stroke-opacity=".55" stroke-width=".7">${run}</g>`; run = ''; }
    res += p;
  }
  if (run) res += `<g fill="url(#bg)" stroke="#000" stroke-opacity=".55" stroke-width=".7">${run}</g>`;
  return res;
}

// ---------- the twelve robots ----------
const paint = (hex, ks = 0.32, sh = 26) => mat(hex, ks, sh);

function toothProfile(r, teeth, n = 44) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI;
    if (teeth.some((t) => { const d = ((a - t.at) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); return d < t.len; })) continue;
    pts.push([a, r]);
  }
  for (const t of teeth) pts.push([t.at, r], [t.at + 0.025, r + t.h], [t.at + t.len * 0.45, r + t.h * 0.85], [t.at + t.len, r]);
  return pts.map(([a, rr]) => [((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), rr]).sort((p, q) => p[0] - q[0]).map(([a, rr]) => [rr * Math.cos(a), rr * Math.sin(a)]);
}

const robots = [
  // 1. Wedge — safety orange
  {
    az: 34, el: 17, seed: 101, tint: '#ffb07a',
    build() {
      const O = paint('#ff6a13');
      const body = extX([[104, 3], [-72, 7], [-76, 50], [-38, 54]], -78, 78, O);
      const ramp = body.f.s[3], lid = body.f.s[2];
      dq(ramp, 0.86, 1, 0, 1, { m: STEEL });
      dq(ramp, 0.86, 0.875, 0, 1, HL(0.35));
      dq(ramp, 0, 0.86, 0.42, 0.46, { m: paint('#1b1c1f', 0.3) });
      dq(ramp, 0, 0.86, 0.54, 0.58, { m: paint('#1b1c1f', 0.3) });
      dq(ramp, 0.05, 0.8, 0.14, 0.2, HL(0.13));
      dq(ramp, 0.05, 0.8, 0.22, 0.24, HL(0.1));
      dq(lid, 0.12, 0.88, 0.08, 0.92, { m: BLACK });
      bolts(lid, corners(0.22, 0.13));
      bolts(ramp, [[0.93, 0.1], [0.93, 0.35], [0.93, 0.65], [0.93, 0.9]], 2.4);
      bolts3(body.f.R, [[78, 12, 90], [78, 12, -60], [78, 44, -62], [78, 40, -20]], 2.6);
      d3(body.f.R, [[78, 14, 30], [78, 14, -40], [78, 38, -40], [78, 30, 0]], { m: paint('#d9520b') });
      return [
        body,
        cylP([20, 54.5, -60], [20, 62, -60], 6, paint('#d01818', 0.4), { rings: [] }),
        wheel([88, 27, -44], 1, 27, 18, paint('#2b2e33', 0.5, 20)),
        wheel([-88, 27, -44], -1, 27, 18, paint('#2b2e33', 0.5, 20)),
      ];
    },
  },
  // 2. Drum spinner — cobalt blue
  {
    az: 32, el: 18, seed: 202, tint: '#7fb2ff',
    build() {
      const B = paint('#1f4fd1', 0.4, 30);
      const rail = (x0, x1) => {
        const o = extX([[-72, 6], [96, 10], [108, 34], [94, 60], [-72, 56]], x0, x1, B);
        bolts3(o.f.R, [[x1, 50, -60], [x1, 50, 10], [x1, 50, 70], [x1, 14, -60], [x1, 16, 70]], 2.6);
        return o;
      };
      const r1 = rail(58, 70), r2 = rail(-70, -58);
      r1.zb = -120; // the near rail covers the drum's end
      const lid = box(-58, 58, 44, 52, -72, 34, BLACK);
      bolts(lid.f.top, corners(0.1, 0.1));
      dq(lid.f.top, 0.2, 0.8, 0.3, 0.7, { m: paint('#163a9e', 0.3) });
      const core = box(-58, 58, 8, 44, -72, 36, INNER);
      const drumC = [0, 32, 74];
      const teeth = [];
      [[35, -42], [35, 10], [120, -16], [120, 36], [210, -42], [300, 10]].forEach(([deg, x], i) => {
        const a = deg * D2R, rd = [0, Math.sin(a), Math.cos(a)], td = [0, Math.cos(a), -Math.sin(a)];
        teeth.push(xf(box(x, x + 14, 22, 33, -7, 7, i % 2 ? DARKSTEEL : STEEL), frame(drumC, [1, 0, 0], rd, td)));
      });
      return [
        core, lid, r1, r2,
        cyl(drumC, [1, 0, 0], 25, 57, STEEL, { stops: 7 }),
        ...teeth,
        wheel([79, 24, -44], 1, 24, 16, paint('#e7ecf2', 0.5, 20), { zb: -200 }),
        wheel([79, 24, 6], 1, 24, 16, paint('#e7ecf2', 0.5, 20), { zb: -200 }),
        wheel([-79, 24, -44], -1, 24, 16, paint('#e7ecf2', 0.5, 20)),
        wheel([-79, 24, 6], -1, 24, 16, paint('#e7ecf2', 0.5, 20)),
      ];
    },
  },
  // 3. Vertical spinner — matte black with yellow hazard stripes
  {
    az: 38, el: 17, seed: 303, tint: '#ffd75e',
    build() {
      const K = mat('#232529', 0.12, 8), Y = paint('#ffc414', 0.35);
      const body = box(-62, 62, 6, 46, -80, 16, K);
      hazard(body.f.top, [0, 1, 0, 0.24], 7, { m: Y });
      hazard(body.f.right, [0.62, 1, 0.3, 0.75], 3, { m: Y });
      bolts(body.f.top, [[0.08, 0.4], [0.92, 0.4], [0.08, 0.92], [0.92, 0.92]]);
      dq(body.f.top, 0.2, 0.8, 0.42, 0.85, { m: mat('#191b1e', 0.1, 6) });
      const fork = (x0, x1) => {
        const o = extX([[-12, 8], [64, 8], [76, 32], [62, 72], [-12, 50]], x0, x1, Y);
        bolts3(o.f.R, [[x1, 18, 0], [x1, 40, 0], [x1, 58, 50]], 2.4);
        return o;
      };
      const prof = toothProfile(52, [{ at: 0.45, h: 13, len: 0.55 }, { at: 0.45 + Math.PI, h: 13, len: 0.55 }]);
      const disc = {
        kind: 'prism', c: [0, 58, 60], a: [1, 0, 0], e1: [0, 0, 1], e2: [0, 1, 0], prof, h: 4.5, m: STEEL,
        capDec: [
          { ring: 40, fill: '#000', op: '.12' },
          { ring: 15, m: K, off: 0.6 },
          { bolts: 6, k: 10, r: 1.8, off: 1 },
          { ring: 4, m: BRIGHT, off: 1.2 },
        ],
      };
      return [
        body, { ...fork(10, 18), zb: -80 }, fork(-18, -10), disc,
        cylP([-10, 58, 60], [10, 58, 60], 7, DARKSTEEL, { rings: [] }),
        wheel([73, 31, -42], 1, 31, 18, Y),
        wheel([-73, 31, -42], -1, 31, 18, Y),
      ];
    },
  },
  // 4. Horizontal bar spinner — olive drab
  {
    az: 30, el: 24, seed: 404, tint: '#c9e08f', fw: 0.82,
    build() {
      const G = paint('#5b6b2f', 0.28, 18);
      const body = extX([[66, 5], [-62, 6], [-64, 40], [48, 40]], -60, 60, G);
      dq(body.f.s[2], 0.08, 0.92, 0.1, 0.9, { m: paint('#465324', 0.25) });
      bolts(body.f.s[2], corners(0.12, 0.14));
      bolts3(body.f.R, [[60, 33, -50], [60, 33, 30], [60, 14, -50]], 2.4);
      const piv = [0, 0, 22], th = 24 * D2R;
      const spin = (o) => xf(o, (p) => add(rotY(sub(p, piv), th), piv));
      const bar = spin(box(-126, 126, 48, 57, 8, 36, STEEL));
      dq(bar.f.top, 0.05, 0.95, 0.62, 0.72, HL(0.22));
      const tipA = spin(box(102, 130, 45, 60, 2, 34, DARKSTEEL));
      const tipB = spin(box(-130, -102, 45, 60, 10, 42, DARKSTEEL));
      return [
        body, bar, tipA, tipB,
        cyl([0, 44, 22], [0, 1, 0], 17, 4, BLACK, { rings: [] }),
        cyl([0, 59.5, 22], [0, 1, 0], 12, 2.5, ALU, { rings: [{ k: 0.35, m: DARKSTEEL, off: 0.3 }], bolts: { n: 4, k: 0.68, r: 0.15, off: 0.4 }, zb: -40 }),
        wheel([69, 21, -38], 1, 21, 14, paint('#c2b37c', 0.4)),
        wheel([69, 21, 36], 1, 21, 14, paint('#c2b37c', 0.4)),
        wheel([-69, 21, -38], -1, 21, 14, paint('#c2b37c', 0.4)),
        wheel([-69, 21, 36], -1, 21, 14, paint('#c2b37c', 0.4)),
      ];
    },
  },
  // 5. Flipper — red
  {
    az: 34, el: 25, seed: 505, tint: '#ff8a7a',
    build() {
      const R = paint('#d3202a', 0.38, 30);
      const body = extX([[96, 3], [-80, 6], [-80, 46], [26, 46]], -74, 74, R);
      dq(body.f.s[3], 0.88, 1, 0, 1, { m: STEEL });
      bolts3(body.f.R, [[74, 14, 60], [74, 14, -60], [74, 38, -66]], 2.6);
      d3(body.f.R, [[74, 14, 40], [74, 14, -50], [74, 36, -50], [74, 36, 15]], { m: paint('#9e141c', 0.3) });
      const piv = [0, 49, -42], th = 9 * D2R;
      const up = (p) => add(rotX(p, th), piv);
      const plate = xf(box(-64, 64, 0, 5, 0, 142, R), up);
      dq(plate.f.top, 0, 1, 0, 0.08, { m: STEEL });
      dq(plate.f.top, 0.06, 0.94, 0.2, 0.88, { m: paint('#a8161e', 0.3) });
      dq(plate.f.top, 0.12, 0.17, 0.2, 0.88, HL(0.14));
      bolts(plate.f.top, [[0.08, 0.15], [0.92, 0.15], [0.08, 0.92], [0.92, 0.92], [0.5, 0.15]], 2.6);
      const ramTop = up([0, 0, 78]);
      return [
        body, plate,
        cylP([0, 46, 4], ramTop, 10, ALU, { rings: [], zb: 30 }),
        cyl(piv, [1, 0, 0], 6, 66, STEEL, { rings: [] }),
        wheel([82, 26, -48], 1, 26, 16, paint('#26282c', 0.5, 20)),
        wheel([-82, 26, -48], -1, 26, 16, paint('#26282c', 0.5, 20)),
      ];
    },
  },
  // 6. Hammer / axe — white with teal
  {
    az: 36, el: 16, seed: 606, tint: '#7ff0e0', cy: 258,
    build() {
      const W = paint('#eef2f4', 0.3, 24), Tl = paint('#11a7a0', 0.4, 28);
      const body = extX([[94, 3], [-80, 6], [-80, 50], [52, 50]], -66, 66, W);
      d3(body.f.R, [[66, 12, 40], [66, 12, -70], [66, 42, -70], [66, 42, 30]], { m: Tl });
      bolts3(body.f.R, [[66, 46, -74], [66, 46, 40], [66, 9, 80]], 2.4);
      dq(body.f.s[3], 0.86, 1, 0, 1, { m: STEEL });
      dq(body.f.s[2], 0.1, 0.9, 0.1, 0.9, { m: paint('#d5dbe0', 0.25) });
      bolts(body.f.s[2], corners(0.14, 0.12));
      const piv = [0, 70, -40], th = 64 * D2R;
      const arm = (o) => xf(o, (p) => add(rotX(p, th), piv));
      const beam = arm(box(-7, 7, -7, 7, -8, 124, Tl));
      const head = arm(box(-10, 10, -11, 11, 112, 140, W));
      const blade = arm(extX([[110, -6], [142, -6], [156, -50], [96, -50]], -3.5, 3.5, STEEL));
      d3(blade.f.R, [[3.5, -50, 96], [3.5, -50, 156], [3.5, -42, 153], [3.5, -42, 99]].map((p) => add(rotX([p[0], p[1], p[2]], th), piv)), { m: BRIGHT });
      return [
        body,
        box(14, 22, 50, 80, -54, -26, Tl), box(-22, -14, 50, 80, -54, -26, Tl),
        beam, head, blade,
        cyl(piv, [1, 0, 0], 7, 24, STEEL, { rings: [], zb: -10 }),
        wheel([75, 26, -48], 1, 26, 16, Tl),
        wheel([-75, 26, -48], -1, 26, 16, Tl),
      ];
    },
  },
  // 7. Full-body shell spinner — purple
  {
    az: 30, el: 19, seed: 707, tint: '#c59bff', fw: 0.76,
    build() {
      const Pu = mat('#6a2bd1', 0.55, 40);
      const yb = 7, R = 98;
      const teeth = [20, 200].map((deg) => {
        const a = deg * D2R, rd = [Math.cos(a), 0, Math.sin(a)], td = [-Math.sin(a), 0, Math.cos(a)];
        const t = box(R - 12, R + 11, yb + 1, yb + 19, -13, 13, STEEL);
        return xf(t, frame([0, 0, 0], rd, [0, 1, 0], td));
      });
      return [
        cyl([0, 3.5, 0], [0, 1, 0], 86, 3, BLACK, { rings: [] }),
        { kind: 'dome', c: [0, yb, 0], R, H: 50, m: Pu, seams: [0.55] },
        ...teeth,
        cyl([0, yb + 51, 0], [0, 1, 0], 17, 2.5, ALU, { rings: [{ k: 0.4, m: BLACK, off: 0.3 }], bolts: { n: 6, k: 0.72, r: 0.09, off: 0.3 }, zb: -200 }),
      ];
    },
  },
  // 8. Lifter — raw aluminium
  {
    az: -34, el: 18, seed: 808, tint: '#9fd8ff',
    build() {
      const body = box(-68, 68, 6, 50, -76, 34, ALU);
      dq(body.f.top, 0.1, 0.9, 0.12, 0.88, { m: mat('#2c3036', 0.3, 20) });
      dq(body.f.top, 0.04, 0.96, 0.03, 0.06, HL(0.3));
      bolts(body.f.top, corners(0.05, 0.05), 2.4);
      bolts(body.f.left, [[0.06, 0.85], [0.5, 0.85], [0.94, 0.85], [0.06, 0.15], [0.94, 0.15]], 2.4);
      dq(body.f.left, 0.1, 0.9, 0.35, 0.42, HL(0.18));
      const piv = [0, 6, 36], th = 11 * D2R;
      const lift = (o) => xf(o, (p) => add(rotX(p, th), piv));
      const plate = lift(box(-62, 62, 0, 40, 0, 6, mat('#a9b1b9', 0.6, 10, 0.5)));
      bolts(plate.f.front, [[0.1, 0.8], [0.9, 0.8], [0.5, 0.8]], 2.4);
      const tines = [-44, -6, 32].map((x) => lift(extX([[6, 0], [84, 0], [92, 3], [6, 12]], x, x + 12, STEEL)));
      const red = paint('#e0262c', 0.4);
      return [
        body, plate, ...tines,
        box(-50, -40, 40, 58, -6, 30, mat('#2c3036', 0.3, 20)), box(40, 50, 40, 58, -6, 30, mat('#2c3036', 0.3, 20)),
        cylP([-46, 52, -10], [-46, 30, 30], 5, ALU, { rings: [] }),
        cylP([46, 52, -10], [46, 30, 30], 5, ALU, { rings: [] }),
        wheel([77, 23, -50], 1, 23, 16, red), wheel([77, 23, 6], 1, 23, 16, red),
        wheel([-77, 23, -50], -1, 23, 16, red), wheel([-77, 23, 6], -1, 23, 16, red),
      ];
    },
  },
  // 9. Crusher — lime
  {
    az: 50, el: 17, seed: 909, tint: '#c8ff7a', cy: 262,
    build() {
      const L = paint('#8bd616', 0.35, 26);
      const body = box(-64, 64, 6, 56, -78, 40, L);
      dq(body.f.top, 0.1, 0.9, 0.5, 0.92, { m: paint('#1f2322', 0.3) });
      bolts(body.f.top, corners(0.06, 0.06));
      d3(body.f.right, [[64, 14, 30], [64, 14, -70], [64, 46, -70], [64, 46, 30]].map((p) => p), { m: paint('#6fae0e', 0.3) });
      bolts(body.f.right, [[0.05, 0.85], [0.95, 0.85], [0.05, 0.15], [0.95, 0.15]], 2.4);
      const scoop = extX([[40, 2], [112, 2], [112, 6], [40, 28]], -60, 60, STEEL);
      dq(scoop.f.s[2], 0, 1, 0, 1, { m: DARKSTEEL });
      const piv = [0, 68, 4], th = 22 * D2R;
      const jp = (p) => add(rotX(p, th), piv), jaw = (o) => xf(o, jp);
      const arm = jaw(extX([[-14, -11], [100, -11], [110, 0], [100, 13], [-14, 13]], -16, 16, L));
      const beak = jaw(extX([[72, -10], [110, -10], [94, -68]], -12, 12, STEEL));
      bolts(arm.f.s[4], [[0.1, 0.3], [0.1, 0.7], [0.6, 0.3], [0.6, 0.7]], 2.2);
      const ramEnd = jp([0, -9, 46]);
      return [
        body, scoop,
        box(16, 26, 56, 76, -8, 16, BLACK), box(-26, -16, 56, 76, -8, 16, BLACK),
        arm, beak,
        cylP([0, 57, -48], ramEnd, 8, BLACK, { rings: [], zb: 20 }),
        cyl(piv, [1, 0, 0], 6, 28, STEEL, { rings: [] }),
        wheel([73, 24, -52], 1, 24, 16, BLACK), wheel([73, 24, 14], 1, 24, 16, BLACK),
        wheel([-73, 24, -52], -1, 24, 16, BLACK), wheel([-73, 24, 14], -1, 24, 16, BLACK),
      ];
    },
  },
  // 10. Two-wheel pusher box — gunmetal with red
  {
    az: -32, el: 17, seed: 1010, tint: '#ff8f8f',
    build() {
      const G = mat('#4a515a', 0.5, 18, 0.35), R = paint('#d81f26', 0.4);
      const body = box(-56, 56, 8, 64, -56, 56, G);
      dq(body.f.top, 0.4, 0.6, 0, 1, { m: R });
      dq(body.f.top, 0.06, 0.12, 0.04, 0.96, HL(0.12));
      bolts(body.f.top, corners(0.07, 0.07));
      bolts(body.f.left, [[0.06, 0.88], [0.94, 0.88], [0.06, 0.12], [0.94, 0.12]], 2.4);
      bolts(body.f.front, [[0.1, 0.88], [0.9, 0.88]], 2.4);
      const plow = extX([[56, 10], [92, 2], [92, 6], [56, 50]], -60, 60, R);
      dq(plow.f.s[2], 0.0, 0.08, 0, 1, { m: STEEL });
      bolts(plow.f.s[2], [[0.5, 0.15], [0.5, 0.5], [0.5, 0.85]], 2.4);
      return [
        body, plow,
        box(-30, 30, 2, 8, -50, -30, BLACK),
        wheel([70, 38, -2], 1, 38, 24, R, { bolts: { n: 6, k: 0.45, r: 0.05, off: 1 } }),
        wheel([-70, 38, -2], -1, 38, 24, R, { bolts: { n: 6, k: 0.45, r: 0.05, off: 1 } }),
      ];
    },
  },
  // 11. Invertible sandwich box — yellow
  {
    az: 34, el: 21, seed: 1111, tint: '#ffe27a',
    build() {
      const Y = paint('#ffd21a', 0.38, 28);
      const top = box(-64, 64, 47, 52, -66, 66, Y), bot = box(-64, 64, 4, 9, -66, 66, Y);
      dq(top.f.top, 0.18, 0.82, 0.22, 0.78, { m: mat('#202226', 0.3, 20) });
      dq(top.f.top, 0.24, 0.76, 0.3, 0.34, HL(0.12));
      bolts(top.f.top, [...corners(0.06, 0.06), [0.5, 0.06], [0.5, 0.94]]);
      const posts = [[-58, -60], [58, -60], [58, 60], [-58, 60]].map(([x, z]) => cyl([x, 28, z], [0, 1, 0], 4, 19, ALU, { rings: [] }));
      const lip = extX([[66, 6], [98, 1], [98, 3], [66, 10]], -60, 60, STEEL);
      return [
        box(-58, 58, 9, 47, -60, 60, INNER),
        ...posts, bot, top, lip,
        wheel([75, 28, -40], 1, 28, 18, BLACK), wheel([75, 28, 40], 1, 28, 18, BLACK),
        wheel([-75, 28, -40], -1, 28, 18, BLACK), wheel([-75, 28, 40], -1, 28, 18, BLACK),
      ];
    },
  },
  // 12. Four-wheel rammer — copper
  {
    az: -36, el: 17, seed: 1212, tint: '#ffb27a',
    build() {
      const C = mat('#c47a43', 0.65, 16, 0.7), Cd = mat('#8a4f28', 0.5, 14, 0.6);
      const body = extX([[72, 10], [-72, 10], [-74, 52], [54, 58]], -60, 60, C);
      dq(body.f.s[3], 0.12, 0.88, 0.14, 0.86, { m: Cd });
      bolts(body.f.s[3], corners(0.06, 0.08));
      bolts3(body.f.L, [[-60, 46, 40], [-60, 46, -60], [-60, 18, 40], [-60, 18, -60]], 2.6);
      d3(body.f.L, [[-60, 20, 30], [-60, 20, -50], [-60, 44, -50], [-60, 44, 30]], { m: Cd });
      const ram = box(-64, 64, 12, 48, 72, 88, DARKSTEEL);
      bolts(ram.f.front, [[0.08, 0.8], [0.92, 0.8], [0.08, 0.2], [0.92, 0.2]], 2.4);
      const spikes = [-40, 0, 40].map((x) => pyramid([[x - 13, 17, 88], [x + 13, 17, 88], [x + 13, 43, 88], [x - 13, 43, 88]], [x, 30, 130], STEEL));
      return [
        body, ram, ...spikes,
        wheel([71, 28, -44], 1, 28, 20, Cd), wheel([71, 28, 40], 1, 28, 20, Cd),
        wheel([-71, 28, -44], -1, 28, 20, Cd), wheel([-71, 28, 40], -1, 28, 20, Cd),
      ];
    },
  },
];

mkdirSync(OUT, { recursive: true });
robots.forEach((cfg, i) => {
  const svg = render(cfg);
  writeFileSync(join(OUT, `${i + 1}.svg`), svg);
  console.log(`${i + 1}.svg  ${(svg.length / 1024).toFixed(1)} KB`);
});
