import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { upsertColumn, removeColumn } from "./core/configStore";
import { writeFrontmatter, createNote } from "./core/frontmatter";
import { DatabaseSnapshot, DatabaseSourceInfo, DbFolderConfig, RowData, WebviewToHostMessage } from "./core/types";

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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
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
  protected config: DbFolderConfig;

  constructor(initialConfig: DbFolderConfig) {
    this.config = initialConfig;
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

  protected async buildSnapshot(): Promise<DatabaseSnapshot> {
    const before = JSON.stringify({ columns: this.config.columns, views: this.config.views });
    const { config, rows } = await this.resolveRows(this.config);
    this.config = config;
    const after = JSON.stringify({ columns: this.config.columns, views: this.config.views });
    if (before !== after) {
      await this.persistConfig(this.config);
      this.onConfigPersisted();
    }
    return { folderPath: this.getRowCreationFolder() ?? "", config: this.config, rows, sourceInfo: this.getSourceInfo() };
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
          createNote(filePath, {});
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
        case "refresh":
          await this.sendSnapshot();
          return;
      }
    } catch (err) {
      this.getWebview().postMessage({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
