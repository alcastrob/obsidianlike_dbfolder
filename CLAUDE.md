# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run check-types   # tsc --noEmit; run this before considering any change done
npm run compile       # node esbuild.js — builds dist/extension.js + dist/webview.js (unminified, dev)
npm run watch         # same, in watch mode
npm run package       # compile + vsce package --allow-missing-repository -> obsidianlike-dbfolder-0.1.0.vsix
```

There is no test suite and no lint script — `check-types` is the only automated check. Prefer writing a throwaway `scratch-*.ts` script at the repo root and running it with `npx tsx scratch-*.ts` to verify core-layer logic (parsing, filters, CSV, etc.) in isolation before wiring it into the extension host or webview; delete the script afterward. `src/core/**` has no `vscode` dependency, so it's the part that's actually testable this way.

**Reinstalling to actually test a change**: pressing F5 launches an Extension Development Host, but the user's real day-to-day testing happens in the "Obsidian like" VS Code profile, which has this extension *installed* (not running in dev mode). A dev host reload does not affect that installed copy. After `npm run package`, reinstall with:

```bash
code --profile "Obsidian like" --install-extension obsidianlike-dbfolder-0.1.0.vsix --force
```

`--force` is required — VS Code will not reinstall an unchanged version number otherwise. The user then needs "Developer: Reload Window" in that profile's window.

## Architecture

Two bundle entry points built by `esbuild.js`: the extension host (`src/extension.ts`, Node/CommonJS) and the webview UI (`src/webview/index.tsx`, React, browser IIFE). They only share code from `src/core/**`, which must stay dependency-free of both `vscode` and DOM APIs so it can run in either context (and in plain Node for scratch tests).

### Two ways a database gets opened, one shared implementation

This extension supports both of dbfolder's real modes, and both funnel through the same message-handling code:

- **Folder-backed**: right-click a folder → `DbFolderPanel` (`src/dbFolderPanel.ts`), a plain `WebviewPanel`. Config lives in a `.dbfolder.json` file inside that folder (`src/core/configStore.ts`).
- **Note-backed**: a `.md` file containing a fenced ` ```yaml:dbfolder ` block (the real Obsidian plugin's own format) is auto-detected and opened via `NoteDatabaseHost` (`src/databaseNoteEditor.ts`), a `CustomTextEditorProvider` registered as `mdDbFolder.databaseNoteEditor`. Config lives inside that block, parsed/serialized by `src/core/legacyDbFolder.ts`, which maps the real plugin's schema (`columns`, `config.source_data`/`source_destination_path`/`source_form_result`/`current_row_template`, etc.) to/from this extension's internal model. Our own extra state (views/filters/sorts not representable in the original schema) is stashed under a `vscodeDbFolder` key that the real plugin just ignores, so notes stay interoperable both ways.

Both hosts extend the abstract `DatabaseHost` class (`src/databaseHost.ts`), which owns the entire `WebviewToHostMessage` switch statement, snapshot building, and HTML shell (`buildWebviewHtml`). Subclasses only implement a handful of hooks (`getRowCreationFolder`, `resolveRows`, `persistConfig`, `getSourceInfo`, `updateDatabaseSource`, `getNewRowDefaults`, `getNewRowTemplate`, `openRawSource`) — when adding a new capability that both hosts need, add it to the base class switch; when it only makes sense for one mode (e.g. anything source/query-related), add a virtual hook with a no-op default.

### Auto-switching a database note away from raw text

`src/extension.ts` listens on `vscode.window.tabGroups.onDidChangeTabs`, **not** `onDidOpenTextDocument` — the latter only fires the first time a document loads into memory, so a second Explorer click on an already-open database note (which opens a fresh preview tab without creating a new `TextDocument`) would never get redirected. The tab-open handler also closes whatever *other* tab is left open for the same URI (a race with VS Code's own default-open flow, or with another extension's default editor for `*.md`).

The "view raw markdown source" action (toolbar button and `mdDbFolder.openNoteSource` command) has to defeat this same auto-switch, since it deliberately opens the note with the default editor. `src/rawViewState.ts` is a tiny suppression registry: the raw-open action marks the URI before calling `vscode.openWith`, the tab handler skips its redirect logic for marked URIs, and the mark clears when that tab closes.

### Query-mode row resolution

A note-backed database with `source_data: query` doesn't scan a folder — `src/dataviewBridge.ts` calls the sibling extension `angelCastro.obsidianlike-dataview`'s exported API (`vscode.extensions.getExtension(...).exports.runQuery(...)`, prefixed with `LIST` since only file identity is needed) to resolve which files match the `FROM ... WHERE ...` filter, then feeds those paths through the same row-building code (`src/core/scanner.ts`'s `buildRowsFromFiles`) used by folder mode. If that extension isn't installed/active, this fails with a clear error rather than silently returning nothing.

The query's `WHERE` clause defines row *membership*, re-evaluated on every refresh — the webview's own filters (see below) can only narrow that set further, never restore a row the query excluded. `src/core/queryHints.ts` does best-effort extraction of simple AND-joined equality conjuncts (`key = "literal"`) from the `WHERE` text to pre-fill new rows so they're more likely to already satisfy the query; it is not a real parser and deliberately ignores `OR`, function calls like `contains()`, and dotted paths like `file.folder`.

### Query-mode new rows can lag behind the dataview index

A freshly-created row (`+ New`) in a query-mode database is written to disk synchronously, but `resolveQueryFiles` (`src/dataviewBridge.ts`) depends on the sibling `angelCastro.obsidianlike-dataview` extension's own file index, which can take a moment to notice the new file — the row would otherwise be silently absent from the table until a later refresh (or a full close/reopen, once the sibling extension's index has caught up on its own). `NoteDatabaseHost` (`src/databaseNoteEditor.ts`) bridges this gap: `onRowCreated()` remembers the path it just wrote in `pendingQueryRows`, and `withPendingQueryRows()` force-includes any still-pending path that's missing from a query result, dropping it again once the query naturally includes it (index caught up) or the file is gone. This only matters for query-mode; folder-mode rescans the directory directly on every snapshot, so a new file is always picked up immediately.

### Filters are a tree, not a list

`ViewDef.filters` is a `FilterGroup` (nested AND/OR groups of conditions, `src/core/query.ts`), matching the real plugin's filter UI. Views persisted before this existed (both in `.dbfolder.json` and in a note's `vscodeDbFolder.views`) may still have the old flat array shape on disk; `normalizeFilterGroup()` migrates on every load path — call it (or go through `configStore.loadConfig`/`legacyDbFolder.legacyToInternalConfig`, which already do) rather than trusting a loaded view's `filters` field to be well-formed.

`toComparable()` in the same file treats the strings `"true"`/`"false"` as equivalent to real booleans, because filter condition values always arrive as strings from a text input while a checkbox cell's actual value is a boolean — without that normalization a boolean-equality filter can never match anything.

### Frontmatter/YAML gotchas already handled — don't regress them

- `js-yaml` auto-parses unquoted `YYYY-MM-DD`-looking scalars into `Date` objects; `core/propertyTypes.ts`'s `normalizeRawValue()` converts them back to ISO strings before type inference or formula evaluation ever see them.
- Real Obsidian-authored ` ```yaml:dbfolder ` blocks have been observed with trailing whitespace after the fence marker (Obsidian's hard-linebreak convention) and with U+00A0 (non-breaking space) as YAML indentation instead of regular spaces — both are normalized in `core/legacyDbFolder.ts` before the block is matched/parsed.
- Frontmatter parsing (`gray-matter`) and the note's own `yaml:dbfolder` block (`js-yaml` directly) both go through the *safe* loader — this was a deliberate security-audit finding (see README's Seguridad section); do not switch either to an unsafe `load`/`dump`.

### Vault-wide settings

`mdDbFolder.configureVaultSettings` opens a hand-built HTML form (`src/globalSettingsPanel.ts`, no React — it's simple enough not to need the webview bundle) that reads/writes `.obsidian/plugins/dbfolder/data.json` directly (`src/core/globalSettings.ts`), the same file the real Obsidian plugin uses. Writes are merge-writes onto whatever's already on disk so fields this extension doesn't understand survive. Several fields are stored for file-format compatibility only and have no effect here yet (pagination, plugin's own font size, folder auto-organization by column value, inline-field syntax, JS formulas) — those are annotated with a description in the field's `SECTIONS` entry rather than silently doing nothing.

### Webview shell

`src/webview/App.tsx` owns the `DatabaseSnapshot` state and applies the active view's filters/sort (`core/query.ts`) before handing rows to whichever view component renders (`TableView`/`BoardView`/`ListView`/`GalleryView`). `Toolbar.tsx` + `ToolbarMenus.tsx` hold all the menu popovers (Columns, Filter, Sort, view settings incl. database source/meta editing). `PropertyCell.tsx` is the single place that knows how to render and inline-edit a cell for each `PropertyType`. All webview→host communication goes through `post()`/`onMessage()` in `vscodeApi.ts`, typed by the `WebviewToHostMessage`/`HostToWebviewMessage` unions in `core/types.ts` — extend those unions first when adding a feature that needs new wire traffic.

`core/wikilinks.ts` parses Obsidian-style `[[target]]`/`[[target|alias]]`/`[[target#heading]]` syntax out of a cell's raw string value; `PropertyCell.tsx` uses it to render clickable links inline within text cells and within individual multiSelect/tags chips (there's no dedicated "link" `PropertyType` — this works on top of `text`/`multiSelect`/`tags` values that happen to contain the syntax). Clicking a link posts `openWikilink` (`{ target }`), which `DatabaseHost.openWikilink()` (`src/databaseHost.ts`) resolves by searching every `.md` file in the workspace for a matching relative path or unique basename — same-name ambiguity is resolved with a quick pick, same as Obsidian's own link resolution.

### Column visibility vs. deletion, and the reorder drag handle

`ColumnDef.hidden` (`core/types.ts`) toggles a column out of the active render without deleting it — `App.tsx`'s `columns` derivation filters `!c.hidden` after mapping `activeView.columnOrder`, and `ColumnsMenu` (`ToolbarMenus.tsx`) exposes it as a 👁/🚫 toggle (`updateColumn`) separate from the ✕ button, which stays wired to the destructive `deleteColumn`. Don't collapse those back into one button — a bare ✕ that deletes outright, with no way to temporarily hide a column, is the bug this fixed.

`TableView.tsx`'s column-reorder drag-and-drop posts `reorderColumns` on drop. The drag source can't be the `<th>` itself when it also contains the rename `<input>`: browsers give a focused/clickable form control priority over an ancestor's `draggable`, so a drag gesture started on or over the input gets swallowed as text selection instead of a native `dragstart` — in practice this made reordering nearly impossible to trigger. The fix is a dedicated `.col-drag-handle` (`⋮⋮`) element that alone carries `draggable`, sitting next to (not wrapping) the input.

`ColumnDef.hidden` and `ViewDef.columnOrder` are both necessary but not sufficient for "which columns does this view show" — `hidden` is global (every view loses the column) and `columnOrder` is kept in sync with the full column set by `syncViewColumnOrders` (`core/configStore.ts`), which appends any newly-discovered key to *every* view's `columnOrder`, so a view can't drop a column just by leaving it out. `ViewDef.hiddenColumnKeys` (`core/types.ts`) is the third, per-view piece, but it is **not** simply AND-ed with `hidden` — that was tried first and immediately reproduced the bug it was meant to fix: showing a column in one view by flipping the only working control at the time (the global 👁/🚫 toggle) made it appear in every other view too. Instead `isColumnVisibleInView()`/`toggleColumnVisibilityInView()` (`core/query.ts`) implement a one-way "graduation": a view with `hiddenColumnKeys === undefined` still falls back to the global `hidden` flag, but the moment its `hiddenColumnKeys` is set (first checkbox toggle in `ColumnsMenu`, `ToolbarMenus.tsx` — which seeds it from the *current* global-hidden set so nothing visibly jumps), that view's own list becomes the sole source of truth for it, permanently immune to later global 👁/🚫 changes for the columns it has an opinion on. `ColumnsMenu` exposes both controls per row: a checkbox (per-view, via the two functions above) and the 👁/🚫 button (global, only meaningful to views that haven't graduated) — don't merge them or re-introduce the AND.

### Deleting a column strips the frontmatter key too, with a confirmation dialog first

Early on, `deleteColumn` only removed the entry from `config.columns` — the frontmatter key stayed on disk in every note, so the very next `resolveRows()` (folder-scan or query-mode, both go through `core/scanner.ts`'s `buildRowsFromFiles`, which auto-discovers any frontmatter key not already in `columns`) silently re-added it as a "new" column, appended at the end of the list. From the user's perspective the property they just deleted "wouldn't delete" — it just came back.

`DatabaseHost.handleMessage`'s `"deleteColumn"` case (`src/databaseHost.ts`) now resolves the rows currently shown (`this.resolveRows(this.config)` — folder scan or query result, whichever this database uses) *before* calling `removeColumn`, and calls `writeFrontmatter(row.filePath, { [columnKey]: undefined })` (deletes the key — `writeFrontmatter` already treated `undefined` as delete) on each one, tolerating a per-row write failure without aborting the rest. Computed types (`formula`, `createdTime`, `modifiedTime`, `filePath`) are skipped — they're never persisted to frontmatter in the first place (same set of types the CSV-import path and the `updateCell` formula guard already special-case), so stripping them would just rewrite every file's frontmatter for nothing.

Because this is destructive and touches every visible document, `ColumnsMenu` (`ToolbarMenus.tsx`) no longer posts `deleteColumn` straight from the ✕ button — it opens `ConfirmDialog.tsx` first and only posts on explicit confirm. That component deliberately doesn't use `window.confirm()`: VS Code Web serves the webview from a sandboxed iframe without `allow-modals`, where `window.confirm()` silently no-ops instead of blocking, so desktop and web would behave differently. It's a plain in-page modal (`position: fixed` overlay, own `pendingDelete` state in `ColumnsMenu` so it survives the Columns popover itself closing via `onMouseLeave` if the cursor crosses it on the way to the dialog).

### Settings popovers don't discard unsaved edits on mouse-leave

`ViewSettingsMenu`'s popover (`ToolbarMenus.tsx`) closes on `onMouseLeave` like the other toolbar popovers, but it embeds two sections (`DatabaseMetaSection`, `DatabaseSourceSection`) that use a local-edit-then-explicit-Save pattern (their own `dirty` state, only posting on an explicit "Save" click) — unmounting on an accidental mouse-leave would silently drop whatever wasn't saved yet. Both sections report their `dirty` flag up via an `onDirtyChange` prop; `ViewSettingsMenu` only calls `close()` from `onMouseLeave` when neither is dirty, and shows an "Unsaved changes" hint otherwise. Any new section added to that popover with the same local-state-then-Save shape needs to wire into this the same way, not just add its own isolated `dirty` state.

### Query validation before saving a query-mode source

Saving a bad `WHERE` clause used to fail silently or break the database. `DatabaseSourceSection` posts `validateQuery` (round-trips through `DatabaseHost.validateQuery()`, overridden in `NoteDatabaseHost` to actually call `resolveQueryFiles`) on blur and before a query-mode save; the base class's no-op default returns `{ ok: true }` since folder-backed panels never expose this UI. The "Save source" button stays disabled while a check is in flight or the last one failed, and `save()` itself re-validates rather than trusting stale `disabled` state, since a fast click can beat the async round-trip that a `blur` kicked off — see the `pendingSaveRef`/`validatedQuery` dance in that component if you touch it.

That webview-side gate is a UX nicety, not the actual guarantee — it's reachable state, not an invariant the host can trust every `updateDatabaseSource` message to have gone through. `NoteDatabaseHost.updateDatabaseSource()` (`src/databaseNoteEditor.ts`) re-validates a query-mode source itself before calling `applyRawEdit`, throwing (caught by the base class's `handleMessage` try/catch, surfaced as a normal `{type:"error"}` toast) instead of persisting. This matters because once an invalid query *is* written into the `yaml:dbfolder` block, every later `resolveRows()` — including the very next `"ready"` on reopen — throws on that same query, permanently wedging the database until someone hand-edits the raw YAML; the host-side check is what actually prevents that, not the disabled button.

The actual bug that let this happen in practice, though, was upstream of both guards: `resolveQueryFiles()` (`src/dataviewBridge.ts`) called the sibling `angelCastro.obsidianlike-dataview` extension's `api.runQuery()` *outside* any try/catch, trusting it to report a malformed query as a `{type:"ERROR"}` result the way its type signature promises. A syntactically bad query instead made it throw a plain JS exception, which — being unhandled — turned every caller (the "validateQuery" round-trip *and* the save-time check above) into a rejected promise. That skipped the intended `{type:"queryValidation", ok:false}` response entirely and fell through to `handleMessage`'s outer catch, which posts a raw `{type:"error"}` — and `App.tsx` treats *any* `"error"` message as fatal, tearing down the whole toolbar/settings popover in favor of a bare error string with no way back except reloading the tab. So the inline "invalid query" message the two guards above were built to show never actually appeared; the very first keystroke past valid syntax, followed by anything that triggered a blur (clicking "Save source" included), crashed the view. `resolveQueryFiles()` now wraps the `runQuery()` call and folds a thrown exception into the same `{ok:false, reason:"query-error"}` shape as a normal `ERROR` result — don't remove that try/catch on the assumption the sibling extension's query engine always fails gracefully; nothing here can verify that from this side.

### Sibling extensions

This repo is one of several `angelCastro.obsidianlike-*` extensions sharing a build/install flow driven by `c:\git\obsidianlike\make.bat` and a common icon (`media/obsidian-icon-violeta.png`) and publisher id. `angelCastro.obsidianlike-dataview` is a runtime dependency for query-mode databases (see above); `angelCastro.obsidian-like` (the WYSIWYG markdown editor) is not directly depended on but frequently coexists in the same profile, which is why the tab-management logic above has to be defensive about other extensions' editors for `*.md`.
