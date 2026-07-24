// Obsidian-style [[wikilink]] parsing. Dependency-free so it can be shared
// between the webview (inline rendering) and scratch tests.

export interface WikilinkMatch {
  raw: string; // full "[[...]]" text, including brackets
  target: string; // link target, heading/alias stripped
  label: string; // alias if present, else target
  start: number;
  end: number;
}

const WIKILINK_RE = /\[\[([^\[\]|#]+)(?:#[^\[\]|]*)?(?:\|([^\[\]]+))?\]\]/g;

/** Finds every [[wikilink]] occurrence within free text (a cell that mixes prose and links). */
export function findWikilinks(text: string): WikilinkMatch[] {
  const matches: WikilinkMatch[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(text))) {
    const target = m[1].trim();
    const label = (m[2] ?? target).trim();
    matches.push({ raw: m[0], target, label, start: m.index, end: m.index + m[0].length });
  }
  return matches;
}

/** True when `value` is nothing but a single wikilink (e.g. one item of a multi-select-of-links field). */
export function parseWholeWikilink(value: string): { target: string; label: string } | null {
  const trimmed = value.trim();
  const matches = findWikilinks(trimmed);
  if (matches.length === 1 && matches[0].raw === trimmed) {
    return { target: matches[0].target, label: matches[0].label };
  }
  return null;
}
