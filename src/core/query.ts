import { FilterCondition, FilterGroup, FilterNode, RowData, SortRule } from "./types";

function toComparable(value: unknown): string | number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (Array.isArray(value)) return value.join(", ").toLowerCase();
  if (value === undefined || value === null) return "";
  // Filter values always arrive as strings (typed into a text input), so a
  // checkbox cell (a real boolean, coerced to 1/0 above) can never match a
  // typed "true"/"false" unless string inputs get the same treatment here.
  const str = String(value).trim().toLowerCase();
  if (str === "true") return 1;
  if (str === "false") return 0;
  return str;
}

function matchesCondition(row: RowData, condition: FilterCondition): boolean {
  const value = row.values[condition.columnKey];
  const target = (condition.value ?? "").toLowerCase();
  switch (condition.operator) {
    case "isEmpty":
      return value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
    case "isNotEmpty":
      return !matchesCondition(row, { ...condition, operator: "isEmpty" });
    case "eq":
      return toComparable(value) === toComparable(condition.value);
    case "neq":
      return toComparable(value) !== toComparable(condition.value);
    case "contains":
      return toComparable(value).toString().includes(target);
    case "notContains":
      return !toComparable(value).toString().includes(target);
    case "gt":
      return Number(value) > Number(condition.value);
    case "gte":
      return Number(value) >= Number(condition.value);
    case "lt":
      return Number(value) < Number(condition.value);
    case "lte":
      return Number(value) <= Number(condition.value);
    default:
      return true;
  }
}

function matchesNode(row: RowData, node: FilterNode): boolean {
  if (node.kind === "condition") return matchesCondition(row, node);
  if (node.children.length === 0) return true; // an empty group is a neutral, always-true filter
  return node.combinator === "and"
    ? node.children.every((child) => matchesNode(row, child))
    : node.children.some((child) => matchesNode(row, child));
}

export function applyFilters(rows: RowData[], filterGroup: FilterGroup): RowData[] {
  return rows.filter((row) => matchesNode(row, filterGroup));
}

export function countFilterConditions(node: FilterNode): number {
  if (node.kind === "condition") return 1;
  return node.children.reduce((sum, child) => sum + countFilterConditions(child), 0);
}

export function emptyFilterGroup(): FilterGroup {
  return { id: "root", kind: "group", combinator: "and", children: [] };
}

/**
 * Views persisted before nested filter groups existed stored `filters` as a flat
 * FilterRule[] (implicitly AND-ed). Wrap that shape into an equivalent root group;
 * pass through anything that's already a group unchanged.
 */
export function normalizeFilterGroup(value: unknown): FilterGroup {
  if (value && typeof value === "object" && !Array.isArray(value) && (value as { kind?: string }).kind === "group") {
    return value as FilterGroup;
  }
  if (Array.isArray(value)) {
    const children: FilterNode[] = value.map((r, idx) => ({
      id: typeof r?.id === "string" ? r.id : `f-${idx}-${Date.now()}`,
      kind: "condition" as const,
      columnKey: r?.columnKey ?? "",
      operator: r?.operator ?? "contains",
      value: r?.value,
    }));
    return { id: "root", kind: "group", combinator: "and", children };
  }
  return emptyFilterGroup();
}

export function removeColumnFromFilterGroup(group: FilterGroup, columnKey: string): FilterGroup {
  const children = group.children
    .map((child) => (child.kind === "group" ? removeColumnFromFilterGroup(child, columnKey) : child))
    .filter((child) => !(child.kind === "condition" && child.columnKey === columnKey));
  return { ...group, children };
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
