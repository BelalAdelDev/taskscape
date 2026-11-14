'use strict';

const { Plugin, MarkdownRenderChild, TFile, normalizePath } = require('obsidian');

/* ------------------------------------------------------------------ */
/* Parsing                                                             */
/* ------------------------------------------------------------------ */

// Parse markdown text into a task list. Understands the emoji task format:
//   - [ ] text #tag 📅 2026-10-01 ✅ 2026-10-02   (❌ date = cancelled)
function parseTasks(data) {
  const tasksRegex = /^[\s-]\s\[.\]\s*/;
  const tasksLines = data.split('\n').filter(line => tasksRegex.test(line));

  const tasksList = [];
  const tagsRegex = /#\w+/g;
  const dueRegex = /📅\s[\w-]+/ug;
  const doneRegex = /[❌✅]\s[\w-]+/ug;
  tasksLines.forEach((line) => {
    const tags = line.match(tagsRegex)?.map(tag => tag.replace('#', '')) || [];
    const due = line.match(dueRegex)?.map(d => d.replace(/📅\s*/, '')) || [];
    const done = line.match(doneRegex)?.map(d => d.replace(/[❌✅]\s*/, '')) || [];
    const marker = line.match(doneRegex)?.[0] || '';
    let state = 'pending';
    if (/✅/u.test(marker)) {
      state = (due[0] === done[0]) ? 'on-time' : 'postponed';
    } else if (/❌/u.test(marker)) {
      state = 'cancelled';
    }
    const task = line.replace(tasksRegex, '').replace(tagsRegex, '').replace(dueRegex, '').replace(doneRegex, '').trim();
    tasksList.push({ task, due: due[0], done: done[0], state, tags });
  });
  return tasksList;
}

/* ------------------------------------------------------------------ */
/* Filtering                                                           */
/* ------------------------------------------------------------------ */

// Either bound may be null/undefined = unbounded. Uses the done date, else the due date.
function filterDate(tasklist, startDate = null, endDate = null) {
  const lo = startDate ? new Date(startDate) : null; if (lo) lo.setHours(0, 0, 0, 0);
  const hi = endDate ? new Date(endDate) : null; if (hi) hi.setHours(0, 0, 0, 0);

  return tasklist.filter(task => {
    const taskDone = new Date(task.done ?? task.due); taskDone.setHours(0, 0, 0, 0);
    if (isNaN(taskDone)) return false;
    return (!lo || lo <= taskDone) && (!hi || taskDone <= hi);
  });
}

// Date filter first, then keep the last `count` tasks (ordered by done date, else due date).
function selectTasks(tasks, { count, start, end } = {}) {
  const list = (start || end) ? filterDate(tasks, start, end) : [...tasks];
  const time = t => { const d = new Date(t.done ?? t.due); return isNaN(d) ? -Infinity : d.getTime(); };
  list.sort((a, b) => time(a) - time(b)); // stable: file order kept for ties
  return count ? list.slice(-count) : list;
}

/* ------------------------------------------------------------------ */
/* Timeline                                                            */
/* ------------------------------------------------------------------ */

const baseKey = t => (t.task || '').trim().toLowerCase().replace(/\s+/g, ' ');
const nameKey = t => t.group ?? baseKey(t); // t.group is set by assignGroups()
const byName = (a, b) => nameKey(a).localeCompare(nameKey(b));

function getMaxOverlapTasks(timeline) {
  let maxLength = -1;
  for (const name in timeline) {
    const currentLength = timeline[name].length;
    if (currentLength > maxLength) maxLength = currentLength;
  }
  return maxLength;
}

function buildTimeline(tasklist) {
  if (tasklist.length === 0) return {};

  const today = new Date(); today.setHours(0, 0, 0, 0);

  // pending tasks have no done date: they stay open from their due date until today
  const dueDates = tasklist.map(t => new Date(t.due)).filter(d => !isNaN(d));
  const doneDates = tasklist.map(t => new Date(t.done ?? today)).filter(d => !isNaN(d));
  if (dueDates.length === 0) return {};

  const start = new Date(Math.min(...dueDates)); start.setHours(0, 0, 0, 0);

  // don't run past today, even if a task's "done" date is in the future
  const latestDone = (doneDates.length) ? new Date(Math.max(...doneDates)) : today; latestDone.setHours(0, 0, 0, 0);
  const end = (latestDone < today) ? latestDone : today;

  const dates = {};
  const current = new Date(start);

  while (current.getTime() <= end.getTime()) {
    current.setHours(0, 0, 0, 0);

    const year = current.getFullYear();
    const month = String(current.getMonth() + 1).padStart(2, '0');
    const day = String(current.getDate()).padStart(2, '0');
    const key = `${year}-${month}-${day}`;

    dates[key] = tasklist.filter(task => {
      const taskDue = new Date(task.due); taskDue.setHours(0, 0, 0, 0);
      const taskDone = new Date(task.done ?? today); taskDone.setHours(0, 0, 0, 0);
      return taskDue <= current && taskDone >= current;
    }).sort(byName); // same-day tasks ordered by name

    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/* ------------------------------------------------------------------ */
/* Grouping similar tasks (beta)                                       */
/* ------------------------------------------------------------------ */

const FUZZY_THRESHOLD = 0.8; // 0..1, higher = stricter
const FUZZY_MIN_LEN = 6;     // names shorter than this must match exactly

// lowercase, drop link urls, latex, punctuation/emoji, extra spaces
function normalizeName(s) {
  const n = (s || '').toLowerCase()
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  return n || (s || '').toLowerCase().trim();
}

function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// 0..1. Levenshtein similarity, also tried with the words sorted (word order doesn't matter).
function nameSimilarity(a, b) {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (max < FUZZY_MIN_LEN) return 0;
  const sortWords = s => s.split(' ').sort().join(' ');
  const ratio = (x, y) => {
    const m = Math.max(x.length, y.length);
    if (Math.abs(x.length - y.length) / m > 1 - FUZZY_THRESHOLD) return 0; // quick reject
    return 1 - editDistance(x, y) / m;
  };
  return Math.max(ratio(a, b), ratio(sortWords(a), sortWords(b)));
}

// Sets task.group (key) and task.groupName (display name) on every task.
// fuzzy=false: identical names (case/space-insensitive) share a group.
// fuzzy=true : similar names are merged. Most frequent names become group
//              representatives; each other name joins the most similar one (no chaining).
function assignGroups(tasks, fuzzy = false) {
  const stats = new Map(); // exact key -> { key, count, raws }
  tasks.forEach(t => {
    const key = baseKey(t);
    let s = stats.get(key);
    if (!s) stats.set(key, s = { key, count: 0, raws: new Map() });
    s.count++;
    const raw = (t.task || '').trim();
    s.raws.set(raw, (s.raws.get(raw) || 0) + 1);
  });
  const topRaw = s => [...s.raws.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];

  const groupOf = new Map(); // exact key -> { key, name }
  if (!fuzzy) {
    stats.forEach(s => groupOf.set(s.key, { key: s.key, name: topRaw(s) }));
  } else {
    const reps = [];
    [...stats.values()].sort((x, y) => y.count - x.count || x.key.localeCompare(y.key)).forEach(s => {
      const norm = normalizeName(s.key);
      let best = null, bestSim = 0;
      for (const r of reps) {
        const sim = nameSimilarity(norm, r.norm);
        if (sim >= FUZZY_THRESHOLD && sim > bestSim) { best = r; bestSim = sim; }
      }
      if (!best) { best = { norm, key: s.key, name: topRaw(s) }; reps.push(best); }
      groupOf.set(s.key, best);
    });
  }
  tasks.forEach(t => { const g = groupOf.get(baseKey(t)); t.group = g.key; t.groupName = g.name; });
}

/* ------------------------------------------------------------------ */
/* Summary data (pure)                                                 */
/* ------------------------------------------------------------------ */

// One row per group: count, first done (earliest done), last end (latest done), state counts.
// Hidden states are left out. Sorted by name (case-insensitive, numbers in natural order).
function summarizeTasks(tasks, hidden = new Set()) {
  const groups = new Map();
  tasks.forEach(t => {
    if (hidden.has(t.state)) return;
    const key = nameKey(t);
    let g = groups.get(key);
    if (!g) groups.set(key, g = { name: t.groupName ?? (t.task || '').trim(), count: 0, start: null, end: null, states: {}, variants: new Set() });
    g.count++;
    g.states[t.state] = (g.states[t.state] || 0) + 1;
    g.variants.add((t.task || '').trim());
    if (t.done && (!g.start || t.done < g.start)) g.start = t.done;
    if (t.done && (!g.end || t.done > g.end)) g.end = t.done;
  });
  return [...groups.values()]
    .map(g => ({ ...g, variants: [...g.variants] }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || b.count - a.count);
}

/* ------------------------------------------------------------------ */
/* Drawing (all styling lives in styles.css)                           */
/* ------------------------------------------------------------------ */

const STATES = ['pending', 'on-time', 'postponed', 'cancelled'];
const ROOT_CLASS = 'taskscape-root';

const emptyCounts = () => Object.fromEntries(STATES.map(s => [s, 0]));
const countStates = list => {
  const counts = emptyCounts();
  list.forEach(t => { if (t.state in counts) counts[t.state]++; });
  return counts;
};

// Renders task text into `el`: `$\to$` -> →, `[text](url)` -> underlined text (url dropped).
function renderTaskText(el, text) {
  text = text.replace(/\$\s*\\(?:to|rightarrow)\s*\$/g, '→');
  const linkRe = /\[([^\]]+)\]\([^)]*\)/g;
  let last = 0, m;
  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > last) el.appendText(text.slice(last, m.index));
    el.createEl('u', { text: m[1] });
    last = linkRe.lastIndex;
  }
  if (last < text.length) el.appendText(text.slice(last));
}

// Makes a span behave like a keyboard-accessible button / switch.
function makeButton(el, role, onActivate) {
  el.setAttribute('role', role);
  el.tabIndex = 0;
  el.addEventListener('click', onActivate);
  el.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onActivate(); }
  });
}

// ---- Summary view ----
function buildSummary(parent, tasks, hidden) {
  const counts = countStates(tasks); // ignores the state filter
  const rows = summarizeTasks(tasks, hidden);
  if (rows.length === 0) {
    parent.createDiv({ cls: 'ts-empty', text: 'No tasks to display.' });
    return { counts, tasks: 0, groups: 0, post() {} };
  }

  const list = parent.createDiv({ cls: 'ts-summary' });
  rows.forEach(g => {
    const row = list.createDiv({ cls: 'ts-row' });
    renderTaskText(row.createSpan({ cls: 'ts-name' }), g.name || '(untitled)');
    row.createSpan({ cls: 'ts-count', text: `×${g.count}` });
    row.createSpan({ cls: 'ts-dates', text: `🚀 ${g.start ?? '—'}  🏁 ${g.end ?? 'open'}` });

    if (g.variants.length > 1) {
      row.createSpan({
        cls: 'ts-variants',
        text: `(${g.variants.length} variants)`,
        attr: { title: g.variants.map(x => '• ' + (x || '(untitled)')).join('\n') },
      });
    }

    const chips = row.createSpan({ cls: 'ts-chips' });
    STATES.forEach(state => {
      if (!g.states[state]) return;
      const chip = chips.createSpan({ attr: { title: state, 'aria-label': `${g.states[state]} ${state}` } });
      chip.createEl('i', { cls: ['ts-dot', `ts-state-${state}`] });
      chip.appendText(String(g.states[state]));
    });
  });
  return { counts, tasks: rows.reduce((n, g) => n + g.count, 0), groups: rows.length, post() {} };
}

// ---- Gantt view ----
// Bars are packed greedily: a lane is reused as soon as its previous task has finished,
// so the number of lanes equals the max overlap. Same-named (or, with grouping, similar)
// tasks prefer the same lane. `post()` must be called once the chart is in the DOM.
function buildGantt(parent, timeline, hidden, root, { dayWidth = 22, laneHeight = 26 } = {}) {
  const keys = Object.keys(timeline).sort();
  const maxOverlap = getMaxOverlapTasks(timeline);
  const counts = emptyCounts();
  if (keys.length === 0) {
    parent.createDiv({ cls: 'ts-empty', text: 'No tasks to display.' });
    return { counts, lanes: 0, maxOverlap: 0, tasks: 0, post() {} };
  }

  // Each task's visible span, as day indexes into the timeline.
  const spans = new Map();
  keys.forEach((key, i) => timeline[key].forEach(task => {
    const s = spans.get(task);
    if (s) s.end = i; else spans.set(task, { task, start: i, end: i });
  }));
  spans.forEach(s => { if (s.task.state in counts) counts[s.task.state]++; }); // counts ignore the filter

  // Interval packing over the visible (non-filtered) tasks only.
  const visible = [...spans.values()]
    .filter(s => !hidden.has(s.task.state))
    .sort((a, b) => a.start - b.start || byName(a.task, b.task) || a.end - b.end);

  const laneEnds = [];       // last occupied day index per lane
  const lastLaneByName = new Map();
  const items = [];
  for (let i = 0; i < visible.length;) {
    let j = i;
    while (j < visible.length && visible[j].start === visible[i].start) j++;
    const group = visible.slice(i, j);
    const isFree = (lane, s) => laneEnds[lane] !== undefined && laneEnds[lane] < s.start;
    const place = (s, lane) => {
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(s.end); } else laneEnds[lane] = s.end;
      s.lane = lane; lastLaneByName.set(nameKey(s.task), lane); items.push(s);
    };
    const rest = [];
    group.forEach(s => { // pass 1: reuse the lane of the same-named task
      const pref = lastLaneByName.get(nameKey(s.task));
      if (pref !== undefined && isFree(pref, s)) place(s, pref); else rest.push(s);
    });
    rest.forEach(s => place(s, laneEnds.findIndex((_, lane) => isFree(lane, s)))); // pass 2
    i = j;
  }

  const doc = activeDocument, win = activeWindow;
  const widthPx = keys.length * dayWidth;
  const outer = parent.createDiv({ cls: 'ts-gantt' });
  const ruler = outer.createDiv({ cls: 'ts-ruler' });
  ruler.style.width = widthPx + 'px';
  const body = outer.createDiv({ cls: 'ts-gantt-body' });
  body.style.width = widthPx + 'px';
  body.style.height = laneEnds.length * laneHeight + 'px';
  body.style.setProperty('--ts-lane-h', laneHeight + 'px');

  keys.forEach((key, i) => {
    const [y, m, d] = key.split('-').map(Number);
    if (new Date(y, m - 1, d).getDay() !== 1) return; // Mondays
    ruler.createDiv({ cls: 'ts-tick', text: `${m}/${d}` }).style.left = i * dayWidth + 'px';
    body.createDiv({ cls: 'ts-week' }).style.left = i * dayWidth + 'px';
  });

  items.forEach((s, idx) => {
    const t = s.task;
    const bar = body.createDiv({
      cls: ['ts-bar', `ts-state-${t.state}`],
      attr: { 'data-idx': String(idx), role: 'img', 'aria-label': `${t.task || '(untitled)'}, ${t.state}, ${t.due} to ${t.done ?? 'open'}` },
    });
    bar.style.left = s.start * dayWidth + 'px';
    bar.style.width = (s.end - s.start + 1) * dayWidth - 2 + 'px';
    bar.style.top = s.lane * laneHeight + 3 + 'px';
    bar.style.height = laneHeight - 6 + 'px';
  });

  // ---- Tooltip (task names on hover) ----
  const tip = doc.body.createDiv({ cls: ['taskscape-tip', 'is-hidden'] });
  const hideTip = () => tip.classList.add('is-hidden');

  const onMove = e => {
    if (!body.isConnected) { cleanup(); return; }          // note changed under the cursor
    const bar = e.target instanceof Element ? e.target.closest('.ts-bar') : null;
    if (!bar || !body.contains(bar)) { hideTip(); return; }
    const t = items[bar.dataset.idx].task;
    tip.empty();
    renderTaskText(tip.createEl('b'), t.task || '(untitled)');
    tip.createSpan({ text: `${t.due} → ${t.done ?? 'open'} · ${t.state}` + (t.tags.length ? ` · #${t.tags.join(' #')}` : '') });
    tip.classList.remove('is-hidden');
    const x = Math.min(e.clientX + 14, win.innerWidth - tip.offsetWidth - 8);
    const y = e.clientY + 18 + tip.offsetHeight > win.innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 18;
    tip.style.left = Math.max(4, x) + 'px'; tip.style.top = y + 'px';
  };
  const onOut = e => { if (!e.relatedTarget) hideTip(); }; // cursor left the window
  const onVisibility = () => { if (doc.hidden) hideTip(); };
  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(() => { if (!body.isConnected) cleanup(); else hideTip(); }) : null;

  function cleanup() {
    doc.removeEventListener('mousemove', onMove);
    doc.removeEventListener('mouseout', onOut);
    doc.removeEventListener('scroll', hideTip, true);
    doc.removeEventListener('wheel', hideTip, true);
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('blur', hideTip);
    io?.disconnect();
    tip.remove();
    if (root._tsCleanup === cleanup) root._tsCleanup = null;
  }
  root._tsCleanup = cleanup;

  const saveAnchor = () => {
    const i = Math.min(keys.length - 1, Math.floor(outer.scrollLeft / dayWidth));
    root._tsAnchor = { key: keys[i], offset: outer.scrollLeft - i * dayWidth };
  };

  const post = () => {
    doc.addEventListener('mousemove', onMove, { passive: true });
    doc.addEventListener('mouseout', onOut);
    doc.addEventListener('scroll', hideTip, true);
    doc.addEventListener('wheel', hideTip, { capture: true, passive: true });
    doc.addEventListener('visibilitychange', onVisibility);
    win.addEventListener('blur', hideTip);
    io?.observe(body);

    const anchor = root._tsAnchor; // { key, offset } from the previous draw
    if (anchor) {
      // Redraw: same date stays at the left edge (nearest later date if it's gone).
      let i = keys.indexOf(anchor.key), offset = anchor.offset;
      if (i === -1) { i = keys.findIndex(k => k >= anchor.key); offset = 0; if (i === -1) i = keys.length - 1; }
      outer.scrollLeft = i * dayWidth + offset;
    } else {
      // First draw: jump to the latest dates (retry next frame in case layout isn't ready yet).
      outer.scrollLeft = outer.scrollWidth;
      win.requestAnimationFrame(() => {
        if (!root._tsAnchor || root._tsAnchor.key === keys[0]) { outer.scrollLeft = outer.scrollWidth; saveAnchor(); }
      });
    }
    outer.addEventListener('scroll', saveAnchor);
  };

  return { counts, lanes: laneEnds.length, maxOverlap, tasks: items.length, post };
}

// ---- Toolbar: view switch, group toggle (beta, Summary only), state legend / filters ----
function buildToolbar(parent, st, counts, redraw) {
  const bar = parent.createDiv({ cls: 'ts-toolbar' });

  const seg = bar.createDiv({ cls: 'ts-seg' });
  [['gantt', 'Gantt'], ['summary', 'Summary']].forEach(([view, label]) => {
    const b = seg.createSpan({ text: label, attr: { 'data-ts': `view-${view}`, 'aria-pressed': String(st.view === view) } });
    if (st.view === view) b.classList.add('is-active');
    makeButton(b, 'button', () => { if (st.view !== view) { st.view = view; redraw(); } });
  });

  if (st.view === 'summary') {
    const toggle = bar.createSpan({
      cls: 'ts-toggle',
      attr: {
        'data-ts': 'group',
        'aria-checked': String(st.group),
        title: 'Beta: treat tasks whose names differ only slightly as the same task',
      },
    });
    if (st.group) toggle.classList.add('is-on');
    toggle.createSpan({ cls: 'ts-switch' });
    toggle.appendText('Group similar');
    toggle.createSpan({ cls: 'ts-beta', text: 'beta' });
    makeButton(toggle, 'switch', () => { st.group = !st.group; redraw(); });
  }

  const legend = bar.createDiv({ cls: 'ts-legend' });
  STATES.forEach(state => {
    const off = st.hidden.has(state);
    const item = legend.createSpan({
      attr: { 'data-ts': `state-${state}`, 'aria-pressed': String(!off), title: off ? `Show ${state}` : `Hide ${state}` },
    });
    item.createEl('i', { cls: ['ts-dot', `ts-state-${state}`] });
    item.appendText(state);
    item.createEl('b', { text: String(counts[state]) });
    if (!counts[state]) item.classList.add('is-empty');
    if (off) item.classList.add('is-off');
    makeButton(item, 'button', () => {
      if (st.hidden.has(state)) st.hidden.delete(state); else st.hidden.add(state);
      redraw();
    });
  });
}

// Main entry: draws the toolbar + the selected view into `root` (an element).
//   tasks  : output of parseTasks (all tasks)
//   params : { view: 'gantt'|'summary', count, start, end }   (count is ignored by the summary view)
//   opts   : { dayWidth, laneHeight, hidden }
// View / grouping / state filters live on the element, so they survive re-renders.
function renderTaskView(tasks, root, params = {}, opts = {}) {
  root.classList.add(ROOT_CLASS);
  const st = root._ts || (root._ts = {
    view: params.view === 'summary' ? 'summary' : 'gantt',
    group: false,
    hidden: new Set(opts.hidden || []),
  });

  // keep keyboard focus on the same control across redraws
  const active = activeDocument.activeElement;
  const focusKey = active && root.contains(active) ? active.getAttribute('data-ts') : null;

  root._tsCleanup?.(); // removes old tooltip + global listeners
  root._tsCleanup = null;
  root.empty();

  assignGroups(tasks, st.view === 'summary' && st.group); // similar-grouping is Summary-only
  const redraw = () => renderTaskView(tasks, root, params, opts);

  const toolbarHost = root.createDiv();
  const bodyHost = root.createDiv();
  const built = st.view === 'summary'
    ? buildSummary(bodyHost, selectTasks(tasks, { start: params.start, end: params.end }), st.hidden)
    : buildGantt(bodyHost, buildTimeline(selectTasks(tasks, params)), st.hidden, root, opts);

  buildToolbar(toolbarHost, st, built.counts, redraw);
  built.post();
  if (focusKey) root.querySelector(`[data-ts="${focusKey}"]`)?.focus();

  const { post, ...info } = built;
  return { view: st.view, group: st.group, hidden: [...st.hidden], ...info };
}

/* ------------------------------------------------------------------ */
/* Code block parameters                                               */
/* ------------------------------------------------------------------ */

const PARAM_ALIASES = {
  source: 'source', sourcefile: 'source', file: 'source', path: 'source',
  count: 'count', numberoftasks: 'count', tasks: 'count', limit: 'count',
  start: 'start', startdate: 'start', from: 'start',
  end: 'end', enddate: 'end', to: 'end',
  view: 'view', mode: 'view',
};

function isValidDay(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}

// "key: value" lines -> { source, view?, count?, start?, end? }. Throws Error with a readable message.
function parseBlockParams(text) {
  const params = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) throw new Error(`Can't read line "${line}" (expected "key: value")`);
    const rawKey = line.slice(0, idx).toLowerCase().replace(/[^a-z]/g, '');
    const value = line.slice(idx + 1).trim()
      .replace(/^(["'`])(.*)\1$/, '$2')            // "quoted"
      .replace(/^\[\[(.*?)(\|.*)?\]\]$/, '$1')       // [[wikilink]] / [[link|alias]]
      .trim();
    const key = PARAM_ALIASES[rawKey];
    if (!key) throw new Error(`Unknown parameter "${line.slice(0, idx).trim()}". Use: source, view, count, start, end`);
    params[key] = value;
  }
  if (!params.source) throw new Error('Missing "source:" (the task file to read)');

  const out = { source: params.source };
  if (params.view) {
    const v = params.view.toLowerCase();
    if (v !== 'gantt' && v !== 'summary') throw new Error(`"view" must be gantt or summary (got "${params.view}")`);
    out.view = v;
  }
  if (params.count) {
    const n = Number(params.count);
    if (!Number.isInteger(n) || n < 1) throw new Error(`"count" must be a positive whole number (got "${params.count}")`);
    out.count = n;
  }
  for (const k of ['start', 'end']) {
    if (!params[k]) continue;
    if (!isValidDay(params[k])) throw new Error(`"${k}" must be a date like 2026-09-22 (got "${params[k]}")`);
    out[k] = params[k];
  }
  if (out.start && out.end && out.start > out.end) throw new Error('"start" is after "end"');
  return out;
}

/* ------------------------------------------------------------------ */
/* Plugin                                                              */
/* ------------------------------------------------------------------ */

class TaskscapeBlock extends MarkdownRenderChild {
  constructor(plugin, source, el, ctx) {
    super(el);
    this.plugin = plugin; this.source = source; this.ctx = ctx;
    this.token = 0; this.file = null; this.timer = null;
    this.box = el.createDiv({ cls: ROOT_CLASS });
  }

  async onload() {
    // live update when the task file changes
    this.registerEvent(this.plugin.app.vault.on('modify', f => {
      if (!this.file || f.path !== this.file.path) return;
      activeWindow.clearTimeout(this.timer);
      this.timer = activeWindow.setTimeout(() => this.render(), 400);
    }));
    await this.render();
  }

  onunload() {
    activeWindow.clearTimeout(this.timer);
    this.token++;
    this.box._tsCleanup?.(); // removes tooltip + global listeners
  }

  showMessage(text, isError) {
    this.box._tsCleanup?.();
    this.box._tsCleanup = null;
    this.box.empty();
    this.box.createDiv({
      cls: isError ? ['ts-message', 'ts-error'] : 'ts-message',
      text: (isError ? 'Taskscape: ' : '') + text,
    });
  }

  resolveFile(path) {
    const { vault, metadataCache } = this.plugin.app;
    let f = vault.getAbstractFileByPath(normalizePath(path));
    if (!f && !/\.md$/i.test(path)) f = vault.getAbstractFileByPath(normalizePath(path + '.md'));
    if (!f) f = metadataCache.getFirstLinkpathDest(path.replace(/\.md$/i, ''), this.ctx.sourcePath);
    return f instanceof TFile ? f : null;
  }

  async render() {
    const token = ++this.token;
    try {
      const params = parseBlockParams(this.source);
      const file = this.resolveFile(params.source);
      if (!file) return this.showMessage(`source file not found: ${params.source}`, true);
      this.file = file;

      const text = await this.plugin.app.vault.read(file);
      if (token !== this.token) return; // a newer render started

      renderTaskView(parseTasks(text), this.box, params);
    } catch (err) {
      this.showMessage(err.message || String(err), true);
    }
  }
}

class TaskscapePlugin extends Plugin {
  onload() {
    this.registerMarkdownCodeBlockProcessor('taskscape', (source, el, ctx) => {
      ctx.addChild(new TaskscapeBlock(this, source, el, ctx));
    });
  }
}

module.exports = TaskscapePlugin;
module.exports.api = {
  parseTasks, filterDate, selectTasks, buildTimeline, getMaxOverlapTasks,
  assignGroups, nameSimilarity, summarizeTasks, parseBlockParams, renderTaskView,
};
