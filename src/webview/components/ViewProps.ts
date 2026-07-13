import { ColumnDef, DatabaseSnapshot, RowData, ViewDef } from "../../core/types";

export interface ViewComponentProps {
  snapshot: DatabaseSnapshot;
  view: ViewDef;
  columns: ColumnDef[];
  rows: RowData[];
}
