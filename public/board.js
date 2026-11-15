/* Forge board — an infinite canvas for anything. Items live in S.board, the camera in S.boardCam.
   Loaded before app.js: nothing here runs until the board view is opened. */
const BD = { tool: 'select', sel: new Set(), editing: null, fresh: null, drag: null, space: false, undo: [], redo: [], hover: null, side: innerWidth > 900 };
const BD_TOOLS = [
  ['select', 'V', 'Select and move', '<path d="M4 2.5 12.5 9 8.4 9.6 10.6 14 8.9 14.8 6.7 10.4 4 13Z"/>'],
  ['hand', 'H', 'Pan', '<path d="M5.5 8V3.8a1 1 0 0 1 2 0V7.5m0-.5V2.8a1 1 0 0 1 2 0V7.5m0-3.2a1 1 0 0 1 2 0v4.2m0-2a1 1 0 0 1 2 0v3.6c0 2.8-2 4.4-4.4 4.4H8.3a3.6 3.6 0 0 1-2.9-1.5L3 9.6a1 1 0 0 1 1.6-1.2L5.5 9.5"/>'],
  ['note', 'N', 'Sticky note', '<path d="M3 2.5h10v7l-3.5 4H3Z"/><path d="M13 9.5H9.5V13"/>'],
  ['text', 'T', 'Text', '<path d="M3 3.5h10M8 3.5V13M6 13h4"/>'],
  ['pen', 'P', 'Draw', '<path d="M2.5 13.5c2-3.5 3-1 4.5-3.5s1.5-4.5 3-6 3.5-.5 3.5 1-2.5 2.5-4 4-2 4-7 4.5Z"/>'],
  ['rect', 'R', 'Rectangle', '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/>'],
  ['ellipse', 'O', 'Ellipse', '<ellipse cx="8" cy="8" rx="5.8" ry="4.6"/>'],
  ['arrow', 'A', 'Arrow', '<path d="M3 13 13 3M7 3h6v6"/>'],
  ['line', 'L', 'Line', '<path d="M3 13 13 3"/>'],
  ['eraser', 'E', 'Eraser', '<path d="M6.2 13.5h7.3"/><path d="M2.9 9.6 8.6 3.9a1.4 1.4 0 0 1 2 0l2.2 2.2a1.4 1.4 0 0 1 0 2l-5.4 5.4H5.6L2.9 10.8a.85.85 0 0 1 0-1.2Z"/><path d="m5.7 6.8 4.2 4.2"/>'],
  ['file', 'I', 'Add an image or file', '<path d="M9 2.5H4.5v11h7V5Z"/><path d="M9 2.5V5h2.5M6.5 9.5 8 8l1.5 1.5M8 8v3.5"/>'],
];
const BD_KEYS = Object.fromEntries(BD_TOOLS.map(t => [t[1].toLowerCase(), t[0]]));
const BD_SIZE = { note: [220, 130], text: [260, 34], link: [280, 90], image: [280, 200], file: [260, 64], task: [260, 60] };
const BD_SHAPES = new Set(['rect', 'ellipse', 'arrow', 'line', 'pen']);
const BD_AUTO_H = new Set(['note', 'text', 'link', 'file', 'task']);
const BD_FS = { text: 20, note: 15 }; // default font size by kind
const BD_FS_STEPS = [10, 12, 14, 15, 16, 18, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 120, 160];
const BD_INK = { ink: 'var(--fg)', red: '#ef4444', orange: '#f97316', yellow: '#eab308', green: '#22c55e', blue: '#3b82f6', violet: '#8b5cf6' };
const BD_PAPER = { ink: '#fbf4dc', red: '#fde2e2', orange: '#fde8d4', yellow: '#fdf3b0', green: '#dcf5e3', blue: '#dbe9fd', violet: '#ebe3fd' };
const ytId = url => (String(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/))([\w-]{11})/) || [])[1];
const fmtBytes = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';

/* ---------------- model ---------------- */
const bdCam = () => S.boardCam ??= { x: Math.round(innerWidth / 2), y: Math.round((innerHeight - 56) / 2), z: 1 };
const bdGet = id => S.board.find(b => b.id === id);
const bdSelItems = () => S.board.filter(b => BD.sel.has(b.id));
const bdTopZ = () => S.board.reduce((m, b) => Math.max(m, b.z || 0), 0);
function bdAdd(o) {
  const [w, h] = BD_SIZE[o.kind] || [200, 120];
  const it = { id: uid(), kind: 'note', x: 0, y: 0, w, h, z: bdTopZ() + 1, color: 'ink', tags: [], t: Date.now(), ...o };
  it.x = Math.round(it.x); it.y = Math.round(it.y);
  S.board.push(it); return it;
}
function bdText(it) {
  const t = it.kind === 'task' ? taskById(it.taskId)?.title : '';
  return [it.text, it.url, it.name, it.meta?.title, it.meta?.desc, t, ...(it.tags || [])].filter(Boolean).join(' ').toLowerCase();
}
const bdWords = () => boardFilter.q.toLowerCase().split(/\s+/).filter(Boolean);
function bdMatch(it) {
  const tag = boardFilter.tag;
  if (tag === '__none' && it.tags?.length) return false;
  if (tag && tag !== '__none' && !it.tags?.includes(tag)) return false;
  const words = bdWords(); if (!words.length) return true;
  const hay = bdText(it), tags = (it.tags || []).map(t => '#' + t);
  return words.every(w => w.startsWith('#') && w.length > 1 ? tags.some(t => t.startsWith(w)) : hay.includes(w.replace(/^#/, '')));
}
function bdSnap() { BD.undo.push(JSON.stringify(S.board)); if (BD.undo.length > 80) BD.undo.shift(); BD.redo = []; }
function bdUndo() {
  if (!BD.undo.length) return toast('Nothing to undo.');
  BD.redo.push(JSON.stringify(S.board)); S.board = JSON.parse(BD.undo.pop()); BD.sel.clear(); save(); bdRepaint();
}
function bdRedo() {
  if (!BD.redo.length) return;
  BD.undo.push(JSON.stringify(S.board)); S.board = JSON.parse(BD.redo.pop()); BD.sel.clear(); save(); bdRepaint();
}
const tagsFrom = s => [...String(s).matchAll(/(?:^|\s)#([\w-]+)/g)].map(m => m[1].toLowerCase());
const cleanTags = list => [...new Set(list.map(t => String(t).toLowerCase().replace(/^#/, '').trim().replace(/\s+/g, '-')).filter(t => t && t.length <= 30))];

/* Where to drop things that arrive without a pointer position (coach, palette, file picker). */
function bdViewCenter() {
  const c = bdCam(), n = S.board.length % 6;
  return [(innerWidth / 2 - c.x) / c.z - 110 + n * 24, ((innerHeight - 56) / 2 - c.y) / c.z - 60 + n * 24];
}
function bdAddText(text, at = bdViewCenter(), tags = []) {
  text = String(text || '').trim(); if (!text) return null;
  bdSnap();
  const [x, y] = at; let it;
  if (/^https?:\/\/\S+$/i.test(text)) {
    it = /\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(text) ? bdAdd({ kind: 'image', x, y, src: text }) : bdAdd({ kind: 'link', x, y, url: text });
    if (it.kind === 'link') bdPreview(it);
  } else {
    const w = Math.min(340, Math.max(180, Math.sqrt(text.length) * 26));
    it = bdAdd({ kind: 'note', x, y, w: Math.round(w), text });
  }
  it.tags = cleanTags([...tags, ...tagsFrom(text)]);
  return it;
}
async function bdPreview(it) {
  if (!it.url || it.metaTried) return;
  it.metaTried = true;
  try {
    const j = await (await fetch('/api/preview?url=' + encodeURIComponent(it.url))).json();
    if (j.title || j.image) { it.meta = { title: (j.title || '').slice(0, 160), image: j.image || '', site: j.site || '', desc: (j.desc || '').slice(0, 200) }; }
  } catch { }
  save(); if (view === 'board') bdRepaint();
}

/* ---------------- files ---------------- */
async function shrinkImage(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return { blob: file, name: file.name };
  try {
    const bmp = await createImageBitmap(file), max = 2200;
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 1.5e6) { const r = { blob: file, name: file.name, w: bmp.width, h: bmp.height }; bmp.close(); return r; }
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height); bmp.close();
    let blob = await new Promise(r => cv.toBlob(r, 'image/webp', .86));
    // Older Safari can't write WebP and hands back a PNG instead: use JPEG there
    if (blob && blob.type !== 'image/webp') blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', .86));
    const ext = blob?.type === 'image/webp' ? '.webp' : '.jpg';
    return blob && blob.size < file.size ? { blob, name: (file.name || 'image').replace(/\.\w+$/, '') + ext, w: cv.width, h: cv.height } : { blob: file, name: file.name, w: cv.width, h: cv.height };
  } catch { return { blob: file, name: file.name }; }
}
async function uploadBlob(blob, name) {
  const r = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': blob.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(name || 'file') }, body: blob });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Upload failed.');
  return j;
}
async function bdAddFiles(files, at = bdViewCenter()) {
  let [x, y] = at;
  for (const file of files) {
    try {
      toast(`Saving ${file.name || 'file'}…`, '', 1600);
      if (file.type.startsWith('image/')) {
        const s = await shrinkImage(file), up = await uploadBlob(s.blob, s.name);
        const w = 280, ar = s.w && s.h ? s.h / s.w : null;
        bdSnap(); const it = bdAdd({ kind: 'image', x, y, w, h: ar ? Math.round(w * ar) : 200, src: up.url, ar, name: file.name, size: up.size });
        if (boardFilter.tag && boardFilter.tag !== '__none') it.tags = [boardFilter.tag];
      } else {
        const up = await uploadBlob(file, file.name), isVid = /^video\//.test(file.type);
        bdSnap(); bdAdd({ kind: 'file', x, y, w: isVid ? 360 : 260, h: isVid ? 220 : 64, src: up.url, name: up.name, size: up.size, mime: file.type });
      }
      x += 30; y += 30; save(); if (view === 'board') bdRepaint();
    } catch (e) { toast(e.message, '', 6000); }
  }
}

/* ---------------- drawing ---------------- */
function rng(seed) { let s = 7; for (const c of seed) s = (s * 31 + c.charCodeAt(0)) | 0; return () => ((s = (s * 1103515245 + 12345) | 0) >>> 0) / 4294967296; }
const f1 = n => Math.round(n * 10) / 10;
function sketchLine(r, x1, y1, x2, y2, j) {
  const o = () => (r() - .5) * j;
  return `M${f1(x1 + o())} ${f1(y1 + o())}Q${f1((x1 + x2) / 2 + o() * 1.6)} ${f1((y1 + y2) / 2 + o() * 1.6)} ${f1(x2 + o())} ${f1(y2 + o())}`;
}
function smoothPath(pts) {
  if (pts.length < 2) return pts.length ? `M${f1(pts[0][0])} ${f1(pts[0][1])}l.1 .1` : '';
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) d += `Q${f1(pts[i][0])} ${f1(pts[i][1])} ${f1((pts[i][0] + pts[i + 1][0]) / 2)} ${f1((pts[i][1] + pts[i + 1][1]) / 2)}`;
  const l = pts[pts.length - 1]; return d + `L${f1(l[0])} ${f1(l[1])}`;
}
function shapeSvg(it) {
  const w = Math.max(1, it.w), h = Math.max(1, it.h), r = rng(it.id), sw = it.sw || 2, pad = sw / 2 + 3;
  const j = Math.max(1.5, Math.min(7, Math.min(w, h) * .035));
  let d = '', fillD = '';
  if (it.kind === 'rect') {
    const P = [[pad, pad], [w - pad, pad], [w - pad, h - pad], [pad, h - pad]];
    fillD = `M${pad} ${pad}H${w - pad}V${h - pad}H${pad}Z`;
    for (let k = 0; k < 2; k++) for (let i = 0; i < 4; i++) d += sketchLine(r, ...P[i], ...P[(i + 1) % 4], j);
  } else if (it.kind === 'ellipse') {
    const cx = w / 2, cy = h / 2, rx = Math.max(1, w / 2 - pad), ry = Math.max(1, h / 2 - pad);
    fillD = `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;
    for (let k = 0; k < 2; k++) {
      const a0 = r() * Math.PI * 2, pts = [];
      for (let i = 0; i <= 26; i++) { const a = a0 + i / 24 * Math.PI * 2, q = 1 + (r() - .5) * .05; pts.push([cx + Math.cos(a) * rx * q, cy + Math.sin(a) * ry * q]); }
      d += smoothPath(pts);
    }
  } else {
    const pts = (it.pts || []).map(([px, py]) => [px * w, py * h]);
    if (it.kind === 'pen') d = smoothPath(pts);
    else if (pts.length >= 2) {
      const [a, b] = [pts[0], pts[pts.length - 1]];
      d = sketchLine(r, ...a, ...b, j * .6) + sketchLine(r, ...a, ...b, j * .6);
      if (it.kind === 'arrow') {
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = Math.hypot(b[0] - a[0], b[1] - a[1]), L = Math.min(22, Math.max(9, len * .25)) + sw;
        for (const s of [-1, 1]) d += sketchLine(r, ...b, b[0] - L * Math.cos(ang + s * .45), b[1] - L * Math.sin(ang + s * .45), j * .4);
      }
    }
  }
  const pid = 'h' + it.id;
  const fill = !fillD || !it.fill || it.fill === 'none' ? '' : it.fill === 'solid' ? `<path class="fillp" d="${fillD}" fill="currentColor" fill-opacity=".16"/>`
    : `<defs><pattern id="${pid}" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(-45)"><line x1="0" y1="0" x2="0" y2="7" stroke="currentColor" stroke-width="1.3" opacity=".55"/></pattern></defs><path class="fillp" d="${fillD}" fill="url(#${pid})"/>`;
  return `<svg width="100%" height="100%" viewBox="0 0 ${f1(w)} ${f1(h)}" preserveAspectRatio="none" style="color:${BD_INK[it.color] || BD_INK.ink}" aria-hidden="true">${fill}<path d="${d}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/><path class="hit" d="${d}" fill="none" stroke="transparent" stroke-width="16" vector-effect="non-scaling-stroke"/></svg>`;
}
/* Arrows, lines and pen strokes store points as fractions of their box, so resizing just works. */
function bdFitPoints(it, worldPts) {
  const pad = 12, xs = worldPts.map(p => p[0]), ys = worldPts.map(p => p[1]);
  const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad, w = Math.max(...xs) + pad - x0, h = Math.max(...ys) + pad - y0;
  Object.assign(it, { x: Math.round(x0), y: Math.round(y0), w: Math.round(w), h: Math.round(h), pts: worldPts.map(([px, py]) => [+((px - x0) / w).toFixed(4), +((py - y0) / h).toFixed(4)]) });
}

/* ---------------- rendering ---------------- */
// Web addresses inside notes become blue links you can click (the text itself is unchanged).
const linkify = s => esc(s).replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/gi, u => `<a class="bi-url" href="${u}" target="_blank" rel="noopener noreferrer" draggable="false">${u}</a>`);
function bdItemInner(it) {
  switch (it.kind) {
    case 'note': case 'text':
      return `<div class="bi-text" data-ph="${it.kind === 'note' ? 'Write anything… #tags work' : 'Type…'}" ${BD.editing === it.id ? 'contenteditable="plaintext-only" spellcheck="true"' : ''}>${BD.editing === it.id ? esc(it.text || '') : linkify(it.text || '')}</div>`;
    case 'link': {
      let host = it.url; try { host = new URL(it.url).hostname.replace(/^www\./, ''); } catch { }
      const yt = ytId(it.url), img = it.meta?.image || (yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : '');
      return `${img ? `<div class="bi-cover"><img src="${esc(img)}" alt="" draggable="false" referrerpolicy="no-referrer" loading="lazy"></div>` : ''}
        <div class="bi-body"><div class="bi-host">${esc(it.meta?.site || host)}</div><a class="bi-title bi-url" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" draggable="false">${esc(it.meta?.title || it.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 100))}</a></div>
        <a class="bi-open" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" title="Open link" aria-label="Open link">${ic('open')}</a>`;
    }
    case 'image': return `<img src="${esc(it.src)}" alt="${esc(it.name || '')}" draggable="false" loading="lazy">`;
    case 'file': {
      const m = it.mime || '', ext = ((it.name || '').split('.').pop() || 'file').slice(0, 4).toUpperCase();
      if (m.startsWith('video/')) return `<video src="${esc(it.src)}" controls preload="metadata"></video>`;
      const audio = m.startsWith('audio/') ? `<audio src="${esc(it.src)}" controls preload="none"></audio>` : '';
      return `<div class="bi-filerow"><span class="bi-ext">${esc(ext)}</span><div class="bi-body"><div class="bi-title">${esc(it.name || 'file')}</div><div class="bi-host">${fmtBytes(it.size || 0)}</div></div>
        <a class="bi-open" href="${esc(it.src)}" target="_blank" rel="noopener" title="Open file" aria-label="Open file">${ic('open')}</a></div>${audio}`;
    }
    case 'task': {
      const t = taskById(it.taskId);
      if (!t) return '<div class="bi-body"><div class="bi-host">Task deleted</div></div>';
      return `<div class="task ${t.done ? 'done' : ''}" style="padding:0"><button class="check" data-act="toggleDone" data-id="${t.id}" aria-label="${t.done ? 'Reopen' : 'Complete'}">${ic('check', 12)}</button>
        <div class="t-body" data-act="editTask" data-id="${t.id}"><div class="t-title">${esc(t.title)}</div><div class="meta"><span>${areaDot(t.area)}${(AREAS[t.area] || AREAS.life).label}</span>${t.due ? `<span class="mono">${shortDate(t.due)}</span>` : ''}</div></div></div>`;
    }
    default: return shapeSvg(it);
  }
}
function bdItemHtml(it) {
  const sel = BD.sel.has(it.id), st = `left:${it.x}px;top:${it.y}px;width:${it.w}px;${BD_AUTO_H.has(it.kind) ? 'min-' : ''}height:${it.h}px;z-index:${it.z || 1};${it.kind === 'text' || it.kind === 'note' ? `--fs:${it.fs || BD_FS[it.kind]}px;` : ''}`;
  const tags = it.tags?.length ? `<div class="bi-tags">${it.tags.map(t => `<span>#${esc(t)}</span>`).join('')}</div>` : '';
  return `<div class="bi bi-${it.kind}${BD_SHAPES.has(it.kind) ? ' bi-shape' : ''}${sel ? ' sel' : ''}${bdMatch(it) ? '' : ' dim'}" data-bid="${it.id}" data-c="${it.color || 'ink'}" style="${st}">${bdItemInner(it)}${tags}${sel && BD.sel.size === 1 ? '<i class="bi-h" data-h="se" title="Resize"></i>' : ''}</div>`;
}
function bdPlace(it, inner) {
  const world = $('#bdWorld'); if (!world) return;
  let el = world.querySelector(`[data-bid="${it.id}"]`);
  if (!el) { world.insertAdjacentHTML('beforeend', bdItemHtml(it)); return; }
  el.style.left = it.x + 'px'; el.style.top = it.y + 'px'; el.style.width = it.w + 'px';
  el.style[BD_AUTO_H.has(it.kind) ? 'minHeight' : 'height'] = it.h + 'px';
  if (inner && BD_SHAPES.has(it.kind)) el.querySelector('svg').outerHTML = shapeSvg(it);
}
function bdSideTags() {
  const counts = {}; let none = 0;
  S.board.forEach(b => { (b.tags || []).forEach(t => counts[t] = (counts[t] || 0) + 1); if (!b.tags?.length) none++; });
  const row = (tag, label, n) => `<button class="bd-tag ${(boardFilter.tag || '') === tag ? 'on' : ''}" data-act="bdTagFilter" data-tag="${esc(tag)}">${label}<span>${n}</span></button>`;
  return row('', 'Everything', S.board.length) + Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t, n]) => row(t, '#' + esc(t), n)).join('') + (none && Object.keys(counts).length ? row('__none', 'Untagged', none) : '');
}
function bdBarHtml() {
  const items = bdSelItems(); if (!items.length || BD.drag) return '';
  const one = items.length === 1 ? items[0] : null, all = cleanTags(items.flatMap(i => i.tags || []));
  const isNote = items.every(i => i.kind === 'note'), shapes = items.every(i => BD_SHAPES.has(i.kind));
  const colors = items.some(i => ['note', 'text', ...BD_SHAPES].includes(i.kind)) ? `<div class="bd-grp bd-swatches" role="radiogroup" aria-label="Colour">${Object.keys(BD_INK).map(c => `<button class="bd-sw ${c === 'ink' ? 'ink' : ''} ${items.every(i => (i.color || 'ink') === c) ? 'on' : ''}" role="radio" aria-checked="${items.every(i => (i.color || 'ink') === c)}" data-act="bdColor" data-c="${c}" style="--sw:${isNote ? BD_PAPER[c] : BD_INK[c]}" title="${c === 'ink' ? 'Default' : c[0].toUpperCase() + c.slice(1)}" aria-label="${c === 'ink' ? 'Default colour' : c}"></button>`).join('')}</div>` : '';
  const stroke = shapes ? `<div class="bd-grp">${[[1.5, 'Thin'], [2.5, 'Bold'], [4, 'Extra bold']].map(([v, l]) => `<button class="bd-b ${one && (one.sw || 2) === v ? 'on' : ''}" data-act="bdStroke" data-v="${v}" title="${l}"><i style="height:${v}px"></i></button>`).join('')}${items.every(i => ['rect', 'ellipse'].includes(i.kind)) ? ['none', 'hatch', 'solid'].map(f => `<button class="bd-b ${one && (one.fill || 'none') === f ? 'on' : ''}" data-act="bdFill" data-v="${f}" title="Fill: ${f}"><span class="fill-${f}"></span></button>`).join('') : ''}</div>` : '';
  const fsNow = one && BD_FS[one.kind] ? one.fs || BD_FS[one.kind] : null;
  const size = fsNow ? `<div class="bd-grp bd-fs" title="Text size — or drag the corner"><button class="bd-b" data-act="bdFsStep" data-d="-1" aria-label="Smaller text"${fsNow <= BD_FS_STEPS[0] ? ' disabled' : ''}>${ic('minus')}</button><span class="bd-fs-v" aria-live="polite">${Math.round(fsNow)}</span><button class="bd-b" data-act="bdFsStep" data-d="1" aria-label="Larger text"${fsNow >= BD_FS_STEPS.at(-1) ? ' disabled' : ''}>${ic('plus')}</button></div>` : '';
  const tags = `<div class="bd-grp bd-tagbox">${all.map(t => `<button class="tag" data-act="bdUntag" data-tag="${esc(t)}" title="Remove tag">#${esc(t)} ${ic('x', 12)}</button>`).join('')}<form data-form="bdTag" class="bd-tagin">${ic('tags', 13)}<input id="bdTagIn" type="text" list="bdTagList" placeholder="Add tag" aria-label="Add a tag" autocomplete="off"></form></div>`;
  const acts = `<div class="bd-grp">
    ${CFG.hasKey && one && ['note', 'text', 'link'].includes(one.kind) ? `<button class="bd-b" data-act="bdAutoTag" title="Let the coach tag this" aria-label="Let the coach tag this">${ic('sparkTag', 16)}</button>` : ''}
    ${one && ['note', 'text', 'link'].includes(one.kind) ? `<button class="bd-b" data-act="bdToTask" title="Turn into a task" aria-label="Turn into a task">${ic('task', 16)}</button>` : ''}
    <button class="bd-b" data-act="bdFront" title="Bring to front" aria-label="Bring to front">${ic('front', 16)}</button>
    <button class="bd-b" data-act="bdDup" title="Duplicate — Ctrl+D" aria-label="Duplicate">${ic('copy', 16)}</button>
    <button class="bd-b danger" data-act="bdDel" title="Delete — Del" aria-label="Delete">${ic('trash', 16)}</button></div>`;
  return colors + stroke + size + tags + acts;
}
function bdPlaceBar() {
  const bar = $('#bdBar'); if (!bar) return;
  const items = bdSelItems();
  if (!items.length || !bar.innerHTML) { bar.hidden = true; return; }
  const c = bdCam(), bd = $('#bd').getBoundingClientRect();
  const x0 = Math.min(...items.map(i => i.x)), y0 = Math.min(...items.map(i => i.y)), x1 = Math.max(...items.map(i => i.x + i.w));
  const y1 = Math.max(...items.map(i => { const el = document.querySelector(`[data-bid="${i.id}"]`); return i.y + (el ? el.offsetHeight : i.h); }));
  // the selection is off-screen: no bar floating over nothing
  const sx0 = x0 * c.z + c.x, sx1 = x1 * c.z + c.x, sy0 = y0 * c.z + c.y, sy1 = y1 * c.z + c.y;
  if (sx1 < 0 || sx0 > bd.width || sy1 < 0 || sy0 > bd.height) { bar.hidden = true; return; }
  bar.hidden = false;
  const bw = bar.offsetWidth, bh = bar.offsetHeight;
  let left = (sx0 + sx1) / 2 - bw / 2, top = sy0 - bh - 16;
  if (top < 64) top = sy1 + 34;
  // never on top of the open search panel: start to its right
  const side = document.querySelector('.bd-side:not(.shut)'), minLeft = side ? side.getBoundingClientRect().right - bd.left + 8 : 8;
  bar.style.left = Math.max(minLeft, Math.min(bd.width - bw - 8, left)) + 'px';
  bar.style.top = Math.max(64, Math.min(bd.height - bh - 8, top)) + 'px';
}
function bdPaintBar(focusTags) {
  const bar = $('#bdBar'); if (!bar) return;
  bar.innerHTML = bdBarHtml(); bdPlaceBar();
  if (focusTags) $('#bdTagIn')?.focus();
}
function bdSyncSel() {
  document.querySelectorAll('#bdWorld .bi').forEach(el => {
    const on = BD.sel.has(el.dataset.bid);
    el.classList.toggle('sel', on);
    const h = el.querySelector(':scope > .bi-h'), want = on && BD.sel.size === 1;
    if (want && !h) el.insertAdjacentHTML('beforeend', '<i class="bi-h" data-h="se" title="Resize"></i>');
    if (!want && h) h.remove();
  });
  bdPaintBar();
}
function boardView() {
  const tools = BD_TOOLS.map(([k, key, label, icon]) => `<button class="bd-tool ${BD.tool === k ? 'on' : ''}" data-act="bdTool" data-tool="${k}" title="${label} — ${key}" aria-label="${label}" aria-pressed="${BD.tool === k}"><svg viewBox="0 0 16 16" aria-hidden="true">${icon}</svg></button>`).join('');
  return `<div class="bd" id="bd" data-tool="${BD.tool}">
    <div class="bd-world" id="bdWorld"></div>
    <div class="bd-empty" id="bdEmpty" aria-hidden="true">${matchMedia("(pointer: coarse)").matches ? '<span class="hand">double-tap anywhere to write</span><span class="mono">pinch to zoom · two fingers to move around</span>' : '<span class="hand">double-click anywhere to write</span><span class="mono">or paste a link, an image, any file · drop things here</span>'}</div>
    <div class="bd-ui bd-tools glass-pill" role="toolbar" aria-label="Board tools">${tools}${CFG.hasGroq ? `<button class="bd-tool bd-mic" data-act="micBoard" title="Voice note — or hold Alt+V" aria-label="Voice note" aria-pressed="false">${MIC_SVG}</button>` : ''}</div>
    <aside class="bd-ui bd-side ${BD.side ? '' : 'shut'}" aria-label="Search and tags">
      <div class="bd-side-h"><button class="ghost" data-act="bdSide" aria-expanded="${BD.side}" title="${BD.side ? 'Hide' : 'Show'} search and tags">${ic(BD.side ? 'chevL' : 'chevR', 14)}<b>Board</b><span class="bd-side-n" id="bdCount">${S.board.length}</span><span class="bd-side-f" id="bdFiltered" hidden></span></button>
        <button class="bd-side-s" data-act="bdOpenSearch" title="Search — Ctrl+F" aria-label="Search the board">${ic('search', 15)}</button></div>
      <div class="bd-side-b">
        <div class="bd-search">${ic('search', 14)}<input type="text" id="bdSearch" placeholder="Search notes, links, files…" aria-label="Search the board" aria-controls="bdResults" autocomplete="off" spellcheck="false" value="${esc(boardFilter.q)}"><button class="bd-search-x" data-act="bdClearSearch" title="Clear — Esc" aria-label="Clear search" ${boardFilter.q ? '' : 'hidden'}>${ic('x', 12)}</button></div>
        <div class="bd-results" id="bdResults" role="listbox" aria-label="Results"></div>
        <div class="bd-sec-h">Tags</div>
        <div class="bd-tags" id="bdTags">${bdSideTags()}</div>
        <p class="hint">Type <code>#tag</code> in a note, or tag a selection from its toolbar. <kbd>Ctrl</kbd> <kbd>F</kbd> searches.</p>
      </div>
    </aside>
    <div class="bd-ui bd-zoomc">
      <button class="icon" data-act="bdUndo" title="Undo — Ctrl+Z" aria-label="Undo">${ic('undo')}</button><button class="icon" data-act="bdRedo" title="Redo — Ctrl+Y" aria-label="Redo">${ic('redo')}</button>
      <span class="sep"></span>
      <button class="icon" data-act="bdZoom" data-f="0.8" aria-label="Zoom out">${ic('minus')}</button><button class="bd-zl mono" id="bdZoom" data-act="bdZoomReset" title="Reset to 100% (Shift+0)">100%</button><button class="icon" data-act="bdZoom" data-f="1.25" aria-label="Zoom in">${ic('plus')}</button>
      <button class="icon" data-act="bdFit" title="Fit everything — Shift+1" aria-label="Fit everything">${ic('fit')}</button>
    </div>
    <div class="bd-ui bd-bar glass-pill" id="bdBar" hidden></div>
    <datalist id="bdTagList"></datalist>
    <input type="file" id="bdFile" multiple hidden>
  </div>`;
}
function bdRepaint() {
  const world = $('#bdWorld'); if (!world) return;
  if (!BD.editing) world.innerHTML = S.board.map(bdItemHtml).join('');
  else S.board.forEach(it => { if (it.id !== BD.editing) { const el = world.querySelector(`[data-bid="${it.id}"]`); if (el) el.outerHTML = bdItemHtml(it); else world.insertAdjacentHTML('beforeend', bdItemHtml(it)); } });
  $('#bdTags').innerHTML = bdSideTags();
  $('#bdCount').textContent = S.board.length;
  bdSearchPaint();
  $('#bdEmpty').hidden = S.board.length > 0;
  $('#bdTagList').innerHTML = cleanTags(S.board.flatMap(b => b.tags || [])).map(t => `<option value="${esc(t)}">`).join('');
  bdPaintBar();
}
function bdApplyCam() {
  const c = bdCam(), w = $('#bdWorld'), bd = $('#bd'); if (!w) return;
  w.style.transform = `translate(${c.x}px,${c.y}px) scale(${c.z})`;
  const g = 24 * c.z;
  bd.style.backgroundSize = `${g}px ${g}px`; bd.style.backgroundPosition = `${c.x}px ${c.y}px`;
  $('#bdZoom').textContent = Math.round(c.z * 100) + '%';
  bdPlaceBar();
}
let bdCamSave;
const bdCamChanged = () => { bdApplyCam(); clearTimeout(bdCamSave); bdCamSave = setTimeout(save, 600); };
function bdZoomAt(f, sx, sy) {
  const c = bdCam(), r = $('#bd').getBoundingClientRect(), px = (sx ?? r.left + r.width / 2) - r.left, py = (sy ?? r.top + r.height / 2) - r.top;
  const z = Math.min(4, Math.max(.1, c.z * f));
  c.x = px - (px - c.x) * z / c.z; c.y = py - (py - c.y) * z / c.z; c.z = z; bdCamChanged();
}
function bdFit(items = S.board.filter(bdMatch)) {
  if (!items.length) items = S.board; if (!items.length) return;
  const r = $('#bd').getBoundingClientRect(), padL = BD.side && r.width > 900 ? 270 : 40;
  const x0 = Math.min(...items.map(i => i.x)), y0 = Math.min(...items.map(i => i.y));
  const x1 = Math.max(...items.map(i => i.x + i.w)), y1 = Math.max(...items.map(i => i.y + i.h + 24));
  const c = bdCam(), aw = r.width - padL - 40, ah = r.height - 150;
  c.z = Math.min(1.5, Math.max(.1, Math.min(aw / (x1 - x0), ah / (y1 - y0))));
  c.x = padL + (aw - (x1 - x0) * c.z) / 2 - x0 * c.z; c.y = 80 + (ah - (y1 - y0) * c.z) / 2 - y0 * c.z;
  bdCamChanged();
}
function bdSetTool(t) {
  if (t === 'file') return $('#bdFile')?.click();
  BD.tool = t; const bd = $('#bd'); if (!bd) return;
  bd.dataset.tool = t;
  bd.querySelectorAll('.bd-tool').forEach(b => { const on = b.dataset.tool === t; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
}

/* ---------------- editing text ---------------- */
function bdEdit(id) {
  if (BD.editing && BD.editing !== id) bdStopEdit();
  BD.editing = id; BD.sel = new Set([id]);
  const el = document.querySelector(`[data-bid="${id}"] .bi-text`); if (!el) return;
  el.setAttribute('contenteditable', 'plaintext-only'); el.setAttribute('spellcheck', 'true');
  el.focus();
  const rg = document.createRange(); rg.selectNodeContents(el); rg.collapse(false);
  const s = getSelection(); s.removeAllRanges(); s.addRange(rg);
  bdSyncSel(); $('#bdBar').hidden = true;
}
function bdStopEdit() {
  const id = BD.editing; if (!id) return;
  BD.editing = null;
  const it = bdGet(id), el = document.querySelector(`[data-bid="${id}"] .bi-text`);
  if (it && el) {
    const txt = el.innerText.replace(/\n+$/, '');
    if (txt !== (it.text || '')) { if (BD.fresh !== id) bdSnap(); it.text = txt; it.tags = cleanTags([...(it.tags || []), ...tagsFrom(txt)]); }
    if (!txt.trim()) { S.board = S.board.filter(b => b.id !== id); BD.sel.delete(id); }
  }
  BD.fresh = null; save(); bdRepaint();
}

/* ---------------- pointer, wheel, keys, paste, drop ---------------- */
const bdToWorld = (sx, sy) => { const r = $('#bd').getBoundingClientRect(), c = bdCam(); return [(sx - r.left - c.x) / c.z, (sy - r.top - c.y) / c.z]; };
function bdDown(e) {
  bdStopFling();
  if (e.button === 2 || e.target.closest('.bd-ui')) return;
  const itemEl = e.target.closest('.bi'), id = itemEl?.dataset.bid, [wx, wy] = bdToWorld(e.clientX, e.clientY);
  if (BD.editing) { if (id === BD.editing) return; bdStopEdit(); }
  const tool = BD.space || e.button === 1 ? 'hand' : BD.tool;
  const d = { sx: e.clientX, sy: e.clientY, wx, wy, pid: e.pointerId, moved: false, shift: e.shiftKey };
  if (tool === 'hand' || (tool === 'select' && !itemEl)) {
    const c = bdCam(); BD.drag = { ...d, mode: 'pan', cx: c.x, cy: c.y, clear: tool === 'select' };
  } else if (tool === 'select') {
    if (e.target.classList.contains('bi-h')) { const it = bdGet(id); BD.drag = { ...d, mode: 'resize', id, ow: it.w, oh: itemEl.offsetHeight, ofs: it.fs || BD_FS[it.kind] }; }
    else {
      if (e.shiftKey) BD.sel.has(id) ? BD.sel.delete(id) : BD.sel.add(id);
      else if (!BD.sel.has(id)) BD.sel = new Set([id]);
      bdSyncSel();
      if (e.target.closest('a, button, video, audio, input, select, textarea')) return;
      BD.drag = { ...d, mode: 'move', orig: bdSelItems().map(i => [i, i.x, i.y]) };
    }
  } else if (tool === 'eraser') {
    BD.drag = { ...d, mode: 'erase', hit: new Set(), lx: e.clientX, ly: e.clientY };
    if (BD.sel.size) { BD.sel.clear(); bdSyncSel(); }
    try { $('#bd').setPointerCapture(e.pointerId); } catch { }
    bdEraseAt(BD.drag, e.clientX, e.clientY);
  } else if (tool === 'note' || tool === 'text') BD.drag = { ...d, mode: 'place', kind: tool };
  else BD.drag = { ...d, mode: tool === 'pen' ? 'pen' : ['arrow', 'line'].includes(tool) ? 'line' : 'shape', kind: tool, pts: [[wx, wy]] };
  e.preventDefault();
}
function bdMove(e) {
  const c = bdCam(); if (!$('#bd')) return;
  BD.hover = bdToWorld(e.clientX, e.clientY);
  const d = BD.drag; if (!d || e.pointerId !== d.pid) return;
  if (d.mode === 'erase') return bdEraseAlong(d, e.clientX, e.clientY);
  const dx = e.clientX - d.sx, dy = e.clientY - d.sy, [wx, wy] = BD.hover;
  if (!d.moved) {
    if (Math.hypot(dx, dy) < 3) return;
    d.moved = true; try { $('#bd').setPointerCapture(d.pid); } catch { }
    if (d.mode === 'move' || d.mode === 'resize') bdSnap();
    if (d.mode === 'pan') $('#bd').classList.add('panning');
    if (['shape', 'line', 'pen'].includes(d.mode)) { bdSnap(); const it = bdAdd({ kind: d.kind, x: d.wx, y: d.wy, w: 1, h: 1, color: BD.color || 'ink', sw: 2 }); d.id = it.id; BD.sel = new Set(); }
    $('#bdBar').hidden = true;
  }
  if (d.mode === 'pan') { c.x = d.cx + dx; c.y = d.cy + dy; bdApplyCam(); (d.trail ||= []).push([performance.now(), e.clientX, e.clientY]); if (d.trail.length > 6) d.trail.shift(); return; }
  if (d.mode === 'move') { d.orig.forEach(([it, x, y]) => { it.x = Math.round(x + dx / c.z); it.y = Math.round(y + dy / c.z); bdPlace(it); }); return; }
  if (d.mode === 'resize') {
    const it = bdGet(d.id); let w = Math.max(40, d.ow + dx / c.z), h = Math.max(24, d.oh + dy / c.z);
    if (it.kind === 'image' && it.ar && !e.shiftKey) h = w * it.ar;
    if (BD_FS[it.kind] && !e.altKey) {
      // the writing scales with the box: drag the corner and the text grows or shrinks, keeping its line breaks
      const s = Math.max(w / d.ow, h / d.oh);
      w = d.ow * s; h = d.oh * s;
      it.fs = Math.round(Math.min(160, Math.max(8, d.ofs * s)) * 2) / 2;
      const el = document.querySelector(`[data-bid="${it.id}"]`); el?.style.setProperty('--fs', it.fs + 'px');
    }
    it.w = Math.round(w); it.h = Math.round(h); bdPlace(it, true); return;
  }
  const it = bdGet(d.id); if (!it) return;
  if (d.mode === 'shape') {
    let w = Math.abs(wx - d.wx), h = Math.abs(wy - d.wy);
    if (e.shiftKey) w = h = Math.max(w, h);
    Object.assign(it, { x: Math.round(wx < d.wx ? d.wx - w : d.wx), y: Math.round(wy < d.wy ? d.wy - h : d.wy), w: Math.max(2, Math.round(w)), h: Math.max(2, Math.round(h)) });
  } else if (d.mode === 'line') {
    let [ex, ey] = [wx, wy];
    if (e.shiftKey) { const a = Math.round(Math.atan2(ey - d.wy, ex - d.wx) / (Math.PI / 4)) * Math.PI / 4, L = Math.hypot(ex - d.wx, ey - d.wy); ex = d.wx + L * Math.cos(a); ey = d.wy + L * Math.sin(a); }
    bdFitPoints(it, [[d.wx, d.wy], [ex, ey]]);
  } else {
    const last = d.pts[d.pts.length - 1];
    if (Math.hypot(wx - last[0], wy - last[1]) * c.z < 2.5) return;
    d.pts.push([wx, wy]); bdFitPoints(it, d.pts);
  }
  bdPlace(it, true);
}
function bdUp(e) {
  const d = BD.drag; if (!d || e.pointerId !== d.pid) return;
  BD.drag = null; $('#bd')?.classList.remove('panning');
  if (d.mode === 'erase') return bdEraseFinish(d);
  if (!d.moved) {
    if (d.mode === 'pan' && d.clear && BD.sel.size && !d.shift) { BD.sel.clear(); bdSyncSel(); }
    else if (d.mode === 'place') {
      bdSnap(); const it = bdAdd({ kind: d.kind, x: d.wx - (d.kind === 'note' ? 24 : 4), y: d.wy - 18, color: BD.color && d.kind === 'text' ? BD.color : 'ink' });
      BD.fresh = it.id; bdSetTool('select'); bdRepaint(); bdEdit(it.id);
    } else bdPaintBar();
    return;
  }
  if (d.mode === 'pan') bdFling(d.trail);
  if (['shape', 'line', 'pen'].includes(d.mode)) {
    const it = bdGet(d.id);
    if (it && (d.mode === 'line' ? it.w * it.h < 900 && Math.max(it.w, it.h) < 34 : it.w < 6 && it.h < 6)) S.board = S.board.filter(b => b.id !== it.id);
    else if (it && d.mode !== 'pen') { BD.sel = new Set([it.id]); bdSetTool('select'); }
  }
  save(); bdRepaint();
}
/* ---------------- momentum ----------------
   The release velocity carries on and decays exponentially at Apple's scroll rate (0.998 per ms),
   so a flick throws the canvas and a slow drag just stops where you let go. */
let BD_FLING = 0;
function bdStopFling() { cancelAnimationFrame(BD_FLING); BD_FLING = 0; }
function bdFling(trail) {
  bdStopFling();
  if (!trail || trail.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const now = performance.now(), recent = trail.filter(p => now - p[0] < 90);
  if (recent.length < 2) return; // the pointer had stopped before letting go
  const a = recent[0], b = recent[recent.length - 1], dt = Math.max(8, b[0] - a[0]);
  let vx = (b[1] - a[1]) / dt, vy = (b[2] - a[2]) / dt; // px per ms
  if (Math.hypot(vx, vy) < 0.25) return;
  let last = now;
  const step = t => {
    const ms = Math.min(32, t - last); last = t;
    const k = Math.pow(0.998, ms), c = bdCam();
    c.x += vx * ms; c.y += vy * ms; vx *= k; vy *= k;
    bdApplyCam();
    if (Math.hypot(vx, vy) < 0.02 || !$('#bd')) { BD_FLING = 0; bdCamChanged?.(); return; }
    BD_FLING = requestAnimationFrame(step);
  };
  BD_FLING = requestAnimationFrame(step);
}

/* ---------------- search ----------------
   Typing filters live: matches stay, the rest fade, and a list of results appears under the field.
   Arrow keys move through it, Enter flies the canvas to a result and selects it, Esc clears.
   Only classes change while you type; the canvas is never rebuilt, so nothing flickers. */
BD.hit = 0;
const BD_KIND_IC = { note: 'note', text: 'textT', link: 'link', image: 'image', file: 'file', task: 'task' };
function bdLabel(it) {
  if (it.kind === 'task') return taskById(it.taskId)?.title || 'Task';
  if (it.kind === 'link') return it.meta?.title || it.url.replace(/^https?:\/\/(www\.)?/, '');
  if (it.kind === 'image' || it.kind === 'file') return it.name || (it.kind === 'image' ? 'Image' : 'File');
  return (it.text || '').replace(/\s+/g, ' ').trim() || (it.kind === 'note' ? 'Empty note' : 'Text');
}
// a short piece of the label around the first match, with every matching word marked
function bdSnippet(it, words) {
  let s = bdLabel(it); const lower = s.toLowerCase(), first = words.map(w => lower.indexOf(w.replace(/^#/, ''))).filter(i => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  if (s.length > 70 && first > 30) { let from = s.lastIndexOf(' ', first - 12); if (from < 0 || first - from > 40) from = first - 24; s = '…' + s.slice(from + 1); }
  if (s.length > 70) s = s.slice(0, 68) + '…';
  // find every match on the raw text, merge overlaps, then escape piece by piece (never mark inside an &amp;)
  const low = s.toLowerCase(), spans = [];
  words.map(w => w.replace(/^#/, '')).filter(Boolean).forEach(w => { for (let i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + w.length)) spans.push([i, i + w.length]); });
  spans.sort((p, q) => p[0] - q[0]);
  let out = '', at = 0;
  for (const [x, y] of spans.reduce((m, sp) => { const l = m[m.length - 1]; if (l && sp[0] <= l[1]) l[1] = Math.max(l[1], sp[1]); else m.push([...sp]); return m; }, [])) { out += esc(s.slice(at, x)) + '<mark>' + esc(s.slice(x, y)) + '</mark>'; at = y; }
  return out + esc(s.slice(at));
}
function bdHits() { return bdWords().length ? S.board.filter(it => !BD_SHAPES.has(it.kind) && bdMatch(it)) : []; }
function bdSearchPaint() {
  const box = $('#bdResults'); if (!box) return;
  const words = bdWords(), hits = bdHits(), searching = words.length > 0;
  // fade the rest and mark the matches, in place
  document.querySelectorAll('#bdWorld .bi').forEach(el => { const it = bdGet(el.dataset.bid); if (!it) return; const m = bdMatch(it); el.classList.toggle('dim', !m); el.classList.toggle('hit', searching && m && !BD_SHAPES.has(it.kind)); });
  $('.bd-search-x').hidden = !boardFilter.q;
  const f = $('#bdFiltered'), filtering = searching || boardFilter.tag;
  f.hidden = !filtering; if (filtering) f.textContent = `${S.board.filter(bdMatch).length} shown`;
  if (!searching) { box.innerHTML = ''; box.hidden = true; return; }
  box.hidden = false;
  BD.hit = Math.min(BD.hit, Math.max(0, hits.length - 1));
  box.innerHTML = hits.length
    ? `<div class="bd-res-n">${hits.length} result${hits.length === 1 ? '' : 's'}</div>` + hits.slice(0, 50).map((it, i) => `<button class="bd-res ${i === BD.hit ? 'on' : ''}" role="option" aria-selected="${i === BD.hit}" data-act="bdGoHit" data-i="${i}" tabindex="-1">${ic(BD_KIND_IC[it.kind] || 'note', 14)}<span>${bdSnippet(it, words)}</span></button>`).join('')
    : `<div class="bd-res-none">Nothing on the board matches “${esc(boardFilter.q.trim())}”.</div>`;
  box.querySelector('.bd-res.on')?.scrollIntoView({ block: 'nearest' });
}
function bdSearchInput(v) { boardFilter.q = v; BD.hit = 0; BD.went = false; bdSearchPaint(); }
function bdOpenSearch() {
  if (!BD.side) BOARD_ACT.bdSide();
  const i = $('#bdSearch'); i?.focus(); i?.select();
}
function bdSearchKey(e) {
  const hits = bdHits(), k = e.key;
  if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); if (!hits.length) return; BD.hit = (BD.hit + (k === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; BD.went = false; bdSearchPaint(); return; }
  if (k === 'Enter') {
    e.preventDefault(); if (!hits.length) return;
    if (e.shiftKey) BD.hit = (BD.hit - 1 + hits.length) % hits.length;
    else if (BD.went) BD.hit = (BD.hit + 1) % hits.length;
    BD.went = true; bdGoTo(hits[BD.hit]); bdSearchPaint(); return;
  }
  if (k === 'Escape') { e.preventDefault(); if (e.target.value) { e.target.value = ''; bdSearchInput(''); } else e.target.blur(); }
}
// fly the canvas so the item sits in the middle of the free space, then select it and pulse it once
function bdGoTo(it) {
  if (!it) return;
  const r = $('#bd').getBoundingClientRect(), padL = BD.side && r.width > 900 ? 270 : 0, c = bdCam();
  const el = document.querySelector(`[data-bid="${it.id}"]`), h = el ? el.offsetHeight : it.h;
  const z = Math.min(1.25, Math.max(.6, c.z, Math.min((r.width - padL - 160) / it.w, (r.height - 220) / h) > 1 ? Math.max(c.z, .9) : c.z));
  const tx = padL + (r.width - padL) / 2 - (it.x + it.w / 2) * z, ty = r.height / 2 + 10 - (it.y + h / 2) * z;
  BD.sel = new Set([it.id]); bdSyncSel();
  bdFly(tx, ty, z, () => { const e2 = document.querySelector(`[data-bid="${it.id}"]`); if (e2) { e2.classList.remove('found'); void e2.offsetWidth; e2.classList.add('found'); } });
}
// a critically damped spring (damping 1, response .35 s) on x, y and zoom; any grab or scroll stops it
function bdFly(tx, ty, tz, done) {
  bdStopFling();
  const c = bdCam(), from = { x: c.x, y: c.y, z: c.z }, w0 = 2 * Math.PI / .35, t0 = performance.now();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { Object.assign(c, { x: tx, y: ty, z: tz }); bdCamChanged(); return done?.(); }
  let finished = false;
  const finish = () => { if (finished) return; finished = true; cancelAnimationFrame(BD_FLING); Object.assign(c, { x: tx, y: ty, z: tz }); BD_FLING = 0; bdCamChanged(); done?.(); };
  const step = now => {
    if (finished) return;
    const t = (now - t0) / 1000, p = Math.min(1, 1 - (1 + w0 * t) * Math.exp(-w0 * t));
    c.x = from.x + (tx - from.x) * p; c.y = from.y + (ty - from.y) * p; c.z = from.z + (tz - from.z) * p; bdApplyCam();
    if (t < .55) BD_FLING = requestAnimationFrame(step); else finish();
  };
  BD_FLING = requestAnimationFrame(step);
  // when the window isn't drawing (minimised, in the background), animation frames pause: arrive anyway
  const flyId = BD_FLING; setTimeout(() => { if (!finished && (BD_FLING === flyId || BD_FLING)) finish(); }, 700);
}

/* ---------------- eraser ----------------
   Items under the eraser fade while you drag, and go when you let go — one undo step brings them all back.
   It checks a small ring around the pointer and fills in the gaps between moves, so thin pen strokes are easy to catch. */
const ERASE_R = 7;
function bdEraseAt(d, cx, cy) {
  for (const [ox, oy] of [[0, 0], [ERASE_R, 0], [-ERASE_R, 0], [0, ERASE_R], [0, -ERASE_R]]) {
    for (const el of document.elementsFromPoint(cx + ox, cy + oy)) {
      if (el.closest('.bd-ui')) break;
      const item = el.closest('.bi'); if (!item) continue;
      const id = item.dataset.bid;
      if (id && !d.hit.has(id)) { d.hit.add(id); item.classList.add('erasing'); }
      break; // only the top item at each point
    }
  }
}
function bdEraseAlong(d, cx, cy) {
  const dist = Math.hypot(cx - d.lx, cy - d.ly), steps = Math.max(1, Math.ceil(dist / 5));
  for (let i = 1; i <= steps; i++) bdEraseAt(d, d.lx + (cx - d.lx) * i / steps, d.ly + (cy - d.ly) * i / steps);
  d.lx = cx; d.ly = cy;
}
function bdEraseFinish(d) {
  if (!d.hit.size) return;
  bdSnap();
  S.board = S.board.filter(b => !d.hit.has(b.id));
  save(); bdRepaint();
  toast(`Erased ${d.hit.size === 1 ? 'one item' : d.hit.size + ' items'} — Ctrl+Z to bring ${d.hit.size === 1 ? 'it' : 'them'} back.`, '', 2600);
}
/* Touch: two fingers pinch to zoom and drag to pan; a quick double tap opens or edits, like a double-click.
   Returns true when it handled the event, so the one-pointer handlers stay out of it. */
const BD_TOUCH = { pts: new Map(), pinch: null, lastTap: null };
function bdTouch(e, phase) {
  if (e.pointerType !== 'touch') return false;
  const T = BD_TOUCH;
  if (phase === 'down') {
    T.pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (T.pts.size === 2) {
      // the first finger may have started a drag: drop it, a pinch is starting
      const d = BD.drag; BD.drag = null; $('#bd').classList.remove('panning');
      if (d?.id && ['shape', 'line', 'pen'].includes(d.mode)) S.board = S.board.filter(b => b.id !== d.id), bdRepaint();
      const [a, b] = [...T.pts.values()];
      T.pinch = { dist: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mx: (a[0] + b[0]) / 2, my: (a[1] + b[1]) / 2 };
      bdStopFling(); return true;
    }
    return T.pts.size > 2;
  }
  if (phase === 'move') {
    if (!T.pts.has(e.pointerId)) return false;
    T.pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (!T.pinch || T.pts.size < 2) return false;
    const [a, b] = [...T.pts.values()], dist = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const c = bdCam(); c.x += mx - T.pinch.mx; c.y += my - T.pinch.my;
    bdZoomAt(dist / T.pinch.dist, mx, my);
    Object.assign(T.pinch, { dist, mx, my });
    return true;
  }
  const was = T.pinch; T.pts.delete(e.pointerId);
  if (was) { if (T.pts.size < 2) { T.pinch = null; save(); } return true; }
  const d = BD.drag;
  if (phase === 'up' && d && !d.moved && e.type === 'pointerup') {
    const now = Date.now(), L = T.lastTap;
    if (L && now - L.t < 320 && Math.hypot(e.clientX - L.x, e.clientY - L.y) < 24) { T.lastTap = null; bdUp(e); bdDbl(e); return true; }
    T.lastTap = { t: now, x: e.clientX, y: e.clientY };
  }
  return false;
}
function bdWheel(e) {
  bdStopFling();
  if (e.target.closest('.bd-side, .bd-bar') || !$('#bd')) return;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) bdZoomAt(Math.exp(-e.deltaY * (e.deltaMode ? .05 : .0025)), e.clientX, e.clientY);
  else { const c = bdCam(), k = e.deltaMode ? 30 : 1; c.x -= (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k; c.y -= (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k; bdCamChanged(); }
}
function bdDbl(e) {
  if (e.target.closest('.bd-ui')) return;
  const el = e.target.closest('.bi');
  if (el) {
    const it = bdGet(el.dataset.bid);
    if (it.kind === 'note' || it.kind === 'text') bdEdit(it.id);
    else if (it.kind === 'link') window.open(it.url, '_blank', 'noopener,noreferrer');
    else if (it.kind === 'image' || it.kind === 'file') window.open(it.src, '_blank', 'noopener');
    return;
  }
  const [wx, wy] = bdToWorld(e.clientX, e.clientY);
  bdSnap(); const it = bdAdd({ kind: 'note', x: wx - 110, y: wy - 30 }); BD.fresh = it.id;
  bdRepaint(); bdEdit(it.id);
}
function bdDelete() {
  if (!BD.sel.size) return;
  bdSnap(); const n = BD.sel.size;
  S.board = S.board.filter(b => !BD.sel.has(b.id)); BD.sel.clear(); save(); bdRepaint();
  toast(`Deleted ${n === 1 ? 'one item' : n + ' items'} — Ctrl+Z to bring ${n === 1 ? 'it' : 'them'} back.`, '', 3500);
}
function bdDuplicate() {
  const items = bdSelItems(); if (!items.length) return;
  bdSnap(); let z = bdTopZ();
  const copies = items.map(i => ({ ...structuredClone(i), id: uid(), x: i.x + 24, y: i.y + 24, z: ++z, t: Date.now() }));
  S.board.push(...copies); BD.sel = new Set(copies.map(c => c.id)); save(); bdRepaint();
}
function bdKey(e) {
  if (view !== 'board' || !$('#bd')) return;
  const t = e.target, k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (mod && k === 'f' && !document.querySelector('dialog[open]')) { e.preventDefault(); bdOpenSearch(); return; }
  if (t.id === 'bdSearch') return bdSearchKey(e);
  if (t.isContentEditable) { if (k === 'escape' || (k === 'enter' && mod)) { e.preventDefault(); t.blur(); } return; }
  if (/INPUT|TEXTAREA|SELECT/.test(t.tagName) || document.querySelector('dialog[open]')) return;
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? bdRedo() : bdUndo(); return; }
  if (mod && k === 'y') { e.preventDefault(); bdRedo(); return; }
  if (mod && k === 'd') { e.preventDefault(); bdDuplicate(); return; }
  if (mod && k === 'a') { e.preventDefault(); BD.sel = new Set(S.board.filter(bdMatch).map(b => b.id)); bdSyncSel(); return; }
  if (mod || e.altKey) return;
  if (k === ' ') { e.preventDefault(); if (!BD.space) { BD.space = true; $('#bd').classList.add('space'); } return; }
  if (k === 'delete' || k === 'backspace') { e.preventDefault(); bdDelete(); return; }
  if (k === 'escape') { BD.sel.clear(); bdSyncSel(); bdSetTool('select'); return; }
  if (k === 'enter' && BD.sel.size === 1) { const it = bdSelItems()[0]; if (it.kind === 'note' || it.kind === 'text') { e.preventDefault(); bdEdit(it.id); } return; }
  if (k.startsWith('arrow') && BD.sel.size) {
    e.preventDefault(); const s = e.shiftKey ? 10 : 1, [dx, dy] = { arrowleft: [-s, 0], arrowright: [s, 0], arrowup: [0, -s], arrowdown: [0, s] }[k];
    bdSelItems().forEach(i => { i.x += dx; i.y += dy; bdPlace(i); }); bdPlaceBar(); save(); return;
  }
  if (e.shiftKey && e.code === 'Digit1') { e.preventDefault(); bdFit(); return; }
  if (e.shiftKey && e.code === 'Digit0') { e.preventDefault(); BOARD_ACT.bdZoomReset(); return; }
  if (BD_KEYS[k] && !e.shiftKey) { e.preventDefault(); bdSetTool(BD_KEYS[k]); }
}
function bdKeyUp(e) { if (e.key === ' ' && BD.space) { BD.space = false; $('#bd')?.classList.remove('space'); } }
function bdPaste(e) {
  if (view !== 'board') return false;
  const t = e.target; if (t.isContentEditable || /INPUT|TEXTAREA/.test(t.tagName)) return false;
  const at = BD.hover ? [BD.hover[0] - 40, BD.hover[1] - 20] : bdViewCenter();
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); bdAddFiles(files, at); return true; }
  const text = e.clipboardData?.getData('text/plain') || '';
  if (!text.trim()) return false;
  e.preventDefault(); const it = bdAddText(text, at); BD.sel = new Set([it.id]); save(); bdRepaint(); return true;
}
function bdDrop(e) {
  if (view !== 'board') return;
  e.preventDefault(); $('#bd')?.classList.remove('dropping');
  const at = bdToWorld(e.clientX, e.clientY), files = [...(e.dataTransfer?.files || [])];
  if (files.length) return bdAddFiles(files, at);
  const text = e.dataTransfer.getData('text/uri-list').split('\n').find(l => l && !l.startsWith('#')) || e.dataTransfer.getData('text/plain');
  const it = bdAddText(text, at); if (it) { BD.sel = new Set([it.id]); save(); bdRepaint(); }
}
/* Images learn their real shape the first time they load. */
function bdImgLoad(e) {
  const img = e.target; if (img.tagName !== 'IMG') return;
  const el = img.closest('.bi-image'); if (!el) return;
  const it = bdGet(el.dataset.bid); if (!it || it.ar || !img.naturalWidth) return;
  it.ar = img.naturalHeight / img.naturalWidth; it.h = Math.round(it.w * it.ar); bdPlace(it); save();
  if (BD.autoFit && Date.now() - BD.autoFit < 5000) bdFit(S.board);
}
function bdMount() {
  const bd = $('#bd');
  bd.addEventListener('pointerdown', e => bdTouch(e, 'down') || bdDown(e));
  bd.addEventListener('pointermove', e => bdTouch(e, 'move') || bdMove(e));
  bd.addEventListener('pointerup', e => bdTouch(e, 'up') || bdUp(e));
  bd.addEventListener('pointercancel', e => bdTouch(e, 'up') || bdUp(e));
  bd.addEventListener('wheel', bdWheel, { passive: false });
  bd.addEventListener('dblclick', bdDbl);
  bd.addEventListener('focusout', e => { if (e.target.classList?.contains('bi-text') && BD.editing) bdStopEdit(); });
  bd.addEventListener('dragover', e => { e.preventDefault(); bd.classList.add('dropping'); });
  bd.addEventListener('dragleave', e => { if (e.target === bd) bd.classList.remove('dropping'); });
  bd.addEventListener('drop', bdDrop);
  bd.addEventListener('load', bdImgLoad, true);
  $('#bdFile').addEventListener('change', e => { bdAddFiles([...e.target.files]); e.target.value = ''; });
  const first = !S.boardCam;
  bdRepaint(); bdApplyCam();
  BD.autoFit = first && S.board.length ? Date.now() : 0;
  if (BD.autoFit) bdFit(S.board);
  bd.addEventListener('pointerdown', () => BD.autoFit = 0, true);
  bd.addEventListener('wheel', () => BD.autoFit = 0, true);
  S.board.filter(b => b.kind === 'link' && !b.meta && !b.metaTried).forEach(bdPreview);
}

/* ---------------- actions (merged into ACT / FORMS by app.js) ---------------- */
function bdEach(fn) { const items = bdSelItems(); if (!items.length) return; bdSnap(); items.forEach(fn); save(); bdRepaint(); }
const BOARD_ACT = {
  bdTool: el => bdSetTool(el.dataset.tool),
  bdSide: () => { BD.side = !BD.side; $('.bd-side').classList.toggle('shut', !BD.side); const b = $('[data-act="bdSide"]'); b.setAttribute('aria-expanded', BD.side); b.title = (BD.side ? 'Hide' : 'Show') + ' search and tags'; b.querySelector('svg').outerHTML = ic(BD.side ? 'chevL' : 'chevR', 14); },
  bdOpenSearch: () => bdOpenSearch(),
  bdClearSearch: () => { const i = $('#bdSearch'); i.value = ''; bdSearchInput(''); i.focus(); },
  bdGoHit: el => { BD.hit = Number(el.dataset.i); BD.went = true; bdGoTo(bdHits()[BD.hit]); bdSearchPaint(); },
  bdTagFilter: el => { boardFilter.tag = el.dataset.tag || null; bdRepaint(); if (boardFilter.tag) bdFit(S.board.filter(bdMatch)); },
  bdUndo, bdRedo, bdFit: () => bdFit(),
  bdZoom: el => bdZoomAt(Number(el.dataset.f)),
  bdZoomReset: () => { const r = $('#bd').getBoundingClientRect(); bdZoomAt(1 / bdCam().z, r.left + r.width / 2, r.top + r.height / 2); },
  bdColor: el => { BD.color = el.dataset.c; bdEach(i => i.color = el.dataset.c); },
  bdStroke: el => bdEach(i => i.sw = Number(el.dataset.v)),
  bdFill: el => bdEach(i => i.fill = el.dataset.v),
  bdFs: el => bdEach(i => i.fs = Number(el.dataset.v)),
  bdFsStep: el => bdEach(i => {
    if (!BD_FS[i.kind]) return;
    const now = i.fs || BD_FS[i.kind], up = Number(el.dataset.d) > 0;
    const next = up ? BD_FS_STEPS.find(v => v > now + .25) : [...BD_FS_STEPS].reverse().find(v => v < now - .25);
    if (!next) return;
    const k = next / now; i.fs = next;
    if (i.kind === 'note') i.w = Math.round(Math.min(900, Math.max(120, i.w * k))); // a note grows with its words; a text box wraps
  }),
  bdFront: () => { let z = bdTopZ(); bdEach(i => i.z = ++z); },
  bdDup: bdDuplicate, bdDel: bdDelete,
  bdUntag: el => bdEach(i => i.tags = (i.tags || []).filter(t => t !== el.dataset.tag)),
  bdToTask: () => {
    const it = bdSelItems()[0]; if (!it) return;
    const title = (it.text || it.meta?.title || it.url || '').split('\n')[0].replace(/(^|\s)#[\w-]+/g, '').trim().slice(0, 120);
    if (!title) return toast('Write something first.');
    bdSnap(); const q = parseQuick(title), t = addTask({ title: q.title || title, area: q.area, priority: q.priority, due: q.due, notes: it.text || it.url || '' });
    Object.assign(it, { kind: 'task', taskId: t.id, w: 260, h: 60 }); delete it.text;
    toast('Now a task. Tick it here or on Today.'); commit();
  },
  bdAutoTag: async () => {
    const it = bdSelItems()[0]; if (!it) return; toast('Tagging…', '', 1500);
    try {
      const existing = cleanTags(S.board.flatMap(x => x.tags || [])).slice(0, 40).join(', ');
      const out = await ai([{ role: 'system', content: `You tag items on a personal mood board. Reply with 1 to 3 short lowercase tags, comma separated, nothing else. Prefer these existing tags when they fit: ${existing || '(none yet)'}` }, { role: 'user', content: bdText(it).slice(0, 1500) }], { max_tokens: 30, temperature: 0.2 });
      bdSnap(); it.tags = cleanTags([...(it.tags || []), ...out.split(/[,\n]/).map(t => t.replace(/[^a-z0-9 -]/gi, '')).slice(0, 3)]); save(); bdRepaint();
    } catch (e) { toast(e.message); }
  },
};
const BOARD_FORMS = {
  bdTag: f => { const v = cleanTags(f.querySelector('input').value.split(',')); if (!v.length) return; bdEach(i => i.tags = cleanTags([...(i.tags || []), ...v])); bdPaintBar(true); },
};
