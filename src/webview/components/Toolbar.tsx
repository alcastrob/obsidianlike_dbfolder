import React, { useState } from "react";
import { ColumnDef, DatabaseSnapshot, RowData, ViewDef, ViewType } from "../../core/types";
import { emptyFilterGroup } from "../../core/query";
import { post } from "../vscodeApi";
import { ColumnsMenu, FilterMenu, SortMenu, ViewSettingsMenu } from "./ToolbarMenus";

const VIEW_ICONS: Record<ViewType, string> = {
  table: "▦",
  board: "▤",
  list: "☰",
  gallery: "▢",
};

function makeView(type: ViewType, columnOrder: string[]): ViewDef {
  return {
    id: `${type}-${Date.now()}`,
    name: type[0].toUpperCase() + type.slice(1),
    type,
    columnOrder,
    filters: emptyFilterGroup(),
    sorts: [],
  };
}

export function Toolbar({
  snapshot,
  activeView,
  onSetActiveView,
  visibleColumns,
  visibleRows,
}: {
  snapshot: DatabaseSnapshot;
  activeView: ViewDef;
  onSetActiveView: (id: string) => void;
  visibleColumns: ColumnDef[];
  visibleRows: RowData[];
}): JSX.Element {
  const [addingView, setAddingView] = useState(false);
  const [newRowName, setNewRowName] = useState("");

  const addView = (type: ViewType) => {
    post({ type: "addView", view: makeView(type, snapshot.config.columns.map((c) => c.key)) });
    setAddingView(false);
  };

  const submitNewRow = () => {
    const name = newRowName.trim();
    if (!name) return;
    post({ type: "addRow", fileName: name });
    setNewRowName("");
  };

  return (
    <div className="db-toolbar">
      <div className="view-tabs">
        {snapshot.config.views.map((v) => (
          <button
            key={v.id}
            className={"view-tab" + (v.id === activeView.id ? " active" : "")}
            onClick={() => onSetActiveView(v.id)}
          >
            <span className="view-icon">{VIEW_ICONS[v.type]}</span> {v.name}
          </button>
        ))}
        <div className="view-tab-add">
          <button onClick={() => setAddingView((s) => !s)}>+</button>
          {addingView && (
            <div className="popover">
              {(["table", "board", "list", "gallery"] as ViewType[]).map((t) => (
                <button key={t} onClick={() => addView(t)}>
                  {VIEW_ICONS[t]} {t}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="toolbar-actions">
        <div className="new-row-input">
          <input
            placeholder="New note name…"
            value={newRowName}
            onChange={(e) => setNewRowName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitNewRow()}
          />
          <button onClick={submitNewRow}>+ New</button>
        </div>
        <ColumnsMenu snapshot={snapshot} />
        <FilterMenu snapshot={snapshot} view={activeView} />
        <SortMenu snapshot={snapshot} view={activeView} />
        <ViewSettingsMenu snapshot={snapshot} view={activeView} />
        <button
          title="Export the current view's rows to CSV"
          onClick={() => post({ type: "exportCsv", columns: visibleColumns, rows: visibleRows })}
        >
          ↓ CSV
        </button>
        <button title="Import rows from a CSV file" onClick={() => post({ type: "importCsv" })}>
          ↑ CSV
        </button>
        {snapshot.sourceInfo && (
          <button title="View this database's note as plain markdown source" onClick={() => post({ type: "openRawSource" })}>
            📄
          </button>
        )}
        <button title="Refresh" onClick={() => post({ type: "refresh" })}>
          ⟳
        </button>
      </div>
    </div>
  );
}
