import React from "react";
import { post } from "../vscodeApi";
import { ColumnDef, RowData } from "../../core/types";
import { resolveCoverText } from "../../core/coverValue";
import { parseWholeWikilink } from "../../core/wikilinks";
import { isBlankPropValue, renderPropValue } from "./Wikilink";
import { ViewComponentProps } from "./ViewProps";

// A cover value renders one of three ways:
// - a [[wikilink]]/![[embed]] to an image the host could resolve within the workspace:
//   row.coverImageUri is already a webview-loadable URI (DatabaseHost.resolveCoverImages)
//   - the webview has no filesystem access to do that resolution itself.
// - a bare http(s) URL to an image file: loaded directly: the CSP's img-src allows https:
//   for exactly this.
// - anything else: shown as plain text instead of the gray-letter fallback.
const IMAGE_URL_RE = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg|bmp)(\?\S*)?$/i;

/** Plain-text fallback for a cover value that looks like a wikilink but the host
 *  couldn't resolve to an image (missing file, ambiguous, not an image extension,
 *  ...) - shows the link's label/target rather than raw `[[...]]` syntax. */
function displayText(text: string): string {
  const withoutBang = text.startsWith("!") ? text.slice(1) : text;
  const link = parseWholeWikilink(withoutBang);
  return link ? link.label : text;
}

function renderCover(row: RowData, coverColumn: ColumnDef | undefined): JSX.Element {
  const fallback = <span className="gallery-cover-fallback">{row.fileName.charAt(0).toUpperCase()}</span>;
  if (!coverColumn) return fallback;
  if (row.coverImageUri) return <img src={row.coverImageUri} alt="" />;

  const text = resolveCoverText(row.values[coverColumn.key]);
  if (!text) return fallback;
  if (IMAGE_URL_RE.test(text)) return <img src={text} alt="" />;
  return <span className="gallery-cover-text">{displayText(text)}</span>;
}

export function GalleryView({ snapshot, view, columns, rows }: ViewComponentProps): JSX.Element {
  const coverColumn = snapshot.config.columns.find((c) => c.key === view.coverColumnKey);
  const cardColumns = columns.filter((c) => c.key !== coverColumn?.key).slice(0, 5);

  return (
    <div className="gallery-grid">
      {rows.map((row) => {
        return (
          <div key={row.filePath} className="gallery-card" onClick={() => post({ type: "openRow", filePath: row.filePath })}>
            <div className="gallery-cover">{renderCover(row, coverColumn)}</div>
            <div className="gallery-title">{row.fileName}</div>
            <div className="gallery-props">
              {cardColumns.map((c) => {
                const v = row.values[c.key];
                if (isBlankPropValue(v)) return null;
                return (
                  <div key={c.key} className="gallery-prop">
                    <span className="gallery-prop-label">{c.label}:</span> {renderPropValue(v)}
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
