// Best-effort extraction of simple `key = "literal"` / `key = literal` conjuncts
// from a DQL-style `FROM ... WHERE ...` filter string, so a newly-created row can
// be pre-filled with values likely to satisfy the query immediately (otherwise it
// would be created on disk but silently absent from a query-mode database until
// manually edited to match). This is NOT a real parser: only top-level AND-joined
// equality comparisons are understood; OR, functions, !=, etc. are left alone.

function splitTopLevelAnd(whereClause: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  let i = 0;
  while (i < whereClause.length) {
    const ch = whereClause[i];
    if (quote) {
      current += ch;
      if (ch === "\\") {
        current += whereClause[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      i++;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && /\s/.test(ch) && /^and\b/i.test(whereClause.slice(i + 1))) {
      // lookahead already confirmed via slice; consume "AND" and the leading space
      parts.push(current);
      current = "";
      i += 1 + 3; // skip the space we're on plus "AND"
      continue;
    }
    current += ch;
    i++;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function parseLiteral(raw: string): unknown {
  const trimmed = raw.trim();
  if (/^true$/i.test(trimmed)) return true;
  if (/^false$/i.test(trimmed)) return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed
      .slice(1, -1)
      .replace(/\\(.)/g, "$1");
  }
  return trimmed;
}

const EQ_RE = /^\s*([A-Za-z_][\w]*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|true|false|-?\d+(?:\.\d+)?)\s*$/i;

export function extractEqualityHints(queryFilter: string): Record<string, unknown> {
  const whereMatch = /\bWHERE\b([\s\S]*)/i.exec(queryFilter);
  if (!whereMatch) return {};

  const hints: Record<string, unknown> = {};
  for (const conjunct of splitTopLevelAnd(whereMatch[1])) {
    const m = EQ_RE.exec(conjunct);
    if (!m) continue;
    const [, key, rawValue] = m;
    hints[key] = parseLiteral(rawValue);
  }
  return hints;
}
