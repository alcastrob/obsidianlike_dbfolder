import React, { useState } from "react";
import {
  ColumnDef,
  DatabaseSnapshot,
  FilterRule,
  PropertyType,
  SortRule,
  ViewDef,
} from "../../core/types";
import { post } from "../vscodeApi";

const TYPE_OPTIONS: PropertyType[] = [
  "text",
  "number",
  "checkbox",
  "date",
  "select",
  "multiSelect",
  "tags",
  "formula",
];

function useToggle(): [boolean, () => void, () => void] {
  const [open, setOpen] = useState(false);
  return [open, () => setOpen((s) => !s), () => setOpen(false)];
}

export function ColumnsMenu({ snapshot }: { snapshot: DatabaseSnapshot }): JSX.Element {
  const [open, toggle, close] = useToggle();
  const [name, setName] = useState("");
  const [type, setType] = useState<PropertyType>("text");
  const [options, setOptions] = useState("");

  const addColumn = () => {
    const key = name.trim();
    if (!key) return;
    const column: ColumnDef = { key, label: key, type };
    if (type === "select" || type === "multiSelect") {
      column.options = options
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((v) => ({ value: v, color: "#61afef" }));
    }
    if (type === "formula") column.formula = "concat($name)";
    post({ type: "addColumn", column });
    setName("");
    setOptions("");
  };

  return (
    <div className="menu-container">
      <button onClick={toggle}>Columns</button>
      {open && (
        <div className="popover wide" onMouseLeave={close}>
          <div className="menu-list">
            {snapshot.config.columns.map((col) => (
              <div key={col.key} className="menu-row">
                <span className="col-label">{col.label}</span>
                <span className="col-type">{col.type}</span>
                <button
                  className="icon-btn"
                  title="Delete column"
                  onClick={() => post({ type: "deleteColumn", columnKey: col.key })}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="menu-add-form">
            <input placeholder="Property name" value={name} onChange={(e) => setName(e.target.value)} />
            <select value={type} onChange={(e) => setType(e.target.value as PropertyType)}>
              {TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {(type === "select" || type === "multiSelect") && (
              <input
                placeholder="Options, comma separated"
                value={options}
                onChange={(e) => setOptions(e.target.value)}
              />
            )}
            <button onClick={addColumn}>Add property</button>
          </div>
        </div>
      )}
    </div>
  );
}

const FILTER_OPERATORS: FilterRule["operator"][] = [
  "eq",
  "neq",
  "contains",
  "notContains",
  "isEmpty",
  "isNotEmpty",
  "gt",
  "gte",
  "lt",
  "lte",
];

export function FilterMenu({
  snapshot,
  view,
}: {
  snapshot: DatabaseSnapshot;
  view: ViewDef;
}): JSX.Element {
  const [open, toggle, close] = useToggle();

  const updateFilters = (filters: FilterRule[]) => {
    post({ type: "updateView", view: { ...view, filters } });
  };

  const addFilter = () => {
    const first = snapshot.config.columns[0];
    if (!first) return;
    updateFilters([
      ...view.filters,
      { id: `f-${Date.now()}`, columnKey: first.key, operator: "contains", value: "" },
    ]);
  };

  return (
    <div className="menu-container">
      <button onClick={toggle}>Filter{view.filters.length > 0 ? ` (${view.filters.length})` : ""}</button>
      {open && (
        <div className="popover wide" onMouseLeave={close}>
          <div className="menu-list">
            {view.filters.map((f) => (
              <div key={f.id} className="menu-row filter-row">
                <select
                  value={f.columnKey}
                  onChange={(e) =>
                    updateFilters(view.filters.map((x) => (x.id === f.id ? { ...x, columnKey: e.target.value } : x)))
                  }
                >
                  {snapshot.config.columns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <select
                  value={f.operator}
                  onChange={(e) =>
                    updateFilters(
                      view.filters.map((x) =>
                        x.id === f.id ? { ...x, operator: e.target.value as FilterRule["operator"] } : x
                      )
                    )
                  }
                >
                  {FILTER_OPERATORS.map((op) => (
                    <option key={op} value={op}>
                      {op}
                    </option>
                  ))}
                </select>
                {f.operator !== "isEmpty" && f.operator !== "isNotEmpty" && (
                  <input
                    value={f.value ?? ""}
                    onChange={(e) =>
                      updateFilters(view.filters.map((x) => (x.id === f.id ? { ...x, value: e.target.value } : x)))
                    }
                  />
                )}
                <button
                  className="icon-btn"
                  onClick={() => updateFilters(view.filters.filter((x) => x.id !== f.id))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button onClick={addFilter}>+ Add filter</button>
        </div>
      )}
    </div>
  );
}

export function SortMenu({
  snapshot,
  view,
}: {
  snapshot: DatabaseSnapshot;
  view: ViewDef;
}): JSX.Element {
  const [open, toggle, close] = useToggle();

  const updateSorts = (sorts: SortRule[]) => {
    post({ type: "updateView", view: { ...view, sorts } });
  };

  const addSort = () => {
    const first = snapshot.config.columns[0];
    if (!first) return;
    updateSorts([...view.sorts, { columnKey: first.key, direction: "asc" }]);
  };

  return (
    <div className="menu-container">
      <button onClick={toggle}>Sort{view.sorts.length > 0 ? ` (${view.sorts.length})` : ""}</button>
      {open && (
        <div className="popover wide" onMouseLeave={close}>
          <div className="menu-list">
            {view.sorts.map((s, idx) => (
              <div key={idx} className="menu-row">
                <select
                  value={s.columnKey}
                  onChange={(e) =>
                    updateSorts(view.sorts.map((x, i) => (i === idx ? { ...x, columnKey: e.target.value } : x)))
                  }
                >
                  {snapshot.config.columns.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <select
                  value={s.direction}
                  onChange={(e) =>
                    updateSorts(
                      view.sorts.map((x, i) =>
                        i === idx ? { ...x, direction: e.target.value as SortRule["direction"] } : x
                      )
                    )
                  }
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
                <button
                  className="icon-btn"
                  onClick={() => updateSorts(view.sorts.filter((_, i) => i !== idx))}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <button onClick={addSort}>+ Add sort</button>
        </div>
      )}
    </div>
  );
}

export function ViewSettingsMenu({
  snapshot,
  view,
}: {
  snapshot: DatabaseSnapshot;
  view: ViewDef;
}): JSX.Element {
  const [open, toggle, close] = useToggle();
  const selectColumns = snapshot.config.columns.filter((c) => c.type === "select" || c.type === "multiSelect");

  return (
    <div className="menu-container">
      <button onClick={toggle} title="View settings">
        ⚙
      </button>
      {open && (
        <div className="popover wide" onMouseLeave={close}>
          <label className="menu-row">
            <span>View name</span>
            <input
              value={view.name}
              onChange={(e) => post({ type: "updateView", view: { ...view, name: e.target.value } })}
            />
          </label>
          {view.type === "board" && (
            <label className="menu-row">
              <span>Group by</span>
              <select
                value={view.groupByColumnKey ?? ""}
                onChange={(e) =>
                  post({
                    type: "updateView",
                    view: { ...view, groupByColumnKey: e.target.value || undefined },
                  })
                }
              >
                <option value="">(none)</option>
                {selectColumns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {view.type === "gallery" && (
            <label className="menu-row">
              <span>Cover property</span>
              <select
                value={view.coverColumnKey ?? ""}
                onChange={(e) =>
                  post({
                    type: "updateView",
                    view: { ...view, coverColumnKey: e.target.value || undefined },
                  })
                }
              >
                <option value="">(none)</option>
                {snapshot.config.columns.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="menu-row">
            <span>Include subfolders</span>
            <input
              type="checkbox"
              checked={snapshot.config.recursive}
              onChange={(e) => post({ type: "setRecursive", recursive: e.target.checked })}
            />
          </label>
          {snapshot.config.views.length > 1 && (
            <button
              className="danger"
              onClick={() => post({ type: "deleteView", viewId: view.id })}
            >
              Delete this view
            </button>
          )}
        </div>
      )}
    </div>
  );
}
