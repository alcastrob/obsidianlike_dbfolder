import React from "react";
import { post } from "../vscodeApi";
import { PropertyCell } from "./PropertyCell";
import { ViewComponentProps } from "./ViewProps";

export function ListView({ columns, rows }: ViewComponentProps): JSX.Element {
  return (
    <div className="list-scroll">
      {rows.map((row) => (
        <div key={row.filePath} className="list-row">
          <div className="list-row-title" onClick={() => post({ type: "openRow", filePath: row.filePath })}>
            {row.fileName}
          </div>
          <div className="list-row-props">
            {columns.map((col) => (
              <div key={col.key} className="list-row-prop">
                <span className="list-row-prop-label">{col.label}</span>
                <PropertyCell column={col} row={row} />
              </div>
            ))}
          </div>
          <button className="icon-btn" title="Delete note" onClick={() => post({ type: "deleteRow", filePath: row.filePath })}>
            🗑
          </button>
        </div>
      ))}
      {rows.length === 0 && <div className="empty-state">No notes match this view.</div>}
    </div>
  );
}
