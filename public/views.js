/* Forge — page rendering. State and behaviour live in app.js; the board canvas lives in board.js. */
const PENS = ['#fcd34d', '#2563eb', '#34d399', '#fb7185', '#a78bfa', '#f97316'];
const VIEW_NAMES = { today: 'Today', tasks: 'Tasks', board: 'Board', progress: 'Progress', settings: 'Settings' };
const GAP = '<div class="gap" aria-hidden="true"></div>';
const UNDERLINE = '<svg class="pen-ul" viewBox="0 0 200 12" preserveAspectRatio="none" aria-hidden="true"><path d="M3 4 C45 1, 95 6, 197 2"/><path d="M8 9 C60 6, 125 11, 192 7"/></svg>';
/* one icon set (Lucide geometry), one stroke weight, one size — never text glyphs as icons */
const IC_PATHS = {
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  play: '<path d="M6 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L7.5 3.64A1 1 0 0 0 6 4.5Z" fill="currentColor"/>',
  star: '<path d="M11.5 2.3a.6.6 0 0 1 1 0l2.6 5.3 5.8.8a.6.6 0 0 1 .3 1l-4.2 4.1 1 5.8a.6.6 0 0 1-.8.6L12 17.2l-5.2 2.7a.6.6 0 0 1-.8-.6l1-5.8-4.2-4.1a.6.6 0 0 1 .3-1l5.8-.8Z"/>',
  starFill: '<path d="M11.5 2.3a.6.6 0 0 1 1 0l2.6 5.3 5.8.8a.6.6 0 0 1 .3 1l-4.2 4.1 1 5.8a.6.6 0 0 1-.8.6L12 17.2l-5.2 2.7a.6.6 0 0 1-.8-.6l1-5.8-4.2-4.1a.6.6 0 0 1 .3-1l5.8-.8Z" fill="currentColor"/>',
  open: '<path d="M7 17 17 7M7 7h10v10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  fit: '<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>',
  note: '<path d="M4 4h16v10l-6 6H4Z"/><path d="M20 14h-6v6"/>',
  textT: '<path d="M5 6h14M12 6v13M9 19h6"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.8"/><path d="m21 15-4.5-4.5L6 21"/>',
  file: '<path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8Z"/><path d="M14 3v5h5"/>',
  tags: '<path d="M13.2 3H6a3 3 0 0 0-3 3v7.2a2 2 0 0 0 .6 1.4l6.8 6.8a2 2 0 0 0 2.8 0l7.2-7.2a2 2 0 0 0 0-2.8l-6.8-6.8a2 2 0 0 0-1.4-.6Z"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/>',
  task: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8.5 12 2.5 2.5 5-5"/>',
  front: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M16 4.5V4a1.5 1.5 0 0 0-1.5-1.5h-10A1.5 1.5 0 0 0 3 4v10.5A1.5 1.5 0 0 0 4.5 16H5"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2.5"/><path d="M4.5 16A1.5 1.5 0 0 1 3 14.5v-10A1.5 1.5 0 0 1 4.5 3h10A1.5 1.5 0 0 1 16 4.5"/>',
  trash: '<path d="M4 6.5h16M9.5 6.5V4.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2M6.5 6.5l.9 12.6a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.9-12.6"/>',
  sparkTag: '<path d="M11.2 3H6a3 3 0 0 0-3 3v5.2a2 2 0 0 0 .6 1.4l7.8 7.8a2 2 0 0 0 2.8 0l5.2-5.2a2 2 0 0 0 0-2.8L11.6 4.6A2 2 0 0 0 11.2 3Z"/><path d="M8 8h.01"/><path d="M19 2.5v4M17 4.5h4"/>',
};
const ic = (name, size = 14) => `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC_PATHS[name]}</svg>`;
const ARROW = '<svg class="pen-arrow" viewBox="0 0 70 34" aria-hidden="true"><path d="M3 28 C20 6, 44 4, 64 16"/><path d="M53 9 L65 17 L52 23"/></svg>';

function section(title, count, note, body, aside = '') {
  return `<section class="sec"><div class="tcol"><div class="tstick">
    <h2 class="bt"><span>${title}</span>${count != null ? `<sup>(${count})</sup>` : ''}</h2>
    ${note ? `<p class="tnote">${note}</p>` : ''}${aside}</div></div><div class="ccol">${body}</div></section>`;
}
const pageHead = (kicker, title) => `<header class="phead"><p>${kicker}</p><h1>${title}</h1></header>`;
const areaDot = k => `<i class="dot" style="background:${(AREAS[k] || AREAS.life).color}"></i>`;
const shortDate = v => new Date(typeof v === 'string' ? v + 'T00:00' : v).toLocaleDateString([], { day: 'numeric', month: 'short' });
const longDate = k => new Date(k + 'T00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
const dur = ms => { const m = Math.max(0, Math.round(ms / 6e4)), h = Math.floor(m / 60); return h ? `${h}h ${m % 60}m` : `${m}m`; };
const inlineAdd = (form, id, ph) => `<form data-form="${form}" class="inline-add"><input ${id ? `id="${id}"` : ''} type="text" name="title" aria-label="New task" placeholder="${esc(ph)}" autocomplete="off"><button class="ia-btn">Add <kbd>↵</kbd></button></form>`;

/* ---------------- tasks: one grouping for Today and Tasks, so they always agree ---------------- */
function taskRow(t) {
  const a = AREAS[t.area] || AREAS.life, p = S.projects.find(p => p.id === t.projectId), td = today();
  const starred = t.top3 === td;
  const due = !t.due ? '' : t.due < td && !t.done ? `<span class="pill red">overdue · ${shortDate(t.due)}</span>`
    : `<span class="mono">${t.due === td ? 'today' : t.due === addDays(td, 1) ? 'tomorrow' : shortDate(t.due)}</span>`;
  return `<div class="task ${t.done ? 'done' : ''}">
    <button class="check" data-act="toggleDone" data-id="${t.id}" aria-label="${t.done ? 'Reopen' : 'Complete'} ${esc(t.title)}">${ic('check', 12)}</button>
    <div class="t-body" data-act="editTask" data-id="${t.id}">
      <div class="t-title">${esc(t.title)}</div>
      <div class="meta"><span>${areaDot(t.area)}${a.label}</span>${p ? `<span>${esc(p.name)}</span>` : ''}${due}${t.priority === 'high' ? '<span class="fg">high priority</span>' : ''}${starred && !t.done ? `<span class="star">${ic('starFill', 12)}top 3</span>` : ''}</div>
    </div>
    ${t.done ? '' : `<div class="t-tools">
      <button class="icon" data-act="focusTask" data-id="${t.id}" title="Start a focus session on this" aria-label="Focus on this">${ic('play', 12)}</button>
      <button class="icon ${starred ? 'lit' : ''}" data-act="toggleTop3" data-id="${t.id}" title="${starred ? 'Remove from' : 'Add to'} today's top 3" aria-label="Top 3">${ic(starred ? 'starFill' : 'star')}</button>
    </div>`}
  </div>`;
}
function taskGroups(match = () => true) {
  const tk = today(), rank = { high: 0, med: 1, low: 2 };
  const open = openTasks().filter(match);
  const byDue = (a, b) => (a.due || '9').localeCompare(b.due || '9') || rank[a.priority] - rank[b.priority] || a.createdAt - b.createdAt;
  return {
    open,
    groups: [
      ['Overdue', open.filter(t => t.due && t.due < tk)],
      ['Today', open.filter(t => t.due === tk || (t.top3 === tk && !(t.due && t.due < tk)))],
      ['Upcoming', open.filter(t => t.due > tk && t.top3 !== tk)],
      ['Someday', open.filter(t => !t.due && t.top3 !== tk)],
    ].map(([n, l]) => [n, l.sort(byDue)]),
    done: S.tasks.filter(t => t.done && match(t)).sort((a, b) => b.doneAt - a.doneAt),
  };
}
let homeTasksOpen = false, doneShown = 20;
// fold: how many open tasks show before the rest fold away (home only); expanded shows them all with a "Show less".
function groupsHtml(g, done = [], doneLabel = '', fold = 0) {
  const limit = fold && !homeTasksOpen ? fold : Infinity;
  const block = (label, list, all = list.length) => `<div class="grp"><div class="grp-h">${label} <span>(${all})</span></div><div class="list">${list.map(taskRow).join('')}</div></div>`;
  let left = limit, hidden = 0;
  const parts = g.groups.filter(([, l]) => l.length).map(([n, l]) => {
    const shown = l.slice(0, Math.max(0, left)); left -= shown.length; hidden += l.length - shown.length;
    return shown.length ? block(n === 'Overdue' ? '<span class="pill red">Overdue</span>' : n, shown, l.length) : '';
  }).filter(Boolean);
  if (done.length) parts.push(block(doneLabel, done));
  const more = !fold ? '' : hidden ? `<button class="more-btn" data-act="homeTasks" aria-expanded="false">Show ${hidden} more task${hidden === 1 ? '' : 's'}</button>`
    : homeTasksOpen && g.open.length > fold ? '<button class="more-btn" data-act="homeTasks" aria-expanded="true">Show less</button>' : '';
  return (parts.join('') || '<div class="empty">Nothing open. Add something worth doing.</div>') + more;
}
/* Everything finished, newest first, by day. */
function doneHtml(list) {
  if (!list.length) return '<div class="empty">Nothing finished yet. Tick something off and it lands here.</div>';
  const tk = today(), label = k => k === tk ? 'Today' : k === addDays(tk, -1) ? 'Yesterday' : new Date(k + 'T00:00').toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  const days = []; list.slice(0, doneShown).forEach(t => { const k = dkey(t.doneAt || t.createdAt); (days.at(-1)?.[0] === k ? days.at(-1)[1] : days[days.push([k, []]) - 1][1]).push(t); });
  return days.map(([k, ts]) => `<div class="grp"><div class="grp-h">${label(k)} <span>(${ts.length})</span></div><div class="list">${ts.map(taskRow).join('')}</div></div>`).join('')
    + (list.length > doneShown ? `<button class="more-btn" data-act="moreDone">Show ${Math.min(20, list.length - doneShown)} more</button>` : '');
}

/* ---------------- the clock, the sun and the shape of the day ---------------- */
const TZ_HOME = {
  'Asia/Kolkata': [19.08, 72.88, 'Mumbai'], 'Asia/Calcutta': [19.08, 72.88, 'Mumbai'], 'Europe/London': [51.51, -0.13, 'London'],
  'America/New_York': [40.71, -74.01, 'New York'], 'America/Los_Angeles': [34.05, -118.24, 'Los Angeles'], 'America/Chicago': [41.88, -87.63, 'Chicago'],
  'Europe/Berlin': [52.52, 13.4, 'Berlin'], 'Europe/Paris': [48.86, 2.35, 'Paris'], 'Asia/Tokyo': [35.68, 139.69, 'Tokyo'], 'Asia/Singapore': [1.35, 103.82, 'Singapore'],
  'Asia/Dubai': [25.2, 55.27, 'Dubai'], 'Australia/Sydney': [-33.87, 151.21, 'Sydney'],
};
function homeLoc() {
  const p = S.profile;
  if (p.lat != null && p.lon != null) return { lat: p.lat, lon: p.lon, label: p.place || 'your location' };
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone, h = TZ_HOME[tz];
  return h ? { lat: h[0], lon: h[1], label: h[2] } : { lat: 20, lon: -new Date().getTimezoneOffset() / 4, label: tz };
}
/* NOAA's approximation: good to a minute or two, which is all a clock needs. */
function sunTimes(day = new Date(), loc = homeLoc()) {
  const rad = Math.PI / 180, base = Date.UTC(day.getFullYear(), day.getMonth(), day.getDate());
  const g = 2 * Math.PI / 365 * ((base - Date.UTC(day.getFullYear(), 0, 0)) / 864e5 - 1);
  const eq = 229.18 * (.000075 + .001868 * Math.cos(g) - .032077 * Math.sin(g) - .014615 * Math.cos(2 * g) - .040849 * Math.sin(2 * g));
  const decl = .006918 - .399912 * Math.cos(g) + .070257 * Math.sin(g) - .006758 * Math.cos(2 * g) + .000907 * Math.sin(2 * g) - .002697 * Math.cos(3 * g) + .00148 * Math.sin(3 * g);
  const cosH = Math.cos(90.833 * rad) / (Math.cos(loc.lat * rad) * Math.cos(decl)) - Math.tan(loc.lat * rad) * Math.tan(decl);
  const noon = base + (720 - 4 * loc.lon - eq) * 6e4;
  if (cosH > 1) return { noon, polar: 'night' };
  if (cosH < -1) return { noon, polar: 'day' };
  const ha = Math.acos(cosH) / rad;
  return { rise: base + (720 - 4 * (loc.lon + ha) - eq) * 6e4, set: base + (720 - 4 * (loc.lon - ha) - eq) * 6e4, noon };
}
const PHASES = { night: ['Night', '#818cf8'], dawn: ['Blue hour', '#a78bfa'], golden: ['Golden hour', '#f59e0b'], morning: ['Morning', '#38bdf8'], midday: ['Midday', '#facc15'], afternoon: ['Afternoon', '#fb923c'], dusk: ['Dusk', '#c084fc'] };
function phaseOf(now = Date.now(), s = sunTimes()) {
  if (s.polar) return s.polar === 'day' ? 'midday' : 'night';
  const M = 6e4;
  if (now < s.rise - 40 * M || now > s.set + 40 * M) return 'night';
  if (now < s.rise) return 'dawn';
  if (now < s.rise + 60 * M) return 'golden';
  if (now > s.set) return 'dusk';
  if (now > s.set - 60 * M) return 'golden';
  if (Math.abs(now - s.noon) < 90 * M) return 'midday';
  return now < s.noon ? 'morning' : 'afternoon';
}
function skyHtml(now = Date.now()) {
  const s = sunTimes(), col = PHASES[phaseOf(now, s)][1];
  const DAY = [[30, 90], [200, -62], [370, 90]], NIGHT = [[370, 90], [200, 118], [30, 90]];
  const at = (P, t) => [0, 1].map(i => (1 - t) ** 2 * P[0][i] + 2 * (1 - t) * t * P[1][i] + t * t * P[2][i]);
  let up = true, t;
  if (s.polar) { up = s.polar === 'day'; t = .5; }
  else if (now >= s.rise && now <= s.set) t = (now - s.rise) / (s.set - s.rise);
  else {
    up = false;
    const set = now < s.rise ? s.set - 864e5 : s.set, rise = now < s.rise ? s.rise : s.rise + 864e5;
    t = (now - set) / (rise - set);
  }
  t = Math.min(1, Math.max(0, t));
  const A = up ? DAY : NIGHT, [x, y] = at(A, t), c = [0, 1].map(i => A[0][i] + (A[1][i] - A[0][i]) * t);
  return `<svg viewBox="0 0 400 112" aria-hidden="true">
    <line x1="6" y1="90" x2="394" y2="90" class="sky-hz"/>
    <path d="M30 90 Q200 -62 370 90" class="sky-arc ${up ? '' : 'faint'}"/>
    <path d="M370 90 Q200 118 30 90" class="sky-arc ${up ? 'faint' : ''}"/>
    <path d="M${A[0][0]} ${A[0][1]} Q${c[0].toFixed(1)} ${c[1].toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}" class="sky-done"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="${col}" opacity=".16"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="${up ? col : 'var(--bg)'}" stroke="${col}" stroke-width="1.6"/>
  </svg>`;
}
function skyFacts(now = Date.now()) {
  const s = sunTimes(), ph = phaseOf(now, s), left = new Date().setHours(24, 0, 0, 0) - now;
  let sun = '';
  if (!s.polar) sun = now < s.rise ? `sunrise ${fmtTime(s.rise)} · in ${dur(s.rise - now)}` : now < s.set ? `sunset ${fmtTime(s.set)} · in ${dur(s.set - now)}` : `sunrise ${fmtTime(sunTimes(new Date(now + 864e5)).rise)} tomorrow`;
  const next = S.reminders.filter(r => !r.fired && r.at > now).sort((a, b) => a.at - b.at)[0];
  return `<span class="ph"><i style="background:${PHASES[ph][1]}"></i>${PHASES[ph][0]} in ${esc(homeLoc().label)}</span>${sun ? `<span>${sun}</span>` : ''}<span>${dur(left)} left today</span>${next ? `<span>next: ${esc(next.text.slice(0, 28))} · ${fmtTime(next.at)}</span>` : ''}`;
}
function zoneOffsetMin(tz, d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(d.getTime() / 6e4) * 6e4) / 6e4);
}
const zoneName = z => z === 'UTC' ? 'UTC' : z.split('/').pop().replace(/_/g, ' ');
const fmtOff = m => `${m > 0 ? '+' : '−'}${Math.floor(Math.abs(m) / 60)}h${Math.abs(m) % 60 ? ' ' + Math.abs(m) % 60 + 'm' : ''}`;
function zonesHtml() {
  const now = new Date(), local = -now.getTimezoneOffset(), td = dkey(now);
  return (S.profile.zones || []).map(z => {
    try {
      const off = zoneOffsetMin(z, now) - local, zd = new Intl.DateTimeFormat('en-CA', { timeZone: z }).format(now);
      const tm = now.toLocaleTimeString([], { timeZone: z, hour: 'numeric', minute: '2-digit', hour12: !S.profile.clock24 });
      return `<span class="zone"><b>${esc(zoneName(z))}</b><span class="mono">${tm}</span><em>${off ? fmtOff(off) : 'same time'}${zd > td ? ' · tomorrow' : zd < td ? ' · yesterday' : ''}</em></span>`;
    } catch { return ''; }
  }).join('');
}
function clockParts(d = new Date()) {
  let h = d.getHours(); const ap = h >= 12 ? 'pm' : 'am';
  if (!S.profile.clock24) h = h % 12 || 12;
  return { h: S.profile.clock24 ? pad(h) : String(h), m: pad(d.getMinutes()), s: pad(d.getSeconds()), ap: S.profile.clock24 ? '' : ap };
}
/* Digital: big hours and minutes, a seconds badge, and a row of 60 ticks that fill over the minute. */
function clockHtml() {
  const p = clockParts(), sec = new Date().getSeconds();
  return `<span class="dg-hm"><span id="dgH">${p.h}</span><span class="dg-c">:</span><span id="dgM">${p.m}</span></span>
    <span class="dg-side"><span class="dg-ap" id="dgAp">${p.ap}</span><span class="dg-s mono" id="dgS">${p.s}</span></span>
    <span class="dg-bar" id="dgBar" aria-hidden="true">${[...Array(60)].map((_, i) => `<i class="${i < sec ? 'lit' : i === sec ? 'now' : ''}${i % 5 ? '' : ' q'}"></i>`).join('')}</span>`;
}
/* Hand angles keep counting through the day so a CSS transition never spins backwards between seconds. */
const handAngles = (d = new Date()) => { const h = d.getHours(), m = d.getMinutes(), s = d.getSeconds(); return { h: (h + m / 60) * 30, m: (h * 60 + m + s / 60) * 6, s: (h * 3600 + m * 60 + s) * 6 }; };
const AN_SR = 2 * Math.PI * 92;
function analogSvg() {
  const d = new Date(), a = handAngles(d);
  let ticks = '', nums = '';
  for (let i = 0; i < 60; i++) {
    const t = i * Math.PI / 30, sx = Math.sin(t), cy = -Math.cos(t), big = i % 5 === 0, r1 = i % 15 === 0 ? 74 : big ? 78 : 83;
    ticks += `<line x1="${(sx * r1).toFixed(2)}" y1="${(cy * r1).toFixed(2)}" x2="${(sx * 87).toFixed(2)}" y2="${(cy * 87).toFixed(2)}" class="tk${big ? ' big' : ''}${i % 15 ? '' : ' qt'}"/>`;
  }
  [[0, '12'], [3, '3'], [9, '9']].forEach(([h, n]) => { const t = h * Math.PI / 6; nums += `<text x="${(Math.sin(t) * 60).toFixed(1)}" y="${(-Math.cos(t) * 60 + 5).toFixed(1)}" class="an-n">${n}</text>`; });
  const wd = d.toLocaleDateString([], { weekday: 'short' }).toUpperCase();
  return `<svg viewBox="-110 -110 220 220" aria-hidden="true">
    <defs><radialGradient id="anFace" cx="50%" cy="30%" r="75%"><stop offset="0" class="f0"/><stop offset="1" class="f1"/></radialGradient></defs>
    <circle r="104" class="an-bezel"/><circle r="97" class="face" fill="url(#anFace)"/>
    <circle r="92" class="an-sr-trk"/><circle r="92" class="an-sr" id="anSec" transform="rotate(-90)" stroke-dasharray="${AN_SR.toFixed(2)}" stroke-dashoffset="${(AN_SR * (1 - d.getSeconds() / 60)).toFixed(2)}"/>
    ${ticks}${nums}
    <g class="an-date"><rect x="-21" y="40" width="42" height="17" rx="5"/><text y="52.5"><tspan class="wd">${wd}</tspan> ${d.getDate()}</text></g>
    <g class="hand" id="hH" style="transform:rotate(${a.h}deg)"><line y1="12" y2="-44" class="hh"/><line y1="-14" y2="-40" class="hh-in"/></g>
    <g class="hand" id="hM" style="transform:rotate(${a.m}deg)"><line y1="14" y2="-74" class="hm"/><line y1="-20" y2="-70" class="hm-in"/></g>
    <g class="hand sec" id="hS" style="transform:rotate(${a.s}deg)"><line y1="24" y2="-86" class="hs"/><circle cy="20" r="3.6" class="hs-tail"/></g>
    <circle r="5.2" class="hub-o"/><circle r="2.2" class="hub"/></svg>`;
}
function isoWeek(d) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())), day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
function greeting() {
  const h = new Date().getHours(), n = S.profile.name ? ', ' + S.profile.name : '';
  return h < 5 ? [`Still up${n}?`, 'Go to sleep.'] : h < 12 ? [`Morning${n}.`, "Clock's running."] : h < 17 ? [`Afternoon${n}.`, 'Keep moving.'] : h < 21 ? [`Evening${n}.`, 'Finish strong.'] : [`Late${n}.`, 'Close the day out.'];
}
let skyMinute = -1, heroFlip = false;
function setText(el, v, roll) {
  if (!el || el.textContent === v) return;
  el.textContent = v;
  if (roll) { el.classList.remove('roll'); void el.offsetWidth; el.classList.add('roll'); }
}
function paintClock(force) {
  const d = new Date(), dp = $('#dayPct');
  if (dp) dp.textContent = Math.round((d.getHours() * 60 + d.getMinutes()) / 14.4) + '%';
  const c = $('#clock'); if (!c) return;
  c.setAttribute('aria-label', d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !S.profile.clock24 }));
  const sec = d.getSeconds();
  if (S.profile.clockStyle === 'analog') {
    const a = handAngles(d);
    ['h', 'm', 's'].forEach(k => {
      const el = $('#h' + k.toUpperCase()); if (!el) return;
      const prev = parseFloat(el.style.transform.slice(7)) || 0;
      el.style.transition = a[k] < prev ? 'none' : '';
      el.style.transform = `rotate(${a[k]}deg)`;
    });
    const sr = $('#anSec');
    if (sr) { sr.style.transition = sec === 0 ? 'none' : ''; sr.style.strokeDashoffset = AN_SR * (1 - sec / 60); }
  } else {
    const p = clockParts(d);
    setText($('#dgH'), p.h, true); setText($('#dgM'), p.m, true); setText($('#dgAp'), p.ap); setText($('#dgS'), p.s);
    $('#dgBar')?.querySelectorAll('i').forEach((t, i) => { t.classList.toggle('lit', i < sec); t.classList.toggle('now', i === sec); });
  }
  const mk = d.getHours() * 60 + d.getMinutes();
  if (force || mk !== skyMinute) {
    skyMinute = mk;
    const sky = $('#sky'); if (sky) sky.innerHTML = skyHtml();
    $('.hero')?.style.setProperty('--phase', PHASES[phaseOf()][1]);
  }
}
const I_CLOCK = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const I_TIMER = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V10M9.5 2.75h5M18.5 6.5l1.2-1.2"/></svg>';
function heroSwitch(heroT) {
  const dot = S.timer ? `<i class="${timerRunning() ? 'live' : 'held'}"></i>` : '';
  return `<div class="hero-sw glass-pill" role="tablist" aria-label="Clock or timer" style="--on:${heroT ? 1 : 0}" title="Switch with T">
    <span class="hs-ind" aria-hidden="true"></span>
    <button role="tab" aria-selected="${!heroT}" class="${heroT ? '' : 'on'}" data-act="heroMode" data-v="clock">${I_CLOCK}<span>Clock</span></button>
    <button role="tab" aria-selected="${heroT}" class="${heroT ? 'on' : ''}" data-act="heroMode" data-v="timer">${I_TIMER}<span>Timer</span>${dot}</button>
  </div>`;
}

/* ---------------- calendar ---------------- */
const mondayOf = k => addDays(k, -((new Date(k + 'T00:00').getDay() + 6) % 7));
function calendarSection() {
  const tk = today(), sel = calSel || tk, open = !!S.profile.calOpen, idx = dayIndex();
  const due = {}, done = {}, rem = {};
  S.tasks.forEach(t => { if (!t.done && t.due) (due[t.due] ??= []).push(t); if (t.done && t.doneAt) (done[dkey(t.doneAt)] ??= []).push(t); });
  S.reminders.filter(r => !r.fired).forEach(r => (rem[dkey(r.at)] ??= []).push(r));
  const lvl = k => { const s = idx[k]; if (!s || !(s.tasks || s.focus)) return 0; return s.xp < 30 ? 1 : s.xp < 80 ? 2 : s.xp < 150 ? 3 : 4; };
  const cell = (k, other, dow) => {
    const d = new Date(k + 'T00:00'), list = due[k] || [], late = k < tk;
    return `<button class="cal-d${k === tk ? ' now' : ''}${k === sel ? ' on' : ''}${other ? ' other' : ''}" data-act="calPick" data-d="${k}" aria-pressed="${k === sel}" aria-label="${longDate(k)}${list.length ? `, ${list.length} due` : ''}">
      ${dow ? `<span class="cal-w">${d.toLocaleDateString([], { weekday: 'short' })}</span>` : ''}<span class="cal-n">${d.getDate()}</span>
      <span class="cal-dots">${list.slice(0, 4).map(t => `<i style="background:${late ? 'var(--bad)' : (AREAS[t.area] || AREAS.life).color}"></i>`).join('')}${rem[k] ? '<i class="r"></i>' : ''}</span>
      <span class="cal-l" data-l="${lvl(k)}"></span></button>`;
  };
  let head, grid;
  if (open) {
    const mk = calMonth || sel.slice(0, 7), first = mk + '-01', start = mondayOf(first);
    let cells = '', k = start;
    for (let i = 0; i < 42; i++) { if (i && i % 7 === 0 && k.slice(0, 7) !== mk) break; cells += cell(k, k.slice(0, 7) !== mk); k = addDays(k, 1); }
    head = `<button class="icon" data-act="calStep" data-dir="-1" aria-label="Previous month">‹</button><b>${new Date(first + 'T00:00').toLocaleDateString([], { month: 'long', year: 'numeric' })}</b><button class="icon" data-act="calStep" data-dir="1" aria-label="Next month">›</button>`;
    grid = `<div class="cal-grid">${[...Array(7)].map((_, i) => `<span class="cal-dow">${new Date(addDays(start, i) + 'T00:00').toLocaleDateString([], { weekday: 'narrow' })}</span>`).join('')}${cells}</div>`;
  } else {
    const start = mondayOf(sel), end = addDays(start, 6);
    head = `<button class="icon" data-act="calStep" data-dir="-1" aria-label="Previous week">‹</button><b>${shortDate(start)} – ${shortDate(end)}</b><button class="icon" data-act="calStep" data-dir="1" aria-label="Next week">›</button>`;
    grid = `<div class="cal-week">${[...Array(7)].map((_, i) => cell(addDays(start, i), false, true)).join('')}</div>`;
  }
  const dl = due[sel] || [], dn = done[sel] || [], rl = (rem[sel] || []).sort((a, b) => a.at - b.at), f = idx[sel]?.focus || 0;
  const agenda = !open && sel === tk ? '' : `<div class="cal-ag"><div class="cal-ag-h"><b>${sel === tk ? 'Today' : longDate(sel)}</b><span class="mono">${dl.length} due · ${dn.length} done · ${Math.round(f / 60)} min focus</span></div>
    ${dl.length || dn.length || rl.length ? `<div class="list">${dl.map(taskRow).join('')}${rl.map(r => `<div class="rem"><time>${fmtTime(r.at)}</time><span>${esc(r.text)}</span><button class="icon" data-act="delReminder" data-id="${r.id}" aria-label="Delete reminder">${ic('x')}</button></div>`).join('')}${dn.map(taskRow).join('')}</div>` : ''}
    <div style="margin-top:12px">${inlineAdd('calAdd', 'calAddIn', `Add a task for ${sel === tk ? 'today' : shortDate(sel)}…`)}</div></div>`;
  const body = `<div class="cal-head">${head}<span class="grow"></span>${sel !== tk || calMonth ? '<button class="ghost" data-act="calToday">Today</button>' : ''}
    <button class="btn sm" data-act="calToggle" aria-expanded="${open}">${open ? 'Collapse ▴' : 'Month ▾'}</button></div>${grid}${agenda}`;
  return section('Calendar', null, open ? 'Pick a day to plan it. Dots are tasks due; the bar is how much you did.' : 'This week. Expand for the month.', body);
}

/* ---------------- Today ---------------- */
function viewToday() {
  const idx = dayIndex(), st = streaks(idx), tk = today(), td = idx[tk] || { tasks: 0, focus: 0, xp: 0 };
  const xp = totalXp(), lvl = levelOf(xp), lo = levelFloor(lvl), hi = levelFloor(lvl + 1);
  const three = top3(), g = taskGroups(), backlog = g.open.filter(t => t.top3 !== tk);
  const rems = S.reminders.filter(r => !r.fired).sort((a, b) => a.at - b.at);
  const tm = S.timer, brief = S.briefs[tk], [hello, push] = greeting(), d = new Date(), analog = S.profile.clockStyle === 'analog';
  const note = !brief ? 'thinking about your day…' : brief.local ? localBrief(brief.evening ? 'evening' : 'morning') : brief.evening || brief.morning;
  const doy = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 0)) / 864e5);

  const slots = [0, 1, 2].map(i => three[i]
    ? `<div class="slot"><span class="num">0${i + 1}</span>${taskRow(three[i])}</div>`
    : `<div class="slot"><span class="num">0${i + 1}</span><form data-form="top3new"><input class="bare" type="text" name="title" aria-label="Top 3 slot ${i + 1}" placeholder="${i === three.length ? 'The one thing that must happen today…' : 'Then this…'}" autocomplete="off"></form>
        ${backlog.length ? `<select data-change="pullTop3" aria-label="Pull from your tasks"><option value="">or pull from tasks</option>${backlog.slice(0, 40).map(t => `<option value="${t.id}">${esc(t.title.slice(0, 50))}</option>`).join('')}</select>` : ''}</div>`).join('');

  const streakSq = st.cur ? (st.safe ? 'var(--ok)' : 'var(--star)') : 'var(--l1)';
  const strip = `<div class="strip">
    <div class="cell"><div class="cell-h"><i class="sq" style="background:${streakSq}"></i>Streak</div><div class="cell-v">${st.cur}<small>day${st.cur === 1 ? '' : 's'}</small></div><div class="cell-s">${!st.cur ? 'Starts with one task.' : st.safe ? 'Secured for today.' : 'At risk until you do one thing.'}</div></div>
    <div class="cell"><div class="cell-h"><i class="sq" style="background:var(--l2)"></i>Level</div><div class="cell-v">${lvl}<small>${titleOf(lvl).toLowerCase()}</small></div><div class="meter"><i style="width:${(xp - lo) / (hi - lo) * 100}%"></i></div></div>
    <div class="cell"><div class="cell-h"><i class="sq" style="background:var(--l2)"></i>Tasks today</div><div class="cell-v">${td.tasks}<small>done</small></div><div class="cell-s">${g.open.length} still open.</div></div>
    <div class="cell"><div class="cell-h"><i class="sq" style="background:${tm?.endAt ? 'var(--ok)' : 'var(--l2)'}"></i>Focus today</div><div class="cell-v">${Math.round(td.focus / 60)}<small>min</small></div><div class="cell-s">${tm?.endAt ? 'Session running.' : '1 xp per minute.'}</div></div>
  </div>`;

  const focus = focusCard(), heroT = S.profile.heroMode === 'timer', flip = heroFlip;
  heroFlip = false;

  const coach = `<div class="side-block" style="padding-top:34px;padding-bottom:30px"><div class="paper"><i class="tape"></i>
    <div class="paper-title">${brief?.evening ? 'end of day' : 'this morning'}</div><p>${esc(note)}</p>
    <div class="paper-foot"><button class="paper-btn" data-act="toggleAgent">talk to me</button><span class="hand sig">— forge</span></div></div></div>`;

  return `<div class="view">
    <header class="hero ${heroT ? 'hero-timer' : 'hero-clock'} ${flip ? 'flip' : ''}">
      ${heroSwitch(heroT)}
      <div class="date mono">${d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · week ${isoWeek(d)} · day ${doy} · <span id="dayPct"></span> of today gone</div>
      <div class="hero-stage">
      ${heroT ? heroTimer(g.open, three.find(x => !x.done)?.id) : `<div class="clock-stage ${analog ? 'is-analog' : 'is-digital'}">
        <button class="clock-btn" data-act="clockStyle" title="Click to switch digital / analog">
          <div class="clock ${analog ? 'analog' : 'digital'}" id="clock" role="img">${analog ? analogSvg() : clockHtml()}</div>
        </button>
        <div class="clock-kind" role="group" aria-label="Clock style"><button class="${analog ? '' : 'on'}" data-act="clockStyle" data-v="digital">digital</button><button class="${analog ? 'on' : ''}" data-act="clockStyle" data-v="analog">analog</button></div>
        <p class="greet">${esc(hello)} <span class="pen-key">${esc(push)}${UNDERLINE}</span></p>
        <div class="sky" id="sky"></div>
      </div>`}
      </div>
    </header>
    ${strip}${GAP}
    <div class="split"><div class="main-col">
      ${calendarSection()}${GAP}
      ${section('Top 3', `${three.filter(t => t.done).length}/3`, 'Three things that make today count. No more.', `<div class="list">${slots}</div>`, three.length ? '' : `<div class="hand-aside" aria-hidden="true"><span class="hand">start here</span>${ARROW}</div>`)}
      ${GAP}
      ${section('Tasks', g.open.length, 'The same list as the Tasks page, grouped by when it is due.', `${inlineAdd('quickTask', 'quickToday', 'Add a task…  #coding !high tomorrow')}<div class="groups">${groupsHtml(g, [], '', 6)}</div>`, `<button class="ghost tlink" data-act="view" data-view="tasks">Projects and filters →</button>${g.done.length ? '<button class="ghost tlink" data-act="openDone">Done tasks →</button>' : ''}`)}
      ${GAP}
      ${section('Reminders', rems.length, 'They fire while Forge is open.', `${rems.length ? `<div class="list">${rems.map(r => `<div class="rem"><time>${dkey(r.at) === tk ? 'today' : shortDate(r.at)} · ${fmtTime(r.at)}</time><span>${esc(r.text)}</span><button class="icon" data-act="delReminder" data-id="${r.id}" aria-label="Delete reminder">${ic('x')}</button></div>`).join('')}</div>` : ''}
        <form data-form="reminder" class="rem-form" ${rems.length ? '' : 'style="margin-top:0"'}><input type="text" name="text" placeholder="Remind me to…" aria-label="Reminder" required><input type="datetime-local" name="at" aria-label="When" required><button class="btn">Set</button></form>`)}
      ${GAP}
    </div>
    <aside class="sidebar"><div class="sidebar-in">${focus}${coach}</div></aside></div>
  </div>`;
}

/* ---------------- Tasks ---------------- */
function viewTasks() {
  const f = taskFilter, match = t => (!f.area || t.area === f.area) && (!f.project || t.projectId === f.project);
  const g = taskGroups(match);
  const index = `<div style="margin-top:22px">
    <button class="idx ${!f.project ? 'on' : ''}" data-act="filterProject" data-id="">All tasks<span class="n">${openTasks().length}</span></button>
    ${S.projects.map(p => { const all = S.tasks.filter(t => t.projectId === p.id), done = all.filter(t => t.done).length;
      return `<button class="idx ${f.project === p.id ? 'on' : ''}" data-act="filterProject" data-id="${p.id}" title="${p.deadline ? 'Deadline ' + shortDate(p.deadline) : 'No deadline'}">${areaDot(p.area)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</span><span class="n">${done}/${all.length}</span><span class="x" data-act="delProject" data-id="${p.id}" title="Delete project">${ic('x', 12)}</span></button>`; }).join('')}
    <form data-form="project" class="proj-form">
      <input type="text" name="name" placeholder="New project…" aria-label="Project name" required>
      <select name="area" aria-label="Area">${Object.entries(AREAS).map(([k, a]) => `<option value="${k}">${a.label}</option>`).join('')}</select>
      <input type="date" name="deadline" title="Deadline (optional)" aria-label="Deadline">
      <button class="btn" style="justify-content:center">Add project</button>
    </form></div>`;
  const body = `${inlineAdd('quickTask', 'quickTasks', 'Add a task and press Enter…')}
    <p class="hint">Type <code>#studies</code> <code>#coding</code> <code>#ventures</code> <code>#health</code> for the area, <code>!high</code> or <code>!low</code> for priority, <code>today</code> or <code>tomorrow</code> for the date.</p>
    <div class="tags" style="margin:20px 0 28px"><button class="tag ${!f.area ? 'on' : ''}" data-act="filterArea" data-area="">All</button>${Object.entries(AREAS).map(([k, a]) => `<button class="tag ${f.area === k ? 'on' : ''}" data-act="filterArea" data-area="${k}">${areaDot(k)}${a.label}</button>`).join('')}</div>
    ${groupsHtml(g)}`;
  return `<div class="view">${pageHead('Projects, deadlines and the backlog behind your top 3.', 'Everything on your <span class="accent">plate</span>')}${GAP}
    ${section('Tasks', g.open.length, 'Filter by project here, by area on the right.', body, index)}${GAP}
    <div id="done">${section('Done', g.done.length, 'What you have finished, newest first. Untick one to put it back.', doneHtml(g.done))}</div>${GAP}</div>`;
}

/* ---------------- Progress ---------------- */
function viewProgress() {
  const idx = dayIndex(), st = streaks(idx), xp = totalXp(), lvl = levelOf(xp), lo = levelFloor(lvl), hi = levelFloor(lvl + 1);
  const tk = today(), start = addDays(tk, -(16 * 7 + new Date().getDay()));
  let weeks = '', activeDays = 0;
  for (let w = 0; w < 17; w++) {
    weeks += '<div class="wk">';
    for (let d = 0; d < 7; d++) {
      const k = addDays(start, w * 7 + d), s = idx[k], v = s ? s.xp : 0;
      const l = !s || !(s.tasks || s.focus) ? 0 : v < 30 ? 1 : v < 80 ? 2 : v < 150 ? 3 : 4;
      if (l) activeDays++;
      weeks += `<div class="cellx ${k > tk ? 'future' : ''}" data-l="${l}" title="${k}: ${s ? `${s.tasks} tasks, ${Math.round(s.focus / 60)} min, ${v} xp` : 'nothing'}"></div>`;
    }
    weeks += '</div>';
  }
  const week = [...Array(7)].map((_, i) => { const k = addDays(tk, i - 6); return { k, ...(idx[k] || { tasks: 0, focus: 0 }) }; });
  const bars = (key, fmt) => { const max = Math.max(1, ...week.map(d => d[key])); return `<div class="bars">${week.map(d => `<div class="b ${d.k === tk ? 'now' : ''}"><em>${fmt(d[key]) || ''}</em><i style="height:${d[key] / max * 100}%"></i><span>${new Date(d.k + 'T00:00').toLocaleDateString([], { weekday: 'short' }).toLowerCase()}</span></div>`).join('')}</div>`; };
  const done = S.tasks.filter(t => t.done), focusAll = S.sessions.reduce((a, s) => a + s.sec, 0);
  const areaMax = Math.max(1, ...Object.keys(AREAS).map(k => done.filter(t => t.area === k).length));
  const log = S.xpEvents.slice(-10).reverse();
  return `<div class="view">${pageHead('Streaks, focus and finished work. Numbers do not flatter.', 'What you have actually <span class="accent">done</span>')}
    <div class="strip">
      <div class="cell"><div class="cell-h"><i class="sq" style="background:${st.safe ? 'var(--ok)' : 'var(--l2)'}"></i>Current streak</div><div class="cell-v">${st.cur}<small>days</small></div></div>
      <div class="cell"><div class="cell-h"><i class="sq" style="background:var(--l2)"></i>Best streak</div><div class="cell-v">${st.best}<small>days</small></div></div>
      <div class="cell"><div class="cell-h"><i class="sq" style="background:var(--l2)"></i>Tasks finished</div><div class="cell-v">${done.length}</div></div>
      <div class="cell"><div class="cell-h"><i class="sq" style="background:var(--l2)"></i>Deep focus</div><div class="cell-v">${(focusAll / 3600).toFixed(1)}<small>hrs</small></div></div>
    </div>${GAP}
    ${section('Activity', activeDays, 'A day counts with one finished task or 15 focused minutes.', `<div class="heat-wrap"><div class="heat">${weeks}</div></div>
      <div class="legend">Less<span></span>${[0, 1, 2, 3, 4].map(l => `<i class="cellx" style="background:var(--l${l})"></i>`).join('')}<span></span>More</div>
      <p class="hint"><span class="mono fg">${activeDays}</span> active day${activeDays === 1 ? '' : 's'} in the last 17 weeks.</p>`)}${GAP}
    ${section('This week', null, 'Last seven days. Today is green.', `<div class="charts"><div class="box"><div class="box-h">Tasks finished</div>${bars('tasks', v => v)}</div><div class="box"><div class="box-h">Focus minutes</div>${bars('focus', v => Math.round(v / 60))}</div></div>`)}${GAP}
    ${section('Level', null, 'Earned from finished tasks and focused minutes.', `<div class="big">${lvl}<small>${titleOf(lvl).toLowerCase()}</small></div>
      <div class="meter" style="max-width:420px;margin-top:18px"><i style="width:${(xp - lo) / (hi - lo) * 100}%"></i></div>
      <p class="hint"><span class="mono fg">${xp}</span> xp · <span class="mono fg">${hi - xp}</span> to level ${lvl + 1}${lvl < TITLES.length ? ` (${titleOf(lvl + 1).toLowerCase()})` : ''}</p>`)}${GAP}
    ${section('Areas', null, 'Where the finished work went.', `<div class="list">${Object.entries(AREAS).map(([k, a]) => { const n = done.filter(t => t.area === k).length; return `<div class="hbar"><span>${areaDot(k)}${a.label}</span><div class="tr"><i style="width:${n / areaMax * 100}%"></i></div><em>${n}</em></div>`; }).join('')}</div>`)}${GAP}
    ${log.length ? section('Recent xp', log.length, '', `<div class="list">${log.map(e => `<div class="xprow"><span>${esc(e.r)}</span><em class="${e.a > 0 ? 'fg' : ''}">${e.a > 0 ? '+' : ''}${e.a}</em></div>`).join('')}</div>`) + GAP : ''}
  </div>`;
}

/* ---------------- Settings ---------------- */
let SYS = null;
const loadSys = () => CLOUD ? loadCloudStats() : Promise.all([fetch('/api/storage').then(r => r.json()), fetch('/api/autostart').then(r => r.json())])
  .then(([st, au]) => { SYS = { st, au }; if (view === 'settings' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) render(); }).catch(() => { });
let TZ_LIST = null;
function viewSettings() {
  const p = S.profile, np = 'Notification' in window ? Notification.permission : 'unsupported', theme = p.theme || 'dark', loc = homeLoc();
  TZ_LIST ??= (Intl.supportedValuesOf?.('timeZone') || []).concat('UTC');
  const you = `<div class="set">
      <label for="setName">Your name</label><input id="setName" type="text" data-set="name" value="${esc(p.name)}">
      <label>Theme</label><div class="tags"><button class="tag ${theme === 'dark' ? 'on' : ''}" data-act="theme" data-v="dark">Dark</button><button class="tag ${theme === 'light' ? 'on' : ''}" data-act="theme" data-v="light">Light</button></div>
      <label>Pen colour</label><div class="swatches"><button class="tag ${!p.pen ? 'on' : ''}" data-act="pen" data-c="">Auto</button>${PENS.map(c => `<button class="sw ${p.pen === c ? 'on' : ''}" style="background:${c}" data-act="pen" data-c="${c}" aria-label="Pen ${c}"></button>`).join('')}<input type="color" data-set="pen" value="${esc(p.pen || '#fcd34d')}" title="Custom colour" aria-label="Custom pen colour"></div>
    </div>`;
  const clock = `<div class="set">
      <label>Style</label><div class="tags"><button class="tag ${p.clockStyle !== 'analog' ? 'on' : ''}" data-act="clockStyle" data-v="digital">Digital</button><button class="tag ${p.clockStyle === 'analog' ? 'on' : ''}" data-act="clockStyle" data-v="analog">Analog</button><span class="small subtle">or click the clock</span></div>
      <label>Format</label><div class="tags"><button class="tag ${!p.clock24 ? 'on' : ''}" data-act="clock" data-v="">12-hour</button><button class="tag ${p.clock24 ? 'on' : ''}" data-act="clock" data-v="1">24-hour</button></div>
      <label>Sunrise and sunset for</label><div class="row" style="flex-wrap:wrap"><span class="mono small fg">${esc(loc.label)} · ${loc.lat.toFixed(2)}, ${loc.lon.toFixed(2)}</span><button class="btn sm" data-act="useLocation">Use my location</button>${p.lat != null ? '<button class="ghost" data-act="resetLocation">Reset</button>' : ''}</div>
    </div>`;
  const rhythm = `<div class="set">
      <label for="setEve">Evening recap</label><div class="row"><input id="setEve" type="number" min="0" max="23" data-set="eveningHour" value="${esc(p.eveningHour)}" style="width:90px"><span class="mono small">hour, 0–23</span></div>
      <label>Desktop notifications</label><div>${np === 'granted' ? '<span class="pill green">Enabled</span>' : np === 'denied' ? '<span class="pill red">Blocked</span> <span class="small">Allow them for localhost in your browser\'s site settings.</span>' : np === 'default' ? '<button class="btn" data-act="askNotify">Enable notifications</button>' : '<span class="small">Not supported in this browser.</span>'}</div>
    </div>`;
  const au = SYS?.au;
  const startup = `<div class="set">
      <label>Start when I log in</label><div>${!au ? '<span class="small subtle">Checking…</span>' : !au.supported ? '<span class="small">Only available on Windows.</span>'
      : `<div class="tags"><button class="tag ${au.on ? 'on' : ''}" data-act="autostart" data-v="1">On</button><button class="tag ${au.on ? '' : 'on'}" data-act="autostart" data-v="">Off</button></div>`}
        <p class="hint" style="margin-top:6px">Forge starts silently when Windows starts and opens in your browser. Sleep and wake do not stop it.</p></div>
      <label>Its own window</label><p class="small">In Chrome or Edge, click the install icon at the right end of the address bar. Forge then opens like an app, with its own icon and no tabs.</p>
      <label>Start it by hand</label><p class="small">Double-click <code>Forge.vbs</code> in the Forge folder.</p>
    </div>`;
  const brain = `<p class="prose">Works with any OpenAI-compatible API. The default is NVIDIA's free tier: sign in at <a href="https://build.nvidia.com" target="_blank" rel="noopener noreferrer">build.nvidia.com</a>, open any model, choose “Get API Key” and paste it here. The key is stored only in <code>data/config.json</code> on this computer.</p>
    <form data-form="ai" class="set">
      <label for="aiBase">API base URL</label><input id="aiBase" type="text" name="baseUrl" value="${esc(CFG.baseUrl)}">
      <label for="aiModel">Model</label><div><input id="aiModel" type="text" name="model" list="modelList" value="${esc(CFG.model)}"><datalist id="modelList">${MODELS.map(m => `<option value="${esc(m)}">`).join('')}</datalist><p class="hint" style="margin-top:6px">Free models get retired now and then. If the coach stops answering, clear this box and pick another.</p></div>
      <label for="aiKey">API key</label><input id="aiKey" type="password" name="apiKey" autocomplete="off" placeholder="${CFG.hasKey ? 'Saved — leave blank to keep it' : 'nvapi-…'}">
      <label for="groqKey">Voice key (Groq)</label><div><input id="groqKey" type="password" name="groqKey" autocomplete="off" placeholder="${CFG.hasGroq ? 'Saved — leave blank to keep it' : 'gsk_…'}"><p class="hint" style="margin-top:6px">Lets you talk to the coach. Speech is turned into text by OpenAI's Whisper on Groq; get a free key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">console.groq.com</a>. Click the mic, or hold <kbd>Alt</kbd> <kbd>V</kbd> anywhere. On the Board, it pins a voice note.</p></div>
      <span></span><div class="row"><button class="primary">Save</button><button type="button" class="btn" data-act="testAi">Test connection</button></div>
    </form>
    ${memoryList()}`;
  const st = SYS?.st;
  const data = `<div class="set">
      <label>Where it lives</label><div class="row" style="min-width:0"><code class="path">${esc(st?.dataDir || 'data')}</code><button class="btn sm" data-act="reveal">Open folder</button></div>
      <label>Using</label><div class="mono small fg">${st ? `${fmtBytes(st.db)} of tasks and notes · ${st.uploads.count} board file${st.uploads.count === 1 ? '' : 's'}, ${fmtBytes(st.uploads.bytes)}` : '…'}</div>
      <label>Safety net</label><p class="small">Every day Forge copies your data into <code>data/backups</code> and keeps the last 14${st ? ` (${st.backups.count} now)` : ''}. Files you delete from the board wait 30 days in <code>data/trash</code>${st?.trash.count ? ` (${st.trash.count} there, ${fmtBytes(st.trash.bytes)})` : ''}. Large photos are shrunk before saving. Your browser also keeps a copy, so nothing is lost if the server is off.</p>
      <label>Move it</label><div class="row"><button class="btn" data-act="export">Export backup</button><label class="btn" style="cursor:pointer">Import backup<input type="file" id="importFile" accept="application/json" hidden></label></div>
    </div>`;
  return `<div class="view">${pageHead('Name, look, clock, timer, rhythm, startup and the model behind the coach.', 'Make it <span class="accent">yours</span>')}${GAP}
    ${section('You', null, 'How Forge looks and what it calls you.', you)}${GAP}
    ${section('Clock', null, 'Style, format and where your sun is.', clock)}${GAP}
    ${section('Timer', null, 'Focus length, the daily goal, and how Forge tells you time is up', timerSettings())}${GAP}
    ${section('Rhythm', null, 'When the day gets judged, and how Forge reaches you.', rhythm)}${GAP}
    ${CLOUD ? cloudSettings() + section('Coach memory', null, 'What the coach keeps between chats.', memoryList()) + GAP : `
    ${section('Startup', null, 'Have Forge waiting when you open the laptop.', startup)}${GAP}
    ${section('Coach', null, `${CFG.hasKey ? '<span class="pill green">Connected</span>' : '<span class="pill">No key yet</span>'} ${CFG.hasGroq ? '<span class="pill green">Voice on</span>' : ''}`, brain)}${GAP}
    ${section('Data', null, 'Back it up. Move it. It is yours.', data)}${GAP}`}</div>`;
}

/* ---------------- render + nav indicator ---------------- */
const VIEWS = { today: viewToday, tasks: viewTasks, board: () => boardView(), progress: viewProgress, settings: viewSettings };
function moveIndicator(to) {
  const nav = $('#nav'), cur = nav.querySelector('[aria-current]'), el = to || cur, ind = $('#navInd');
  if (!el) return;
  ind.style.width = el.offsetWidth + 'px';
  ind.style.transform = `translateX(${el.offsetLeft}px)`;
  ind.style.opacity = el === cur ? 1 : .85;
}
function render() {
  const p = S.profile, root = document.documentElement, main = $('#main');
  root.dataset.theme = p.theme || 'dark';
  if (p.pen) root.style.setProperty('--pen', p.pen); else root.style.removeProperty('--pen');
  document.body.classList.toggle('board-mode', view === 'board');
  if (view === 'board') {
    if (!$('#bd')) { main.innerHTML = boardView(); bdMount(); } else bdRepaint();
    shownView = view;
  } else {
    if (BD.editing) BD.editing = null;
    main.innerHTML = VIEWS[view]();
    if (shownView !== view) { shownView = view; main.firstElementChild.classList.add('enter'); }
    if (view === 'today') paintClock(true);
  }
  document.querySelectorAll('#nav [data-view]').forEach(b => b.dataset.view === view ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
  moveIndicator();
  const lvl = levelOf(totalXp());
  $('#railLevel').textContent = `L${lvl} · ${titleOf(lvl).toLowerCase()}`;
  $('#sig').textContent = p.name ? '— ' + p.name.toLowerCase() : '';
  $('#fabDot').hidden = !S.chatUnread;
  paintTimer();
}

/* ---------------- command palette ---------------- */
let palItems = [], palSel = 0;
function palBuild(q) {
  const s = q.trim(), lq = s.toLowerCase(), items = [];
  if (s) items.push(
    { g: 'Create', label: `Add task “${s}”`, hint: 'task', run: () => { const p = parseQuick(s); if (p.title) { addTask({ title: p.title, area: p.area, priority: p.priority, due: p.due }); toast('Task added.'); commit(); } } },
    { g: 'Create', label: `Put “${s}” on the board`, hint: 'board', run: () => { bdAddText(s); toast('On the board.'); commit(); } },
    { g: 'Create', label: 'Ask the coach about this', hint: 'coach', run: () => { openAgent(); sendChat(s); } });
  Object.entries(VIEW_NAMES).filter(([, n]) => !lq || n.toLowerCase().includes(lq)).forEach(([k, n]) => items.push({ g: 'Go to', label: n, hint: 'page', run: () => ACT.view({ dataset: { view: k } }) }));
  const cmds = [
    !S.timer && { label: `Start a ${Number(S.profile.focusMin) || 25} minute focus session`, run: () => { startTimer(top3().find(t => !t.done)?.id, 'focus'); view = 'today'; commit(); } },
    !S.timer && { label: 'Start the stopwatch', run: () => { startTimer(null, 'stopwatch'); view = 'today'; commit(); } },
    { label: `Switch to ${(S.profile.theme || 'dark') === 'dark' ? 'light' : 'dark'} theme`, run: () => ACT.theme({ dataset: {} }) },
    { label: `Switch to ${S.profile.clockStyle === 'analog' ? 'digital' : 'analog'} clock`, run: () => ACT.clockStyle({ dataset: {} }) },
    { label: 'Talk to the coach', run: () => openAgent() },
  ].filter(c => c && (!lq || c.label.toLowerCase().includes(lq)));
  cmds.forEach(c => items.push({ g: 'Commands', hint: 'run', ...c }));
  if (lq) {
    openTasks().filter(t => t.title.toLowerCase().includes(lq)).slice(0, 6).forEach(t => items.push({ g: 'Tasks', label: t.title, hint: 'edit', run: () => openTaskDialog(t) }));
    S.board.filter(b => bdText(b).includes(lq)).slice(0, 5).forEach(b => items.push({ g: 'Board', label: (b.text || b.meta?.title || b.name || b.url || b.kind).slice(0, 70), hint: 'show', run: () => { boardFilter = { tag: null, q: s }; ACT.view({ dataset: { view: 'board' } }); BD.sel = new Set([b.id]); bdFit([b]); bdSyncSel(); } }));
  }
  return items;
}
function palPaint() {
  let g = '';
  $('#palList').innerHTML = palItems.map((it, i) => `${it.g !== g ? `<div class="pal-g">${g = it.g}</div>` : ''}<button class="pal-i ${i === palSel ? 'on' : ''}" data-act="palRun" data-i="${i}" tabindex="-1"><b>${esc(it.label)}</b><em>${i === palSel ? '↵' : it.hint}</em></button>`).join('');
  $('#palList .on')?.scrollIntoView({ block: 'nearest' });
}
function palRun(i) { const it = palItems[i]; if (!it) return; $('#palette').close(); it.run(); }

/* Called once by app.js after its helpers exist. */
function initViewLayer() {
  $('#nav').addEventListener('mouseover', e => { const b = e.target.closest('[data-view]'); if (b) moveIndicator(b); });
  $('#nav').addEventListener('mouseleave', () => moveIndicator());
  addEventListener('resize', () => { moveIndicator(); if (view === 'board') bdPlaceBar(); });
  document.fonts?.ready.then(() => moveIndicator());
  $('#palInput').addEventListener('input', e => { palItems = palBuild(e.target.value); palSel = 0; palPaint(); });
  $('#palInput').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); palSel = (palSel + (e.key === 'ArrowDown' ? 1 : -1) + palItems.length) % palItems.length; palPaint(); }
    if (e.key === 'Enter') { e.preventDefault(); palRun(palSel); }
  });
  addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); EXTRA_ACT.palette(); } }, true);
}

/* ---------------- actions owned by the view layer (merged into ACT by app.js) ---------------- */
const EXTRA_ACT = {
  view: el => { if (BD.editing) bdStopEdit(); view = el.dataset.view; scrollTo({ top: 0, behavior: 'instant' }); render(); if (view === 'settings') loadSys(); },
  theme: el => { S.profile.theme = el.dataset.v || ((S.profile.theme || 'dark') === 'dark' ? 'light' : 'dark'); commit(); },
  pen: el => { S.profile.pen = el.dataset.c; commit(); },
  palette: () => { const d = $('#palette'); if (d.open) return d.close(); $('#palInput').value = ''; palItems = palBuild(''); palSel = 0; palPaint(); d.showModal(); },
  palRun: el => palRun(Number(el.dataset.i)),
  clockStyle: el => { S.profile.clockStyle = el.dataset.v || (S.profile.clockStyle === 'analog' ? 'digital' : 'analog'); commit(); },
  zoneDel: el => { S.profile.zones = (S.profile.zones || []).filter(z => z !== el.dataset.z); commit(); },
  useLocation: () => {
    if (!navigator.geolocation) return toast('This browser cannot share a location.');
    toast('Asking your browser for your location…', '', 2500);
    navigator.geolocation.getCurrentPosition(
      pos => { Object.assign(S.profile, { lat: +pos.coords.latitude.toFixed(2), lon: +pos.coords.longitude.toFixed(2), place: 'your location' }); commit(); toast('Sunrise and sunset now follow your location.'); },
      () => toast('Location was not shared. Using your time zone instead.'), { timeout: 15000 });
  },
  resetLocation: () => { delete S.profile.lat; delete S.profile.lon; delete S.profile.place; commit(); },
  autostart: async el => {
    try { const r = await fetch('/api/autostart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: !!el.dataset.v }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error); SYS = { ...SYS, au: j }; render(); toast(j.on ? 'Forge will start when you log in.' : 'Forge will no longer start by itself.'); }
    catch (e) { toast(e.message || 'Could not change that.'); }
  },
  reveal: () => fetch('/api/reveal', { method: 'POST' }),
  calToggle: () => { S.profile.calOpen = !S.profile.calOpen; calMonth = null; commit(); },
  calPick: el => { calSel = el.dataset.d; if (S.profile.calOpen) calMonth = calSel.slice(0, 7); render(); },
  calToday: () => { calSel = null; calMonth = null; render(); },
  calStep: el => {
    const dir = Number(el.dataset.dir), sel = calSel || today();
    if (S.profile.calOpen) { const [y, m] = (calMonth || sel.slice(0, 7)).split('-').map(Number), d = new Date(y, m - 1 + dir, 1); calMonth = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
    else calSel = addDays(sel, 7 * dir);
    render();
  },
};
