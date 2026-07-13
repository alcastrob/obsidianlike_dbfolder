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

export interface FilterRule {
  id: string;
  columnKey: string;
  operator:
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
  value?: string;
}

export interface SortRule {
  columnKey: string;
  direction: "asc" | "desc";
}

export interface ViewDef {
  id: string;
  name: string;
  type: ViewType;
  columnOrder: string[]; // column keys, in display order
  filters: FilterRule[];
  sorts: SortRule[];
  groupByColumnKey?: string; // used by board view (must be select type); optional grouping for others
  coverColumnKey?: string; // used by gallery view for image field
}

export interface DbFolderConfig {
  version: 1;
  recursive: boolean;
  columns: ColumnDef[];
  views: ViewDef[];
  activeViewId: string;
}

export interface RowData {
  filePath: string; // absolute path
  fileName: string; // without extension
  values: Record<string, unknown>; // columnKey -> value (frontmatter values + synthetic file props)
}

export interface DatabaseSnapshot {
  folderPath: string;
  config: DbFolderConfig;
  rows: RowData[];
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
  | { type: "refresh" };
