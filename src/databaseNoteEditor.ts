import * as vscode from "vscode";
import * as path from "path";
import {
  extractLegacyBlock,
  internalConfigToLegacy,
  LegacyDbFolderRaw,
  legacyToInternalConfig,
  replaceLegacyBlock,
  resolveLegacySource,
} from "./core/legacyDbFolder";
import { buildRowsFromFiles, scanFolder } from "./core/scanner";
import { DbFolderConfig, RowData } from "./core/types";
import { resolveQueryFiles } from "./dataviewBridge";
import { buildWebviewHtml, DatabaseHost } from "./databaseHost";

export const DATABASE_NOTE_EDITOR_VIEW_TYPE = "mdDbFolder.databaseNoteEditor";

/**
 * vscode.workspace.getWorkspaceFolder() can fail to match a document that is
 * genuinely inside the open workspace folder when the two URIs' Unicode
 * normalization or casing differ (observed with accented folder names synced
 * via Dropbox on Windows). Fall back to the single workspace folder when
 * there's exactly one, and otherwise to a normalized prefix match.
 */
function resolveWorkspaceRoot(uri: vscode.Uri): string | undefined {
  const direct = vscode.workspace.getWorkspaceFolder(uri);
  if (direct) return direct.uri.fsPath;

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return undefined;
  if (folders.length === 1) return folders[0].uri.fsPath;

  const target = uri.fsPath.normalize("NFC").toLowerCase();
  const match = folders.find((f) => target.startsWith(f.uri.fsPath.normalize("NFC").toLowerCase()));
  return match?.uri.fsPath;
}

export function registerDatabaseNoteEditor(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.window.registerCustomEditorProvider(
    DATABASE_NOTE_EDITOR_VIEW_TYPE,
    new DatabaseNoteEditorProvider(context),
    { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false }
  );
}

class DatabaseNoteEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private context: vscode.ExtensionContext) {}

  resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel): void {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
    };
    webviewPanel.webview.html = buildWebviewHtml(
      webviewPanel.webview,
      this.context.extensionUri,
      `DB: ${path.basename(document.fileName)}`
    );

    const raw = extractLegacyBlock(document.getText());
    if (!raw) {
      webviewPanel.webview.postMessage({
        type: "error",
        message: "This note no longer contains a ```yaml:dbfolder block.",
      });
      return;
    }

    const host = new NoteDatabaseHost(document, webviewPanel.webview, raw);

    const messageSub = webviewPanel.webview.onDidReceiveMessage((msg) => host.handleMessage(msg));
    const docChangeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && !host.isApplyingOwnEdit) {
        host.sendSnapshot();
      }
    });
    const watcherSub = host.watchRowFolder();

    webviewPanel.onDidDispose(() => {
      messageSub.dispose();
      docChangeSub.dispose();
      watcherSub?.dispose();
    });
  }
}

class NoteDatabaseHost extends DatabaseHost {
  private raw: LegacyDbFolderRaw;
  private noteDir: string;
  private workspaceRoot: string | undefined;
  /** Guards against the doc-change listener re-triggering off our own writes. */
  public isApplyingOwnEdit = false;

  constructor(private document: vscode.TextDocument, private webview: vscode.Webview, raw: LegacyDbFolderRaw) {
    super(legacyToInternalConfig(raw));
    this.raw = raw;
    this.noteDir = path.dirname(document.uri.fsPath);
    this.workspaceRoot = resolveWorkspaceRoot(document.uri);
  }

  watchRowFolder(): vscode.Disposable | undefined {
    const source = resolveLegacySource(this.raw, this.noteDir, this.workspaceRoot);
    if (source.mode !== "folder") return undefined;
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(source.folderPath, source.recursive ? "**/*.md" : "*.md")
    );
    const refresh = () => this.sendSnapshot();
    watcher.onDidChange(refresh);
    watcher.onDidCreate(refresh);
    watcher.onDidDelete(refresh);
    return watcher;
  }

  protected getWebview(): vscode.Webview {
    return this.webview;
  }

  protected getRowCreationFolder(): string | undefined {
    const source = resolveLegacySource(this.raw, this.noteDir, this.workspaceRoot);
    if (source.mode === "folder") return source.folderPath;
    const dest = this.raw.config?.source_destination_path;
    return dest && this.workspaceRoot ? path.join(this.workspaceRoot, dest) : undefined;
  }

  protected async resolveRows(config: DbFolderConfig): Promise<{ config: DbFolderConfig; rows: RowData[] }> {
    const latest = extractLegacyBlock(this.document.getText());
    if (latest) this.raw = latest;

    const source = resolveLegacySource(this.raw, this.noteDir, this.workspaceRoot);
    if (source.mode === "folder") {
      return scanFolder(source.folderPath, config);
    }
    if (!this.workspaceRoot) {
      throw new Error("Query-source databases require an open workspace folder.");
    }
    const resolution = await resolveQueryFiles(source.queryFilter, this.workspaceRoot);
    if (!resolution.ok) {
      throw new Error(resolution.message);
    }
    return buildRowsFromFiles(resolution.files, config);
  }

  protected async persistConfig(config: DbFolderConfig): Promise<void> {
    const updatedRaw = internalConfigToLegacy(this.raw, config);
    this.raw = updatedRaw;
    const newText = replaceLegacyBlock(this.document.getText(), updatedRaw);
    if (newText === this.document.getText()) return;

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(0, 0, this.document.lineCount, 0);
    edit.replace(this.document.uri, fullRange, newText);

    this.isApplyingOwnEdit = true;
    try {
      await vscode.workspace.applyEdit(edit);
    } finally {
      this.isApplyingOwnEdit = false;
    }
  }
}
