// Forge — local server. No dependencies. Run: node server.js  (or double-click Forge.vbs)
// Serves the app, keeps your data in ./data, proxies AI calls so your key never sits in the browser,
// fetches link previews for the board, keeps daily backups and tidies up files you deleted.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PORT = Number(process.env.PORT) || 4747;
const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const UPLOADS = path.join(DATA, 'uploads');
const BACKUPS = path.join(DATA, 'backups');
const TRASH = path.join(DATA, 'trash');
const DB = path.join(DATA, 'db.json');
const CFG = path.join(DATA, 'config.json');
const LOG = path.join(DATA, 'server.log');
const STARTUP_LNK = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Forge.lnk');
for (const d of [UPLOADS, BACKUPS, TRASH]) fs.mkdirSync(d, { recursive: true });

try { if (fs.statSync(LOG).size > 512e3) fs.writeFileSync(LOG, ''); } catch { }
function log(...a) {
  const line = a.join(' ');
  console.log(line);
  try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`); } catch { }
}

const DEFAULT_CFG = { baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'nvidia/nemotron-3-ultra-550b-a55b', apiKey: '', groqKey: '' };
const GROQ = 'https://api.groq.com/openai/v1';
// Tried in order when the chosen NVIDIA model is down or slow. All of these returned real tool calls when probed (Nov 2026).
const NVIDIA_FALLBACKS = ['nvidia/nemotron-3-ultra-550b-a55b', 'mistralai/mistral-large-4-1t-a52b', 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning', 'nvidia/nemotron-3.5-bolt-e4b', 'stepfun-ai/step-5-preview', 'minimaxai/minimax-m3.1-flash'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
};
const EXT_BY_TYPE = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg',
  'application/pdf': '.pdf', 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'audio/wav': '.wav', 'text/plain': '.txt',
};
// Uploaded files that may be shown inline; everything else downloads. All uploads are sandboxed.
const INLINE_OK = /^(image|video|audio)\/|^application\/pdf|^text\/plain/;

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function writeJson(file, obj) {
  const text = JSON.stringify(obj), tmp = file + '.tmp';
  try { fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); } catch { fs.writeFileSync(file, text); } // e.g. briefly locked by OneDrive
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('That is too large.')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const readJsonBody = async (req, limit) => JSON.parse((await readBody(req, limit)).toString('utf8') || '{}');
function send(res, status, body, type = 'application/json', extra = {}) {
  const out = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(out);
}
function serveFile(res, root, rel, upload = false) {
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) return send(res, 403, { error: 'Forbidden' });
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, { error: 'Not found' });
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const extra = upload ? { 'Content-Security-Policy': 'sandbox', ...(INLINE_OK.test(type) ? {} : { 'Content-Disposition': 'attachment' }) } : {};
    send(res, 200, buf, upload && !INLINE_OK.test(type) ? 'application/octet-stream' : type, extra);
  });
}
const dirStats = d => fs.readdirSync(d).reduce((a, n) => { try { a.bytes += fs.statSync(path.join(d, n)).size; a.count++; } catch { } return a; }, { bytes: 0, count: 0 });

/* ---------- keeping the data folder healthy ---------- */
function dailyBackup() {
  try {
    const f = path.join(BACKUPS, `db-${localDay()}.json`);
    if (!fs.existsSync(f) && fs.existsSync(DB)) fs.copyFileSync(DB, f);
    const all = fs.readdirSync(BACKUPS).filter(n => /^db-\d{4}-\d\d-\d\d\.json$/.test(n)).sort();
    all.slice(0, -14).forEach(n => fs.unlinkSync(path.join(BACKUPS, n)));
  } catch (e) { log('backup failed:', e.message); }
}
// Files no longer on the board move to data/trash (after a day's grace) and are deleted 30 days later.
function sweepUploads() {
  try {
    const raw = fs.existsSync(DB) ? fs.readFileSync(DB, 'utf8') : '';
    if (raw && !Array.isArray(JSON.parse(raw).board)) return; // unreadable data: touch nothing
    const now = Date.now(); let moved = 0;
    for (const n of fs.readdirSync(UPLOADS)) {
      const full = path.join(UPLOADS, n);
      if (raw.includes('/uploads/' + n) || now - fs.statSync(full).mtimeMs < 864e5) continue;
      const dest = path.join(TRASH, n); fs.renameSync(full, dest); fs.utimesSync(dest, new Date(), new Date()); moved++;
    }
    for (const n of fs.readdirSync(TRASH)) { const f = path.join(TRASH, n); if (now - fs.statSync(f).mtimeMs > 30 * 864e5) fs.unlinkSync(f); }
    if (moved) log(`moved ${moved} unused upload(s) to data/trash`);
  } catch (e) { log('sweep failed:', e.message); }
}

/* ---------- link previews ---------- */
const PRIVATE_HOST = /^(localhost|.*\.localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|\[?f[cd])/i;
async function readLimited(r, limit) {
  const reader = r.body.getReader(), parts = []; let size = 0;
  while (size < limit) { const { done, value } = await reader.read(); if (done) break; parts.push(value); size += value.length; }
  reader.cancel().catch(() => { });
  return Buffer.concat(parts).toString('utf8');
}
const decodeEntities = s => s.replace(/&(#x?[\da-f]+|amp|quot|apos|lt|gt|nbsp);/gi, (m, e) => {
  const k = e.toLowerCase();
  if (k[0] === '#') return String.fromCodePoint(k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10));
  return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[k];
}).trim();
// Big sites that hide their tags from plain page fetches still answer oEmbed.
const OEMBED = [
  [/(^|\.)youtube\.com$|^youtu\.be$/, u => 'https://www.youtube.com/oembed?format=json&url='],
  [/(^|\.)pinterest\.[a-z.]+$|^pin\.it$/, u => 'https://www.pinterest.com/oembed.json?url='],
  [/(^|\.)vimeo\.com$/, u => 'https://vimeo.com/api/oembed.json?url='],
  [/^open\.spotify\.com$/, u => 'https://open.spotify.com/oembed?url='],
];
async function oembed(u) {
  const hit = OEMBED.find(([re]) => re.test(u.hostname)); if (!hit) return null;
  try {
    const r = await fetch(hit[1](u) + encodeURIComponent(u.href), { signal: AbortSignal.timeout(8000) });
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

/* ---------- start with Windows ---------- */
const runPs = mode => new Promise(resolve => execFile('powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'tools', 'autostart.ps1'), mode],
  { windowsHide: true, timeout: 20000 }, (err, out) => resolve(err ? null : String(out).trim())));

/* ---------- routes ---------- */
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);

async function handle(req, res) {
  // Only this computer's own browser may talk to the server.
  if (!ALLOWED_HOSTS.has(req.headers.host)) return send(res, 403, { error: 'Forbidden host' });
  const origin = req.headers.origin;
  if (req.method !== 'GET' && origin && !ALLOWED_HOSTS.has(origin.replace(/^http:\/\//, ''))) return send(res, 403, { error: 'Forbidden origin' });

  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = decodeURIComponent(url.pathname);

  if (p === '/api/ping') return send(res, 200, { ok: true });
  // Changes whenever an app file changes, so open tabs know to reload.
  if (p === '/api/version') return send(res, 200, { v: String(Math.max(...fs.readdirSync(PUB).map(n => fs.statSync(path.join(PUB, n)).mtimeMs))) });

  if (p === '/api/data') {
    if (req.method === 'GET') return send(res, 200, readJson(DB, {}));
    const body = await readJsonBody(req, 30e6);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return send(res, 400, { error: 'Bad data' });
    dailyBackup();
    writeJson(DB, body);
    return send(res, 200, { ok: true });
  }

  if (p === '/api/config') {
    const cfg = { ...DEFAULT_CFG, ...readJson(CFG, {}) };
    const pub = () => ({ baseUrl: cfg.baseUrl, model: cfg.model, hasKey: !!cfg.apiKey, hasGroq: !!cfg.groqKey });
    if (req.method === 'GET') return send(res, 200, pub());
    const body = await readJsonBody(req, 1e5);
    if (typeof body.baseUrl === 'string' && /^https?:\/\//.test(body.baseUrl)) cfg.baseUrl = body.baseUrl.trim();
    if (typeof body.model === 'string' && body.model.trim()) cfg.model = body.model.trim();
    if (typeof body.apiKey === 'string') cfg.apiKey = body.apiKey.trim();
    if (typeof body.groqKey === 'string') cfg.groqKey = body.groqKey.trim();
    writeJson(CFG, cfg);
    return send(res, 200, pub());
  }

  // Voice: speech to text with OpenAI's Whisper on Groq. The key stays here, never in the browser.
  if (p === '/api/transcribe' && req.method === 'POST') {
    const cfg = { ...DEFAULT_CFG, ...readJson(CFG, {}) };
    if (!cfg.groqKey) return send(res, 400, { error: 'Voice needs a Groq key. Add one in Settings → Coach.' });
    let audio;
    try { audio = await readBody(req, 10e6); } catch { return send(res, 413, { error: 'That recording is too long.' }); }
    if (audio.length < 1200) return send(res, 400, { error: "I didn't catch anything. Try again." });
    const type = String(req.headers['content-type'] || 'audio/webm').split(';')[0];
    const fd = new FormData();
    fd.append('file', new Blob([audio], { type }), 'speech.' + (type.split('/')[1] || 'webm').replace('x-', '').replace('mpeg', 'mp3'));
    fd.append('model', 'whisper-large-v3-turbo');
    fd.append('temperature', '0');
    fd.append('response_format', 'json');
    // English only: left to guess, Whisper turns a quiet clip into Icelandic or Welsh.
    // No word-list prompt: on unclear audio Whisper reads the prompt back as if you had said it.
    fd.append('language', 'en');
    try {
      const r = await fetch(GROQ + '/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + cfg.groqKey }, body: fd, signal: AbortSignal.timeout(45000) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 401 || r.status === 403) return send(res, 502, { error: 'Groq refused the voice key. Paste a fresh one in Settings → Coach.' });
      if (r.status === 429) return send(res, 429, { error: 'Voice limit reached for now. Type instead, or try again in a minute.' });
      if (!r.ok) { log('transcribe:', r.status, j?.error?.message || ''); return send(res, 502, { error: 'Voice service error: ' + (j?.error?.message || r.status) }); }
      const text = String(j.text || '').trim();
      // What Whisper says when it hears silence or noise, not speech.
      const filler = /^(?:[\s.,!?…-]*|(?:thanks?(?: you)?(?: (?:so|very) much)?(?: for watching| for listening)?|you|bye(?: bye)?|okay|ok|so|um+|uh+|hmm+|the end|subtitles by.*|please subscribe.*)[.!?…]*)$/i;
      if (!text || !/[a-z0-9]/i.test(text) || filler.test(text)) return send(res, 422, { error: "I didn't catch that. Try again, a little closer to the mic." });
      return send(res, 200, { text });
    } catch (e) { log('transcribe:', e.message); return send(res, 502, { error: 'The voice service did not answer in time.' }); }
  }

  if (p === '/api/chat' && req.method === 'POST') {
    const cfg = { ...DEFAULT_CFG, ...readJson(CFG, {}) };
    if (!cfg.apiKey) return send(res, 400, { error: 'No API key yet. Add a free one in Settings → Coach.' });
    const body = await readJsonBody(req, 2e6);
    // Free models come and go: try the chosen one, then the backups, skipping any that are down, slow or silent.
    const nvidia = /integrate\.api\.nvidia\.com/.test(cfg.baseUrl);
    const models = [cfg.model, ...(nvidia ? NVIDIA_FALLBACKS : [])].filter((m, i, a) => m && a.indexOf(m) === i);
    const started = Date.now(); let lastErr = '';
    for (const model of models) {
      const left = 110000 - (Date.now() - started);
      if (left < 5000) break;
      // Tools go along when the coach sends them. A model that rejects them is asked again without,
      // and the browser falls back to reading <action> tags from the text.
      let tools = Array.isArray(body.tools) && body.tools.length ? body.tools : null, toolsOff = false, r, text, json;
      for (let attempt = 0; attempt < 2; attempt++) {
        const payload = { model, messages: body.messages, stream: false, temperature: tools ? 0.3 : (body.temperature ?? 0.6), max_tokens: Math.max(700, body.max_tokens ?? 900) };
        if (tools) Object.assign(payload, { tools, tool_choice: 'auto' });
        // Nemotron thinks before deciding what to do (without it, it claims actions it never took),
        // but once a tool has run, wording the confirmation needs no thinking: off, it answers in about a second.
        const afterTool = body.messages?.[body.messages.length - 1]?.role === 'tool';
        if (tools && afterTool && /nemotron/i.test(model)) payload.chat_template_kwargs = { enable_thinking: false };
        try {
          r = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
            // Reasoning models spend tokens thinking first, so leave room for the answer.
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(Math.min(35000, left)),
          });
          text = await r.text();
        } catch (e) { r = null; break; }
        try { json = JSON.parse(text); } catch { json = null; }
        const msg = String(json?.error?.message || json?.detail || text || '');
        if (tools && r.status === 400 && /tool|function/i.test(msg)) { log('chat:', model, 'rejected tools, retrying without'); tools = null; toolsOff = true; continue; }
        break;
      }
      if (!r) { lastErr = `${model} did not answer in time`; log('chat:', lastErr); continue; }
      if (r.status === 401 || r.status === 403) return send(res, 502, { error: `Your API key was refused (${r.status}). Paste a fresh key in Settings → Coach.` });
      if (!r.ok) { lastErr = `${model} returned ${r.status}: ${json?.error?.message || json?.detail || json?.title || text.slice(0, 120)}`; log('chat:', lastErr); continue; }
      const m = json?.choices?.[0]?.message || {};
      const content = (m.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      const tool_calls = Array.isArray(m.tool_calls) && m.tool_calls.length
        ? m.tool_calls.filter(c => c?.function?.name).map((c, i) => ({ id: c.id || `call_${Date.now()}_${i}`, type: 'function', function: { name: c.function.name, arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments || {}) } }))
        : null;
      if (!content && !tool_calls) {
        lastErr = `${model} sent an empty reply`; log('chat:', lastErr);
        if (!body._retried) { body._retried = true; models.splice(models.indexOf(model) + 1, 0, model); } // one more try on the same model first
        continue;
      }
      return send(res, 200, { content, tool_calls, toolsOff, model });
    }
    return send(res, 502, { error: `No free model answered right now (${lastErr || 'timed out'}). Try again in a minute, or pick another model in Settings → Coach.` });
  }

  if (p === '/api/models' && req.method === 'GET') {
    const cfg = { ...DEFAULT_CFG, ...readJson(CFG, {}) };
    try {
      const r = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/models', { headers: cfg.apiKey ? { Authorization: 'Bearer ' + cfg.apiKey } : {}, signal: AbortSignal.timeout(15000) });
      const json = await r.json();
      return send(res, 200, { models: (json.data || []).map(m => m.id).filter(Boolean).sort() });
    } catch { return send(res, 200, { models: [] }); }
  }

  if (p === '/api/preview' && req.method === 'GET') {
    try { return send(res, 200, (await linkPreview(url.searchParams.get('url') || '')) || {}); }
    catch { return send(res, 200, {}); }
  }

  if (p === '/api/upload' && req.method === 'POST') {
    const type = (req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    let name = ''; try { name = decodeURIComponent(req.headers['x-filename'] || ''); } catch { }
    name = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '').slice(0, 120);
    const ext = (path.extname(name).toLowerCase().match(/^\.[a-z0-9]{1,8}$/) || [])[0] || EXT_BY_TYPE[type] || '.bin';
    const buf = await readBody(req, 100e6);
    const file = crypto.randomBytes(8).toString('hex') + ext;
    fs.writeFileSync(path.join(UPLOADS, file), buf);
    return send(res, 200, { url: '/uploads/' + file, name: name || file, size: buf.length, type });
  }

  if (p === '/api/storage' && req.method === 'GET') {
    const size = f => { try { return fs.statSync(f).size; } catch { return 0; } };
    return send(res, 200, { dataDir: DATA, db: size(DB), uploads: dirStats(UPLOADS), backups: dirStats(BACKUPS), trash: dirStats(TRASH) });
  }

  if (p === '/api/reveal' && req.method === 'POST') {
    if (process.platform === 'win32') execFile('explorer.exe', [DATA], () => { });
    return send(res, 200, { ok: process.platform === 'win32' });
  }

  if (p === '/api/autostart') {
    const supported = process.platform === 'win32';
    if (req.method === 'POST' && supported) {
      const body = await readJsonBody(req, 1e4);
      const out = await runPs(body.on ? 'on' : 'off');
      if (out === null) return send(res, 500, { error: 'Windows did not accept the change.' });
    }
    return send(res, 200, { supported, on: supported && fs.existsSync(STARTUP_LNK) });
  }

  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
  if (p.startsWith('/uploads/')) return serveFile(res, UPLOADS, p.slice('/uploads/'.length), true);
  return serveFile(res, PUB, p === '/' ? 'index.html' : p.slice(1));
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => { if (!res.headersSent) send(res, 500, { error: e.message }); });
});
server.on('error', e => {
  if (e.code === 'EADDRINUSE') { log(`Forge is already running at http://localhost:${PORT}`); process.exit(0); }
  log('server error:', e.message); process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => { log(`Forge is running at http://localhost:${PORT}`); sweepUploads(); dailyBackup(); });
