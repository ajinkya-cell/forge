/* Forge in the cloud: login, first-run setup, per-item sync, and the Connections settings.
   On the old local server (server.js) none of this runs: /api/session doesn't exist there and CLOUD stays null. */
let CLOUD = null;
async function detectCloud() {
  try {
    const r = await fetch('/api/session', { cache: 'no-store' }), j = await r.json();
    if (r.ok && j.cloud) { localStorage.setItem('forge:cloud', '1'); return j; }
  } catch {
    // No connection: if this device has used the cloud Forge before, open it from what's saved here and sync later.
    if (localStorage.getItem('forge:cloud') && localStorage.getItem('forge:sync')) return { cloud: true, loggedIn: true, setup: { done: true }, offlineBoot: true };
  }
  return null;
}
const postJson = async (url, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Something went wrong (${r.status}).`);
  return j;
};

/* ---------------- sync: one row per item, newer edit wins ---------------- */
const SYNC_KINDS = ['projects', 'tasks', 'board', 'notes', 'sessions', 'xpEvents', 'reminders', 'memory', 'chat'];
const SYNC_KV = ['profile', 'boardCam', 'briefs', 'bonus', 'timer', 'cycle', 'chatUnread'];
const h32 = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + '.' + s.length.toString(36); };
// cursor: last server change seen. base: what each item looked like when last synced (a hash).
// touched: when a local edit to an item was first noticed, so the newer of two edits wins. ready: first pull done.
let SY = (() => { try { const s = JSON.parse(localStorage.getItem('forge:sync')); if (s && typeof s.base === 'object') return { touched: {}, ...s }; } catch { } return { cursor: 0, base: {}, touched: {}, ready: false, at: 0 }; })();
const saveSY = () => { try { localStorage.setItem('forge:sync', JSON.stringify(SY)); } catch { } };

function syncSnapshot() {
  const m = new Map();
  for (const k of SYNC_KINDS) for (const it of S[k] || []) {
    if (!it || typeof it !== 'object') continue;
    if (!it.id) it.id = uid(); // chat lines and xp events had no ids before sync
    m.set(k + ':' + it.id, { kind: k, id: it.id, data: it });
  }
  for (const k of SYNC_KV) m.set('kv:' + k, { kind: 'kv', id: k, data: { v: S[k] ?? null } });
  for (const e of m.values()) e.h = h32(JSON.stringify(e.data));
  return m;
}
function syncPending(snap) {
  const out = [], now = Date.now();
  for (const [key, e] of snap) if (SY.base[key] !== e.h) out.push({ key, h: e.h, kind: e.kind, id: e.id, data: e.data, del: false, u: SY.touched[key] ||= now });
  for (const key in SY.base) if (!snap.has(key)) { const i = key.indexOf(':'); out.push({ key, kind: key.slice(0, i), id: key.slice(i + 1), data: null, del: true, u: SY.touched[key] ||= now }); }
  return out;
}
// Called on every save: note when each changed item was first edited.
function syncNote() { if (!CLOUD || !SY.ready) return; syncPending(syncSnapshot()); saveSY(); }

let syncing = null, syncAgain = false, renderLater = 0;
function syncNow() {
  if (!CLOUD?.loggedIn) return Promise.resolve();
  if (syncing) { syncAgain = true; return syncing; }
  syncing = (async () => {
    try {
      let more = true, first = true, sent = new Map();
      while (more) {
        // A device that has never pulled sends nothing first: its empty state must not overwrite the cloud.
        const changes = first && SY.ready ? syncPending(syncSnapshot()) : [];
        const r = await fetch('/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cursor: SY.cursor, changes: changes.map(({ key, h, ...c }) => c) }) });
        if (r.status === 401) { CLOUD.loggedIn = false; showGate('login'); return; }
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || r.status);
        for (const c of changes) { sent.set(c.key, c.u); if (c.del) delete SY.base[c.key]; else SY.base[c.key] = c.h; delete SY.touched[c.key]; }
        syncApply(j.rows || [], sent);
        SY.cursor = j.cursor; more = !!j.more; first = false;
      }
      // First pull on this device: what it has now *is* the cloud's state. Its blank defaults are not edits to send.
      if (!SY.ready) { for (const [k, e] of syncSnapshot()) SY.base[k] = e.h; SY.touched = {}; }
      SY.ready = true; SY.at = Date.now(); saveSY(); setOffline(false);
      if (view === 'settings') paintSyncLine();
    } catch { setOffline(true); }
    finally { syncing = null; if (syncAgain) { syncAgain = false; syncNow(); } }
  })();
  return syncing;
}
function syncApply(rows, sent) {
  if (!rows.length) return;
  const snap = SY.ready ? syncSnapshot() : null;
  let changed = false;
  for (const r of rows) {
    const key = r.kind + ':' + r.id;
    if (sent.get(key) === r.u) continue; // our own change coming back
    if (snap) {
      const local = snap.get(key), pendingHere = (local ? local.h : undefined) !== SY.base[key];
      if (pendingHere && (SY.touched[key] || 0) > r.u) continue; // edited here more recently: ours goes up next
    }
    if (r.kind === 'kv') {
      if (!SYNC_KV.includes(r.id)) continue;
      const v = r.del ? null : (r.data?.v ?? null);
      S[r.id] = r.id === 'profile' ? { ...DEFAULTS.profile, ...(v || {}) } : r.id === 'briefs' || r.id === 'bonus' ? (v || {}) : v;
      SY.base[key] = h32(JSON.stringify({ v: S[r.id] ?? null }));
    } else {
      if (!SYNC_KINDS.includes(r.kind)) continue;
      const arr = S[r.kind] ||= [], i = arr.findIndex(x => x?.id === r.id);
      if (r.del) { if (i >= 0) arr.splice(i, 1); delete SY.base[key]; }
      else { if (i >= 0) arr[i] = r.data; else arr.push(r.data); SY.base[key] = h32(JSON.stringify(r.data)); }
    }
    delete SY.touched[key]; changed = true;
  }
  if (!changed) return;
  if (S.board.some(b => !b.kind)) S.board = migrateBoard(S.board);
  try { localStorage.setItem('forge:data', JSON.stringify(S)); } catch { }
  ntIncoming(); // an open note shows what arrived, unless it is being typed in
  softRender();
}
// Repaint with what arrived, but never under someone's fingers.
function softRender() {
  clearTimeout(renderLater);
  const a = document.activeElement, busyNow = a?.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(a?.tagName) || document.querySelector('dialog[open]') || BD.editing || BD.drag || busy.chat || REC.on;
  if (busyNow) { renderLater = setTimeout(softRender, 1500); return; }
  // an open note keeps its own page (render() leaves it alone); the grid and other pages repaint as usual
  if (view === 'notes' && NT.open && $('#ntEd')) return;
  render();
}

/* ---------------- the gate: login and first-run setup ---------------- */
const SETUP = { step: 0, profile: null, models: 0 };
const SETUP_STEPS = ['You', 'Database', 'Storage', 'Coach', 'Voice', 'Done'];
const LINK = (href, text) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
function showGate(kind) {
  const g = $('#gate'); g.hidden = false; document.body.classList.add('gated');
  if (kind === 'login') {
    g.innerHTML = `<form class="gate-card" data-form="login">
      <div class="gate-logo">Forge</div>
      <h1>Welcome back</h1>
      <p class="muted">${CLOUD?.passphraseSet === false ? 'This Forge has no passphrase yet. Add the <code>PASSPHRASE</code> secret in your Cloudflare dashboard (Workers → forge → Settings → Variables and secrets), then reload.' : 'Type the passphrase you chose when you set up this Forge.'}</p>
      <input type="password" name="passphrase" autocomplete="current-password" placeholder="Passphrase" required autofocus ${CLOUD?.passphraseSet === false ? 'disabled' : ''}>
      <p class="gate-err" id="gateErr" role="alert"></p>
      <button class="primary wide" ${CLOUD?.passphraseSet === false ? 'disabled' : ''}>Log in</button>
      <p class="hint">You stay logged in on this device for a year.</p>
    </form>`;
    g.querySelector('input')?.focus();
    return;
  }
  paintSetup();
}
function hideGate() { const g = $('#gate'); g.hidden = true; g.innerHTML = ''; document.body.classList.remove('gated'); }

const stepDot = (i, cur) => `<span class="gate-dot ${i < cur ? 'done' : i === cur ? 'on' : ''}" title="${SETUP_STEPS[i]}"></span>`;
// One card per connection, shared by the setup and Settings → Connections.
function cxCard(kind, inSetup) {
  const st = CLOUD?.setup || {};
  const ok = st[kind];
  const status = ok ? '<span class="pill green">Connected</span>' : kind === 'coach' || kind === 'voice' ? '<span class="pill">Not set</span>' : '<span class="pill red">Not connected</span>';
  const field = (name, ph, label) => `<input type="password" name="${name}" autocomplete="off" spellcheck="false" placeholder="${ok ? 'Saved — paste a new one to replace it' : ph}" aria-label="${label}">`;
  const body = {
    db: `<p class="small">Where your tasks, notes and projects live. Make a free project at ${LINK('https://console.neon.tech', 'console.neon.tech')}, press <b>Connect</b>, and copy the connection string.</p>
      ${field('url', 'postgresql://…', 'Neon connection string')}`,
    images: `<p class="small">Where board images and files are kept, privately. Make a free account at ${LINK('https://cloudinary.com/users/register_free', 'cloudinary.com')} (no card), open ${LINK('https://console.cloudinary.com/settings/api-keys', 'Settings → API Keys')}, and copy the line that starts with <code>cloudinary://</code>.</p>
      <textarea name="cloudinary" rows="2" autocomplete="off" spellcheck="false" placeholder="${ok ? 'Saved — paste new details to replace them' : 'cloudinary://123456789012345:…@your-cloud'}" aria-label="Cloudinary API environment variable"></textarea>`,
    coach: `<p class="small">The coach's brain. Sign in at ${LINK('https://build.nvidia.com', 'build.nvidia.com')}, open any model, choose <b>Get API Key</b>, and paste it here. Free.</p>
      ${field('apiKey', 'nvapi-…', 'NVIDIA API key')}
      ${!inSetup ? `<label class="small" for="cxModel">Model</label><input id="cxModel" type="text" name="model" list="modelList" value="${esc(CFG.model || '')}" spellcheck="false"><datalist id="modelList">${MODELS.map(m => `<option value="${esc(m)}">`).join('')}</datalist>` : ''}`,
    voice: `<p class="small">Lets you talk instead of type: Whisper on Groq turns speech into text. Get a free key at ${LINK('https://console.groq.com/keys', 'console.groq.com/keys')}.</p>
      ${field('groqKey', 'gsk_…', 'Groq API key')}`,
  }[kind];
  const title = { db: 'Database · Neon', images: 'Images · Cloudinary', coach: 'Coach · NVIDIA', voice: 'Voice · Groq' }[kind];
  const btn = ok ? 'Test & save' : 'Connect';
  return `<form class="cx" data-form="cx" data-kind="${kind}">
    <div class="cx-head"><b>${title}</b>${status}</div>
    ${body}
    <p class="cx-msg" role="status"></p>
    <div class="row cx-actions"><button class="${inSetup && !ok ? 'primary' : 'btn'}">${btn}</button>${!inSetup && ok && (kind === 'coach' || kind === 'voice') ? `<button type="button" class="ghost" data-act="cxRemove" data-what="${kind}">Remove key</button>` : ''}</div>
  </form>`;
}
function paintSetup() {
  const g = $('#gate'), i = SETUP.step, st = CLOUD.setup, p = SETUP.profile || {};
  const kinds = [null, 'db', 'images', 'coach', 'voice'];
  const next = (label = 'Next', cls = 'primary', dis = false) => `<button type="button" class="${cls}" data-act="setupNext" ${dis ? 'disabled' : ''}>${label}</button>`;
  const back = i ? '<button type="button" class="ghost" data-act="setupBack">Back</button>' : '<span></span>';
  let main;
  if (i === 0) main = `<h1>Let's set up your Forge</h1><p class="muted">A few questions, then your keys. Everything is saved in your own accounts.</p>
    <form class="set gate-form" data-form="setupYou">
      <label for="suName">Your name</label><input id="suName" name="name" required value="${esc(p.name || '')}" placeholder="What should Forge call you?" autofocus>
      <label for="suFocus">Focus session</label><div class="row"><input id="suFocus" type="number" name="focusMin" min="5" max="240" value="${esc(p.focusMin || 50)}" style="width:90px"><span class="small">minutes</span></div>
      <label for="suGoal">Daily focus goal</label><div class="row"><input id="suGoal" type="number" name="goalHours" min="1" max="16" step="0.5" value="${esc(p.goalHours || 4)}" style="width:90px"><span class="small">hours a day</span></div>
      <label for="suEve">Evening recap at</label><div class="row"><input id="suEve" type="number" name="eveningHour" min="0" max="23" value="${esc(p.eveningHour ?? 21)}" style="width:90px"><span class="small">hour, 0–23</span></div>
      <span></span><div class="gate-foot">${back}<button class="primary">Next</button></div>
    </form>`;
  else if (i === 5) main = `<h1>You're set${p.name ? ', ' + esc(p.name) : ''}</h1>
    <p class="muted">Forge now lives at <b>${esc(location.host)}</b>. Open that address on any device and log in once.</p>
    <div class="gate-install">
      <div><b>iPhone</b><p class="small">Open this address in Safari → tap Share → <b>Add to Home Screen</b>. Forge opens like an app and works offline.</p></div>
      <div><b>Computer</b><p class="small">In Chrome or Edge, click the install icon at the right end of the address bar.</p></div>
    </div>
    <p class="gate-err" id="gateErr" role="alert"></p>
    <div class="gate-foot">${back}<button type="button" class="primary" data-act="setupFinish">Open Forge</button></div>`;
  else {
    const kind = kinds[i], ok = st[kind], optional = kind === 'coach' || kind === 'voice';
    main = `<h1>${{ db: 'Connect your database', images: 'Connect your image storage', coach: 'Give the coach a brain', voice: 'Turn on voice' }[kind]}</h1>
      ${cxCard(kind, true)}
      <div class="gate-foot">${back}${ok ? next() : optional ? next('Skip for now', 'ghost') : next('Next', 'primary', true)}</div>`;
  }
  g.innerHTML = `<div class="gate-card setup">
    <div class="gate-top"><div class="gate-logo">Forge</div><div class="gate-dots" aria-label="Step ${i + 1} of 6">${SETUP_STEPS.map((_, k) => stepDot(k, i)).join('')}</div></div>
    ${main}</div>`;
  g.querySelector('[autofocus], input')?.focus();
}
async function refreshSession() { const s = await detectCloud(); if (s) CLOUD = s; return CLOUD; }

async function cxSubmit(f) {
  const kind = f.dataset.kind, msg = f.querySelector('.cx-msg'), btn = f.querySelector('button:not([type=button])');
  const body = {};
  if (kind === 'db') body.url = f.url.value.trim();
  if (kind === 'images') body.cloudinary = f.cloudinary.value.trim();
  if (kind === 'coach') { body.apiKey = f.apiKey.value.trim(); if (f.model) body.model = f.model.value.trim(); }
  if (kind === 'voice') body.groqKey = f.groqKey.value.trim();
  msg.className = 'cx-msg'; msg.textContent = 'Checking…';
  try {
    const j = await withBusy(btn, () => postJson('/api/setup/' + kind, body));
    f.querySelectorAll('input[type=password], textarea').forEach(i => i.value = '');
    msg.className = 'cx-msg ok';
    msg.textContent = { db: `Connected. ${j.items ? j.items + ' items already there.' : 'Empty and ready.'}`, images: `Works: a private test image went up, came back and was deleted (${j.cloud}).`, coach: `Key works. ${j.models} models available.`, voice: 'Key works. Whisper is ready.' }[kind];
    await refreshSession();
    if (kind === 'coach' || kind === 'voice') { CFG = await fetch('/api/config').then(r => r.json()).catch(() => CFG); if (kind === 'coach') loadModels(); }
    const keep = msg.textContent;
    if (!$('#gate').hidden) paintSetup(); else render();
    const again = document.querySelector(`[data-form="cx"][data-kind="${kind}"] .cx-msg`); if (again) { again.className = 'cx-msg ok'; again.textContent = keep; }
  } catch (e) { msg.className = 'cx-msg err'; msg.textContent = e.message; shake(f); }
}

const CLOUD_FORMS = {
  login: async f => {
    const err = $('#gateErr'), b = f.querySelector('button'); err.textContent = '';
    try {
      await withBusy(b, () => postJson('/api/login', { passphrase: f.passphrase.value }));
      await refreshSession();
      if (CLOUD.setup.done) { hideGate(); startCloudApp(); } else { SETUP.step = 0; paintSetup(); }
    } catch (e) { err.textContent = e.message; shake(f.passphrase); f.passphrase.select(); }
  },
  setupYou: f => {
    SETUP.profile = { name: f.name.value.trim(), focusMin: Math.min(240, Math.max(5, Number(f.focusMin.value) || 50)), goalHours: Math.min(16, Math.max(1, Number(f.goalHours.value) || 4)), eveningHour: Math.min(23, Math.max(0, Number(f.eveningHour.value) || 21)) };
    SETUP.step = 1; paintSetup();
  },
  cx: cxSubmit,
};
const CLOUD_ACT = {
  setupNext: () => { SETUP.step = Math.min(5, SETUP.step + 1); paintSetup(); },
  setupBack: () => { SETUP.step = Math.max(0, SETUP.step - 1); paintSetup(); },
  setupFinish: async el => {
    try { await withBusy(el, () => postJson('/api/setup/done')); await refreshSession(); hideGate(); startCloudApp(); }
    catch (e) { $('#gateErr').textContent = e.message; }
  },
  cxRemove: async el => {
    if (!confirm(`Remove the ${el.dataset.what === 'coach' ? 'coach' : 'voice'} key from this Forge?`)) return;
    try { await postJson('/api/setup/remove', { what: el.dataset.what }); await refreshSession(); CFG = await fetch('/api/config').then(r => r.json()); render(); toast('Key removed.'); } catch (e) { toast(e.message); }
  },
  syncNowBtn: async el => {
    await withBusy(el, async () => { await syncNow(); if (offline) throw new Error('offline'); }).catch(() => { });
    toast(offline ? "Couldn't reach your Forge. Changes are kept on this device." : 'Synced.');
  },
  logout: async () => {
    if (!confirm('Log out on this device? Your data stays in your cloud.')) return;
    await syncNow();
    await postJson('/api/logout').catch(() => { });
    localStorage.removeItem('forge:data'); localStorage.removeItem('forge:sync');
    location.reload();
  },
};

/* ---------------- start ---------------- */
async function bootCloud() {
  document.documentElement.classList.add('cloud');
  $('#offlineText').textContent = "You're offline. Changes are kept on this device and sync when you're back.";
  $('#footNote').textContent = 'Synced to your own Neon and Cloudflare.';
  registerSW();
  if (!CLOUD.loggedIn) return showGate('login');
  if (!CLOUD.setup.done) { SETUP.step = 0; return showGate('setup'); }
  startCloudApp();
}
async function startCloudApp() {
  let local = null; try { local = JSON.parse(localStorage.getItem('forge:data')); } catch { }
  S = hydrate(local || {});
  CFG = await fetch('/api/config').then(r => r.json()).catch(() => CFG);
  startApp();
  await syncNow();
  if (SETUP.profile) { Object.assign(S.profile, SETUP.profile); SETUP.profile = null; commit(); }
  // AI apps work on the server, which needs your time zone for "today" and reminder times
  try { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; if (tz && S.profile.tz !== tz) { S.profile.tz = tz; save(); } } catch { }
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  addEventListener('online', () => syncNow());
  // Another Forge tab on this device saved: take its copy, so a stale tab never syncs old data as "deleted".
  addEventListener('storage', e => {
    try {
      if (e.key === 'forge:sync' && e.newValue) SY = { touched: {}, ...JSON.parse(e.newValue) };
      if (e.key === 'forge:data' && e.newValue) { S = hydrate(JSON.parse(e.newValue)); softRender(); }
    } catch { }
  });
  addEventListener('focus', () => { if (Date.now() - SY.at > 10000) syncNow(); });
  if (!S.profile.name) askName(); else { makeBrief('morning'); slowTick(); }
}
function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(() => { });
}

/* ---------------- Settings in the cloud ---------------- */
let CSTATS = null;
const quietRender = () => { if (view === 'settings' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) render(); };
const loadCloudStats = () => { loadConnect(); return fetch('/api/stats').then(r => r.json()).then(j => { CSTATS = j; quietRender(); }).catch(() => { }); };

/* ---------------- Connect an AI: tokens, signed-in apps, and what they changed ---------------- */
// CONNECT.fresh holds a token just made: shown once, never stored anywhere on this device.
let CONNECT = { tokens: [], apps: [], activity: [], mcpUrl: location.origin + '/mcp', fresh: null, loaded: false };
const loadConnect = () => Promise.all([fetch('/api/tokens').then(r => r.json()), fetch('/api/activity').then(r => r.json())])
  .then(([t, a]) => { Object.assign(CONNECT, { tokens: t.tokens || [], apps: t.apps || [], mcpUrl: t.mcpUrl || CONNECT.mcpUrl, activity: a.items || [], loaded: true }); quietRender(); }).catch(() => { });
const agoText = ms => { if (!ms) return 'never'; const s = (Date.now() - ms) / 1000; return s < 3600 ? 'in the last hour' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
const copyBtn = (text, label = 'Copy') => `<button type="button" class="btn sm" data-act="copyText" data-text="${esc(text)}">${label}</button>`;
const snippet = (title, text) => `<div class="ai-snip"><div class="ai-snip-h"><b>${title}</b>${copyBtn(text)}</div><pre>${esc(text)}</pre></div>`;
function connectHtml() {
  const C = CONNECT, url = C.mcpUrl;
  const f = C.fresh, tok = f?.token || 'YOUR_TOKEN';
  const fresh = f ? `<div class="ai-fresh">
      <p><b>Token for “${esc(f.name)}”</b> (${f.scope === 'read' ? 'only read' : 'read and change'}). Copy it now: Forge shows it only once.</p>
      <div class="ai-tok"><code>${esc(f.token)}</code>${copyBtn(f.token)}</div>
      ${snippet('Claude Code (terminal)', `claude mcp add --transport http forge ${url} --header "Authorization: Bearer ${tok}"`)}
      ${snippet('Antigravity (mcp_config.json)', JSON.stringify({ mcpServers: { forge: { serverUrl: url, headers: { Authorization: 'Bearer ' + tok } } } }, null, 2))}
      ${snippet('Cursor (~/.cursor/mcp.json)', JSON.stringify({ mcpServers: { forge: { url, headers: { Authorization: 'Bearer ' + tok } } } }, null, 2))}
      ${snippet('VS Code (.vscode/mcp.json)', JSON.stringify({ servers: { forge: { type: 'http', url, headers: { Authorization: 'Bearer ' + tok } } } }, null, 2))}
      <div class="row"><button type="button" class="btn sm" data-act="hideToken">I've saved it</button></div>
    </div>` : '';
  const list = (items, empty, row) => items.length ? `<ul class="ai-list">${items.map(row).join('')}</ul>` : empty == null ? `<ul class="ai-list" aria-busy="true">${'<li><span class="skel" style="width:46%"></span><span class="skel" style="width:64px"></span></li>'.repeat(2)}</ul>` : `<p class="small subtle">${empty}</p>`;
  return `<div class="ai">
    <div class="ai-url"><span class="small">Your Forge's AI address</span><div class="ai-tok"><code>${esc(url)}</code>${copyBtn(url)}</div></div>
    <div class="ai-cards">
      <div class="ai-card"><b>Claude (web, desktop, phone) · ChatGPT</b>
        <p class="small">In Claude: Settings → Connectors → <b>Add custom connector</b>. Name it Forge and paste the address above. Click Connect, and Forge asks for your passphrase and what Claude may do. ChatGPT: Settings → Connectors → Create, same address.</p></div>
      <div class="ai-card"><b>Claude Code · Antigravity · Cursor · VS Code</b>
        <p class="small">These use a token. Make one below, and Forge shows the exact settings to paste.</p>
        <form class="ai-new" data-form="aiToken">
          <input name="name" placeholder="Name, e.g. Antigravity on laptop" maxlength="60" required aria-label="Token name">
          <select name="scope" aria-label="What it may do"><option value="write">Read and change</option><option value="read">Only read</option></select>
          <button class="primary">Make a token</button>
        </form></div>
    </div>
    ${fresh}
    <h4 class="ai-h">Connected</h4>
    ${list([...C.apps.map(a => ({ ...a, kind: 'app' })), ...C.tokens.map(t => ({ ...t, kind: 'token' }))], C.loaded ? 'Nothing connected yet.' : null, x => `<li>
      <span><b>${esc(x.kind === 'app' ? x.app : x.name)}</b> <span class="pill">${x.scope === 'read' ? 'only read' : 'read and change'}</span><br>
      <span class="small subtle">${x.kind === 'app' ? `signed in · sends to ${esc(x.host)}` : `token · last used ${agoText(x.last)}`}</span></span>
      <button type="button" class="ghost" data-act="${x.kind === 'app' ? 'aiDisconnect' : 'aiRevoke'}" data-id="${esc(x.id)}">${x.kind === 'app' ? 'Disconnect' : 'Revoke'}</button></li>`)}
    <h4 class="ai-h">What AI apps changed</h4>
    ${list(C.activity.slice(0, 15), C.loaded ? 'No changes from AI apps yet.' : null, x => `<li class="${x.undone ? 'undone' : ''}">
      <span><b>${esc(x.client || 'AI app')}</b> · ${esc(x.summary || x.tool)}<br><span class="small subtle">${agoText(x.at)}</span></span>
      ${x.undone ? '<span class="small subtle">undone</span>' : `<button type="button" class="ghost" data-act="aiUndo" data-id="${x.id}">Undo</button>`}</li>`)}
    <p class="small subtle">AI apps never see your Neon, Cloudinary, NVIDIA or Groq keys. Anything they write in tasks or notes is treated as your data, and deleting needs your OK in the chat.</p>
  </div>`;
}
Object.assign(CLOUD_FORMS, {
  aiToken: async f => {
    try {
      const j = await withBusy(f.querySelector('button'), () => postJson('/api/tokens', { name: f.name.value, scope: f.scope.value }));
      CONNECT.fresh = j; f.reset(); await loadConnect(); render();
      document.querySelector('.ai-fresh')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (e) { toast(e.message); shake(f); }
  },
});
const apiDelete = async url => { const r = await fetch(url, { method: 'DELETE' }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'That did not work.'); };
Object.assign(CLOUD_ACT, {
  // the button itself says it worked: no toast for something you can see happen
  copyText: async el => {
    try {
      await navigator.clipboard.writeText(el.dataset.text);
      const was = el.dataset.label ??= el.textContent; el.textContent = 'Copied'; flash(el, 'did-ok', 1400);
      clearTimeout(el._t); el._t = setTimeout(() => { el.textContent = was; }, 1400);
    } catch { toast('Copy failed: select the text and copy it.'); shake(el); }
  },
  hideToken: () => { CONNECT.fresh = null; render(); },
  aiRevoke: async el => { if (!confirm('Revoke this token? Apps using it stop working within a minute.')) return; try { await apiDelete('/api/tokens/' + el.dataset.id); if (CONNECT.fresh?.id === el.dataset.id) CONNECT.fresh = null; await loadConnect(); toast('Revoked.'); } catch (e) { toast(e.message); } },
  aiDisconnect: async el => { if (!confirm('Disconnect this app from your Forge?')) return; try { await apiDelete('/api/apps/' + encodeURIComponent(el.dataset.id)); await loadConnect(); toast('Disconnected.'); } catch (e) { toast(e.message); } },
  aiUndo: async el => {
    try { const j = await withBusy(el, () => postJson('/api/activity/undo', { id: Number(el.dataset.id) })); toast('Undone: ' + j.summary); await syncNow(); await loadConnect(); }
    catch (e) { toast(e.message); }
  },
});
function paintSyncLine() { const el = $('#syncLine'); if (el) el.textContent = syncLineText(); }
const syncLineText = () => offline ? 'Offline — changes wait on this device.' : SY.at ? `Last synced ${fmtTime(SY.at)}.` : 'Not synced yet.';
function cloudSettings() {
  const st = CSTATS;
  const connections = `<div class="cx-grid">${['db', 'images', 'coach', 'voice'].map(k => cxCard(k, false)).join('')}</div>`;
  const install = `<div class="set">
      <label>iPhone</label><p class="small">Open <b>${esc(location.host)}</b> in Safari → Share → <b>Add to Home Screen</b>. It opens like an app and works offline.</p>
      <label>Computer</label><p class="small">In Chrome or Edge, click the install icon at the right end of the address bar. Forge then opens in its own window.</p>
    </div>`;
  const data = `<div class="set">
      <label>Sync</label><div class="row" style="flex-wrap:wrap"><span class="small fg" id="syncLine">${esc(syncLineText())}</span><button class="btn sm" data-act="syncNowBtn">Sync now</button></div>
      <label>Using</label><div class="mono small fg">${st ? `${st.items ?? '?'} items in Neon${st.files ? ` · ${st.files.count} file${st.files.count === 1 ? '' : 's'}, ${fmtBytes(st.files.bytes)} in Cloudinary (${Math.round(st.files.credits * 10) / 10} of ${st.files.limit} free credits this month)` : ''}` : '<span class="skel" style="width:220px"></span>'}</div>
      <label>Safety net</label><p class="small">Every night your Forge saves a copy of everything into your Cloudflare KV storage and keeps the last 30${st ? ` (${st.backups} now)` : ''}. Each device also keeps its own copy, so it works offline.</p>
      <label>Move it</label><div class="row"><button class="btn" data-act="export">Export backup</button><label class="btn" style="cursor:pointer">Import backup<input type="file" id="importFile" accept="application/json" hidden></label></div>
      <label>This device</label><div><button class="btn" data-act="logout">Log out</button></div>
    </div>`;
  return `${section('Connections', null, 'Your own database, image storage, coach and voice. Keys stay in your Cloudflare account and never reach this page.', connections)}${GAP}
    ${section('Connect an AI', null, 'Use Forge from Claude, Antigravity, Cursor or ChatGPT: ask what is on today, add tasks, start timers, all from your own chats.', connectHtml())}${GAP}
    ${section('Install', null, 'Put Forge on your home screen and your desktop.', install)}${GAP}
    ${section('Data', null, 'In your own cloud. Back it up. Move it. It is yours.', data)}${GAP}`;
}
