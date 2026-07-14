import * as vscode from "vscode";
import * as path from "path";

const DATAVIEW_EXTENSION_ID = "angelCastro.obsidianlike-dataview";

// Structural subset of angelCastro.obsidianlike-dataview's exported API (see its
// src/extension.ts ObsidianlikeDataviewApi). Duplicated locally to avoid a hard
// build-time dependency between the two extension projects.
interface DVLinkLike {
  path: string;
}
interface ListRowLike {
  link?: DVLinkLike;
}
type QueryResultLike =
  | { type: "LIST"; rows: ListRowLike[] }
  | { type: "TABLE" }
  | { type: "TASK" }
  | { type: "CALENDAR" }
  | { type: "ERROR"; message: string };

interface ObsidianlikeDataviewApi {
  runQuery(queryText: string): QueryResultLike;
}

export type QueryResolution =
  | { ok: true; files: string[] }
  | { ok: false; reason: "not-installed" | "not-activated" | "query-error"; message: string };

/**
 * Resolves a legacy dbfolder `FROM ... WHERE ...` filter into absolute file
 * paths, by delegating to the sibling obsidianlike-dataview extension's query
 * engine (prefixed with LIST, since we only need file identity, not columns).
 */
export async function resolveQueryFiles(
  queryFilter: string,
  workspaceRoot: string
): Promise<QueryResolution> {
  const ext = vscode.extensions.getExtension<ObsidianlikeDataviewApi>(DATAVIEW_EXTENSION_ID);
  if (!ext) {
    return {
      ok: false,
      reason: "not-installed",
      message: "Install the 'Obsidian-like Dataview' extension to open databases with a query source.",
    };
  }

  let api: ObsidianlikeDataviewApi;
  try {
    api = ext.isActive ? ext.exports : await ext.activate();
  } catch (err) {
    return {
      ok: false,
      reason: "not-activated",
      message: `Failed to activate 'Obsidian-like Dataview': ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const result = api.runQuery(`LIST ${queryFilter}`);
  if (result.type === "ERROR") {
    return { ok: false, reason: "query-error", message: result.message };
  }
  if (result.type !== "LIST") {
    return { ok: false, reason: "query-error", message: `Unexpected query result type: ${result.type}` };
  }

  const files = result.rows
    .map((row) => row.link?.path)
    .filter((p): p is string => Boolean(p))
    .map((relPath) => path.join(workspaceRoot, relPath));

  return { ok: true, files };
}
