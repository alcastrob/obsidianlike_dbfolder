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

  // vscode.openWith doesn't reliably replace a plain-text tab that was already
  // opening for the same document (a race with VS Code's own default-open flow),
  // leaving both the raw-text tab and our custom-editor tab open. Close the
  // leftover text tab for this URI, if any.
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === doc.uri.toString()) {
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
