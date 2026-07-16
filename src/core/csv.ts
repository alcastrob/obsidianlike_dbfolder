import { ColumnDef, RowData } from "./types";

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function cellToCsvText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(String).join("; ");
  return String(value);
}

export function toCsv(columns: ColumnDef[], rows: RowData[]): string {
  const header = columns.map((c) => csvEscape(c.label)).join(",");
  const lines = rows.map((row) =>
    columns.map((c) => csvEscape(cellToCsvText(row.values[c.key]))).join(",")
  );
  return [header, ...lines].join("\r\n") + "\r\n";
}

/** Parses CSV text (RFC 4180-ish: quoted fields, "" escapes a literal quote, CRLF or LF rows) into rows of raw strings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      endField();
      i++;
      continue;
    }
    if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
      i++;
      continue;
    }
    if (ch === "\n") {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length > 0 || row.length > 0) endRow();
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Converts parsed CSV rows (with a header row) into per-row objects keyed by header, coerced against known columns' types where possible. */
export function csvRowsToRecords(csvRows: string[][], columns: ColumnDef[]): Record<string, string>[] {
  if (csvRows.length === 0) return [];
  const [header, ...body] = csvRows;
  const columnByLabel = new Map(columns.map((c) => [c.label, c]));
  return body.map((cells) => {
    const record: Record<string, string> = {};
    header.forEach((label, idx) => {
      const key = columnByLabel.get(label)?.key ?? label;
      record[key] = cells[idx] ?? "";
    });
    return record;
  });
}
