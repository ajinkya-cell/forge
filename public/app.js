/* Forge — state and behaviour. State lives in S, is saved to the local server (and mirrored in the browser),
   and every view re-renders from it. Rendering is in views.js, the board canvas in board.js. */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const pad = n => String(n).padStart(2, '0');
const dkey = (d = new Date()) => { d = new Date(d); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const today = () => dkey();
const addDays = (k, n) => { const d = new Date(k + 'T00:00'); d.setDate(d.getDate() + n); return dkey(d); };
const localInput = ms => { const d = new Date(ms); return `${dkey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const fmtTime = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !S.profile.clock24 });
const mmss = s => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;

const AREAS = {
  studies: { label: 'Studies', color: 'var(--area-studies)' },
  coding: { label: 'Coding', color: 'var(--area-coding)' },
  ventures: { label: 'Ventures', color: 'var(--area-ventures)' },
  life: { label: 'Health & personal', color: 'var(--area-life)' },
};
const TITLES = ['Spark', 'Apprentice', 'Striker', 'Smith', 'Operator', 'Machine', 'Veteran', 'Relentless', 'Master', 'Legend'];
const DEFAULTS = {
  profile: { name: '', theme: 'dark', pen: '', clock24: false, clockStyle: 'digital', calOpen: false, heroMode: 'clock', eveningHour: 21, focusMin: 50,
    goalHours: 8, minCount: 1, sound: 'chime', volume: 0.6, tick: false, notifyEnd: true, titleTimer: true, wakeLock: false },
  projects: [], tasks: [], board: [], notes: [], boardCam: null, sessions: [], xpEvents: [], reminders: [], memory: [], chat: [], chatUnread: false, briefs: {}, bonus: {}, timer: null, cycle: null, savedAt: 0,
};

let S = structuredClone(DEFAULTS);
let CFG = { hasKey: false, hasGroq: false, baseUrl: '', model: '' };
let MODELS = [];
const loadModels = () => fetch('/api/models').then(r => r.json()).then(j => { MODELS = j.models || []; if (view === 'settings' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) render(); }).catch(() => { });
let view = 'today';
let taskFilter = { area: null, project: null };
let boardFilter = { tag: null, q: '' };
let calSel = null, calMonth = null;
let shownView = null;
let busy = { chat: false, brief: false };

/* ---------------- persistence: server first, browser copy as a safety net ---------------- */
let saveT, retryT, offline = false;
function save() {
  S.savedAt = Date.now();
  try { localStorage.setItem('forge:data', JSON.stringify(S)); } catch { }
  if (CLOUD) syncNote();
  clearTimeout(saveT); saveT = setTimeout(push, CLOUD ? 1200 : 300);
}
async function push() {
  if (CLOUD) return syncNow();
  try {
    const r = await fetch('/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(S) });
    if (!r.ok) throw 0;
    setOffline(false);
  } catch { setOffline(true); }
}
function setOffline(v) {
  if (offline === v) return;
  offline = v; $('#offline').hidden = !v;
  clearInterval(retryT); if (v) retryT = setInterval(push, CLOUD ? 10000 : 5000);
  else toast('Back online. Everything is saved.');
}
function commit(focusSel) { save(); render(); if (focusSel) $(focusSel)?.focus(); }

/* ---------------- feedback: toasts, sound, notifications ---------------- */
function toast(text, cls = '', ms = 3200) {
  const el = document.createElement('div');
  el.className = 'toast ' + cls; el.textContent = text;
  // leave the way it came in, so the eye isn't yanked by a sudden gap
  $('#toasts').append(el); setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 220); }, ms);
}
/* ---------------- feedback for things that take a moment ---------------- */
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)');
// replay a one-shot class (did-ok, did-err, shake) even if it is still on the element
const flash = (el, cls, ms = 900) => { if (!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), ms); };
const shake = el => flash(el, 'shake', 420);
// a button that starts async work shows it is working, then a tick or a shake; it can't be pressed twice
async function withBusy(btn, fn) {
  if (!btn) return fn();
  if (btn.getAttribute('aria-busy') === 'true') return new Promise(() => { }); // a second press waits on the first, silently
  btn.setAttribute('aria-busy', 'true'); btn.disabled = true;
  try { const r = await fn(); if (btn.isConnected) flash(btn, 'did-ok'); return r; }
  catch (e) { if (btn.isConnected) flash(btn, 'did-err', 420); throw e; }
  finally { btn.removeAttribute('aria-busy'); btn.disabled = false; }
}
let audio;
function chime() {
  try {
    audio ??= new AudioContext();
    [660, 880].forEach((f, i) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f; o.type = 'sine'; o.connect(g); g.connect(audio.destination);
      const t = audio.currentTime + i * .16;
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.18, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .5);
      o.start(t); o.stop(t + .55);
    });
  } catch { }
}
function notify(title, body) {
  playSound(S.profile.sound || 'chime'); toast(`${title}${body ? ' — ' + body : ''}`, '', 7000);
  if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon: '/icon-192.png' });
}
function askNotify() {
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().then(() => view === 'settings' && render());
}

/* ---------------- XP, levels, streaks ---------------- */
const totalXp = () => Math.max(0, S.xpEvents.reduce((a, e) => a + e.a, 0));
const levelOf = xp => Math.floor(Math.sqrt(xp / 60)) + 1;
const levelFloor = l => 60 * (l - 1) ** 2;
const titleOf = l => TITLES[Math.min(l - 1, TITLES.length - 1)];
function award(a, r) {
  const before = levelOf(totalXp());
  S.xpEvents.push({ t: Date.now(), a, r });
  if (a > 0) toast(`+${a} XP`, 'xp', 1800);
  const after = levelOf(totalXp());
  if (after > before) { chime(); toast(`Level ${after} — ${titleOf(after)}`, 'big', 5000); }
}
function dayIndex() {
  const idx = {}; const at = k => idx[k] ??= { tasks: 0, focus: 0, xp: 0 };
  S.tasks.forEach(t => t.done && t.doneAt && at(dkey(t.doneAt)).tasks++);
  S.sessions.forEach(s => at(dkey(s.t)).focus += s.sec);
  S.xpEvents.forEach(e => at(dkey(e.t)).xp += e.a);
  return idx;
}
function streaks(idx) {
  const active = k => idx[k] && (idx[k].tasks > 0 || idx[k].focus >= 900);
  let cur = 0, k = today();
  if (!active(k)) k = addDays(k, -1);
  while (active(k)) { cur++; k = addDays(k, -1); }
  let best = 0, run = 0, prev = null;
  Object.keys(idx).filter(active).sort().forEach(x => { run = prev && addDays(prev, 1) === x ? run + 1 : 1; best = Math.max(best, run); prev = x; });
  return { cur, best: Math.max(best, cur), safe: !!active(today()) };
}

/* ---------------- tasks ---------------- */
const openTasks = () => S.tasks.filter(t => !t.done);
const top3 = () => S.tasks.filter(t => t.top3 === today());
const taskById = id => S.tasks.find(t => t.id === id);
function parseQuick(text) {
  const out = { title: text, area: null, priority: 'med', due: null };
  out.title = out.title.replace(/(^|\s)#(\w+)/g, (m, s, w) => {
    const k = Object.keys(AREAS).find(a => a.startsWith(w.toLowerCase()) || AREAS[a].label.toLowerCase().startsWith(w.toLowerCase()));
    if (k) { out.area = k; return s; } return m;
  }).replace(/(^|\s)!(high|med|low|h|m|l)(?=\s|$)/i, (m, s, w) => { out.priority = { h: 'high', m: 'med', l: 'low' }[w[0].toLowerCase()]; return s; })
    .replace(/(^|\s)(today|tomorrow)(?=\s|$)/i, (m, s, w) => { out.due = w.toLowerCase() === 'today' ? today() : addDays(today(), 1); return s; })
    .replace(/\s+/g, ' ').trim();
  return out;
}
function addTask(fields) {
  const t = { id: uid(), title: '', area: 'life', projectId: null, priority: 'med', due: null, notes: '', done: false, doneAt: null, top3: null, xp: 0, createdAt: Date.now(), ...fields };
  t.area = fields.area || S.projects.find(p => p.id === t.projectId)?.area || 'life';
  S.tasks.push(t); return t;
}
function setDone(t, done) {
  if (done && !t.done) {
    t.done = true; t.doneAt = Date.now();
    t.xp = 10 + ({ high: 10, med: 5 }[t.priority] || 0) + (t.top3 === today() ? 15 : 0);
    award(t.xp, t.title);
    const three = top3();
    if (three.length === 3 && three.every(x => x.done) && !S.bonus[today()]) { S.bonus[today()] = true; award(30, 'Top 3 cleared'); toast('Top 3 cleared. That is how it is done.', 'big', 4500); }
    S.reminders = S.reminders.filter(r => r.taskId !== t.id || r.fired);
  } else if (!done && t.done) {
    t.done = false; t.doneAt = null;
    if (t.xp) { S.xpEvents.push({ t: Date.now(), a: -t.xp, r: 'Reopened: ' + t.title }); t.xp = 0; }
  }
  if (t.noteId) ntSyncTask(t); // the checklist line it came from follows
}
function setTop3(t, on) {
  if (on && top3().length >= 3) return toast('Three is the limit. Finish one or swap one out.');
  t.top3 = on ? today() : null;
}

/* The focus timer and stopwatch live in timer.js. */

/* ---------------- reminders ---------------- */
function addReminder(text, at, taskId = null) {
  if (!text || !at || isNaN(at)) return null;
  const r = { id: uid(), text, at, fired: false, taskId };
  S.reminders.push(r); return r;
}
function checkReminders() {
  const now = Date.now(); let hit = false;
  S.reminders.forEach(r => { if (!r.fired && r.at <= now) { r.fired = true; hit = true; notify('Reminder', r.text); } });
  S.reminders = S.reminders.filter(r => !r.fired || now - r.at < 864e5);
  if (hit) commit();
}

/* ---------------- task dialog ---------------- */
function openTaskDialog(t) {
  const rem = S.reminders.find(r => r.taskId === t.id && !r.fired), d = $('#taskDialog');
  d.innerHTML = `<form data-form="taskEdit" data-id="${t.id}"><h2>Edit task</h2><div class="f">
    <div class="full"><label>Title</label><input type="text" name="title" value="${esc(t.title)}" required></div>
    <div><label>Area</label><select name="area">${Object.entries(AREAS).map(([k, a]) => `<option value="${k}" ${t.area === k ? 'selected' : ''}>${a.label}</option>`).join('')}</select></div>
    <div><label>Project</label><select name="projectId"><option value="">None</option>${S.projects.map(p => `<option value="${p.id}" ${t.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
    <div><label>Priority</label><select name="priority">${['high', 'med', 'low'].map(p => `<option ${t.priority === p ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
    <div><label>Due</label><input type="date" name="due" value="${esc(t.due || '')}"></div>
    <div class="full"><label>Remind me at</label><input type="datetime-local" name="remind" value="${rem ? localInput(rem.at) : ''}"></div>
    <div class="full"><label>Notes</label><textarea name="notes" rows="3">${esc(t.notes)}</textarea></div>
  </div><div class="foot"><button type="button" class="ghost" style="color:var(--bad)" data-act="delTask" data-id="${t.id}">Delete</button><div class="row"><button type="button" class="ghost" data-act="closeDialog">Cancel</button><button class="primary">Save</button></div></div></form>`;
  d.showModal();
}

/* ---------------- the coach ---------------- */
async function ai(messages, opts = {}) {
  const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, ...opts }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'The AI request failed.');
  return { content: j.content || '', tool_calls: j.tool_calls || null, toolsOff: !!j.toolsOff, model: j.model };
}
function contextText() {
  const idx = dayIndex(), st = streaks(idx), td = idx[today()] || { tasks: 0, focus: 0 }, tk = today();
  const line = taskLine;
  const board = S.board.filter(b => ['note', 'text', 'link'].includes(b.kind)).slice(-10).map(b => `"${(b.text || b.meta?.title || b.url || '').slice(0, 80)}"${b.tags?.length ? ' #' + b.tags.join(' #') : ''}`);
  return `Now: ${new Date().toLocaleString([], { weekday: 'long' })} ${localInput(Date.now())}
User: ${S.profile.name || 'unknown'} | Level ${levelOf(totalXp())} | Streak ${st.cur} days (${st.safe ? 'safe today' : 'NOT yet secured today'})
Today so far: ${td.tasks} tasks done, ${Math.round(td.focus / 60)} focus minutes
Today's top 3:\n${top3().map(line).join('\n') || '(not picked)'}
Open tasks:\n${openTasks().filter(t => t.top3 !== tk).slice(0, 40).map(line).join('\n') || '(none)'}
Projects: ${S.projects.map(p => `${p.name} (${p.area}${p.deadline ? ', deadline ' + p.deadline : ''}, ${S.tasks.filter(t => t.projectId === p.id && !t.done).length} open)`).join('; ') || '(none)'}
Pending reminders: ${S.reminders.filter(r => !r.fired).map(r => `[${r.id}] ${r.text} @ ${localInput(r.at)}`).join('; ') || '(none)'}
Done today: ${S.tasks.filter(t => t.done && dkey(t.doneAt) === tk).map(line).join('; ') || '(none)'}
Latest board items: ${board.join(' | ') || '(none)'}
Notes (newest first, use read_note for the text): ${S.notes.filter(n => !n.archived).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 12).map(n => `[${n.id}] "${(n.title || ntPlain(n.html).slice(0, 40) || 'Untitled').slice(0, 60)}"${n.inbox ? ' (Inbox)' : ''}`).join(' | ') || '(none)'}
Things the user asked you to remember:\n${(S.memory || []).slice(-30).map(m => `[${m.id}] ${m.text}`).join('\n') || '(nothing yet)'}
Timer: ${!S.timer ? 'none running' : S.timer.kind === 'stopwatch' ? `stopwatch ${timerRunning() ? 'running' : 'paused'}` : `${Math.round(S.timer.dur / 60)} min focus, ${Math.ceil(timerLeft() / 60)} min left, ${timerRunning() ? 'running' : 'paused'}`}`;
}
const SYSTEM = () => `You are Forge, the productivity coach inside ${S.profile.name || 'the user'}'s personal dashboard.
Personality: tough coach. Blunt, direct, zero fluff, no flattery. Call out procrastination, vague plans and overloaded days. You are hard on them because you are on their side. Never insulting.
Style: plain text only, no markdown, no asterisks. Under 110 words unless they ask for a full plan.
You can act on the dashboard with your tools: timers, tasks, top 3, reminders, board notes, notes (lists and brain dumps on the Notes page), memory, switching pages.
How to act:
- The DASHBOARD STATE below is live and always wins over anything said earlier in this chat. Never answer about the timer, tasks or reminders from memory of the conversation; read the state.
- A direct instruction ("start a 30 min timer", "add…", "pause it") is permission: call the tool in this same turn, then confirm in one short sentence. Only ask first if a tool returns an error that needs their choice.
- When the user lists several things to do (a brain dump), add them all with ONE add_tasks call. Infer area, priority and due date from what they said ("urgent" = high, "tomorrow" = a date). Then name what you filed in a line, and ask only about what was truly unclear.
- Use only task ids from the dashboard state or from find_tasks. Times are local; resolve "tomorrow", "Friday", "6pm" against Now.
- Projects: "a new project called X" or "in project X" means the project tool or the project field on add_tasks. The task title is the action ("Change the background"), not the project name. A project named in add_tasks is created if it does not exist. "Create a project called X" creates X even if a project with a similar name exists; do not ask.
- Timer words: "stop", "hold", "pause" = control_timer pause (time is kept). Only "end", "finish", "cancel", "reset", "log it" = end. "start/continue" while paused = resume.
- Refer to tasks by what the user calls them; match them to ids from the state or find_tasks. If two tasks could match, ask which. Never show ids (the [abc123] codes) to the user; name things by title.
- When they share a lasting fact about themselves (an exam date, a goal, how they like to work), save it with the memory tool. Use what you remember when you plan.
- Questions ("what's left today?", "how was my week?") need no change: read the state or use find_tasks / get_progress, then answer briefly.
- Messages marked (spoken) came from the microphone: they are commands, so act first and keep the reply to one or two sentences. Speech can be misheard: if a spoken message makes no sense for this app, say what you heard and ask them to repeat it instead of guessing. Before deleting anything on a spoken request, ask them to confirm.
- Only act when they ask or clearly agree. Never invent tasks they did not mention.
If your tools are unavailable, write each call on its own line at the very end as <action>{"name":"tool_name","arguments":{...}}</action>.

DASHBOARD STATE
${contextText()}`;

const SUGGEST = ['Plan my day', 'What am I avoiding?', 'Break my top task into steps', 'Am I overloaded?'];
function paintChat(typing) {
  const log = $('#chatLog');
  $('#agentStatus').textContent = CFG.hasKey ? (CFG.model || '').split('/').pop() + (CFG.hasGroq ? ' · voice on' : '') : 'no brain yet · briefings only';
  $('#micBtn').hidden = !CFG.hasGroq;
  const intro = CFG.hasKey ? `I'm Forge. Tell me what you're avoiding, or ask me to plan your day. I can start timers, add and update tasks, pick your top 3, set reminders, pin notes and remember what matters.${CFG.hasGroq ? ' Click the mic or hold Alt+V and just talk.' : ''}`
    : `I'm Forge. I already write your morning brief and evening recap. To actually talk, add a free API key in Settings → Coach.`;
  const msgs = S.chat.map(m => m.role === 'did' ? `<div class="did">${ic('check', 12)}${esc(m.content)}</div>` : `<div class="msg ${m.role === 'user' ? 'user' : m.role === 'err' ? 'bot err' : 'bot'}${m.voice ? ' voice' : ''}">${esc(m.content)}</div>`).join('');
  const chips = !typing && CFG.hasKey && !S.chat.some(m => m.role === 'user') ? `<div class="chat-sugg">${CFG.hasGroq ? `<button class="tag dump" data-act="micChat">${MIC_SVG}Brain dump</button>` : ''}${SUGGEST.map(s => `<button class="tag" data-act="chatSuggest" data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : '';
  log.innerHTML = `<div class="msg bot">${esc(intro)}</div>${msgs}${chips}${typing ? '<div class="msg bot typing"><i></i><i></i><i></i></div>' : ''}`;
  log.scrollTop = log.scrollHeight;
}
function openAgent(open = true) {
  const a = $('#agent'), fab = $('#fab');
  a.classList.toggle('open', open); fab.setAttribute('aria-expanded', open);
  if (open) { S.chatUnread = false; $('#fabDot').hidden = true; save(); paintChat(); setTimeout(() => $('#chatInput').focus(), 60); }
  else if (a.contains(document.activeElement)) document.activeElement.blur();
}
/* Ask, run whatever tools the coach calls, hand the results back, and repeat until it answers in words. */
async function sendChat(text, opts = {}) {
  if (busy.chat || !text.trim()) return;
  S.chat = S.chat.filter(m => m.role !== 'err');
  S.chat.push({ role: 'user', content: text.trim(), ...(opts.voice ? { voice: true } : {}) });
  busy.chat = true; paintChat(true);
  const did = [];
  try {
    const history = S.chat.filter(m => m.role === 'user' || m.role === 'assistant').slice(-14)
      .map(m => ({ role: m.role, content: m.voice ? '(spoken) ' + m.content : m.content }));
    const msgs = [{ role: 'system', content: SYSTEM() }, ...history];
    let final = '', nudged = false;
    for (let round = 0; round < 5; round++) {
      let m;
      try { m = await ai(msgs, { tools: COACH_TOOLS }); }
      catch (e) { if (did.length) break; throw e; } // the actions already happened: confirm them rather than show an error
      let calls = (m.tool_calls || []).map(c => ({ id: c.id, name: c.function.name, args: parseArgs(c.function.arguments) }));
      const parsed = parseTextCalls(m.content);
      final = parsed.text;
      if (!calls.length && parsed.calls.length) {
        // written as text: run them, and that reply is the answer
        parsed.calls.forEach(([name, args]) => { const r = runTool(name, args); if (r.did) did.push(r.did); });
        break;
      }
      if (!calls.length) {
        // It says it did something, but no tool ran, so nothing changed. Give it one nudge to actually do it.
        const claims = /\b(started|paused|resumed|stopped|ended|extended|added|created|deleted|removed|renamed|moved|marked|completed|scheduled|remembered|switched|changed|pinned|cleared|updated|logged|set (?:a |the |your )?(?:reminder|timer|top|deadline|goal))\b/i;
        if (!nudged && !did.length && claims.test(final) && !/\?\s*$/.test(final)) {
          nudged = true;
          msgs.push({ role: 'assistant', content: m.content || '' }, { role: 'user', content: '(check) No tool was called, so nothing on the dashboard changed. If I asked for an action, call the tool now. Otherwise answer again without claiming you did anything.' });
          continue;
        }
        break;
      }
      msgs.push({ role: 'assistant', content: m.content || '', tool_calls: m.tool_calls });
      for (const c of calls) {
        const r = runTool(c.name, c.args);
        if (r.did) did.push(r.did);
        msgs.push({ role: 'tool', tool_call_id: c.id, name: c.name, content: r.result });
      }
      commit(); // show each change as it happens (a timer starting, a task appearing)
      paintChat(true);
    }
    // the chat shows plain text: drop markdown the model slips in anyway
    final = final.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/^\s*\*\s+/gm, '- ').trim();
    S.chat.push({ role: 'assistant', content: final || (did.length ? 'Done.' : "I couldn't work that out. Say it another way?") });
  } catch (e) { S.chat.push({ role: 'err', content: e.message }); }
  did.forEach(d => S.chat.push({ role: 'did', content: d }));
  busy.chat = false; S.chat = S.chat.slice(-60);
  commit(); paintChat();
}
function localBrief(kind) {
  const idx = dayIndex(), st = streaks(idx), td = idx[today()] || { tasks: 0, focus: 0, xp: 0 }, tk = today();
  const open = openTasks(), over = open.filter(t => t.due && t.due < tk).length, three = top3(), n = S.profile.name || 'Listen';
  if (kind === 'morning') return `${n}, you have ${open.length} open task${open.length === 1 ? '' : 's'}${over ? ` and ${over} already overdue. Deal with those first` : ''}. ${three.length ? `Your three today: ${three.map(t => t.title).join('; ')}. Start with the one you least want to do.` : open.length ? 'You have not picked your top 3. Do that before anything else.' : 'Nothing is planned. Write down three things that would make today count.'} ${st.cur ? `Streak is at ${st.cur}. Do not be the one who breaks it.` : 'No streak yet. Today is day one.'}`;
  const missed = three.filter(t => !t.done);
  return `Day's nearly over. ${td.tasks} task${td.tasks === 1 ? '' : 's'} finished, ${Math.round(td.focus / 60)} minutes of focus, ${td.xp} XP. ${!st.safe ? 'Your streak is not secured yet — one task or 15 focused minutes before midnight.' : missed.length ? `Still open from your top 3: ${missed.map(t => t.title).join('; ')}. Finish or reschedule, do not ignore.` : three.length ? 'Top 3 cleared. Good. Same again tomorrow.' : 'You got something done without a plan. Imagine with one.'}`;
}
const briefRetried = new Set();
async function makeBrief(kind) {
  const have = S.briefs[today()]?.[kind];
  // A brief written without the AI gets one AI rewrite per session once a key works.
  if (busy.brief || (have && !(S.briefs[today()].local && CFG.hasKey && !briefRetried.has(kind)))) return;
  if (have) briefRetried.add(kind);
  busy.brief = true;
  let text = localBrief(kind), local = true;
  if (CFG.hasKey) {
    try {
      const ask = kind === 'morning' ? 'Give me my morning briefing: what to attack first and why, and anything I am neglecting. Four sentences max. No action tags.' : 'Give me my evening recap: judge my day honestly from the numbers, then tell me the one thing to set up for tomorrow. Four sentences max. No action tags.';
      text = parseTextCalls((await ai([{ role: 'system', content: SYSTEM() }, { role: 'user', content: ask }], { max_tokens: 300 })).content).text || text; local = false;
    } catch { }
  }
  if (have && local) { busy.brief = false; return; } // the AI rewrite failed: keep what we had, say nothing
  (S.briefs[today()] ??= {})[kind] = text; S.briefs[today()].local = local;
  Object.keys(S.briefs).filter(k => k < addDays(today(), -14)).forEach(k => delete S.briefs[k]);
  S.chat.push({ role: 'assistant', content: (kind === 'morning' ? 'Morning brief. ' : 'Evening recap. ') + text });
  S.chat = S.chat.slice(-60);
  if (!$('#agent').classList.contains('open')) S.chatUnread = true; else paintChat();
  busy.brief = false;
  if (kind === 'evening') notify('Evening recap', text);
  commit();
}

/* ---------------- actions ---------------- */
const ACT = {
  toggleAgent: () => openAgent(!$('#agent').classList.contains('open')),
  chatSuggest: el => sendChat(el.dataset.s),
  toggleDone: el => {
    const t = taskById(el.dataset.id); if (!t) return;
    // finishing gets a beat of follow-through (tick, strike, fade) before the list moves on
    const row = el.closest('.task');
    if (!t.done && row && !REDUCED.matches) {
      if (row.classList.contains('completing')) return;
      row.classList.add('completing'); el.setAttribute('aria-pressed', 'true');
      setTimeout(() => { if (!t.done) { setDone(t, true); commit(); } }, 420);
      return;
    }
    setDone(t, !t.done); commit();
  },
  toggleTop3: el => { const t = taskById(el.dataset.id); setTop3(t, t.top3 !== today()); commit(); },
  editTask: el => { const t = taskById(el.dataset.id); if (t) openTaskDialog(t); },
  delTask: el => { S.tasks = S.tasks.filter(t => t.id !== el.dataset.id); S.reminders = S.reminders.filter(r => r.taskId !== el.dataset.id); $('#taskDialog').close(); commit(); },
  closeDialog: () => $('#taskDialog').close(),
  delReminder: el => { S.reminders = S.reminders.filter(r => r.id !== el.dataset.id); commit(); },
  filterArea: el => { taskFilter.area = el.dataset.area || null; render(); },
  homeTasks: () => { homeTasksOpen = !homeTasksOpen; render(); },
  moreDone: () => { doneShown += 20; render(); },
  openDone: () => { view = 'tasks'; doneShown = 20; render(); requestAnimationFrame(() => $('#done')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); },
  filterProject: el => { taskFilter.project = el.dataset.id || null; render(); },
  delProject: (el, e) => { e.stopPropagation(); if (!confirm('Delete this project? Its tasks stay.')) return; S.projects = S.projects.filter(p => p.id !== el.dataset.id); S.tasks.forEach(t => { if (t.projectId === el.dataset.id) t.projectId = null; }); if (taskFilter.project === el.dataset.id) taskFilter.project = null; commit(); },
  cycleProjColor: (el, e) => { e.stopPropagation(); const p = S.projects.find(p => p.id === el.dataset.id); if (!p) return; p.color = PROJ_COLORS[(PROJ_COLORS.indexOf(projColor(p)) + 1) % PROJ_COLORS.length]; commit(); },
  clock: el => { S.profile.clock24 = !!el.dataset.v; commit(); },
  askNotify,
  testAi: async () => { toast('Testing…', '', 1500); try { const out = await ai([{ role: 'user', content: 'Reply with exactly: ready' }], { max_tokens: 10 }); toast('Connected. The model says: ' + out.slice(0, 40)); } catch (e) { toast(e.message, '', 8000); } },
  export: () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' })); a.download = `forge-backup-${today()}.json`; a.click(); URL.revokeObjectURL(a.href); },
};
const FORMS = {
  quickTask: f => { const q = parseQuick(f.title.value); if (!q.title) return; addTask({ title: q.title, area: q.area || (view === 'tasks' ? taskFilter.area : null), priority: q.priority, due: q.due, projectId: view === 'tasks' ? taskFilter.project : null }); commit(view === 'tasks' ? '#quickTasks' : '#quickToday'); },
  calAdd: f => { const q = parseQuick(f.title.value); if (!q.title) return; addTask({ title: q.title, area: q.area, priority: q.priority, due: q.due || calSel || today() }); commit('#calAddIn'); },
  top3new: f => { const q = parseQuick(f.title.value); if (!q.title || top3().length >= 3) return; addTask({ title: q.title, area: q.area || undefined, priority: q.priority, due: q.due || today(), top3: today() }); commit('.slot input'); },
  reminder: f => { if (addReminder(f.text.value.trim(), new Date(f.at.value).getTime())) { askNotify(); commit(); } },
  project: f => { S.projects.push({ id: uid(), name: f.name.value.trim(), area: f.area.value, deadline: f.deadline.value || null, color: f.color?.value || null }); commit(); },
  taskEdit: f => {
    const t = taskById(f.dataset.id);
    Object.assign(t, { title: f.title.value.trim() || t.title, area: f.area.value, projectId: f.projectId.value || null, priority: f.priority.value, due: f.due.value || null, notes: f.notes.value });
    S.reminders = S.reminders.filter(r => r.taskId !== t.id || r.fired);
    if (f.remind.value) { addReminder(t.title, new Date(f.remind.value).getTime(), t.id); askNotify(); }
    $('#taskDialog').close(); commit();
  },
  zoneAdd: f => {
    const z = f.z.value.trim(); if (!z) return;
    try { new Intl.DateTimeFormat('en', { timeZone: z }); } catch { return toast('Not a time zone I know. Try something like Asia/Tokyo.'); }
    S.profile.zones = [...new Set([...(S.profile.zones || []), z])]; commit();
  },
  chat: f => { const i = $('#chatInput'), v = i.value; i.value = ''; i.style.height = ''; sendChat(v); },
  ai: async f => {
    const body = { baseUrl: f.baseUrl.value, model: f.model.value }; if (f.apiKey.value) body.apiKey = f.apiKey.value; if (f.groqKey?.value) body.groqKey = f.groqKey.value;
    const r = await fetch('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    CFG = await r.json(); toast('Saved.'); render(); loadModels();
  },
  welcome: f => { S.profile.name = f.name.value.trim(); $('#welcome').close(); commit(); makeBrief('morning'); },
};

Object.assign(ACT, EXTRA_ACT, BOARD_ACT, NOTE_ACT, TIMER_ACT, COACH_ACT, CLOUD_ACT);
Object.assign(FORMS, BOARD_FORMS, CLOUD_FORMS);
initViewLayer();
document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (el && ACT[el.dataset.act]) ACT[el.dataset.act](el, e); });
document.addEventListener('submit', e => { const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault(); FORMS[f.dataset.form]?.(f); });
document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.set === 'sound') playSound(el.value);
  if (el.dataset.set) { S.profile[el.dataset.set] = (el.type === 'number' || el.type === 'range') ? Math.min(Number(el.max), Math.max(Number(el.min), Math.round((Number(el.value) || 0) * 2) / 2)) : el.value.trim(); commit(); }
  if (el.dataset.change === 'pullTop3' && el.value) { setTop3(taskById(el.value), true); commit(); }
  if (el.id === 'importFile' && el.files[0]) el.files[0].text().then(t => { const d = JSON.parse(t); if (!Array.isArray(d.tasks)) throw 0; if (confirm('Replace everything in Forge with this backup?')) { S = hydrate(d); commit(); toast('Backup restored.'); } }).catch(() => toast('That file is not a Forge backup.'));
});
document.addEventListener('input', e => {
  if (e.target.id === 'bdSearch') bdSearchInput(e.target.value);
  if (e.target.id === 'ntSearch') { NT.q = e.target.value; ntPaintGrid(); }
  if (e.target.id === 'chatInput') { e.target.style.height = ''; e.target.style.height = Math.min(140, e.target.scrollHeight) + 'px'; }
});
document.addEventListener('keydown', e => {
  if (coachKeyDown(e)) return;
  const typing = e.target.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName);
  if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'chatInput') { e.preventDefault(); e.target.form.requestSubmit(); return; }
  if (e.key === 'Escape' && $('#agent').classList.contains('open') && !document.querySelector('dialog[open]')) { openAgent(false); return; }
  if (e.key === '/' && !typing) { e.preventDefault(); ACT.toggleAgent(); return; }
  // Space starts or pauses the timer when it's showing on Today.
  if (e.key === ' ' && !typing && view === 'today' && S.profile.heroMode === 'timer' && !document.querySelector('dialog[open]') && !e.target.closest('button')) { e.preventDefault(); S.timer ? ACT.pauseTimer() : ACT.startTimer(); return; }
  // T flips the hero between the clock and the timer.
  if (e.key.toLowerCase() === 't' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && view === 'today' && !document.querySelector('dialog[open]')) { e.preventDefault(); ACT.heroMode({ dataset: { v: S.profile.heroMode === 'timer' ? 'clock' : 'timer' } }); return; }
  // N starts a new note from anywhere; Enter opens a focused note card
  if (e.key.toLowerCase() === 'n' && !typing && view !== 'board' && !e.ctrlKey && !e.metaKey && !e.altKey && !document.querySelector('dialog[open]')) { e.preventDefault(); ntStart(); return; }
  if (e.key === 'Enter' && e.target.classList?.contains('nt-card') && e.target.dataset.id) { e.preventDefault(); ntOpenNote(e.target.dataset.id); return; }
  if (e.key === 'Escape' && view === 'notes' && NT.open && !typing && !document.querySelector('dialog[open]')) { ntClose(); return; }
  bdKey(e);
});
document.addEventListener('keyup', e => { coachKeyUp(e); bdKeyUp(e); });
document.addEventListener('paste', e => bdPaste(e));
document.addEventListener('dragover', e => { if (view === 'board') e.preventDefault(); });
document.addEventListener('drop', e => { if (view === 'board' && !e.target.closest('#bd')) e.preventDefault(); });

/* ---------------- heartbeat ---------------- */
let lastDay = today();
function tick() {
  paintClock();
  timerTick();
}
function slowTick() {
  checkReminders();
  if (today() !== lastDay) { lastDay = today(); render(); makeBrief('morning'); }
  if (new Date().getHours() >= Number(S.profile.eveningHour) && S.profile.name) makeBrief('evening');
}

/* ---------------- stay up to date: reload when Forge's files change, but never mid-edit ---------------- */
let appVersion = null;
async function checkVersion() {
  try {
    const { v } = await (await fetch('/api/version')).json();
    if (appVersion === null) { appVersion = v; return; }
    if (v === appVersion) return;
    const a = document.activeElement, busyNow = a?.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(a?.tagName) || document.querySelector('dialog[open]') || BD.editing || BD.drag || busy.chat || REC.on || REC.busy || (view === 'notes' && NT.open);
    if (busyNow) return;
    clearTimeout(saveT); await push(); location.reload();
  } catch { }
}

/* ---------------- boot ---------------- */
/* The first board was a list of cards; give those a place on the canvas. */
function migrateBoard(list) {
  let i = 0;
  return (list || []).map(b => {
    if (b.kind) return b;
    const base = { id: b.id || uid(), x: (i % 4) * 320, y: Math.floor(i / 4) * 300, z: ++i, tags: b.tags || [], color: 'ink', t: b.t || Date.now() };
    if (b.type === 'image') return { ...base, kind: 'image', src: b.content, w: 280, h: 200 };
    if (b.type === 'link') return { ...base, kind: 'link', url: b.content, w: 280, h: 90 };
    return { ...base, kind: 'note', text: b.content, w: 240, h: 120 };
  });
}
function hydrate(d) {
  const s = { ...structuredClone(DEFAULTS), ...d, profile: { ...DEFAULTS.profile, ...(d?.profile || {}) } };
  s.board = migrateBoard(s.board);
  if (!Array.isArray(s.memory)) s.memory = [];
  if (s.timer && !s.timer.kind) s.timer.kind = 'focus';
  if (s.timer && !['focus', 'stopwatch'].includes(s.timer.kind)) s.timer = null; // break timers are gone
  ['shortMin', 'longMin', 'longEvery', 'autoBreak', 'autoFocus'].forEach(k => delete s.profile[k]);
  if (!s.profile.timerV2) { if (Number(s.profile.focusMin) === 25) s.profile.focusMin = 50; delete s.profile.goalMin; delete s.profile.zones; s.profile.timerV2 = true; }
  return s;
}
function startApp() { render(); setInterval(tick, 1000); setInterval(slowTick, 15000); loadModels(); }
function askName() {
  const w = $('#welcome');
  w.innerHTML = `<form data-form="welcome"><h2>What do I call you?</h2><input type="text" name="name" required autofocus placeholder="Your name"><p class="small muted" style="margin-top:14px">Pick three things a day. Do them. I'll keep score.</p><div class="foot"><span></span><button class="primary">Let's go</button></div></form>`;
  w.addEventListener('cancel', e => e.preventDefault()); w.showModal();
}
(async function boot() {
  // On Cloudflare: log in, set up, then sync. On the old local server: the file-based flow below.
  CLOUD = await detectCloud();
  if (CLOUD) return bootCloud();
  let local = null; try { local = JSON.parse(localStorage.getItem('forge:data')); } catch { }
  try {
    const [d, c] = await Promise.all([fetch('/api/data').then(r => { if (!r.ok) throw 0; return r.json(); }), fetch('/api/config').then(r => r.json())]);
    CFG = c;
    if (local && (local.savedAt || 0) > (d.savedAt || 0)) { S = hydrate(local); push(); } else S = hydrate(d);
  } catch {
    S = hydrate(local || {}); setOffline(true);
  }
  startApp(); loadSys(); checkVersion(); setInterval(checkVersion, 15000);
  if (!S.profile.name) askName(); else { makeBrief('morning'); slowTick(); }
})();
