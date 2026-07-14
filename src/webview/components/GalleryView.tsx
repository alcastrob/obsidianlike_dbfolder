import React from "react";
import { post } from "../vscodeApi";
import { ViewComponentProps } from "./ViewProps";

// Remote image loading is intentionally unsupported: the webview's CSP has no
// external img-src, so this view never fetches anything off the local machine.
export function GalleryView({ snapshot, view, columns, rows }: ViewComponentProps): JSX.Element {
  const coverColumn = snapshot.config.columns.find((c) => c.key === view.coverColumnKey);
  const cardColumns = columns.filter((c) => c.key !== coverColumn?.key).slice(0, 5);

  return (
    <div className="gallery-grid">
      {rows.map((row) => {
        return (
          <div key={row.filePath} className="gallery-card" onClick={() => post({ type: "openRow", filePath: row.filePath })}>
            <div className="gallery-cover">
              <span className="gallery-cover-fallback">{row.fileName.charAt(0).toUpperCase()}</span>
            </div>
            <div className="gallery-title">{row.fileName}</div>
            <div className="gallery-props">
              {cardColumns.map((c) => {
                const v = row.values[c.key];
                if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) return null;
                return (
                  <div key={c.key} className="gallery-prop">
                    <span className="gallery-prop-label">{c.label}:</span> {Array.isArray(v) ? v.join(", ") : String(v)}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {rows.length === 0 && <div className="empty-state">No notes match this view.</div>}
    </div>
  );
}
