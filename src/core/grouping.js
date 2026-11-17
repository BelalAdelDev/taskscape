/* ---------- names ---------- */
const FUZZY_THRESHOLD = 0.8; // 0..1, higher = stricter
const FUZZY_MIN_LEN = 6; // names shorter than this must match exactly
/** Case- and whitespace-insensitive key. */
export const baseKey = (t) => t.text.trim().toLowerCase().replace(/\s+/g, ' ');
/** The group key if tasks were grouped, else the exact-name key. */
export const nameKey = (t) => t.group ?? baseKey(t);
export const byName = (a, b) => nameKey(a).localeCompare(nameKey(b));
/** Lowercase; drops link urls, math, punctuation/emoji and extra spaces. */
function normalizeName(s) {
  const n = s
    .toLowerCase()
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\$[^$]*\$/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return n || s.toLowerCase().trim();
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
/** 0..1. Levenshtein similarity, also tried with the words sorted (word order doesn't matter). */
export function nameSimilarity(a, b) {
  if (a === b) return 1;
  if (Math.max(a.length, b.length) < FUZZY_MIN_LEN) return 0;
  const sortWords = (s) => s.split(' ').sort().join(' ');
  const ratio = (x, y) => {
    const m = Math.max(x.length, y.length);
    if (Math.abs(x.length - y.length) / m > 1 - FUZZY_THRESHOLD) return 0; // quick reject
    return 1 - editDistance(x, y) / m;
  };
  return Math.max(ratio(a, b), ratio(sortWords(a), sortWords(b)));
}
/* ---------- grouping ---------- */
/**
 * Sets task.group and task.groupName on every task.
 * fuzzy=false: identical names (ignoring case/spacing) share a group.
 * fuzzy=true : similar names are merged. The most frequent names become group
 *              representatives; every other name joins the most similar one (no chaining).
 */
export function assignGroups(tasks, fuzzy = false) {
  const stats = new Map();
  for (const t of tasks) {
    const key = baseKey(t);
    let s = stats.get(key);
    if (!s) stats.set(key, (s = { key, count: 0, raws: new Map() }));
    s.count++;
    const raw = t.text.trim();
    s.raws.set(raw, (s.raws.get(raw) ?? 0) + 1);
  }
  const topName = (s) => [...s.raws.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0][0];
  const repOf = new Map();
  if (!fuzzy) {
    stats.forEach((s) => repOf.set(s.key, { key: s.key, name: topName(s) }));
  } else {
    const reps = [];
    [...stats.values()]
      .sort((x, y) => y.count - x.count || x.key.localeCompare(y.key))
      .forEach((s) => {
        const norm = normalizeName(s.key);
        let best = null,
          bestSim = 0;
        for (const r of reps) {
          const sim = nameSimilarity(norm, r.norm);
          if (sim >= FUZZY_THRESHOLD && sim > bestSim) {
            best = r;
            bestSim = sim;
          }
        }
        if (!best) {
          best = { key: s.key, name: topName(s), norm };
          reps.push(best);
        }
        repOf.set(s.key, best);
      });
  }
  for (const t of tasks) {
    const rep = repOf.get(baseKey(t));
    t.group = rep.key;
    t.groupName = rep.name;
  }
}
function comesBefore(a, b) {
  if (a.due !== b.due) {
    if (!a.due) return false;
    if (!b.due) return true;
    return a.due < b.due;
  }
  return a.line < b.line;
}
/** One row per group, hidden states left out, sorted by name (natural number order). */
export function summarizeTasks(tasks, hidden = new Set()) {
  const groups = new Map();
  for (const t of tasks) {
    if (hidden.has(t.state)) continue;
    const key = nameKey(t);
    let g = groups.get(key);
    if (!g) {
      g = {
        name: t.groupName ?? t.text.trim(),
        count: 0,
        start: null,
        end: null,
        states: {},
        variants: new Map(),
        target: t,
      };
      groups.set(key, g);
    }
    g.count++;
    g.states[t.state] = (g.states[t.state] ?? 0) + 1;
    const name = t.text.trim();
    g.variants.set(name, (g.variants.get(name) ?? 0) + 1);
    if (t.due && (!g.start || t.due < g.start)) g.start = t.due;
    if (t.done && (!g.end || t.done > g.end)) g.end = t.done;
    if (comesBefore(t, g.target)) g.target = t;
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      variants: [...g.variants.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    }))
    .sort(
      (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) || b.count - a.count,
    );
}
