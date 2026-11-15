/* Forge timer — a focus countdown and an open-ended stopwatch with laps, shown in the Today hero.
   S.timer is the running timer; S.cycle counts today's finished focus sessions.
   Loaded before app.js: nothing here runs until called. */
const TIMER_KINDS = { focus: 'Focus', stopwatch: 'Stopwatch' };
const SOUNDS = ['chime', 'bell', 'soft', 'digital', 'none'];
let timerMode = 'focus'; // what the idle panel is set up to start
let segFrom = null;      // tab the mode indicator slides from on the next paint
let timerLand = false;   // play the "settings come back" animation on the next idle paint
let timerBusy = false;   // a start animation is playing

const kindMinutes = () => Math.max(1, Number(S.profile.focusMin) || 50);
const timerLeft = (tm = S.timer) => !tm ? 0 : tm.endAt ? Math.max(0, (tm.endAt - Date.now()) / 1000) : tm.left;
const swElapsed = (tm = S.timer) => (tm.acc || 0) + (tm.startAt ? Date.now() - tm.startAt : 0);
const timerRunning = (tm = S.timer) => !!tm && (tm.kind === 'stopwatch' ? !!tm.startAt : !!tm.endAt);
const cycleCount = () => S.cycle?.day === today() ? S.cycle.done : 0;
const fmtHours = min => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`; };
const PRESETS = [25, 45, 50, 60, 90], STEP = 5, LIMIT = [5, 240];
const setFocusMinutes = v => { S.profile.focusMin = Math.min(LIMIT[1], Math.max(LIMIT[0], Math.round(v))); };
const hms = ms => { const s = Math.floor(ms / 1000), h = Math.floor(s / 3600); return (h ? h + ':' + pad(Math.floor(s / 60) % 60) : pad(Math.floor(s / 60))) + ':' + pad(s % 60); };
const focusToday = () => Math.round((dayIndex()[today()]?.focus || 0) / 60);
const goalMinutes = () => Math.round((Number(S.profile.goalHours) || 0) * 60);

function startTimer(taskId, kind = timerMode) {
  if (kind === 'stopwatch') S.timer = { kind, taskId: taskId || null, startAt: Date.now(), acc: 0, laps: [] };
  else { const dur = kindMinutes() * 60; S.timer = { kind: 'focus', taskId: taskId || null, dur, endAt: Date.now() + dur * 1000, left: dur }; }
  timerMode = S.timer.kind; S.profile.heroMode = 'timer'; askNotify(); keepAwake(true);
}
function pauseTimer() {
  const tm = S.timer; if (!tm) return;
  if (tm.kind === 'stopwatch') { if (tm.startAt) { tm.acc += Date.now() - tm.startAt; tm.startAt = null; } else tm.startAt = Date.now(); }
  else if (tm.endAt) { tm.left = timerLeft(); tm.endAt = null; } else tm.endAt = Date.now() + tm.left * 1000;
  keepAwake(timerRunning());
}
/* Focus time counts toward XP, streaks and the daily goal once it passes the minimum. */
function logFocus(sec, taskId) {
  const min = Math.max(0, Number(S.profile.minCount) || 1);
  if (sec < Math.max(60, min * 60)) return false;
  const before = focusToday();
  S.sessions.push({ id: uid(), t: Date.now(), sec, taskId });
  const task = taskById(taskId);
  award(Math.floor(sec / 60), `Focus ${Math.floor(sec / 60)} min${task ? ': ' + task.title : ''}`);
  const goal = goalMinutes(), after = before + Math.floor(sec / 60);
  if (goal && before < goal && after >= goal) { award(20, 'Daily focus goal'); toast(`Daily focus goal hit: ${fmtHours(goal)}.`, 'big', 4500); }
  return true;
}
function endTimer(completed) {
  const tm = S.timer; if (!tm) return;
  S.timer = null; keepAwake(false); timerLand = true;
  const minNote = `Under ${Math.max(1, Number(S.profile.minCount) || 1)} min does not count.`;
  if (tm.kind === 'stopwatch') { if (!logFocus(Math.round(swElapsed(tm) / 1000), tm.taskId)) toast(minNote); timerMode = 'stopwatch'; return; }
  timerMode = 'focus';
  const counted = logFocus(Math.round(tm.dur - (completed ? 0 : timerLeft(tm))), tm.taskId);
  if (!completed) { if (!counted) toast(minNote); return; }
  S.cycle = { day: today(), done: cycleCount() + 1 }; timerBurst = Date.now();
  endAlert('Focus session done', `That's ${S.cycle.done} today. Stretch, then go again.`);
}
function endAlert(title, body) {
  playSound(S.profile.sound);
  toast(`${title} — ${body}`, '', 7000);
  if (S.profile.notifyEnd !== false && 'Notification' in window && Notification.permission === 'granted') new Notification(title, { body, icon: '/icon-192.png' });
}

/* ---------------- sound ---------------- */
let actx;
function tone(freq, start, len, { type = 'sine', gain = .2 } = {}) {
  const vol = Math.max(0, Math.min(1, Number(S.profile.volume ?? .6)));
  if (!vol) return;
  actx ??= new AudioContext();
  const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + start;
  o.type = type; o.frequency.value = freq; o.connect(g); g.connect(actx.destination);
  g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(gain * vol, t + .015); g.gain.exponentialRampToValueAtTime(.0001, t + len);
  o.start(t); o.stop(t + len + .05);
}
function playSound(name = 'chime') {
  try {
    if (name === 'chime') { tone(660, 0, .5); tone(880, .16, .6); }
    else if (name === 'bell') { tone(880, 0, 1.8, { gain: .22 }); tone(1760, 0, 1.2, { gain: .06 }); tone(2640, 0, .8, { gain: .03 }); }
    else if (name === 'soft') { tone(392, 0, 1.2, { gain: .16 }); tone(523, .25, 1.4, { gain: .14 }); }
    else if (name === 'digital') [0, .18, .36].forEach(t => tone(1046, t, .1, { type: 'square', gain: .06 }));
  } catch { }
}
const tickSound = () => { try { tone(1500, 0, .03, { type: 'triangle', gain: .035 }); } catch { } };

/* ---------------- keep the screen on ---------------- */
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && S.profile.wakeLock && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => wakeLock = null); }
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && timerRunning()) keepAwake(true); });

/* ---------------- painting, once a second ---------------- */
function timerTick() {
  const tm = S.timer;
  if (tm?.endAt && timerLeft() <= 0) { endTimer(true); commit(); return; }
  if (S.profile.tick && timerRunning()) tickSound();
  paintTimer();
}
const DIAL_R = 160, DIAL_C = 2 * Math.PI * DIAL_R;
let timerBurst = 0, lastFrac = 0;
function timerText(tm = S.timer) {
  if (!tm) return timerMode === 'stopwatch' ? '00:00' : mmss(kindMinutes() * 60);
  return tm.kind === 'stopwatch' ? hms(swElapsed(tm)) : mmss(timerLeft(tm));
}
function timerSub(tm = S.timer) {
  if (!tm) return 'press Space to start';
  const who = taskById(tm.taskId)?.title || (tm.kind === 'stopwatch' ? 'Stopwatch' : 'Free focus');
  if (!timerRunning(tm)) return `${who} · paused`;
  if (tm.kind === 'stopwatch') { const l = tm.laps?.length; return l ? `Lap ${l} · +${hms(tm.laps[l - 1] - (tm.laps[l - 2] || 0))}` : `${who} · since ${fmtTime(Date.now() - swElapsed(tm))}`; }
  return `${who} · ends ${fmtTime(tm.endAt)}`;
}
function paintTimer() {
  const tm = S.timer, text = timerText(tm);
  const rail = $('#railTimer');
  rail.hidden = !tm;
  if (tm) { rail.textContent = text; rail.classList.toggle('paused', !timerRunning()); }
  document.title = tm && timerRunning() && S.profile.titleTimer !== false ? `${text} · ${TIMER_KINDS[tm.kind] || 'Focus'} · Forge` : 'Forge';
  const fc = $('#fcTime'); if (fc) fc.textContent = text;
  const t = $('#timerText'); if (!t) return;
  t.textContent = text; t.classList.toggle('long', text.length > 5);
  $('#timerSub').textContent = timerSub(tm);
  const frac = !tm ? 0 : tm.kind === 'stopwatch' ? (swElapsed(tm) % 6e4) / 6e4 : Math.min(1, 1 - timerLeft(tm) / tm.dur);
  const back = frac < lastFrac; lastFrac = frac;
  const prog = $('#tProg'), glow = $('#tGlow'), comet = $('#tComet');
  [prog, glow, comet].forEach(el => el.style.transition = back ? 'none' : '');
  prog.style.strokeDashoffset = glow.style.strokeDashoffset = DIAL_C * (1 - frac);
  comet.style.transform = `rotate(${frac * 360}deg)`;
  const lit = Math.floor(frac * 60 + 1e-6);
  document.querySelectorAll('#tTicks line').forEach((l, i) => l.classList.toggle('lit', i < lit));
}

/* ---------------- the big timer, in the hero ---------------- */
function dialSvg() {
  let ticks = '', sparks = '';
  for (let i = 0; i < 60; i++) {
    const a = i * Math.PI / 30, s = Math.sin(a), c = -Math.cos(a), big = i % 5 === 0, r1 = big ? 174 : 179;
    ticks += `<line x1="${(s * r1).toFixed(1)}" y1="${(c * r1).toFixed(1)}" x2="${(s * 188).toFixed(1)}" y2="${(c * 188).toFixed(1)}" class="tk${big ? ' big' : ''}"/>`;
  }
  for (let i = 0; i < 18; i++) {
    const a = i * Math.PI / 9 + .17, s = Math.sin(a), c = -Math.cos(a);
    sparks += `<line x1="${(s * 196).toFixed(1)}" y1="${(c * 196).toFixed(1)}" x2="${(s * 214).toFixed(1)}" y2="${(c * 214).toFixed(1)}"/>`;
  }
  return `<svg viewBox="-200 -200 400 400" aria-hidden="true">
    <defs>
      <linearGradient id="tGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" class="g1"/><stop offset="1" class="g2"/></linearGradient>
      <radialGradient id="tFace" cx="50%" cy="38%" r="62%"><stop offset="0" class="f0"/><stop offset="1" class="f1"/></radialGradient>
    </defs>
    <circle r="148" class="face" fill="url(#tFace)"/>
    <g id="tTicks">${ticks}</g>
    <circle r="${DIAL_R}" class="trk"/><circle r="138" class="inner"/>
    <circle r="${DIAL_R}" class="glow" id="tGlow" transform="rotate(-90)" stroke-dasharray="${DIAL_C.toFixed(2)}" stroke-dashoffset="${DIAL_C.toFixed(2)}"/>
    <circle r="${DIAL_R}" class="prog" id="tProg" transform="rotate(-90)" stroke="url(#tGrad)" stroke-dasharray="${DIAL_C.toFixed(2)}" stroke-dashoffset="${DIAL_C.toFixed(2)}"/>
    <g class="comet" id="tComet"><circle cy="-${DIAL_R}" r="16" class="c2"/><circle cy="-${DIAL_R}" r="6" class="c1"/></g>
    <g class="sparks">${sparks}</g>
  </svg>`;
}
/* Everything you set before starting, on the right of the dial. It wipes away when the timer starts. */
function timerPanel(openTasks, suggestId) {
  const p = S.profile, kind = timerMode, cur = kindMinutes(), keys = Object.keys(TIMER_KINDS);
  const tabs = `<div class="seg${segFrom != null ? ' slide' : ''}" role="tablist" aria-label="Timer mode" style="--i:${keys.indexOf(kind)};--from:${segFrom ?? keys.indexOf(kind)}">${keys.map(k => `<button role="tab" aria-selected="${kind === k}" class="${kind === k ? 'on' : ''}" data-act="timerMode" data-k="${k}">${TIMER_KINDS[k]}</button>`).join('')}</div>`;
  segFrom = null;
  const length = kind === 'stopwatch' ? `<p class="tp-note">Counts up until you stop it. Lap any time.</p>` : `<div class="tp-row"><span class="tp-l">Length</span><div class="t-adj">
      <button class="icon" data-act="timerStep" data-d="-1" aria-label="5 minutes less" title="−5 min">${ic('minus')}</button><span class="mono">${cur} min</span>
      <button class="icon" data-act="timerStep" data-d="1" aria-label="5 minutes more" title="+5 min">${ic('plus')}</button></div></div>
    <div class="t-pre">${PRESETS.map(v => `<button class="tag ${v === cur ? 'on' : ''}" data-act="timerSet" data-v="${v}">${v}</button>`).join('')}</div>`;
  const task = `<select id="timerTask" class="tmr-task" aria-label="Task to work on"><option value="">${kind === 'stopwatch' ? 'No task' : 'Free focus — no task'}</option>${openTasks.map(t => `<option value="${t.id}" ${t.id === suggestId ? 'selected' : ''}>${esc(t.title.slice(0, 60))}</option>`).join('')}</select>`;
  const sw = (k, label, def = false) => { const v = p[k] ?? def; return `<div class="to-row"><span>${label}</span><button class="switch" role="switch" aria-checked="${!!v}" data-act="toggleFlag" data-k="${k}" data-def="${def ? 1 : ''}" aria-label="${label}"><i></i></button></div>`; };
  const more = !p.timerOpts ? '' : `<div class="tp-more">
      <div class="tp-grid"><label class="to-num"><span>Daily goal (h)</span><input type="number" min="0" max="16" step="0.5" data-set="goalHours" value="${esc(p.goalHours ?? 8)}"></label>
        <label class="to-num"><span>Counts after (min)</span><input type="number" min="1" max="60" data-set="minCount" value="${esc(p.minCount ?? 1)}"></label></div>
      <div class="to-row"><span>Sound</span><select data-set="sound" aria-label="Sound when time is up">${SOUNDS.map(s => `<option ${(p.sound || 'chime') === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="to-row"><span>Volume</span><span class="row"><input type="range" min="0" max="1" step="0.05" data-set="volume" value="${esc(p.volume ?? .6)}" aria-label="Volume"><button class="btn sm" data-act="testSound">Test</button></span></div>
      ${sw('tick', 'Soft ticking')}${sw('notifyEnd', 'Desktop notification', true)}${sw('titleTimer', 'Time in tab title', true)}${sw('wakeLock', 'Keep screen awake')}</div>`;
  const goal = goalMinutes(), done = focusToday();
  return `<aside class="tmr-panel${more ? ' wide' : ''}" aria-label="Timer settings"><div class="tp-main">
    ${tabs}${length}${task}
    <button class="pill-btn go" data-act="startTimer">${kind === 'stopwatch' ? 'Start stopwatch' : `Start ${cur} min focus`}<kbd>space</kbd></button>
    <div class="tp-foot">${goal ? `<div class="tmr-goal" title="Daily focus goal"><span class="mono">${fmtHours(done)} / ${fmtHours(goal)}</span><div class="meter"><i style="width:${Math.min(100, done / goal * 100)}%"></i></div></div>` : '<span></span>'}
      <button class="ghost tp-tog" data-act="timerOpts" aria-expanded="${!!p.timerOpts}">${COG}${p.timerOpts ? 'Less' : 'More'}</button></div></div>
    ${more}
  </aside>`;
}
function heroTimer(openTasks, suggestId) {
  const tm = S.timer, kind = tm?.kind || timerMode, run = timerRunning();
  const state = run ? 'running' : tm ? 'paused' : 'idle', land = !tm && timerLand;
  timerLand = false;
  const done = cycleCount(), goal = goalMinutes();
  const ctl = !tm ? '' : `<div class="tmr-ctl run-ctl">
      <button class="pill-btn go" data-act="pauseTimer">${run ? 'Pause' : 'Resume'}<kbd>space</kbd></button>
      ${kind === 'stopwatch' ? `<button class="pill-btn" data-act="lapTimer" ${run ? '' : 'disabled'}>Lap</button>` : '<button class="pill-btn" data-act="timerExtend" title="Add 5 minutes">+5 min</button>'}
      <button class="pill-btn" data-act="stopTimer">Stop &amp; log</button></div>`;
  const adjustable = !tm && kind !== 'stopwatch';
  return `<div class="tmr ${kind === 'stopwatch' ? 'swm' : ''} ${state} ${land ? 'land' : ''} ${Date.now() - timerBurst < 1500 ? 'burst' : ''}">
    <div class="tmr-stage">
      <div class="dial-col">
        <div class="dial ${adjustable ? 'adjustable' : ''}" ${adjustable ? 'title="Scroll to change the time"' : ''}>${dialSvg()}
          <div class="dial-in">
            <span class="dial-t ${timerText(tm).length > 5 ? 'long' : ''}" id="timerText">${timerText(tm)}</span>
            <span class="dial-s" id="timerSub"></span>
            ${tm && goal ? `<span class="dial-g mono">${fmtHours(focusToday())} of ${fmtHours(goal)} today</span>` : ''}</div></div>
        ${ctl}
      </div>
      ${tm ? '' : timerPanel(openTasks, suggestId)}
    </div>
  </div>`;
}
const COG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';
/* The sidebar keeps a small summary; the timer itself lives in the hero. */
function focusCard() {
  const p = S.profile, tm = S.timer, done = cycleCount(), focusMin = focusToday(), goal = goalMinutes();
  return `<div class="side-block fc"><div class="side-h">Focus today ${tm ? (timerRunning() ? '<span class="pill green">Live</span>' : '<span class="pill">Paused</span>') : ''}</div>
    <div class="fc-v">${fmtHours(focusMin)}${goal ? `<small>of ${fmtHours(goal)}</small>` : ''}</div>
    ${goal ? `<div class="meter"><i style="width:${Math.min(100, focusMin / goal * 100)}%"></i></div>` : ''}
    <p class="fc-n mono">${done} session${done === 1 ? '' : 's'} finished today</p>
    ${p.heroMode === 'timer' ? '' : `<button class="btn" data-act="heroMode" data-v="timer" style="width:100%;justify-content:center">${tm ? `<span class="mono" id="fcTime">${timerText(tm)}</span> · show timer` : 'Open the timer'} ↑</button>`}
  </div>`;
}

/* ---------------- settings page ---------------- */
function timerSettings() {
  const p = S.profile, np = 'Notification' in window ? Notification.permission : 'unsupported';
  const onOff = (k, def = false) => { const v = p[k] ?? def; return `<div class="tags"><button class="tag ${v ? 'on' : ''}" data-act="setFlag" data-k="${k}" data-v="1">On</button><button class="tag ${v ? '' : 'on'}" data-act="setFlag" data-k="${k}" data-v="">Off</button></div>`; };
  const num = (k, min, max, unit, id) => `<div class="row"><input id="${id}" type="number" min="${min}" max="${max}" data-set="${k}" value="${esc(p[k])}" style="width:90px"><span class="mono small">${unit}</span></div>`;
  return `<div class="set">
    <label for="tFocus">Focus length</label>${num('focusMin', 5, 240, 'minutes', 'tFocus')}
    <label for="tGoal">Daily focus goal</label><div class="row"><input id="tGoal" type="number" min="0" max="16" step="0.5" data-set="goalHours" value="${esc(p.goalHours ?? 8)}" style="width:90px"><span class="mono small">hours · 0 hides it · +20 xp when hit</span></div>
    <label for="tMin">Count a stopped session after</label>${num('minCount', 1, 60, 'minutes', 'tMin')}
    <label>Sound when time is up</label><div><div class="tags">${SOUNDS.map(s => `<button class="tag ${(p.sound || 'chime') === s ? 'on' : ''}" data-act="setSound" data-v="${s}">${s}</button>`).join('')}</div>
      <div class="row" style="margin-top:10px"><input type="range" min="0" max="1" step="0.05" data-set="volume" value="${esc(p.volume ?? .6)}" aria-label="Volume" style="width:180px"><span class="mono small">${Math.round((p.volume ?? .6) * 100)}% volume</span><button class="btn sm" data-act="testSound">Test</button></div></div>
    <label>Soft ticking while timing</label>${onOff('tick')}
    <label>Desktop notification when done</label><div class="row" style="flex-wrap:wrap">${onOff('notifyEnd', true)}${np === 'denied' ? '<span class="small">Blocked in your browser — allow it for localhost in site settings.</span>' : np === 'default' ? '<button class="btn sm" data-act="askNotify">Allow notifications</button>' : ''}</div>
    <label>Time left in the tab title</label>${onOff('titleTimer', true)}
    <label>Keep the screen awake</label><div>${onOff('wakeLock')}<p class="hint" style="margin-top:6px">${'wakeLock' in navigator ? 'Stops the laptop dimming or sleeping while a timer runs.' : 'Not supported in this browser.'}</p></div>
  </div>`;
}

/* Starting: the settings wipe away and the dial glides to the centre, then the running view takes over in place. */
function launchTimer() {
  if (timerBusy || S.timer) return;
  const taskId = $('#timerTask')?.value, tmr = $('.tmr');
  const go = () => { timerBusy = false; startTimer(taskId, timerMode); commit(); };
  if (!tmr || matchMedia('(prefers-reduced-motion: reduce)').matches) return go();
  timerBusy = true; tmr.classList.add('launching');
  setTimeout(go, 620);
}

const TIMER_ACT = {
  heroMode: el => { if (S.profile.heroMode !== el.dataset.v && view === 'today') heroFlip = true; S.profile.heroMode = el.dataset.v; view = 'today'; commit(); scrollTo({ top: 0, behavior: 'instant' }); },
  showTimer: () => { S.profile.heroMode = 'timer'; view = 'today'; commit(); scrollTo({ top: 0, behavior: 'instant' }); },
  timerStep: el => { if (S.timer || timerMode === 'stopwatch') return; setFocusMinutes(kindMinutes() + Number(el.dataset.d) * STEP); commit(); },
  timerSet: el => { if (S.timer || timerMode === 'stopwatch') return; setFocusMinutes(Number(el.dataset.v)); commit(); },
  timerExtend: () => { const tm = S.timer; if (!tm || tm.kind === 'stopwatch') return; tm.dur += 300; if (tm.endAt) tm.endAt += 3e5; else tm.left += 300; toast('+5 minutes.', '', 1500); commit(); },
  timerOpts: () => { S.profile.timerOpts = !S.profile.timerOpts; commit(); },
  toggleFlag: el => { const k = el.dataset.k, v = !(S.profile[k] ?? !!el.dataset.def); S.profile[k] = v; if (k === 'wakeLock') keepAwake(v && timerRunning()); if (k === 'notifyEnd' && v) askNotify(); commit(); },
  timerMode: el => { if (S.timer || timerMode === el.dataset.k) return; segFrom = Object.keys(TIMER_KINDS).indexOf(timerMode); timerMode = el.dataset.k; render(); },
  startTimer: () => launchTimer(),
  pauseTimer: () => { pauseTimer(); commit(); },
  stopTimer: () => { endTimer(false); commit(); },
  lapTimer: () => { const tm = S.timer; if (tm?.kind !== 'stopwatch') return; tm.laps.push(swElapsed(tm)); commit(); },
  focusTask: el => { if (S.timer) return toast('A timer is already running.'); startTimer(el.dataset.id, 'focus'); view = 'today'; commit(); scrollTo({ top: 0, behavior: 'instant' }); },
  setFlag: el => { S.profile[el.dataset.k] = !!el.dataset.v; if (el.dataset.k === 'wakeLock') keepAwake(!!el.dataset.v && timerRunning()); commit(); },
  setSound: el => { S.profile.sound = el.dataset.v; playSound(el.dataset.v); commit(); },
  testSound: () => playSound(S.profile.sound || 'chime'),
};

/* Scroll over the idle dial to change the time. */
document.addEventListener('wheel', e => {
  if (!e.target.closest?.('.dial.adjustable') || S.timer || timerMode === 'stopwatch') return;
  e.preventDefault();
  setFocusMinutes(kindMinutes() + (e.deltaY < 0 ? 1 : -1) * STEP); commit();
}, { passive: false });
