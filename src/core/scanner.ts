import * as fs from "fs";
import * as path from "path";
import { readNote } from "./frontmatter";
import { buildColumnFromValue, mergeSelectOptions, normalizeRawValue } from "./propertyTypes";
import { syncViewColumnOrders } from "./configStore";
import { evaluateFormula } from "./formula";
import { DbFolderConfig, RowData } from "./types";

const RESERVED_KEYS = new Set(["$name", "$path", "$ctime", "$mtime"]);

function listMarkdownFiles(folderPath: string, recursive: boolean): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(folderPath, entry.name);
    if (entry.isDirectory()) {
      if (recursive) results.push(...listMarkdownFiles(full, recursive));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Scans the folder, updates `config.columns` in-place with any newly
 * discovered frontmatter properties/select-options, and returns the row data.
 * Mutates and returns a new config object (immutable-style) alongside the rows.
 */
export function scanFolder(
  folderPath: string,
  config: DbFolderConfig
): { config: DbFolderConfig; rows: RowData[] } {
  const files = listMarkdownFiles(folderPath, config.recursive);
  let columns = [...config.columns];
  const columnByKey = new Map(columns.map((c) => [c.key, c]));

  const rawRows: { filePath: string; fileName: string; data: Record<string, unknown> }[] = [];

  for (const filePath of files) {
    const { data: rawData } = readNote(filePath);
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawData)) {
      data[key] = normalizeRawValue(value);
    }
    const stat = fs.statSync(filePath);
    const fileName = path.basename(filePath, path.extname(filePath));

    for (const [key, value] of Object.entries(data)) {
      if (RESERVED_KEYS.has(key)) continue;
      const existing = columnByKey.get(key);
      if (!existing) {
        const col = buildColumnFromValue(key, value);
        columnByKey.set(key, col);
        columns.push(col);
      } else if (existing.type === "multiSelect" || existing.type === "select") {
        const discovered = Array.isArray(value) ? value.map(String) : [String(value)];
        existing.options = mergeSelectOptions(existing.options, discovered);
      }
    }

    rawRows.push({
      filePath,
      fileName,
      data: {
        ...data,
        $name: fileName,
        $path: filePath,
        $ctime: stat.birthtime.toISOString(),
        $mtime: stat.mtime.toISOString(),
      },
    });
  }

  const formulaColumns = columns.filter((c) => c.type === "formula" && c.formula);

  const rows: RowData[] = rawRows.map((r) => {
    const values: Record<string, unknown> = { ...r.data };
    for (const fc of formulaColumns) {
      values[fc.key] = evaluateFormula(fc.formula ?? "", values);
    }
    return { filePath: r.filePath, fileName: r.fileName, values };
  });

  return { config: syncViewColumnOrders({ ...config, columns }), rows };
}
