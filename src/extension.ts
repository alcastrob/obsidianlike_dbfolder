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
    // onDidOpenTextDocument only fires the *first* time a document loads into
    // memory - clicking an already-open database note again in the Explorer
    // doesn't refire it (VS Code reuses the same TextDocument), so a second
    // click's new preview tab would never get redirected. Tab-open events fire
    // for every new tab regardless, which is the signal we actually need.
    vscode.window.tabGroups.onDidChangeTabs((e) => {
      for (const tab of e.opened) handleTabOpened(tab);
    })
  );

  // Tabs already open when the extension activates (restored session, or a
  // window reload) predate the listener above - sweep them too.
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) handleTabOpened(tab);
  }
}

function tabUri(tab: vscode.Tab): vscode.Uri | undefined {
  const input = tab.input;
  if (input instanceof vscode.TabInputText) return input.uri;
  if (input instanceof vscode.TabInputCustom) return input.uri;
  return undefined;
}

function isOurTab(tab: vscode.Tab, uri: vscode.Uri): boolean {
  const input = tab.input;
  return (
    input instanceof vscode.TabInputCustom &&
    input.viewType === DATABASE_NOTE_EDITOR_VIEW_TYPE &&
    input.uri.toString() === uri.toString()
  );
}

async function handleTabOpened(tab: vscode.Tab): Promise<void> {
  const uri = tabUri(tab);
  if (!uri || !uri.fsPath.toLowerCase().endsWith(".md")) return;
  if (isOurTab(tab, uri)) return;

  // Already open elsewhere with our editor: this new tab is a duplicate (e.g. a
  // fresh Explorer-click preview tab) - close it and focus the existing one.
  const existing = findOurTabForUri(uri, tab);
  if (existing) {
    await vscode.window.tabGroups.close(tab);
    await vscode.commands.executeCommand("vscode.openWith", uri, DATABASE_NOTE_EDITOR_VIEW_TYPE, existing.group.viewColumn);
    return;
  }

  let doc: vscode.TextDocument;
  try {
    doc = await vscode.workspace.openTextDocument(uri);
  } catch {
    return;
  }
  if (!isDatabaseNote(doc.getText())) return;

  await vscode.commands.executeCommand("vscode.openWith", uri, DATABASE_NOTE_EDITOR_VIEW_TYPE, tab.group.viewColumn);

  // Close any other tab left open for this document by the race with VS Code's
  // own default-open flow (or another extension's default editor for *.md).
  for (const group of vscode.window.tabGroups.all) {
    for (const other of group.tabs) {
      const otherUri = tabUri(other);
      if (otherUri && otherUri.toString() === uri.toString() && !isOurTab(other, uri)) {
        await vscode.window.tabGroups.close(other);
      }
    }
  }
}

function findOurTabForUri(uri: vscode.Uri, excluding: vscode.Tab): vscode.Tab | undefined {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab !== excluding && isOurTab(tab, uri)) return tab;
    }
  }
  return undefined;
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
