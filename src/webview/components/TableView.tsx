import React, { useState } from "react";
import { post } from "../vscodeApi";
import { PropertyCell } from "./PropertyCell";
import { ViewComponentProps } from "./ViewProps";

export function TableView({ snapshot, view, columns, rows }: ViewComponentProps): JSX.Element {
  const [dragKey, setDragKey] = useState<string | null>(null);

  const reorder = (targetKey: string) => {
    if (!dragKey || dragKey === targetKey) return;
    const order = view.columnOrder.filter((k) => k !== dragKey);
    const idx = order.indexOf(targetKey);
    order.splice(idx, 0, dragKey);
    post({ type: "reorderColumns", columnOrder: order });
    setDragKey(null);
  };

  const renameColumn = (columnKey: string, label: string) => {
    const col = snapshot.config.columns.find((c) => c.key === columnKey);
    if (!col || !label.trim() || label === col.label) return;
    post({ type: "updateColumn", column: { ...col, label } });
  };

  const cellSizeClass = `cell-${snapshot.config.cellSize ?? "normal"}`;
  const tableClassName = ["db-table", cellSizeClass, snapshot.config.stickyFirstColumn ? "sticky-first-col" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="table-scroll">
      <table className={tableClassName}>
        <thead>
          <tr>
            <th className="row-handle-col" />
            {columns.map((col) => (
              <th
                key={col.key}
                draggable
                onDragStart={() => setDragKey(col.key)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => reorder(col.key)}
              >
                <input
                  className="col-header-input"
                  defaultValue={col.label}
                  onBlur={(e) => renameColumn(col.key, e.target.value)}
                />
                <span className="col-type-badge">{col.type}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.filePath}>
              <td className="row-handle-col">
                <button className="icon-btn" title="Open note" onClick={() => post({ type: "openRow", filePath: row.filePath })}>
                  ↗
                </button>
                <button
                  className="icon-btn"
                  title="Delete note"
                  onClick={() => post({ type: "deleteRow", filePath: row.filePath })}
                >
                  🗑
                </button>
              </td>
              {columns.map((col) => (
                <td key={col.key}>
                  <PropertyCell column={col} row={row} />
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + 1} className="empty-state">
                No notes match this view.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
