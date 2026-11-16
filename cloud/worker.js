// Forge on Cloudflare. One Worker per person, on their own account:
//   - the app's files come from ./public (Cloudflare serves them before this code runs)
//   - data lives in that person's Neon database, one row per task / note / project
//   - images and files live in their Cloudinary account, private, and are served only through this Worker
//   - their keys, login lockouts and nightly backups live in Workers KV (env.KV), created on deploy
//   - NVIDIA (coach) and Groq (voice) keys are read here and never sent to the browser
// Login: a passphrase set as a Worker secret (PASSPHRASE), then a signed cookie for a year.
import { neon, neonConfig } from '@neondatabase/serverless';
import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import { handleMcp, createToken, listTokens, revokeToken, resolvePersonalToken, consentPage } from './mcp.js';
import { listActivity, undoActivity } from './tools.js';

const DEFAULT_AI = { baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'nvidia/nemotron-3-ultra-550b-a55b' };
const GROQ = 'https://api.groq.com/openai/v1';
// Tried in order when the chosen NVIDIA model is down or slow. All of these returned real tool calls when probed (Nov 2026).
const NVIDIA_FALLBACKS = ['nvidia/nemotron-3-ultra-550b-a55b', 'mistralai/mistral-large-4-1t-a52b', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'nvidia/nemotron-3.5-bolt-e4b', 'stepfun-ai/step-5-preview', 'minimaxai/minimax-m3.1-flash'];
const CFG_KEY = 'config';
const COOKIE = 'forge_session';
const YEAR = 365 * 24 * 3600;
const KINDS = new Set(['projects', 'tasks', 'board', 'sessions', 'xpEvents', 'reminders', 'memory', 'chat', 'kv']);
const PAGE = 2000;

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml',
  pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', txt: 'text/plain; charset=utf-8',
};
const EXT_BY_TYPE = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg',
  'application/pdf': '.pdf', 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'text/plain': '.txt',
};
// Files that may be shown inline; everything else downloads. All files are sandboxed.
const INLINE_OK = /^(image|video|audio)\/|^application\/pdf|^text\/plain/;

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});
const enc = new TextEncoder();
const hex = n => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const sha256 = async s => new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));

/* ---------- the private settings, in Workers KV ---------- */
let cfgCache = null, cfgAt = 0;
async function readCfg(env, fresh = false) {
  if (!env.KV) return { ...DEFAULT_AI };
  if (!fresh && cfgCache && Date.now() - cfgAt < 5000) return cfgCache;
  cfgCache = { ...DEFAULT_AI, ...((await env.KV.get(CFG_KEY, 'json').catch(() => null)) || {}) }; cfgAt = Date.now();
  return cfgCache;
}
async function writeCfg(env, patch) {
  if (!env.KV) throw new Error('This Forge has no KV storage linked. Deploy again so Cloudflare creates it.');
  const c = { ...(await readCfg(env, true)), ...patch };
  await env.KV.put(CFG_KEY, JSON.stringify(c));
  cfgCache = c; cfgAt = Date.now();
  return c;
}
const setupState = (env, c) => ({ kv: !!env.KV, db: !!c.neonUrl, images: !!c.cloudinary, coach: !!c.apiKey, voice: !!c.groqKey, done: !!c.setupDone && !!c.neonUrl && !!c.cloudinary && !!env.KV });

/* ---------- login ---------- */
const hmacKey = env => crypto.subtle.importKey('raw', enc.encode('forge-session:' + env.PASSPHRASE), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
async function makeToken(env) {
  const exp = String(Math.floor(Date.now() / 1000) + YEAR);
  return exp + '.' + b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(exp)));
}
async function isAuthed(req, env) {
  if (!env.PASSPHRASE) return false;
  const t = (req.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`))?.[1];
  const m = /^(\d{9,12})\.([\w-]{20,})$/.exec(t || '');
  if (!m || Number(m[1]) < Date.now() / 1000) return false;
  try { return await crypto.subtle.verify('HMAC', await hmacKey(env), unb64u(m[2]), enc.encode(m[1])); } catch { return false; }
}
const cookie = (req, value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${new URL(req.url).protocol === 'https:' ? '; Secure' : ''}`;

// 5 wrong passphrases from one address lock it out for 15 minutes.
async function loginGate(env, ip) {
  if (!env.KV) return { key: null, rec: { n: 0, until: 0 } };
  const key = 'login:' + b64u(await sha256(ip)).slice(0, 22);
  return { key, rec: (await env.KV.get(key, 'json').catch(() => null)) || { n: 0, until: 0 } };
}
// Checks a passphrase with the lockout. Used by the app's login and by the AI sign-in page.
async function checkPassphrase(req, env, pass) {
  if (!env.PASSPHRASE) return { status: 500, error: 'This Forge has no passphrase yet. Set the PASSPHRASE secret in Cloudflare (see the README).' };
  const { key, rec } = await loginGate(env, req.headers.get('CF-Connecting-IP') || 'local');
  if (rec.until > Date.now()) return { status: 429, error: `Too many wrong tries. Try again in ${Math.ceil((rec.until - Date.now()) / 60000)} min.` };
  const ok = crypto.subtle.timingSafeEqual(await sha256(String(pass || '')), await sha256(env.PASSPHRASE));
  if (!ok) {
    rec.n = (rec.n || 0) + 1;
    if (rec.n >= 5) { rec.n = 0; rec.until = Date.now() + 15 * 60000; }
    if (key) await env.KV.put(key, JSON.stringify(rec), { expirationTtl: 3600 });
    return { status: 401, error: rec.until > Date.now() ? 'Too many wrong tries. Locked for 15 minutes.' : "That passphrase isn't right." };
  }
  if (key && (rec.n || rec.until)) await env.KV.delete(key);
  return { ok: true };
}
async function login(req, env) {
  const body = await req.json().catch(() => ({}));
  const r = await checkPassphrase(req, env, body.passphrase);
  if (!r.ok) return json(r.status, { error: r.error });
  return json(200, { ok: true }, { 'Set-Cookie': cookie(req, await makeToken(env), YEAR) });
}

/* ---------- the database ---------- */
// NEON_DEV_PROXY is for local development only (see tools/neon-dev-proxy.js); deployed Forge talks to Neon directly.
function db(env, url) {
  // local development: refuse any database except the dev one, so tests can never touch real data
  if (env.DEV_DATABASE_NAME && new URL(url).pathname.slice(1) !== env.DEV_DATABASE_NAME) throw new Error(`Local dev only uses the ${env.DEV_DATABASE_NAME} database. Point setup at it.`);
  if (env.NEON_DEV_PROXY) neonConfig.fetchEndpoint = host => env.NEON_DEV_PROXY + '?host=' + encodeURIComponent(host);
  return neon(url);
}
async function ensureSchema(sql) {
  await sql.query('create sequence if not exists forge_seq');
  await sql.query(`create table if not exists items (
    kind text not null, id text not null, data jsonb, updated_at bigint not null default 0,
    deleted boolean not null default false, seq bigint not null default nextval('forge_seq'), primary key (kind, id))`);
  await sql.query('create index if not exists items_seq on items (seq)');
}
function dbError(e) {
  const m = String(e?.message || e);
  if (/password authentication|authentication failed|role .* does not exist/i.test(m)) return 'Neon refused the password in that string. Copy it again from Neon → Connect.';
  if (/does not exist/i.test(m) && /database/i.test(m)) return 'That database name does not exist in your Neon project.';
  if (/fetch failed|ENOTFOUND|getaddrinfo|network|connect/i.test(m)) return "Couldn't reach that database. Check the host part of the string.";
  return 'Database error: ' + m.slice(0, 200);
}
// Apply a device's changes (newer edit wins, item by item), then hand back everything changed since its cursor.
async function sync(req, env) {
  const c = await readCfg(env);
  if (!c.neonUrl) return json(409, { error: 'No database connected yet.', setup: true });
  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.changes || [])) return json(400, { error: 'Bad sync request.' });
  const cursor = Math.max(0, Number(body.cursor) || 0);
  const latest = new Map();
  for (const ch of (body.changes || []).slice(0, 5000)) {
    if (!ch || !KINDS.has(ch.kind) || typeof ch.id !== 'string' || !ch.id || ch.id.length > 120) continue;
    // a device whose clock runs ahead must not win every future conflict
    const u = Math.min(Math.floor(Number(ch.u) || 0), Date.now() + 60000), del = !!ch.del;
    if (!del && (typeof ch.data !== 'object' || ch.data === null)) continue;
    const k = ch.kind + '\u0000' + ch.id, prev = latest.get(k);
    if (!prev || u >= prev.u) latest.set(k, { kind: ch.kind, id: ch.id, data: del ? null : ch.data, u, del });
  }
  const sql = db(env, c.neonUrl);
  try {
    let lost = [];
    if (latest.size) {
      const wrote = await sql.query(`insert into items (kind, id, data, updated_at, deleted)
        select kind, id, data, u, del from jsonb_to_recordset($1::jsonb) as x(kind text, id text, data jsonb, u bigint, del boolean)
        on conflict (kind, id) do update set data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, seq = nextval('forge_seq')
        where excluded.updated_at >= items.updated_at returning kind, id`, [JSON.stringify([...latest.values()])]);
      const ok = new Set(wrote.map(r => r.kind + '\u0000' + r.id));
      // Changes refused because the cloud already has a newer edit: send that edit back so the device takes it.
      const refused = [...latest.values()].filter(ch => !ok.has(ch.kind + '\u0000' + ch.id)).map(({ kind, id }) => ({ kind, id }));
      if (refused.length) lost = await sql.query(`select i.kind, i.id, i.data, i.updated_at as u, i.deleted as del from items i
        join jsonb_to_recordset($1::jsonb) as x(kind text, id text) on i.kind = x.kind and i.id = x.id`, [JSON.stringify(refused)]);
    }
    const rows = await sql.query('select kind, id, data, updated_at as u, deleted as del, seq from items where seq > $1 order by seq limit ' + PAGE, [cursor]);
    const out = [...lost, ...rows].map(r => ({ kind: r.kind, id: r.id, data: r.del ? null : r.data, u: Number(r.u), del: r.del }));
    return json(200, { rows: out, cursor: rows.length ? Number(rows[rows.length - 1].seq) : cursor, more: rows.length === PAGE });
  } catch (e) {
    if (/relation "items" does not exist/i.test(String(e?.message))) { await ensureSchema(sql); return json(503, { error: 'Database was just set up. Try again.' }); }
    return json(502, { error: dbError(e) });
  }
}

/* ---------- setup: each step tests before it saves ---------- */
async function setup(step, req, env) {
  const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
  if (!env.KV) return json(500, { error: 'This Forge has no KV storage linked, so it cannot keep your settings. Deploy it again so Cloudflare creates it.' });
  if (step === 'images') {
    const raw = String(body.cloudinary || '').trim(), c = raw ? parseCloudinary(raw) : (await readCfg(env)).cloudinary;
    if (!c) return json(400, { error: raw ? "That doesn't look like Cloudinary details. Copy the line that starts with cloudinary:// from Cloudinary → Settings → API Keys." : 'Paste your Cloudinary details first.' });
    try {
      // a 1×1 test image: upload it privately, read it back through a signed link, delete it
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), ch => ch.charCodeAt(0));
      const up = await cldUpload(c, png, 'image/png', 'test.png', 'image', 'forge/_setup-test-' + hex(4));
      const back = await fetch(await cldUrl(c, 'image', up.version, up.public_id + '.' + up.format));
      await cldDestroy(c, 'image', up.public_id).catch(() => { });
      if (!back.ok) throw new Error(`uploaded, but could not read it back (${back.status})`);
      if (raw) await writeCfg(env, { cloudinary: c });
      return json(200, { ok: true, cloud: c.cloud });
    } catch (e) { return json(400, { error: cldError(e) }); }
  }
  if (step === 'db') {
    const url = String(body.url || '').trim();
    if (!url) { const c = await readCfg(env); if (!c.neonUrl) return json(400, { error: 'Paste your Neon connection string first.' }); }
    const target = url || (await readCfg(env)).neonUrl;
    if (!/^postgres(ql)?:\/\/[^\s@]+@[^\s/]+\/\S+$/.test(target)) return json(400, { error: "That isn't a connection string. It starts with postgresql:// — copy it from Neon → Connect." });
    try {
      const sql = db(env, target);
      await ensureSchema(sql);
      const [{ n }] = await sql.query('select count(*)::int as n from items where not deleted');
      if (url) await writeCfg(env, { neonUrl: url });
      return json(200, { ok: true, items: n });
    } catch (e) { return json(400, { error: dbError(e) }); }
  }
  if (step === 'coach') {
    const c = await readCfg(env);
    const key = String(body.apiKey || '').trim() || c.apiKey, baseUrl = /^https?:\/\//.test(body.baseUrl || '') ? body.baseUrl.trim() : c.baseUrl;
    if (!key) return json(400, { error: 'Paste your NVIDIA key first. It starts with nvapi-' });
    try {
      const r = await fetch(baseUrl.replace(/\/+$/, '') + '/models', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) });
      if (r.status === 401 || r.status === 403) return json(400, { error: 'NVIDIA refused that key. Make a new one at build.nvidia.com and paste it again.' });
      if (!r.ok) return json(502, { error: `NVIDIA answered ${r.status}. Try again in a minute.` });
      const models = ((await r.json()).data || []).map(m => m.id).filter(Boolean).sort();
      // The model list answers any key, so ask for one token to prove this key is accepted.
      const probe = models.includes('nvidia/nemotron-3.5-bolt-e4b') ? 'nvidia/nemotron-3.5-bolt-e4b' : (body.model || c.model);
      const t = await fetch(baseUrl.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify({ model: probe, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }), signal: AbortSignal.timeout(20000),
      }).catch(() => null);
      if (t && (t.status === 401 || t.status === 403)) return json(400, { error: 'NVIDIA refused that key. Make a new one at build.nvidia.com and paste it again.' });
      const patch = { apiKey: key, baseUrl };
      if (typeof body.model === 'string' && body.model.trim()) patch.model = body.model.trim();
      await writeCfg(env, patch);
      return json(200, { ok: true, models: models.length });
    } catch { return json(502, { error: "Couldn't reach NVIDIA. Check your connection and try again." }); }
  }
  if (step === 'voice') {
    const c = await readCfg(env), key = String(body.groqKey || '').trim() || c.groqKey;
    if (!key) return json(400, { error: 'Paste your Groq key first. It starts with gsk_' });
    try {
      const r = await fetch(GROQ + '/models', { headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(15000) });
      if (r.status === 401 || r.status === 403) return json(400, { error: 'Groq refused that key. Make a new one at console.groq.com/keys.' });
      if (!r.ok) return json(502, { error: `Groq answered ${r.status}. Try again in a minute.` });
      const ids = ((await r.json()).data || []).map(m => m.id);
      if (!ids.some(id => /whisper/.test(id))) return json(400, { error: "That Groq key works, but it can't use Whisper." });
      await writeCfg(env, { groqKey: key });
      return json(200, { ok: true });
    } catch { return json(502, { error: "Couldn't reach Groq. Check your connection and try again." }); }
  }
  if (step === 'remove') {
    const what = body.what;
    if (what === 'coach') await writeCfg(env, { apiKey: '' });
    else if (what === 'voice') await writeCfg(env, { groqKey: '' });
    else return json(400, { error: 'Only the coach and voice keys can be removed.' });
    return json(200, { ok: true, setup: setupState(env, await readCfg(env)) });
  }
  if (step === 'done') {
    const c = await readCfg(env, true);
    if (!c.neonUrl) return json(400, { error: 'Connect the database first.' });
    await writeCfg(env, { setupDone: true });
    return json(200, { ok: true });
  }
  return json(404, { error: 'Unknown setup step.' });
}

/* ---------- link previews for the board ---------- */
const PRIVATE_HOST = /^(localhost|.*\.localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|\[?f[cd])/i;
async function readLimited(r, limit) {
  const reader = r.body.getReader(), dec = new TextDecoder(); let size = 0, out = '';
  while (size < limit) { const { done, value } = await reader.read(); if (done) break; size += value.length; out += dec.decode(value, { stream: true }); }
  reader.cancel().catch(() => { });
  return out;
}
const decodeEntities = s => s.replace(/&(#x?[\da-f]+|amp|quot|apos|lt|gt|nbsp);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[k];
}).trim();
const OEMBED = [
  [/(^|\.)youtube\.com$|^youtu\.be$/, 'https://www.youtube.com/oembed?format=json&url='],
  [/(^|\.)pinterest\.[a-z.]+$|^pin\.it$/, 'https://www.pinterest.com/oembed.json?url='],
  [/(^|\.)vimeo\.com$/, 'https://vimeo.com/api/oembed.json?url='],
  [/^open\.spotify\.com$/, 'https://open.spotify.com/oembed?url='],
];
async function oembed(u) {
  const hit = OEMBED.find(([re]) => re.test(u.hostname)); if (!hit) return null;
  try {
    const r = await fetch(hit[1] + encodeURIComponent(u.href), { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j = await r.json();
    const title = (j.title || '').trim() || (j.author_name ? 'Pin by ' + j.author_name : '');
    return { title: title.slice(0, 200), image: (j.thumbnail_url || '').replace('/236x/', '/564x/'), desc: '', site: j.provider_name || '' };
  } catch { return null; }
}
async function linkPreview(target) {
  let u; try { u = new URL(target); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || PRIVATE_HOST.test(u.hostname)) return null;
  const oe = await oembed(u);
  if (oe && (oe.title || oe.image)) return oe;
  const r = await fetch(u, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36', Accept: 'text/html,*/*' },
    redirect: 'follow', signal: AbortSignal.timeout(8000),
  });
  const ct = r.headers.get('content-type') || '';
  if (ct.startsWith('image/')) return { image: r.url };
  if (!ct.includes('html')) return {};
  const html = await readLimited(r, 2e6), meta = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const attrs = {}; for (const [, k, , a, b] of tag.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[k.toLowerCase()] = a ?? b;
    const key = (attrs.property || attrs.name || '').toLowerCase();
    if (key && attrs.content && !meta[key]) meta[key] = decodeEntities(attrs.content);
  }
  const title = meta['og:title'] || meta['twitter:title'] || decodeEntities((html.match(/<title[^>]*>([^<]*)/i) || [])[1] || '');
  let image = meta['og:image'] || meta['og:image:url'] || meta['twitter:image'] || meta['twitter:image:src'] || '';
  try { if (image) image = new URL(image, r.url).href; } catch { image = ''; }
  return { title: title.slice(0, 200), image, desc: (meta['og:description'] || meta.description || '').slice(0, 300), site: meta['og:site_name'] || '' };
}

/* ---------- coach and voice ---------- */
async function chat(req, env) {
  const cfg = await readCfg(env);
  if (!cfg.apiKey) return json(400, { error: 'No coach key yet. Add a free NVIDIA key in Settings → Connections.' });
  const body = await req.json().catch(() => ({}));
  const nvidia = /integrate\.api\.nvidia\.com/.test(cfg.baseUrl);
  const models = [cfg.model, ...(nvidia ? NVIDIA_FALLBACKS : [])].filter((m, i, a) => m && a.indexOf(m) === i);
  const started = Date.now(); let lastErr = '', retried = false;
  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi], left = 110000 - (Date.now() - started);
    if (left < 5000) break;
    let tools = Array.isArray(body.tools) && body.tools.length ? body.tools : null, toolsOff = false, r = null, text = '', data = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const payload = { model, messages: body.messages, stream: false, temperature: tools ? 0.3 : (body.temperature ?? 0.6), max_tokens: Math.max(700, body.max_tokens ?? 900) };
      if (tools) Object.assign(payload, { tools, tool_choice: 'auto' });
      // Nemotron thinks before choosing a tool; once a tool has run, wording the reply needs no thinking.
      const afterTool = body.messages?.[body.messages.length - 1]?.role === 'tool';
      if (tools && afterTool && /nemotron/i.test(model)) payload.chat_template_kwargs = { enable_thinking: false };
      try {
        r = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
          body: JSON.stringify(payload), signal: AbortSignal.timeout(Math.min(35000, left)),
        });
        text = await r.text();
      } catch { r = null; break; }
      try { data = JSON.parse(text); } catch { data = null; }
      const msg = String(data?.error?.message || data?.detail || text || '');
      if (tools && r.status === 400 && /tool|function/i.test(msg)) { tools = null; toolsOff = true; continue; }
      break;
    }
    if (!r) { lastErr = `${model} did not answer in time`; continue; }
    if (r.status === 401 || r.status === 403) return json(502, { error: `Your coach key was refused (${r.status}). Paste a fresh key in Settings → Connections.` });
    if (!r.ok) { lastErr = `${model} returned ${r.status}: ${data?.error?.message || data?.detail || data?.title || text.slice(0, 120)}`; continue; }
    const m = data?.choices?.[0]?.message || {};
    const content = (m.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    const tool_calls = Array.isArray(m.tool_calls) && m.tool_calls.length
      ? m.tool_calls.filter(c => c?.function?.name).map((c, i) => ({ id: c.id || `call_${Date.now()}_${i}`, type: 'function', function: { name: c.function.name, arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments || {}) } }))
      : null;
    if (!content && !tool_calls) {
      lastErr = `${model} sent an empty reply`;
      if (!retried) { retried = true; models.splice(mi + 1, 0, model); } // one more try on the same model first
      continue;
    }
    return json(200, { content, tool_calls, toolsOff, model });
  }
  return json(502, { error: `No free model answered right now (${lastErr || 'timed out'}). Try again in a minute, or pick another model in Settings → Connections.` });
}

async function transcribe(req, env) {
  const cfg = await readCfg(env);
  if (!cfg.groqKey) return json(400, { error: 'Voice needs a Groq key. Add one in Settings → Connections.' });
  const audio = await req.arrayBuffer();
  if (audio.byteLength > 10e6) return json(413, { error: 'That recording is too long.' });
  if (audio.byteLength < 1200) return json(400, { error: "I didn't catch anything. Try again." });
  const type = String(req.headers.get('content-type') || 'audio/webm').split(';')[0];
  const fd = new FormData();
  fd.append('file', new Blob([audio], { type }), 'speech.' + (type.split('/')[1] || 'webm').replace('x-', '').replace('mpeg', 'mp3').replace(/^mp4$/, 'm4a'));
  fd.append('model', 'whisper-large-v3-turbo');
  fd.append('temperature', '0');
  fd.append('response_format', 'json');
  // English only (left to guess, Whisper turns a quiet clip into another language); no prompt (it gets read back on unclear audio).
  fd.append('language', 'en');
  try {
    const r = await fetch(GROQ + '/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.groqKey }, body: fd, signal: AbortSignal.timeout(45000) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) return json(502, { error: 'Groq refused the voice key. Paste a fresh one in Settings → Connections.' });
    if (r.status === 429) return json(429, { error: 'Voice limit reached for now. Type instead, or try again in a minute.' });
    if (!r.ok) return json(502, { error: 'Voice service error: ' + (j?.error?.message || r.status) });
    const text = String(j.text || '').trim();
    const filler = /^(?:[\s.,!?…-]*|(?:thanks?(?: you)?(?: (?:so|very) much)?(?: for watching| for listening)?|you|bye(?: bye)?|okay|ok|so|um+|uh+|hmm+|the end|subtitles by.*|please subscribe.*)[.!?…]*)$/i;
    if (!text || !/[a-z0-9]/i.test(text) || filler.test(text)) return json(422, { error: "I didn't catch that. Try again, a little closer to the mic." });
    return json(200, { text });
  } catch { return json(502, { error: 'The voice service did not answer in time.' }); }
}

/* ---------- files: private in Cloudinary, served only through this Worker ---------- */
// Accepts the "API environment variable" line, or the three values as Cloudinary lists them.
function parseCloudinary(s) {
  const m = /cloudinary:\/\/(\d{6,}):([\w-]{10,})@([\w-]+)/.exec(s);
  if (m) return { key: m[1], secret: m[2], cloud: m[3] };
  const cloud = /cloud\s*name\s*[:=]?\s*([\w-]+)/i.exec(s)?.[1], key = /api\s*key\s*[:=]?\s*(\d{6,})/i.exec(s)?.[1], secret = /api\s*secret\s*[:=]?\s*([\w-]{10,})/i.exec(s)?.[1];
  return cloud && key && secret ? { cloud, key, secret } : null;
}
const sha1 = async s => new Uint8Array(await crypto.subtle.digest('SHA-1', enc.encode(s)));
const cldSign = async (c, params) => [...await sha1(Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&') + c.secret)].map(b => b.toString(16).padStart(2, '0')).join('');
// A signed delivery link for a private ("authenticated") file. Only this Worker can make one.
async function cldUrl(c, rt, version, path) {
  const p = `v${version}/${path}`;
  return `https://res.cloudinary.com/${c.cloud}/${rt}/authenticated/s--${b64u(await sha1(p + c.secret)).slice(0, 8)}--/${p}`;
}
async function cldCall(c, rt, action, params, file) {
  const fd = new FormData(), all = { ...params, timestamp: Math.floor(Date.now() / 1000) };
  if (file) fd.append('file', file.blob, file.name);
  for (const [k, v] of Object.entries(all)) fd.append(k, String(v));
  fd.append('api_key', c.key); fd.append('signature', await cldSign(c, all));
  const r = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(c.cloud)}/${rt}/${action}`, { method: 'POST', body: fd, signal: AbortSignal.timeout(90000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || `Cloudinary answered ${r.status}`), { status: r.status });
  return j;
}
const cldUpload = (c, body, type, name, rt, id) => cldCall(c, rt, 'upload', { public_id: id, type: 'authenticated' }, { blob: new Blob([body], { type }), name: name || 'file' });
const cldDestroy = (c, rt, id) => cldCall(c, rt, 'destroy', { public_id: id, type: 'authenticated', invalidate: 'true' });
function cldError(e) {
  const m = String(e?.message || e);
  if (e?.status === 401 || /invalid signature|unknown api key|api_key/i.test(m)) return 'Cloudinary refused those details. Copy the cloudinary:// line again from Settings → API Keys.';
  if (e?.status === 404 || /cloud_name|not found/i.test(m)) return "Cloudinary doesn't know that cloud name. Copy the cloudinary:// line again.";
  if (/too large/i.test(m)) return "That file is larger than Cloudinary's free plan allows (10 MB for images and files, 100 MB for video).";
  if (/timed out|timeout|fetch failed/i.test(m)) return "Couldn't reach Cloudinary. Check your connection and try again.";
  return 'Cloudinary: ' + m.slice(0, 200);
}
const kindOf = type => /^image\//.test(type) ? 'image' : /^(video|audio)\//.test(type) ? 'video' : 'raw';

async function upload(req, env) {
  const c = (await readCfg(env)).cloudinary;
  if (!c) return json(400, { error: 'Connect Cloudinary in Settings → Connections first.' });
  const type = (req.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  let name = ''; try { name = decodeURIComponent(req.headers.get('x-filename') || ''); } catch { }
  name = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').slice(0, 120);
  const ext = (name.toLowerCase().match(/\.[a-z0-9]{1,8}$/) || [])[0] || EXT_BY_TYPE[type] || '.bin';
  const rt = kindOf(type), limit = rt === 'video' ? 100e6 : 10e6; // Cloudinary free plan
  const tooBig = () => json(413, { error: `That file is too large: Cloudinary's free plan takes up to ${limit / 1e6} MB for ${rt === 'video' ? 'video and audio' : rt === 'image' ? 'images' : 'files'}.` });
  if (Number(req.headers.get('content-length') || 0) > limit) return tooBig();
  const buf = await req.arrayBuffer();
  if (buf.byteLength > limit) return tooBig();
  const h = hex(8);
  try {
    // images and video are stored by id (Cloudinary keeps their format); other files keep their extension in the id
    const up = await cldUpload(c, buf, type, name, rt, 'forge/' + h + (rt === 'raw' ? ext : ''));
    const fext = rt === 'raw' ? ext : '.' + String(up.format || ext.slice(1)).toLowerCase();
    return json(200, { url: `/files/${rt}/${up.version}/${h}${fext}`, name: name || h + fext, size: buf.byteLength, type });
  } catch (e) { return json(502, { error: cldError(e) }); }
}
async function serveFile(path, env) {
  const m = /^(image|video|raw)\/(\d{1,12})\/([0-9a-f]{16})(\.[a-z0-9]{1,8})$/i.exec(path);
  const c = m && (await readCfg(env)).cloudinary;
  if (!c) return json(404, { error: 'Not found' });
  const r = await fetch(await cldUrl(c, m[1], m[2], `forge/${m[3]}${m[4]}`), { cf: { cacheEverything: true, cacheTtl: 86400 } });
  if (!r.ok) return json(r.status === 404 ? 404 : 502, { error: r.status === 404 ? 'Not found' : 'Cloudinary did not send the file.' });
  const type = MIME[m[4].slice(1).toLowerCase()] || (r.headers.get('content-type') || 'application/octet-stream').split(';')[0];
  const inline = INLINE_OK.test(type);
  return new Response(r.body, {
    headers: {
      'Content-Type': inline ? type : 'application/octet-stream', 'Content-Security-Policy': 'sandbox', 'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=31536000, immutable', ...(inline ? {} : { 'Content-Disposition': 'attachment' }),
    },
  });
}

/* ---------- nightly backup into KV (last 30 kept) ---------- */
async function backup(env) {
  const c = await readCfg(env, true);
  if (!c.neonUrl || !env.KV) return;
  const rows = await db(env, c.neonUrl).query('select kind, id, data, updated_at as u from items where not deleted order by kind, id');
  await env.KV.put('backup:' + new Date().toISOString().slice(0, 10), JSON.stringify({ at: Date.now(), rows }));
  const old = (await env.KV.list({ prefix: 'backup:' })).keys.map(k => k.name).sort().slice(0, -30);
  for (const k of old) await env.KV.delete(k);
}

/* ---------- routes ---------- */
async function handle(req, env) {
  const url = new URL(req.url), p = decodeURIComponent(url.pathname);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const o = req.headers.get('Origin');
    if (o && o !== url.origin) return json(403, { error: 'Forbidden origin' });
  }
  if (p === '/api/ping') return json(200, { ok: true });
  if (p === '/api/login' && req.method === 'POST') return login(req, env);
  if (p === '/api/logout' && req.method === 'POST') return json(200, { ok: true }, { 'Set-Cookie': cookie(req, '', 0) });

  const authed = await isAuthed(req, env);
  if (p === '/api/session') {
    if (!authed) return json(200, { cloud: true, loggedIn: false, passphraseSet: !!env.PASSPHRASE });
    return json(200, { cloud: true, loggedIn: true, setup: setupState(env, await readCfg(env, true)) });
  }
  if (!authed) return json(401, { error: 'Log in first.' });

  if (p.startsWith('/files/') && (req.method === 'GET' || req.method === 'HEAD')) return serveFile(p.slice('/files/'.length), env);
  if (p.startsWith('/api/setup/')) return setup(p.slice('/api/setup/'.length), req, env);
  if (p === '/api/sync' && req.method === 'POST') return sync(req, env);
  if (p === '/api/config') {
    let cfg = await readCfg(env, true);
    if (req.method === 'PUT' || req.method === 'POST') {
      const body = await req.json().catch(() => ({})), patch = {};
      if (typeof body.baseUrl === 'string' && /^https?:\/\//.test(body.baseUrl)) patch.baseUrl = body.baseUrl.trim();
      if (typeof body.model === 'string' && body.model.trim()) patch.model = body.model.trim();
      if (typeof body.apiKey === 'string' && body.apiKey.trim()) patch.apiKey = body.apiKey.trim();
      if (typeof body.groqKey === 'string' && body.groqKey.trim()) patch.groqKey = body.groqKey.trim();
      cfg = await writeCfg(env, patch);
    }
    return json(200, { cloud: true, baseUrl: cfg.baseUrl, model: cfg.model, hasKey: !!cfg.apiKey, hasGroq: !!cfg.groqKey });
  }
  if (p === '/api/chat' && req.method === 'POST') return chat(req, env);
  if (p === '/api/transcribe' && req.method === 'POST') return transcribe(req, env);
  if (p === '/api/models') {
    const cfg = await readCfg(env);
    try {
      const r = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/models', { headers: cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {}, signal: AbortSignal.timeout(15000) });
      return json(200, { models: ((await r.json()).data || []).map(m => m.id).filter(Boolean).sort() });
    } catch { return json(200, { models: [] }); }
  }
  if (p === '/api/preview') {
    try { return json(200, (await linkPreview(url.searchParams.get('url') || '')) || {}); } catch { return json(200, {}); }
  }
  if (p === '/api/upload' && req.method === 'POST') return upload(req, env);
  /* ---- Connect an AI: personal tokens, signed-in apps, and what they changed ---- */
  if (p === '/api/tokens' && req.method === 'GET') {
    let apps = [];
    try { apps = ((await env.OAUTH_PROVIDER?.listUserGrants(OWNER))?.items || []).map(g => ({ id: g.id, app: g.metadata?.app || 'AI app', host: g.metadata?.host || '', scope: g.scope?.includes('forge:write') ? 'write' : 'read', created: g.createdAt })); } catch { }
    return json(200, { tokens: env.KV ? await listTokens(env) : [], apps, mcpUrl: url.origin + '/mcp' });
  }
  if (p === '/api/tokens' && req.method === 'POST') {
    if (!env.KV) return json(500, { error: 'No KV storage linked.' });
    const b = await req.json().catch(() => ({}));
    return json(200, await createToken(env, b.name, b.scope));
  }
  if (p.startsWith('/api/tokens/') && req.method === 'DELETE') return json((await revokeToken(env, p.slice(12))) ? 200 : 404, { ok: true });
  if (p.startsWith('/api/apps/') && req.method === 'DELETE') {
    try { await env.OAUTH_PROVIDER.revokeGrant(p.slice(10), OWNER); return json(200, { ok: true }); } catch (e) { return json(404, { error: 'Not found' }); }
  }
  if (p === '/api/activity') {
    const sql = await sqlOrNull(env);
    return json(200, { items: sql ? (await listActivity(sql)).map(r => ({ ...r, id: Number(r.id), at: Number(r.at) })) : [] });
  }
  if (p === '/api/activity/undo' && req.method === 'POST') {
    const sql = await sqlOrNull(env), b = await req.json().catch(() => ({}));
    if (!sql) return json(409, { error: 'No database connected.' });
    const r = await undoActivity(sql, Number(b.id));
    return json(r.error ? 400 : 200, r);
  }
  if (p === '/api/stats') {
    const c = await readCfg(env);
    let items = null, backups = 0, files = null;
    try { if (c.neonUrl) items = (await db(env, c.neonUrl).query('select count(*)::int as n from items where not deleted'))[0].n; } catch { }
    if (c.cloudinary) try {
      const u = await (await fetch(`https://api.cloudinary.com/v1_1/${c.cloudinary.cloud}/usage`, { headers: { Authorization: 'Basic ' + btoa(c.cloudinary.key + ':' + c.cloudinary.secret) }, signal: AbortSignal.timeout(10000) })).json();
      files = { count: u.resources ?? 0, bytes: u.storage?.usage ?? 0, credits: u.credits?.usage ?? 0, limit: u.credits?.limit ?? 25 };
    } catch { }
    if (env.KV) backups = (await env.KV.list({ prefix: 'backup:' })).keys.length;
    return json(200, { items, files, backups });
  }
  return json(404, { error: 'Not found' });
}

/* ---------- the sign-in page AI apps send you to (OAuth consent) ---------- */
async function authorize(req, env) {
  const P = env.OAUTH_PROVIDER, page = (o, status = 200, headers) => new Response(consentPage(o), { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', ...(headers ? Object.fromEntries(headers) : {}) } });
  const problem = (msg, status = 400) => new Response(`<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Forge</title><body style="font:16px system-ui;padding:40px;max-width:520px;margin:auto"><h2>Forge couldn't connect that app</h2><p>${String(msg).replace(/[<>&]/g, '')}</p><p>Go back to the app and try connecting again.</p>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  if (!P) return problem('Sign-in for AI apps is not set up on this Forge.', 500);
  if (req.method === 'GET') {
    let ar; try { ar = await P.parseAuthRequest(req); } catch (e) { return problem(e?.message || 'The request from the app was not valid.'); }
    const d = await P.describeConsent(ar), tx = await P.beginConsent(ar);
    const info = { app: d.clientName || d.clientDomain || 'An AI app', host: d.redirectHost, loopback: d.redirectIsLoopback, scopeAsked: ar.scope?.includes('forge:write') || !ar.scope?.length ? 'write' : 'read' };
    await env.KV.put('consent:' + tx.handle.slice(0, 64), JSON.stringify(info), { expirationTtl: 900 });
    return page({ ...info, handle: tx.handle, needPass: !(await isAuthed(req, env)) }, 200, tx.headers);
  }
  const f = await req.formData(), handle = String(f.get('handle') || ''), info = await env.KV.get('consent:' + handle.slice(0, 64), 'json');
  if (!info) return problem('This sign-in page expired.');
  if (f.get('decision') !== 'allow') { const d = await P.denyConsent(req, handle); return new Response(null, { status: 302, headers: d.headers }); }
  const authed = await isAuthed(req, env), extra = [];
  if (!authed) {
    const r = await checkPassphrase(req, env, f.get('passphrase'));
    if (!r.ok) return page({ ...info, handle, needPass: true, error: r.error }, r.status);
    extra.push(cookie(req, await makeToken(env), YEAR));
  }
  const access = f.get('access') === 'read' ? 'read' : 'write', scope = access === 'write' ? ['forge:read', 'forge:write', 'offline_access'] : ['forge:read', 'offline_access'];
  let ok; try { ok = await P.approveConsent(req, handle, { scope }); } catch (e) { return problem(e?.message || 'This sign-in page expired.'); }
  const { redirectTo } = await P.completeAuthorization({ request: ok.request, userId: OWNER, scope, metadata: { app: info.app, host: info.host, at: Date.now() }, props: { scope: access, client: info.app, via: 'oauth' } });
  await env.KV.delete('consent:' + handle.slice(0, 64)).catch(() => { });
  const h = new Headers(ok.headers); h.set('Location', redirectTo); extra.forEach(c => h.append('Set-Cookie', c));
  return new Response(null, { status: 302, headers: h });
}

/* ---------- entry: OAuth for /mcp around the app ---------- */
const OWNER = 'owner'; // one person per Forge
async function sqlOrNull(env) { const c = await readCfg(env); return c.neonUrl ? db(env, c.neonUrl) : null; }
async function appFetch(req, env) {
  try {
    const p = new URL(req.url).pathname;
    if (p === '/authorize') return await authorize(req, env);
    return await handle(req, env);
  } catch (e) { return json(500, { error: e?.message || 'Something went wrong.' }); }
}
const providers = new Map();
function providerFor(origin) {
  if (!providers.has(origin)) providers.set(origin, new OAuthProvider({
    apiRoute: '/mcp',
    apiHandler: { fetch: (req, env, ctx) => handleMcp(req, env, ctx.props || {}, () => sqlOrNull(env)) },
    defaultHandler: { fetch: (req, env) => appFetch(req, env) },
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    clientIdMetadataDocumentEnabled: true,
    scopesSupported: ['forge:read', 'forge:write', 'offline_access'],
    requiredScopes: ['forge:read'],
    accessTokenTTL: 3600,
    refreshTokenTTL: 90 * 86400,
    refreshTokenIdleTTL: 30 * 86400,
    resourceMetadata: { resource: origin + '/mcp', authorization_servers: [origin], bearer_methods_supported: ['header'], resource_name: 'Forge' },
    // personal tokens made in Settings (fg_…) for apps that take a header instead of a sign-in
    resolveExternalToken: async ({ token, env }) => { const props = await resolvePersonalToken(env, token); return props ? { props, audience: origin + '/mcp' } : null; },
  }));
  return providers.get(origin);
}

export default {
  async fetch(req, env, ctx) {
    if (!env.OAUTH_KV) return appFetch(req, env); // older deploys without the sign-in storage keep working
    return providerFor(new URL(req.url).origin).fetch(req, env, ctx);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(backup(env));
    if (env.OAUTH_KV) ctx.waitUntil(providerFor('https://forge.invalid').purgeExpiredData(env).catch(() => { }));
  },
};
