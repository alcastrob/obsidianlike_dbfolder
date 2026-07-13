import * as vscode from "vscode";
import { DbFolderPanel } from "./dbFolderPanel";

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
    })
  );
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
