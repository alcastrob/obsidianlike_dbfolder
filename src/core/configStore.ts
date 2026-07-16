import * as fs from "fs";
import * as path from "path";
import { ColumnDef, DbFolderConfig, ViewDef } from "./types";
import { emptyFilterGroup, normalizeFilterGroup, removeColumnFromFilterGroup } from "./query";

export const CONFIG_FILENAME = ".dbfolder.json";

function configPath(folderPath: string): string {
  return path.join(folderPath, CONFIG_FILENAME);
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

export function defaultConfig(): DbFolderConfig {
  return {
    version: 1,
    recursive: false,
    columns: [],
    views: [defaultTableView([])],
    activeViewId: "table-default",
  };
}

/** Guards against on-disk data predating a schema change (e.g. flat filters -> nested groups). */
function normalizeView(view: ViewDef): ViewDef {
  return { ...view, filters: normalizeFilterGroup(view.filters) };
}

export function loadConfig(folderPath: string): DbFolderConfig {
  const file = configPath(folderPath);
  if (!fs.existsSync(file)) {
    return defaultConfig();
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as DbFolderConfig;
    if (!parsed.views || parsed.views.length === 0) {
      parsed.views = [defaultTableView(parsed.columns?.map((c) => c.key) ?? [])];
      parsed.activeViewId = parsed.views[0].id;
    } else {
      parsed.views = parsed.views.map(normalizeView);
    }
    return parsed;
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(folderPath: string, config: DbFolderConfig): void {
  fs.writeFileSync(configPath(folderPath), JSON.stringify(config, null, 2), "utf8");
}

export function upsertColumn(config: DbFolderConfig, column: ColumnDef): DbFolderConfig {
  const idx = config.columns.findIndex((c) => c.key === column.key);
  const columns = [...config.columns];
  if (idx === -1) {
    columns.push(column);
  } else {
    columns[idx] = column;
  }
  const views = config.views.map((v) =>
    v.columnOrder.includes(column.key)
      ? v
      : { ...v, columnOrder: [...v.columnOrder, column.key] }
  );
  return { ...config, columns, views };
}

/** Ensures every view's columnOrder includes all known column keys (newly discovered ones appended at the end). */
export function syncViewColumnOrders(config: DbFolderConfig): DbFolderConfig {
  const allKeys = config.columns.map((c) => c.key);
  const views = config.views.map((v) => {
    const missing = allKeys.filter((k) => !v.columnOrder.includes(k));
    return missing.length ? { ...v, columnOrder: [...v.columnOrder, ...missing] } : v;
  });
  return { ...config, views };
}

export function removeColumn(config: DbFolderConfig, columnKey: string): DbFolderConfig {
  return {
    ...config,
    columns: config.columns.filter((c) => c.key !== columnKey),
    views: config.views.map((v) => ({
      ...v,
      columnOrder: v.columnOrder.filter((k) => k !== columnKey),
      filters: removeColumnFromFilterGroup(v.filters, columnKey),
      sorts: v.sorts.filter((s) => s.columnKey !== columnKey),
      groupByColumnKey: v.groupByColumnKey === columnKey ? undefined : v.groupByColumnKey,
    })),
  };
}
