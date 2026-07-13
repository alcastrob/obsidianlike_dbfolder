import { FilterRule, RowData, SortRule } from "./types";

function toComparable(value: unknown): string | number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) return value.join(", ").toLowerCase();
  if (value === undefined || value === null) return "";
  return String(value).toLowerCase();
}

function matchesFilter(row: RowData, filter: FilterRule): boolean {
  const value = row.values[filter.columnKey];
  const target = (filter.value ?? "").toLowerCase();
  switch (filter.operator) {
    case "isEmpty":
      return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
    case "isNotEmpty":
      return !matchesFilter(row, { ...filter, operator: "isEmpty" });
    case "eq":
      return toComparable(value) === toComparable(filter.value);
    case "neq":
      return toComparable(value) !== toComparable(filter.value);
    case "contains":
      return toComparable(value).toString().includes(target);
    case "notContains":
      return !toComparable(value).toString().includes(target);
    case "gt":
      return Number(value) > Number(filter.value);
    case "gte":
      return Number(value) >= Number(filter.value);
    case "lt":
      return Number(value) < Number(filter.value);
    case "lte":
      return Number(value) <= Number(filter.value);
    default:
      return true;
  }
}

export function applyFilters(rows: RowData[], filters: FilterRule[]): RowData[] {
  if (filters.length === 0) return rows;
  return rows.filter((row) => filters.every((f) => matchesFilter(row, f)));
}

export function applySorts(rows: RowData[], sorts: SortRule[]): RowData[] {
  if (sorts.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const sort of sorts) {
      const av = toComparable(a.values[sort.columnKey]);
      const bv = toComparable(b.values[sort.columnKey]);
      let cmp = 0;
      if (av < bv) cmp = -1;
      else if (av > bv) cmp = 1;
      if (cmp !== 0) return sort.direction === "asc" ? cmp : -cmp;
    }
    return 0;
  });
}

export function groupBy(rows: RowData[], columnKey: string | undefined): Map<string, RowData[]> {
  const groups = new Map<string, RowData[]>();
  if (!columnKey) {
    groups.set("", rows);
    return groups;
  }
  for (const row of rows) {
    const raw = row.values[columnKey];
    const keys = Array.isArray(raw) ? (raw.length ? raw.map(String) : ["(empty)"]) : [raw === undefined || raw === "" ? "(empty)" : String(raw)];
    for (const key of keys) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
  }
  return groups;
}
