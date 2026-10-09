"use client";

// Every list in the portal: search, sortable headers and pages, styled our way (TanStack Table is headless).
import { useMemo, useState } from "react";
import { CaretDown, CaretLeft, CaretRight, CaretUp, CaretUpDown, Eye, MagnifyingGlass, PencilSimple, Trash } from "@phosphor-icons/react";
import {
  columnFacetingFeature,
  columnFilteringFeature,
  createColumnHelper,
  createFacetedRowModel,
  createFacetedUniqueValues,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from "@tanstack/react-table";
import { MultiSelect } from "./select";
import { btn, EmptyState, field, th, td } from "./ui";

export const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text, basic: sortFn_basic },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  columnFacetingFeature,
  facetedRowModel: createFacetedRowModel(),
  facetedUniqueValues: createFacetedUniqueValues(),
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  // className: extra classes for the column's th and td, e.g. num for amounts.
  // filter: adds a pick-list of the column's values above the table, e.g. "companies" shows "All companies". Several values can be picked.
  columnMeta: {} as { className?: string; filter?: string },
});

export const columnHelper = <T extends RowData>() => createColumnHelper<typeof features, T>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Columns<T extends RowData> = ColumnDef<typeof features, T, any>[];

const pageSizes = [10, 25, 50, 100];

export function DataTable<T extends RowData>({
  data,
  columns,
  search,
  empty,
  minWidth = 800,
  filters: startFilters = [],
}: {
  data: T[];
  columns: Columns<T>;
  search?: string; // placeholder; leave out for no search box
  empty: { title: string; hint: string };
  minWidth?: number;
  filters?: { id: string; value: string[] }[]; // pick-list filters to start with, e.g. from a link
}) {
  const [q, setQ] = useState("");
  // Pick-list columns keep rows whose value is one of the picked values.
  const cols = useMemo(
    () => columns.map((c) => (c.meta?.filter ? ({ ...c, filterFn: (row, id, picked: string[]) => picked.includes(String(row.getValue(id))) } as typeof c) : c)),
    [columns],
  );
  const table = useTable({
    features,
    columns: cols,
    data,
    state: { globalFilter: q },
    onGlobalFilterChange: (u) => setQ(typeof u === "function" ? u(q) : u),
    globalFilterFn: "includesString",
    getColumnCanGlobalFilter: (c) => c.id !== "actions",
    initialState: { pagination: { pageIndex: 0, pageSize: 25 }, columnFilters: startFilters },
  });

  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize } = table.state.pagination;
  const filters = table.getAllLeafColumns().filter((c) => c.columnDef.meta?.filter);

  return (
    <>
      {(search || filters.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 px-5 py-3">
          {search && (
            <div data-tour="search" className="relative w-full max-w-xs">
              <MagnifyingGlass size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
              <input className={`${field} w-full pl-9`} placeholder={search} value={q} onChange={(e) => table.setGlobalFilter(e.target.value)} aria-label="Search" />
            </div>
          )}
          {filters.length > 0 && (
          <div data-tour="filters" className="flex flex-wrap gap-3">
          {filters.map((c) => (
            <div key={c.id} className="w-52">
              <MultiSelect
                noun={c.columnDef.meta!.filter!}
                label={`Filter by ${c.columnDef.meta!.filter}`}
                value={(c.getFilterValue() as string[] | undefined) ?? []}
                onChange={(v) => c.setFilterValue(v.length ? v : undefined)}
                options={[...c.getFacetedUniqueValues()]
                  .sort(([a], [b]) => String(a).localeCompare(String(b)))
                  .map(([v, n]) => ({ value: String(v), label: `${v} (${n})` }))}
              />
            </div>
          ))}
          </div>
          )}
        </div>
      )}

      {total === 0 ? (
        data.length === 0 ? <EmptyState {...empty} /> : <EmptyState title="Nothing matches" hint="Try another search, or clear the filters." />
      ) : (
        <>
          <div data-tour="table" className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth }}>
              <thead className="border-y border-line bg-subtle">
                {table.getHeaderGroups().map((g) => (
                  <tr key={g.id}>
                    {g.headers.map((h) => {
                      const sorted = h.column.getIsSorted();
                      const cls = `${th} ${h.column.columnDef.meta?.className ?? ""}`;
                      return (
                        <th key={h.id} className={cls} aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}>
                          {h.column.getCanSort() ? (
                            <button className="inline-flex items-center gap-1 hover:text-ink" onClick={h.column.getToggleSortingHandler()}>
                              <table.FlexRender header={h} />
                              {sorted === "asc" ? <CaretUp size={12} weight="bold" /> : sorted === "desc" ? <CaretDown size={12} weight="bold" /> : <CaretUpDown size={12} className="opacity-50" />}
                            </button>
                          ) : (
                            <table.FlexRender header={h} />
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.id}>
                    {r.getAllCells().map((c) => (
                      <td key={c.id} className={`${td} ${c.column.id === "actions" ? "w-px py-2 pr-3 pl-0" : ""} ${c.column.columnDef.meta?.className ?? ""}`}>
                        <table.FlexRender cell={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-2.5 text-xs text-ink-3">
            <span>
              {pageIndex * pageSize + 1} to {Math.min((pageIndex + 1) * pageSize, total)} of {total}
            </span>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2">
                Rows per page
                <select className="rounded-md border border-line-strong bg-surface px-1.5 py-1 text-xs text-ink" value={pageSize} onChange={(e) => table.setPageSize(Number(e.target.value))}>
                  {pageSizes.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              <span>
                Page {pageIndex + 1} of {table.getPageCount()}
              </span>
              <div className="flex">
                <button className={`${btn.icon} disabled:opacity-40`} aria-label="Previous page" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()}>
                  <CaretLeft size={14} />
                </button>
                <button className={`${btn.icon} disabled:opacity-40`} aria-label="Next page" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()}>
                  <CaretRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

// View / Edit / Delete in the same order on every list. Leave a handler out to hide that button.
export function RowActions({ name, onView, onEdit, onDelete, children }: { name: string; onView?: () => void; onEdit?: () => void; onDelete?: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex justify-end gap-1">
      {onView && (
        <button className={btn.icon} aria-label={`View ${name}`} title="View" onClick={onView}>
          <Eye size={16} />
        </button>
      )}
      {onEdit && (
        <button className={btn.icon} aria-label={`Edit ${name}`} title="Edit" onClick={onEdit}>
          <PencilSimple size={16} />
        </button>
      )}
      {children}
      {onDelete && (
        <button className={`${btn.icon} hover:text-bad`} aria-label={`Delete ${name}`} title="Delete" onClick={onDelete}>
          <Trash size={16} />
        </button>
      )}
    </div>
  );
}
