/**
 * d2-armor-proxy — Cloudflare Worker
 *
 * Rotte:
 *   GET/HEAD /proxy/<path-bungie>   reverse proxy con allowlist verso www.bungie.net
 *   GET      /sync/<code>           legge il backup (richiede X-Sync-Secret se il record è reclamato)
 *   POST     /sync/<code>           salva il backup (richiede X-Sync-Secret)
 *   DELETE   /sync/<code>           elimina il backup (richiede X-Sync-Secret)
 *
 * Modello di sync:
 *   - <code>   identificativo pubblico (può comparire negli screenshot)
 *   - <secret> chiave di 32 byte generata sul dispositivo; il Worker salva solo il suo SHA-256
 *   I record creati prima di questa versione non hanno secret ("legacy"): restano leggibili
 *   con il solo codice finché un client non li reclama con un POST che include il secret.
 *
 * Sicurezza:
 *  - la API key Bungie vive solo qui (secret BUNGIE_API_KEY), mai nel client
 *  - allowlist dei path proxati + niente traversal / URL assoluti
 *  - rate limit per IP (binding nativo se disponibile, altrimenti per isolate)
 *  - cache edge sui manifest (le richieste ripetute non consumano la quota Bungie)
 *  - CORS limitato alle origin consentite
 */

const PAGES_ORIGIN = 'https://tigredomino.github.io';

const PROXY_PREFIX = '/proxy/';
const SYNC_PREFIX = '/sync/';

// Unici path Bungie raggiungibili tramite il proxy.
const ALLOWED_PATHS = [
  'Platform/Destiny2/Manifest/',
  'common/destiny2_content/'
];

const CACHE_TTL_INDEX = 300;        // /Platform/Destiny2/Manifest/ (non content-hashed)
const CACHE_TTL_ASSET = 604800;     // common/destiny2_content/json/... (nomi hashati, immutabili)

const SYNC_MAX_BYTES = 256 * 1024;
const SYNC_DEFAULT_TTL_DAYS = 365;
const CODE_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_ARMOR_CATEGORIES = 200;
const MAX_WISHLIST_ENTRIES = 500;

// Formato chiavi in KV: dati in "checklist:<code>", hash del secret in "auth:<code>".
const DATA_PREFIX = 'checklist:';
const AUTH_PREFIX = 'auth:';

/* ------------------------------------------------------------------ helpers */

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const extra = String(env.EXTRA_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowed = new Set([PAGES_ORIGIN, ...extra]);

  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Secret',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  };
  if (origin && allowed.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

function reply(body, status, headers, contentType) {
  return new Response(body, {
    status,
    headers: { ...headers, 'Content-Type': contentType || 'text/plain; charset=utf-8' }
  });
}

const text = (body, status, headers) => reply(body, status, headers);
const json = (obj, status, headers) =>
  reply(JSON.stringify(obj), status, headers, 'application/json; charset=utf-8');

/* ------------------------------------------------------------ rate limiting */

// Fallback in-memory: vale per singolo isolate, ma non costa nulla ed evita
// raffiche. Se il binding "ratelimits" è configurato viene usato quello.
const buckets = new Map();

function memoryLimit(key, limit, periodMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + periodMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
  }
  return b.count <= limit;
}

async function allowRequest(env, key, limit, periodMs) {
  if (env.RATE_LIMITER && typeof env.RATE_LIMITER.limit === 'function') {
    try {
      const res = await env.RATE_LIMITER.limit({ key });
      if (res && res.success === false) return false;
      return true;
    } catch (e) {
      // binding mal configurato: non bloccare il traffico legittimo
    }
  }
  return memoryLimit(key, limit, periodMs);
}

const clientIp = (request) => request.headers.get('CF-Connecting-IP') || 'unknown';

/* -------------------------------------------------------------------- proxy */

function normalizePath(raw) {
  if (!raw) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';      // URL assoluto
  if (raw.includes('..') || raw.includes('//') || raw.includes('\\')) return '';
  if (!/^[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(raw)) return '';
  return raw.replace(/^\/+/, '');
}

async function handleProxy(request, env, url, headers, ctx) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'Method not allowed' }, 405, headers);
  }
  if (!(await allowRequest(env, 'p:' + clientIp(request), 240, 60000))) {
    return json({ error: 'Too many requests' }, 429, { ...headers, 'Retry-After': '60' });
  }

  const path = normalizePath(url.pathname.slice(PROXY_PREFIX.length));
  if (!path) return json({ error: 'Bad path' }, 400, headers);
  if (!ALLOWED_PATHS.some((p) => path.startsWith(p))) {
    return json({ error: 'Path not allowed' }, 403, headers);
  }
  if (!env.BUNGIE_API_KEY) return json({ error: 'Server not configured' }, 500, headers);

  const target = 'https://www.bungie.net/' + path + url.search;
  const cache = caches.default;
  const cacheKey = new Request(target, { method: 'GET' });
  const ttl = path.startsWith('common/destiny2_content/') ? CACHE_TTL_ASSET : CACHE_TTL_INDEX;

  const cached = await cache.match(cacheKey);
  if (cached) {
    const h = new Headers(cached.headers);
    for (const [k, v] of Object.entries(headers)) h.set(k, v);
    h.set('X-Proxy-Cache', 'HIT');
    return new Response(request.method === 'HEAD' ? null : cached.body, { status: cached.status, headers: h });
  }

  let upstream;
  try {
    upstream = await fetch(target, {
      method: 'GET',
      headers: { 'X-API-Key': env.BUNGIE_API_KEY, Accept: 'application/json' }
    });
  } catch (e) {
    return json({ error: 'Upstream unreachable' }, 502, headers);
  }

  const outHeaders = new Headers({
    'Content-Type': upstream.headers.get('Content-Type') || 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=' + ttl,
    'X-Proxy-Cache': 'MISS'
  });
  const len = upstream.headers.get('Content-Length');
  if (len) outHeaders.set('Content-Length', len);

  const out = new Response(upstream.body, { status: upstream.status, headers: outHeaders });
  if (upstream.ok && request.method === 'GET') {
    // clone() prima di restituire: il body in streaming non è rileggibile
    ctx.waitUntil(cache.put(cacheKey, out.clone()));
  }

  const finalHeaders = new Headers(out.headers);
  for (const [k, v] of Object.entries(headers)) finalHeaders.set(k, v);
  return new Response(out.body, { status: out.status, headers: finalHeaders });
}

/* --------------------------------------------------------------------- sync */

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (!Array.isArray(payload.armor) || payload.armor.length > MAX_ARMOR_CATEGORIES) return null;
  return {
    armor: payload.armor,
    wishlist: Array.isArray(payload.wishlist) ? payload.wishlist.slice(0, MAX_WISHLIST_ENTRIES) : [],
    bonusIcons:
      payload.bonusIcons && typeof payload.bonusIcons === 'object' && !Array.isArray(payload.bonusIcons)
        ? payload.bonusIcons
        : {}
  };
}

function storageOptions(env) {
  const days = Number(env.SYNC_TTL_DAYS || SYNC_DEFAULT_TTL_DAYS);
  return Number.isFinite(days) && days > 0 ? { expirationTtl: Math.round(days * 86400) } : {};
}

// Restituisce { ok, legacy, storedHash } in base alla chiave presente in KV.
async function checkAccess(env, code, providedSecret) {
  const storedHash = await env.SYNC_KV.get(AUTH_PREFIX + code);
  if (storedHash === null) return { ok: false, legacy: true, storedHash: null, providedHash: null };
  if (!SECRET_RE.test(providedSecret || '')) return { ok: false, legacy: false, storedHash };
  const providedHash = await sha256Hex(providedSecret);
  return { ok: safeEqual(providedHash, storedHash), legacy: false, storedHash, providedHash };
}

async function handleSync(request, env, url, headers) {
  let code;
  try {
    code = decodeURIComponent(url.pathname.slice(SYNC_PREFIX.length));
  } catch (e) {
    return text('Invalid sync code', 400, headers);
  }
  if (!CODE_RE.test(code)) return text('Invalid sync code', 400, headers);
  if (!env.SYNC_KV) return text('Sync storage not configured', 500, headers);

  const ip = clientIp(request);
  const secret = request.headers.get('X-Sync-Secret') || '';
  const unauthorized = () => text('Unauthorized', 401, headers);
  const tooMany = () => text('Too many requests', 429, { ...headers, 'Retry-After': '60' });

  if (request.method === 'GET') {
    if (!(await allowRequest(env, 'sg:' + ip, 120, 60000))) return tooMany();
    const access = await checkAccess(env, code, secret);
    if (!access.ok && !access.legacy) return unauthorized();
    const body = await env.SYNC_KV.get(DATA_PREFIX + code);
    if (body === null) return text('Not found', 404, headers);
    return new Response(body, {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }

  if (request.method === 'POST') {
    if (!(await allowRequest(env, 'sw:' + ip, 60, 60000))) return tooMany();

    const declared = Number(request.headers.get('Content-Length') || 0);
    if (declared > SYNC_MAX_BYTES) return text('Payload too large', 413, headers);
    const body = await request.text();
    if (body.length > SYNC_MAX_BYTES) return text('Payload too large', 413, headers);

    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      return text('Invalid JSON', 400, headers);
    }
    const clean = sanitizePayload(parsed);
    if (!clean) return text('Invalid payload', 400, headers);

    const access = await checkAccess(env, code, secret);
    const exists = (await env.SYNC_KV.get(DATA_PREFIX + code)) !== null;

    if (access.legacy) {
      if (SECRET_RE.test(secret)) {
        // reclamo del record legacy: da qui in poi serve il secret
        await env.SYNC_KV.put(AUTH_PREFIX + code, await sha256Hex(secret), storageOptions(env));
      } else if (!exists) {
        // creazione di un nuovo record: serve il secret
        return unauthorized();
      }
      // record legacy senza secret: scrittura consentita solo per i client precedenti
    } else if (!access.ok) {
      return unauthorized();
    }

    await env.SYNC_KV.put(DATA_PREFIX + code, JSON.stringify(clean), storageOptions(env));
    return text('Saved', 200, headers);
  }

  if (request.method === 'DELETE') {
    if (!(await allowRequest(env, 'sd:' + ip, 30, 60000))) return tooMany();
    const access = await checkAccess(env, code, secret);
    if (!access.ok) return unauthorized();
    await env.SYNC_KV.delete(DATA_PREFIX + code);
    await env.SYNC_KV.delete(AUTH_PREFIX + code);
    return text('Deleted', 200, headers);
  }

  return text('Method not allowed', 405, headers);
}

/* ------------------------------------------------------------------ router */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const headers = corsHeaders(request, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    if (url.pathname.startsWith(PROXY_PREFIX)) {
      return handleProxy(request, env, url, headers, ctx);
    }
    if (url.pathname.startsWith(SYNC_PREFIX)) {
      return handleSync(request, env, url, headers);
    }
    return json({ error: 'Not found' }, 404, headers);
  }
};
