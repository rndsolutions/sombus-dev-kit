import type { Json } from '../../../sdk/typescript/src/index.js';

/**
 * What a watched path reads in a snapshot. The line between the two failure cases is the
 * upstream author's (section 5): a field that isn't there is a non-match; a field that is
 * there but can't be compared is treated as the condition holding.
 */
export type Reading =
  | { kind: 'absent' }
  | { kind: 'unreadable' }
  | { kind: 'values'; values: string[] };

/** `lifecycle.phase`, `editorial_source[].credibility`: `[]` fans out over an array. */
export function read(doc: Json, path: string): Reading {
  let current: Json[] = [doc];
  for (const raw of path.split('.')) {
    const many = raw.endsWith('[]');
    const key = many ? raw.slice(0, -2) : raw;
    const next: Json[] = [];
    for (const node of current) {
      if (node === null || typeof node !== 'object' || Array.isArray(node)) return { kind: 'unreadable' };
      if (!(key in node)) continue;
      const v = node[key];
      if (many) {
        if (!Array.isArray(v)) return { kind: 'unreadable' };
        next.push(...v);
      } else {
        next.push(v);
      }
    }
    if (next.length === 0) return { kind: 'absent' };
    current = next;
  }
  const values: string[] = [];
  for (const v of current) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') values.push(String(v));
    else return { kind: 'unreadable' };
  }
  return { kind: 'values', values };
}
