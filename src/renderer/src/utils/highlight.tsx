import type { ReactNode } from 'react';

function tokenizeQuery(query: string): string[] {
  if (!query) return [];
  const out = new Set<string>();
  const ascii = query.match(/[A-Za-z0-9_]+/g);
  if (ascii) for (const w of ascii) out.add(w.toLowerCase());
  const cjk = query.match(/[㐀-鿿豈-﫿]+/g);
  if (cjk) {
    for (const run of cjk) {
      if (run.length === 1) out.add(run);
      for (let i = 0; i < run.length - 1; i++) {
        out.add(run.slice(i, i + 2));
      }
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

export function highlightTerms(text: string, query: string): ReactNode {
  if (!text) return text;
  const terms = tokenizeQuery(query);
  if (!terms.length) return text;

  const ranges: Array<[number, number]> = [];
  const lower = text.toLowerCase();
  for (const t of terms) {
    if (!t) continue;
    const tl = t.toLowerCase();
    let from = 0;
    while (from < lower.length) {
      const idx = lower.indexOf(tl, from);
      if (idx < 0) break;
      ranges.push([idx, idx + tl.length]);
      from = idx + tl.length;
    }
  }
  if (!ranges.length) return text;

  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }

  const out: ReactNode[] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) out.push(text.slice(cursor, s));
    out.push(
      <mark
        key={s}
        className="rounded-sm bg-warn-100 px-0.5 text-warn-900 dark:bg-warn-500/30 dark:text-warn-100"
      >
        {text.slice(s, e)}
      </mark>
    );
    cursor = e;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

export { tokenizeQuery };
