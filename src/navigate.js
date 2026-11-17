/** Jump from the chart to a task's line in its note. */
import { MarkdownView } from 'obsidian';
/** The recorded line if it still holds the task, else the nearest line with the same text. */
function locateLine(editor, task) {
  const last = editor.lineCount() - 1;
  const holdsTask = (line) => line >= 0 && line <= last && editor.getLine(line).trim() === task.raw;
  if (holdsTask(task.line)) return task.line;
  let best = -1;
  for (let line = 0; line <= last; line++) {
    if (holdsTask(line) && (best === -1 || Math.abs(line - task.line) < Math.abs(best - task.line))) best = line;
  }
  return best === -1 ? Math.min(Math.max(task.line, 0), last) : best;
}
function findLeaf(app, file) {
  return app.workspace
    .getLeavesOfType('markdown')
    .find((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
}
/**
 * Opens the note (reusing a tab that already shows it), scrolls to the task and selects its line,
 * which is the highlight. The note is switched to the editing view so the selection is visible.
 */
export async function openTaskInNote(app, file, task) {
  const leaf = findLeaf(app, file) ?? app.workspace.getLeaf('tab');
  await leaf.openFile(file, { state: { mode: 'source' } });
  await app.workspace.revealLeaf(leaf);
  app.workspace.setActiveLeaf(leaf, { focus: true });
  const view = leaf.view;
  if (!(view instanceof MarkdownView)) return;
  const editor = view.editor;
  const line = locateLine(editor, task);
  const from = { line, ch: 0 };
  const to = { line, ch: editor.getLine(line).length };
  editor.setSelection(from, to);
  editor.scrollIntoView({ from, to }, true);
  editor.focus();
}
