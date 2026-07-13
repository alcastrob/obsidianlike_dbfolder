import React, { useCallback, useEffect, useMemo, useState } from "react";
import { DatabaseSnapshot, RowData, ViewDef } from "../core/types";
import { applyFilters, applySorts } from "../core/query";
import { onMessage, post } from "./vscodeApi";
import { Toolbar } from "./components/Toolbar";
import { TableView } from "./components/TableView";
import { BoardView } from "./components/BoardView";
import { ListView } from "./components/ListView";
import { GalleryView } from "./components/GalleryView";

export function App(): JSX.Element {
  const [snapshot, setSnapshot] = useState<DatabaseSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const off = onMessage((msg) => {
      if (msg.type === "init" || msg.type === "snapshot") {
        setSnapshot(msg.snapshot);
        setError(null);
      } else if (msg.type === "error") {
        setError(msg.message);
      }
    });
    post({ type: "ready" });
    return off;
  }, []);

  const activeView: ViewDef | undefined = useMemo(() => {
    if (!snapshot) return undefined;
    return (
      snapshot.config.views.find((v) => v.id === snapshot.config.activeViewId) ??
      snapshot.config.views[0]
    );
  }, [snapshot]);

  const visibleRows: RowData[] = useMemo(() => {
    if (!snapshot || !activeView) return [];
    const filtered = applyFilters(snapshot.rows, activeView.filters);
    return applySorts(filtered, activeView.sorts);
  }, [snapshot, activeView]);

  const setActiveViewId = useCallback((viewId: string) => {
    post({ type: "setActiveView", viewId });
  }, []);

  if (error) {
    return <div className="db-error">Error: {error}</div>;
  }
  if (!snapshot || !activeView) {
    return <div className="db-loading">Loading database…</div>;
  }

  const columns = activeView.columnOrder
    .map((key) => snapshot.config.columns.find((c) => c.key === key))
    .filter((c): c is NonNullable<typeof c> => Boolean(c) && !c!.hidden);

  return (
    <div className="db-root">
      <Toolbar
        snapshot={snapshot}
        activeView={activeView}
        onSetActiveView={setActiveViewId}
      />
      {activeView.type === "table" && (
        <TableView snapshot={snapshot} view={activeView} columns={columns} rows={visibleRows} />
      )}
      {activeView.type === "board" && (
        <BoardView snapshot={snapshot} view={activeView} columns={columns} rows={visibleRows} />
      )}
      {activeView.type === "list" && (
        <ListView snapshot={snapshot} view={activeView} columns={columns} rows={visibleRows} />
      )}
      {activeView.type === "gallery" && (
        <GalleryView snapshot={snapshot} view={activeView} columns={columns} rows={visibleRows} />
      )}
    </div>
  );
}
