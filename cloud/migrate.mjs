// One-time move from the local Forge (data/db.json + data/uploads) into your cloud Forge.
//   node cloud/migrate.mjs https://forge.<you>.workers.dev
//   node cloud/migrate.mjs http://127.0.0.1:8787 --data path/to/data      (testing)
// It asks for your passphrase, uploads every board file, rewrites /uploads/… to /files/…, then syncs every item.
// Your local data/ folder is not changed.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const args = process.argv.slice(2);
const base = (args.find(a => /^https?:\/\//.test(a)) || '').replace(/\/+$/, '');
const dataDir = path.resolve(args.includes('--data') ? args[args.indexOf('--data') + 1] : path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/i, '$1')), '..', 'data'));
if (!base) { console.log('Usage: node cloud/migrate.mjs https://your-forge-address [--data folder]'); process.exit(1); }
const dbFile = path.join(dataDir, 'db.json'), upDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(dbFile)) { console.log('No db.json in ' + dataDir); process.exit(1); }

function askHidden(q) {
  if (process.env.FORGE_PASSPHRASE) return Promise.resolve(process.env.FORGE_PASSPHRASE);
  return new Promise(res => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.startsWith(q)) process.stdout.write(q); };
    rl.question(q, a => { rl.close(); process.stdout.write('\n'); res(a); });
  });
}

const pass = await askHidden('Passphrase for ' + base + ': ');
let r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ passphrase: pass }) });
if (!r.ok) { console.log('Login failed:', (await r.json().catch(() => ({}))).error || r.status); process.exit(1); }
const cookie = r.headers.get('set-cookie').split(';')[0];
const api = (p, opts = {}) => fetch(base + p, { ...opts, headers: { Origin: base, Cookie: cookie, ...(opts.headers || {}) } });
const ses = await (await api('/api/session')).json();
if (!ses.setup?.db) { console.log('Finish the setup in the app first (the database step).'); process.exit(1); }

const d = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
const raw = JSON.stringify(d);

// 1. files: every /uploads/<name> the data mentions
const names = [...new Set([...raw.matchAll(/\/uploads\/([\w.-]+)/g)].map(m => m[1]))];
const map = {};
const TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', txt: 'text/plain' };
for (const n of names) {
  const f = path.join(upDir, n);
  if (!fs.existsSync(f)) { console.log('  missing file, skipped:', n); continue; }
  const type = TYPES[n.split('.').pop().toLowerCase()] || 'application/octet-stream';
  const up = await api('/api/upload', { method: 'POST', headers: { 'Content-Type': type, 'X-Filename': encodeURIComponent(n) }, body: fs.readFileSync(f) });
  const j = await up.json();
  if (!up.ok) { console.log('  upload failed:', n, j.error); continue; }
  map['/uploads/' + n] = j.url; console.log('  file', n, '→', j.url);
}
const fixed = JSON.parse(raw.replace(/\/uploads\/[\w.-]+/g, m => map[m] || m));

// 2. items: one row each, the same shape the app syncs
const KINDS = ['projects', 'tasks', 'board', 'notes', 'sessions', 'xpEvents', 'reminders', 'memory', 'chat'];
const KV = ['profile', 'boardCam', 'briefs', 'bonus', 'timer', 'cycle', 'chatUnread'];
const uid = () => Math.random().toString(36).slice(2, 10);
const u = Date.now(), changes = [], counts = {};
for (const k of KINDS) for (const it of fixed[k] || []) {
  if (!it || typeof it !== 'object') continue;
  if (!it.id) it.id = uid();
  changes.push({ kind: k, id: String(it.id), data: it, u }); counts[k] = (counts[k] || 0) + 1;
}
for (const k of KV) if (k in fixed) changes.push({ kind: 'kv', id: k, data: { v: fixed[k] ?? null }, u });
for (let i = 0; i < changes.length; i += 500) {
  const res = await api('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cursor: 1e15, changes: changes.slice(i, i + 500) }) });
  if (!res.ok) { console.log('Sync failed:', (await res.json().catch(() => ({}))).error || res.status); process.exit(1); }
}
console.log('Moved:', Object.entries(counts).map(([k, n]) => `${n} ${k}`).join(', '), `· ${Object.keys(map).length} file(s)`);
console.log('Done. Open your Forge on any device; it pulls everything in on the next sync.');
