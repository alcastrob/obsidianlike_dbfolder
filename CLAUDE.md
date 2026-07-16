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

### Sibling extensions

This repo is one of several `angelCastro.obsidianlike-*` extensions sharing a build/install flow driven by `c:\git\obsidianlike\make.bat` and a common icon (`media/obsidian-icon-violeta.png`) and publisher id. `angelCastro.obsidianlike-dataview` is a runtime dependency for query-mode databases (see above); `angelCastro.obsidian-like` (the WYSIWYG markdown editor) is not directly depended on but frequently coexists in the same profile, which is why the tab-management logic above has to be defensive about other extensions' editors for `*.md`.
