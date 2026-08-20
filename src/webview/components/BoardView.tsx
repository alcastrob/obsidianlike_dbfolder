import React from "react";
import { groupBy } from "../../core/query";
import { parseWholeWikilink } from "../../core/wikilinks";
import { post } from "../vscodeApi";
import { Wikilink, renderWithWikilinks } from "./Wikilink";
import { ViewComponentProps } from "./ViewProps";

/** Renders a card property value, turning [[wikilink]] syntax into clickable links —
 *  a whole array item that's nothing but a link renders as one (matching the tag-chip
 *  treatment in PropertyCell), everything else goes through the free-text wikilink scan. */
function renderPropValue(v: unknown): React.ReactNode {
  if (Array.isArray(v)) {
    return v.map((item, i) => {
      const str = String(item);
      const link = parseWholeWikilink(str);
      return (
        <React.Fragment key={i}>
          {i > 0 && ", "}
          {link ? <Wikilink target={link.target} label={link.label} /> : str}
        </React.Fragment>
      );
    });
  }
  return renderWithWikilinks(String(v));
}

export function BoardView({ snapshot, view, columns, rows }: ViewComponentProps): JSX.Element {
  const groupColumn = snapshot.config.columns.find((c) => c.key === view.groupByColumnKey);

  if (!groupColumn) {
    return (
      <div className="empty-state">
        Choose a "select" property to group by from the view settings (⚙) to use the board.
      </div>
    );
  }

  const groups = groupBy(rows, groupColumn.key);
  const orderedKeys = [
    ...(groupColumn.options ?? []).map((o) => o.value).filter((v) => groups.has(v)),
    ...Array.from(groups.keys()).filter(
      (k) => k !== "(empty)" && !(groupColumn.options ?? []).some((o) => o.value === k)
    ),
    ...(groups.has("(empty)") ? ["(empty)"] : []),
  ];

  const cardColumns = columns.filter((c) => c.key !== groupColumn.key).slice(0, 4);

  const colorFor = (key: string) => groupColumn.options?.find((o) => o.value === key)?.color;

  const onDrop = (targetKey: string, filePath: string) => {
    const value = groupColumn.type === "multiSelect" ? [targetKey] : targetKey === "(empty)" ? undefined : targetKey;
    post({ type: "updateCell", filePath, columnKey: groupColumn.key, value });
  };

  return (
    <div className="board-scroll">
      {orderedKeys.map((key) => (
        <div
          key={key}
          className="board-column"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onDrop(key, e.dataTransfer.getData("text/plain"))}
        >
          <div className="board-column-header">
            <span className="tag-chip" style={{ background: colorFor(key) }}>
              {key}
            </span>
            <span className="board-count">{groups.get(key)?.length ?? 0}</span>
          </div>
          <div className="board-cards">
            {(groups.get(key) ?? []).map((row) => (
              <div
                key={row.filePath}
                className="board-card"
                draggable
                onDragStart={(e) => e.dataTransfer.setData("text/plain", row.filePath)}
                onClick={() => post({ type: "openRow", filePath: row.filePath })}
              >
                <div className="board-card-title">{row.fileName}</div>
                {cardColumns.map((c) => {
                  const v = row.values[c.key];
                  if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return null;
                  return (
                    <div key={c.key} className="board-card-prop">
                      <span className="board-card-prop-label">{c.label}:</span>{" "}
                      {renderPropValue(v)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
