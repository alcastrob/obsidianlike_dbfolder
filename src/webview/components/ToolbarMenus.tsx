import React, { useEffect, useState } from "react";
import {
  CellSize,
  ColumnDef,
  DatabaseSnapshot,
  DatabaseSourceInfo,
  FilterCondition,
  FilterGroup,
  FilterNode,
  FilterOperator,
  PropertyType,
  SortRule,
  ViewDef,
} from "../../core/types";
import { countFilterConditions, normalizeFilterGroup } from "../../core/query";
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
          <div className="menu-add-form">
            <button
              onClick={() => post({ type: "generateColumnsFromNote" })}
              title="Pick a note and add one column per frontmatter property it has"
            >
              Use note as template…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const FILTER_OPERATORS: FilterOperator[] = [
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

function ConditionRow({
  condition,
  columns,
  onChange,
  onRemove,
}: {
  condition: FilterCondition;
  columns: ColumnDef[];
  onChange: (next: FilterCondition) => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div className="menu-row filter-row">
      <select value={condition.columnKey} onChange={(e) => onChange({ ...condition, columnKey: e.target.value })}>
        {columns.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
      <select
        value={condition.operator}
        onChange={(e) => onChange({ ...condition, operator: e.target.value as FilterOperator })}
      >
        {FILTER_OPERATORS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      {condition.operator !== "isEmpty" && condition.operator !== "isNotEmpty" && (
        <input value={condition.value ?? ""} onChange={(e) => onChange({ ...condition, value: e.target.value })} />
      )}
      <button className="icon-btn" onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}

function FilterGroupEditor({
  group,
  columns,
  onChange,
  depth,
}: {
  group: FilterGroup;
  columns: ColumnDef[];
  onChange: (next: FilterGroup) => void;
  depth: number;
}): JSX.Element {
  const updateChild = (idx: number, next: FilterNode) => {
    const children = group.children.slice();
    children[idx] = next;
    onChange({ ...group, children });
  };
  const removeChild = (idx: number) => {
    onChange({ ...group, children: group.children.filter((_, i) => i !== idx) });
  };
  const addCondition = () => {
    const first = columns[0];
    if (!first) return;
    onChange({
      ...group,
      children: [
        ...group.children,
        { id: `c-${Date.now()}`, kind: "condition", columnKey: first.key, operator: "contains", value: "" },
      ],
    });
  };
  const addGroup = () => {
    onChange({
      ...group,
      children: [...group.children, { id: `g-${Date.now()}`, kind: "group", combinator: "and", children: [] }],
    });
  };

  return (
    <div className="filter-group">
      {group.children.length > 1 && (
        <div className="menu-row">
          <span>Match</span>
          <select
            value={group.combinator}
            onChange={(e) => onChange({ ...group, combinator: e.target.value as "and" | "or" })}
          >
            <option value="and">ALL (AND)</option>
            <option value="or">ANY (OR)</option>
          </select>
        </div>
      )}
      <div className="menu-list">
        {group.children.map((child, idx) =>
          child.kind === "condition" ? (
            <ConditionRow
              key={child.id}
              condition={child}
              columns={columns}
              onChange={(next) => updateChild(idx, next)}
              onRemove={() => removeChild(idx)}
            />
          ) : (
            <div key={child.id} className="filter-subgroup">
              <div className="filter-subgroup-header">
                <span className="menu-section-title">Group</span>
                <button className="icon-btn" onClick={() => removeChild(idx)}>
                  ✕
                </button>
              </div>
              <FilterGroupEditor group={child} columns={columns} onChange={(next) => updateChild(idx, next)} depth={depth + 1} />
            </div>
          )
        )}
      </div>
      <div className="filter-group-actions">
        <button onClick={addCondition}>+ Add filter</button>
        <button onClick={addGroup}>+ Add filter group</button>
      </div>
    </div>
  );
}

export function FilterMenu({
  snapshot,
  view,
}: {
  snapshot: DatabaseSnapshot;
  view: ViewDef;
}): JSX.Element {
  const [open, toggle, close] = useToggle();
  const filterGroup = normalizeFilterGroup(view.filters);
  const count = countFilterConditions(filterGroup);

  const updateFilters = (filters: FilterGroup) => {
    post({ type: "updateView", view: { ...view, filters } });
  };

  return (
    <div className="menu-container">
      <button onClick={toggle}>Filter{count > 0 ? ` (${count})` : ""}</button>
      {open && (
        <div className="popover wide" onMouseLeave={close}>
          <FilterGroupEditor group={filterGroup} columns={snapshot.config.columns} onChange={updateFilters} depth={0} />
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

/**
 * Editable source-config section for note-backed databases (a note with an
 * embedded ```yaml:dbfolder block) - lets the user change source_data,
 * source_destination_path and source_form_result without opening raw text.
 * Not based on the original plugin's actual dialog (no way to see it here) -
 * built from the config fields the parser already understands.
 */
function DatabaseSourceSection({ sourceInfo }: { sourceInfo: DatabaseSourceInfo }): JSX.Element {
  const [mode, setMode] = useState<DatabaseSourceInfo["mode"]>(sourceInfo.mode);
  const [folderPath, setFolderPath] = useState(sourceInfo.folderPath ?? "");
  const [recursive, setRecursive] = useState(Boolean(sourceInfo.recursive));
  const [queryFilter, setQueryFilter] = useState(sourceInfo.queryFilter ?? "");
  const [templatePath, setTemplatePath] = useState(sourceInfo.templatePath ?? "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return; // don't clobber in-progress edits when a new snapshot arrives
    setMode(sourceInfo.mode);
    setFolderPath(sourceInfo.folderPath ?? "");
    setRecursive(Boolean(sourceInfo.recursive));
    setQueryFilter(sourceInfo.queryFilter ?? "");
    setTemplatePath(sourceInfo.templatePath ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceInfo.mode, sourceInfo.folderPath, sourceInfo.recursive, sourceInfo.queryFilter, sourceInfo.templatePath]);

  const markDirty = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  const save = () => {
    post({
      type: "updateDatabaseSource",
      source: {
        mode,
        folderPath: folderPath.trim() || undefined,
        recursive,
        queryFilter: queryFilter.trim() || undefined,
        templatePath: templatePath.trim() || undefined,
      },
    });
    setDirty(false);
  };

  return (
    <div className="db-source-section">
      <div className="menu-section-title">Database source</div>
      <label className="menu-row">
        <span>Source</span>
        <select value={mode} onChange={(e) => markDirty(setMode)(e.target.value as DatabaseSourceInfo["mode"])}>
          <option value="folder">Folder</option>
          <option value="query">Query</option>
        </select>
      </label>
      {mode === "folder" ? (
        <>
          <label className="menu-row">
            <span>Folder</span>
            <input
              value={folderPath}
              onChange={(e) => markDirty(setFolderPath)(e.target.value)}
              placeholder="e.g. 10_SNPT/Topics (relative to the vault root)"
            />
          </label>
          <label className="menu-row">
            <span>Include subfolders</span>
            <input type="checkbox" checked={recursive} onChange={(e) => markDirty(setRecursive)(e.target.checked)} />
          </label>
        </>
      ) : (
        <>
          <label className="menu-col">
            <span>Query</span>
            <textarea
              rows={4}
              value={queryFilter}
              onChange={(e) => markDirty(setQueryFilter)(e.target.value)}
              placeholder='FROM "folder" WHERE property = "value"'
            />
          </label>
          <label className="menu-row">
            <span>New notes folder</span>
            <input
              value={folderPath}
              onChange={(e) => markDirty(setFolderPath)(e.target.value)}
              placeholder="e.g. 10_SNPT/Topics (relative to the vault root)"
            />
          </label>
        </>
      )}
      <label className="menu-row">
        <span>Row template</span>
        <input
          value={templatePath}
          onChange={(e) => markDirty(setTemplatePath)(e.target.value)}
          placeholder="e.g. Templates/New topic.md (optional)"
        />
      </label>
      <button onClick={save} disabled={!dirty}>
        Save source
      </button>
    </div>
  );
}

/** Database-level settings (name, description, cell size, sticky first column) - apply
 *  regardless of which view is active, matching the real plugin's per-database dialog. */
function DatabaseMetaSection({ snapshot }: { snapshot: DatabaseSnapshot }): JSX.Element {
  const [name, setName] = useState(snapshot.config.name ?? "");
  const [description, setDescription] = useState(snapshot.config.description ?? "");
  const [cellSize, setCellSize] = useState<CellSize>(snapshot.config.cellSize ?? "normal");
  const [stickyFirstColumn, setStickyFirstColumn] = useState(Boolean(snapshot.config.stickyFirstColumn));
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (dirty) return;
    setName(snapshot.config.name ?? "");
    setDescription(snapshot.config.description ?? "");
    setCellSize(snapshot.config.cellSize ?? "normal");
    setStickyFirstColumn(Boolean(snapshot.config.stickyFirstColumn));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.config.name, snapshot.config.description, snapshot.config.cellSize, snapshot.config.stickyFirstColumn]);

  const markDirty = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  const save = () => {
    post({
      type: "updateDatabaseMeta",
      name: name.trim() || undefined,
      description: description.trim() || undefined,
      cellSize,
      stickyFirstColumn,
    });
    setDirty(false);
  };

  return (
    <div className="db-source-section">
      <div className="menu-section-title">Database settings</div>
      <label className="menu-row">
        <span>Name</span>
        <input value={name} onChange={(e) => markDirty(setName)(e.target.value)} placeholder="Database name" />
      </label>
      <label className="menu-col">
        <span>Description</span>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => markDirty(setDescription)(e.target.value)}
          placeholder="Optional description"
        />
      </label>
      <label className="menu-row">
        <span>Cell size</span>
        <select value={cellSize} onChange={(e) => markDirty(setCellSize)(e.target.value as CellSize)}>
          <option value="compact">Compact</option>
          <option value="normal">Normal</option>
          <option value="wide">Wide</option>
        </select>
      </label>
      <label className="menu-row">
        <span>Sticky first column</span>
        <input
          type="checkbox"
          checked={stickyFirstColumn}
          onChange={(e) => markDirty(setStickyFirstColumn)(e.target.checked)}
        />
      </label>
      <button onClick={save} disabled={!dirty}>
        Save
      </button>
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
          <DatabaseMetaSection snapshot={snapshot} />
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
          {!snapshot.sourceInfo && (
            <label className="menu-row">
              <span>Include subfolders</span>
              <input
                type="checkbox"
                checked={snapshot.config.recursive}
                onChange={(e) => post({ type: "setRecursive", recursive: e.target.checked })}
              />
            </label>
          )}
          {snapshot.sourceInfo && <DatabaseSourceSection sourceInfo={snapshot.sourceInfo} />}
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
