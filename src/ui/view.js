/** The chart container: toolbar (view switch, similar-task grouping, state filters) plus the active view. */
import { assignGroups } from '../core/grouping';
import { selectTasks, TASK_STATES } from '../core/tasks';
import { buildGantt } from './gantt';
import { makeButton } from './shared';
import { buildSummary } from './summary';
/**
 * Owns what should survive a re-render (the file changed, a filter was clicked):
 * the active view, the grouping switch, the hidden states and the scroll position.
 */
export class TaskView {
  group = false;
  hidden = new Set();
  scroll = {};
  tasks = [];
  constructor(root, ctx, params) {
    this.root = root;
    this.ctx = ctx;
    this.params = params;
    this.view = params.view ?? 'gantt';
    root.classList.add('taskscape-root');
  }
  update(tasks) {
    this.tasks = tasks;
    this.render();
  }
  render() {
    const { root, params } = this;
    // keep keyboard focus on the same control across redraws
    const active = activeDocument.activeElement;
    const focusKey = active && root.contains(active) ? active.getAttribute('data-ts') : null;
    root.empty();
    assignGroups(this.tasks, this.view === 'summary' && this.group); // similar-grouping is Summary-only
    const toolbarHost = root.createDiv();
    const bodyHost = root.createDiv();
    const body =
      this.view === 'summary'
        ? buildSummary(
            bodyHost,
            selectTasks(this.tasks, { start: params.start, end: params.end }),
            this.hidden,
            this.ctx,
          )
        : buildGantt(bodyHost, selectTasks(this.tasks, params), this.hidden, this.ctx, this.scroll);
    this.buildToolbar(toolbarHost, body.counts);
    body.afterAttach();
    if (focusKey) root.querySelector(`[data-ts="${focusKey}"]`)?.focus();
  }
  buildToolbar(parent, counts) {
    const bar = parent.createDiv({ cls: 'ts-toolbar' });
    const seg = bar.createDiv({ cls: 'ts-seg' });
    const views = [
      ['gantt', 'Gantt'],
      ['summary', 'Summary'],
    ];
    for (const [view, label] of views) {
      const button = seg.createSpan({
        text: label,
        attr: { 'data-ts': `view-${view}`, 'aria-pressed': String(this.view === view) },
      });
      if (this.view === view) button.classList.add('is-active');
      makeButton(button, 'button', () => {
        if (this.view === view) return;
        this.view = view;
        this.render();
      });
    }
    if (this.view === 'summary') {
      const toggle = bar.createSpan({
        cls: 'ts-toggle',
        attr: {
          'data-ts': 'group',
          'aria-checked': String(this.group),
          title: 'Beta: treat tasks whose names differ only slightly as the same task',
        },
      });
      if (this.group) toggle.classList.add('is-on');
      toggle.createSpan({ cls: 'ts-switch' });
      toggle.appendText('Group similar');
      toggle.createSpan({ cls: 'ts-beta', text: 'beta' });
      makeButton(toggle, 'switch', () => {
        this.group = !this.group;
        this.render();
      });
    }
    const legend = bar.createDiv({ cls: 'ts-legend' });
    for (const state of TASK_STATES) {
      const off = this.hidden.has(state);
      const item = legend.createSpan({
        attr: {
          'data-ts': `state-${state}`,
          'aria-pressed': String(!off),
          title: off ? `Show ${state}` : `Hide ${state}`,
        },
      });
      item.createEl('i', { cls: ['ts-dot', `ts-state-${state}`] });
      item.appendText(state);
      item.createEl('b', { text: String(counts[state]) });
      if (!counts[state]) item.classList.add('is-empty');
      if (off) item.classList.add('is-off');
      makeButton(item, 'button', () => {
        if (off) this.hidden.delete(state);
        else this.hidden.add(state);
        this.render();
      });
    }
  }
}
