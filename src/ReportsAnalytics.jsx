// Reports & Analytics — top-level filter toolbar + selectable Loan Products
// table that drives summary cards and performance charts. Import button is
// wired to /api/od/pool/upload (same endpoint as OD Upload) so we never
// open a second write path into the database.
//
// Layout (top to bottom):
//   1. Header: title left, Refresh right
//   2. Filter toolbar (NOT inside any card) — From / To / Apply + presets
//   3. "Select Loan Products" table — searchable, sortable, checkbox-select
//   4. Summary cards (4) — Total Demand / Collected / Remaining / Efficiency
//   5. Performance Metrics — branch chart + product chart (driven by selection)
//   6. Reports — Import / Export

import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import {
  Activity, Calendar, Download, Upload, FileText, FileSpreadsheet, FileDown,
  TrendingUp, Wallet, Receipt, PiggyBank, Filter, Info, Search,
  ChevronUp, ChevronDown, RefreshCw, CheckSquare, Square,
} from "lucide-react";

// ─── helpers ────────────────────────────────────────────────────────────────
const formatINR = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString("en-IN")}`;
};

const todayISO = () => new Date().toISOString().slice(0, 10);
const monthsAgoISO = (n) => {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
};
const startOfMonthISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
};
const startOfYearISO = () => `${new Date().getFullYear()}-01-01`;

const downloadCSV = (rows, filename) => {
  if (!rows || rows.length === 0) return;
  const header = Object.keys(rows[0]);
  const csv = [
    header.join(","),
    ...rows.map((r) => header.map((h) => JSON.stringify(r[h] ?? "")).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

// ─── reusable bits ──────────────────────────────────────────────────────────
function SummaryCard({ icon: Icon, label, value, accent = "teal", hint }) {
  const accentMap = {
    teal: "bg-teal-50 text-teal-700",
    indigo: "bg-indigo-50 text-indigo-700",
    amber: "bg-amber-50 text-amber-700",
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
  };
  return (
    <div className="bg-white border rounded-xl p-4 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</span>
        <div className={`p-2 rounded-lg ${accentMap[accent] || accentMap.teal}`}>
          <Icon size={16} />
        </div>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {hint && (
        <div className="text-[11px] text-gray-400 mt-1 flex items-center gap-1" title={hint}>
          <Info size={10} /> {hint}
        </div>
      )}
    </div>
  );
}

function SectionCard({ title, subtitle, children, action }) {
  return (
    <div className="bg-white border rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-gray-800">{title}</h3>
          {subtitle && <p className="text-[11px] text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function SortHeader({ children, sortKey, currentKey, currentDir, onSort, align = "left" }) {
  const active = sortKey === currentKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      className={`px-3 py-2 font-medium text-gray-600 cursor-pointer select-none hover:bg-gray-100 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {active ? (
          currentDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />
        ) : (
          <ChevronUp size={12} className="opacity-20" />
        )}
      </span>
    </th>
  );
}

// ─── dummy data ─────────────────────────────────────────────────────────────
const DUMMY_PRODUCTS = [
  { id: "P001", name: "30K_FN_26_26",  type: "Group",      disbursed: 18500000, demand: 4500000, collected: 3825000 },
  { id: "P002", name: "50K_FN_24_24",  type: "Group",      disbursed: 12400000, demand: 3800000, collected: 2964000 },
  { id: "P003", name: "MSME_LAP",      type: "MSME",       disbursed:  8500000, demand: 2200000, collected: 1540000 },
  { id: "P004", name: "PERSONAL_18M",  type: "Personal",   disbursed:  3200000, demand:  950000, collected:  720000 },
  { id: "P005", name: "GROUP_GOLD",    type: "Group",      disbursed:  7600000, demand: 1800000, collected: 1530000 },
  { id: "P006", name: "INDIV_STD_36",  type: "Individual", disbursed:  5400000, demand: 1300000, collected:  980000 },
  { id: "P007", name: "INDIV_PREM_24", type: "Individual", disbursed:  4800000, demand: 1100000, collected:  858000 },
  { id: "P008", name: "MSME_OD",       type: "MSME",       disbursed:  6700000, demand: 1700000, collected: 1156000 },
  { id: "P009", name: "GROUP_75K_36",  type: "Group",      disbursed:  9200000, demand: 2100000, collected: 1764000 },
  { id: "P010", name: "PERSONAL_24M",  type: "Personal",   disbursed:  2800000, demand:  820000, collected:  574000 },
];

const DUMMY_BRANCH_PERFORMANCE = [
  { branch: "Periyakulam",   factor: 1.0 },
  { branch: "Theni",         factor: 0.85 },
  { branch: "Madurai",       factor: 1.15 },
  { branch: "Dindigul",      factor: 0.65 },
  { branch: "Cumbum",        factor: 0.75 },
  { branch: "Bodinayakanur", factor: 0.5 },
];

const PIE_COLORS = ["#0d9488", "#6366f1", "#f59e0b", "#ef4444", "#10b981", "#8b5cf6", "#ec4899", "#14b8a6", "#f43f5e", "#84cc16"];

// ─── main component ─────────────────────────────────────────────────────────
export default function ReportsAnalytics({ user }) {
  // ── filter (toolbar) state ──
  const [fromDate, setFromDate] = useState(monthsAgoISO(6));
  const [toDate, setToDate] = useState(todayISO());
  const [appliedFrom, setAppliedFrom] = useState(fromDate);
  const [appliedTo, setAppliedTo] = useState(toDate);

  // ── products table state ──
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  // ── refresh / loading ──
  const [refreshing, setRefreshing] = useState(false);

  // ── import state ──
  const [importMsg, setImportMsg] = useState("");
  const [importStatus, setImportStatus] = useState("idle"); // idle | uploading | success | error
  const [snapshotDate, setSnapshotDate] = useState(todayISO());

  // ── apply / preset handlers ──
  const handleApply = () => {
    setRefreshing(true);
    setAppliedFrom(fromDate);
    setAppliedTo(toDate);
    // simulated load — swap for real fetch
    setTimeout(() => setRefreshing(false), 350);
  };

  const handlePresetThisMonth = () => {
    setFromDate(startOfMonthISO());
    setToDate(todayISO());
  };
  const handlePresetLast3Months = () => {
    setFromDate(monthsAgoISO(3));
    setToDate(todayISO());
  };
  const handlePresetThisYear = () => {
    setFromDate(startOfYearISO());
    setToDate(todayISO());
  };

  // ── product table derivations ──
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = DUMMY_PRODUCTS;
    if (q) {
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.type.toLowerCase().includes(q)
      );
    }
    return rows;
  }, [search]);

  const sortedProducts = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const rows = [...filteredProducts];
    rows.sort((a, b) => {
      // Derived columns
      const aVal = sortKey === "remaining" ? a.demand - a.collected : a[sortKey];
      const bVal = sortKey === "remaining" ? b.demand - b.collected : b[sortKey];
      if (typeof aVal === "number" && typeof bVal === "number") return (aVal - bVal) * dir;
      return String(aVal).localeCompare(String(bVal)) * dir;
    });
    return rows;
  }, [filteredProducts, sortKey, sortDir]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  // Selection state — selectedIds is the source of truth.
  // visibleAllSelected = true iff every currently filtered/sorted row is selected.
  const visibleIds = useMemo(() => sortedProducts.map((r) => r.id), [sortedProducts]);
  const visibleAllSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const visibleSomeSelected = visibleIds.some((id) => selectedIds.has(id)) && !visibleAllSelected;

  const handleToggleRow = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };
  const handleToggleAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (visibleAllSelected) {
        // un-select every visible row
        for (const id of visibleIds) next.delete(id);
      } else {
        // select every visible row
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  };
  const handleClearSelection = () => setSelectedIds(new Set());

  // Effective rows that drive summary cards + charts. Empty selection means
  // "no explicit filter" → use everything currently visible (post-search).
  const effectiveRows = useMemo(() => {
    if (selectedIds.size === 0) return sortedProducts;
    return sortedProducts.filter((r) => selectedIds.has(r.id));
  }, [sortedProducts, selectedIds]);

  // ── summary totals ──
  const totals = useMemo(() => {
    const totalDemand    = effectiveRows.reduce((s, r) => s + r.demand, 0);
    const totalCollected = effectiveRows.reduce((s, r) => s + r.collected, 0);
    const totalDisbursed = effectiveRows.reduce((s, r) => s + r.disbursed, 0);
    const remaining      = totalDemand - totalCollected;
    const efficiency     = totalDemand > 0 ? (totalCollected / totalDemand) * 100 : 0;
    return { totalDemand, totalCollected, totalDisbursed, remaining, efficiency };
  }, [effectiveRows]);

  // ── charts ──
  // Branch performance scales the totals across mock branch factors.
  const branchData = useMemo(
    () =>
      DUMMY_BRANCH_PERFORMANCE.map((b) => {
        const demand = Math.round(totals.totalDemand * (b.factor / 5));
        const collected = Math.round(totals.totalCollected * (b.factor / 5));
        return {
          branch: b.branch,
          demand,
          collected,
          efficiency: demand > 0 ? Math.round((collected / demand) * 1000) / 10 : 0,
        };
      }),
    [totals.totalDemand, totals.totalCollected]
  );

  const productChartData = useMemo(
    () => effectiveRows.map((r) => ({ name: r.name, value: r.demand })),
    [effectiveRows]
  );

  // ── exports ──
  const exportRowsForCSV = () =>
    effectiveRows.map((r) => ({
      Product: r.name,
      Type: r.type,
      Disbursement: r.disbursed,
      Demand: r.demand,
      Collected: r.collected,
      Remaining: r.demand - r.collected,
    }));

  const handleExportCSV = () => downloadCSV(exportRowsForCSV(), `reports-products-${todayISO()}.csv`);
  const handleExportExcel = () => downloadCSV(exportRowsForCSV(), `reports-products-${todayISO()}.xls`);
  const handleExportPDF = () => {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    const rowsHtml = effectiveRows
      .map(
        (r) =>
          `<tr><td>${r.name}</td><td>${r.type}</td><td>${formatINR(r.disbursed)}</td><td>${formatINR(r.demand)}</td><td>${formatINR(r.collected)}</td><td>${formatINR(r.demand - r.collected)}</td></tr>`
      )
      .join("");
    w.document.write(`
      <!doctype html><html><head><title>Reports — ${todayISO()}</title>
      <style>
        body{font-family:system-ui,sans-serif;padding:24px;color:#111}
        h1{margin:0 0 4px;font-size:20px}
        h2{margin:24px 0 8px;font-size:14px;color:#374151}
        table{border-collapse:collapse;width:100%;font-size:12px}
        th,td{border:1px solid #d1d5db;padding:6px 10px;text-align:left}
        th{background:#f3f4f6;font-weight:600}
      </style></head><body>
      <h1>Reports &amp; Analytics</h1>
      <div>Period: ${appliedFrom} → ${appliedTo} · Selected: ${selectedIds.size || "all"} products · Generated: ${new Date().toLocaleString()}</div>
      <h2>Financial Summary</h2>
      <table><tr>
        <th>Total Demand</th><td>${formatINR(totals.totalDemand)}</td>
        <th>Total Collected</th><td>${formatINR(totals.totalCollected)}</td>
        <th>Remaining</th><td>${formatINR(totals.remaining)}</td>
        <th>Efficiency</th><td>${totals.efficiency.toFixed(1)}%</td>
      </tr></table>
      <h2>Selected Loan Products</h2>
      <table>
        <thead><tr><th>Product</th><th>Type</th><th>Disbursement</th><th>Demand</th><th>Collected</th><th>Remaining</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <script>window.onload=()=>window.print()</script>
      </body></html>
    `);
    w.document.close();
  };

  // ── import (wired to real /api/od/pool/upload — no second write path) ──
  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setImportStatus("uploading");
    setImportMsg(`Uploading "${file.name}" (${(file.size / 1024 / 1024).toFixed(2)} MB) for snapshot ${snapshotDate}…`);

    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("snapshotDate", snapshotDate);

      const res = await fetch("/api/od/pool/upload", {
        method: "POST",
        headers: {
          "x-od-user": user?.id || "",
          "x-od-role": user?.role || "",
        },
        body: fd,
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const reason = json?.error || `HTTP ${res.status}`;
        setImportStatus("error");
        setImportMsg(`Import failed: ${reason}`);
        return;
      }

      setImportStatus("success");
      setImportMsg(
        `Imported ${json.rowCount?.toLocaleString?.() ?? json.rowCount ?? "?"} rows for ${json.snapshotDate || snapshotDate}` +
        (json.newBranches ? ` (${json.newBranches} new branches)` : "")
      );
    } catch (err) {
      setImportStatus("error");
      setImportMsg(`Import failed: ${err.message || err}`);
    }
  };

  // ────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* 1. Header — title left, Refresh right */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-teal-50 rounded-lg text-teal-700"><Activity size={20} /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Reports &amp; Analytics</h1>
            <p className="text-xs text-gray-500">Loan portfolio insights, performance metrics, import &amp; export</p>
          </div>
        </div>
        <button
          onClick={handleApply}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-xs bg-teal-600 text-white px-3 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? "animate-spin" : ""} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* 2. Filter Toolbar — top control panel, NOT inside a card */}
      <div className="bg-gray-50 border rounded-xl px-4 py-3 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-end gap-3">
          {/* From */}
          <div className="flex-1 min-w-[160px]">
            <label className="text-[11px] text-gray-500 mb-1 block flex items-center gap-1">
              <Calendar size={11} /> Disbursement From
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-1.5 text-sm bg-white"
            />
          </div>
          {/* To */}
          <div className="flex-1 min-w-[160px]">
            <label className="text-[11px] text-gray-500 mb-1 block flex items-center gap-1">
              <Calendar size={11} /> Disbursement To
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-1.5 text-sm bg-white"
            />
          </div>
          {/* Apply */}
          <div>
            <button
              onClick={handleApply}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700"
            >
              <Filter size={14} /> Apply Filters
            </button>
          </div>
          {/* Presets */}
          <div className="flex flex-wrap gap-1.5 md:ml-auto">
            <button
              onClick={handlePresetThisMonth}
              className="text-[11px] px-2.5 py-1.5 bg-white border rounded-md hover:bg-gray-100 text-gray-700"
            >
              This Month
            </button>
            <button
              onClick={handlePresetLast3Months}
              className="text-[11px] px-2.5 py-1.5 bg-white border rounded-md hover:bg-gray-100 text-gray-700"
            >
              Last 3 Months
            </button>
            <button
              onClick={handlePresetThisYear}
              className="text-[11px] px-2.5 py-1.5 bg-white border rounded-md hover:bg-gray-100 text-gray-700"
            >
              This Year
            </button>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-gray-500">
          Active period: <b className="text-gray-700">{appliedFrom}</b> → <b className="text-gray-700">{appliedTo}</b>
          {selectedIds.size > 0 && (
            <> · <b className="text-teal-700">{selectedIds.size}</b> product{selectedIds.size === 1 ? "" : "s"} selected</>
          )}
        </div>
      </div>

      {/* 3. Loan Products Table */}
      <SectionCard
        title="Select Loan Products"
        subtitle="Tick rows to filter the dashboard. Empty selection = all visible products."
        action={
          <div className="flex items-center gap-2">
            {selectedIds.size > 0 && (
              <button
                onClick={handleClearSelection}
                className="text-[11px] text-gray-500 hover:text-gray-800"
              >
                Clear ({selectedIds.size})
              </button>
            )}
            <button
              onClick={handleExportCSV}
              title="Export selected (or all visible) rows as CSV"
              className="text-xs text-teal-700 flex items-center gap-1 hover:underline"
            >
              <Download size={12} /> CSV
            </button>
          </div>
        }
      >
        {/* Search */}
        <div className="mb-3 relative max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by product name or loan type…"
            className="w-full border rounded-lg pl-8 pr-3 py-2 text-sm"
          />
        </div>

        {/* Scrollable table with sticky header */}
        <div className="overflow-x-auto border rounded-lg max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-3 py-2 w-10">
                  <button
                    type="button"
                    onClick={handleToggleAllVisible}
                    className="flex items-center"
                    title={visibleAllSelected ? "Deselect all" : "Select all"}
                  >
                    {visibleAllSelected ? (
                      <CheckSquare size={16} className="text-teal-600" />
                    ) : visibleSomeSelected ? (
                      <CheckSquare size={16} className="text-teal-300" />
                    ) : (
                      <Square size={16} className="text-gray-400" />
                    )}
                  </button>
                </th>
                <SortHeader sortKey="name"       currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Loan Product</SortHeader>
                <SortHeader sortKey="type"       currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Loan Type</SortHeader>
                <SortHeader sortKey="disbursed"  currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right">Total Disbursement</SortHeader>
                <SortHeader sortKey="demand"     currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right">Total Demand</SortHeader>
                <SortHeader sortKey="collected"  currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right">Total Collected</SortHeader>
                <SortHeader sortKey="remaining"  currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right">Remaining Balance</SortHeader>
              </tr>
            </thead>
            <tbody>
              {sortedProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-gray-400">
                    No products match the search.
                  </td>
                </tr>
              ) : (
                sortedProducts.map((r, i) => {
                  const selected = selectedIds.has(r.id);
                  const remaining = r.demand - r.collected;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => handleToggleRow(r.id)}
                      className={`border-t cursor-pointer transition-colors ${
                        selected
                          ? "bg-teal-50 hover:bg-teal-100"
                          : i % 2 === 0
                          ? "bg-white hover:bg-gray-50"
                          : "bg-gray-50/60 hover:bg-gray-100"
                      }`}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => handleToggleRow(r.id)}
                          className="flex items-center"
                          aria-label={selected ? "Deselect row" : "Select row"}
                        >
                          {selected ? (
                            <CheckSquare size={16} className="text-teal-600" />
                          ) : (
                            <Square size={16} className="text-gray-400" />
                          )}
                        </button>
                      </td>
                      <td className="px-3 py-2 font-medium text-gray-800">{r.name}</td>
                      <td className="px-3 py-2">
                        <span className={`text-[11px] px-2 py-0.5 rounded ${
                          r.type === "Group"      ? "bg-teal-100 text-teal-700" :
                          r.type === "Individual" ? "bg-indigo-100 text-indigo-700" :
                          r.type === "MSME"       ? "bg-amber-100 text-amber-700" :
                          r.type === "Personal"   ? "bg-rose-100 text-rose-700" :
                                                    "bg-gray-100 text-gray-700"
                        }`}>{r.type}</span>
                      </td>
                      <td className="px-3 py-2 text-right">{formatINR(r.disbursed)}</td>
                      <td className="px-3 py-2 text-right">{formatINR(r.demand)}</td>
                      <td className="px-3 py-2 text-right">{formatINR(r.collected)}</td>
                      <td className="px-3 py-2 text-right">{formatINR(remaining)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-gray-500 mt-2">
          Showing {sortedProducts.length} of {DUMMY_PRODUCTS.length} products
          {search && <> · filtered by "<b>{search}</b>"</>}
        </div>
      </SectionCard>

      {/* 4. Summary Cards (below table) — driven by selection */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard
          icon={Wallet}
          label="Total Demand"
          value={formatINR(totals.totalDemand)}
          accent="indigo"
          hint="Sum of demand across selected products in period"
        />
        <SummaryCard
          icon={Receipt}
          label="Total Collected"
          value={formatINR(totals.totalCollected)}
          accent="emerald"
          hint="Sum of collections across selected products"
        />
        <SummaryCard
          icon={PiggyBank}
          label="Remaining Balance"
          value={formatINR(totals.remaining)}
          accent="amber"
          hint="Demand minus collected"
        />
        <SummaryCard
          icon={TrendingUp}
          label="Collection Efficiency"
          value={`${totals.efficiency.toFixed(1)}%`}
          accent="teal"
          hint="Collected ÷ Demand"
        />
      </div>

      {/* 5. Performance Metrics — react to selection */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title="Branch-wise Performance" subtitle="Demand vs Collected, scaled by selection">
          {effectiveRows.length === 0 ? (
            <div className="text-gray-400 text-sm py-6 text-center">No data for current selection.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={branchData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="branch" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v) => Math.round(v / 100000) + "L"} />
                <Tooltip formatter={(v) => formatINR(v)} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="demand" fill="#6366f1" name="Demand" />
                <Bar dataKey="collected" fill="#0d9488" name="Collected" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>

        <SectionCard title="Product-wise Performance" subtitle="Demand contribution by selected product">
          {productChartData.length === 0 ? (
            <div className="text-gray-400 text-sm py-6 text-center">No data for current selection.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={productChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={85}
                  dataKey="value"
                  label={(e) => e.name}
                >
                  {productChartData.map((p, i) => (
                    <Cell key={p.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatINR(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>

      {/* 6. Reports — Import / Export */}
      <SectionCard title="Reports" subtitle="Import a Compressed Pool Report or export the current view">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Import — wired to /api/od/pool/upload */}
          <div className="border-2 border-dashed border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Upload size={16} className="text-teal-600" />
              <h4 className="font-semibold text-gray-800 text-sm">Import Reports</h4>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Upload a Compressed Pool Report (.csv). Routed through the same
              ingest pipeline used in OD Upload — existing data is never
              overwritten or deleted.
            </p>

            <div className="mb-3">
              <label className="text-[11px] text-gray-500 block mb-1">Snapshot Date</label>
              <input
                type="date"
                value={snapshotDate}
                onChange={(e) => setSnapshotDate(e.target.value)}
                disabled={importStatus === "uploading"}
                className="border rounded-lg px-2.5 py-1.5 text-sm w-full max-w-[180px]"
              />
            </div>

            <label
              className={`inline-flex items-center gap-2 px-3 py-2 text-xs rounded-lg ${
                importStatus === "uploading"
                  ? "bg-gray-300 text-white cursor-not-allowed"
                  : "bg-teal-600 text-white hover:bg-teal-700 cursor-pointer"
              }`}
            >
              <Upload size={12} />
              {importStatus === "uploading" ? "Uploading…" : "Choose File"}
              <input
                type="file"
                accept=".csv,.txt"
                onChange={handleImport}
                disabled={importStatus === "uploading"}
                className="hidden"
              />
            </label>

            {importMsg && (
              <div
                className={`mt-3 text-[11px] px-2 py-1.5 rounded ${
                  importStatus === "success"
                    ? "text-emerald-800 bg-emerald-50"
                    : importStatus === "error"
                    ? "text-rose-800 bg-rose-50"
                    : "text-amber-800 bg-amber-50"
                }`}
              >
                {importMsg}
              </div>
            )}
          </div>

          {/* Export */}
          <div className="border-2 border-dashed border-gray-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <Download size={16} className="text-indigo-600" />
              <h4 className="font-semibold text-gray-800 text-sm">Export Reports</h4>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Download {selectedIds.size > 0 ? `${selectedIds.size} selected product${selectedIds.size === 1 ? "" : "s"}` : "all visible products"} in your preferred format.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleExportCSV}
                title="Comma-separated values"
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700"
              >
                <FileText size={12} /> CSV
              </button>
              <button
                onClick={handleExportExcel}
                title="Excel spreadsheet"
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-teal-600 text-white text-xs rounded-lg hover:bg-teal-700"
              >
                <FileSpreadsheet size={12} /> Excel
              </button>
              <button
                onClick={handleExportPDF}
                title="Print preview as PDF"
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-rose-600 text-white text-xs rounded-lg hover:bg-rose-700"
              >
                <FileDown size={12} /> PDF
              </button>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Footer note */}
      <div className="text-[11px] text-gray-400 text-center pt-2">
        Reports &amp; Analytics is read-only for analytical views. Imports route through the existing OD Upload ingest pipeline.
      </div>
    </div>
  );
}
