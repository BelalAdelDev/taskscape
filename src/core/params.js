/** Parsing of the `key: value` lines inside a ```taskscape code block. Pure. */
const ALIASES = {
  source: 'source',
  sourcefile: 'source',
  file: 'source',
  path: 'source',
  count: 'count',
  numberoftasks: 'count',
  tasks: 'count',
  limit: 'count',
  start: 'start',
  startdate: 'start',
  from: 'start',
  end: 'end',
  enddate: 'end',
  to: 'end',
  view: 'view',
  mode: 'view',
};
function isValidDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.getFullYear() === +m[1] && d.getMonth() === +m[2] - 1 && d.getDate() === +m[3];
}
/** Throws an Error with a readable message when the block is invalid. */
export function parseBlockParams(text) {
  const raw = {};
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) throw new Error(`Can't read line "${line}" (expected "key: value")`);
    const label = line.slice(0, idx).trim();
    const key = ALIASES[label.toLowerCase().replace(/[^a-z]/g, '')];
    if (!key) throw new Error(`Unknown parameter "${label}". Use: source, view, count, start, end`);
    raw[key] = line
      .slice(idx + 1)
      .trim()
      .replace(/^(["'`])(.*)\1$/, '$2') // "quoted"
      .replace(/^\[\[(.*?)(\|.*)?\]\]$/, '$1') // [[wikilink]] / [[link|alias]]
      .trim();
  }
  if (!raw.source) throw new Error('Missing "source:" (the task file to read)');
  const params = { source: raw.source };
  if (raw.view) {
    const view = raw.view.toLowerCase();
    if (view !== 'gantt' && view !== 'summary') throw new Error(`"view" must be gantt or summary (got "${raw.view}")`);
    params.view = view;
  }
  if (raw.count) {
    const n = Number(raw.count);
    if (!Number.isInteger(n) || n < 1) throw new Error(`"count" must be a positive whole number (got "${raw.count}")`);
    params.count = n;
  }
  for (const key of ['start', 'end']) {
    const value = raw[key];
    if (!value) continue;
    if (!isValidDay(value)) throw new Error(`"${key}" must be a date like 2026-09-22 (got "${value}")`);
    params[key] = value;
  }
  if (params.start && params.end && params.start > params.end) throw new Error('"start" is after "end"');
  return params;
}
