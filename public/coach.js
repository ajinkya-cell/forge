/* Forge coach — tools the AI can call, the voice recorder (Whisper on Groq through /api/transcribe),
   coach memory and voice notes on the board. Loaded before app.js: nothing here runs until called. */

/* ---------------- the tools the coach can call ---------------- */
const AREA_KEYS = ['studies', 'coding', 'ventures', 'life'];
const fn = (name, description, properties, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } });
const TASK_FIELDS = {
  title: { type: 'string', description: 'Short, concrete task title (the action, without the project name)' },
  area: { type: 'string', enum: AREA_KEYS, description: 'studies, coding, ventures, or life (health and personal)' },
  priority: { type: 'string', enum: ['high', 'med', 'low'] },
  due: { type: 'string', description: 'Due date YYYY-MM-DD, or "none" to clear' },
  project: { type: 'string', description: 'Project name. If no project has this name yet, it is created.' },
  top3: { type: 'boolean', description: "Put it in today's top 3" },
  notes: { type: 'string' },
};
const COACH_TOOLS = [
  fn('start_timer', 'Start a new focus countdown or stopwatch. If a timer is paused and the user just says start/continue, use control_timer resume instead.', {
    minutes: { type: 'integer', description: 'Focus length in minutes, 5 to 240. Ignored for a stopwatch.' },
    mode: { type: 'string', enum: ['focus', 'stopwatch'] },
    task_id: { type: 'string', description: 'Optional id of the task being worked on' },
  }),
  fn('control_timer', 'Control the current timer. "stop", "hold", "wait", "pause" all mean pause (keeps the time). Use end ONLY when the user says end, finish, done, cancel, reset, log it, or "end the session".', {
    action: { type: 'string', enum: ['pause', 'resume', 'end', 'extend', 'lap'] },
    minutes: { type: 'integer', description: 'Minutes to add when extending (default 5)' },
  }, ['action']),
  fn('add_tasks', 'Add one or more tasks. When the user lists several things, add them all in one call. "X in project P" means a task X in project P.', {
    tasks: { type: 'array', items: { type: 'object', properties: TASK_FIELDS, required: ['title'] } },
  }, ['tasks']),
  fn('update_task', 'Change an existing task: rename, move date, change area/priority/project, top 3, notes, or reopen with done=false. Only include fields that change.', {
    id: { type: 'string' }, ...TASK_FIELDS, done: { type: 'boolean', description: 'false reopens a finished task' },
  }, ['id']),
  fn('complete_task', 'Mark one or more tasks as done.', { ids: { type: 'array', items: { type: 'string' } } }, ['ids']),
  fn('delete_task', 'Permanently delete tasks. Only when the user clearly says delete or remove.', { ids: { type: 'array', items: { type: 'string' } } }, ['ids']),
  fn('set_top3', "Replace today's top 3 with these open task ids (up to 3). An empty list clears it.", { ids: { type: 'array', items: { type: 'string' } } }, ['ids']),
  fn('project', 'Create, rename, change or delete a project. Deleting keeps its tasks.', {
    action: { type: 'string', enum: ['create', 'update', 'delete'] },
    name: { type: 'string', description: 'The project name (current name for update/delete)' },
    new_name: { type: 'string' }, area: { type: 'string', enum: AREA_KEYS },
    deadline: { type: 'string', description: 'YYYY-MM-DD, or "none" to clear' },
  }, ['action', 'name']),
  fn('reminder', 'Add a reminder at a local date and time, or cancel one by id.', {
    action: { type: 'string', enum: ['add', 'cancel'] },
    text: { type: 'string' }, at: { type: 'string', description: 'Local time YYYY-MM-DDTHH:MM' }, id: { type: 'string' },
  }, ['action']),
  fn('add_board_note', 'Pin a note, idea or link on the board.', { content: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } }, ['content']),
  fn('find_tasks', 'Look up tasks by words, project, area or due date, including done ones. Use before answering about tasks not in the state.', {
    query: { type: 'string' }, project: { type: 'string' }, area: { type: 'string', enum: AREA_KEYS },
    due: { type: 'string', enum: ['today', 'tomorrow', 'week', 'overdue', 'none'] },
    include_done: { type: 'boolean' },
  }),
  fn('get_progress', 'Read the last days of results: tasks done, focus minutes, XP, streak. Use for "how am I doing", "how was my week".', {
    days: { type: 'integer', description: '1 to 30, default 7' },
  }),
  fn('memory', 'Remember a lasting fact about the user (exam dates, goals, preferences), or forget one by id.', {
    action: { type: 'string', enum: ['remember', 'forget'] }, fact: { type: 'string' }, id: { type: 'string' },
  }, ['action']),
  fn('change_settings', 'Change app settings. Only include what changes.', {
    theme: { type: 'string', enum: ['dark', 'light'] },
    focus_minutes: { type: 'integer', description: 'Default focus length, 5 to 240' },
    daily_goal_hours: { type: 'number', description: 'Daily focus goal in hours, 0 to 16 (0 hides it)' },
    clock_style: { type: 'string', enum: ['digital', 'analog'] },
    clock_24h: { type: 'boolean' },
    sound: { type: 'string', enum: ['chime', 'bell', 'soft', 'digital', 'none'] },
    show: { type: 'string', enum: ['clock', 'timer'], description: 'What the Today page shows at the top' },
  }),
  fn('open_view', 'Switch the app to a page.', {
    view: { type: 'string', enum: ['today', 'tasks', 'board', 'progress', 'settings'] },
    project: { type: 'string', description: 'With view=tasks, filter to this project' },
  }, ['view']),
];

const projName = id => S.projects.find(p => p.id === id)?.name;
const taskLine = t => { const tk = today(); return `[${t.id}] ${t.title} (${t.area}, ${t.priority}${projName(t.projectId) ? ', project ' + projName(t.projectId) : ''}${t.due ? ', due ' + t.due : ''}${t.due && t.due < tk && !t.done ? ' OVERDUE' : ''}${t.top3 === tk ? ', TOP3' : ''}${t.done ? ', DONE' : ''})`; };
const dueArg = v => { const s = String(v ?? '').trim().toLowerCase(); if (s === 'today') return today(); if (s === 'tomorrow') return addDays(today(), 1); if (s === 'none' || s === '' || s === 'null') return null; return /^\d{4}-\d\d-\d\d$/.test(s) ? s : undefined; };
const normName = s => String(s || '').trim().toLowerCase().replace(/^(the|my)\s+/, '').replace(/\s+project$/, '').trim();
const projectArg = name => { const n = normName(name); if (!n) return null; const exact = S.projects.find(p => normName(p.name) === n); if (exact) return exact; const part = S.projects.filter(p => normName(p.name).includes(n)); return part.length === 1 ? part[0] : null; };
const fmtAt = ms => new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const idsArg = a => Array.isArray(a.ids) ? a.ids : a.id ? [a.id] : [];
function makeProject(name, area, deadline) {
  const p = { id: uid(), name: String(name).trim().replace(/\s+project$/i, '').slice(0, 80), area: AREA_KEYS.includes(area) ? area : 'life', deadline: deadline || null };
  S.projects.push(p); return p;
}

/* Runs one tool. Returns { result } for the model and { did } for the chat log. Never throws. */
function runTool(name, a = {}) {
  try {
    switch (name) {
      case 'start_timer': {
        if (S.timer) {
          if (!timerRunning() && !a.minutes) { pauseTimer(); view = 'today'; return { result: 'The paused timer is running again.', did: 'Resumed the timer' }; }
          return { result: `Error: a ${S.timer.kind} timer is already ${timerRunning() ? 'running' : 'paused'}. Ask whether to end it first.` };
        }
        const task = a.task_id ? taskById(a.task_id) : null;
        if (a.mode === 'stopwatch') { timerMode = 'stopwatch'; startTimer(task?.id, 'stopwatch'); }
        else {
          const m = Number(a.minutes) || kindMinutes();
          if (m < LIMIT[0] || m > LIMIT[1]) return { result: `Error: focus length must be ${LIMIT[0]} to ${LIMIT[1]} minutes.` };
          setFocusMinutes(m); timerMode = 'focus'; startTimer(task?.id, 'focus');
        }
        view = 'today';
        const what = S.timer.kind === 'stopwatch' ? 'stopwatch' : `${Math.round(S.timer.dur / 60)} min focus`;
        return { result: `Started ${what}${task ? ' on ' + task.title : ''}.`, did: `Started ${what}${task ? ': ' + task.title : ''}` };
      }
      case 'control_timer': {
        const tm = S.timer; if (!tm) return { result: 'Error: no timer is running.' };
        const run = timerRunning(), act = { stop: 'pause', hold: 'pause', continue: 'resume', start: 'resume', finish: 'end', cancel: 'end', reset: 'end' }[a.action] || a.action;
        if (act === 'pause') { if (!run) return { result: 'It was already paused.' }; pauseTimer(); return { result: 'Paused. The time is kept.', did: 'Paused the timer' }; }
        if (act === 'resume') { if (run) return { result: 'It is already running.' }; pauseTimer(); return { result: 'Resumed.', did: 'Resumed the timer' }; }
        if (act === 'end') { endTimer(false); return { result: 'Ended. Focus time over the minimum was logged.', did: 'Ended the timer' }; }
        if (act === 'lap') { if (tm.kind !== 'stopwatch') return { result: 'Error: only a stopwatch has laps.' }; tm.laps.push(swElapsed(tm)); return { result: `Lap ${tm.laps.length}.`, did: `Lap ${tm.laps.length}` }; }
        if (act === 'extend') {
          if (tm.kind === 'stopwatch') return { result: 'Error: a stopwatch has no end to extend.' };
          const m = Math.min(120, Math.max(1, Number(a.minutes) || 5)), s = m * 60;
          tm.dur += s; if (tm.endAt) tm.endAt += s * 1000; else tm.left += s;
          return { result: `Added ${m} minutes.`, did: `Added ${m} min to the timer` };
        }
        return { result: 'Error: action must be pause, resume, end, extend or lap.' };
      }
      case 'add_tasks': {
        const list = Array.isArray(a.tasks) ? a.tasks : a.title ? [a] : [];
        if (!list.length) return { result: 'Error: no tasks given.' };
        const made = [], bad = [], newProj = [];
        for (const x of list.slice(0, 15)) {
          const title = String(x.title || '').trim().slice(0, 200);
          if (!title) { bad.push('a task with no title'); continue; }
          // a repeated voice command shouldn't file the same thing twice
          const same = S.tasks.find(t => !t.done && t.title.trim().toLowerCase() === title.toLowerCase());
          if (same) { bad.push(`"${title}" (already open as [${same.id}]; use update_task to change it)`); continue; }
          let p = x.project ? projectArg(x.project) : null;
          if (x.project && !p) { p = makeProject(x.project, x.area); newProj.push(p.name); }
          const due = dueArg(x.due);
          const t = addTask({ title, area: AREA_KEYS.includes(x.area) ? x.area : (p?.area || 'life'), projectId: p?.id || null,
            priority: ['high', 'med', 'low'].includes(x.priority) ? x.priority : 'med', due: due || null, notes: String(x.notes || '') });
          if (x.top3 && top3().length < 3) t.top3 = today();
          made.push(t);
        }
        const didP = newProj.length ? `New project: ${newProj.join(', ')}. ` : '';
        return { result: didP + (made.length ? 'Added: ' + made.map(taskLine).join('; ') : 'Nothing added.') + (bad.length ? ` Skipped ${bad.join(', ')}.` : ''),
          did: didP + (made.length === 1 ? 'Added task: ' + made[0].title + (projName(made[0].projectId) ? ` (${projName(made[0].projectId)})` : '') : made.length ? `Added ${made.length} tasks: ${made.map(t => t.title).join(', ')}` : '') };
      }
      case 'update_task': {
        const t = taskById(a.id); if (!t) return { result: `Error: no task with id ${a.id}. Use find_tasks.` };
        const ch = [];
        if (a.title) { t.title = String(a.title).trim().slice(0, 200); ch.push('title'); }
        if (AREA_KEYS.includes(a.area)) { t.area = a.area; ch.push('area'); }
        if (['high', 'med', 'low'].includes(a.priority)) { t.priority = a.priority; ch.push('priority'); }
        if ('due' in a) { const d = dueArg(a.due); if (d === undefined) return { result: 'Error: due must be YYYY-MM-DD or "none".' }; t.due = d; ch.push(d ? 'due ' + d : 'no due date'); }
        if (a.project === 'none' || a.project === '') { t.projectId = null; ch.push('no project'); }
        else if (a.project) { let p = projectArg(a.project); if (!p) p = makeProject(a.project, t.area); t.projectId = p.id; ch.push('project ' + p.name); }
        if (typeof a.top3 === 'boolean') { if (a.top3 && top3().length >= 3 && t.top3 !== today()) return { result: 'Error: top 3 is full. Ask which one to swap out.' }; t.top3 = a.top3 ? today() : null; ch.push(a.top3 ? 'in top 3' : 'out of top 3'); }
        if (typeof a.notes === 'string') { t.notes = a.notes; ch.push('notes'); }
        if (a.done === false && t.done) { setDone(t, false); ch.push('reopened'); }
        if (a.done === true && !t.done) { setDone(t, true); ch.push('done'); }
        return ch.length ? { result: 'Updated: ' + taskLine(t), did: `Updated ${t.title}: ${ch.join(', ')}` } : { result: 'Nothing to change.' };
      }
      case 'complete_task': {
        const ts = idsArg(a).map(taskById), missing = idsArg(a).filter((id, i) => !ts[i]);
        const done = ts.filter(t => t && !t.done); done.forEach(t => setDone(t, true));
        if (!done.length) return { result: missing.length ? `Error: no task with id ${missing.join(', ')}.` : 'Already done.' };
        return { result: 'Done: ' + done.map(t => t.title).join(', '), did: 'Completed: ' + done.map(t => t.title).join(', ') };
      }
      case 'delete_task': {
        const ts = idsArg(a).map(taskById).filter(Boolean);
        if (!ts.length) return { result: 'Error: no matching task ids.' };
        if (S.timer && ts.some(t => t.id === S.timer.taskId)) S.timer.taskId = null;
        S.tasks = S.tasks.filter(t => !ts.includes(t));
        S.reminders = S.reminders.filter(r => !ts.some(t => t.id === r.taskId) || r.fired);
        return { result: 'Deleted: ' + ts.map(t => t.title).join(', '), did: 'Deleted: ' + ts.map(t => t.title).join(', ') };
      }
      case 'set_top3': {
        const ids = Array.isArray(a.ids) ? a.ids : [];
        const picks = ids.map(taskById).filter(t => t && !t.done).slice(0, 3);
        if (ids.length && !picks.length) return { result: 'Error: none of those ids are open tasks.' };
        S.tasks.forEach(t => { if (t.top3 === today() && !t.done) t.top3 = null; });
        picks.slice(0, 3 - top3().length).forEach(t => t.top3 = today());
        return picks.length ? { result: 'Top 3 set.', did: 'Set top 3: ' + picks.map(t => t.title).join(', ') } : { result: 'Top 3 cleared.', did: 'Cleared the top 3' };
      }
      case 'project': {
        const p = a.action === 'create' ? S.projects.find(x => normName(x.name) === normName(a.name)) : projectArg(a.name), dl = 'deadline' in a ? dueArg(a.deadline) : undefined;
        if ('deadline' in a && dl === undefined) return { result: 'Error: deadline must be YYYY-MM-DD or "none".' };
        if (a.action === 'create') {
          if (p) return { result: `A project called ${p.name} already exists.` };
          if (!String(a.name || '').trim()) return { result: 'Error: the project needs a name.' };
          const n = makeProject(a.name, a.area, dl);
          return { result: `Created project ${n.name} (${n.area}${n.deadline ? ', deadline ' + n.deadline : ''}).`, did: `New project: ${n.name}${n.deadline ? ' (deadline ' + shortDate(n.deadline) + ')' : ''}` };
        }
        if (!p) return { result: `Error: no project called ${a.name}. Projects: ${S.projects.map(x => x.name).join(', ') || 'none'}.` };
        if (a.action === 'delete') {
          S.projects = S.projects.filter(x => x !== p); S.tasks.forEach(t => { if (t.projectId === p.id) t.projectId = null; });
          if (taskFilter.project === p.id) taskFilter.project = null;
          return { result: `Deleted project ${p.name}; its tasks were kept.`, did: 'Deleted project: ' + p.name };
        }
        const ch = [];
        if (a.new_name) { p.name = String(a.new_name).trim().slice(0, 80); ch.push('renamed'); }
        if (AREA_KEYS.includes(a.area)) { p.area = a.area; ch.push('area ' + a.area); }
        if (dl !== undefined) { p.deadline = dl; ch.push(dl ? 'deadline ' + dl : 'no deadline'); }
        return ch.length ? { result: `Updated project ${p.name}.`, did: `Project ${p.name}: ${ch.join(', ')}` } : { result: 'Nothing to change.' };
      }
      case 'reminder': {
        if (a.action === 'cancel') {
          const r = S.reminders.find(x => x.id === a.id); if (!r) return { result: `Error: no reminder with id ${a.id}.` };
          S.reminders = S.reminders.filter(x => x !== r); return { result: 'Cancelled.', did: 'Cancelled reminder: ' + r.text };
        }
        const at = new Date(String(a.at || '')).getTime();
        if (!a.text || isNaN(at)) return { result: 'Error: need text and a time like 2026-11-13T18:00.' };
        if (at < Date.now() - 60000) return { result: 'Error: that time has already passed. Pick a future time.' };
        addReminder(String(a.text).slice(0, 200), at); askNotify();
        return { result: `Reminder set for ${localInput(at)}.`, did: `Reminder: ${a.text} (${fmtAt(at)})` };
      }
      case 'add_board_note': {
        const it = bdAddText(String(a.content || ''), undefined, Array.isArray(a.tags) ? a.tags : []);
        return it ? { result: 'Pinned on the board.', did: 'Put it on the board' + (it.tags?.length ? ' #' + it.tags.join(' #') : '') } : { result: 'Error: empty note.' };
      }
      case 'find_tasks': {
        const tk = today(), words = String(a.query || '').toLowerCase().split(/\s+/).filter(w => w.length > 1);
        const p = a.project ? projectArg(a.project) : null;
        if (a.project && !p) return { result: `No project called ${a.project}.` };
        const inDue = t => !a.due || (a.due === 'today' ? t.due === tk : a.due === 'tomorrow' ? t.due === addDays(tk, 1)
          : a.due === 'week' ? t.due && t.due >= tk && t.due <= addDays(tk, 7) : a.due === 'overdue' ? t.due && t.due < tk && !t.done : a.due === 'none' ? !t.due : true);
        const hits = S.tasks.filter(t => (a.include_done || !t.done) && (!a.area || t.area === a.area) && (!p || t.projectId === p.id) && inDue(t)
          && words.every(w => (t.title + ' ' + (t.notes || '') + ' ' + (projName(t.projectId) || '')).toLowerCase().includes(w)));
        return { result: hits.length ? hits.slice(0, 25).map(taskLine).join('\n') + (hits.length > 25 ? `\n…and ${hits.length - 25} more` : '') : 'No matching tasks.' };
      }
      case 'get_progress': {
        const n = Math.min(30, Math.max(1, Number(a.days) || 7)), idx = dayIndex(), st = streaks(idx);
        const rows = Array.from({ length: n }, (_, i) => addDays(today(), -i)).map(k => { const d = idx[k] || { tasks: 0, focus: 0, xp: 0 }; return `${k}: ${d.tasks} tasks, ${Math.round(d.focus / 60)} focus min, ${d.xp} XP`; });
        const sum = rows.reduce((s, _, i) => { const d = idx[addDays(today(), -i)] || {}; s.t += d.tasks || 0; s.f += Math.round((d.focus || 0) / 60); return s; }, { t: 0, f: 0 });
        return { result: `Streak ${st.cur} days (best ${st.best ?? '?'}). Level ${levelOf(totalXp())}, ${totalXp()} XP. Last ${n} days: ${sum.t} tasks, ${sum.f} focus min.\n${rows.join('\n')}` };
      }
      case 'memory': case 'remember': case 'forget': {
        const act = name === 'memory' ? a.action : name;
        if (act === 'forget') {
          const m = S.memory.find(x => x.id === a.id) || (a.fact && S.memory.find(x => x.text.toLowerCase().includes(String(a.fact).toLowerCase())));
          if (!m) return { result: `Error: nothing remembered matches.` };
          S.memory = S.memory.filter(x => x !== m); return { result: 'Forgotten.', did: 'Forgot: ' + m.text };
        }
        const fact = String(a.fact || '').trim().slice(0, 300); if (!fact) return { result: 'Error: nothing to remember.' };
        const norm = s => s.toLowerCase().replace(/[^\w ]/g, '').trim();
        const dup = S.memory.find(m => norm(m.text) === norm(fact));
        if (dup) return { result: `Already remembered as [${dup.id}].` };
        const m = { id: uid(), text: fact, t: Date.now() }; S.memory.push(m); S.memory = S.memory.slice(-50);
        return { result: `Remembered [${m.id}].`, did: 'Remembered: ' + fact };
      }
      case 'change_settings': {
        const p = S.profile, ch = [];
        if (['dark', 'light'].includes(a.theme)) { p.theme = a.theme; ch.push(a.theme + ' theme'); }
        if (a.focus_minutes != null) { const m = Number(a.focus_minutes); if (!(m >= LIMIT[0] && m <= LIMIT[1])) return { result: `Error: focus length must be ${LIMIT[0]}–${LIMIT[1]} minutes.` }; setFocusMinutes(m); ch.push(`focus ${p.focusMin} min`); }
        if (a.daily_goal_hours != null) { const h = Number(a.daily_goal_hours); if (!(h >= 0 && h <= 16)) return { result: 'Error: goal must be 0 to 16 hours.' }; p.goalHours = Math.round(h * 2) / 2; ch.push(`daily goal ${p.goalHours}h`); }
        if (['digital', 'analog'].includes(a.clock_style)) { p.clockStyle = a.clock_style; ch.push(a.clock_style + ' clock'); }
        if (typeof a.clock_24h === 'boolean') { p.clock24 = a.clock_24h; ch.push(a.clock_24h ? '24-hour clock' : '12-hour clock'); }
        if (SOUNDS.includes(a.sound)) { p.sound = a.sound; ch.push('sound ' + a.sound); }
        if (['clock', 'timer'].includes(a.show)) { p.heroMode = a.show; view = 'today'; ch.push('showing the ' + a.show); }
        return ch.length ? { result: 'Changed: ' + ch.join(', '), did: 'Settings: ' + ch.join(', ') } : { result: 'Nothing to change.' };
      }
      case 'open_view': {
        if (!VIEW_NAMES[a.view]) return { result: 'Error: unknown page.' };
        view = a.view;
        if (a.view === 'tasks') { const p = a.project ? projectArg(a.project) : null; taskFilter.project = p?.id || null; }
        scrollTo({ top: 0, behavior: 'instant' });
        return { result: `Opened ${VIEW_NAMES[a.view]}.` };
      }
      // older names some models still reach for
      case 'add_reminder': return runTool('reminder', { ...a, action: 'add' });
      case 'add_task': return runTool('add_tasks', { tasks: [a] });
      case 'create_project': return runTool('project', { ...a, action: 'create' });
    }
    return { result: `Error: unknown tool ${name}.` };
  } catch (e) { return { result: 'Error: ' + (e.message || 'that did not work') }; }
}

/* Models without function calling write their calls as text. Read those, and the old <action> format too. */
const OLD_ACTIONS = {
  add_task: a => ['add_tasks', { tasks: [a] }], complete_task: a => ['complete_task', { ids: [a.id] }], set_top3: a => ['set_top3', a],
  add_reminder: a => ['reminder', { ...a, action: 'add' }], add_board: a => ['add_board_note', { content: a.content, tags: a.tags }],
};
function parseTextCalls(text) {
  const calls = [];
  const out = String(text || '').replace(/<(action|tool_call)>([\s\S]*?)<\/\1>/g, (m, tag, raw) => {
    try {
      const j = JSON.parse(raw.trim());
      if (j.name) calls.push([j.name, typeof j.arguments === 'string' ? JSON.parse(j.arguments) : (j.arguments || j.parameters || {})]);
      else if (j.type && OLD_ACTIONS[j.type]) calls.push(OLD_ACTIONS[j.type](j));
    } catch { }
    return '';
  }).trim();
  return { text: out, calls };
}
const parseArgs = s => { try { const v = typeof s === 'string' ? JSON.parse(s || '{}') : (s || {}); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };

/* ---------------- voice: record, then transcribe with Whisper on Groq ---------------- */
const MIC_SVG = '<svg class="ic" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/></svg>';
const REC = { on: false, busy: false, target: 'chat', hold: false, cancel: false, mr: null, stream: null, ctx: null, timer: 0, chunks: [], vad: null, keyDown: false, keyAt: 0 };
const REC_LIMIT = 120000;   // longest recording
const SILENCE_MS = 1800;    // a pause this long after speech sends it
const NOTHING_MS = 8000;    // give up if no speech starts within this
const MIN_VOICE_MS = 300;   // less speech than this is noise, a click or a breath: never sent to Whisper

/* Voice activity, one step per ~50 ms. The noise floor follows the quietest level it has seen and drifts up slowly,
   so starting to talk straight away doesn't get taken for background noise. Pure, so it can be tested. */
function vadStep(v, rms, dt) {
  v.floor = v.floor == null ? Math.min(rms, 0.02) : rms < v.floor ? rms : v.floor + (rms - v.floor) * 0.003;
  const voiced = rms > Math.max(0.012, v.floor * 3);
  v.elapsed += dt;
  if (voiced) { v.voicedMs += dt; v.quietMs = 0; } else v.quietMs += dt;
  return voiced;
}
const vadNew = () => ({ floor: null, elapsed: 0, voicedMs: 0, quietMs: 0 });
const vadHeard = v => v.voicedMs >= MIN_VOICE_MS;

function recPaint(state) {
  document.body.dataset.rec = state || '';
  document.body.dataset.recTarget = state ? REC.target : '';
  const i = $('#chatInput'); if (i) i.placeholder = state === 'starting' ? 'Opening the mic…' : state === 'listening' ? 'Listening… speak now' : state === 'transcribing' ? 'Transcribing…' : "Tell me what's on your plate…";
  const chip = $('#recChip');
  if (chip) { chip.hidden = !(state && REC.target === 'board'); chip.textContent = state === 'transcribing' ? 'Transcribing…' : state === 'starting' ? 'Opening the mic…' : 'Listening… pause to pin it'; }
  document.querySelectorAll('[data-act="micChat"], [data-act="micBoard"]').forEach(b => b.setAttribute('aria-pressed', state === 'listening'));
}
function recError(msg) {
  if (REC.target === 'chat') { S.chat.push({ role: 'err', content: msg }); paintChat(); }
  else toast(msg, '', 4500);
}
// A short tick when the mic is really open, so you know when to start talking.
function recCue(ctx, up = true) {
  try {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.frequency.setValueAtTime(up ? 660 : 520, t); o.frequency.linearRampToValueAtTime(up ? 880 : 400, t + .09);
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.12, t + .015); g.gain.exponentialRampToValueAtTime(.0001, t + .12);
    o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + .13);
  } catch { }
}
async function recStart(target = 'chat', hold = false) {
  if (REC.on || REC.busy) return;
  if (!CFG.hasGroq) { toast('Voice needs a Groq key. Add one in Settings → Coach.'); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('This browser cannot record audio.'); return; }
  Object.assign(REC, { target, hold, cancel: false, chunks: [], busy: true, vad: vadNew() });
  recPaint('starting');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }); }
  catch { REC.busy = false; recPaint(''); recError('The microphone is blocked. Allow it for this site in the browser, then try again.'); return; }
  // A push-to-talk key let go while the mic was still opening becomes hands-free: it stops on the next pause.
  if (REC.hold && !REC.keyDown) REC.hold = false;
  const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : {});
  mr.ondataavailable = e => { if (e.data.size) REC.chunks.push(e.data); };
  mr.onstop = recFinish;
  Object.assign(REC, { mr, stream, on: true, busy: false });
  mr.start(250);
  recPaint('listening');
  let ctx;
  try {
    ctx = new AudioContext(); REC.ctx = ctx; recCue(ctx, true);
    const an = ctx.createAnalyser(); an.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Float32Array(an.fftSize); let last = performance.now();
    // setInterval, not requestAnimationFrame: animation frames stop when the window is in the background.
    REC.timer = setInterval(() => {
      if (!REC.on) return;
      const now = performance.now(), dt = now - last; last = now;
      an.getFloatTimeDomainData(buf);
      const rms = Math.sqrt(buf.reduce((s, x) => s + x * x, 0) / buf.length), v = REC.vad;
      vadStep(v, rms, dt);
      document.body.style.setProperty('--lvl', Math.min(1, rms * 9).toFixed(3));
      if (v.elapsed > REC_LIMIT) return recStop();
      if (!REC.hold && vadHeard(v) && v.quietMs > SILENCE_MS) return recStop();
      if (!REC.hold && !vadHeard(v) && v.elapsed > NOTHING_MS) return recStop(true, "I didn't hear anything. Check the microphone is the right one and not muted, then try again.");
    }, 50);
  } catch { REC.vad.voicedMs = MIN_VOICE_MS; setTimeout(() => REC.on && recStop(), REC_LIMIT); } // no meter: trust the user's stop
}
function recStop(cancel = false, why = '') {
  if (!REC.on) return;
  REC.on = false; REC.cancel = cancel; REC.why = why;
  clearInterval(REC.timer);
  if (REC.ctx && !cancel) recCue(REC.ctx, false);
  try { REC.mr.stop(); } catch { recFinish(); }
}
async function recFinish() {
  REC.stream?.getTracks().forEach(t => t.stop());
  const ctx = REC.ctx; setTimeout(() => ctx?.close().catch(() => { }), 200);
  document.body.style.removeProperty('--lvl');
  const blob = new Blob(REC.chunks, { type: (REC.mr?.mimeType || 'audio/webm').split(';')[0] });
  const heard = vadHeard(REC.vad || vadNew());
  Object.assign(REC, { on: false, mr: null, stream: null, ctx: null, chunks: [] });
  if (REC.cancel) { recPaint(''); if (REC.why) recError(REC.why); return; }
  // Whisper invents words from silence ("Thank you.", other languages), so silence never goes to it.
  if (!heard) { recPaint(''); return recError("I didn't hear any speech. Wait for the beep, then talk."); }
  REC.busy = true; recPaint('transcribing');
  let text = '';
  try {
    const r = await fetch('/api/transcribe', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Transcription failed.');
    text = String(j.text || '').trim();
  } catch (e) { REC.busy = false; recPaint(''); recError(e.message); return; }
  REC.busy = false; recPaint('');
  if (!text) return recError("I didn't catch that. Try again.");
  if (REC.target === 'board') return boardVoiceNote(text);
  openAgent(true); sendChat(text, { voice: true });
}
const recToggle = target => REC.on ? recStop() : recStart(target);

/* ---------------- voice notes on the board ---------------- */
// "…buy a new SSD. Tag hardware and ideas." → note "…buy a new SSD." with tags hardware, ideas
function splitSpokenTags(text) {
  const m = text.match(/(?:^|[.!?,;]\s*)(?:hashtags?|tags?|tagged(?:\s+(?:as|with))?)\s*:?\s+([\w#][\w\s,#&-]{0,80}?)[.!]?\s*$/i);
  if (!m) return { text, tags: [] };
  const tags = m[1].split(/\s*(?:,|&|\band\b)\s*|\s+/i).map(t => t.replace(/^#/, '').toLowerCase()).filter(t => /^[\w-]{2,30}$/.test(t) && t !== 'and');
  return { text: text.slice(0, m.index).replace(/[\s,;]+$/, '').trim() || text, tags };
}
function boardVoiceNote(text) {
  const { text: body, tags } = splitSpokenTags(text);
  if (view !== 'board') { view = 'board'; render(); }
  const it = bdAddText(body, undefined, tags);
  if (!it) return;
  BD.sel = new Set([it.id]);
  commit(); toast('Pinned on the board' + (it.tags.length ? ' · #' + it.tags.join(' #') : ''), '', 2600);
}

/* ---------------- memory list in Settings ---------------- */
function memoryList() {
  const mem = S.memory || [];
  return `<div class="mem"><div class="mem-h"><b>What the coach remembers</b><span class="small subtle">Say "remember…" to add, or remove anything here.</span></div>
    ${mem.length ? `<ul class="mem-list">${mem.map(m => `<li><span>${esc(m.text)}</span><button class="icon" data-act="forgetMemory" data-id="${m.id}" aria-label="Forget this" title="Forget this">${ic('x')}</button></li>`).join('')}</ul>`
      : '<p class="empty">Nothing yet. Tell the coach something worth keeping, like your exam dates or goals.</p>'}</div>`;
}

const COACH_ACT = {
  micChat: () => { if (!$('#agent').classList.contains('open')) openAgent(true); recToggle('chat'); },
  micBoard: () => recToggle('board'),
  forgetMemory: el => { S.memory = (S.memory || []).filter(m => m.id !== el.dataset.id); commit(); },
};
/* Alt+V: hold to talk and let go to send, or tap it to talk hands-free (it sends when you pause).
   Letting go of Alt does nothing, so the usual "release Alt first" never cuts a recording short. */
function coachKeyDown(e) {
  if (e.code !== 'KeyV' || !e.altKey || e.ctrlKey || e.metaKey) return false;
  e.preventDefault();
  if (e.repeat) return true;
  if (REC.on && !REC.hold) { recStop(); return true; } // a second tap sends a hands-free recording
  if (REC.on || REC.busy) return true;
  REC.keyDown = true; REC.keyAt = performance.now();
  const target = view === 'board' ? 'board' : 'chat';
  if (target === 'chat' && !$('#agent').classList.contains('open')) openAgent(true);
  recStart(target, true);
  return true;
}
function coachKeyUp(e) {
  if (e.key === 'Alt' && (REC.on || REC.busy)) { e.preventDefault(); return; } // keep the browser menu from opening
  if (e.code !== 'KeyV' || !REC.keyDown) return;
  REC.keyDown = false; e.preventDefault();
  if (!REC.on || !REC.hold) return;
  if (performance.now() - REC.keyAt < 500) REC.hold = false; // a quick tap: keep listening until a pause
  else recStop();
}
