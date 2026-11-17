/** Summary view: one row per group of repeating tasks. */
import { summarizeTasks } from '../core/grouping';
import { countStates, TASK_STATES } from '../core/tasks';
import { makeButton, renderTaskText } from './shared';
function renderVariants(tip, variants) {
  tip.createDiv({ cls: 'ts-tip-title', text: 'Variants' });
  for (const v of variants) {
    const row = tip.createDiv({ cls: 'ts-tip-row' });
    row.createSpan({ text: v.name || '(untitled)' });
    row.createSpan({ cls: 'ts-tip-count', text: `×${v.count}` });
  }
}
export function buildSummary(parent, tasks, hidden, ctx) {
  const counts = countStates(tasks); // ignores the state filter
  const rows = summarizeTasks(tasks, hidden);
  if (rows.length === 0) {
    parent.createDiv({ cls: 'ts-empty', text: 'No tasks to display.' });
    return { counts, afterAttach: () => {} };
  }
  const list = parent.createDiv({ cls: 'ts-summary' });
  for (const row of rows) {
    const el = list.createDiv({ cls: 'ts-row' });
    const name = el.createSpan({ cls: 'ts-name', attr: { title: 'Open in note' } });
    renderTaskText(name, row.name || '(untitled)');
    makeButton(name, 'button', () => ctx.openTask(row.target));
    el.createSpan({ cls: 'ts-count', text: `×${row.count}` });
    el.createSpan({ cls: 'ts-dates', text: `🚀 ${row.start ?? '—'}  🏁 ${row.end ?? 'open'}` });
    if (row.variants.length > 1) {
      const variants = el.createSpan({
        cls: 'ts-variants',
        text: `(${row.variants.length} variants)`,
        attr: { 'aria-label': row.variants.map((v) => `${v.name} ×${v.count}`).join(', ') },
      });
      ctx.tooltip.register(variants, (tip) => renderVariants(tip, row.variants));
    }
    const chips = el.createSpan({ cls: 'ts-chips' });
    for (const state of TASK_STATES) {
      const n = row.states[state];
      if (!n) continue;
      const chip = chips.createSpan({ attr: { title: state, 'aria-label': `${n} ${state}` } });
      chip.createEl('i', { cls: ['ts-dot', `ts-state-${state}`] });
      chip.appendText(String(n));
    }
  }
  return { counts, afterAttach: () => {} };
}
