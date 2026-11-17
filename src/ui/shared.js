/** Renders task text: `$\to$` becomes →, `[text](url)` becomes underlined text. */
export function renderTaskText(el, text) {
  const source = text.replace(/\$\s*\\(?:to|rightarrow)\s*\$/g, '→');
  const link = /\[([^\]]+)\]\([^)]*\)/g;
  let last = 0;
  let m;
  while ((m = link.exec(source)) !== null) {
    if (m.index > last) el.appendText(source.slice(last, m.index));
    el.createEl('u', { text: m[1] });
    last = link.lastIndex;
  }
  if (last < source.length) el.appendText(source.slice(last));
}
/** Makes an element behave like a keyboard-accessible button or switch. */
export function makeButton(el, role, onActivate) {
  el.setAttribute('role', role);
  el.tabIndex = 0;
  el.addEventListener('click', onActivate);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onActivate();
    }
  });
}
