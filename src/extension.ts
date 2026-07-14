import * as vscode from "vscode";
import { DbFolderPanel } from "./dbFolderPanel";
import { DATABASE_NOTE_EDITOR_VIEW_TYPE, registerDatabaseNoteEditor } from "./databaseNoteEditor";
import { isDatabaseNote } from "./core/legacyDbFolder";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "mdDbFolder.openDatabaseView",
      async (uri?: vscode.Uri) => {
        const folderPath = await resolveFolderPath(uri);
        if (!folderPath) return;
        DbFolderPanel.createOrShow(context, folderPath);
      }
    ),
    vscode.commands.registerCommand("mdDbFolder.refresh", async (uri?: vscode.Uri) => {
      const folderPath = await resolveFolderPath(uri);
      if (!folderPath) return;
      DbFolderPanel.refresh(folderPath);
    }),
    vscode.commands.registerCommand("mdDbFolder.openNoteSource", async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri) return;
      await vscode.commands.executeCommand("vscode.openWith", uri, "default");
    }),
    registerDatabaseNoteEditor(context),
    vscode.workspace.onDidOpenTextDocument((doc) => switchToDatabaseEditorIfNeeded(doc))
  );

  // Tabs restored from a previous session open before onStartupFinished fires, so
  // onDidOpenTextDocument above never sees them — sweep already-open documents too.
  vscode.workspace.textDocuments.forEach((doc) => switchToDatabaseEditorIfNeeded(doc));
}

async function switchToDatabaseEditorIfNeeded(doc: vscode.TextDocument): Promise<void> {
  if (!doc.fileName.toLowerCase().endsWith(".md")) return;
  if (!isDatabaseNote(doc.getText())) return;

  await vscode.commands.executeCommand("vscode.openWith", doc.uri, DATABASE_NOTE_EDITOR_VIEW_TYPE);

  // vscode.openWith doesn't reliably replace whatever editor was already opening
  // for this document (a race with VS Code's own default-open flow, or with
  // another extension's custom editor also registered as default for *.md),
  // leaving a second tab open alongside ours. Close any other tab for this URI.
  // Skip it if the document is dirty: closing a dirty tab prompts a save dialog,
  // and we'd rather leave a stray tab open than pop that dialog ourselves.
  if (doc.isDirty) return;
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input;
      const isOtherEditorForSameDoc =
        (input instanceof vscode.TabInputText && input.uri.toString() === doc.uri.toString()) ||
        (input instanceof vscode.TabInputCustom &&
          input.uri.toString() === doc.uri.toString() &&
          input.viewType !== DATABASE_NOTE_EDITOR_VIEW_TYPE);
      if (isOtherEditorForSameDoc) {
        await vscode.window.tabGroups.close(tab);
      }
    }
  }
}

async function resolveFolderPath(uri?: vscode.Uri): Promise<string | undefined> {
  if (uri) return uri.fsPath;

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showErrorMessage("Open a folder or workspace first.");
    return undefined;
  }
  if (folders.length === 1) return folders[0].uri.fsPath;

  const pick = await vscode.window.showWorkspaceFolderPick();
  return pick?.uri.fsPath;
}

export function deactivate(): void {
  // no-op
}
