import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { upsertColumn, removeColumn } from "./core/configStore";
import { writeFrontmatter, createNote, readNote } from "./core/frontmatter";
import { buildColumnFromValue, buildDefaultFrontmatter, coerceValueForType, normalizeRawValue } from "./core/propertyTypes";
import { csvRowsToRecords, parseCsv, toCsv } from "./core/csv";
import { DatabaseSnapshot, DatabaseSourceInfo, DbFolderConfig, RowData, WebviewToHostMessage } from "./core/types";
import { parseWholeWikilink } from "./core/wikilinks";
import { resolveCoverText } from "./core/coverValue";

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
const IMAGE_GLOB = "**/*.{png,jpg,jpeg,gif,webp,svg,bmp}";

/** A cover value that is nothing but a `[[wikilink]]` (optionally `![[embed]]` - Obsidian's
 *  own image-embed syntax) whose target looks like an image file. Returns the raw target,
 *  or undefined for anything else (plain text, a URL, prose containing a link, ...). */
function wikilinkImageTarget(raw: string): string | undefined {
  const trimmed = raw.trim();
  const link = parseWholeWikilink(trimmed.startsWith("!") ? trimmed.slice(1) : trimmed);
  return link && IMAGE_EXT_RE.test(link.target) ? link.target : undefined;
}

export function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function buildWebviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri, title: string): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.js"));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "dist", "webview.css"));
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>${title}</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

/**
 * Shared message-protocol handling for anything that presents a DatabaseSnapshot
 * webview (a folder-backed panel, or a note-backed custom editor). Subclasses
 * only need to say how rows are resolved and how config changes get persisted.
 */
export abstract class DatabaseHost {
  // Tracks every live host so the `mdDbFolder.tableFontFamily` setting (see
  // extension.ts's onDidChangeConfiguration listener) can push a fresh snapshot to
  // every open webview immediately, instead of only taking effect on next reopen.
  private static instances = new Set<DatabaseHost>();

  static refreshAllForSettingsChange(): void {
    for (const instance of DatabaseHost.instances) {
      void instance.sendSnapshot();
    }
  }

  protected config: DbFolderConfig;

  constructor(initialConfig: DbFolderConfig) {
    this.config = initialConfig;
    DatabaseHost.instances.add(this);
  }

  /** Subclasses must call this from their own dispose handling, or this host leaks
   *  in the registry above (and keeps receiving settings-change snapshot pushes). */
  protected unregister(): void {
    DatabaseHost.instances.delete(this);
  }

  protected abstract getWebview(): vscode.Webview;
  /** Absolute path used as the DatabaseSnapshot's `folderPath` and as the default location for new rows. */
  protected abstract getRowCreationFolder(): string | undefined;
  /** Re-reads rows (and may discover new columns) for the given config. */
  protected abstract resolveRows(config: DbFolderConfig): Promise<{ config: DbFolderConfig; rows: RowData[] }>;
  /** Persists a structurally-changed config (called only when it actually changed). */
  protected abstract persistConfig(config: DbFolderConfig): void | Promise<void>;
  /** Hook for subclasses that need to react to config changes (e.g. recreate a file watcher). */
  protected onConfigPersisted(): void {}
  /** Only note-backed databases have an editable row source; folder-backed panels leave this undefined. */
  protected getSourceInfo(): DatabaseSourceInfo | undefined {
    return undefined;
  }
  /** Only note-backed databases support editing their source; no-op otherwise. */
  protected async updateDatabaseSource(_source: DatabaseSourceInfo): Promise<void> {
    // no-op by default
  }
  /** Extra starter values for a new row beyond the per-column defaults (e.g. values
   *  likely required by a query-mode database's WHERE clause). None by default. */
  protected getNewRowDefaults(): Record<string, unknown> {
    return {};
  }
  /** A template note to base new rows on (frontmatter + body), if configured. None by default. */
  protected async getNewRowTemplate(): Promise<{ data: Record<string, unknown>; content: string } | undefined> {
    return undefined;
  }
  /** Opens the database's own note as plain markdown source. No-op for folder-backed panels. */
  protected async openRawSource(): Promise<void> {
    // no-op by default
  }
  /** Hook for subclasses that need to track a just-created row (e.g. a query-mode
   *  database bridging the gap until the sibling dataview extension's own index of
   *  the new file catches up). No-op by default. */
  protected onRowCreated(_filePath: string): void {}
  /** Checks whether a query-mode `WHERE` filter is well-formed before it's allowed to be
   *  saved. Only note-backed databases have a query source; always valid otherwise. */
  protected async validateQuery(_queryFilter: string): Promise<{ ok: boolean; message?: string }> {
    return { ok: true };
  }

  /**
   * Resolves an Obsidian-style [[wikilink]] target to a note and opens it, the same
   * way clicking a wikilink in Obsidian does: by unique filename anywhere in the
   * workspace, falling back to a picker when more than one note matches.
   */
  private async openWikilink(rawTarget: string): Promise<void> {
    const target = rawTarget.trim().replace(/\.md$/i, "");
    if (!target) return;
    const targetName = target.split("/").pop() ?? target;

    const allNotes = await vscode.workspace.findFiles("**/*.md");
    const byPath = allNotes.filter((uri) => {
      const rel = vscode.workspace.asRelativePath(uri).replace(/\.md$/i, "").replace(/\\/g, "/");
      return rel === target || rel.endsWith(`/${target}`);
    });
    const candidates =
      byPath.length > 0
        ? byPath
        : allNotes.filter((uri) => path.basename(uri.fsPath, ".md").toLowerCase() === targetName.toLowerCase());

    if (candidates.length === 0) {
      this.getWebview().postMessage({ type: "error", message: `No note found for link "${rawTarget}".` });
      return;
    }

    let uri = candidates[0];
    if (candidates.length > 1) {
      const picked = await vscode.window.showQuickPick(
        candidates.map((c) => ({ label: vscode.workspace.asRelativePath(c), uri: c })),
        { placeHolder: `Multiple notes match "${rawTarget}" — choose one` }
      );
      if (!picked) return;
      uri = picked.uri;
    }

    await vscode.commands.executeCommand("vscode.open", uri, { preview: false });
  }

  /**
   * Gallery view's cover column: when its value is a whole `[[wikilink]]`/`![[embed]]`
   * pointing at an image file, resolve that file the same way `openWikilink` resolves a
   * note link (by workspace-relative path, falling back to a unique basename match) and
   * hand back a URI the webview is actually allowed to load. Plain text and http(s) URLs
   * need none of this - the webview renders those directly - so this only runs, and only
   * touches rows, when the currently active view is a gallery with a cover column set.
   */
  private async resolveCoverImages(rows: RowData[], columnKey: string): Promise<void> {
    const targets = new Set<string>();
    for (const row of rows) {
      const text = resolveCoverText(row.values[columnKey]);
      const target = text && wikilinkImageTarget(text);
      if (target) targets.add(target);
    }
    if (targets.size === 0) return;

    const allImages = await vscode.workspace.findFiles(IMAGE_GLOB);
    const webview = this.getWebview();
    const resolved = new Map<string, string>();
    for (const target of targets) {
      const targetName = target.split("/").pop() ?? target;
      const byPath = allImages.filter((uri) => {
        const rel = vscode.workspace.asRelativePath(uri).replace(/\\/g, "/");
        return rel === target || rel.endsWith(`/${target}`);
      });
      const match =
        byPath[0] ?? allImages.find((uri) => path.basename(uri.fsPath).toLowerCase() === targetName.toLowerCase());
      if (match) resolved.set(target, webview.asWebviewUri(match).toString());
    }
    if (resolved.size === 0) return;

    for (const row of rows) {
      const text = resolveCoverText(row.values[columnKey]);
      const target = text && wikilinkImageTarget(text);
      const uri = target && resolved.get(target);
      if (uri) row.coverImageUri = uri;
    }
  }

  protected async buildSnapshot(): Promise<DatabaseSnapshot> {
    const before = JSON.stringify({ columns: this.config.columns, views: this.config.views });
    const { config, rows } = await this.resolveRows(this.config);
    this.config = config;
    const after = JSON.stringify({ columns: this.config.columns, views: this.config.views });
    if (before !== after) {
      await this.persistConfig(this.config);
      this.onConfigPersisted();
    }
    const activeView = this.config.views.find((v) => v.id === this.config.activeViewId);
    if (activeView?.type === "gallery" && activeView.coverColumnKey) {
      await this.resolveCoverImages(rows, activeView.coverColumnKey);
    }
    const tableFontFamily = vscode.workspace.getConfiguration("mdDbFolder").get<string>("tableFontFamily")?.trim() || undefined;
    return {
      folderPath: this.getRowCreationFolder() ?? "",
      config: this.config,
      rows,
      sourceInfo: this.getSourceInfo(),
      tableFontFamily,
    };
  }

  async sendSnapshot(): Promise<void> {
    const snapshot = await this.buildSnapshot();
    this.getWebview().postMessage({ type: "snapshot", snapshot });
  }

  private async mutateConfig(next: DbFolderConfig): Promise<void> {
    this.config = next;
    await this.persistConfig(this.config);
    this.onConfigPersisted();
  }

  async handleMessage(msg: WebviewToHostMessage): Promise<void> {
    try {
      switch (msg.type) {
        case "ready": {
          const snapshot = await this.buildSnapshot();
          this.getWebview().postMessage({ type: "init", snapshot });
          return;
        }
        case "updateCell": {
          const col = this.config.columns.find((c) => c.key === msg.columnKey);
          if (col && col.type !== "formula") {
            writeFrontmatter(msg.filePath, { [msg.columnKey]: msg.value });
          }
          await this.sendSnapshot();
          return;
        }
        case "addColumn":
        case "updateColumn":
          await this.mutateConfig(upsertColumn(this.config, msg.column));
          await this.sendSnapshot();
          return;
        case "deleteColumn":
          await this.mutateConfig(removeColumn(this.config, msg.columnKey));
          await this.sendSnapshot();
          return;
        case "reorderColumns": {
          const views = this.config.views.map((v) =>
            v.id === this.config.activeViewId ? { ...v, columnOrder: msg.columnOrder } : v
          );
          await this.mutateConfig({ ...this.config, views });
          await this.sendSnapshot();
          return;
        }
        case "addRow": {
          const folder = this.getRowCreationFolder();
          if (!folder) {
            this.getWebview().postMessage({
              type: "error",
              message: "This database has no folder to create new notes in.",
            });
            return;
          }
          const safeName = msg.fileName.replace(/[\\/:*?"<>|]/g, "").trim() || "Untitled";
          if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
          let filePath = path.join(folder, `${safeName}.md`);
          let n = 1;
          while (fs.existsSync(filePath)) {
            filePath = path.join(folder, `${safeName} ${++n}.md`);
          }
          const defaults = { ...buildDefaultFrontmatter(this.config.columns), ...this.getNewRowDefaults() };
          const template = await this.getNewRowTemplate();
          const frontmatter = template ? { ...defaults, ...template.data } : defaults;
          createNote(filePath, frontmatter, template?.content ?? "");
          this.onRowCreated(filePath);
          await this.sendSnapshot();
          return;
        }
        case "deleteRow":
          await vscode.workspace.fs.delete(vscode.Uri.file(msg.filePath)).then(
            () => undefined,
            () => undefined
          );
          await this.sendSnapshot();
          return;
        case "openRow":
          // showTextDocument always forces the plain text editor, bypassing any
          // registered custom editor (e.g. a WYSIWYG markdown editor set as the
          // default for *.md). vscode.open instead resolves the same way a
          // double-click in the Explorer would, respecting that association.
          await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(msg.filePath), { preview: false });
          return;
        case "openWikilink":
          await this.openWikilink(msg.target);
          return;
        case "addView":
          await this.mutateConfig({ ...this.config, views: [...this.config.views, msg.view] });
          await this.sendSnapshot();
          return;
        case "updateView":
          await this.mutateConfig({
            ...this.config,
            views: this.config.views.map((v) => (v.id === msg.view.id ? msg.view : v)),
          });
          await this.sendSnapshot();
          return;
        case "deleteView":
          await this.mutateConfig({
            ...this.config,
            views: this.config.views.filter((v) => v.id !== msg.viewId),
            activeViewId:
              this.config.activeViewId === msg.viewId
                ? this.config.views[0]?.id ?? ""
                : this.config.activeViewId,
          });
          await this.sendSnapshot();
          return;
        case "setActiveView":
          await this.mutateConfig({ ...this.config, activeViewId: msg.viewId });
          await this.sendSnapshot();
          return;
        case "setRecursive":
          await this.mutateConfig({ ...this.config, recursive: msg.recursive });
          await this.sendSnapshot();
          return;
        case "updateDatabaseSource":
          await this.updateDatabaseSource(msg.source);
          await this.sendSnapshot();
          return;
        case "updateDatabaseMeta":
          await this.mutateConfig({
            ...this.config,
            name: msg.name ?? this.config.name,
            description: msg.description ?? this.config.description,
            cellSize: msg.cellSize ?? this.config.cellSize,
            stickyFirstColumn: msg.stickyFirstColumn ?? this.config.stickyFirstColumn,
          });
          await this.sendSnapshot();
          return;
        case "generateColumnsFromNote": {
          const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { Markdown: ["md"] },
            defaultUri: this.getRowCreationFolder() ? vscode.Uri.file(this.getRowCreationFolder()!) : undefined,
            title: "Pick a note to generate columns from",
          });
          if (!picked || picked.length === 0) return;
          const { data } = readNote(picked[0].fsPath);
          let next = this.config;
          for (const [key, rawValue] of Object.entries(data)) {
            if (key.startsWith("$")) continue;
            const value = normalizeRawValue(rawValue);
            if (next.columns.some((c) => c.key === key)) continue;
            next = upsertColumn(next, buildColumnFromValue(key, value));
          }
          await this.mutateConfig(next);
          await this.sendSnapshot();
          return;
        }
        case "exportCsv": {
          const folder = this.getRowCreationFolder();
          const defaultUri = folder
            ? vscode.Uri.file(path.join(folder, `${this.config.name || "export"}.csv`))
            : undefined;
          const target = await vscode.window.showSaveDialog({ filters: { CSV: ["csv"] }, defaultUri });
          if (!target) return;
          fs.writeFileSync(target.fsPath, toCsv(msg.columns, msg.rows), "utf8");
          vscode.window.showInformationMessage(`Exported ${msg.rows.length} row(s) to ${path.basename(target.fsPath)}.`);
          return;
        }
        case "importCsv": {
          const picked = await vscode.window.showOpenDialog({
            canSelectMany: false,
            filters: { CSV: ["csv"] },
            title: "Pick a CSV file to import",
          });
          if (!picked || picked.length === 0) return;

          const folder = this.getRowCreationFolder();
          if (!folder) {
            this.getWebview().postMessage({
              type: "error",
              message: "This database has no folder to create new notes in.",
            });
            return;
          }
          if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });

          const csvRows = parseCsv(fs.readFileSync(picked[0].fsPath, "utf8"));
          if (csvRows.length === 0) return;

          // Auto-add any column the CSV has that we don't already know about.
          const [header, ...body] = csvRows;
          let config = this.config;
          const knownLabels = new Set(config.columns.map((c) => c.label));
          header.forEach((label, idx) => {
            if (knownLabels.has(label) || label === "File") return;
            const sample = body.map((r) => r[idx]).find((v) => v && v.trim());
            config = upsertColumn(config, buildColumnFromValue(label, sample ?? ""));
          });
          if (config !== this.config) await this.mutateConfig(config);

          const persistableTypes = new Set(["formula", "createdTime", "modifiedTime", "filePath"]);
          for (const record of csvRowsToRecords(csvRows, config.columns)) {
            const nameValue = record["$name"] || record["File"] || "Untitled";
            const safeName = String(nameValue).replace(/[\\/:*?"<>|]/g, "").trim() || "Untitled";
            let filePath = path.join(folder, `${safeName}.md`);
            let n = 1;
            while (fs.existsSync(filePath)) filePath = path.join(folder, `${safeName} ${++n}.md`);

            const frontmatter: Record<string, unknown> = {};
            for (const col of config.columns) {
              if (persistableTypes.has(col.type)) continue;
              const raw = record[col.key];
              if (raw === undefined || raw === "") continue;
              const isMulti = col.type === "multiSelect" || col.type === "tags";
              frontmatter[col.key] = coerceValueForType(
                isMulti ? raw.split(";").map((s) => s.trim()).filter(Boolean) : raw,
                col.type
              );
            }
            createNote(filePath, frontmatter);
          }
          await this.sendSnapshot();
          return;
        }
        case "openRawSource":
          await this.openRawSource();
          return;
        case "refresh":
          await this.sendSnapshot();
          return;
        case "validateQuery": {
          const result = await this.validateQuery(msg.queryFilter);
          this.getWebview().postMessage({ type: "queryValidation", ok: result.ok, message: result.message });
          return;
        }
      }
    } catch (err) {
      this.getWebview().postMessage({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
