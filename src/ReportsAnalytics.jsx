// Reports & Analytics — Disbursement Analytics view.
//
// Wired to /api/od/disbursements which aggregates disbursements from the
// existing customers master (populated by the OD Upload Pool/Foreclosure
// pipelines). Filters: date range on disbursement_date, branch, product,
// loan category (Group / Individual).
//
// This page does NOT have its own upload — uploads are handled exclusively
// in the OD Upload section. This page is read-only analytics + export.
//
// Layout:
//   1. Header + Refresh
//   2. Filter toolbar — From / To / Branch / Product / Category + presets
//   3. KPI cards — Total Disbursements / Total Amount / Avg Ticket / Customer Count
//   4. Status split — Active / Closed / Pending
//   5. Trend chart — monthly disbursement volume + amount
//   6. Branch-wise + Product-wise + Category-wise breakdowns
//   7. Recent Disbursements table (top 200, searchable + sortable)
//   8. Reports — Export only (PDF / CSV)

import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import {
  Activity, Calendar, Download, FileText, FileSpreadsheet, FileDown,
  TrendingUp, Wallet, Receipt, Users, Filter, Info, Search,
  ChevronUp, ChevronDown, RefreshCw, Building2, Package,
} from "lucide-react";

// ─── helpers ────────────────────────────────────────────────────────────────
const formatINR = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${v.toLocaleString("en-IN")}`;
};
const formatNum = (n) => (Number(n) || 0).toLocaleString("en-IN");

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
function SummaryCard({ icon: Icon, label, value, accent = "teal", hint, onClick, active }) {
  const accentMap = {
    teal: "bg-teal-50 text-teal-700",
    indigo: "bg-indigo-50 text-indigo-700",
    amber: "bg-amber-50 text-amber-700",
    emerald: "bg-emerald-50 text-emerald-700",
    rose: "bg-rose-50 text-rose-700",
    violet: "bg-violet-50 text-violet-700",
  };
  const ringMap = {
    teal: "ring-teal-500",
    indigo: "ring-indigo-500",
    amber: "ring-amber-500",
    emerald: "ring-emerald-500",
    rose: "ring-rose-500",
    violet: "ring-violet-500",
  };
  const clickable = typeof onClick === "function";
  const cls =
    "bg-white border rounded-xl p-4 transition-shadow text-left w-full" +
    (clickable ? " cursor-pointer hover:shadow-md" : " hover:shadow-md") +
    (active ? ` ring-2 ${ringMap[accent] || ringMap.teal} shadow-md` : "");
  const inner = (
    <>
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
    </>
  );
  return clickable
    ? <button type="button" onClick={onClick} className={cls}>{inner}</button>
    : <div className={cls}>{inner}</div>;
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

const PIE_COLORS = ["#0d9488", "#6366f1", "#f59e0b", "#ef4444", "#10b981", "#8b5cf6", "#ec4899", "#14b8a6", "#f43f5e", "#84cc16"];

// ─── main component ─────────────────────────────────────────────────────────
export default function ReportsAnalytics({ user }) {
  // Filter state — applied separately so users can edit without firing fetches
  const [fromDate, setFromDate] = useState(monthsAgoISO(6));
  const [toDate, setToDate] = useState(todayISO());
  const [branchFilter, setBranchFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState(""); // "" | "group" | "individual"
  const [appliedFrom, setAppliedFrom] = useState(fromDate);
  const [appliedTo, setAppliedTo] = useState(toDate);
  const [appliedBranch, setAppliedBranch] = useState("");
  const [appliedProduct, setAppliedProduct] = useState("");
  const [appliedCategory, setAppliedCategory] = useState("");

  // Data state
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Recent-disbursements table state
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("disbursement_date_iso");
  const [sortDir, setSortDir] = useState("desc");

  // Selected KPI view — controls which focused detail section is shown below
  // the KPI cards. "overview" = full layout (trend + branch + product +
  // category + table). Any other value swaps in a focused view for that KPI.
  // count | amount | avgTicket | customers | dates | branch | product | active | closed | pending
  const [view, setView] = useState("overview");
  const setKpiView = (v) => setView(prev => prev === v ? "overview" : v);

  // Independent sort state for the Unique Customers focused view, so toggling
  // it doesn't disturb the recent-disbursements table sort.
  const [custSortKey, setCustSortKey] = useState("total");
  const [custSortDir, setCustSortDir] = useState("desc");
  const handleCustSort = (key) => {
    if (custSortKey === key) setCustSortDir(d => d === "asc" ? "desc" : "asc");
    else { setCustSortKey(key); setCustSortDir("desc"); }
  };

  // Branch / product dropdown options — derived from the latest fetch.
  // (Users see the full universe regardless of which one is currently filtered.)
  const [branchOptions, setBranchOptions] = useState([]);
  const [productOptions, setProductOptions] = useState([]);

  // ── fetch ──
  // Re-fetches when the underlying filters OR the selected status view change.
  // Server-side status filter ensures we get the FULL list of matching rows
  // (not just the most recent N), so when "Closed" is clicked we see all
  // closed customers, not the few that happened to be in the last 200.
  const fetchData = useCallback(async () => {
    setLoading(true); setErrorMsg("");
    try {
      const p = new URLSearchParams();
      if (appliedFrom) p.set("from", appliedFrom);
      if (appliedTo)   p.set("to", appliedTo);
      if (appliedBranch) p.set("branch", appliedBranch);
      if (appliedProduct) p.set("product", appliedProduct);
      if (appliedCategory) p.set("category", appliedCategory);
      // When a status pill is the active view, ask the server for that status.
      if (view === "active" || view === "closed" || view === "pending") {
        p.set("status", view);
      }
      const res = await fetch(`/api/od/disbursements?${p.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      // Capture full option lists on first unfiltered fetch.
      if (!appliedBranch && !appliedProduct && !appliedCategory) {
        setBranchOptions((json.byBranch || []).map(b => b.key).filter(Boolean));
        setProductOptions((json.byProduct || []).map(b => b.key).filter(Boolean));
      }
    } catch (e) {
      setErrorMsg(e.message || "Failed to load disbursement data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [appliedFrom, appliedTo, appliedBranch, appliedProduct, appliedCategory, view]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Sync the table sort to whichever KPI/view is selected, so the data the
  // user sees matches the focus they picked. Users can still click any column
  // header to override.
  useEffect(() => {
    switch (view) {
      case "amount":
      case "avgTicket":
        setSortKey("loan_amount"); setSortDir("desc"); break;
      case "branch":
        setSortKey("branch"); setSortDir("asc"); break;
      case "product":
        setSortKey("product_name"); setSortDir("asc"); break;
      case "dates":
        setSortKey("disbursement_date_iso"); setSortDir("desc"); break;
      case "count":
      case "overview":
      default:
        setSortKey("disbursement_date_iso"); setSortDir("desc"); break;
    }
  }, [view]);

  // ── apply / preset handlers ──
  const handleApply = () => {
    setAppliedFrom(fromDate);
    setAppliedTo(toDate);
    setAppliedBranch(branchFilter);
    setAppliedProduct(productFilter);
    setAppliedCategory(categoryFilter);
  };

  const handlePresetThisMonth = () => { setFromDate(startOfMonthISO()); setToDate(todayISO()); };
  const handlePresetLast3Months = () => { setFromDate(monthsAgoISO(3)); setToDate(todayISO()); };
  const handlePresetThisYear = () => { setFromDate(startOfYearISO()); setToDate(todayISO()); };

  // ── derived ──
  const summary = data?.summary || { count: 0, totalAmount: 0, avgTicket: 0, customerCount: 0, active: 0, closed: 0, pending: 0 };
  const byBranch = data?.byBranch || [];
  const byProduct = data?.byProduct || [];
  const byCategory = data?.byCategory || [];
  const byMonth = data?.byMonth || [];
  const recent = data?.recent || [];

  const filteredRecent = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Status filter — only when one of the status pills is selected.
    const statusFilter = view === "active" ? "Active"
                       : view === "closed" ? "Closed"
                       : view === "pending" ? "Pending"
                       : null;
    let arr = recent.filter(r => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (q) {
        return (r.customer_name || "").toLowerCase().includes(q) ||
               (r.loan_account_no || "").toLowerCase().includes(q) ||
               (r.customer_number || "").toLowerCase().includes(q) ||
               (r.branch || "").toLowerCase().includes(q) ||
               (r.product_name || "").toLowerCase().includes(q);
      }
      return true;
    });
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const an = Number(av), bn = Number(bv);
      const numeric = Number.isFinite(an) && Number.isFinite(bn) && av !== "" && bv !== "";
      const cmp = numeric ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [recent, search, sortKey, sortDir, view]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  // ── exports ──
  const exportRowsForCSV = () =>
    filteredRecent.map((r) => ({
      LoanAccount: r.loan_account_no || "",
      CustomerID: r.customer_number || "",
      CustomerName: r.customer_name || "",
      Branch: r.branch || "",
      Product: r.product_name || "",
      Category: r.loan_category || "",
      DisbursementDate: r.disbursement_date_iso || "",
      LoanAmount: r.loan_amount || 0,
      Status: r.status || "",
    }));

  const handleExportCSV = () => downloadCSV(exportRowsForCSV(), `reports-products-${todayISO()}.csv`);
  // Note: this is a CSV under the hood — Excel opens it natively. We dropped the .xls
  // extension because writing CSV to a .xls file makes Excel show a format-mismatch warning
  // on open. To make this a real .xlsx export, add SheetJS and rebuild this function.
  const handleExportExcel = () => downloadCSV(exportRowsForCSV(), `reports-products-${todayISO()}.csv`);
  const handleExportPDF = () => {
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    const rowsHtml = filteredRecent
      .map(r =>
        `<tr><td>${r.disbursement_date_iso || ""}</td><td>${r.customer_name || ""}</td><td>${r.loan_account_no || ""}</td><td>${r.branch || ""}</td><td>${r.product_name || ""}</td><td>${r.loan_category || ""}</td><td>${formatINR(r.loan_amount)}</td><td>${r.status || ""}</td></tr>`
      ).join("");
    w.document.write(`
      <!doctype html><html><head><title>Disbursement Report — ${todayISO()}</title>
      <style>
        body{font-family:system-ui,sans-serif;padding:24px;color:#111}
        h1{margin:0 0 4px;font-size:20px}
        h2{margin:24px 0 8px;font-size:14px;color:#374151}
        table{border-collapse:collapse;width:100%;font-size:12px}
        th,td{border:1px solid #d1d5db;padding:6px 10px;text-align:left}
        th{background:#f3f4f6;font-weight:600}
      </style></head><body>
      <h1>Disbursement Analytics</h1>
      <div>Period: ${appliedFrom} → ${appliedTo}${appliedBranch ? ` · Branch: ${appliedBranch}` : ""}${appliedProduct ? ` · Product: ${appliedProduct}` : ""}${appliedCategory ? ` · Category: ${appliedCategory}` : ""} · Generated: ${new Date().toLocaleString()}</div>
      <h2>Summary</h2>
      <table><tr>
        <th>Total Disbursements</th><td>${formatNum(summary.count)}</td>
        <th>Total Amount</th><td>${formatINR(summary.totalAmount)}</td>
        <th>Avg Ticket</th><td>${formatINR(summary.avgTicket)}</td>
        <th>Customers</th><td>${formatNum(summary.customerCount)}</td>
      </tr><tr>
        <th>Active</th><td>${formatNum(summary.active)}</td>
        <th>Closed</th><td>${formatNum(summary.closed)}</td>
        <th>Pending</th><td>${formatNum(summary.pending)}</td>
        <th></th><td></td>
      </tr></table>
      <h2>Disbursements (showing ${filteredRecent.length})</h2>
      <table>
        <thead><tr><th>Date</th><th>Customer</th><th>Loan A/C</th><th>Branch</th><th>Product</th><th>Category</th><th>Amount</th><th>Status</th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <script>window.onload=()=>window.print()</script>
      </body></html>
    `);
    w.document.close();
  };

  // ── trend chart series (count + amount per month) ──
  const trendData = useMemo(
    () => byMonth.map(m => ({ month: m.key, count: m.count, total: Math.round(m.total) })),
    [byMonth]
  );

  // ── product pie chart ──
  const productPie = useMemo(
    () => byProduct.slice(0, 10).map(p => ({ name: p.key, value: p.total, count: p.count })),
    [byProduct]
  );

  // ────────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* 1. Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-teal-50 rounded-lg text-teal-700"><Activity size={20} /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Reports &amp; Analytics</h1>
            <p className="text-xs text-gray-500">Disbursement analytics from the Pool Reports uploaded via OD Upload</p>
          </div>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs bg-teal-600 text-white px-3 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* 2. Filter Toolbar */}
      <div className="bg-gray-50 border rounded-xl px-4 py-3 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block flex items-center gap-1">
              <Calendar size={11} /> Disbursement From
            </label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-1.5 text-sm bg-white" />
          </div>
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block flex items-center gap-1">
              <Calendar size={11} /> Disbursement To
            </label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="w-full border rounded-lg px-3 py-1.5 text-sm bg-white" />
          </div>
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block flex items-center gap-1">
              <Building2 size={11} /> Branch
            </label>
            <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
              className="w-full border rounded-lg px-3 py-1.5 text-sm bg-white">
              <option value="">All branches</option>
              {branchOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block flex items-center gap-1">
              <Package size={11} /> Product
            </label>
            <select value={productFilter} onChange={e => setProductFilter(e.target.value)}
              className="w-full border rounded-lg px-3 py-1.5 text-sm bg-white">
              <option value="">All products</option>
              {productOptions.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">Category</label>
            <div className="flex rounded-lg border overflow-hidden text-xs">
              {[["", "All"], ["group", "Group"], ["individual", "Individual"]].map(([k, label]) => (
                <button
                  key={k || "all"}
                  onClick={() => setCategoryFilter(k)}
                  className={`flex-1 px-2 py-1.5 ${categoryFilter === k ? "bg-teal-600 text-white" : "bg-white text-gray-700 hover:bg-gray-100"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <button onClick={handleApply}
              className="w-full inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700">
              <Filter size={14} /> Apply
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          <span className="text-[11px] text-gray-500 mr-1">Quick range:</span>
          <button onClick={handlePresetThisMonth}
            className="text-[11px] px-2.5 py-1 bg-white border rounded-md hover:bg-gray-100 text-gray-700">This Month</button>
          <button onClick={handlePresetLast3Months}
            className="text-[11px] px-2.5 py-1 bg-white border rounded-md hover:bg-gray-100 text-gray-700">Last 3 Months</button>
          <button onClick={handlePresetThisYear}
            className="text-[11px] px-2.5 py-1 bg-white border rounded-md hover:bg-gray-100 text-gray-700">This Year</button>
        </div>
        {errorMsg && (
          <div className="mt-2 text-[11px] text-rose-700 bg-rose-50 px-2 py-1 rounded">{errorMsg}</div>
        )}
      </div>

      {/* 3. KPI cards — clickable, switch the focused detail view below */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard icon={Activity} label="Total Disbursements" value={formatNum(summary.count)}
          accent="teal" hint="Click to see all disbursement records"
          onClick={() => setKpiView("count")} active={view === "count"} />
        <SummaryCard icon={Wallet} label="Total Amount" value={formatINR(summary.totalAmount)}
          accent="indigo" hint="Click to see amount breakdown"
          onClick={() => setKpiView("amount")} active={view === "amount"} />
        <SummaryCard icon={TrendingUp} label="Avg Ticket Size" value={formatINR(summary.avgTicket)}
          accent="emerald" hint="Click to see ticket-size distribution"
          onClick={() => setKpiView("avgTicket")} active={view === "avgTicket"} />
        <SummaryCard icon={Users} label="Unique Customers" value={formatNum(summary.customerCount)}
          accent="amber" hint="Click to see customer-grouped list"
          onClick={() => setKpiView("customers")} active={view === "customers"} />
      </div>

      {/* View-switcher strip — additional non-KPI views */}
      <div className="flex flex-wrap gap-1.5 items-center">
        <span className="text-[11px] text-gray-500 mr-1">View:</span>
        {[
          ["overview", "Overview"],
          ["count", "All Records"],
          ["dates", "By Date"],
          ["branch", "By Branch"],
          ["product", "By Product"],
          ["amount", "By Amount"],
          ["avgTicket", "Avg Ticket"],
          ["customers", "By Customer"],
          ["active", "Active"],
          ["closed", "Closed"],
          ["pending", "Pending"],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={`text-[11px] px-2.5 py-1 border rounded-md ${view === k ? "bg-teal-600 text-white border-teal-700" : "bg-white text-gray-700 hover:bg-gray-100"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* 4. Status split — clickable. Visible on Overview AND on the
          active / closed / pending focused views (so user can re-toggle). */}
      {(view === "overview" || view === "active" || view === "closed" || view === "pending") && (
        <div className="grid grid-cols-3 gap-3">
          <button type="button" onClick={() => setKpiView("active")}
            className={`bg-emerald-50 border rounded-xl p-3 text-center cursor-pointer hover:shadow-md transition-shadow ${view === "active" ? "border-emerald-500 ring-2 ring-emerald-500 shadow-md" : "border-emerald-200"}`}>
            <p className="text-[11px] text-emerald-700 uppercase tracking-wide">Active</p>
            <p className="text-2xl font-extrabold text-emerald-700">{formatNum(summary.active)}</p>
            <p className="text-[10px] text-gray-500">Has pool snapshot, not closed</p>
          </button>
          <button type="button" onClick={() => setKpiView("closed")}
            className={`bg-gray-100 border rounded-xl p-3 text-center cursor-pointer hover:shadow-md transition-shadow ${view === "closed" ? "border-gray-500 ring-2 ring-gray-500 shadow-md" : "border-gray-300"}`}>
            <p className="text-[11px] text-gray-700 uppercase tracking-wide">Closed</p>
            <p className="text-2xl font-extrabold text-gray-700">{formatNum(summary.closed)}</p>
            <p className="text-[10px] text-gray-500">In foreclosure_snapshots</p>
          </button>
          <button type="button" onClick={() => setKpiView("pending")}
            className={`bg-amber-50 border rounded-xl p-3 text-center cursor-pointer hover:shadow-md transition-shadow ${view === "pending" ? "border-amber-500 ring-2 ring-amber-500 shadow-md" : "border-amber-200"}`}>
            <p className="text-[11px] text-amber-700 uppercase tracking-wide">Pending / No-Snapshot</p>
            <p className="text-2xl font-extrabold text-amber-700">{formatNum(summary.pending)}</p>
            <p className="text-[10px] text-gray-500">Customer master only</p>
          </button>
        </div>
      )}

      {/* Focused view — Avg Ticket distribution stats */}
      {view === "avgTicket" && (
        <SectionCard title="Average Ticket Size — calculation & distribution" subtitle={`${formatINR(summary.avgTicket)} = ${formatINR(summary.totalAmount)} ÷ ${formatNum(summary.count)} disbursements`}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-gray-50 border rounded-lg p-3">
              <p className="text-[11px] text-gray-500">Min</p>
              <p className="text-sm font-bold">{formatINR(Math.min(...recent.map(r => r.loan_amount).filter(v => v > 0)))}</p>
            </div>
            <div className="bg-gray-50 border rounded-lg p-3">
              <p className="text-[11px] text-gray-500">Max</p>
              <p className="text-sm font-bold">{formatINR(Math.max(0, ...recent.map(r => r.loan_amount)))}</p>
            </div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <p className="text-[11px] text-emerald-700">Average</p>
              <p className="text-sm font-bold text-emerald-700">{formatINR(summary.avgTicket)}</p>
            </div>
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
              <p className="text-[11px] text-indigo-700">Sample size</p>
              <p className="text-sm font-bold text-indigo-700">{formatNum(summary.count)}</p>
            </div>
          </div>
          <p className="text-[11px] text-gray-500">Sample size = total disbursements matching the current filters. The recent-disbursements table below shows individual ticket sizes — click a column header to sort.</p>
        </SectionCard>
      )}

      {/* Focused view — Customer-grouped list (sortable by any column, both
          ascending and descending). Uses an independent sort state so it
          doesn't interfere with the recent-disbursements table below. */}
      {view === "customers" && (() => {
        // Group recent disbursements by customer_number (build once per render).
        const grouped = new Map();
        for (const r of recent) {
          const k = r.customer_number || r.customer_name || "-";
          const cur = grouped.get(k) || { id: k, name: r.customer_name || "", branch: r.branch || "", loans: 0, total: 0 };
          cur.loans += 1;
          cur.total += Number(r.loan_amount) || 0;
          grouped.set(k, cur);
        }
        const arr = [...grouped.values()].sort((a, b) => {
          const av = a[custSortKey], bv = b[custSortKey];
          const an = Number(av), bn = Number(bv);
          const numeric = Number.isFinite(an) && Number.isFinite(bn) && av !== "" && bv !== "";
          const cmp = numeric ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""));
          return custSortDir === "asc" ? cmp : -cmp;
        });
        return (
          <SectionCard title="Unique Customers" subtitle={`${formatNum(summary.customerCount)} distinct customer IDs across the filtered disbursements`}>
            <div className="overflow-x-auto rounded-lg border max-h-[500px] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <SortHeader sortKey="id" currentKey={custSortKey} currentDir={custSortDir} onSort={handleCustSort}>Customer ID</SortHeader>
                    <SortHeader sortKey="name" currentKey={custSortKey} currentDir={custSortDir} onSort={handleCustSort}>Customer Name</SortHeader>
                    <SortHeader sortKey="branch" currentKey={custSortKey} currentDir={custSortDir} onSort={handleCustSort}>Branch</SortHeader>
                    <SortHeader sortKey="loans" currentKey={custSortKey} currentDir={custSortDir} onSort={handleCustSort} align="right">Loans</SortHeader>
                    <SortHeader sortKey="total" currentKey={custSortKey} currentDir={custSortDir} onSort={handleCustSort} align="right">Total Disbursed</SortHeader>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {arr.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-gray-400">No customers in current filter.</td></tr>
                  ) : arr.map(c => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-mono text-gray-500">{c.id}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{c.name || "—"}</td>
                      <td className="px-3 py-2 text-gray-700">{c.branch || "—"}</td>
                      <td className="px-3 py-2 text-right">{c.loans}</td>
                      <td className="px-3 py-2 text-right font-semibold">{formatINR(c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[11px] text-gray-500 mt-2">
              Showing {arr.length} unique customers · Click any column header to sort ascending/descending.
            </div>
          </SectionCard>
        );
      })()}

      {/* 5. Trend chart — overview + dates view */}
      {(view === "overview" || view === "dates") && (
      <SectionCard title="Disbursement Trend" subtitle="Monthly disbursement volume and total amount">
        {trendData.length === 0 ? (
          <div className="text-gray-400 text-sm py-6 text-center">No disbursements in this range.</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" fontSize={11} />
              <YAxis yAxisId="left" fontSize={11} tickFormatter={v => formatNum(v)} />
              <YAxis yAxisId="right" orientation="right" fontSize={11} tickFormatter={v => Math.round(v / 100000) + "L"} />
              <Tooltip formatter={(value, name) => name === "total" ? formatINR(value) : formatNum(value)} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="left" type="monotone" dataKey="count" stroke="#0d9488" strokeWidth={2} name="Count" />
              <Line yAxisId="right" type="monotone" dataKey="total" stroke="#6366f1" strokeWidth={2} name="Amount" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </SectionCard>
      )}

      {/* 6. Branch + Product breakdowns — overview shows both side-by-side;
          focused branch/product views show just the relevant chart full-width. */}
      {(view === "overview" || view === "branch" || view === "product") && (
      <div className={view === "overview" ? "grid grid-cols-1 lg:grid-cols-2 gap-4" : "grid grid-cols-1 gap-4"}>
        {(view === "overview" || view === "branch") && (
        <SectionCard title="Branch-wise Disbursements" subtitle="Top 30 branches by total disbursed amount">
          {byBranch.length === 0 ? (
            <div className="text-gray-400 text-sm py-6 text-center">No data.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={byBranch.slice(0, 15)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="key" fontSize={11} interval={0} angle={-30} textAnchor="end" height={60} />
                <YAxis fontSize={11} tickFormatter={v => Math.round(v / 100000) + "L"} />
                <Tooltip formatter={v => formatINR(v)} />
                <Bar dataKey="total" fill="#0d9488" name="Disbursed" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
        )}
        {(view === "overview" || view === "product") && (
        <SectionCard title="Product-wise Disbursements" subtitle="Top 10 products by amount">
          {productPie.length === 0 ? (
            <div className="text-gray-400 text-sm py-6 text-center">No data.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={productPie} cx="50%" cy="50%" innerRadius={45} outerRadius={85}
                  dataKey="value" label={(e) => e.name}>
                  {productPie.map((p, i) => <Cell key={p.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v, n, e) => [`${formatINR(v)} (${formatNum(e.payload.count)} loans)`, e.payload.name]} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
        )}
      </div>
      )}

      {/* 7. Category split — overview only */}
      {view === "overview" && (
      <SectionCard title="Loan Category Split" subtitle="Group Loan vs Individual Loan disbursements">
        {byCategory.length === 0 ? (
          <div className="text-gray-400 text-sm py-6 text-center">No data.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byCategory} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" fontSize={11} tickFormatter={v => Math.round(v / 100000) + "L"} />
                <YAxis type="category" dataKey="key" fontSize={12} width={100} />
                <Tooltip formatter={v => formatINR(v)} />
                <Bar dataKey="total" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {byCategory.map((c) => (
                <div key={c.key} className="flex items-center justify-between bg-white border rounded-lg p-3">
                  <span className="font-medium text-gray-800">{c.key}</span>
                  <div className="text-right">
                    <div className="font-bold text-gray-900">{formatINR(c.total)}</div>
                    <div className="text-[11px] text-gray-500">{formatNum(c.count)} loans</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>
      )}

      {/* 8. Recent disbursements table */}
      <SectionCard
        title={view === "active" ? "Active Disbursements"
             : view === "closed" ? "Closed Disbursements"
             : view === "pending" ? "Pending / No-Snapshot Disbursements"
             : view === "customers" ? "Recent Disbursements (per-customer view shown above)"
             : view === "amount" ? "Disbursements (sorted by amount)"
             : "Recent Disbursements"}
        subtitle={`Showing ${filteredRecent.length} of ${recent.length} disbursements${view === "active" || view === "closed" || view === "pending" ? ` filtered to ${view}` : ""}`}
        action={
          <div className="relative">
            <Search size={12} className="absolute left-2 top-2 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search name / loan / branch…"
              className="border rounded-md pl-7 pr-2 py-1 text-xs w-56" />
          </div>
        }
      >
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-gray-50">
              <tr>
                <SortHeader sortKey="disbursement_date_iso" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Date</SortHeader>
                <SortHeader sortKey="customer_name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Customer</SortHeader>
                <SortHeader sortKey="loan_account_no" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Loan A/C</SortHeader>
                <SortHeader sortKey="branch" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Branch</SortHeader>
                <SortHeader sortKey="product_name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Product</SortHeader>
                <SortHeader sortKey="loan_category" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Category</SortHeader>
                <SortHeader sortKey="loan_amount" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right">Amount</SortHeader>
                <SortHeader sortKey="status" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Status</SortHeader>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRecent.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">No disbursements match the current filters.</td></tr>
              ) : (
                filteredRecent.map((r) => (
                  <tr key={r.loan_account_no} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-700">{r.disbursement_date_iso || "—"}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">{r.customer_name || "—"}</td>
                    <td className="px-3 py-2 font-mono text-gray-500">{r.loan_account_no}</td>
                    <td className="px-3 py-2 text-gray-700">{r.branch || "—"}</td>
                    <td className="px-3 py-2 text-gray-700">{r.product_name || "—"}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        /GROUP/i.test(r.loan_category || "") ? "bg-teal-100 text-teal-700"
                        : /INDIVIDUAL/i.test(r.loan_category || "") ? "bg-indigo-100 text-indigo-700"
                        : "bg-gray-100 text-gray-700"
                      }`}>{r.loan_category || "—"}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{formatINR(r.loan_amount)}</td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        r.status === "Closed" ? "bg-gray-200 text-gray-700"
                        : r.status === "Active" ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                      }`}>{r.status}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="text-[11px] text-gray-500 mt-2">
          Showing {filteredRecent.length} of {recent.length} disbursements
          {search && <> · filtered by "<b>{search}</b>"</>}
        </div>
      </SectionCard>

      {/* 9. Reports — Export only (no upload here; OD Upload is the single write path) */}
      <SectionCard title="Reports" subtitle="Export the current view. Upload happens exclusively in the OD Upload section.">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button onClick={handleExportPDF}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-rose-600 text-white text-sm rounded-lg hover:bg-rose-700">
            <FileDown size={14} /> Export PDF
          </button>
          <button onClick={handleExportCSV}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-teal-600 text-white text-sm rounded-lg hover:bg-teal-700">
            <Download size={14} /> Export CSV
          </button>
          <button onClick={handleExportExcel}
            className="flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700">
            <FileSpreadsheet size={14} /> Export Excel
          </button>
        </div>
      </SectionCard>
    </div>
  );
}
