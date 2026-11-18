/* Forge — Notes: a card grid of rich-text notes for lists, brain dumps and everything else.
   A note is { id, title, html, color, pinned, archived, inbox, hideDone, createdAt, updatedAt }, synced one row per note.
   The html is always a small, cleaned subset (see ntClean), so notes written by the coach or an outside AI are safe to show.
   The editor is a contenteditable page: Markdown shortcuts, a / menu, a selection toolbar, checklists that turn into tasks. */

Object.assign(IC_PATHS, {
  pin: '<path d="M12 17v5"/><path d="M9 10.8V5h6v5.8l2.2 2.6a1 1 0 0 1-.8 1.6H7.6a1 1 0 0 1-.8-1.6Z"/><path d="M8 5h8"/>',
  archive: '<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v10.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V8M10 12h4"/>',
  dots: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  drop: '<path d="M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5Z"/>',
  eyeOff: '<path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c5 0 8.5 4.3 9.5 7a12 12 0 0 1-2.6 3.9M6.6 6.6C4.5 8 3.1 10 2.5 12c1 2.7 4.5 7 9.5 7 1.7 0 3.2-.5 4.5-1.2"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  taskGo: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8.5 12 2.5 2.5 5-5"/>',
});

const NT = { open: null, fresh: null, q: '', filter: 'all', dirty: false, saveT: 0, lastHtml: null, slash: null, slashSel: 0, menu: false };
const NT_BLOCKS = [
  ['p', 'Text', 'Plain paragraph', 'Aa'], ['h1', 'Heading 1', 'Big section title', 'H1'], ['h2', 'Heading 2', 'Medium title', 'H2'], ['h3', 'Heading 3', 'Small title', 'H3'],
  ['check', 'Checklist', 'Things to tick off', '☐'], ['ul', 'Bullet list', 'Simple list', '•'], ['ol', 'Numbered list', 'Steps in order', '1.'],
  ['quote', 'Quote', 'Set something apart', '“'], ['pre', 'Code', 'Monospaced block', '{ }'], ['hr', 'Divider', 'A line across', '—'],
];
const noteById = id => S.notes.find(n => n.id === id);
const ntIsEmpty = n => !n.title.trim() && !ntToMd(n.html).trim();

/* ---------------- cleaning: only our small set of tags and attributes survives ---------------- */
const NT_BLOCK = { P: 'p', DIV: 'p', SECTION: 'p', ARTICLE: 'p', H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h3', H5: 'h3', H6: 'h3', BLOCKQUOTE: 'blockquote', PRE: 'pre', UL: 'ul', OL: 'ol', LI: 'li', HR: 'hr', BR: 'br' };
const NT_INLINE = { STRONG: 'strong', B: 'strong', EM: 'em', I: 'em', S: 's', STRIKE: 's', DEL: 's', CODE: 'code', MARK: 'mark', A: 'a' };
const NT_DROP = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'HEAD', 'TITLE', 'META', 'LINK', 'IMG', 'PICTURE', 'VIDEO', 'AUDIO', 'CANVAS', 'INPUT', 'BUTTON', 'SELECT', 'TEXTAREA', 'FORM']);
const NT_TOP = new Set(['P', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'HR']);
function ntClean(html) {
  const t = document.createElement('template'); t.innerHTML = String(html || '');
  const out = document.createElement('div');
  const walk = (src, dst) => {
    for (const n of [...src.childNodes]) {
      if (n.nodeType === 3) { dst.append(n.data.replace(/​/g, '')); continue; }
      if (n.nodeType !== 1 || NT_DROP.has(n.tagName)) continue;
      let tag = NT_BLOCK[n.tagName] || NT_INLINE[n.tagName];
      // bold and italic pasted from Google Docs and friends arrive as styled spans
      if (!tag && n.tagName === 'SPAN') { const st = n.getAttribute('style') || ''; if (/font-weight:\s*(bold|[6-9]00)/i.test(st)) tag = 'strong'; else if (/font-style:\s*italic/i.test(st)) tag = 'em'; }
      // a wrapper (div, section…) around blocks is just a wrapper: keep its blocks, not a paragraph around them
      if (tag === 'p' && n.tagName !== 'P' && n.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, hr, div, section, article, table')) tag = null;
      if (!tag && n.tagName === 'TR') tag = 'p';
      if (!tag) { walk(n, dst); if (/^(TD|TH)$/.test(n.tagName)) dst.append(' '); continue; }
      const el = document.createElement(tag);
      if (tag === 'a') {
        const h = (n.getAttribute('href') || '').trim();
        if (!/^(https?:|mailto:)/i.test(h)) { walk(n, dst); continue; }
        el.setAttribute('href', h); el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer');
      }
      if (tag === 'ul' && n.hasAttribute('data-check')) el.setAttribute('data-check', '');
      if (tag === 'li') {
        if (n.getAttribute('data-done') === '1') el.setAttribute('data-done', '1');
        const tk = n.getAttribute('data-task'); if (tk && /^[\w-]{1,24}$/.test(tk)) el.setAttribute('data-task', tk);
      }
      if (tag !== 'br' && tag !== 'hr') walk(n, el);
      dst.append(el);
    }
  };
  walk(t.content, out);
  // the top level holds blocks only: loose text and inline marks go into a paragraph
  const fin = document.createElement('div'); let p = null;
  for (const n of [...out.childNodes]) {
    if (n.nodeType === 1 && NT_TOP.has(n.tagName)) { p = null; fin.append(n); continue; }
    if (n.nodeType === 1 && n.tagName === 'LI') { const ul = document.createElement('ul'); ul.append(n); fin.append(ul); p = null; continue; }
    if (n.nodeType === 1 && n.tagName === 'BR' && !p) continue;
    if (n.nodeType === 3 && !n.data.trim() && !p) continue;
    if (!p) { p = document.createElement('p'); fin.append(p); }
    p.append(n);
  }
  fin.querySelectorAll('p, h1, h2, h3, li').forEach(e => { if (!e.textContent && !e.querySelector('br, ul, ol')) e.append(document.createElement('br')); });
  return fin.innerHTML || '<p><br></p>';
}

/* ---------------- Markdown in and out (no DOM: the same code runs on the server in cloud/tools.js) ---------------- */
function ntInline(s) {
  const e = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let h = e(s); const codes = [];
  h = h.replace(/`([^`]+)`/g, (m, c) => `\u0000${codes.push(c) - 1}\u0000`);
  h = h.replace(/\[([^\]]+)\]\(((?:https?:|mailto:)[^\s)]+)\)/g, '<a href="$2">$1</a>');
  h = h.replace(/(^|[\s(])(https?:\/\/[^\s<]*[^\s<.,;:!?)])/g, '$1<a href="$2">$2</a>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, '$1<em>$2</em>').replace(/(^|[^_\w])_([^_\s][^_]*?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>').replace(/==([^=]+)==/g, '<mark>$1</mark>');
  return h.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[i]}</code>`);
}
function ntMd(src) {
  const e = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n'), stack = [];
  let out = '', para = [], quote = [];
  const flushPara = () => { if (para.length) { out += `<p>${para.map(ntInline).join('<br>')}</p>`; para = []; } };
  const flushQuote = () => { if (quote.length) { out += `<blockquote><p>${quote.map(ntInline).join('<br>')}</p></blockquote>`; quote = []; } };
  const closeOne = () => { const l = stack.pop(); out += '</li>' + (l.type === 'ol' ? '</ol>' : '</ul>'); };
  const closeLists = () => { while (stack.length) closeOne(); };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\t/g, '  ').replace(/^(\s*(?:[-*+]\s+)?)\[\](?=\s)/, '$1[ ]');
    if (/^\s*```/.test(line)) {
      flushPara(); flushQuote(); closeLists();
      const buf = []; i++; while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
      out += `<pre>${e(buf.join('\n'))}</pre>`; continue;
    }
    const m = /^(\s*)(?:[-*+]\s+\[([ xX])\]\s+|\[([ xX])\]\s+|([-*+])\s+|(\d+)[.)]\s+)(.*)$/.exec(line);
    if (m) {
      flushPara(); flushQuote();
      const indent = m[1].length, mark = m[2] ?? m[3], type = mark != null ? 'check' : m[4] ? 'ul' : 'ol';
      let top = stack[stack.length - 1];
      while (top && top.indent > indent) { closeOne(); top = stack[stack.length - 1]; }
      if (top && top.indent === indent && top.type !== type) { closeOne(); top = stack[stack.length - 1]; }
      if (top && top.indent === indent) out += '</li>';
      else { out += type === 'ol' ? '<ol>' : type === 'check' ? '<ul data-check>' : '<ul>'; stack.push({ type, indent }); }
      out += type === 'check' && /x/i.test(mark) ? '<li data-done="1">' : '<li>';
      out += ntInline(m[6]); continue;
    }
    const t = line.trim();
    if (!t) { flushPara(); flushQuote(); closeLists(); continue; }
    const q = /^>\s?(.*)$/.exec(t);
    if (q) { flushPara(); closeLists(); quote.push(q[1]); continue; }
    flushQuote();
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) { flushPara(); closeLists(); const n = Math.min(3, h[1].length); out += `<h${n}>${ntInline(h[2])}</h${n}>`; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flushPara(); closeLists(); out += '<hr>'; continue; }
    closeLists(); para.push(t);
  }
  flushPara(); flushQuote(); closeLists();
  return out || '<p><br></p>';
}
function ntToMd(html) {
  const dec = s => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  const lines = [], lists = [], hrefs = [];
  let buf = '', inPre = false, inQuote = false;
  const end = () => { if (buf.trim()) lines.push(buf.replace(/\s+$/, '')); buf = ''; };
  const gap = () => { end(); if (!lists.length && lines.length && lines[lines.length - 1] !== '') lines.push(''); };
  for (const tok of String(html || '').match(/<[^>]*>|[^<]+/g) || []) {
    if (tok[0] !== '<') { buf += inPre ? dec(tok) : dec(tok).replace(/\s+/g, ' '); continue; }
    const m = /^<(\/?)([a-z0-9]+)([^>]*)>/i.exec(tok); if (!m) continue;
    const close = !!m[1], tag = m[2].toLowerCase(), attrs = m[3];
    switch (tag) {
      case 'h1': case 'h2': case 'h3': if (close) gap(); else { gap(); buf = '#'.repeat(+tag[1]) + ' '; } break;
      case 'p': if (close) { if (!lists.length) gap(); } else if (!lists.length) { gap(); if (inQuote) buf = '> '; } break;
      case 'blockquote': inQuote = !close; if (close) gap(); break;
      case 'pre': if (close) { lines.push(...buf.split('\n')); buf = ''; lines.push('```'); inPre = false; gap(); } else { gap(); lines.push('```'); inPre = true; } break;
      case 'ul': case 'ol': if (close) { end(); lists.pop(); if (!lists.length) gap(); } else { end(); lists.push({ type: tag === 'ol' ? 'ol' : /data-check/.test(attrs) ? 'check' : 'ul', n: 0 }); } break;
      case 'li': if (close) end(); else { end(); const L = lists[lists.length - 1] || { type: 'ul', n: 0 }; L.n++; buf = '  '.repeat(Math.max(0, lists.length - 1)) + (L.type === 'ol' ? `${L.n}. ` : L.type === 'check' ? (/data-done/.test(attrs) ? '- [x] ' : '- [ ] ') : '- '); } break;
      case 'hr': gap(); lines.push('---', ''); break;
      case 'br': if (inPre) buf += '\n'; else { end(); if (lists.length) buf = '  '.repeat(lists.length); else if (inQuote) buf = '> '; } break;
      case 'strong': case 'b': buf += '**'; break;
      case 'em': case 'i': buf += '*'; break;
      case 's': case 'strike': case 'del': buf += '~~'; break;
      case 'mark': buf += '=='; break;
      case 'code': if (!inPre) buf += '`'; break;
      case 'a': if (close) buf += `](${hrefs.pop() || ''})`; else { hrefs.push(dec((/href="([^"]*)"/.exec(attrs) || [])[1] || '')); buf += '['; } break;
    }
  }
  end();
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
const ntPlain = html => ntToMd(html).replace(/^\s*(#{1,3} |[-*] \[[ x]\] |[-*] |\d+\. |> )/gm, '').replace(/\*\*|~~|==|`/g, '');
// ticked / total checklist lines, for the card footer
const ntChecks = html => { const items = (html.match(/<ul data-check[^>]*>[\s\S]*?<\/ul>/g) || []).join('').match(/<li[^>]*>/g) || []; return { all: items.length, done: items.filter(x => /data-done/.test(x)).length }; };

/* ---------------- notes: create, find, change ---------------- */
function ntNew(fields = {}) {
  const now = Date.now();
  const n = { id: uid(), title: '', html: '<p><br></p>', color: null, pinned: false, archived: false, inbox: false, hideDone: false, createdAt: now, updatedAt: now, ...fields };
  S.notes.push(n); return n;
}
function ntOpenNote(id, fresh = false) {
  if (NT.open) ntFlush();
  NT.open = id; NT.fresh = fresh ? id : null; NT.menu = false;
  if (view !== 'notes') view = 'notes';
  scrollTo({ top: 0, behavior: 'instant' }); render();
}
function ntStart(fields) { const n = ntNew(fields); save(); ntOpenNote(n.id, true); return n; }
function ntFind(arg) {
  const s = String(arg || '').trim().toLowerCase(); if (!s) return null;
  const live = S.notes.filter(n => !n.archived);
  return S.notes.find(n => n.id === arg) || live.find(n => n.title.trim().toLowerCase() === s) || (live.filter(n => n.title.toLowerCase().includes(s)).length === 1 ? live.find(n => n.title.toLowerCase().includes(s)) : null);
}
function ntAppendHtml(n, html) {
  // one list keeps growing when the new lines are list lines of the same kind
  const cur = ntClean(n.html), add = ntClean(html);
  const t = document.createElement('template'); t.innerHTML = ntToMd(cur).trim() ? cur + add : add;
  // merge two neighbouring checklists (or bullet lists) that the append created
  [...t.content.querySelectorAll('ul + ul, ol + ol')].forEach(b => { const a = b.previousElementSibling; if (a.hasAttribute('data-check') === b.hasAttribute('data-check')) { a.append(...b.childNodes); b.remove(); } });
  n.html = t.innerHTML; n.updatedAt = Date.now();
  ntExternal(n.id);
}
// the Inbox: one pinned note that quick capture appends to as checklist lines
function ntInbox(text) {
  let n = S.notes.find(x => x.inbox && !x.archived);
  if (!n) n = ntNew({ title: 'Inbox', pinned: true, inbox: true, html: '' });
  ntAppendHtml(n, `<ul data-check><li>${esc(text)}</li></ul>`);
  return n;
}
// a note changed outside the editor (coach, task ticked elsewhere, sync): show it if that note is open and not being typed in
function ntExternal(id) {
  if (NT.open !== id || view !== 'notes') return;
  const ed = $('#ntEd'), title = $('#ntTitle'), n = noteById(id); if (!ed || !n) return;
  if (document.activeElement === ed && NT.dirty) return;
  ed.innerHTML = ntClean(n.html); if (document.activeElement !== title) title.value = n.title;
  NT.lastHtml = n.html; ntReconcile(); ntPaintMeta();
}
// called from cloud.js when synced rows arrive
function ntIncoming() {
  if (!NT.open) return;
  if (!noteById(NT.open)) { NT.open = null; return; }
  const n = noteById(NT.open); if (n.html !== NT.lastHtml) ntExternal(n.id);
}
// a task linked to a checklist line changed: tick or untick that line
function ntSyncTask(t) {
  const n = noteById(t.noteId); if (!n) return;
  const tpl = document.createElement('template'); tpl.innerHTML = n.html;
  const li = tpl.content.querySelector(`li[data-task="${t.id}"]`); if (!li) return;
  if (!!li.hasAttribute('data-done') === !!t.done) return;
  t.done ? li.setAttribute('data-done', '1') : li.removeAttribute('data-done');
  n.html = tpl.innerHTML;
  const live = NT.open === n.id && $(`#ntEd li[data-task="${t.id}"]`);
  if (live) { t.done ? live.setAttribute('data-done', '1') : live.removeAttribute('data-done'); NT.lastHtml = n.html; ntPaintMeta(); }
}

/* ---------------- the grid ---------------- */
const ntAgo = ms => { const s = (Date.now() - ms) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + 'm ago'; if (s < 86400) return Math.floor(s / 3600) + 'h ago'; if (s < 172800) return 'yesterday'; return shortDate(ms); };
function ntPreview(html) {
  const t = document.createElement('template'); t.innerHTML = ntClean(html);
  [...t.content.children].slice(8).forEach(e => e.remove());
  t.content.querySelectorAll('ul, ol').forEach(l => [...l.children].slice(6).forEach(e => e.remove()));
  return t.innerHTML;
}
function ntMatches(n) {
  const f = NT.filter;
  if (f === 'archived' ? !n.archived : n.archived) return false;
  if (f === 'pinned' && !n.pinned) return false;
  if (f === 'lists' && !/data-check/.test(n.html)) return false;
  const words = NT.q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const txt = (n.title + ' ' + ntPlain(n.html)).toLowerCase();
  return words.every(w => txt.includes(w));
}
function ntCard(n) {
  const c = ntChecks(n.html), body = ntPlain(n.html).trim(), title = n.title.trim() || (body ? '' : 'Untitled');
  // an untitled note is just its text: no made-up title repeating the first line
  return `<article class="nt-card ${n.color ? 'tinted' : ''}" style="--nc:${n.color || 'transparent'}" data-act="ntOpen" data-id="${n.id}" tabindex="0" aria-label="${esc(title || body.slice(0, 60))}">
    ${title || n.pinned ? `<h3>${n.pinned ? `<span class="nt-pin">${ic('pin', 12)}</span>` : ''}${esc(title)}</h3>` : ''}
    <div class="nt-prev">${ntPreview(n.html)}</div>
    <footer><span class="mono">${ntAgo(n.updatedAt)}</span>${c.all ? `<span class="mono nt-count">${c.done}/${c.all}</span>` : ''}
      <span class="nt-acts">
        <button class="icon" data-act="ntPinCard" data-id="${n.id}" title="${n.pinned ? 'Unpin' : 'Pin'}" aria-label="${n.pinned ? 'Unpin' : 'Pin'}">${ic('pin', 13)}</button>
        <button class="icon" data-act="ntColorCard" data-id="${n.id}" title="Colour" aria-label="Colour">${ic('drop', 13)}</button>
        <button class="icon" data-act="ntArchive" data-id="${n.id}" title="${n.archived ? 'Unarchive' : 'Archive'}" aria-label="Archive">${ic('archive', 13)}</button>
        <button class="icon" data-act="ntDelete" data-id="${n.id}" title="Delete" aria-label="Delete">${ic('trash', 13)}</button>
      </span></footer>
  </article>`;
}
function ntGrids() {
  const list = S.notes.filter(ntMatches).sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = NT.filter === 'archived' ? [] : list.filter(n => n.pinned), rest = list.filter(n => !pinned.includes(n));
  const newCard = NT.filter === 'archived' || NT.q ? '' : `<button class="nt-card nt-new" data-act="ntNew">${ic('plus', 18)}<b>New note</b><span class="mono">N</span></button>`;
  if (!list.length && !newCard) return `<div class="empty">${NT.q ? 'No note matches that.' : 'Nothing archived.'}</div>`;
  return `${pinned.length ? `<div class="grp-h">Pinned <span>${pinned.length}</span></div><div class="nt-grid">${pinned.map(ntCard).join('')}</div>` : ''}
    ${pinned.length ? `<div class="grp-h" style="margin-top:28px">Notes <span>${rest.length}</span></div>` : ''}<div class="nt-grid">${newCard}${rest.map(ntCard).join('')}</div>`;
}
const ntPaintGrid = () => { const g = $('#ntGrids'); if (g) g.innerHTML = ntGrids(); };
function notesView() {
  if (NT.open && noteById(NT.open)) return ntEditorView(noteById(NT.open));
  NT.open = null;
  const chips = [['all', 'All'], ['pinned', 'Pinned'], ['lists', 'Lists'], ['archived', 'Archived']];
  return `<div class="view">${pageHead('Lists, brain dumps and everything in between.', 'Get it out of your <span class="accent">head</span>')}${GAP}
    <section class="nt-wrap">
      <div class="nt-top">
        <label class="nt-search">${ic('search', 15)}<input id="ntSearch" type="search" placeholder="Search notes" value="${esc(NT.q)}" autocomplete="off" aria-label="Search notes"></label>
        <div class="tags">${chips.map(([k, l]) => `<button class="tag ${NT.filter === k ? 'on' : ''}" data-act="ntFilter" data-f="${k}">${l}</button>`).join('')}</div>
        <button class="primary" data-act="ntNew">${ic('plus', 14)} New note</button>
      </div>
      <div id="ntGrids">${ntGrids()}</div>
    </section>${GAP}</div>`;
}

/* ---------------- the editor ---------------- */
function ntEditorView(n) {
  return `<div class="view nt-page">
    <div class="nt-bar">
      <button class="ghost nt-back" data-act="ntClose">${ic('chevL', 15)} All notes</button>
      <span class="nt-saved mono" id="ntSaved"></span>
      <div class="nt-bar-r">
        <button class="icon ${n.pinned ? 'lit' : ''}" data-act="ntPin" title="${n.pinned ? 'Unpin' : 'Pin'}" aria-pressed="${n.pinned}">${ic('pin', 15)}</button>
        <button class="icon" data-act="ntColor" title="Colour" style="${n.color ? `color:${n.color}` : ''}">${ic('drop', 15)}</button>
        <button class="icon ${n.hideDone ? 'lit' : ''}" data-act="ntHideDone" title="${n.hideDone ? 'Show' : 'Hide'} ticked items" aria-pressed="${!!n.hideDone}">${ic('eyeOff', 15)}</button>
        <div class="nt-more"><button class="icon" data-act="ntMenu" title="More" aria-haspopup="menu">${ic('dots', 15)}</button>
          <div class="nt-menu" id="ntMenu" role="menu" hidden>
            <button role="menuitem" data-act="ntDup">${ic('copy', 14)} Duplicate</button>
            <button role="menuitem" data-act="ntCopyMd">${ic('front', 14)} Copy as Markdown</button>
            <button role="menuitem" data-act="ntArchive" data-id="${n.id}">${ic('archive', 14)} ${n.archived ? 'Unarchive' : 'Archive'}</button>
            <button role="menuitem" class="danger" data-act="ntDelete" data-id="${n.id}">${ic('trash', 14)} Delete</button>
          </div></div>
      </div>
    </div>
    <article class="nt-doc" style="--nc:${n.color || 'transparent'}">
      <input id="ntTitle" class="nt-title" type="text" placeholder="Untitled" value="${esc(n.title)}" autocomplete="off" aria-label="Title">
      <div class="nt-meta mono" id="ntMeta"></div>
      <div id="ntEd" class="nt-ed ${n.hideDone ? 'hide-done' : ''}" contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true" aria-label="Note" data-ph="Write anything. Type / for blocks, [] for a checklist.">${ntClean(n.html)}</div>
      <div class="nt-foot" id="ntFoot"></div>
    </article>
    <div class="nt-slash" id="ntSlash" role="listbox" hidden></div>
    <div class="nt-tool" id="ntTool" hidden>
      <button data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button><button data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button><button data-cmd="strike" title="Strikethrough (Ctrl+Shift+X)"><s>S</s></button>
      <button data-cmd="code" title="Code (Ctrl+E)" class="mono">&lt;/&gt;</button><button data-cmd="mark" title="Highlight (Ctrl+Shift+H)"><span class="nt-hl">H</span></button><button data-cmd="link" title="Link (Ctrl+K)">${ic('link', 14)}</button>
      <i class="nt-sep"></i><button data-cmd="h1" title="Heading 1">H1</button><button data-cmd="h2" title="Heading 2">H2</button><button data-cmd="check" title="Checklist">${ic('taskGo', 14)}</button>
      <i class="nt-sep"></i><button data-cmd="task" title="Make it a task">→ Task</button>
    </div>
  </div>`;
}
const ntEd = () => $('#ntEd');
function ntMount() {
  const ed = ntEd(), title = $('#ntTitle'), n = noteById(NT.open); if (!ed || !n) return;
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { }
  NT.lastHtml = n.html; NT.dirty = false;
  ed.addEventListener('keydown', ntKey);
  ed.addEventListener('input', ntInput);
  ed.addEventListener('paste', ntPaste);
  ed.addEventListener('mousedown', ntMouse);
  ed.addEventListener('click', e => { const a = e.target.closest('a'); if (a && (e.ctrlKey || e.metaKey)) { e.preventDefault(); open(a.href, '_blank', 'noopener'); } });
  ed.addEventListener('blur', () => setTimeout(() => { if (!$('#ntTool')?.matches(':hover')) ntHideTool(); ntSlashClose(); }, 120));
  title.addEventListener('input', ntDirty);
  title.addEventListener('keydown', e => { if (e.key === 'Enter' || (e.key === 'ArrowDown' && title.selectionStart === title.value.length)) { e.preventDefault(); ed.focus(); ntCaret(ed.firstChild || ed, 0); } });
  $('#ntTool').addEventListener('mousedown', e => { e.preventDefault(); const b = e.target.closest('[data-cmd]'); if (b) ntCmd(b.dataset.cmd); });
  $('#ntSlash').addEventListener('mousedown', e => { e.preventDefault(); const b = e.target.closest('[data-i]'); if (b) ntSlashPick(Number(b.dataset.i)); });
  ntReconcile(); ntPaintMeta();
  if (NT.fresh === n.id && !n.title) title.focus();
}
// linked tasks may have been ticked, unticked or deleted since the note was last open
function ntReconcile() {
  const ed = ntEd(); if (!ed) return;
  ed.querySelectorAll('li[data-task]').forEach(li => {
    const t = taskById(li.dataset.task);
    if (!t) { li.removeAttribute('data-task'); return; }
    t.done ? li.setAttribute('data-done', '1') : li.removeAttribute('data-done');
  });
}
function ntPaintMeta() {
  const ed = ntEd(), n = noteById(NT.open); if (!ed || !n) return;
  const words = (ed.innerText.match(/\S+/g) || []).length;
  $('#ntMeta').textContent = `${words} word${words === 1 ? '' : 's'} · edited ${ntAgo(n.updatedAt)}`;
  const open = ntOpenLines().length;
  $('#ntFoot').innerHTML = open ? `<button class="btn sm" data-act="ntMakeTasks">${ic('taskGo', 13)} Make tasks from ${open} unchecked item${open === 1 ? '' : 's'}</button>` : '';
}
const ntOpenLines = () => [...(ntEd()?.querySelectorAll('ul[data-check] > li:not([data-done]):not([data-task])') || [])].filter(li => ntLiText(li));
const ntLiText = li => [...li.childNodes].filter(c => !(c.nodeType === 1 && /^(UL|OL)$/.test(c.tagName))).map(c => c.textContent).join('').replace(/​/g, '').trim();

function ntDirty() {
  NT.dirty = true; $('#ntSaved').textContent = 'Saving…';
  clearTimeout(NT.saveT); NT.saveT = setTimeout(ntFlush, 400);
}
function ntFlush() {
  clearTimeout(NT.saveT);
  const n = noteById(NT.open), ed = ntEd(), title = $('#ntTitle');
  if (!n || !ed) { NT.dirty = false; return; }
  const html = ntClean(ed.innerHTML), t = title.value.trim().slice(0, 200);
  if (html !== n.html || t !== n.title) { n.html = html; n.title = t; n.updatedAt = Date.now(); NT.lastHtml = html; save(); }
  NT.dirty = false; const s = $('#ntSaved'); if (s) s.textContent = 'Saved';
  ntPaintMeta();
}
function ntClose() {
  ntFlush();
  const n = noteById(NT.open);
  if (n && NT.fresh === n.id && ntIsEmpty(n)) { S.notes = S.notes.filter(x => x !== n); save(); }
  NT.open = null; NT.fresh = null; ntHideTool(); render();
}

/* caret and block helpers */
function ntCaret(node, off) { const r = document.createRange(); r.setStart(node, Math.min(off, node.nodeType === 3 ? node.length : node.childNodes.length)); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
function ntBlock() {
  const ed = ntEd(), s = getSelection(); if (!s.rangeCount) return null;
  let n = s.anchorNode; if (!ed.contains(n)) return null;
  while (n && n !== ed) { if (n.nodeType === 1 && (n.tagName === 'LI' || n.parentNode === ed)) return n; n = n.parentNode; }
  return null;
}
function ntBefore(blk) { const s = getSelection(), r = document.createRange(); r.setStart(blk, 0); r.setEnd(s.anchorNode, s.anchorOffset); return r.toString(); }
function ntAtEnd(blk) { const s = getSelection(), r = document.createRange(); r.setStart(s.anchorNode, s.anchorOffset); r.setEnd(blk, blk.childNodes.length); const sub = r.cloneContents(); return !sub.textContent.replace(/​/g, '') && !sub.querySelector?.('li'); }
function ntDeleteBefore(blk) { const s = getSelection(), r = document.createRange(); r.setStart(blk, 0); r.setEnd(s.anchorNode, s.anchorOffset); s.removeAllRanges(); s.addRange(r); document.execCommand('delete'); }
const ntClosest = (sel) => { const s = getSelection(); if (!s.rangeCount) return null; const n = s.anchorNode; const el = n?.nodeType === 1 ? n : n?.parentElement; const hit = el?.closest(sel); return hit && ntEd()?.contains(hit) ? hit : null; };

function ntApply(type) {
  const ed = ntEd(); ed.focus();
  const inList = ntClosest('ul, ol');
  if (['p', 'h1', 'h2', 'h3', 'quote', 'pre'].includes(type)) {
    if (inList) document.execCommand(inList.tagName === 'OL' ? 'insertOrderedList' : 'insertUnorderedList');
    document.execCommand('formatBlock', false, { quote: 'blockquote' }[type] || type);
  } else if (type === 'ul' || type === 'ol') {
    if (type === 'ul' && inList?.hasAttribute('data-check')) inList.removeAttribute('data-check');
    else document.execCommand(type === 'ol' ? 'insertOrderedList' : 'insertUnorderedList');
  } else if (type === 'check') {
    if (inList?.hasAttribute('data-check')) document.execCommand('insertUnorderedList');
    else if (inList?.tagName === 'UL') inList.setAttribute('data-check', '');
    else { if (ntClosest('h1, h2, h3, blockquote, pre')) document.execCommand('formatBlock', false, 'p'); document.execCommand('insertUnorderedList'); ntClosest('ul')?.setAttribute('data-check', ''); }
  } else if (type === 'hr') {
    const blk = ntBlock() || ed.lastChild, hr = document.createElement('hr');
    if (blk && blk.tagName !== 'LI') { blk.before(hr); if (!blk.textContent) { blk.innerHTML = '<br>'; ntCaret(blk, 0); } }
    else { ed.append(hr); const p = document.createElement('p'); p.innerHTML = '<br>'; ed.append(p); ntCaret(p, 0); }
  }
  ntFixLists(); ntDirty();
}
// Chrome sometimes leaves a new list inside the paragraph it came from (<p><ul>…</ul></p>): lift it out, keep the caret
function ntFixLists() {
  const ed = ntEd(), s = getSelection(), at = s.rangeCount ? [s.anchorNode, s.anchorOffset] : null;
  let moved = false;
  ed.querySelectorAll(':scope > p').forEach(p => { if (p.querySelector(':scope > ul, :scope > ol, :scope > blockquote, :scope > pre, :scope > h1, :scope > h2, :scope > h3')) { p.replaceWith(...p.childNodes); moved = true; } });
  if (moved && at && at[0]?.isConnected) ntCaret(at[0], at[1]);
}
function ntWrap(tag) {
  const s = getSelection(); if (!s.rangeCount || s.isCollapsed) return;
  const inside = ntClosest(tag);
  if (inside) { inside.replaceWith(...inside.childNodes); ntDirty(); return; }
  document.execCommand('insertHTML', false, `<${tag}>${esc(s.toString())}</${tag}>`);
  ntDirty();
}
function ntLink() {
  const s = getSelection(), cur = ntClosest('a');
  if (cur) { const r = document.createRange(); r.selectNodeContents(cur); s.removeAllRanges(); s.addRange(r); }
  const url = prompt('Link to (leave empty to remove)', cur?.getAttribute('href') || 'https://');
  if (url === null) return;
  if (!url.trim() || url.trim() === 'https://') document.execCommand('unlink');
  else if (/^(https?:\/\/|mailto:)\S+$/i.test(url.trim())) { if (s.isCollapsed) document.execCommand('insertHTML', false, `<a href="${esc(url.trim())}">${esc(url.trim())}</a>`); else document.execCommand('createLink', false, url.trim()); }
  else return toast('Links need to start with https:// or mailto:');
  ntDirty();
}
function ntCmd(cmd) {
  const ed = ntEd(); ed.focus();
  if (cmd === 'bold' || cmd === 'italic') document.execCommand(cmd);
  else if (cmd === 'strike') document.execCommand('strikeThrough');
  else if (cmd === 'code') ntWrap('code');
  else if (cmd === 'mark') ntWrap('mark');
  else if (cmd === 'link') return ntLink();
  else if (cmd === 'h1' || cmd === 'h2' || cmd === 'check') ntApply(ntClosest(cmd) ? 'p' : cmd);
  else if (cmd === 'task') return ntTaskFromSelection();
  ntDirty(); ntSelChange();
}

/* ---------------- typing ---------------- */
const NT_PREFIX = { '#': 'h1', '##': 'h2', '###': 'h3', '-': 'ul', '*': 'ul', '+': 'ul', '1.': 'ol', '1)': 'ol', '[]': 'check', '[ ]': 'check', '[x]': 'check', '>': 'quote' };
function ntKey(e) {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  // the / menu takes the arrows, Enter and Escape while it is open
  if (NT.slash && !$('#ntSlash').hidden) {
    const items = ntSlashItems();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); NT.slashSel = (NT.slashSel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length); ntSlashPaint(); return; }
    if (e.key === 'Enter' || e.key === 'Tab') { if (items.length) { e.preventDefault(); ntSlashPick(NT.slashSel); return; } }
    if (e.key === 'Escape') { e.preventDefault(); ntSlashClose(); return; }
  }
  if (e.key === 'Escape') { e.preventDefault(); ntClose(); return; }
  if (mod && !e.shiftKey && k === 'e') { e.preventDefault(); return ntCmd('code'); }
  if (mod && !e.shiftKey && k === 'k') { e.preventDefault(); return ntCmd('link'); }
  if (mod && e.shiftKey && k === 'x') { e.preventDefault(); return ntCmd('strike'); }
  if (mod && e.shiftKey && k === 'h') { e.preventDefault(); return ntCmd('mark'); }
  if (mod && e.shiftKey && ['7', '8', '9', '&', '*', '('].includes(e.key)) { e.preventDefault(); return ntApply({ '7': 'ol', '&': 'ol', '8': 'ul', '*': 'ul', '9': 'check', '(': 'check' }[e.key]); }
  if (mod && e.altKey && ['1', '2', '3', '0'].includes(e.key)) { e.preventDefault(); return ntApply(e.key === '0' ? 'p' : 'h' + e.key); }
  if (mod && e.key === 'Enter') { const li = ntClosest('ul[data-check] > li'); if (li) { e.preventDefault(); ntToggleLi(li); } return; }
  if (e.key === 'Tab') {
    e.preventDefault();
    if (ntClosest('pre')) { document.execCommand('insertText', false, '  '); return; }
    if (ntClosest('li')) { document.execCommand(e.shiftKey ? 'outdent' : 'indent'); ntDirty(); }
    return;
  }
  const blk = ntBlock(), s = getSelection();
  if (!blk || !s.isCollapsed) return;
  // Markdown at the start of a line: "# ", "- ", "1. ", "[] ", "> "
  if (e.key === ' ' && blk.tagName !== 'PRE') {
    const before = ntBefore(blk).replace(/​/g, ''), type = NT_PREFIX[before];
    if (type && (blk.tagName !== 'LI' || type === 'check')) {
      e.preventDefault(); ntDeleteBefore(blk); ntApply(type);
      if (before === '[x]') { const li = ntClosest('li'); li?.setAttribute('data-done', '1'); }
      return;
    }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    const before = ntBefore(blk).trim();
    if (before === '```' && blk.tagName !== 'PRE') { e.preventDefault(); ntDeleteBefore(blk); ntApply('pre'); return; }
    if (/^(-{3,}|\*{3,})$/.test(before) && blk.tagName === 'P') { e.preventDefault(); blk.innerHTML = '<br>'; ntCaret(blk, 0); ntApply('hr'); return; }
    if (blk.tagName === 'PRE') {
      e.preventDefault();
      // a second Enter on an empty last line leaves the code block
      if (ntAtEnd(blk) && /\n$/.test(blk.textContent)) { blk.lastChild.textContent = blk.lastChild.textContent.replace(/\n$/, ''); const p = document.createElement('p'); p.innerHTML = '<br>'; blk.after(p); ntCaret(p, 0); }
      else document.execCommand('insertText', false, '\n');
      ntDirty(); return;
    }
    // Enter on an empty list line: step out one level, or leave the list for a plain paragraph
    if (blk.tagName === 'LI' && !ntLiText(blk) && !blk.querySelector('ul, ol')) {
      e.preventDefault();
      const list = blk.parentElement;
      if (list.parentElement?.tagName === 'LI') { document.execCommand('outdent'); ntFixLists(); ntDirty(); return; }
      const rest = [...list.children].slice([...list.children].indexOf(blk) + 1), p = document.createElement('p');
      p.innerHTML = '<br>'; blk.remove();
      if (rest.length) { const l2 = list.cloneNode(false); l2.append(...rest); list.after(l2); }
      list.after(p); if (!list.children.length) list.remove();
      ntCaret(p, 0); ntDirty(); return;
    }
    const li = blk.tagName === 'LI' && blk.parentElement?.hasAttribute('data-check') ? blk : null;
    if (li && ntLiText(li) && ntAtEnd(li) && !li.querySelector('ul, ol')) {
      e.preventDefault();
      const nl = document.createElement('li'); nl.innerHTML = '<br>'; li.after(nl); ntCaret(nl, 0); ntDirty(); return;
    }
    if (li) requestAnimationFrame(() => { const cur = ntClosest('li'); if (cur && cur !== li) { cur.removeAttribute('data-task'); cur.removeAttribute('data-done'); } });
  }
  if (e.key === 'Backspace' && blk.tagName !== 'LI' && blk.tagName !== 'P' && !ntBefore(blk) && blk.parentNode === ntEd()) {
    // Backspace at the start of a heading, quote or code block turns it back into text
    e.preventDefault(); document.execCommand('formatBlock', false, 'p'); ntDirty(); return;
  }
  if (e.key === '/' && !ntBefore(blk).trim() && blk.tagName !== 'PRE') requestAnimationFrame(() => ntSlashOpen(blk));
}
function ntInput(e) {
  ntDirty();
  if (NT.slash) ntSlashUpdate();
  // closing Markdown marks inline: **bold**, *italic*, `code`, ~~strike~~, ==highlight==
  // (a tick later: the browser ignores an editing command started inside another one)
  if (e.inputType === 'insertText') setTimeout(ntInlineMd);
  ntPaintMetaSoon();
}
function ntInlineMd() {
  const sel = getSelection(), tn = sel.anchorNode;
  if (sel.isCollapsed && tn?.nodeType === 3 && ntEd()?.contains(tn) && /[*`~=_]$/.test(tn.data.slice(0, sel.anchorOffset)) && !ntClosest('pre, code')) {
    const s = sel, node = tn;
    const text = node.data.slice(0, s.anchorOffset);
    const pats = [[/\*\*([^*\s][^*]*?)\*\*$/, 'strong'], [/__([^_\s][^_]*?)__$/, 'strong'], [/(?:^|[^*\w])\*([^*\s][^*]*?)\*$/, 'em'], [/(?:^|[^_\w])_([^_\s][^_]*?)_$/, 'em'],
      [/`([^`]+)`$/, 'code'], [/~~([^~]+)~~$/, 's'], [/==([^=]+)==$/, 'mark']];
    for (const [re, tag] of pats) {
      const m = re.exec(text); if (!m) continue;
      const whole = m[0].replace(/^[^*_`~=]/, ''), start = s.anchorOffset - whole.length;
      const r = document.createRange(); r.setStart(node, start); r.setEnd(node, s.anchorOffset);
      s.removeAllRanges(); s.addRange(r);
      document.execCommand('insertHTML', false, `<${tag}>${esc(m[1])}</${tag}>​`);
      break;
    }
  }
  ntPaintMetaSoon();
}
let ntMetaT = 0; const ntPaintMetaSoon = () => { clearTimeout(ntMetaT); ntMetaT = setTimeout(ntPaintMeta, 600); };
function ntPaste(e) {
  e.preventDefault();
  const cd = e.clipboardData, html = cd.getData('text/html'), text = cd.getData('text/plain');
  const s = getSelection();
  // a link pasted over selected words links them
  if (!s.isCollapsed && /^(https?:\/\/|mailto:)\S+$/i.test(text.trim())) { document.execCommand('createLink', false, text.trim()); ntDirty(); return; }
  if (ntClosest('pre')) { document.execCommand('insertText', false, text); return; }
  if (html) document.execCommand('insertHTML', false, ntClean(html));
  else if (/\n/.test(text) || /^\s*(#{1,3} |[-*+] |\d+[.)] |\[[ x]?\] |> |```)/m.test(text)) document.execCommand('insertHTML', false, ntMd(text));
  else document.execCommand('insertText', false, text);
  ntDirty();
}
// a click in the box to the left of a checklist line ticks it
function ntMouse(e) {
  const li = e.target.closest?.('ul[data-check] > li'); if (!li) return;
  const r = li.getBoundingClientRect();
  if (e.clientX < r.left && e.clientY < r.top + 26) { e.preventDefault(); ntToggleLi(li); }
}
function ntToggleLi(li) {
  const done = !li.hasAttribute('data-done');
  done ? li.setAttribute('data-done', '1') : li.removeAttribute('data-done');
  const t = li.dataset.task && taskById(li.dataset.task);
  if (t) setDone(t, done);
  ntFlush();
}

/* ---------------- the / menu ---------------- */
function ntSlashItems() {
  const blk = NT.slash, q = (blk?.textContent || '').replace(/​/g, '').replace(/^\//, '').trim().toLowerCase();
  return NT_BLOCKS.filter(b => !q || b[1].toLowerCase().includes(q) || b[0].startsWith(q));
}
function ntSlashOpen(blk) {
  if (!blk || !blk.textContent.startsWith('/')) return;
  NT.slash = blk; NT.slashSel = 0; ntSlashPaint();
}
function ntSlashUpdate() {
  const blk = NT.slash;
  if (!blk || !blk.isConnected || !blk.textContent.replace(/​/g, '').startsWith('/') || /\s{2}/.test(blk.textContent)) return ntSlashClose();
  NT.slashSel = 0; ntSlashPaint();
}
function ntSlashPaint() {
  const el = $('#ntSlash'), items = ntSlashItems();
  if (!items.length) { el.hidden = true; return; }
  el.innerHTML = `<div class="nt-slash-h mono">Blocks</div>` + items.map((b, i) => `<button role="option" data-i="${i}" class="${i === NT.slashSel ? 'on' : ''}" aria-selected="${i === NT.slashSel}"><span class="nt-sk">${esc(b[3])}</span><span><b>${b[1]}</b><em>${b[2]}</em></span></button>`).join('');
  const s = getSelection(); let r = s.rangeCount ? s.getRangeAt(0).getBoundingClientRect() : null;
  if (!r || (!r.width && !r.height && !r.top)) r = NT.slash.getBoundingClientRect();
  el.hidden = false;
  const below = r.bottom + 8 + el.offsetHeight < innerHeight;
  el.style.left = Math.min(innerWidth - el.offsetWidth - 12, Math.max(12, r.left)) + 'px';
  el.style.top = (below ? r.bottom + 8 : Math.max(12, r.top - el.offsetHeight - 8)) + 'px';
  el.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}
function ntSlashPick(i) {
  const b = ntSlashItems()[i], blk = NT.slash; ntSlashClose(); if (!b || !blk) return;
  // drop the "/query" text, keep the line
  blk.innerHTML = '<br>'; ntCaret(blk, 0);
  ntApply(b[0]);
}
function ntSlashClose() { NT.slash = null; const el = $('#ntSlash'); if (el) el.hidden = true; }

/* ---------------- the selection toolbar ---------------- */
function ntSelChange() {
  const tool = $('#ntTool'), ed = ntEd(); if (!tool || !ed) return;
  const s = getSelection();
  if (!s.rangeCount || s.isCollapsed || !ed.contains(s.anchorNode) || !ed.contains(s.focusNode)) return ntHideTool();
  const r = s.getRangeAt(0).getBoundingClientRect(); if (!r.width) return ntHideTool();
  tool.hidden = false;
  tool.querySelectorAll('[data-cmd]').forEach(b => {
    const c = b.dataset.cmd, on = c === 'bold' ? document.queryCommandState('bold') : c === 'italic' ? document.queryCommandState('italic') : c === 'strike' ? document.queryCommandState('strikeThrough')
      : c === 'code' ? !!ntClosest('code') : c === 'mark' ? !!ntClosest('mark') : c === 'link' ? !!ntClosest('a') : c === 'h1' || c === 'h2' ? !!ntClosest(c) : c === 'check' ? !!ntClosest('ul[data-check]') : false;
    b.classList.toggle('on', on);
  });
  const top = r.top - tool.offsetHeight - 10;
  tool.style.left = Math.min(innerWidth - tool.offsetWidth - 12, Math.max(12, r.left + r.width / 2 - tool.offsetWidth / 2)) + 'px';
  tool.style.top = (top < 70 ? r.bottom + 10 : top) + 'px';
}
function ntHideTool() { const t = $('#ntTool'); if (t) t.hidden = true; }
document.addEventListener('selectionchange', () => { if (view === 'notes' && NT.open) ntSelChange(); });
addEventListener('scroll', () => { if (view === 'notes' && NT.open) { ntHideTool(); ntSlashClose(); } }, { passive: true });
addEventListener('pagehide', () => { if (NT.open && NT.dirty) ntFlush(); });

/* ---------------- checklist lines become tasks ---------------- */
function ntMakeTask(li, title) {
  const n = noteById(NT.open), text = (title || ntLiText(li)).slice(0, 200); if (!n || !text) return null;
  if (li?.dataset.task && taskById(li.dataset.task)) return null;
  const q = parseQuick(text);
  const t = addTask({ title: q.title || text, area: q.area, priority: q.priority, due: q.due, noteId: n.id });
  if (li) li.setAttribute('data-task', t.id);
  return t;
}
function ntTaskFromSelection() {
  const s = getSelection(), li = ntClosest('ul[data-check] > li');
  const t = li ? ntMakeTask(li) : ntMakeTask(null, s.toString().trim());
  if (!t) return toast(li ? 'That line is already a task.' : 'Select some words first.');
  ntFlush(); toast('Task added: ' + t.title);
}

/* ---------------- quick capture and the palette ---------------- */
function ntPalette(s, lq) {
  const items = [];
  if (s) items.push(
    { g: 'Create', label: `New note “${s}”`, hint: 'note', run: () => ntStart({ title: s }) },
    { g: 'Create', label: `Add “${s}” to Inbox`, hint: 'inbox', run: () => { const n = ntInbox(s); save(); toast('In your Inbox note.'); if (view === 'notes' && !NT.open) render(); return n; } });
  if (lq) S.notes.filter(n => !n.archived && (n.title + ' ' + ntPlain(n.html)).toLowerCase().includes(lq)).slice(0, 5)
    .forEach(n => items.push({ g: 'Notes', label: n.title || ntPlain(n.html).slice(0, 60) || 'Untitled', hint: 'open', run: () => ntOpenNote(n.id) }));
  return items;
}

/* ---------------- actions ---------------- */
function ntUndoToast(text, undo) {
  const el = document.createElement('div');
  el.className = 'toast nt-undo'; el.innerHTML = `<span>${esc(text)}</span><button type="button">Undo</button>`;
  el.querySelector('button').onclick = () => { undo(); el.remove(); };
  $('#toasts').append(el); setTimeout(() => { el.classList.add('leaving'); setTimeout(() => el.remove(), 220); }, 6000);
}
const NT_COLORS = [null, ...PROJ_COLORS];
const ntNextColor = c => NT_COLORS[(NT_COLORS.indexOf(c ?? null) + 1) % NT_COLORS.length];
const NOTE_ACT = {
  ntNew: () => ntStart(),
  ntOpen: el => ntOpenNote(el.dataset.id),
  ntClose: () => ntClose(),
  ntFilter: el => { NT.filter = el.dataset.f; render(); },
  ntPinCard: el => { const n = noteById(el.dataset.id); if (n) { n.pinned = !n.pinned; commit(); } },
  ntColorCard: el => { const n = noteById(el.dataset.id); if (n) { n.color = ntNextColor(n.color); n.updatedAt = Date.now(); commit(); } },
  ntArchive: el => {
    const n = noteById(el.dataset.id); if (!n) return;
    if (NT.open === n.id) ntFlush();
    n.archived = !n.archived; if (n.archived) n.pinned = false;
    if (NT.open === n.id) { NT.open = null; NT.fresh = null; }
    save(); render(); ntUndoToast(n.archived ? 'Note archived.' : 'Note back in your notes.', () => { n.archived = !n.archived; commit(); });
  },
  ntDelete: el => {
    const n = noteById(el.dataset.id); if (!n) return;
    if (!ntIsEmpty(n) && !confirm(`Delete “${n.title || 'this note'}”?`)) return;
    const at = S.notes.indexOf(n);
    S.notes.splice(at, 1);
    S.tasks.forEach(t => { if (t.noteId === n.id) t.noteId = null; });
    if (NT.open === n.id) { NT.open = null; NT.fresh = null; ntHideTool(); }
    commit(); ntUndoToast('Note deleted.', () => { S.notes.splice(at, 0, n); commit(); });
  },
  ntPin: () => { const n = noteById(NT.open); if (!n) return; n.pinned = !n.pinned; save(); const b = $('[data-act="ntPin"]'); b.classList.toggle('lit', n.pinned); b.setAttribute('aria-pressed', n.pinned); b.title = n.pinned ? 'Unpin' : 'Pin'; },
  ntColor: () => { const n = noteById(NT.open); if (!n) return; n.color = ntNextColor(n.color); n.updatedAt = Date.now(); save(); $('.nt-doc').style.setProperty('--nc', n.color || 'transparent'); $('[data-act="ntColor"]').style.color = n.color || ''; },
  ntHideDone: () => { const n = noteById(NT.open); if (!n) return; n.hideDone = !n.hideDone; save(); ntEd().classList.toggle('hide-done', n.hideDone); const b = $('[data-act="ntHideDone"]'); b.classList.toggle('lit', n.hideDone); b.setAttribute('aria-pressed', n.hideDone); },
  ntMenu: (el, e) => { e.stopPropagation(); const m = $('#ntMenu'); m.hidden = !m.hidden; if (!m.hidden) setTimeout(() => document.addEventListener('click', () => { m.hidden = true; }, { once: true })); },
  ntDup: () => { ntFlush(); const n = noteById(NT.open); if (!n) return; const c = ntNew({ title: (n.title || 'Untitled') + ' (copy)', html: n.html.replace(/ data-task="[^"]*"/g, ''), color: n.color }); save(); ntOpenNote(c.id); toast('Duplicated.'); },
  ntCopyMd: async () => { ntFlush(); const n = noteById(NT.open); if (!n) return; try { await navigator.clipboard.writeText((n.title ? '# ' + n.title + '\n\n' : '') + ntToMd(n.html)); toast('Copied as Markdown.'); } catch { toast('The browser blocked the clipboard.'); } },
  ntMakeTasks: () => { const lines = ntOpenLines(); const made = lines.map(li => ntMakeTask(li)).filter(Boolean); ntFlush(); if (made.length) toast(`${made.length} task${made.length === 1 ? '' : 's'} added.`); },
};
