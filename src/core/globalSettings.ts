// Reads/writes the real Obsidian dbfolder plugin's own vault-wide settings file
// (.obsidian/plugins/dbfolder/data.json), so this extension and the real plugin
// share the same configuration when used against the same vault. "local_settings"
// doubles as the default template copied into every newly-created database.
import * as fs from "fs";
import * as path from "path";

export interface MediaSettings {
  link_alias_enabled: boolean;
  enable_media_view: boolean;
  width: number;
  height: number;
}

export interface GlobalSettingsSection {
  enable_debug_mode: boolean;
  enable_show_state: boolean;
  enable_row_shadow: boolean;
  enable_auto_update: boolean;
  show_search_bar_by_default: boolean;
  logger_level_info: string;
  csv_file_header_key: string;
  media_settings: MediaSettings;
  [key: string]: unknown;
}

export interface LocalSettingsSection {
  remove_field_when_delete_column: boolean;
  cell_size: string;
  sticky_first_column: boolean;
  group_folder_column: string;
  remove_empty_folders: boolean;
  automatically_group_files: boolean;
  hoist_files_with_empty_attributes: boolean;
  show_metadata_created: boolean;
  show_metadata_modified: boolean;
  show_metadata_tasks: boolean;
  show_metadata_inlinks: boolean;
  show_metadata_outlinks: boolean;
  show_metadata_tags: boolean;
  source_data: string;
  source_form_result: string;
  source_destination_path: string;
  row_templates_folder: string;
  current_row_template: string;
  pagination_size: number;
  font_size: number;
  enable_js_formulas: boolean;
  formula_folder_path: string;
  inline_default: boolean;
  inline_new_position: string;
  date_format: string;
  datetime_format: string;
  metadata_date_format: string;
  enable_footer: boolean;
  implementation: string;
  [key: string]: unknown;
}

export interface DbFolderGlobalData {
  global_settings: GlobalSettingsSection;
  local_settings: LocalSettingsSection;
  [key: string]: unknown;
}

export function defaultGlobalSettings(): DbFolderGlobalData {
  return {
    global_settings: {
      enable_debug_mode: false,
      enable_show_state: false,
      enable_row_shadow: true,
      enable_auto_update: true,
      show_search_bar_by_default: false,
      logger_level_info: "error",
      csv_file_header_key: "File",
      media_settings: {
        link_alias_enabled: true,
        enable_media_view: true,
        width: 100,
        height: 100,
      },
    },
    local_settings: {
      remove_field_when_delete_column: false,
      cell_size: "normal",
      sticky_first_column: false,
      group_folder_column: "",
      remove_empty_folders: false,
      automatically_group_files: false,
      hoist_files_with_empty_attributes: true,
      show_metadata_created: false,
      show_metadata_modified: false,
      show_metadata_tasks: false,
      show_metadata_inlinks: false,
      show_metadata_outlinks: false,
      show_metadata_tags: false,
      source_data: "current_folder",
      source_form_result: "",
      source_destination_path: "/",
      row_templates_folder: "/",
      current_row_template: "",
      pagination_size: 10,
      font_size: 16,
      enable_js_formulas: false,
      formula_folder_path: "/",
      inline_default: false,
      inline_new_position: "last_field",
      date_format: "yyyy-MM-dd",
      datetime_format: "yyyy-MM-dd HH:mm:ss",
      metadata_date_format: "yyyy-MM-dd HH:mm:ss",
      enable_footer: false,
      implementation: "default",
    },
  };
}

function dataJsonPath(vaultRoot: string): string {
  return path.join(vaultRoot, ".obsidian", "plugins", "dbfolder", "data.json");
}

export function loadGlobalSettings(vaultRoot: string): DbFolderGlobalData {
  const file = dataJsonPath(vaultRoot);
  if (!fs.existsSync(file)) return defaultGlobalSettings();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const defaults = defaultGlobalSettings();
    return {
      ...defaults,
      ...parsed,
      global_settings: { ...defaults.global_settings, ...parsed.global_settings },
      local_settings: { ...defaults.local_settings, ...parsed.local_settings },
    };
  } catch {
    return defaultGlobalSettings();
  }
}

/** Merge-writes onto whatever's already on disk, so fields this extension doesn't know about survive. */
export function saveGlobalSettings(vaultRoot: string, data: DbFolderGlobalData): void {
  const file = dataJsonPath(vaultRoot);
  let onDisk: Record<string, unknown> = {};
  if (fs.existsSync(file)) {
    try {
      onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      onDisk = {};
    }
  }
  const merged = {
    ...onDisk,
    ...data,
    global_settings: { ...(onDisk.global_settings as object), ...data.global_settings },
    local_settings: { ...(onDisk.local_settings as object), ...data.local_settings },
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(merged, null, 2), "utf8");
}
