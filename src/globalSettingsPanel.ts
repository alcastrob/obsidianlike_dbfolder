import * as vscode from "vscode";
import { DbFolderGlobalData, loadGlobalSettings, saveGlobalSettings } from "./core/globalSettings";
import { getNonce } from "./databaseHost";

type FieldKind = "boolean" | "text" | "number" | "select";

interface FieldDescriptor {
  path: string; // dotted path within the DbFolderGlobalData object, e.g. "local_settings.cell_size"
  label: string;
  description?: string;
  kind: FieldKind;
  options?: string[];
}

interface Section {
  title: string;
  fields: FieldDescriptor[];
}

const SECTIONS: Section[] = [
  {
    title: "General",
    fields: [
      { path: "global_settings.enable_row_shadow", label: "Row shadow", kind: "boolean", description: "Shadow between rows for readability." },
      { path: "global_settings.enable_auto_update", label: "Auto-update on external changes", kind: "boolean" },
      { path: "global_settings.show_search_bar_by_default", label: "Show search bar by default", kind: "boolean" },
      { path: "global_settings.csv_file_header_key", label: "CSV unique key header", kind: "text" },
      { path: "global_settings.logger_level_info", label: "Log level", kind: "text", description: "Known values seen in the wild: error, warn, info, debug, silent." },
      { path: "global_settings.enable_debug_mode", label: "Enable debug mode", kind: "boolean", description: "Not used by this extension; kept for compatibility with the Obsidian plugin." },
      { path: "global_settings.enable_show_state", label: "Show table state", kind: "boolean", description: "Not used by this extension; kept for compatibility with the Obsidian plugin." },
    ],
  },
  {
    title: "Media",
    fields: [
      { path: "global_settings.media_settings.enable_media_view", label: "Show embedded media by default", kind: "boolean" },
      { path: "global_settings.media_settings.link_alias_enabled", label: "Use column label as link alias", kind: "boolean" },
      { path: "global_settings.media_settings.width", label: "Media width", kind: "number" },
      { path: "global_settings.media_settings.height", label: "Media height", kind: "number" },
    ],
  },
  {
    title: "New database defaults — structure",
    fields: [
      { path: "local_settings.cell_size", label: "Cell size", kind: "select", options: ["compact", "normal", "wide"] },
      { path: "local_settings.sticky_first_column", label: "Sticky first column", kind: "boolean" },
      { path: "local_settings.remove_field_when_delete_column", label: "Remove frontmatter field when a column is deleted", kind: "boolean" },
    ],
  },
  {
    title: "New database defaults — folder organization",
    fields: [
      { path: "local_settings.group_folder_column", label: "Group folder column", kind: "text", description: "Not used by this extension yet; folder reorganization by column value isn't implemented." },
      { path: "local_settings.automatically_group_files", label: "Automatically group files into folders", kind: "boolean", description: "Not used by this extension yet." },
      { path: "local_settings.remove_empty_folders", label: "Remove empty folders", kind: "boolean", description: "Not used by this extension yet." },
      { path: "local_settings.hoist_files_with_empty_attributes", label: "Hoist files with missing attributes to root", kind: "boolean", description: "Not used by this extension yet." },
    ],
  },
  {
    title: "New database defaults — metadata columns",
    fields: [
      { path: "local_settings.show_metadata_created", label: "Show created-date column", kind: "boolean", description: "Not yet exposed as a column toggle in this extension." },
      { path: "local_settings.show_metadata_modified", label: "Show modified-date column", kind: "boolean", description: "Not yet exposed as a column toggle in this extension." },
      { path: "local_settings.show_metadata_tasks", label: "Show tasks column", kind: "boolean", description: "Not implemented in this extension." },
      { path: "local_settings.show_metadata_inlinks", label: "Show inbound links column", kind: "boolean", description: "Not implemented in this extension." },
      { path: "local_settings.show_metadata_outlinks", label: "Show outbound links column", kind: "boolean", description: "Not implemented in this extension." },
      { path: "local_settings.show_metadata_tags", label: "Show tags column", kind: "boolean", description: "Not implemented in this extension." },
    ],
  },
  {
    title: "New database defaults — source",
    fields: [
      { path: "local_settings.source_data", label: "Source", kind: "text", description: "Known values: current_folder, query." },
      { path: "local_settings.source_destination_path", label: "Destination path", kind: "text" },
      { path: "local_settings.source_form_result", label: "Query filter", kind: "text" },
      { path: "local_settings.row_templates_folder", label: "Row templates folder", kind: "text" },
      { path: "local_settings.current_row_template", label: "Row template", kind: "text" },
    ],
  },
  {
    title: "New database defaults — rows and editing",
    fields: [
      { path: "local_settings.pagination_size", label: "Rows per page", kind: "number", description: "Not used by this extension; it shows every matching row without pagination." },
      { path: "local_settings.font_size", label: "Font size", kind: "number", description: "Not used by this extension; the table follows VS Code's editor.fontSize instead." },
      { path: "local_settings.enable_footer", label: "Show footer", kind: "boolean", description: "Not implemented in this extension." },
      { path: "local_settings.enable_js_formulas", label: "Enable JS formulas", kind: "boolean", description: "This extension always uses its own safe formula language, never raw JS." },
      { path: "local_settings.formula_folder_path", label: "Formula folder path", kind: "text", description: "Not used by this extension." },
      { path: "local_settings.inline_default", label: "New fields default to inline (field:: value)", kind: "boolean", description: "Not implemented in this extension." },
      { path: "local_settings.inline_new_position", label: "Inline field position", kind: "text", description: "Not implemented in this extension." },
      { path: "local_settings.date_format", label: "Date format", kind: "text" },
      { path: "local_settings.datetime_format", label: "Date+time format", kind: "text" },
      { path: "local_settings.metadata_date_format", label: "Metadata date+time format", kind: "text" },
      { path: "local_settings.implementation", label: "Implementation", kind: "text", description: "Unclear what this configures upstream; kept for compatibility." },
    ],
  },
];

function getAtPath(obj: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), obj);
}

export function openGlobalSettingsPanel(context: vscode.ExtensionContext, vaultRoot: string): void {
  const panel = vscode.window.createWebviewPanel(
    "mdDbFolder.globalSettings",
    "Obsidian like DbFolder: Vault Settings",
    vscode.ViewColumn.Active,
    { enableScripts: true, retainContextWhenHidden: true }
  );

  const render = () => {
    panel.webview.html = buildHtml(loadGlobalSettings(vaultRoot), panel.webview);
  };
  render();

  panel.webview.onDidReceiveMessage(async (msg: { type: string; data?: DbFolderGlobalData }) => {
    if (msg.type === "save" && msg.data) {
      saveGlobalSettings(vaultRoot, msg.data);
      vscode.window.showInformationMessage("DB Folder vault settings saved to .obsidian/plugins/dbfolder/data.json.");
      render();
    }
  });
}

function fieldRowHtml(field: FieldDescriptor, data: DbFolderGlobalData): string {
  const value = getAtPath(data, field.path);
  const desc = field.description ? `<div class="field-desc">${escapeHtml(field.description)}</div>` : "";
  let input: string;
  if (field.kind === "boolean") {
    input = `<input type="checkbox" data-path="${field.path}" ${value ? "checked" : ""} />`;
  } else if (field.kind === "select") {
    const opts = (field.options ?? [])
      .map((o) => `<option value="${o}" ${o === value ? "selected" : ""}>${o}</option>`)
      .join("");
    input = `<select data-path="${field.path}">${opts}</select>`;
  } else if (field.kind === "number") {
    input = `<input type="number" data-path="${field.path}" value="${typeof value === "number" ? value : 0}" />`;
  } else {
    input = `<input type="text" data-path="${field.path}" value="${escapeHtml(String(value ?? ""))}" />`;
  }
  return `<div class="field-row"><label>${escapeHtml(field.label)}${desc}</label>${input}</div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function buildHtml(data: DbFolderGlobalData, webview: vscode.Webview): string {
  const nonce = getNonce();
  const sectionsHtml = SECTIONS.map(
    (section) => `
    <section>
      <h2>${escapeHtml(section.title)}</h2>
      ${section.fields.map((f) => fieldRowHtml(f, data)).join("\n")}
    </section>`
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DB Folder Vault Settings</title>
  <style>
    body { font-family: var(--vscode-font-family, sans-serif); font-size: var(--vscode-font-size, 13px); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 12px 20px 40px; }
    h1 { font-size: 1.3em; }
    h2 { font-size: 1em; margin-top: 28px; border-bottom: 1px solid var(--vscode-widget-border, #444); padding-bottom: 4px; }
    p.intro { opacity: 0.8; max-width: 720px; }
    .field-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; max-width: 720px; }
    .field-row label { flex: 0 0 340px; }
    .field-row input[type="text"], .field-row input[type="number"], .field-row select { flex: 1; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 2px; padding: 3px 6px; }
    .field-desc { font-size: 0.85em; opacity: 0.65; font-weight: normal; margin-top: 2px; }
    #save { position: sticky; bottom: 0; margin-top: 24px; padding: 8px 20px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 3px; cursor: pointer; font-size: 1em; }
    #save:hover { background: var(--vscode-button-hoverBackground); }
    #status { margin-left: 12px; opacity: 0.75; }
  </style>
</head>
<body>
  <h1>DB Folder — Vault Settings</h1>
  <p class="intro">Shared, vault-wide defaults stored in <code>.obsidian/plugins/dbfolder/data.json</code> — the same file the real Obsidian dbfolder plugin uses, so both stay in sync against this vault. "New database defaults" seed every database you create from scratch; each one can still override its own settings afterward.</p>
  ${sectionsHtml}
  <div>
    <button id="save">Save</button>
    <span id="status"></span>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const data = ${JSON.stringify(data)};

    function setAtPath(obj, dotted, value) {
      const parts = dotted.split(".");
      let node = obj;
      for (let i = 0; i < parts.length - 1; i++) {
        node = node[parts[i]] = node[parts[i]] ?? {};
      }
      node[parts[parts.length - 1]] = value;
    }

    document.getElementById("save").addEventListener("click", () => {
      const next = JSON.parse(JSON.stringify(data));
      document.querySelectorAll("[data-path]").forEach((el) => {
        const path = el.getAttribute("data-path");
        let value;
        if (el.type === "checkbox") value = el.checked;
        else if (el.type === "number") value = Number(el.value);
        else value = el.value;
        setAtPath(next, path, value);
      });
      vscode.postMessage({ type: "save", data: next });
      document.getElementById("status").textContent = "Saved.";
      setTimeout(() => (document.getElementById("status").textContent = ""), 2000);
    });
  </script>
</body>
</html>`;
}
