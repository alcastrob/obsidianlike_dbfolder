// Shared types between the extension host and the webview UI.
// Kept dependency-free so this file can be imported from both bundles.

export type PropertyType =
  | "text"
  | "number"
  | "checkbox"
  | "date"
  | "select"
  | "multiSelect"
  | "tags"
  | "createdTime"
  | "modifiedTime"
  | "filePath"
  | "formula";

export interface SelectOption {
  value: string;
  color: string;
}

export interface ColumnDef {
  key: string; // frontmatter property key ("file" family keys are reserved: $name, $path, $ctime, $mtime)
  label: string;
  type: PropertyType;
  width?: number;
  options?: SelectOption[]; // for select / multiSelect
  formula?: string; // for type === "formula"
  hidden?: boolean;
}

export type ViewType = "table" | "board" | "list" | "gallery";

export type FilterOperator =
  | "eq"
  | "neq"
  | "contains"
  | "notContains"
  | "isEmpty"
  | "isNotEmpty"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

export interface FilterCondition {
  id: string;
  kind: "condition";
  columnKey: string;
  operator: FilterOperator;
  value?: string;
}

export interface FilterGroup {
  id: string;
  kind: "group";
  combinator: "and" | "or";
  children: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

export interface SortRule {
  columnKey: string;
  direction: "asc" | "desc";
}

export interface ViewDef {
  id: string;
  name: string;
  type: ViewType;
  columnOrder: string[]; // column keys, in display order
  filters: FilterGroup; // root group; nested groups combine with AND/OR
  sorts: SortRule[];
  groupByColumnKey?: string; // used by board view (must be select type); optional grouping for others
  coverColumnKey?: string; // used by gallery view for image field
}

export type CellSize = "compact" | "normal" | "wide";

export interface DbFolderConfig {
  version: 1;
  recursive: boolean;
  columns: ColumnDef[];
  views: ViewDef[];
  activeViewId: string;
  name?: string;
  description?: string;
  cellSize?: CellSize;
  stickyFirstColumn?: boolean;
}

export interface RowData {
  filePath: string; // absolute path
  fileName: string; // without extension
  values: Record<string, unknown>; // columnKey -> value (frontmatter values + synthetic file props)
}

// Present only for note-backed databases (a note with an embedded ```yaml:dbfolder
// block). Lets the UI show/edit the row source without opening the raw file.
export interface DatabaseSourceInfo {
  mode: "folder" | "query";
  folderPath?: string; // workspace-relative; folder-mode's row folder, or query-mode's destination for new rows
  recursive?: boolean; // folder mode only
  queryFilter?: string; // query mode only, e.g. FROM "..." WHERE ...
  templatePath?: string; // workspace-relative path to a note used as the starting point for new rows
}

export interface DatabaseSnapshot {
  folderPath: string;
  config: DbFolderConfig;
  rows: RowData[];
  sourceInfo?: DatabaseSourceInfo;
}

// ---- Webview <-> Extension message protocol ----

export type HostToWebviewMessage =
  | { type: "init"; snapshot: DatabaseSnapshot }
  | { type: "snapshot"; snapshot: DatabaseSnapshot }
  | { type: "error"; message: string };

export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "updateCell"; filePath: string; columnKey: string; value: unknown }
  | { type: "addColumn"; column: ColumnDef }
  | { type: "updateColumn"; column: ColumnDef }
  | { type: "deleteColumn"; columnKey: string }
  | { type: "reorderColumns"; columnOrder: string[] }
  | { type: "addRow"; fileName: string }
  | { type: "deleteRow"; filePath: string }
  | { type: "openRow"; filePath: string }
  | { type: "addView"; view: ViewDef }
  | { type: "updateView"; view: ViewDef }
  | { type: "deleteView"; viewId: string }
  | { type: "setActiveView"; viewId: string }
  | { type: "setRecursive"; recursive: boolean }
  | { type: "updateDatabaseSource"; source: DatabaseSourceInfo }
  | {
      type: "updateDatabaseMeta";
      name?: string;
      description?: string;
      cellSize?: CellSize;
      stickyFirstColumn?: boolean;
    }
  | { type: "generateColumnsFromNote" }
  | { type: "exportCsv"; columns: ColumnDef[]; rows: RowData[] }
  | { type: "importCsv" }
  | { type: "openRawSource" }
  | { type: "refresh" };
