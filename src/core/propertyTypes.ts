import { ColumnDef, PropertyType, SelectOption } from "./types";

const PALETTE = [
  "#e06c75",
  "#61afef",
  "#98c379",
  "#e5c07b",
  "#c678dd",
  "#56b6c2",
  "#d19a66",
  "#528bff",
];

let paletteIdx = 0;
function nextColor(): string {
  const color = PALETTE[paletteIdx % PALETTE.length];
  paletteIdx += 1;
  return color;
}

/**
 * js-yaml auto-parses unquoted `YYYY-MM-DD` (and datetime) scalars into
 * native Date objects, so raw frontmatter values must be normalized to
 * ISO strings before they reach inferType/coerceValueForType/formulas.
 */
export function normalizeRawValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeRawValue);
  return value;
}

/** Infers a reasonable PropertyType from a raw (already-normalized) frontmatter value. */
export function inferType(value: unknown): PropertyType {
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "number") return "number";
  if (Array.isArray(value)) return "multiSelect";
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/.test(value)) return "date";
    return "text";
  }
  return "text";
}

/** Builds a ColumnDef for a newly-discovered frontmatter key. */
export function buildColumnFromValue(key: string, value: unknown): ColumnDef {
  const type = inferType(value);
  const column: ColumnDef = { key, label: key, type };
  if (type === "multiSelect" || type === "select") {
    const values = Array.isArray(value) ? value : [value];
    column.options = values
      .filter((v): v is string => typeof v === "string")
      .map((v) => ({ value: v, color: nextColor() } as SelectOption));
  }
  return column;
}

export function mergeSelectOptions(
  existing: SelectOption[] | undefined,
  discovered: string[]
): SelectOption[] {
  const result = [...(existing ?? [])];
  const known = new Set(result.map((o) => o.value));
  for (const value of discovered) {
    if (!known.has(value)) {
      result.push({ value, color: nextColor() });
      known.add(value);
    }
  }
  return result;
}

// Types that aren't real, user-owned frontmatter properties: computed/synthetic
// (formula, file stats) or backed by the reserved $name/$path/etc. row fields.
const NON_PERSISTABLE_TYPES = new Set<PropertyType>(["formula", "createdTime", "modifiedTime", "filePath"]);

/** A reasonable "empty" value to seed a brand-new row's frontmatter with, per type. */
function defaultValueForType(column: ColumnDef): unknown {
  switch (column.type) {
    case "checkbox":
      return false;
    case "multiSelect":
    case "tags":
      return [];
    case "text":
      return "";
    case "select":
      return column.options?.[0]?.value ?? "";
    default:
      return undefined;
  }
}

/** Builds starter frontmatter for a new row, matching the database's current columns. */
export function buildDefaultFrontmatter(columns: ColumnDef[]): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const column of columns) {
    if (NON_PERSISTABLE_TYPES.has(column.type)) continue;
    const value = defaultValueForType(column);
    if (value !== undefined) data[column.key] = value;
  }
  return data;
}

export function coerceValueForType(raw: unknown, type: PropertyType): unknown {
  if (raw === null || raw === undefined || raw === "") {
    return type === "checkbox" ? false : undefined;
  }
  switch (type) {
    case "number": {
      const n = typeof raw === "number" ? raw : parseFloat(String(raw));
      return Number.isNaN(n) ? undefined : n;
    }
    case "checkbox":
      return Boolean(raw);
    case "multiSelect":
    case "tags":
      return Array.isArray(raw) ? raw.map(String) : [String(raw)];
    case "select":
    case "text":
    case "date":
    case "filePath":
    case "createdTime":
    case "modifiedTime":
      return String(raw);
    default:
      return raw;
  }
}
