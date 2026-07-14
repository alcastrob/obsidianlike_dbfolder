import * as vscode from "vscode";
import * as path from "path";
import { loadConfig, saveConfig } from "./core/configStore";
import { scanFolder } from "./core/scanner";
import { DbFolderConfig, RowData } from "./core/types";
import { buildWebviewHtml, DatabaseHost } from "./databaseHost";

const panelsByFolder = new Map<string, DbFolderPanel>();

export class DbFolderPanel extends DatabaseHost {
  private disposables: vscode.Disposable[] = [];
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
    super(loadConfig(folderPath));
    this.panel.webview.html = buildWebviewHtml(this.panel.webview, context.extensionUri, `DB: ${path.basename(folderPath)}`);

    this.panel.webview.onDidReceiveMessage((msg) => this.handleMessage(msg), null, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.createWatcher();
  }

  protected getWebview(): vscode.Webview {
    return this.panel.webview;
  }

  protected getRowCreationFolder(): string {
    return this.folderPath;
  }

  protected async resolveRows(config: DbFolderConfig): Promise<{ config: DbFolderConfig; rows: RowData[] }> {
    return scanFolder(this.folderPath, config);
  }

  protected persistConfig(config: DbFolderConfig): void {
    saveConfig(this.folderPath, config);
  }

  protected onConfigPersisted(): void {
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

  private dispose(): void {
    panelsByFolder.delete(this.folderPath);
    this.disposables.forEach((d) => d.dispose());
  }
}
