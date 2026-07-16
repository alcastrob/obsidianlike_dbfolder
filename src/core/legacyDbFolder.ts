// Compatibility layer for the real Obsidian "dbfolder" plugin's database-note format:
// a fenced ```yaml:dbfolder code block embedded in a .md note, holding the column
// definitions and row-source settings (see RafaelGB/obsidian-db-folder). We parse it,
// map it onto our internal DbFolderConfig/RowData model, and write changes back into
// the same block so notes stay interoperable with the original plugin.
import * as yaml from "js-yaml";
import * as path from "path";
import { CellSize, ColumnDef, DbFolderConfig, PropertyType, SelectOption, ViewDef } from "./types";
import { defaultConfig } from "./configStore";
import { emptyFilterGroup, normalizeFilterGroup } from "./query";

// Trailing whitespace on the fence line (common in notes exported with hard line
// breaks, e.g. Obsidian's "  " end-of-line marker) must not prevent a match.
const BLOCK_RE = /```yaml:dbfolder[ \t]*\r?\n([\s\S]*?)```/;

// Some real-world notes end up with U+00A0 (non-breaking space) as indentation
// instead of regular spaces (an artifact of certain editors/export paths). YAML
// indentation must be plain spaces, so js-yaml fails to parse the block's actual
// nesting otherwise - normalize before parsing.
const NBSP = String.fromCharCode(160);
function normalizeIndentation(yamlText: string): string {
  return yamlText.split(NBSP).join(" ");
}

export interface LegacySelectOption {
  label?: string;
  value: string;
  color?: string;
  [key: string]: unknown;
}

export interface LegacyColumnDef {
  key: string;
  input?: string;
  label?: string;
  isHidden?: boolean;
  position?: number;
  options?: LegacySelectOption[];
  formula?: string;
  [key: string]: unknown;
}

export interface LegacyConfig {
  source_data?: "folder" | "query";
  source_destination_path?: string;
  source_form_result?: string;
  cell_size?: CellSize;
  sticky_first_column?: boolean;
  current_row_template?: string;
  [key: string]: unknown;
}

/** Our own view/filter/sort state, stashed under a namespaced key the original plugin ignores. */
export interface VscodeExtra {
  views?: ViewDef[];
  activeViewId?: string;
}

export interface LegacyDbFolderRaw {
  name?: string;
  description?: string;
  columns: Record<string, LegacyColumnDef>;
  config: LegacyConfig;
  filters?: Record<string, unknown>;
  vscodeDbFolder?: VscodeExtra;
  [key: string]: unknown;
}

export function isDatabaseNote(content: string): boolean {
  return BLOCK_RE.test(content);
}

export function extractLegacyBlock(content: string): LegacyDbFolderRaw | undefined {
  const match = BLOCK_RE.exec(content);
  if (!match) return undefined;
  try {
    const raw = yaml.load(normalizeIndentation(match[1])) as LegacyDbFolderRaw;
    if (!raw || typeof raw !== "object" || !raw.columns) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

export function replaceLegacyBlock(content: string, raw: LegacyDbFolderRaw): string {
  const yamlText = yaml.dump(raw, { lineWidth: -1 });
  const newBlock = "```yaml:dbfolder\n" + yamlText + "```";
  if (BLOCK_RE.test(content)) {
    return content.replace(BLOCK_RE, newBlock);
  }
  const separator = content.endsWith("\n") ? "\n" : "\n\n";
  return content + separator + newBlock + "\n";
}

const INPUT_TYPE_MAP: Record<string, PropertyType> = {
  text: "text",
  number: "number",
  checkbox: "checkbox",
  boolean: "checkbox",
  date: "date",
  datetime: "date",
  select: "select",
  tags: "multiSelect",
  multiText: "multiSelect",
  markdown: "filePath",
  calculation: "formula",
  relation: "text",
};

const TYPE_TO_INPUT: Partial<Record<PropertyType, string>> = {
  text: "text",
  number: "number",
  checkbox: "checkbox",
  date: "date",
  select: "select",
  multiSelect: "tags",
  tags: "tags",
  filePath: "markdown",
  formula: "calculation",
  createdTime: "datetime",
  modifiedTime: "datetime",
};

const FILE_COLUMN_KEY = "__file__";

function mapLegacyColumn(key: string, col: LegacyColumnDef): ColumnDef {
  const type = INPUT_TYPE_MAP[col.input ?? "text"] ?? "text";
  const column: ColumnDef = {
    key: key === FILE_COLUMN_KEY ? "$name" : key,
    label: col.label ?? key,
    type,
    hidden: Boolean(col.isHidden),
  };
  if (col.options?.length) {
    column.options = col.options.map(
      (o): SelectOption => ({ value: String(o.value), color: o.color ?? "#61afef" })
    );
  }
  if (type === "formula") {
    column.formula = typeof col.formula === "string" ? col.formula : "";
  }
  return column;
}

/** Reverse-maps one of our columns back into the legacy shape, merging onto any existing entry to preserve unknown fields. */
function mergeColumnIntoLegacy(existing: LegacyColumnDef | undefined, column: ColumnDef): LegacyColumnDef {
  const legacyKey = column.key === "$name" ? FILE_COLUMN_KEY : column.key;
  const base: LegacyColumnDef = { ...(existing ?? { key: legacyKey }) };
  base.key = legacyKey;
  base.label = column.label;
  base.input = TYPE_TO_INPUT[column.type] ?? "text";
  base.isHidden = Boolean(column.hidden);
  if (column.options) {
    base.options = column.options.map((o) => ({ label: o.value, value: o.value, color: o.color }));
  } else {
    delete base.options;
  }
  if (column.type === "formula") {
    base.formula = column.formula ?? "";
  } else {
    delete base.formula;
  }
  return base;
}

export type LegacySource =
  | { mode: "folder"; folderPath: string; recursive: boolean }
  | { mode: "query"; queryFilter: string };

export function resolveLegacySource(
  raw: LegacyDbFolderRaw,
  noteDir: string,
  workspaceRoot: string | undefined,
  recursive = false
): LegacySource {
  const cfg = raw.config ?? {};
  if (cfg.source_data === "query" && typeof cfg.source_form_result === "string" && cfg.source_form_result.trim()) {
    return { mode: "query", queryFilter: cfg.source_form_result.trim() };
  }
  const destPath = typeof cfg.source_destination_path === "string" ? cfg.source_destination_path : undefined;
  const folderPath = destPath && workspaceRoot ? path.join(workspaceRoot, destPath) : noteDir;
  return { mode: "folder", folderPath, recursive };
}

function defaultTableView(columnOrder: string[]): ViewDef {
  return {
    id: "table-default",
    name: "Table",
    type: "table",
    columnOrder,
    filters: emptyFilterGroup(),
    sorts: [],
  };
}

/** Builds our internal DbFolderConfig from a parsed legacy block, restoring any previously-saved view state. */
export function legacyToInternalConfig(raw: LegacyDbFolderRaw): DbFolderConfig {
  const entries = Object.entries(raw.columns ?? {});
  entries.sort(([, a], [, b]) => (a.position ?? 0) - (b.position ?? 0));
  const columns: ColumnDef[] = entries.map(([key, col]) => mapLegacyColumn(key, col));
  const columnOrder = columns.map((c) => c.key);

  const meta = {
    name: raw.name,
    description: raw.description,
    cellSize: raw.config?.cell_size ?? "normal",
    stickyFirstColumn: Boolean(raw.config?.sticky_first_column),
  };

  const extra = raw.vscodeDbFolder;
  if (extra?.views?.length) {
    return {
      version: 1,
      recursive: false,
      columns,
      views: extra.views.map((v) => ({ ...v, filters: normalizeFilterGroup(v.filters) })),
      activeViewId: extra.activeViewId ?? extra.views[0].id,
      ...meta,
    };
  }

  const base = defaultConfig();
  return { ...base, columns, views: [defaultTableView(columnOrder)], activeViewId: "table-default", ...meta };
}

/** Merges our current config's columns/views back into the parsed raw object for serialization. */
export function internalConfigToLegacy(raw: LegacyDbFolderRaw, config: DbFolderConfig): LegacyDbFolderRaw {
  const nextColumns: Record<string, LegacyColumnDef> = {};
  config.columns.forEach((column, index) => {
    const legacyKey = column.key === "$name" ? FILE_COLUMN_KEY : column.key;
    const existing = raw.columns?.[legacyKey];
    const mapped = mergeColumnIntoLegacy(existing, column);
    mapped.position = index;
    nextColumns[legacyKey] = mapped;
  });

  return {
    ...raw,
    name: config.name ?? raw.name,
    description: config.description ?? raw.description,
    columns: nextColumns,
    config: {
      ...raw.config,
      cell_size: config.cellSize ?? raw.config?.cell_size,
      sticky_first_column: config.stickyFirstColumn ?? raw.config?.sticky_first_column,
    },
    vscodeDbFolder: { views: config.views, activeViewId: config.activeViewId },
  };
}
