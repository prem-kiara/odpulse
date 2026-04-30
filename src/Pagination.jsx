// Reusable client-side pagination — drop-in for any sortable/filterable table
// in OD Pulse. The hook gives you the current page slice; the component is the
// matching navigation bar (page-size selector + prev/next + page numbers).
//
// Usage pattern:
//   const sortedFiltered = useMemo(() => ..., [data, search, sortKey, sortDir]);
//   const pg = usePagination(sortedFiltered, 10);
//   ...
//   {pg.pageRows.map(...)}
//   <PaginationBar {...pg} label="disbursements" />
//
// Important: pass the ALREADY-sorted-and-filtered array to usePagination.
// The hook resets page=1 whenever the source length changes, so applying a
// filter/search snaps the user back to the first page automatically.

import React, { useState, useMemo, useEffect } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

export function usePagination(rows, defaultPageSize = 10) {
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [page, setPage] = useState(1);
  const total = rows?.length || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Snap back to page 1 when the underlying list shrinks/changes (e.g. filter,
  // search, or page-size change pushes the current page out of range).
  useEffect(() => {
    if (page > totalPages) setPage(1);
  }, [total, pageSize, page, totalPages]);

  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  const pageRows = useMemo(
    () => (rows || []).slice(start, end),
    [rows, start, end]
  );

  return { pageRows, page, setPage, pageSize, setPageSize, totalPages, total, start, end };
}

// Compact page-number list with ellipses, similar to GitHub's pagination.
// Returns an array of (number | "…") entries.
function pageNumberList(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out = [1];
  if (current > 4) out.push("…");
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) out.push(i);
  if (current < total - 3) out.push("…");
  out.push(total);
  return out;
}

export function PaginationBar({
  page, setPage, pageSize, setPageSize, totalPages, total, start, end,
  label = "rows",
}) {
  if (total === 0) return null;
  const numbers = pageNumberList(page, totalPages);
  const btn = (cls = "") =>
    `inline-flex items-center justify-center h-7 min-w-[28px] px-2 text-xs border rounded ${cls}`;
  const navBtn = (disabled) =>
    btn(disabled
      ? "bg-gray-50 text-gray-300 border-gray-200 cursor-not-allowed"
      : "bg-white text-gray-700 border-gray-300 hover:bg-teal-50 hover:border-teal-400 cursor-pointer");

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-2 text-xs">
      <div className="text-gray-500">
        Showing <b className="text-gray-700">{total === 0 ? 0 : start + 1}</b>
        {"–"}
        <b className="text-gray-700">{end}</b>
        {" of "}
        <b className="text-gray-700">{total.toLocaleString("en-IN")}</b>
        {" "}{label}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <select
          value={pageSize}
          onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
          className="h-7 border border-gray-300 rounded px-1.5 text-xs bg-white"
          aria-label="Rows per page"
        >
          {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n} / page</option>)}
        </select>
        <button onClick={() => setPage(1)} disabled={page === 1}
          className={navBtn(page === 1)} aria-label="First page" title="First page">
          <ChevronsLeft size={12} />
        </button>
        <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
          className={navBtn(page === 1)} aria-label="Previous page" title="Previous">
          <ChevronLeft size={12} />
        </button>
        {numbers.map((n, i) =>
          n === "…" ? (
            <span key={`e${i}`} className="px-1 text-gray-400">…</span>
          ) : (
            <button key={n} onClick={() => setPage(n)}
              className={btn(n === page
                ? "bg-teal-600 text-white border-teal-700 cursor-default"
                : "bg-white text-gray-700 border-gray-300 hover:bg-teal-50 hover:border-teal-400 cursor-pointer")}>
              {n}
            </button>
          )
        )}
        <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
          className={navBtn(page === totalPages)} aria-label="Next page" title="Next">
          <ChevronRight size={12} />
        </button>
        <button onClick={() => setPage(totalPages)} disabled={page === totalPages}
          className={navBtn(page === totalPages)} aria-label="Last page" title="Last page">
          <ChevronsRight size={12} />
        </button>
      </div>
    </div>
  );
}
