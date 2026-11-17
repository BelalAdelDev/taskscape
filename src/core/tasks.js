/** Task model, parsing, and date/count selection. Pure: no DOM, no Obsidian. */
export const TASK_STATES = ['pending', 'on-time', 'postponed', 'cancelled'];
export const emptyCounts = () => ({ pending: 0, 'on-time': 0, postponed: 0, cancelled: 0 });
export function countStates(tasks) {
  const counts = emptyCounts();
  for (const t of tasks) counts[t.state]++;
  return counts;
}
const TASK_LINE = /^[\s-]\s\[.\]\s*/;
const TAG = /#\w+/g;
const DUE = /📅\s[\w-]+/gu;
const DONE = /[❌✅]\s[\w-]+/gu;
/**
 * Parses lines like `- [ ] text #tag 📅 2026-10-01 ✅ 2026-10-02`.
 * State comes from the markers: ✅ on the due date = on-time, ✅ on another date = postponed,
 * ❌ = cancelled, no marker = pending.
 */
export function parseTasks(markdown) {
  const tasks = [];
  markdown.split('\n').forEach((rawLine, line) => {
    if (!TASK_LINE.test(rawLine)) return;
    const tags = rawLine.match(TAG)?.map((t) => t.slice(1)) ?? [];
    const due = rawLine.match(DUE)?.map((d) => d.replace(/📅\s*/u, '')) ?? [];
    const markers = rawLine.match(DONE) ?? [];
    const done = markers.map((d) => d.replace(/[❌✅]\s*/u, ''));
    let state = 'pending';
    if (markers[0]?.includes('✅')) state = due[0] === done[0] ? 'on-time' : 'postponed';
    else if (markers[0]?.includes('❌')) state = 'cancelled';
    const text = rawLine.replace(TASK_LINE, '').replace(TAG, '').replace(DUE, '').replace(DONE, '').trim();
    tasks.push({ text, raw: rawLine.trim(), line, due: due[0], done: done[0], state, tags });
  });
  return tasks;
}
const startOfDay = (value) => {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
};
/** Either bound may be omitted (= unbounded). Compares the done date, else the due date. */
export function filterDate(tasks, start, end) {
  const lo = start ? startOfDay(start) : null;
  const hi = end ? startOfDay(end) : null;
  return tasks.filter((t) => {
    const when = startOfDay(t.done ?? t.due);
    if (isNaN(when.getTime())) return false;
    return (!lo || lo <= when) && (!hi || when <= hi);
  });
}
/** Date filter first, then the last `count` tasks ordered by done date, else due date. */
export function selectTasks(tasks, { count, start, end } = {}) {
  const list = start || end ? filterDate(tasks, start, end) : [...tasks];
  const time = (t) => {
    const d = new Date(t.done ?? t.due);
    return isNaN(d.getTime()) ? -Infinity : d.getTime();
  };
  list.sort((a, b) => time(a) - time(b)); // stable: file order kept for ties
  return count ? list.slice(-count) : list;
}
