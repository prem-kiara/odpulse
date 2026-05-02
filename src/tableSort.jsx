// Reusable table-sort helper used by every table in the app.
// Usage:
//   const sort = useTableSort("date", "desc");
//   const rowsToRender = sort.apply(rows, (row, key) => row[key]);
//   <th>{sort.header("date", "Date")}</th>
//
// The second arg of `apply` is optional — default is `row => row[key]`.
// Pass a custom getter when a column's sort value differs from the row key
// (e.g. customer column sorted by customerName, or a derived value).

import React, { useState, useMemo, useCallback } from "react";

export function useTableSort(initialKey = "", initialDir = "desc") {
  const [sortKey, setSortKey] = useState(initialKey);
  const [sortDir, setSortDir] = useState(initialDir); // "asc" | "desc"

  const request = useCallback((key) => {
    if (sortKey === key) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }, [sortKey]);

  const apply = useCallback((rows, getValue) => {
    if (!sortKey || !Array.isArray(rows)) return rows;
    const get = getValue || ((row, k) => row?.[k]);
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = get(a, sortKey);
      const bv = get(b, sortKey);
      // Nullish last
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      // Numeric
      const anum = typeof av === "number" ? av : Number(av);
      const bnum = typeof bv === "number" ? bv : Number(bv);
      if (!Number.isNaN(anum) && !Number.isNaN(bnum) && (typeof av === "number" || typeof bv === "number" || (/^-?\d/.test(String(av)) && /^-?\d/.test(String(bv))))) {
        return sortDir === "asc" ? anum - bnum : bnum - anum;
      }
      // String
      const as = String(av).toLowerCase();
      const bs = String(bv).toLowerCase();
      if (as < bs) return sortDir === "asc" ? -1 : 1;
      if (as > bs) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return arr;
  }, [sortKey, sortDir]);

  const indicator = (key) => (sortKey === key ? (sortDir === "asc" ? " ↑" : " ↓") : "");

  // Convenience: renders the clickable inner content for a <th>.
  // Keep the outer <th> so callers keep their existing className/align.
  const header = (key, label) => (
    <span
      role="button"
      tabIndex={0}
      onClick={() => request(key)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); request(key); } }}
      className={`cursor-pointer select-none inline-flex items-center gap-0.5 ${sortKey === key ? "text-teal-700 font-semibold" : ""}`}
    >
      {label}{indicator(key)}
    </span>
  );

  return { sortKey, sortDir, request, apply, indicator, header };
}

// SortableSection — a thin wrapper component that owns its own sort state and
// hands a `sort` object to a render callback. Use this anywhere you need a
// sortable table inside a loop, conditional, or other context where calling
// `useTableSort` directly would either violate the Rules of Hooks or cause
// state to be reset (e.g. tables defined inside parent components that
// re-render). Because SortableSection is itself a stable, module-scope
// component, React preserves its hook state across parent re-renders.
//
// Usage:
//   <SortableSection initialKey="date" initialDir="desc" render={sort => (
//     <table>
//       <thead>
//         <tr><th>{sort.header("date", "Date")}</th></tr>
//       </thead>
//       <tbody>
//         {sort.apply(rows).map(r => <tr key={r.id}>...</tr>)}
//       </tbody>
//     </table>
//   )} />
export function SortableSection({ initialKey = "", initialDir = "desc", render }) {
  const sort = useTableSort(initialKey, initialDir);
  return render(sort);
}

// PaginatedSortableSection — same as SortableSection, plus client-side
// pagination wired via usePagination + a PaginationBar rendered AFTER the
// caller's JSX. Pass `rows` directly so we can sort + paginate them
// internally. The render prop receives { sort, pageRows, pg } where
// pageRows is the sorted+paginated slice ready to render in <tbody>.
//
// Usage:
//   <PaginatedSortableSection rows={items} initialKey="date" initialDir="desc"
//     pageSize={10} label="customers"
//     render={({ sort, pageRows }) => (
//       <table>
//         <thead><tr><th>{sort.header("date", "Date")}</th></tr></thead>
//         <tbody>
//           {pageRows.length === 0
//             ? <tr><td>No data.</td></tr>
//             : pageRows.map(r => <tr key={r.id}>...</tr>)}
//         </tbody>
//       </table>
//     )} />
import { usePagination, PaginationBar } from "./Pagination";
export function PaginatedSortableSection({
  rows,
  initialKey = "",
  initialDir = "desc",
  pageSize = 10,
  label = "rows",
  getValue,
  render,
}) {
  const sort = useTableSort(initialKey, initialDir);
  const sorted = useMemo(
    () => sort.apply(rows || [], getValue),
    [sort, rows, getValue]
  );
  const pg = usePagination(sorted, pageSize);
  return (
    <>
      {render({ sort, pageRows: pg.pageRows, pg })}
      <PaginationBar {...pg} label={label} />
    </>
  );
}
