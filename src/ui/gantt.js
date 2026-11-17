/** Gantt view: one bar per task, packed into lanes. */
import { buildTimeline, packLanes } from '../core/timeline';
import { renderTaskText } from './shared';
const DAY_WIDTH = 22;
const LANE_HEIGHT = 26;
export function buildGantt(parent, tasks, hidden, ctx, scroll) {
  const layout = packLanes(buildTimeline(tasks), hidden);
  const { days, bars, laneCount, counts } = layout;
  if (days.length === 0) {
    parent.createDiv({ cls: 'ts-empty', text: 'No tasks to display.' });
    return { counts, afterAttach: () => {} };
  }
  const width = days.length * DAY_WIDTH;
  const outer = parent.createDiv({ cls: 'ts-gantt' });
  const ruler = outer.createDiv({ cls: 'ts-ruler' });
  ruler.style.width = width + 'px';
  const body = outer.createDiv({ cls: 'ts-gantt-body' });
  body.style.width = width + 'px';
  body.style.height = laneCount * LANE_HEIGHT + 'px';
  body.style.setProperty('--ts-lane-h', LANE_HEIGHT + 'px');
  days.forEach((day, i) => {
    const [y, m, d] = day.split('-').map(Number);
    if (new Date(y, m - 1, d).getDay() !== 1) return;
    ruler.createDiv({ cls: 'ts-tick', text: `${m}/${d}` }).style.left = i * DAY_WIDTH + 'px';
    body.createDiv({ cls: 'ts-week' }).style.left = i * DAY_WIDTH + 'px';
  });
  for (const { task, start, end, lane } of bars) {
    const bar = body.createDiv({
      cls: ['ts-bar', `ts-state-${task.state}`],
      attr: {
        role: 'img',
        'aria-label': `${task.text || '(untitled)'}, ${task.state}, ${task.due} to ${task.done ?? 'open'}`,
      },
    });
    bar.style.left = start * DAY_WIDTH + 'px';
    bar.style.width = (end - start + 1) * DAY_WIDTH - 2 + 'px';
    bar.style.top = lane * LANE_HEIGHT + 3 + 'px';
    bar.style.height = LANE_HEIGHT - 6 + 'px';
    bar.addEventListener('click', () => ctx.openTask(task));
    ctx.tooltip.register(bar, (tip) => {
      renderTaskText(tip.createDiv({ cls: 'ts-tip-title' }), task.text || '(untitled)');
      const tags = task.tags.length ? ` · #${task.tags.join(' #')}` : '';
      tip.createDiv({ cls: 'ts-tip-meta', text: `${task.due} → ${task.done ?? 'open'} · ${task.state}${tags}` });
      tip.createDiv({ cls: 'ts-tip-hint', text: 'Click to open in note' });
    });
  }
  const rememberScroll = () => {
    const i = Math.min(days.length - 1, Math.floor(outer.scrollLeft / DAY_WIDTH));
    scroll.anchor = { day: days[i], offset: outer.scrollLeft - i * DAY_WIDTH };
  };
  const afterAttach = () => {
    const anchor = scroll.anchor;
    if (anchor) {
      // Redraw: the same date stays at the left edge (the nearest later date if it is gone).
      let i = days.indexOf(anchor.day);
      let offset = anchor.offset;
      if (i === -1) {
        i = days.findIndex((d) => d >= anchor.day);
        offset = 0;
        if (i === -1) i = days.length - 1;
      }
      outer.scrollLeft = i * DAY_WIDTH + offset;
    } else {
      // First draw: jump to the latest dates (retry next frame in case layout isn't ready yet).
      outer.scrollLeft = outer.scrollWidth;
      activeWindow.requestAnimationFrame(() => {
        if (!scroll.anchor || scroll.anchor.day === days[0]) {
          outer.scrollLeft = outer.scrollWidth;
          rememberScroll();
        }
      });
    }
    outer.addEventListener('scroll', rememberScroll);
  };
  return { counts, afterAttach };
}
