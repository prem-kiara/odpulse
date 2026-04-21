// OD Insights — components that surface data from the SQLite-backed OD endpoints.
//
//   CustomerInfoPanel  — inline panel next to Loan Account No. in entry forms & records table.
//   DataUploadPage     — admin + elevated_staff screen to upload the two daily CSVs.
//   CollectionDashboard — analytics: efficiency, DPD buckets, OD trend, branches, officers,
//                         PTP conversion, foreclosure opportunities, non-contactable.

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import {
  Upload, CheckCircle, AlertTriangle, Clock, FileText, Database, RefreshCw,
  Search, Download, Users, TrendingUp, Phone, PhoneOff, Target, DollarSign,
} from "lucide-react";

const API_BASE = "/api";
const COLORS = ["#0f766e", "#06b6d4", "#8b5cf6", "#f59e0b", "#ef4444", "#10b981", "#ec4899", "#6366f1", "#14b8a6", "#f97316"];

const formatINR = (num) => {
  if (num == null || num === "") return "Rs. 0";
  const n = Number(num);
  if (!Number.isFinite(n)) return "Rs. 0";
  const parts = Math.abs(n).toFixed(0).split("");
  let formatted;
  if (parts.length <= 3) {
    formatted = parts.join("");
  } else {
    const last3 = parts.slice(-3).join("");
    const rest = parts.slice(0, -3);
    const groups = [];
    while (rest.length > 0) groups.unshift(rest.splice(-2).join(""));
    formatted = groups.join(",") + "," + last3;
  }
  return `Rs. ${n < 0 ? "-" : ""}${formatted}`;
};

const formatLakhs = (num) => {
  const n = Number(num);
  if (!Number.isFinite(n)) return "Rs. 0";
  if (n >= 10000000) return `Rs. ${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `Rs. ${(n / 100000).toFixed(2)} L`;
  if (n >= 1000) return `Rs. ${(n / 1000).toFixed(1)} K`;
  return formatINR(n);
};

const formatDateDMY = (isoDate) => {
  if (!isoDate) return "";
  const [y, m, d] = String(isoDate).slice(0, 10).split("-");
  if (!y || !m || !d) return isoDate;
  return `${d}-${m}-${y}`;
};

// ─── CustomerInfoPanel ─────────────────────────────────────────────────────
// Shows live OD data + key customer master fields for a given loan account number.
// Debounced 400ms so typing doesn't fire on every keystroke.
export function CustomerInfoPanel({ loanAccountNo, customerId, compact = false, hideValueBoxes = false, onData }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const reqRef = useRef(0);
  const onDataRef = useRef(onData);
  useEffect(() => { onDataRef.current = onData; }, [onData]);

  useEffect(() => {
    const loan = (loanAccountNo || "").trim();
    const cust = (customerId || "").trim();
    if (!loan && !cust) { setData(null); setError(""); onDataRef.current && onDataRef.current(null); return; }

    const myReq = ++reqRef.current;
    setLoading(true);
    setError("");

    const timer = setTimeout(() => {
      const q = new URLSearchParams();
      if (loan) q.set("loanAccountNo", loan);
      if (cust) q.set("customerId", cust);

      fetch(`${API_BASE}/od/customer-lookup?${q.toString()}`)
        .then(r => r.json())
        .then(json => {
          if (myReq !== reqRef.current) return; // superseded
          setLoading(false);
          if (json && json.found) {
            setData(json); setError("");
            onDataRef.current && onDataRef.current(json);
          }
          else {
            setData(null); setError(json?.error || json?.message || "No OD record found for this customer.");
            onDataRef.current && onDataRef.current(null);
          }
        })
        .catch(err => {
          if (myReq !== reqRef.current) return;
          setLoading(false);
          setError(err.message || "Lookup failed");
          setData(null);
          onDataRef.current && onDataRef.current(null);
        });
    }, 400);

    return () => clearTimeout(timer);
  }, [loanAccountNo, customerId]);

  if (!loanAccountNo && !customerId) return null;

  if (loading) {
    return (
      <div className="mt-3 p-4 bg-gray-50 border border-gray-200 rounded-lg flex items-center gap-2 text-gray-500 text-sm">
        <RefreshCw size={14} className="animate-spin" /> Looking up customer OD snapshot…
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2 text-amber-700 text-sm">
        <AlertTriangle size={14} /> {error}
      </div>
    );
  }

  if (!data) return null;

  const { customer, pool, accrued, principalOutstanding, accruedInterest, unpaidInterest, foreclosureValue, poolSnapshotDate, accruedSnapshotDate } = data;

  return (
    <div className="mt-3 bg-gradient-to-br from-teal-50 to-cyan-50 border border-teal-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database size={14} className="text-teal-700" />
          <span className="text-xs font-semibold text-teal-800 uppercase tracking-wide">
            Live OD Snapshot
          </span>
        </div>
        <span className="text-[11px] text-gray-500">
          Pool: {poolSnapshotDate ? formatDateDMY(poolSnapshotDate) : "—"} · Accrued: {accruedSnapshotDate ? formatDateDMY(accruedSnapshotDate) : "—"}
        </span>
      </div>

      {/* 4 core values — can be hidden by caller if shown elsewhere as form fields */}
      {!hideValueBoxes && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="bg-white rounded-lg p-3 border border-teal-100">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Principal Outstanding</div>
            <div className="text-sm font-semibold text-gray-900 mt-0.5">{formatINR(principalOutstanding)}</div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-teal-100">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Accrued Interest</div>
            <div className="text-sm font-semibold text-gray-900 mt-0.5">{formatINR(accruedInterest)}</div>
          </div>
          <div className="bg-white rounded-lg p-3 border border-teal-100">
            <div className="text-[10px] uppercase tracking-wide text-gray-500">Unpaid Interest</div>
            <div className="text-sm font-semibold text-gray-900 mt-0.5">{formatINR(unpaidInterest)}</div>
          </div>
          <div className="bg-teal-600 rounded-lg p-3 border border-teal-700 shadow-sm">
            <div className="text-[10px] uppercase tracking-wide text-teal-100">Foreclosure Value</div>
            <div className="text-base font-bold text-white mt-0.5">{formatINR(foreclosureValue)}</div>
          </div>
        </div>
      )}

      {/* Customer master context */}
      {!compact && customer && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs bg-white/60 rounded-lg p-3 border border-teal-100">
          <div><span className="text-gray-500">Name:</span> <span className="font-medium text-gray-800">{customer.customer_name || "—"}</span></div>
          <div><span className="text-gray-500">Spouse:</span> <span className="font-medium text-gray-800">{customer.spouse_name || "—"}</span></div>
          <div><span className="text-gray-500">Branch:</span> <span className="font-medium text-gray-800">{customer.branch || "—"}</span></div>
          <div><span className="text-gray-500">Center:</span> <span className="font-medium text-gray-800">{customer.center_name || "—"}</span></div>
          <div><span className="text-gray-500">Mobile:</span> <span className="font-medium text-gray-800">{customer.mobile_number || "—"}</span></div>
          <div><span className="text-gray-500">Residence:</span> <span className="font-medium text-gray-800">{customer.residence_phone || "—"}</span></div>
          <div><span className="text-gray-500">Aadhaar:</span> <span className="font-mono text-gray-800">{customer.aadhaar_number || "—"}</span></div>
          <div><span className="text-gray-500">Officer:</span> <span className="font-medium text-gray-800">{customer.officer_name || "—"}</span></div>
          <div><span className="text-gray-500">Product:</span> <span className="font-medium text-gray-800">{customer.product_name || "—"}</span></div>
          <div><span className="text-gray-500">Loan Amt:</span> <span className="font-medium text-gray-800">{formatINR(customer.loan_amount)}</span></div>
          <div><span className="text-gray-500">Disb. Date:</span> <span className="font-medium text-gray-800">{customer.disbursement_date || "—"}</span></div>
          <div><span className="text-gray-500">Last Paid:</span> <span className="font-medium text-gray-800">{customer.last_payment_date || "—"}</span></div>
        </div>
      )}

      {/* DPD classification badges */}
      {pool && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {pool.overdue_days != null && (
            <span className={`px-2 py-0.5 rounded-full font-medium ${pool.overdue_days > 90 ? "bg-red-100 text-red-700" : pool.overdue_days > 30 ? "bg-amber-100 text-amber-700" : pool.overdue_days > 0 ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}`}>
              DPD: {pool.overdue_days}
            </span>
          )}
          {pool.account_dpd_classification && (
            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">
              Acct: {pool.account_dpd_classification}
            </span>
          )}
          {pool.customer_dpd_classification && (
            <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 font-medium">
              Cust: {pool.customer_dpd_classification}
            </span>
          )}
          {pool.loan_status && (
            <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
              Status: {pool.loan_status}
            </span>
          )}
          {pool.installments_paid != null && (
            <span className="text-gray-500">Installments paid: <b className="text-gray-800">{pool.installments_paid}</b></span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── DataUploadPage ────────────────────────────────────────────────────────
export function DataUploadPage({ user }) {
  const [poolFile, setPoolFile] = useState(null);
  const [accruedFile, setAccruedFile] = useState(null);
  const [poolDate, setPoolDate] = useState(new Date().toISOString().slice(0, 10));
  const [accruedDate, setAccruedDate] = useState(new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // {kind: "success"|"error", text}
  const [history, setHistory] = useState({ uploads: [], latestPool: null, latestAccrued: null, totalCustomers: 0, retentionDays: 90 });

  const loadHistory = useCallback(() => {
    fetch(`${API_BASE}/od/upload-history`)
      .then(r => r.json())
      .then(json => setHistory(json || { uploads: [] }))
      .catch(() => {});
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const upload = async (kind) => {
    const f = kind === "pool" ? poolFile : accruedFile;
    const d = kind === "pool" ? poolDate : accruedDate;
    if (!f) { setMsg({ kind: "error", text: `Choose a ${kind} file first.` }); return; }
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("snapshotDate", d);
      const res = await fetch(`${API_BASE}/od/${kind}/upload`, {
        method: "POST",
        headers: { "x-od-role": user.role, "x-od-user": user.username || user.id },
        body: fd,
      });

      // Read body as text first so we can surface non-JSON errors (HTML error pages,
      // proxy timeouts that return empty bodies, etc.) instead of a useless
      // "Unexpected end of JSON input".
      const raw = await res.text();
      let json = null;
      if (raw) {
        try { json = JSON.parse(raw); } catch { /* non-JSON */ }
      }
      if (!res.ok) {
        const msg = (json && json.error) || raw || `HTTP ${res.status}`;
        throw new Error(msg.slice(0, 500));
      }
      if (!json) {
        throw new Error("Server returned an empty response — the upload may have timed out. Check the server console.");
      }
      setMsg({
        kind: "success",
        text: `${kind === "pool" ? "Pool" : "Accrued"} uploaded: ${json.rowCount} rows${json.newBranches ? `, ${json.newBranches} new branch(es)` : ""}.`,
      });
      if (kind === "pool") setPoolFile(null); else setAccruedFile(null);
      loadHistory();
    } catch (err) {
      setMsg({ kind: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const isUploader = user.role === "admin" || user.role === "elevated_staff";
  if (!isUploader) {
    return (
      <div className="p-8 text-center text-gray-500">
        <AlertTriangle className="mx-auto mb-2" /> You don't have permission to upload OD data.
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Daily OD Data Upload</h2>
        <p className="text-sm text-gray-500 mt-1">
          Upload the two daily reports. Data is de-duplicated per snapshot date. Retention: {history.retentionDays || 90} days.
        </p>
      </div>

      {/* Status tiles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
        <div className="bg-white border rounded-xl p-4">
          <div className="text-xs uppercase text-gray-500">Customers on Record</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{(history.totalCustomers || 0).toLocaleString()}</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="text-xs uppercase text-gray-500">Latest Pool Snapshot</div>
          <div className="text-lg font-bold text-teal-700 mt-1">{history.latestPool?.snapshot_date ? formatDateDMY(history.latestPool.snapshot_date) : "—"}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{(history.latestPool?.rows || 0).toLocaleString()} rows</div>
        </div>
        <div className="bg-white border rounded-xl p-4">
          <div className="text-xs uppercase text-gray-500">Latest Accrued Snapshot</div>
          <div className="text-lg font-bold text-indigo-700 mt-1">{history.latestAccrued?.snapshot_date ? formatDateDMY(history.latestAccrued.snapshot_date) : "—"}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{(history.latestAccrued?.rows || 0).toLocaleString()} rows</div>
        </div>
      </div>

      {msg && (
        <div className={`mb-4 p-3 rounded-lg border flex items-center gap-2 text-sm ${msg.kind === "success" ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700"}`}>
          {msg.kind === "success" ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
          {msg.text}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {/* Pool upload */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="text-teal-600" size={18} />
            <h3 className="font-semibold text-gray-900">Compressed Pool Report</h3>
          </div>
          <p className="text-xs text-gray-500 mb-4">Pipe-delimited. Customer master + pool snapshot (Principal Outstanding, Interest OverDue, DPD, etc.).</p>
          <label className="block text-xs font-medium text-gray-600 mb-1">Snapshot Date</label>
          <input type="date" value={poolDate} onChange={e => setPoolDate(e.target.value)}
            className="w-full mb-3 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 text-sm" />
          <label className="block text-xs font-medium text-gray-600 mb-1">CSV File</label>
          <input type="file" accept=".csv,.txt" onChange={e => setPoolFile(e.target.files?.[0] || null)}
            className="w-full text-sm mb-3 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-teal-50 file:text-teal-700 file:font-medium file:cursor-pointer" />
          {poolFile && <div className="text-xs text-gray-500 mb-3">Selected: {poolFile.name} ({(poolFile.size / 1024 / 1024).toFixed(2)} MB)</div>}
          <button onClick={() => upload("pool")} disabled={busy || !poolFile}
            className="w-full py-2.5 bg-teal-600 text-white rounded-lg font-semibold text-sm hover:bg-teal-700 disabled:bg-gray-300 flex items-center justify-center gap-2">
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
            Upload Pool Report
          </button>
        </div>

        {/* Accrued upload */}
        <div className="bg-white rounded-xl border p-5">
          <div className="flex items-center gap-2 mb-2">
            <FileText className="text-indigo-600" size={18} />
            <h3 className="font-semibold text-gray-900">Interest Accrued Not Due Report</h3>
          </div>
          <p className="text-xs text-gray-500 mb-4">Pipe or comma delimited (auto-detected). Per-BOD accrued interest values. Latest Accrued Interest column is auto-picked as "current".</p>
          <label className="block text-xs font-medium text-gray-600 mb-1">Snapshot Date</label>
          <input type="date" value={accruedDate} onChange={e => setAccruedDate(e.target.value)}
            className="w-full mb-3 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 text-sm" />
          <label className="block text-xs font-medium text-gray-600 mb-1">CSV File</label>
          <input type="file" accept=".csv,.txt" onChange={e => setAccruedFile(e.target.files?.[0] || null)}
            className="w-full text-sm mb-3 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:text-indigo-700 file:font-medium file:cursor-pointer" />
          {accruedFile && <div className="text-xs text-gray-500 mb-3">Selected: {accruedFile.name} ({(accruedFile.size / 1024 / 1024).toFixed(2)} MB)</div>}
          <button onClick={() => upload("accrued")} disabled={busy || !accruedFile}
            className="w-full py-2.5 bg-indigo-600 text-white rounded-lg font-semibold text-sm hover:bg-indigo-700 disabled:bg-gray-300 flex items-center justify-center gap-2">
            {busy ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
            Upload Accrued Report
          </button>
        </div>
      </div>

      {/* Upload history */}
      <div className="bg-white rounded-xl border">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-900">Recent Uploads</h3>
          <button onClick={loadHistory} className="text-xs text-teal-700 flex items-center gap-1 hover:text-teal-800">
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="text-left px-4 py-2">Kind</th>
                <th className="text-left px-4 py-2">Snapshot Date</th>
                <th className="text-left px-4 py-2">Filename</th>
                <th className="text-right px-4 py-2">Rows</th>
                <th className="text-right px-4 py-2">New Branches</th>
                <th className="text-left px-4 py-2">Uploaded By</th>
                <th className="text-left px-4 py-2">At</th>
              </tr>
            </thead>
            <tbody>
              {(!history.uploads || history.uploads.length === 0) ? (
                <tr><td colSpan={7} className="text-center text-gray-400 py-6">No uploads yet.</td></tr>
              ) : history.uploads.map(h => (
                <tr key={h.id} className="border-t">
                  <td className="px-4 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${h.kind === "pool" ? "bg-teal-100 text-teal-700" : "bg-indigo-100 text-indigo-700"}`}>{h.kind}</span>
                  </td>
                  <td className="px-4 py-2">{formatDateDMY(h.snapshot_date)}</td>
                  <td className="px-4 py-2 text-gray-600">{h.filename}</td>
                  <td className="px-4 py-2 text-right font-medium">{(h.row_count || 0).toLocaleString()}</td>
                  <td className="px-4 py-2 text-right">{h.new_branches || 0}</td>
                  <td className="px-4 py-2">{h.uploaded_by}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs">{h.uploaded_at ? new Date(h.uploaded_at).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── CollectionDashboard ───────────────────────────────────────────────────
// Reads server-side metric endpoints and renders charts for OD monitoring.
export function CollectionDashboard({ user, entries, branches }) {
  const [granularity, setGranularity] = useState("day"); // day | week | month
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [branchFilter, setBranchFilter] = useState("");

  const [dpd, setDpd] = useState(null);                 // {snapshotDate, buckets:[{bucket, accounts, overdue_amount, principal_outstanding}]}
  const [odTrend, setOdTrend] = useState([]);           // trend[] from {trend:[...]}
  const [branchConc, setBranchConc] = useState([]);     // branches[] from {snapshotDate, branches:[...]}
  const [nonContact, setNonContact] = useState([]);     // customers[] from {customers:[...]}
  const [foreOpp, setForeOpp] = useState([]);           // customers[] from {threshold, customers:[...]}
  const [efficiency, setEfficiency] = useState(null);   // {granularity, openingBook, totalCollected, efficiencyPct, series:[{bucket, collected, waiver, entries}]}
  const [officerProd, setOfficerProd] = useState([]);   // officers[] from {officers:[...]}
  const [ptpConv, setPtpConv] = useState(null);         // {totalPTPs, paid, pending, missed, conversionPct}
  const [loading, setLoading] = useState(false);

  const q = (params = {}) => {
    const p = new URLSearchParams();
    if (branchFilter) p.set("branch", branchFilter);
    for (const [k, v] of Object.entries(params)) if (v != null && v !== "") p.set(k, v);
    return p.toString();
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [dpdR, trendR, branchR, nonR, foreR, effR, offR, ptpR] = await Promise.all([
        fetch(`${API_BASE}/od/metrics/dpd-buckets?${q()}`).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/od/metrics/od-trend?${q()}`).then(r => r.json()).catch(() => ({ trend: [] })),
        fetch(`${API_BASE}/od/metrics/branch-concentration`).then(r => r.json()).catch(() => ({ branches: [] })),
        fetch(`${API_BASE}/od/metrics/non-contactable?${q()}`).then(r => r.json()).catch(() => ({ customers: [] })),
        fetch(`${API_BASE}/od/metrics/foreclosure-opportunity?threshold=0.5&${q()}`).then(r => r.json()).catch(() => ({ customers: [] })),
        fetch(`${API_BASE}/od/metrics/efficiency?${q({ granularity, from: fromDate, to: toDate })}`).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/od/metrics/officer-productivity?${q({ from: fromDate, to: toDate })}`).then(r => r.json()).catch(() => ({ officers: [] })),
        fetch(`${API_BASE}/od/metrics/ptp-conversion?${q({ from: fromDate, to: toDate })}`).then(r => r.json()).catch(() => null),
      ]);
      setDpd(dpdR);
      setOdTrend(Array.isArray(trendR?.trend) ? trendR.trend : (Array.isArray(trendR) ? trendR : []));
      setBranchConc(Array.isArray(branchR?.branches) ? branchR.branches : []);
      setNonContact(Array.isArray(nonR?.customers) ? nonR.customers : []);
      setForeOpp(Array.isArray(foreR?.customers) ? foreR.customers : []);
      setEfficiency(effR);
      setOfficerProd(Array.isArray(offR?.officers) ? offR.officers : []);
      setPtpConv(ptpR);
    } finally {
      setLoading(false);
    }
  }, [granularity, fromDate, toDate, branchFilter]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // DPD chart data — map bucket → {name, accounts, overdue_lakhs, principal_lakhs}
  const dpdChartData = useMemo(() => {
    if (!dpd?.buckets) return [];
    return dpd.buckets.map(b => ({
      name: b.bucket,
      accounts: b.accounts || 0,
      overdueL: Math.round((b.overdue_amount || 0) / 100000),
      principalL: Math.round((b.principal_outstanding || 0) / 100000),
    }));
  }, [dpd]);

  // Totals from DPD buckets (for headline KPIs)
  const dpdTotals = useMemo(() => {
    if (!dpd?.buckets) return { accounts: 0, overdueAmount: 0, principalOutstanding: 0 };
    return dpd.buckets.reduce((a, b) => ({
      accounts: a.accounts + (b.accounts || 0),
      overdueAmount: a.overdueAmount + (b.overdue_amount || 0),
      principalOutstanding: a.principalOutstanding + (b.principal_outstanding || 0),
    }), { accounts: 0, overdueAmount: 0, principalOutstanding: 0 });
  }, [dpd]);

  const severeDpd = useMemo(() => {
    if (!dpd?.buckets) return { accounts: 0, overdueAmount: 0 };
    return dpd.buckets
      .filter(b => b.bucket === "91-180" || b.bucket === "180+")
      .reduce((a, b) => ({
        accounts: a.accounts + (b.accounts || 0),
        overdueAmount: a.overdueAmount + (b.overdue_amount || 0),
      }), { accounts: 0, overdueAmount: 0 });
  }, [dpd]);

  // Non-contactable summary
  const nonContactSummary = useMemo(() => {
    const rows = nonContact || [];
    const overdueAmount = rows.reduce((s, r) => s + Number(r.overdue_amount || 0), 0);
    return { count: rows.length, overdueAmount };
  }, [nonContact]);

  const downloadCSV = (rows, filename) => {
    if (!rows?.length) return;
    const keys = Object.keys(rows[0]);
    const esc = (v) => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [keys.join(","), ...rows.map(r => keys.map(k => esc(r[k])).join(","))].join("\n");
    // Prepend UTF-8 BOM so Excel renders Tamil / non-ASCII characters correctly.
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">OD Insights</h2>
          <p className="text-sm text-gray-500">Live from daily Pool + Accrued snapshots. Snapshot date: {dpd?.snapshotDate ? formatDateDMY(dpd.snapshotDate) : "—"}</p>
        </div>
        <button onClick={loadAll}
          className="flex items-center gap-1.5 px-3 py-2 bg-white border rounded-lg text-sm hover:bg-gray-50">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border p-4 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
            className="w-full px-2.5 py-2 border rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
            className="w-full px-2.5 py-2 border rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Granularity</label>
          <select value={granularity} onChange={e => setGranularity(e.target.value)}
            className="w-full px-2.5 py-2 border rounded-lg text-sm">
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Branch</label>
          <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
            className="w-full px-2.5 py-2 border rounded-lg text-sm">
            <option value="">All Branches</option>
            {branches?.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <button onClick={loadAll}
          className="w-full py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700">
          Apply
        </button>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<DollarSign />} label="Total OD (Principal + Int.)" color="teal"
          value={formatLakhs(dpdTotals.overdueAmount)}
          sub={`${dpdTotals.accounts.toLocaleString()} accounts`} />
        <KpiCard icon={<AlertTriangle />} label="90+ DPD Exposure" color="red"
          value={formatLakhs(severeDpd.overdueAmount)}
          sub={`${severeDpd.accounts.toLocaleString()} accounts`} />
        <KpiCard icon={<Target />} label="Period Efficiency" color="indigo"
          value={efficiency?.efficiencyPct != null ? `${Number(efficiency.efficiencyPct).toFixed(1)}%` : "—"}
          sub={efficiency ? `${formatLakhs(efficiency.totalCollected || 0)} collected vs ${formatLakhs(efficiency.openingBook || 0)} book` : ""} />
        <KpiCard icon={<PhoneOff />} label="Non-contactable" color="amber"
          value={nonContactSummary.count.toLocaleString()}
          sub={`${formatLakhs(nonContactSummary.overdueAmount)} exposure`} />
      </div>

      {/* Row 1: DPD buckets + OD Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800">DPD Bucket Distribution</h3>
            <button onClick={() => downloadCSV(dpd?.buckets || [], "dpd-buckets.csv")}
              className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={dpdChartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis yAxisId="l" fontSize={11} />
              <YAxis yAxisId="r" orientation="right" fontSize={11} />
              <Tooltip formatter={(v, n) => n === "Overdue (L)" ? [`Rs. ${v}L`, "Overdue"] : [v, "Accounts"]} />
              <Legend />
              <Bar yAxisId="l" dataKey="accounts" fill="#0f766e" name="Accounts" />
              <Bar yAxisId="r" dataKey="overdueL" fill="#f59e0b" name="Overdue (L)" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800">Portfolio OD Trend</h3>
            <button onClick={() => downloadCSV(odTrend || [], "od-trend.csv")}
              className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={odTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="snapshot_date" fontSize={11} />
              <YAxis fontSize={11} tickFormatter={v => Math.round(v / 100000) + "L"} />
              <Tooltip formatter={v => formatLakhs(v)} />
              <Legend />
              <Bar dataKey="principal_outstanding" fill="#0f766e" name="Principal Outstanding" />
              <Bar dataKey="principal_overdue" fill="#ef4444" name="Principal Overdue" />
              <Bar dataKey="interest_overdue" fill="#f59e0b" name="Interest Overdue" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Row 2: Efficiency series + PTP */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-gray-800">Collection by {granularity[0].toUpperCase() + granularity.slice(1)}</h3>
              <p className="text-[11px] text-gray-500">Entries in period: {efficiency?.series?.reduce((s, x) => s + (x.entries || 0), 0) || 0}</p>
            </div>
            <button onClick={() => downloadCSV(efficiency?.series || [], `collection-${granularity}.csv`)}
              className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={efficiency?.series || []}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" fontSize={11} />
              <YAxis fontSize={11} tickFormatter={v => Math.round(v / 100000) + "L"} />
              <Tooltip formatter={v => formatLakhs(v)} />
              <Legend />
              <Bar dataKey="collected" fill="#0f766e" name="Collected" />
              <Bar dataKey="waiver" fill="#f59e0b" name="Waiver" />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-500 mt-2">
            Period efficiency: <b className="text-gray-800">{efficiency?.efficiencyPct != null ? Number(efficiency.efficiencyPct).toFixed(1) + "%" : "—"}</b> · Collected {formatLakhs(efficiency?.totalCollected || 0)} of opening book {formatLakhs(efficiency?.openingBook || 0)}
          </p>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold text-gray-800 mb-3">PTP Conversion</h3>
          {ptpConv ? (
            <>
              <div className="grid grid-cols-4 gap-2 mb-4">
                <Stat label="Total PTPs" value={(ptpConv.totalPTPs || 0).toLocaleString()} />
                <Stat label="Paid" value={(ptpConv.paid || 0).toLocaleString()} tone="green" />
                <Stat label="Pending" value={(ptpConv.pending || 0).toLocaleString()} tone="amber" />
                <Stat label="Missed" value={(ptpConv.missed || 0).toLocaleString()} tone="red" />
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={[
                    { name: "Paid", value: ptpConv.paid || 0 },
                    { name: "Pending", value: ptpConv.pending || 0 },
                    { name: "Missed", value: ptpConv.missed || 0 },
                  ]} cx="50%" cy="50%" innerRadius={50} outerRadius={75} dataKey="value"
                    label={(e) => `${e.name}: ${e.value}`}>
                    <Cell fill="#10b981" /><Cell fill="#f59e0b" /><Cell fill="#ef4444" />
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="text-center mt-2 text-xs text-gray-500">
                Conversion Rate: <b className="text-gray-800">{Number(ptpConv.conversionPct || 0).toFixed(1)}%</b>
              </div>
            </>
          ) : <div className="text-gray-400 text-sm">No PTP data.</div>}
        </div>
      </div>

      {/* Row 3: Branch concentration + Officer productivity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800">Top Branches by OD Exposure</h3>
            <button onClick={() => downloadCSV(branchConc, "branch-concentration.csv")}
              className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
          </div>
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={branchConc.slice(0, 15)} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" fontSize={10} tickFormatter={v => `${Math.round(v / 100000)}L`} />
              <YAxis dataKey="branch" type="category" fontSize={10} width={100} />
              <Tooltip formatter={v => formatLakhs(v)} />
              <Bar dataKey="overdue_amount" fill="#0f766e" name="Overdue" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800">Officer Productivity (period)</h3>
            <button onClick={() => downloadCSV(officerProd, "officer-productivity.csv")}
              className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
          </div>
          <div className="overflow-y-auto max-h-80">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white shadow-sm">
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-2">Officer</th>
                  <th className="py-2 pr-2 text-right">Entries</th>
                  <th className="py-2 pr-2 text-right">Collected</th>
                  <th className="py-2 pr-2 text-right">PTPs</th>
                  <th className="py-2 pr-2 text-right">Paid</th>
                  <th className="py-2 pr-2 text-right">Missed</th>
                </tr>
              </thead>
              <tbody>
                {officerProd.length === 0 ? (
                  <tr><td colSpan={6} className="py-4 text-center text-gray-400">No activity.</td></tr>
                ) : officerProd.map((o, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-1.5 pr-2">{o.officer || "—"}</td>
                    <td className="py-1.5 pr-2 text-right">{o.entries}</td>
                    <td className="py-1.5 pr-2 text-right font-medium text-teal-700">{formatLakhs(o.collected || 0)}</td>
                    <td className="py-1.5 pr-2 text-right">{o.ptps || 0}</td>
                    <td className="py-1.5 pr-2 text-right text-green-700">{o.ptpsPaid || 0}</td>
                    <td className="py-1.5 pr-2 text-right text-red-600">{o.ptpsMissed || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Row 4: Foreclosure opportunities + Non-contactable */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-gray-800">Foreclosure Opportunities</h3>
              <p className="text-xs text-gray-500">Foreclosure value ≤ 50% of original loan amount — settlement candidates.</p>
            </div>
            <button onClick={() => downloadCSV(foreOpp, "foreclosure-opportunities.csv")}
              className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
          </div>
          <div className="overflow-y-auto max-h-80">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-2">Customer</th>
                  <th className="py-2 pr-2">Branch</th>
                  <th className="py-2 pr-2 text-right">Foreclosure</th>
                  <th className="py-2 pr-2 text-right">Orig. Loan</th>
                  <th className="py-2 pr-2 text-right">DPD</th>
                </tr>
              </thead>
              <tbody>
                {foreOpp.length === 0 ? (
                  <tr><td colSpan={5} className="py-4 text-center text-gray-400">None.</td></tr>
                ) : foreOpp.slice(0, 100).map((f, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-1.5 pr-2">
                      <div className="font-medium">{f.customer_name || "—"}</div>
                      <div className="text-[10px] text-gray-400">{f.loan_account_no}</div>
                    </td>
                    <td className="py-1.5 pr-2">{f.branch}</td>
                    <td className="py-1.5 pr-2 text-right font-medium text-teal-700">{formatINR(f.foreclosure_value)}</td>
                    <td className="py-1.5 pr-2 text-right text-gray-500">{formatINR(f.loan_amount)}</td>
                    <td className="py-1.5 pr-2 text-right">{f.overdue_days || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-gray-800">Non-contactable Accounts</h3>
              <p className="text-xs text-gray-500">Overdue customers with both phone numbers missing.</p>
            </div>
            <button onClick={() => downloadCSV(nonContact, "non-contactable.csv")}
              className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
          </div>
          <div className="overflow-y-auto max-h-80">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-2">Customer</th>
                  <th className="py-2 pr-2">Branch</th>
                  <th className="py-2 pr-2 text-right">DPD</th>
                  <th className="py-2 pr-2 text-right">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {nonContact.length === 0 ? (
                  <tr><td colSpan={4} className="py-4 text-center text-gray-400">None.</td></tr>
                ) : nonContact.slice(0, 100).map((n, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-1.5 pr-2">
                      <div className="font-medium">{n.customer_name || "—"}</div>
                      <div className="text-[10px] text-gray-400">{n.loan_account_no}</div>
                    </td>
                    <td className="py-1.5 pr-2">{n.branch}</td>
                    <td className="py-1.5 pr-2 text-right">{n.overdue_days || 0}</td>
                    <td className="py-1.5 pr-2 text-right font-medium">{formatINR(n.overdue_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, sub, color }) {
  const palette = {
    teal:   "bg-teal-50 border-teal-200 text-teal-800",
    red:    "bg-red-50 border-red-200 text-red-800",
    indigo: "bg-indigo-50 border-indigo-200 text-indigo-800",
    amber:  "bg-amber-50 border-amber-200 text-amber-800",
  }[color] || "bg-gray-50 border-gray-200 text-gray-800";
  return (
    <div className={`rounded-xl border p-4 ${palette}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide opacity-70">
        {icon && React.cloneElement(icon, { size: 14 })}
        {label}
      </div>
      <div className="text-xl font-bold mt-1">{value}</div>
      {sub && <div className="text-[11px] opacity-70 mt-1">{sub}</div>}
    </div>
  );
}

function Stat({ label, value, tone }) {
  const color = tone === "green" ? "text-green-700"
               : tone === "amber" ? "text-amber-700"
               : tone === "red"   ? "text-red-700"
               : "text-gray-800";
  return (
    <div className="bg-gray-50 rounded-lg p-2 text-center">
      <div className="text-[10px] text-gray-500 uppercase">{label}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
    </div>
  );
}

export default { CustomerInfoPanel, DataUploadPage, CollectionDashboard };
