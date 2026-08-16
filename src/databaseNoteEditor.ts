import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import {
  extractLegacyBlock,
  internalConfigToLegacy,
  LegacyDbFolderRaw,
  legacyToInternalConfig,
  replaceLegacyBlock,
  resolveLegacySource,
} from "./core/legacyDbFolder";
import { readNote } from "./core/frontmatter";
import { normalizeRawValue } from "./core/propertyTypes";
import { buildRowsFromFiles, scanFolder } from "./core/scanner";
import { extractEqualityHints } from "./core/queryHints";
import { DatabaseSourceInfo, DbFolderConfig, RowData } from "./core/types";
import { resolveQueryFiles } from "./dataviewBridge";
import { markViewingRaw } from "./rawViewState";
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
      host.dispose();
    });
  }
}

class NoteDatabaseHost extends DatabaseHost {
  private raw: LegacyDbFolderRaw;
  private noteDir: string;
  private workspaceRoot: string | undefined;
  /** Guards against the doc-change listener re-triggering off our own writes. */
  public isApplyingOwnEdit = false;
  /** Query-mode row resolution goes through the sibling dataview extension's own
   *  file index, which can lag behind a file we *just* created ourselves - the new
   *  row would then be silently absent from the table until that index catches up.
   *  Paths here are force-included on top of the query result and dropped once the
   *  query naturally includes them (or once the file is gone). */
  private pendingQueryRows = new Set<string>();

  constructor(private document: vscode.TextDocument, private webview: vscode.Webview, raw: LegacyDbFolderRaw) {
    super(legacyToInternalConfig(raw));
    this.raw = raw;
    this.noteDir = path.dirname(document.uri.fsPath);
    this.workspaceRoot = resolveWorkspaceRoot(document.uri);
  }

  dispose(): void {
    this.unregister();
  }

  watchRowFolder(): vscode.Disposable | undefined {
    const source = resolveLegacySource(this.raw, this.noteDir, this.workspaceRoot, this.config.recursive);
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
    const source = resolveLegacySource(this.raw, this.noteDir, this.workspaceRoot, this.config.recursive);
    if (source.mode === "folder") return source.folderPath;
    const dest = this.raw.config?.source_destination_path;
    return dest && this.workspaceRoot ? path.join(this.workspaceRoot, dest) : undefined;
  }

  protected async openRawSource(): Promise<void> {
    markViewingRaw(this.document.uri.toString());
    await vscode.commands.executeCommand("vscode.openWith", this.document.uri, "default");
  }

  protected getNewRowDefaults(): Record<string, unknown> {
    const source = resolveLegacySource(this.raw, this.noteDir, this.workspaceRoot, this.config.recursive);
    if (source.mode !== "query") return {};
    // Best-effort so a new row is likely to already satisfy the query's WHERE
    // clause and show up immediately, instead of silently existing on disk but
    // absent from the table until manually edited to match.
    return extractEqualityHints(source.queryFilter);
  }

  protected getSourceInfo(): DatabaseSourceInfo {
    const cfg = this.raw.config ?? {};
    const mode = cfg.source_data === "query" ? "query" : "folder";
    return {
      mode,
      folderPath: typeof cfg.source_destination_path === "string" ? cfg.source_destination_path : "",
      recursive: this.config.recursive,
      queryFilter: typeof cfg.source_form_result === "string" ? cfg.source_form_result : "",
      templatePath: typeof cfg.current_row_template === "string" ? cfg.current_row_template : "",
    };
  }

  protected async validateQuery(queryFilter: string): Promise<{ ok: boolean; message?: string }> {
    if (!queryFilter.trim()) return { ok: false, message: "Query cannot be empty." };
    if (!this.workspaceRoot) {
      return { ok: false, message: "Query-source databases require an open workspace folder." };
    }
    const resolution = await resolveQueryFiles(queryFilter, this.workspaceRoot);
    return resolution.ok ? { ok: true } : { ok: false, message: resolution.message };
  }

  protected async updateDatabaseSource(source: DatabaseSourceInfo): Promise<void> {
    // The webview's own Save-source flow already blocks this in the common case (see
    // ToolbarMenus.tsx's validatedQuery/pendingSaveRef dance), but that's a UI nicety,
    // not the actual guarantee - it can be beaten by a fast click, and this handler is
    // reachable by any WebviewToHostMessage regardless of which UI state produced it.
    // Re-validate here so an invalid query can never be written into the note: once
    // persisted, every subsequent resolveRows() (including the next "ready") would
    // throw on this exact query, permanently breaking the database until someone edits
    // the raw yaml:dbfolder block by hand.
    if (source.mode === "query") {
      const validation = await this.validateQuery(source.queryFilter ?? "");
      if (!validation.ok) {
        throw new Error(validation.message ?? "Invalid query — source was not saved.");
      }
    }
    const nextRaw: LegacyDbFolderRaw = {
      ...this.raw,
      config: {
        ...this.raw.config,
        source_data: source.mode,
        source_destination_path: source.folderPath || undefined,
        source_form_result: source.mode === "query" ? source.queryFilter || undefined : this.raw.config?.source_form_result,
        current_row_template: source.templatePath || undefined,
      },
    };
    if (source.mode === "folder" && typeof source.recursive === "boolean" && source.recursive !== this.config.recursive) {
      this.config = { ...this.config, recursive: source.recursive };
    }
    await this.applyRawEdit(nextRaw);
    this.onConfigPersisted();
  }

  protected async getNewRowTemplate(): Promise<{ data: Record<string, unknown>; content: string } | undefined> {
    const templateRel = this.raw.config?.current_row_template;
    if (typeof templateRel !== "string" || !templateRel.trim() || !this.workspaceRoot) return undefined;
    const templatePath = path.join(this.workspaceRoot, templateRel);
    if (!fs.existsSync(templatePath)) return undefined;

    const { data, content } = readNote(templatePath);
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) normalized[key] = normalizeRawValue(value);
    return { data: normalized, content };
  }

  protected async resolveRows(config: DbFolderConfig): Promise<{ config: DbFolderConfig; rows: RowData[] }> {
    const latest = extractLegacyBlock(this.document.getText());
    if (latest) this.raw = latest;

    const source = resolveLegacySource(this.raw, this.noteDir, this.workspaceRoot, config.recursive);
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
    return buildRowsFromFiles(this.withPendingQueryRows(resolution.files), config);
  }

  /** Reconciles `pendingQueryRows` against a freshly-resolved query file list: drops
   *  entries the query now includes on its own (index caught up) or that no longer
   *  exist on disk, and force-includes any still-pending ones that are missing. */
  private withPendingQueryRows(files: string[]): string[] {
    if (this.pendingQueryRows.size === 0) return files;
    const known = new Set(files);
    const forced: string[] = [];
    for (const p of this.pendingQueryRows) {
      if (known.has(p) || !fs.existsSync(p)) {
        this.pendingQueryRows.delete(p);
      } else {
        forced.push(p);
      }
    }
    return forced.length ? [...files, ...forced] : files;
  }

  protected onRowCreated(filePath: string): void {
    this.pendingQueryRows.add(filePath);
  }

  protected async persistConfig(config: DbFolderConfig): Promise<void> {
    await this.applyRawEdit(internalConfigToLegacy(this.raw, config));
  }

  private async applyRawEdit(nextRaw: LegacyDbFolderRaw): Promise<void> {
    this.raw = nextRaw;
    const newText = replaceLegacyBlock(this.document.getText(), nextRaw);
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
