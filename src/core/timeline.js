/** Day-by-day timeline and Gantt lane packing. Pure. */
import { byName, nameKey } from './grouping';
import { emptyCounts } from './tasks';
const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/**
 * One entry per day from the earliest due date to the latest done date (never past `today`).
 * A task is open from its due date to its done date; pending tasks stay open until today.
 */
export function buildTimeline(tasks, today = new Date()) {
  if (tasks.length === 0) return {};
  const now = new Date(today);
  now.setHours(0, 0, 0, 0);
  const dueDates = tasks.map((t) => new Date(t.due)).filter((d) => !isNaN(d.getTime()));
  if (dueDates.length === 0) return {};
  const doneDates = tasks.map((t) => new Date(t.done ?? now)).filter((d) => !isNaN(d.getTime()));
  const first = new Date(Math.min(...dueDates.map((d) => d.getTime())));
  first.setHours(0, 0, 0, 0);
  const latest = doneDates.length ? new Date(Math.max(...doneDates.map((d) => d.getTime()))) : new Date(now);
  latest.setHours(0, 0, 0, 0);
  const last = latest < now ? latest : now; // don't run past today
  const timeline = {};
  const current = new Date(first);
  while (current.getTime() <= last.getTime()) {
    current.setHours(0, 0, 0, 0);
    timeline[dayKey(current)] = tasks
      .filter((t) => {
        const due = new Date(t.due);
        due.setHours(0, 0, 0, 0);
        const done = new Date(t.done ?? now);
        done.setHours(0, 0, 0, 0);
        return due <= current && done >= current;
      })
      .sort(byName);
    current.setDate(current.getDate() + 1);
  }
  return timeline;
}
/**
 * Packs tasks into horizontal lanes. A lane is reused as soon as its previous task has finished,
 * so laneCount equals the maximum number of overlapping tasks. Tasks with the same name (or, once
 * grouped, the same group) prefer the lane their predecessor used.
 */
export function packLanes(timeline, hidden = new Set()) {
  const days = Object.keys(timeline).sort();
  const counts = emptyCounts();
  const spans = new Map();
  days.forEach((day, i) =>
    timeline[day].forEach((task) => {
      const s = spans.get(task);
      if (s) s.end = i;
      else spans.set(task, { task, start: i, end: i });
    }),
  );
  spans.forEach((s) => counts[s.task.state]++);
  const visible = [...spans.values()]
    .filter((s) => !hidden.has(s.task.state))
    .sort((a, b) => a.start - b.start || byName(a.task, b.task) || a.end - b.end);
  const laneEnds = []; // last occupied day index per lane
  const lastLaneByName = new Map();
  const bars = [];
  const isFree = (lane, start) => laneEnds[lane] !== undefined && laneEnds[lane] < start;
  const place = (s, lane) => {
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(s.end);
    } else laneEnds[lane] = s.end;
    lastLaneByName.set(nameKey(s.task), lane);
    bars.push({ ...s, lane });
  };
  for (let i = 0; i < visible.length;) {
    let j = i;
    while (j < visible.length && visible[j].start === visible[i].start) j++;
    const sameDay = visible.slice(i, j);
    const rest = [];
    sameDay.forEach((s) => {
      const preferred = lastLaneByName.get(nameKey(s.task));
      if (preferred !== undefined && isFree(preferred, s.start)) place(s, preferred);
      else rest.push(s);
    });
    rest.forEach((s) =>
      place(
        s,
        laneEnds.findIndex((_, lane) => isFree(lane, s.start)),
      ),
    ); // pass 2: lowest free lane
    i = j;
  }
  return { days, bars, laneCount: laneEnds.length, counts };
}
