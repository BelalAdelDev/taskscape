import { MarkdownRenderChild, Notice, Plugin, TFile, normalizePath } from 'obsidian';
import { parseTasks } from './core/tasks';
import { openTaskInNote } from './navigate';
import { parseBlockParams } from './core/params';
import { Tooltip } from './ui/tooltip';
import { TaskView } from './ui/view';
/** One rendered ```taskscape block: reads the task file, draws it, and redraws when the file changes. */
class TaskscapeBlock extends MarkdownRenderChild {
  tooltip = null;
  view = null;
  file = null;
  source = '';
  renderId = 0;
  constructor(plugin, blockText, el, mdContext) {
    super(el);
    this.plugin = plugin;
    this.blockText = blockText;
    this.mdContext = mdContext;
    this.box = el.createDiv({ cls: 'taskscape-root' });
  }
  onload() {
    try {
      const params = parseBlockParams(this.blockText);
      this.source = params.source;
      this.tooltip = new Tooltip(this.box);
      this.view = new TaskView(
        this.box,
        { tooltip: this.tooltip, openTask: (task) => void this.openTask(task) },
        params,
      );
    } catch (err) {
      this.showMessage(errorText(err), true);
      return;
    }
    // live update when the task file changes
    this.registerEvent(
      this.plugin.app.vault.on('modify', (file) => {
        if (!this.file || file.path !== this.file.path) return;
        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => void this.render(), 400);
      }),
    );
    void this.render();
  }
  onunload() {
    window.clearTimeout(this.timer);
    this.renderId++;
    this.tooltip?.destroy();
  }
  showMessage(text, isError) {
    this.box.empty();
    this.box.createDiv({
      cls: isError ? ['ts-message', 'ts-error'] : 'ts-message',
      text: (isError ? 'Taskscape: ' : '') + text,
    });
  }
  resolveFile(path) {
    const { vault, metadataCache } = this.plugin.app;
    let found = vault.getAbstractFileByPath(normalizePath(path));
    if (!found && !/\.md$/i.test(path)) found = vault.getAbstractFileByPath(normalizePath(path + '.md'));
    if (!found) found = metadataCache.getFirstLinkpathDest(path.replace(/\.md$/i, ''), this.mdContext.sourcePath);
    return found instanceof TFile ? found : null;
  }
  async render() {
    const id = ++this.renderId;
    try {
      const file = this.resolveFile(this.source);
      if (!file) return this.showMessage(`source file not found: ${this.source}`, true);
      this.file = file;
      const text = await this.plugin.app.vault.read(file);
      if (id !== this.renderId) return; // a newer render started
      this.view?.update(parseTasks(text));
    } catch (err) {
      this.showMessage(errorText(err), true);
    }
  }
  async openTask(task) {
    if (!this.file) return;
    try {
      await openTaskInNote(this.plugin.app, this.file, task);
    } catch (err) {
      new Notice(`Taskscape: could not open the task (${errorText(err)})`);
    }
  }
}
const errorText = (err) => (err instanceof Error ? err.message : String(err));
export default class TaskscapePlugin extends Plugin {
  onload() {
    this.registerMarkdownCodeBlockProcessor('taskscape', (source, el, ctx) => {
      ctx.addChild(new TaskscapeBlock(this, source, el, ctx));
    });
  }
}
