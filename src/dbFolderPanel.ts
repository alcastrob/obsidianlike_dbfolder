import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { loadConfig, saveConfig, upsertColumn, removeColumn } from "./core/configStore";
import { scanFolder } from "./core/scanner";
import { writeFrontmatter, createNote } from "./core/frontmatter";
import {
  DatabaseSnapshot,
  DbFolderConfig,
  WebviewToHostMessage,
} from "./core/types";

const panelsByFolder = new Map<string, DbFolderPanel>();

export class DbFolderPanel {
  private disposables: vscode.Disposable[] = [];
  private config: DbFolderConfig;
  private watcher: vscode.FileSystemWatcher | undefined;

  static createOrShow(context: vscode.ExtensionContext, folderPath: string): void {
    const existing = panelsByFolder.get(folderPath);
    if (existing) {
      existing.panel.reveal();
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "mdDbFolder",
      `DB: ${path.basename(folderPath)}`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      }
    );
    const instance = new DbFolderPanel(context, panel, folderPath);
    panelsByFolder.set(folderPath, instance);
  }

  static refresh(folderPath: string): void {
    panelsByFolder.get(folderPath)?.sendSnapshot();
  }

  private constructor(
    private context: vscode.ExtensionContext,
    private panel: vscode.WebviewPanel,
    private folderPath: string
  ) {
    this.config = loadConfig(folderPath);
    this.panel.webview.html = this.buildHtml();

    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToHostMessage) => this.handleMessage(msg),
      null,
      this.disposables
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.createWatcher();
  }

  private createWatcher(): void {
    this.watcher?.dispose();
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.folderPath, this.config.recursive ? "**/*.md" : "*.md")
    );
    this.watcher.onDidChange(() => this.sendSnapshot());
    this.watcher.onDidCreate(() => this.sendSnapshot());
    this.watcher.onDidDelete(() => this.sendSnapshot());
    this.disposables.push(this.watcher);
  }

  private buildSnapshot(): DatabaseSnapshot {
    const { config, rows } = scanFolder(this.folderPath, this.config);
    this.config = config;
    saveConfig(this.folderPath, this.config);
    return { folderPath: this.folderPath, config: this.config, rows };
  }

  private sendSnapshot(): void {
    this.panel.webview.postMessage({ type: "snapshot", snapshot: this.buildSnapshot() });
  }

  private handleMessage(msg: WebviewToHostMessage): void {
    try {
      switch (msg.type) {
        case "ready":
          this.panel.webview.postMessage({ type: "init", snapshot: this.buildSnapshot() });
          return;
        case "updateCell": {
          const col = this.config.columns.find((c) => c.key === msg.columnKey);
          if (col && col.type !== "formula") {
            writeFrontmatter(msg.filePath, { [msg.columnKey]: msg.value });
          }
          this.sendSnapshot();
          return;
        }
        case "addColumn":
          this.config = upsertColumn(this.config, msg.column);
          this.sendSnapshot();
          return;
        case "updateColumn":
          this.config = upsertColumn(this.config, msg.column);
          this.sendSnapshot();
          return;
        case "deleteColumn":
          this.config = removeColumn(this.config, msg.columnKey);
          this.sendSnapshot();
          return;
        case "reorderColumns": {
          const activeView = this.config.views.find((v) => v.id === this.config.activeViewId);
          if (activeView) activeView.columnOrder = msg.columnOrder;
          this.sendSnapshot();
          return;
        }
        case "addRow": {
          const safeName = msg.fileName.replace(/[\\/:*?"<>|]/g, "").trim() || "Untitled";
          let filePath = path.join(this.folderPath, `${safeName}.md`);
          let n = 1;
          while (fs.existsSync(filePath)) {
            filePath = path.join(this.folderPath, `${safeName} ${++n}.md`);
          }
          createNote(filePath, {});
          this.sendSnapshot();
          return;
        }
        case "deleteRow":
          vscode.workspace.fs.delete(vscode.Uri.file(msg.filePath)).then(
            () => this.sendSnapshot(),
            () => this.sendSnapshot()
          );
          return;
        case "openRow":
          vscode.window.showTextDocument(vscode.Uri.file(msg.filePath), { preview: false });
          return;
        case "addView":
          this.config = { ...this.config, views: [...this.config.views, msg.view] };
          this.sendSnapshot();
          return;
        case "updateView":
          this.config = {
            ...this.config,
            views: this.config.views.map((v) => (v.id === msg.view.id ? msg.view : v)),
          };
          this.sendSnapshot();
          return;
        case "deleteView":
          this.config = {
            ...this.config,
            views: this.config.views.filter((v) => v.id !== msg.viewId),
            activeViewId:
              this.config.activeViewId === msg.viewId
                ? this.config.views[0]?.id ?? ""
                : this.config.activeViewId,
          };
          this.sendSnapshot();
          return;
        case "setActiveView":
          this.config = { ...this.config, activeViewId: msg.viewId };
          this.sendSnapshot();
          return;
        case "setRecursive":
          this.config = { ...this.config, recursive: msg.recursive };
          this.createWatcher();
          this.sendSnapshot();
          return;
        case "refresh":
          this.sendSnapshot();
          return;
      }
    } catch (err) {
      this.panel.webview.postMessage({
        type: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private buildHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js")
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.css")
    );
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>DB Folder</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private dispose(): void {
    panelsByFolder.delete(this.folderPath);
    this.disposables.forEach((d) => d.dispose());
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
