/**
 * Interactive `<%label%>` placeholders inside a "row template" note (see
 * `DatabaseHost.getNewRowTemplate()` / CLAUDE.md's row-template notes). Pure parsing/
 * substitution logic lives here (no `vscode`) so it's testable with a throwaway
 * `scratch-*.ts` script; the actual "ask the user" step (native `showInputBox` prompts)
 * happens in `databaseHost.ts`, which has the `vscode` API available.
 *
 * Syntax is deliberately simple: `<%` + free text (trimmed) + `%>`. The trimmed text is
 * both the placeholder's identity (two placeholders with the same text share one answer,
 * asked only once) and the question shown to the user - there's no separate key/label pair.
 *
 * One placeholder is special-cased and never asked about: `<%date%>` / `<%date FORMAT%>`
 * (see below) auto-fills today's date. `databaseHost.ts` must run the date substitution
 * *before* `collectPlaceholderLabels`, or "date ..." would just be treated as a normal
 * label needing a prompt.
 */

const PLACEHOLDER_RE = /<%\s*([^%]+?)\s*%>/g;

/**
 * Collects the distinct placeholder labels found in a template's body content and/or
 * frontmatter data (recursing into arrays and nested objects, since a template's YAML
 * values - not just its body - can contain `<%label%>` too), in first-appearance order.
 */
export function collectPlaceholderLabels(content: string, data: Record<string, unknown>): string[] {
  const seen = new Set<string>();
  const order: string[] = [];

  const scan = (text: string) => {
    PLACEHOLDER_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PLACEHOLDER_RE.exec(text))) {
      const label = m[1].trim();
      if (label && !seen.has(label)) {
        seen.add(label);
        order.push(label);
      }
    }
  };
  const walk = (value: unknown): void => {
    if (typeof value === "string") scan(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };

  scan(content);
  walk(data);
  return order;
}

/** Applies `fn` to every string found in `data`, recursing into arrays/nested objects
 *  and leaving other value types untouched. Shared by both "walk a frontmatter data
 *  object and rewrite its strings" passes below (interactive labels, and the date
 *  placeholder). */
function deepMapStrings(data: Record<string, unknown>, fn: (text: string) => string): Record<string, unknown> {
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return fn(value);
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(v);
      return out;
    }
    return value;
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) out[key] = walk(value);
  return out;
}

/** Replaces every `<%label%>` occurrence in `text` with its answer. A label with no
 *  entry in `answers` (shouldn't happen - every collected label is asked before this
 *  runs) is left in place rather than silently dropped. */
export function substitutePlaceholdersInText(text: string, answers: Map<string, string>): string {
  return text.replace(PLACEHOLDER_RE, (whole, rawLabel: string) => {
    const answer = answers.get(rawLabel.trim());
    return answer === undefined ? whole : answer;
  });
}

/** Deep-applies `substitutePlaceholdersInText` to every string in a frontmatter data
 *  object, recursing into arrays/nested objects and leaving non-string values untouched. */
export function substitutePlaceholdersInData(
  data: Record<string, unknown>,
  answers: Map<string, string>
): Record<string, unknown> {
  return deepMapStrings(data, (text) => substitutePlaceholdersInText(text, answers));
}

const DATE_PLACEHOLDER_RE = /<%\s*date(?:\s+([^%]*?))?\s*%>/gi;
const DEFAULT_DATE_FORMAT = "YYYYMMDD";

/** Formats `date` using a tiny token vocabulary (YYYY, YY, MM, DD - checked longest-token-
 *  first so YYYY isn't half-consumed by the YY pass); anything else in `format` passes
 *  through as literal text, so e.g. "DD/MM/YYYY" or "Hoy es DD-MM-YYYY" both work. */
function formatDate(date: Date, format: string): string {
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  return format
    .replace(/YYYY/g, yyyy)
    .replace(/YY/g, yyyy.slice(-2))
    .replace(/MM/g, pad2(date.getMonth() + 1))
    .replace(/DD/g, pad2(date.getDate()));
}

/** Auto-substitutes `<%date%>` / `<%date FORMAT%>` with today's date - unlike a plain
 *  `<%label%>` this is never asked to the user. No `FORMAT` given -> `YYYYMMDD`. `now`
 *  defaults to the real current date; a caller may pass a fixed one (tests, or to keep
 *  every placeholder in one template consistent even if evaluation spans a midnight). */
export function substituteDatePlaceholdersInText(text: string, now: Date = new Date()): string {
  return text.replace(DATE_PLACEHOLDER_RE, (_whole, rawFormat?: string) => {
    const format = rawFormat?.trim() || DEFAULT_DATE_FORMAT;
    return formatDate(now, format);
  });
}

/** Deep-applies `substituteDatePlaceholdersInText` across a frontmatter data object. */
export function substituteDatePlaceholdersInData(
  data: Record<string, unknown>,
  now: Date = new Date()
): Record<string, unknown> {
  return deepMapStrings(data, (text) => substituteDatePlaceholdersInText(text, now));
}
