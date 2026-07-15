import React, { useState } from "react";
import { ColumnDef, RowData } from "../../core/types";
import { post } from "../vscodeApi";

const READ_ONLY_TYPES = new Set(["formula", "createdTime", "modifiedTime", "filePath"]);

function formatDisplay(column: ColumnDef, value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (Array.isArray(value)) return value.join(", ");
  if (column.type === "checkbox") return value ? "✓" : "";
  if ((column.type === "createdTime" || column.type === "modifiedTime" || column.type === "date") && typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toLocaleString();
  }
  return String(value);
}

function optionColor(column: ColumnDef, value: string): string | undefined {
  return column.options?.find((o) => o.value === value)?.color;
}

export function PropertyCell({
  column,
  row,
}: {
  column: ColumnDef;
  row: RowData;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const value = row.values[column.key];
  const readOnly = READ_ONLY_TYPES.has(column.type);

  const commit = (newValue: unknown) => {
    post({ type: "updateCell", filePath: row.filePath, columnKey: column.key, value: newValue });
    setEditing(false);
  };

  if (column.type === "checkbox") {
    return (
      <input
        type="checkbox"
        checked={Boolean(value)}
        onChange={(e) => commit(e.target.checked)}
      />
    );
  }

  if (column.type === "filePath") {
    return (
      <span
        className="cell-readonly cell-filelink"
        title={row.filePath}
        onClick={() => post({ type: "openRow", filePath: row.filePath })}
      >
        {formatDisplay(column, value) || row.fileName}
      </span>
    );
  }

  if (readOnly) {
    return <span className="cell-readonly">{formatDisplay(column, value)}</span>;
  }

  if (!editing) {
    if (column.type === "select" || column.type === "multiSelect" || column.type === "tags") {
      const values = Array.isArray(value) ? value : value ? [value] : [];
      return (
        <div className="cell-tags" onClick={() => setEditing(true)}>
          {values.length === 0 && <span className="cell-empty">Empty</span>}
          {values.map((v) => (
            <span key={String(v)} className="tag-chip" style={{ background: optionColor(column, String(v)) }}>
              {String(v)}
            </span>
          ))}
        </div>
      );
    }
    return (
      <div className="cell-text" onClick={() => setEditing(true)}>
        {formatDisplay(column, value) || <span className="cell-empty">Empty</span>}
      </div>
    );
  }

  if (column.type === "date") {
    return (
      <input
        type="date"
        autoFocus
        defaultValue={typeof value === "string" ? value.slice(0, 10) : ""}
        onBlur={(e) => commit(e.target.value || undefined)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    );
  }

  if (column.type === "number") {
    return (
      <input
        type="number"
        autoFocus
        defaultValue={typeof value === "number" ? value : ""}
        onBlur={(e) => commit(e.target.value === "" ? undefined : Number(e.target.value))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    );
  }

  if (column.type === "select") {
    return (
      <select
        autoFocus
        defaultValue={typeof value === "string" ? value : ""}
        onBlur={() => setEditing(false)}
        onChange={(e) => commit(e.target.value || undefined)}
      >
        <option value="" />
        {(column.options ?? []).map((o) => (
          <option key={o.value} value={o.value}>
            {o.value}
          </option>
        ))}
      </select>
    );
  }

  if (column.type === "multiSelect" || column.type === "tags") {
    const values = new Set(Array.isArray(value) ? value.map(String) : []);
    return (
      <div className="cell-multiselect-editor" onMouseLeave={() => setEditing(false)}>
        {(column.options ?? []).map((o) => (
          <label key={o.value} className="multiselect-option">
            <input
              type="checkbox"
              checked={values.has(o.value)}
              onChange={(e) => {
                const next = new Set(values);
                if (e.target.checked) next.add(o.value);
                else next.delete(o.value);
                commit(Array.from(next));
                setEditing(true);
              }}
            />
            <span className="tag-chip" style={{ background: o.color }}>
              {o.value}
            </span>
          </label>
        ))}
      </div>
    );
  }

  return (
    <input
      type="text"
      autoFocus
      defaultValue={typeof value === "string" ? value : ""}
      onBlur={(e) => commit(e.target.value || undefined)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
    />
  );
}
