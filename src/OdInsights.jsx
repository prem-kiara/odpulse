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
  Activity, Calendar, CalendarRange, Skull, Wallet, Layers, Gauge, X,
  ChevronRight, Package, Building2, Grid3x3, CloudOff, Trash2,
} from "lucide-react";
import {
  enqueueUpload, listQueue, deleteFromQueue, drainQueue, isBackendUp,
} from "./uploadQueue";
import { SortableSection } from "./tableSort.jsx";

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

const formatPct = (n, digits = 1) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return `${v.toFixed(digits)}%`;
};

// Tailwind colour ramp for CE% (red → green)
const ceColor = (pct) => {
  if (pct == null || !Number.isFinite(pct)) return "text-gray-500";
  if (pct >= 95) return "text-emerald-700";
  if (pct >= 85) return "text-green-700";
  if (pct >= 70) return "text-amber-700";
  if (pct >= 50) return "text-orange-700";
  return "text-red-700";
};

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

// Hook: fetch periods list once and expose latest
const useLatestPeriod = () => {
  const [periods, setPeriods] = useState([]);
  useEffect(() => {
    fetch(`${API_BASE}/od/analytics/periods`).then(r => r.json())
      .then(j => setPeriods(Array.isArray(j?.periods) ? j.periods : []))
      .catch(() => setPeriods([]));
  }, []);
  const latest = periods[0] || null;
  return { periods, latest };
};

// ─── CustomerInfoPanel ─────────────────────────────────────────────────────
// Shows live OD data + key customer master fields for a given loan account number.
// Debounced 400ms so typing doesn't fire on every keystroke.
export function CustomerInfoPanel({ loanAccountNo, customerId, compact = false, hideValueBoxes = false, onData }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // NEW: all active loans for the same customer (fetched from /api/customers/loans)
  const [otherLoans, setOtherLoans] = useState([]);
  const [selectedLoan, setSelectedLoan] = useState(null);
  const reqRef = useRef(0);
  const loansReqRef = useRef(0);
  const onDataRef = useRef(onData);
  useEffect(() => { onDataRef.current = onData; }, [onData]);

  // Fetch the customer's OTHER active loans whenever the identifiers change.
  useEffect(() => {
    const loan = (loanAccountNo || "").trim();
    const cust = (customerId || "").trim();
    if (!loan && !cust) { setOtherLoans([]); return; }
    const myReq = ++loansReqRef.current;
    const q = new URLSearchParams();
    if (cust) q.set("customerId", cust);
    else if (loan) q.set("loanAccountNo", loan);
    const timer = setTimeout(() => {
      fetch(`${API_BASE}/customers/loans?${q.toString()}`)
        .then(r => r.json())
        .then(json => {
          if (myReq !== loansReqRef.current) return;
          if (json && json.found) setOtherLoans(json.loans || []);
          else setOtherLoans([]);
        })
        .catch(() => { if (myReq === loansReqRef.current) setOtherLoans([]); });
    }, 500);
    return () => clearTimeout(timer);
  }, [loanAccountNo, customerId]);

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

      {/* ── All Active Loans for this Customer ─────────────────────────────
         Shown below the single-loan OD Snapshot. Skipped in compact mode and
         when there is only one loan (the one already shown above). */}
      {!compact && otherLoans.length > 0 && (
        <div className="bg-white rounded-lg p-3 border border-teal-100">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-semibold text-teal-800 uppercase tracking-wide">
              All Active Loans for this Customer ({otherLoans.length})
            </div>
            <span className="text-[10px] text-gray-400">Click a loan to see full details</span>
          </div>
          <div className="space-y-2">
            {otherLoans.map(l => {
              const effDPD = Math.max(Number(l.customerDPD) || 0, Number(l.overdueDays) || 0);
              const isCurrent = l.loanAccountNo === loanAccountNo;
              const dpdClass = effDPD > 90 ? "bg-red-100 text-red-700"
                : effDPD > 60 ? "bg-orange-100 text-orange-700"
                : effDPD > 30 ? "bg-amber-100 text-amber-700"
                : effDPD > 0  ? "bg-yellow-100 text-yellow-700"
                : "bg-green-100 text-green-700";
              return (
                <div key={l.loanAccountNo}
                  onClick={() => setSelectedLoan(l)}
                  className={`p-2.5 rounded-lg border cursor-pointer transition-colors ${isCurrent ? "border-teal-500 bg-teal-50 ring-1 ring-teal-300" : "border-gray-200 bg-white hover:bg-teal-50 hover:border-teal-300"}`}>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold text-gray-800">{l.loanAccountNo}</span>
                      {isCurrent && <span className="text-[10px] font-bold text-teal-700 bg-teal-100 px-1.5 py-0.5 rounded">CURRENT</span>}
                      {l.branch && <span className="text-xs text-gray-500">· {l.branch}</span>}
                      {l.centerName && <span className="text-xs text-gray-500">· {l.centerName}</span>}
                    </div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${dpdClass}`}>{effDPD}d</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-xs">
                    <div><span className="text-gray-500">Outstanding:</span> <span className="font-medium text-gray-800">{formatINR(l.principalOutstanding)}</span></div>
                    <div><span className="text-gray-500">Unpaid Int:</span> <span className="font-medium text-gray-800">{formatINR(l.interestOverdue)}</span></div>
                    <div><span className="text-gray-500">Accrued:</span> <span className="font-medium text-gray-800">{formatINR(l.accruedInterest)}</span></div>
                    <div><span className="text-gray-500">Foreclosure:</span> <span className="font-bold text-teal-700">{formatINR(l.foreclosureValue)}</span></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Loan detail modal */}
      {selectedLoan && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSelectedLoan(null)}>
          <div className="bg-white rounded-xl shadow-xl p-5 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4 pb-3 border-b">
              <div>
                <h3 className="font-bold text-gray-900">{selectedLoan.customerName || "Customer"}</h3>
                <p className="text-xs text-gray-500 font-mono mt-0.5">Loan: {selectedLoan.loanAccountNo} · Cust ID: {selectedLoan.customerNumber}</p>
              </div>
              <button onClick={() => setSelectedLoan(null)} className="p-1 hover:bg-gray-100 rounded"><X size={18} /></button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3 p-3 bg-gray-50 rounded-lg">
                <div><span className="text-gray-500">Branch:</span> <span className="font-medium">{selectedLoan.branch || "—"}</span></div>
                <div><span className="text-gray-500">Center:</span> <span className="font-medium">{selectedLoan.centerName || "—"}</span></div>
                <div><span className="text-gray-500">Group:</span> <span className="font-medium">{selectedLoan.groupName || "—"}</span></div>
                <div><span className="text-gray-500">Product:</span> <span className="font-medium">{selectedLoan.productName || "—"}</span></div>
                <div><span className="text-gray-500">Interest Rate:</span> <span className="font-medium">{selectedLoan.interestRate ? `${selectedLoan.interestRate}%` : "—"}</span></div>
                <div><span className="text-gray-500">Loan Amount:</span> <span className="font-medium">{formatINR(selectedLoan.loanAmount)}</span></div>
                <div><span className="text-gray-500">Disbursed:</span> <span className="font-medium">{selectedLoan.disbursementDate ? formatDateDMY(selectedLoan.disbursementDate) : "—"}</span></div>
                <div><span className="text-gray-500">Last Paid:</span> <span className="font-medium">{selectedLoan.lastPaymentDate ? formatDateDMY(selectedLoan.lastPaymentDate) : "—"}</span></div>
              </div>
              <div className="p-3 bg-teal-50 rounded-lg border border-teal-200">
                <div className="text-xs font-semibold text-teal-800 uppercase mb-2">OD Breakdown</div>
                <div className="grid grid-cols-2 gap-3">
                  <div><span className="text-gray-500">Principal Outstanding:</span><div className="font-bold text-gray-900">{formatINR(selectedLoan.principalOutstanding)}</div></div>
                  <div><span className="text-gray-500">Interest Outstanding:</span><div className="font-bold text-gray-900">{formatINR(selectedLoan.interestOutstanding)}</div></div>
                  <div><span className="text-gray-500">Principal Overdue:</span><div className="font-bold text-gray-900">{formatINR(selectedLoan.principalOverdue)}</div></div>
                  <div><span className="text-gray-500">Interest Overdue:</span><div className="font-bold text-gray-900">{formatINR(selectedLoan.interestOverdue)}</div></div>
                  <div><span className="text-gray-500">Current OD:</span><div className="font-bold text-red-700">{formatINR(selectedLoan.currentOD)}</div></div>
                  <div><span className="text-gray-500">Accrued Interest:</span><div className="font-bold text-gray-900">{formatINR(selectedLoan.accruedInterest)}</div></div>
                </div>
                <div className="mt-3 p-2 bg-white rounded border border-teal-300">
                  <span className="text-xs text-gray-600">Foreclosure Value:</span>
                  <div className="text-xl font-bold text-teal-700">{formatINR(selectedLoan.foreclosureValue)}</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="p-2 bg-gray-50 rounded">
                  <span className="text-gray-500">DPD:</span>
                  <div className="font-bold">{Math.max(Number(selectedLoan.customerDPD) || 0, Number(selectedLoan.overdueDays) || 0)} days</div>
                </div>
                <div className="p-2 bg-gray-50 rounded">
                  <span className="text-gray-500">Status:</span>
                  <div className="font-bold">{selectedLoan.loanStatus || "Active"}</div>
                </div>
                <div className="p-2 bg-gray-50 rounded">
                  <span className="text-gray-500">DPD Class:</span>
                  <div className="font-bold">{selectedLoan.dpdClassification || "—"}</div>
                </div>
              </div>
            </div>
            <button onClick={() => setSelectedLoan(null)} className="mt-4 w-full px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DataUploadPage ────────────────────────────────────────────────────────
// Five report types — each an independent tile so any upload can be re-run
// separately. The server handles idempotency where appropriate:
//   pool/accrued/overdue → REPLACE by (snapshot_date, loan_account_no)
//   collections          → IGNORE by receipt_no (ledger is append-only)
//   client-period        → REPLACE by (period_start, period_end, loan_account_no)
const REPORT_KINDS = [
  {
    key: "pool", slug: "pool",
    title: "Compressed Pool Report",
    hint: "Pipe-delimited. Customer master + pool snapshot (Principal Outstanding, Interest OverDue, DPD, etc.).",
    accent: "teal", needsSnapshot: true,
  },
  {
    key: "accrued", slug: "accrued",
    title: "Interest Accrued Not Due Report",
    hint: "Pipe or comma delimited (auto-detected). Per-BOD accrued interest — latest Accrued Interest column is auto-picked as \"current\".",
    accent: "indigo", needsSnapshot: true,
  },
  {
    key: "overdue", slug: "overdue",
    title: "Overdue Report",
    hint: "Pipe-delimited. Only delinquent accounts — earliest/latest unpaid demand, installments due, NPA dates, death-case flag.",
    accent: "red", needsSnapshot: true,
  },
  {
    key: "collections", slug: "collections",
    title: "Collection Report",
    hint: "Pipe-delimited. Receipts ledger — one row per payment. Idempotent on receipt number, safe to re-upload.",
    accent: "emerald", needsSnapshot: false,
  },
  {
    key: "client-period", slug: "client-period",
    title: "Client-Wise Collection Report",
    hint: "Pipe-delimited. Per-account demand vs collected. Period dates are auto-detected from the file's PRINCIPAL OUTSTANDING (DD-MM-YYYY) columns on file selection.",
    accent: "amber", needsSnapshot: false, needsPeriod: true,
  },
];

// Parse the Client-Wise CSV header client-side to auto-fill the period window.
// Header carries PRINCIPAL OUTSTANDING (DD-MM-YYYY) columns — we extract min/max.
// Reads only the first 16 KB so 100+ MB files don't get decoded in the browser.
async function extractPeriodFromCsvHeader(file) {
  try {
    const slice = file.slice(0, 16 * 1024);
    const text = await slice.text();
    const firstLine = text.split(/\r?\n/, 1)[0] || "";
    const re = /PRINCIPAL\s+OUTSTANDING\s*\(\s*(\d{1,2})-(\d{1,2})-(\d{4})\s*\)/gi;
    const dates = [];
    let m;
    while ((m = re.exec(firstLine)) !== null) {
      dates.push(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
    }
    if (dates.length === 0) return null;
    dates.sort();
    return { start: dates[0], end: dates[dates.length - 1] };
  } catch {
    return null;
  }
}

export function DataUploadPage({ user, canUpload }) {
  const [files, setFiles] = useState({});
  const [dates, setDates] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return { pool: today, accrued: today, overdue: today };
  });
  const [period, setPeriod] = useState({ start: "", end: "" });
  // Tracks auto-detect state for the Client-Wise period dates:
  // "idle"      — no file picked yet (or file is non-client-period)
  // "detecting" — reading header (brief, only for big files)
  // "detected"  — successfully parsed; period inputs now show header-derived dates
  // "failed"    — header didn't contain PRINCIPAL OUTSTANDING (…) columns; user must enter manually
  const [periodAutoStatus, setPeriodAutoStatus] = useState("idle");
  const [busyKind, setBusyKind] = useState("");
  const [msg, setMsg] = useState(null);
  const [history, setHistory] = useState({
    uploads: [], latestPool: null, latestAccrued: null, latestOverdue: null, latestClientPeriod: null,
    totalCustomers: 0, totalCollections: { n: 0, total: 0 }, retentionDays: 90,
  });
  const [queue, setQueue] = useState([]);         // pending uploads waiting for backend
  const [backendUp, setBackendUp] = useState(true);

  const loadHistory = useCallback(() => {
    fetch(`${API_BASE}/od/upload-history`)
      .then(r => r.json())
      .then(json => setHistory(json || { uploads: [] }))
      .catch(() => {});
  }, []);

  const refreshQueue = useCallback(async () => {
    try { setQueue(await listQueue()); }
    catch { /* IndexedDB unavailable — fine, just show nothing */ }
  }, []);

  useEffect(() => { loadHistory(); refreshQueue(); }, [loadHistory, refreshQueue]);

  // Core send helper — used both for direct uploads and when draining the queue.
  // Returns the server response JSON on success.
  // Throws { networkError: true, message } when the backend is unreachable.
  const sendUpload = useCallback(async (item) => {
    const fd = new FormData();
    fd.append("file", item.file, item.filename || "upload.csv");
    if (["pool", "accrued", "overdue"].includes(item.kind)) fd.append("snapshotDate", item.snapshotDate || "");
    if (item.kind === "client-period") {
      if (item.periodStart) fd.append("periodStart", item.periodStart);
      if (item.periodEnd)   fd.append("periodEnd", item.periodEnd);
    }
    let res;
    try {
      res = await fetch(`${API_BASE}/od/${item.kind}/upload`, {
        method: "POST",
        headers: { "x-od-role": item.userRole || "", "x-od-user": item.userName || "" },
        body: fd,
      });
    } catch (networkErr) {
      const e = new Error("Backend unreachable");
      e.networkError = true;
      throw e;
    }
    const raw = await res.text();
    let json = null;
    if (raw) { try { json = JSON.parse(raw); } catch {} }
    if (!res.ok) {
      const looksLikeProxyError = !json && (res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504) && (!raw || /<html|ECONNREFUSED|proxy error/i.test(raw));
      if (looksLikeProxyError) {
        const e = new Error("Backend unreachable (proxy error)");
        e.networkError = true;
        throw e;
      }
      const errMsg = (json && json.error) || raw || `HTTP ${res.status}`;
      throw new Error(errMsg.slice(0, 500));
    }
    if (!json) throw new Error("Server returned an empty response — the upload may have timed out.");
    return json;
  }, []);

  // Periodically probe the backend and drain the queue when it's back up.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      const up = await isBackendUp(`${API_BASE}/health`);
      if (cancelled) return;
      setBackendUp(up);
      if (up) {
        const q = await listQueue();
        if (q.length > 0) {
          const r = await drainQueue(sendUpload);
          if (cancelled) return;
          await refreshQueue();
          if (r.succeeded > 0) {
            setMsg({ kind: "success", text: `Backend is back — flushed ${r.succeeded} queued upload(s).` });
            loadHistory();
          }
        }
      }
    };
    tick();  // run immediately
    const id = setInterval(tick, 30000);  // and every 30s
    return () => { cancelled = true; clearInterval(id); };
  }, [sendUpload, loadHistory, refreshQueue]);

  const upload = async (kind) => {
    const f = files[kind];
    if (!f) { setMsg({ kind: "error", text: `Choose a ${kind} file first.` }); return; }
    setBusyKind(kind);
    setMsg(null);
    const item = {
      kind,
      file: f,
      filename: f.name,
      snapshotDate: ["pool", "accrued", "overdue"].includes(kind) ? (dates[kind] || "") : "",
      periodStart: kind === "client-period" ? (period.start || "") : "",
      periodEnd:   kind === "client-period" ? (period.end || "")   : "",
      userRole: user.role,
      userName: user.username || user.id,
    };
    try {
      const json = await sendUpload(item);
      let summary = `${kind} uploaded: `;
      if (kind === "collections") {
        summary += `${json.rowsInserted} new receipts, ${json.rowsSkipped} duplicates skipped`;
      } else {
        summary += `${json.rowCount} rows`;
      }
      if (json.newBranches) summary += `, ${json.newBranches} new branch(es)`;
      setMsg({ kind: "success", text: summary });
      setFiles(prev => ({ ...prev, [kind]: null }));
      setBackendUp(true);
      loadHistory();
    } catch (err) {
      if (err.networkError) {
        // Backend down — queue the file instead of failing hard.
        try {
          await enqueueUpload(item);
          await refreshQueue();
          setBackendUp(false);
          setMsg({
            kind: "success",  // visually positive — the staff action succeeded
            text: `Backend unreachable — file queued locally and will upload automatically when the API is back up. Safe to close or refresh this page.`,
          });
          setFiles(prev => ({ ...prev, [kind]: null }));
        } catch (queueErr) {
          setMsg({ kind: "error", text: `Backend unreachable and failed to queue locally: ${queueErr.message}` });
        }
      } else {
        setMsg({ kind: "error", text: err.message });
      }
    } finally {
      setBusyKind("");
    }
  };

  const retryQueueNow = useCallback(async () => {
    setMsg(null);
    const r = await drainQueue(sendUpload);
    await refreshQueue();
    if (r.succeeded > 0) {
      setMsg({ kind: "success", text: `Flushed ${r.succeeded} queued upload(s).` });
      loadHistory();
    } else if (r.stillDown) {
      setMsg({ kind: "error", text: `Backend still unreachable. Will keep retrying in the background.` });
    } else if (r.failed > 0) {
      setMsg({ kind: "error", text: `${r.failed} queued upload(s) failed server-side. See details below.` });
    } else {
      setMsg({ kind: "success", text: `Queue is empty.` });
    }
  }, [sendUpload, loadHistory, refreshQueue]);

  const discardQueued = useCallback(async (id) => {
    await deleteFromQueue(id);
    await refreshQueue();
  }, [refreshQueue]);

  // Permission: controlled by App.jsx (canUpload prop). Fall back to the
  // legacy role check if the prop is not supplied, so direct mounts still work.
  const isUploader = canUpload != null
    ? !!canUpload
    : (user.role === "admin" || user.role === "elevated_staff");
  if (!isUploader) {
    return (
      <div className="p-8 text-center text-gray-500">
        <AlertTriangle className="mx-auto mb-2" /> You don't have permission to upload OD data. Ask an admin to grant OD Upload access.
      </div>
    );
  }

  const accentCls = (accent) => ({
    teal:    { icon: "text-teal-600", ring: "focus:ring-teal-500", fileBg: "file:bg-teal-50 file:text-teal-700", btn: "bg-teal-600 hover:bg-teal-700" },
    indigo:  { icon: "text-indigo-600", ring: "focus:ring-indigo-500", fileBg: "file:bg-indigo-50 file:text-indigo-700", btn: "bg-indigo-600 hover:bg-indigo-700" },
    red:     { icon: "text-red-600", ring: "focus:ring-red-500", fileBg: "file:bg-red-50 file:text-red-700", btn: "bg-red-600 hover:bg-red-700" },
    emerald: { icon: "text-emerald-600", ring: "focus:ring-emerald-500", fileBg: "file:bg-emerald-50 file:text-emerald-700", btn: "bg-emerald-600 hover:bg-emerald-700" },
    amber:   { icon: "text-amber-600", ring: "focus:ring-amber-500", fileBg: "file:bg-amber-50 file:text-amber-700", btn: "bg-amber-600 hover:bg-amber-700" },
  }[accent] || { icon: "text-gray-600", ring: "focus:ring-gray-500", fileBg: "file:bg-gray-50 file:text-gray-700", btn: "bg-gray-600 hover:bg-gray-700" });

  const totalCollectionsRupees = history.totalCollections?.total || 0;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">OD Data Upload</h2>
        <p className="text-sm text-gray-500 mt-1">
          Upload any of the five Finflux extracts. Snapshot-based reports are de-duplicated per date; the Collection ledger is idempotent per receipt. Retention: {history.retentionDays || 90} days.
        </p>
      </div>

      {/* Status tiles */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-5">
        <div className="bg-white border rounded-xl p-3">
          <div className="text-[10px] uppercase text-gray-500">Customers</div>
          <div className="text-xl font-bold text-gray-900 mt-0.5">{(history.totalCustomers || 0).toLocaleString()}</div>
        </div>
        <div className="bg-white border rounded-xl p-3">
          <div className="text-[10px] uppercase text-gray-500">Latest Pool</div>
          <div className="text-sm font-bold text-teal-700 mt-0.5">{history.latestPool?.snapshot_date ? formatDateDMY(history.latestPool.snapshot_date) : "—"}</div>
          <div className="text-[10px] text-gray-500">{(history.latestPool?.rows || 0).toLocaleString()} rows</div>
        </div>
        <div className="bg-white border rounded-xl p-3">
          <div className="text-[10px] uppercase text-gray-500">Latest Accrued</div>
          <div className="text-sm font-bold text-indigo-700 mt-0.5">{history.latestAccrued?.snapshot_date ? formatDateDMY(history.latestAccrued.snapshot_date) : "—"}</div>
          <div className="text-[10px] text-gray-500">{(history.latestAccrued?.rows || 0).toLocaleString()} rows</div>
        </div>
        <div className="bg-white border rounded-xl p-3">
          <div className="text-[10px] uppercase text-gray-500">Latest Overdue</div>
          <div className="text-sm font-bold text-red-700 mt-0.5">{history.latestOverdue?.snapshot_date ? formatDateDMY(history.latestOverdue.snapshot_date) : "—"}</div>
          <div className="text-[10px] text-gray-500">{(history.latestOverdue?.rows || 0).toLocaleString()} rows</div>
        </div>
        <div className="bg-white border rounded-xl p-3">
          <div className="text-[10px] uppercase text-gray-500">Collections Ledger</div>
          <div className="text-sm font-bold text-emerald-700 mt-0.5">{(history.totalCollections?.n || 0).toLocaleString()} receipts</div>
          <div className="text-[10px] text-gray-500">{formatLakhs(totalCollectionsRupees)}</div>
        </div>
        <div className="bg-white border rounded-xl p-3">
          <div className="text-[10px] uppercase text-gray-500">Latest Period</div>
          <div className="text-sm font-bold text-amber-700 mt-0.5">
            {history.latestClientPeriod?.period_end ? formatDateDMY(history.latestClientPeriod.period_end) : "—"}
          </div>
          <div className="text-[10px] text-gray-500">{(history.latestClientPeriod?.rows || 0).toLocaleString()} accts</div>
        </div>
      </div>

      {msg && (
        <div className={`mb-4 p-3 rounded-lg border flex items-center gap-2 text-sm ${msg.kind === "success" ? "bg-green-50 border-green-200 text-green-700" : "bg-red-50 border-red-200 text-red-700"}`}>
          {msg.kind === "success" ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
          {msg.text}
        </div>
      )}

      {/* Queue banner — shown when there are pending uploads waiting for the backend */}
      {queue.length > 0 && (
        <div className="mb-4 p-3 rounded-lg border bg-amber-50 border-amber-200 text-amber-800">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <CloudOff size={16} />
              {backendUp
                ? `${queue.length} upload(s) pending — retrying now…`
                : `${queue.length} upload(s) queued locally. Backend is unreachable; auto-retrying every 30s.`}
            </div>
            <button onClick={retryQueueNow}
              className="text-xs px-3 py-1.5 rounded-md bg-amber-600 text-white hover:bg-amber-700 flex items-center gap-1">
              <RefreshCw size={12} /> Retry now
            </button>
          </div>
          <ul className="mt-2 text-xs space-y-1">
            {queue.map(q => (
              <li key={q.id} className="flex items-center justify-between gap-2 bg-white/50 rounded px-2 py-1">
                <span className="truncate">
                  <span className="font-mono font-semibold">{q.kind}</span> · {q.filename}
                  {q.snapshotDate ? ` · ${q.snapshotDate}` : ""}
                  {q.attempts > 0 ? ` · ${q.attempts} attempt(s)` : ""}
                  {q.lastError ? ` · last error: ${q.lastError}` : ""}
                </span>
                <button onClick={() => discardQueued(q.id)}
                  className="text-amber-700 hover:text-red-600"
                  title="Remove from queue">
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        {REPORT_KINDS.map((k) => {
          const cls = accentCls(k.accent);
          const f = files[k.key];
          const busy = busyKind === k.key;
          return (
            <div key={k.key} className="bg-white rounded-xl border p-5">
              <div className="flex items-center gap-2 mb-2">
                <FileText className={cls.icon} size={18} />
                <h3 className="font-semibold text-gray-900">{k.title}</h3>
              </div>
              <p className="text-xs text-gray-500 mb-4">{k.hint}</p>
              {k.needsSnapshot && (
                <>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Snapshot Date</label>
                  <input type="date" value={dates[k.key] || ""}
                    onChange={e => setDates(prev => ({ ...prev, [k.key]: e.target.value }))}
                    className={`w-full mb-3 px-3 py-2 border rounded-lg focus:ring-2 text-sm ${cls.ring}`} />
                </>
              )}
              {k.needsPeriod && (
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Period Start</label>
                    <input type="date" value={period.start}
                      onChange={e => { setPeriod(prev => ({ ...prev, start: e.target.value })); setPeriodAutoStatus("idle"); }}
                      className={`w-full px-2 py-2 border rounded-lg focus:ring-2 text-sm ${cls.ring}`} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Period End</label>
                    <input type="date" value={period.end}
                      onChange={e => { setPeriod(prev => ({ ...prev, end: e.target.value })); setPeriodAutoStatus("idle"); }}
                      className={`w-full px-2 py-2 border rounded-lg focus:ring-2 text-sm ${cls.ring}`} />
                  </div>
                  <div className="col-span-2 text-[10px] -mt-1">
                    {periodAutoStatus === "detected" && (
                      <span className="text-emerald-600">✓ Auto-detected from file header — edit if needed.</span>
                    )}
                    {periodAutoStatus === "detecting" && (
                      <span className="text-gray-500">Reading file header…</span>
                    )}
                    {periodAutoStatus === "failed" && (
                      <span className="text-amber-600">Could not auto-detect dates — enter manually (file needs "PRINCIPAL OUTSTANDING (DD-MM-YYYY)" columns).</span>
                    )}
                    {periodAutoStatus === "idle" && (
                      <span className="text-gray-500">Dates will be auto-detected from the file header on selection.</span>
                    )}
                  </div>
                </div>
              )}
              <label className="block text-xs font-medium text-gray-600 mb-1">CSV File</label>
              <input type="file" accept=".csv,.txt"
                onChange={async e => {
                  const f = e.target.files?.[0] || null;
                  setFiles(prev => ({ ...prev, [k.key]: f }));
                  // Client-Wise: peek the header and auto-fill Period Start/End from the
                  // PRINCIPAL OUTSTANDING (DD-MM-YYYY) columns. User can still override
                  // by typing into the date inputs (which resets the status to "idle").
                  if (f && k.key === "client-period") {
                    setPeriodAutoStatus("detecting");
                    const p = await extractPeriodFromCsvHeader(f);
                    if (p) {
                      setPeriod({ start: p.start, end: p.end });
                      setPeriodAutoStatus("detected");
                    } else {
                      setPeriodAutoStatus("failed");
                    }
                  }
                }}
                className={`w-full text-sm mb-3 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 ${cls.fileBg} file:font-medium file:cursor-pointer`} />
              {f && <div className="text-xs text-gray-500 mb-3 truncate">Selected: {f.name} ({(f.size / 1024 / 1024).toFixed(2)} MB)</div>}
              <button onClick={() => upload(k.key)} disabled={busy || !f}
                className={`w-full py-2.5 text-white rounded-lg font-semibold text-sm disabled:bg-gray-300 flex items-center justify-center gap-2 ${cls.btn}`}>
                {busy ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                Upload
              </button>
            </div>
          );
        })}
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
          <SortableSection initialKey="uploaded_at" initialDir="desc" render={sort => (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2">{sort.header("kind", "Kind")}</th>
                  <th className="text-left px-4 py-2">{sort.header("snapshot_date", "Snapshot Date")}</th>
                  <th className="text-left px-4 py-2">{sort.header("filename", "Filename")}</th>
                  <th className="text-right px-4 py-2">{sort.header("row_count", "Rows")}</th>
                  <th className="text-right px-4 py-2">{sort.header("new_branches", "New Branches")}</th>
                  <th className="text-left px-4 py-2">{sort.header("uploaded_by", "Uploaded By")}</th>
                  <th className="text-left px-4 py-2">{sort.header("uploaded_at", "At")}</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const sortedUploads = sort.apply(history.uploads || []);
                  if (!sortedUploads || sortedUploads.length === 0) {
                    return <tr><td colSpan={7} className="text-center text-gray-400 py-6">No uploads yet.</td></tr>;
                  }
                  return sortedUploads.map(h => (
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
                  ));
                })()}
              </tbody>
            </table>
          )} />
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

  // Outer category filter — Group Loan vs Individual Loan. Drives all 8 sub-tabs.
  // Sourced from the Pool Report's "Category of Loan" column (ingested into
  // customers.loan_category). Matching is case-insensitive:
  //   Group      = loan_category contains 'GROUP'       → shows Group Loan rows only
  //   Individual = loan_category contains 'INDIVIDUAL'  → shows Individual Loan rows only
  // Default is "group" — matches the compressed pool report tab order.
  const [category, setCategory] = useState("group");

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
    if (category) p.set("category", category);
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
  }, [granularity, fromDate, toDate, branchFilter, category]);

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

  const [tab, setTab] = useState("portfolio");
  // Shared drilldown drawer state — any descendant view can open it.
  const [drill, setDrill] = useState(null);
  const openDrill = useCallback((slice) => setDrill(slice), []);
  const closeDrill = useCallback(() => setDrill(null), []);

  const tabs = [
    { key: "portfolio",  label: "Portfolio Health",     icon: <Gauge size={14} /> },
    { key: "branches",   label: "Branch Performance",   icon: <Building2 size={14} /> },
    { key: "products",   label: "Product Performance",  icon: <Package size={14} /> },
    { key: "efficiency", label: "Collection Efficiency", icon: <Target size={14} /> },
    { key: "monthly",    label: "Monthly Collections",  icon: <CalendarRange size={14} /> },
    { key: "scorecard",  label: "Officer Scorecard",    icon: <Activity size={14} /> },
    { key: "daily",      label: "Daily Collections",    icon: <Calendar size={14} /> },
    { key: "risk",       label: "Risk Triage",          icon: <AlertTriangle size={14} /> },
  ];

  return (
    // min-w-0 cooperates with the parent <main>'s min-w-0 to keep this page
    // pinned to the flex column width. Inner overflow-x-auto wrappers then
    // handle wide tables (scorecard, heatmap) as designed — with scrollbars
    // instead of clipping or page-wide overflow.
    <div className="space-y-6 min-w-0">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">OD Insights</h2>
          <p className="text-sm text-gray-500">
            {tab === "portfolio"  && <>Live from daily Pool + Accrued snapshots. Snapshot date: {dpd?.snapshotDate ? formatDateDMY(dpd.snapshotDate) : "—"}</>}
            {tab === "branches"   && <>Per-branch scorecard — book, CE%, receipts, cash exposure, NPA. Click any row or tile for customer-level detail.</>}
            {tab === "products"   && <>Per-product performance with branch × product matrix and collections split by product.</>}
            {tab === "efficiency" && <>Demand vs Collected per period — the number your lenders look at.</>}
            {tab === "monthly"    && <>Calendar-month demand vs collected, with principal/interest split and remaining balance — branch, product, and officer cuts.</>}
            {tab === "scorecard"  && <>Officer-level book, receipts, and mode mix (cash exposure).</>}
            {tab === "daily"      && <>Day-by-day receipt activity with branch and mode breakdown.</>}
            {tab === "risk"       && <>NPA ageing, death cases, and installments-due triage from the Overdue Report.</>}
          </p>
        </div>
        {tab === "portfolio" && (
          <button onClick={loadAll}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border rounded-lg text-sm hover:bg-gray-50">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        )}
      </div>

      {/* Outer category toggle — Group Loan vs Individual Loan, sourced from
          customers.loan_category (the Pool Report's "Category of Loan" column). */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs uppercase tracking-wide text-gray-500 font-semibold mr-1">Loan Category</span>
        <div className="inline-flex rounded-full bg-gray-100 p-1 border border-gray-200 shadow-sm">
          <button
            type="button"
            onClick={() => setCategory("group")}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
              category === "group"
                ? "bg-teal-600 text-white shadow"
                : "text-gray-600 hover:text-gray-900"
            }`}>
            Group Loan
          </button>
          <button
            type="button"
            onClick={() => setCategory("individual")}
            className={`px-4 py-1.5 rounded-full text-sm font-semibold transition-all ${
              category === "individual"
                ? "bg-indigo-600 text-white shadow"
                : "text-gray-600 hover:text-gray-900"
            }`}>
            Individual Loan
          </button>
        </div>
        <span className="text-[11px] text-gray-500 ml-1">
          Applies across all 8 tabs · filter: customers.loan_category
        </span>
      </div>

      {/* Tab bar */}
      <div className="flex flex-wrap gap-1 border-b border-gray-200">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-teal-600 text-teal-700"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === "portfolio" && (
      <>
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
          sub={`${dpdTotals.accounts.toLocaleString()} accounts · click for detail`}
          onClick={() => openDrill({
            branch: branchFilter || undefined,
            from: fromDate, to: toDate,
            title: "Total OD Exposure",
            subtitle: `All overdue accounts${branchFilter ? ` in ${branchFilter}` : ""}`,
          })} />
        <KpiCard icon={<AlertTriangle />} label="90+ DPD Exposure" color="red"
          value={formatLakhs(severeDpd.overdueAmount)}
          sub={`${severeDpd.accounts.toLocaleString()} accounts · click for detail`}
          onClick={() => openDrill({
            branch: branchFilter || undefined,
            bucket: "DPD-91-180",
            from: fromDate, to: toDate,
            title: "90+ DPD Accounts",
            subtitle: `Severe delinquency${branchFilter ? ` in ${branchFilter}` : ""}`,
          })} />
        <KpiCard icon={<Target />} label="Period Efficiency" color="indigo"
          value={efficiency?.efficiencyPct != null ? `${Number(efficiency.efficiencyPct).toFixed(1)}%` : "—"}
          sub={efficiency ? `${formatLakhs(efficiency.totalCollected || 0)} collected · click for detail` : ""}
          onClick={() => openDrill({
            branch: branchFilter || undefined,
            from: fromDate, to: toDate,
            title: "Period Efficiency",
            subtitle: `Collected ${formatLakhs(efficiency?.totalCollected || 0)} vs book ${formatLakhs(efficiency?.openingBook || 0)}`,
          })} />
        <KpiCard icon={<PhoneOff />} label="Non-contactable" color="amber"
          value={nonContactSummary.count.toLocaleString()}
          sub={`${formatLakhs(nonContactSummary.overdueAmount)} exposure · click for detail`}
          onClick={() => openDrill({
            branch: branchFilter || undefined,
            nonContact: true,
            from: fromDate, to: toDate,
            title: "Non-contactable Accounts",
            subtitle: "Overdue customers with both phone numbers missing",
          })} />
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
              {(() => {
                // Only show non-zero slices in the donut so labels don't stack
                // on top of each other when one or two segments are 0. The four
                // Stat boxes above already display every value, so nothing is
                // hidden by this filter.
                const COLOR_BY_NAME = { Paid: "#10b981", Pending: "#f59e0b", Missed: "#ef4444" };
                const slices = [
                  { name: "Paid",    value: ptpConv.paid    || 0 },
                  { name: "Pending", value: ptpConv.pending || 0 },
                  { name: "Missed",  value: ptpConv.missed  || 0 },
                ].filter(s => s.value > 0);

                if (slices.length === 0) {
                  return (
                    <div className="h-[180px] flex items-center justify-center text-gray-400 text-sm">
                      No PTP activity in this period.
                    </div>
                  );
                }
                return (
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart>
                      <Pie
                        data={slices}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={75}
                        dataKey="value"
                        label={(e) => `${e.name}: ${e.value}`}
                        labelLine={true}
                      >
                        {slices.map((s, i) => (
                          <Cell key={s.name} fill={COLOR_BY_NAME[s.name]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                );
              })()}
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
              <Bar dataKey="overdue_amount" fill="#0f766e" name="Overdue"
                onClick={(d) => d?.branch && openDrill({
                  branch: d.branch, from: fromDate, to: toDate,
                  title: `Branch: ${d.branch}`, subtitle: "OD exposure drilldown",
                })}
                style={{ cursor: "pointer" }} />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-gray-400 mt-1 text-center">Click a branch bar to see customers</p>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800">Officer Productivity (period)</h3>
            <button onClick={() => downloadCSV(officerProd, "officer-productivity.csv")}
              className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
          </div>
          <div className="overflow-y-auto max-h-80">
            <SortableSection initialKey="collected" initialDir="desc" render={sort => (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white shadow-sm">
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-2">{sort.header("officer", "Officer")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("entries", "Entries")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("collected", "Collected")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("ptps", "PTPs")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("ptpsPaid", "Paid")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("ptpsMissed", "Missed")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const sortedOfficers = sort.apply(officerProd);
                    if (sortedOfficers.length === 0) {
                      return <tr><td colSpan={6} className="py-4 text-center text-gray-400">No activity.</td></tr>;
                    }
                    return sortedOfficers.map((o, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-1.5 pr-2">{o.officer || "—"}</td>
                        <td className="py-1.5 pr-2 text-right">{o.entries}</td>
                        <td className="py-1.5 pr-2 text-right font-medium text-teal-700">{formatLakhs(o.collected || 0)}</td>
                        <td className="py-1.5 pr-2 text-right">{o.ptps || 0}</td>
                        <td className="py-1.5 pr-2 text-right text-green-700">{o.ptpsPaid || 0}</td>
                        <td className="py-1.5 pr-2 text-right text-red-600">{o.ptpsMissed || 0}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            )} />
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
            <SortableSection initialKey="dpd" initialDir="desc" render={sort => (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-2">{sort.header("customer", "Customer")}</th>
                    <th className="py-2 pr-2">{sort.header("branch", "Branch")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("foreclosure", "Foreclosure")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("originalLoan", "Orig. Loan")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("dpd", "DPD")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const sortedFore = sort.apply(foreOpp.slice(0, 100));
                    if (sortedFore.length === 0) {
                      return <tr><td colSpan={5} className="py-4 text-center text-gray-400">None.</td></tr>;
                    }
                    return sortedFore.map((f, i) => (
                      <tr key={i} className="border-b hover:bg-teal-50/50 cursor-pointer"
                          onClick={() => openDrill({
                            branch: f.branch,
                            from: fromDate, to: toDate,
                            title: f.customer_name || f.loan_account_no,
                            subtitle: `Foreclosure candidate · ${f.branch}`,
                          })}>
                        <td className="py-1.5 pr-2">
                          <div className="font-medium">{f.customer_name || "—"}</div>
                          <div className="text-[10px] text-gray-400">{f.loan_account_no}</div>
                        </td>
                        <td className="py-1.5 pr-2">{f.branch}</td>
                        <td className="py-1.5 pr-2 text-right font-medium text-teal-700">{formatINR(f.foreclosure_value)}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-500">{formatINR(f.loan_amount)}</td>
                        <td className="py-1.5 pr-2 text-right">{f.overdue_days || 0}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            )} />
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
            <SortableSection initialKey="overdue_days" initialDir="desc" render={sort => (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-2">{sort.header("customer_name", "Customer")}</th>
                    <th className="py-2 pr-2">{sort.header("branch", "Branch")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("overdue_days", "DPD")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("overdue_amount", "Overdue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const sortedNonContact = sort.apply(nonContact.slice(0, 100));
                    if (sortedNonContact.length === 0) {
                      return <tr><td colSpan={4} className="py-4 text-center text-gray-400">None.</td></tr>;
                    }
                    return sortedNonContact.map((n, i) => (
                      <tr key={i} className="border-b hover:bg-amber-50/50 cursor-pointer"
                          onClick={() => openDrill({
                            branch: n.branch,
                            from: fromDate, to: toDate,
                            title: n.customer_name || n.loan_account_no,
                            subtitle: `Non-contactable · ${n.branch}`,
                          })}>
                        <td className="py-1.5 pr-2">
                          <div className="font-medium">{n.customer_name || "—"}</div>
                          <div className="text-[10px] text-gray-400">{n.loan_account_no}</div>
                        </td>
                        <td className="py-1.5 pr-2">{n.branch}</td>
                        <td className="py-1.5 pr-2 text-right">{n.overdue_days || 0}</td>
                        <td className="py-1.5 pr-2 text-right font-medium">{formatINR(n.overdue_amount)}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            )} />
          </div>
        </div>
      </div>
      </>
      )}

      {tab === "branches"   && <BranchPerformanceView category={category} openDrill={openDrill} />}
      {tab === "products"   && <ProductPerformanceView category={category} openDrill={openDrill} />}
      {tab === "efficiency" && <CollectionEfficiencyView category={category} branches={branches} openDrill={openDrill} />}
      {tab === "monthly"    && <MonthlyCollectionsView category={category} openDrill={openDrill} />}
      {tab === "scorecard"  && <OfficerScorecardView category={category} openDrill={openDrill} />}
      {tab === "daily"      && <DailyCollectionsView category={category} branches={branches} openDrill={openDrill} />}
      {tab === "risk"       && <RiskTriageView category={category} openDrill={openDrill} />}

      {/* Shared drilldown drawer */}
      <DrilldownDrawer slice={drill} onClose={closeDrill} />
    </div>
  );
}

function KpiCard({ icon, label, value, sub, color, onClick }) {
  const palette = {
    teal:   "bg-teal-50 border-teal-200 text-teal-800",
    red:    "bg-red-50 border-red-200 text-red-800",
    indigo: "bg-indigo-50 border-indigo-200 text-indigo-800",
    amber:  "bg-amber-50 border-amber-200 text-amber-800",
  }[color] || "bg-gray-50 border-gray-200 text-gray-800";
  const interactive = typeof onClick === "function";
  // min-w-0 lets the card shrink below its content's intrinsic width inside a
  // grid cell — critical so long values (e.g. "GOLD_HALFYEARLY — 1857%") wrap
  // cleanly instead of pushing the card (and the whole KPI row) wider.
  const baseClass = `rounded-xl border p-4 min-w-0 ${palette} ${interactive ? "cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 relative group" : ""}`;
  const content = (
    <>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide opacity-70 min-w-0">
        {icon && React.cloneElement(icon, { size: 14 })}
        <span className="truncate">{label}</span>
        {interactive && <ChevronRight size={12} className="ml-auto opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition shrink-0" />}
      </div>
      <div className="text-xl font-bold mt-1 break-words">{value}</div>
      {sub && <div className="text-[11px] opacity-70 mt-1 break-words">{sub}</div>}
    </>
  );
  return interactive ? (
    <button type="button" onClick={onClick} className={`${baseClass} text-left w-full`}>{content}</button>
  ) : (
    <div className={baseClass}>{content}</div>
  );
}

// ─── DrilldownDrawer ───────────────────────────────────────────────────────
// Right-side slide-out drawer. Accepts a `slice` object
// ({branch, product, bucket, periodStart, periodEnd, from, to, title, subtitle})
// and loads a unified summary + customer list + receipts + trend via
// /api/od/drilldown. Safe to render at any time — when `slice` is null it
// renders nothing.
function DrilldownDrawer({ slice, onClose }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("customers");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("total_overdue");
  const [sortDir, setSortDir] = useState("desc");

  // Fetch whenever slice changes
  useEffect(() => {
    if (!slice) return;
    setLoading(true); setData(null); setQuery(""); setTab("customers");
    const p = new URLSearchParams();
    for (const k of ["branch", "product", "bucket", "mode", "periodStart", "periodEnd", "from", "to", "minInstallmentsDue", "minMonthsStranded", "limit"]) {
      if (slice[k] != null && slice[k] !== "") p.set(k, slice[k]);
    }
    for (const k of ["npaOnly", "deathOnly", "nonContact"]) {
      if (slice[k]) p.set(k, "1");
    }
    fetch(`${API_BASE}/od/drilldown?${p.toString()}`)
      .then(r => r.json())
      .then(j => setData(j))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [slice]);

  // Escape to close
  useEffect(() => {
    if (!slice) return;
    const h = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [slice, onClose]);

  const customers = data?.customers || [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = q ? customers.filter(c =>
      (c.customer_name || "").toLowerCase().includes(q) ||
      (c.loan_account_no || "").toLowerCase().includes(q) ||
      (c.customer_number || "").toLowerCase().includes(q) ||
      (c.branch_name || "").toLowerCase().includes(q) ||
      (c.officer_name || "").toLowerCase().includes(q)
    ) : [...customers];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const an = Number(av), bn = Number(bv);
      const numeric = Number.isFinite(an) && Number.isFinite(bn);
      const cmp = numeric ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [customers, query, sortKey, sortDir]);

  const summary = data?.summary || {};
  const trend = data?.trend || [];
  const receipts = data?.receipts || [];

  const sortBtn = (key, label) => (
    <button
      onClick={() => {
        if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
        else { setSortKey(key); setSortDir("desc"); }
      }}
      className={`flex items-center gap-0.5 ${sortKey === key ? "text-teal-700 font-semibold" : "text-gray-500"}`}>
      {label}{sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </button>
  );

  if (!slice) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 z-40 transition-opacity"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="fixed top-0 right-0 h-full w-full md:w-[780px] lg:w-[920px] bg-white shadow-2xl z-50 flex flex-col animate-in slide-in-from-right">
        {/* Header */}
        <div className="px-5 py-3 border-b flex items-start justify-between bg-gradient-to-r from-teal-50 to-white">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-teal-700 font-semibold">
              <Gauge size={12} /> Drilldown
            </div>
            <h2 className="text-lg font-bold text-gray-900 truncate">{slice.title || "Details"}</h2>
            {slice.subtitle && <p className="text-xs text-gray-500 mt-0.5">{slice.subtitle}</p>}
            <div className="flex items-center gap-1.5 flex-wrap mt-1.5">
              {slice.branch && <span className="px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 text-[10px]">Branch: {slice.branch}</span>}
              {slice.product && <span className="px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 text-[10px]">Product: {slice.product}</span>}
              {slice.bucket && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px]">DPD: {slice.bucket}</span>}
              {slice.periodStart && slice.periodEnd && (
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 text-[10px]">
                  {formatDateDMY(slice.periodStart)} → {formatDateDMY(slice.periodEnd)}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
            <X size={18} />
          </button>
        </div>

        {/* Summary stats */}
        <div className="px-5 py-3 border-b bg-white grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="Accounts" value={(summary.accounts || 0).toLocaleString()} />
          <Stat label="Principal O/S" value={formatLakhs(summary.principal_outstanding || 0)} />
          <Stat label="Total OD" value={formatLakhs((summary.principal_overdue || 0) + (summary.interest_overdue || 0))} tone="red" />
          <Stat label="CE%" value={summary.cePct == null ? "—" : formatPct(summary.cePct, 1)} tone={summary.cePct >= 85 ? "green" : summary.cePct >= 50 ? "amber" : "red"} />
          <Stat label="Demand" value={formatLakhs(summary.demand || 0)} />
          <Stat label="Collected" value={formatLakhs(summary.collected || 0)} tone="green" />
          <Stat label="Receipts" value={(summary.receipts || 0).toLocaleString()} />
          <Stat label="Cash %" value={summary.posted_amount > 0 ? formatPct((summary.cash_amount / summary.posted_amount) * 100, 0) : "—"} tone="amber" />
        </div>

        {/* Tabs */}
        <div className="px-5 border-b flex gap-1">
          {[
            { k: "customers", label: `Customers (${customers.length})` },
            { k: "trend",     label: "Trend" },
            { k: "receipts",  label: `Receipts (${receipts.length})` },
          ].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px ${
                tab === t.k ? "border-teal-600 text-teal-700" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              {t.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 py-2">
            {tab === "customers" && customers.length > 0 && (
              <>
                <div className="relative">
                  <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input type="text" value={query} onChange={e => setQuery(e.target.value)}
                    placeholder="Search name / loan / officer…"
                    className="pl-7 pr-3 py-1.5 text-xs border rounded-lg w-56" />
                </div>
                <button onClick={() => downloadCSV(filtered, `drilldown-customers-${Date.now()}.csv`)}
                  className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
              </>
            )}
            {tab === "receipts" && receipts.length > 0 && (
              <button onClick={() => downloadCSV(receipts, `drilldown-receipts-${Date.now()}.csv`)}
                className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && <div className="text-sm text-gray-500 text-center py-10"><RefreshCw size={18} className="animate-spin inline mr-2" /> Loading…</div>}

          {!loading && tab === "customers" && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white shadow-sm z-10">
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-2">{sortBtn("customer_name", "Customer / Loan")}</th>
                    <th className="py-2 pr-2">{sortBtn("branch_name", "Branch")}</th>
                    <th className="py-2 pr-2">{sortBtn("officer_name", "Officer")}</th>
                    <th className="py-2 pr-2">{sortBtn("product_name", "Product")}</th>
                    <th className="py-2 pr-2 text-right">{sortBtn("principal_outstanding", "Principal O/S")}</th>
                    <th className="py-2 pr-2 text-right">{sortBtn("total_overdue", "Total OD")}</th>
                    <th className="py-2 pr-2 text-right">{sortBtn("cePct", "CE%")}</th>
                    <th className="py-2 pr-2">{sortBtn("mobile_number", "Phone")}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr><td colSpan={8} className="py-6 text-center text-gray-400">No customers for this slice.</td></tr>
                  ) : filtered.map((c, i) => (
                    <tr key={c.loan_account_no + "-" + i} className="border-b hover:bg-gray-50">
                      <td className="py-1.5 pr-2">
                        <div className="font-medium text-gray-800">{c.customer_name || "—"}</div>
                        <div className="text-[10px] text-gray-400">{c.loan_account_no}</div>
                      </td>
                      <td className="py-1.5 pr-2">{c.branch_name || "—"}</td>
                      <td className="py-1.5 pr-2">
                        <div>{c.officer_name || "—"}</div>
                        {c.officer_code && <div className="text-[10px] text-gray-400">{c.officer_code}</div>}
                      </td>
                      <td className="py-1.5 pr-2 text-gray-600">{c.product_name || "—"}</td>
                      <td className="py-1.5 pr-2 text-right">{formatLakhs(c.principal_outstanding)}</td>
                      <td className="py-1.5 pr-2 text-right font-semibold text-red-700">{formatLakhs(c.total_overdue)}</td>
                      <td className={`py-1.5 pr-2 text-right font-semibold ${ceColor(c.cePct)}`}>{c.cePct == null ? "—" : formatPct(c.cePct, 0)}</td>
                      <td className="py-1.5 pr-2 text-gray-600">
                        {c.mobile_number ? (
                          <a href={`tel:${c.mobile_number}`} className="flex items-center gap-1 hover:text-teal-700">
                            <Phone size={10} /> {c.mobile_number}
                          </a>
                        ) : <span className="text-gray-400 flex items-center gap-1"><PhoneOff size={10} /> —</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!loading && tab === "trend" && (
            <div>
              {trend.length === 0 ? (
                <div className="text-center text-gray-400 py-10">No receipts in this window.</div>
              ) : (
                <>
                  <h3 className="font-semibold text-gray-800 mb-2">Daily collections</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={trend.map(d => ({ ...d, day: d.day ? d.day.slice(5) : d.day }))}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="day" fontSize={10} />
                      <YAxis fontSize={10} tickFormatter={v => `${Math.round(v / 1000)}K`} />
                      <Tooltip formatter={v => formatLakhs(v)} />
                      <Legend />
                      <Bar dataKey="cash" stackId="a" fill="#f59e0b" name="Cash" />
                      <Bar dataKey="upi" stackId="a" fill="#10b981" name="UPI / Digital" />
                    </BarChart>
                  </ResponsiveContainer>
                  <div className="mt-4 text-xs text-gray-500">{trend.length} day(s) with activity · {(summary.receipts || 0).toLocaleString()} receipts · {formatLakhs(summary.posted_amount || 0)} posted</div>
                </>
              )}
            </div>
          )}

          {!loading && tab === "receipts" && (
            <div className="overflow-x-auto">
              <SortableSection initialKey="payment_date" initialDir="desc" render={sort => (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white shadow-sm">
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2 pr-2">{sort.header("payment_date", "Date")}</th>
                      <th className="py-2 pr-2">{sort.header("receipt_no", "Receipt")}</th>
                      <th className="py-2 pr-2">{sort.header("customer_name", "Customer / Loan")}</th>
                      <th className="py-2 pr-2">{sort.header("branch_name", "Branch")}</th>
                      <th className="py-2 pr-2">{sort.header("mode", "Mode")}</th>
                      <th className="py-2 pr-2 text-right">{sort.header("amount", "Amount")}</th>
                      <th className="py-2 pr-2">{sort.header("payment_officer_name", "Officer")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const sortedReceipts = sort.apply(receipts);
                      if (sortedReceipts.length === 0) {
                        return <tr><td colSpan={7} className="py-6 text-center text-gray-400">No receipts.</td></tr>;
                      }
                      return sortedReceipts.map((r, i) => (
                        <tr key={r.receipt_no + "-" + i} className="border-b hover:bg-gray-50">
                          <td className="py-1.5 pr-2 text-gray-600">{formatDateDMY(r.payment_date)}</td>
                          <td className="py-1.5 pr-2 font-mono text-[10px] text-gray-500">{r.receipt_no}</td>
                          <td className="py-1.5 pr-2">
                            <div className="font-medium">{r.customer_name || "—"}</div>
                            <div className="text-[10px] text-gray-400">{r.loan_account_no}</div>
                          </td>
                          <td className="py-1.5 pr-2">{r.branch_name || "—"}</td>
                          <td className="py-1.5 pr-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              (r.mode || "").toUpperCase() === "CASH" ? "bg-amber-100 text-amber-800" :
                              ["UPI","DIGITAL","ONLINE"].includes((r.mode || "").toUpperCase()) ? "bg-emerald-100 text-emerald-800" :
                              "bg-indigo-100 text-indigo-800"
                            }`}>{r.mode || "—"}</span>
                          </td>
                          <td className="py-1.5 pr-2 text-right font-semibold text-teal-700">{formatINR(r.amount)}</td>
                          <td className="py-1.5 pr-2 text-gray-600">{r.payment_officer_name || "—"}</td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              )} />
            </div>
          )}
        </div>
      </div>
    </>
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

// ─── CollectionEfficiencyView ──────────────────────────────────────────────
// Demand vs Collected for a period, grouped by branch/officer/product/funder/center.
// The headline CE% is the number lenders care about; the breakdown is the drill-down.
function CollectionEfficiencyView({ category, openDrill }) {
  const { periods, latest } = useLatestPeriod();
  const [period, setPeriod] = useState({ start: "", end: "" });
  const [groupBy, setGroupBy] = useState("branch");
  const [data, setData] = useState(null);
  const [funderMix, setFunderMix] = useState([]);
  const [recovery, setRecovery] = useState([]);
  const [loading, setLoading] = useState(false);

  // Default to latest period once loaded
  useEffect(() => {
    if (latest && !period.start) setPeriod({ start: latest.period_start, end: latest.period_end });
  }, [latest]); // eslint-disable-line

  const load = useCallback(async () => {
    if (!period.start || !period.end) return;
    setLoading(true);
    try {
      const catPart = category ? `&category=${encodeURIComponent(category)}` : "";
      const qs = `periodStart=${period.start}&periodEnd=${period.end}`;
      const [ce, fm, rv] = await Promise.all([
        fetch(`${API_BASE}/od/analytics/collection-efficiency?${qs}&groupBy=${groupBy}${catPart}`).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/od/analytics/funder-mix?${qs}${catPart}`).then(r => r.json()).catch(() => ({ rows: [] })),
        fetch(`${API_BASE}/od/analytics/recovery-velocity?${qs}&limit=50${catPart}`).then(r => r.json()).catch(() => ({ rows: [] })),
      ]);
      setData(ce);
      setFunderMix(Array.isArray(fm?.rows) ? fm.rows : []);
      setRecovery(Array.isArray(rv?.rows) ? rv.rows : []);
    } finally { setLoading(false); }
  }, [period.start, period.end, groupBy, category]);

  useEffect(() => { load(); }, [load]);

  const headline = data?.headline || null;
  const breakdown = Array.isArray(data?.breakdown) ? data.breakdown : [];
  const top15 = useMemo(() => breakdown.slice(0, 15).map(r => ({
    label: r.label?.length > 18 ? r.label.slice(0, 16) + "…" : r.label,
    fullLabel: r.label, cePct: Number(r.cePct || 0),
    demand: r.demand || 0, collected: r.collected || 0,
  })), [breakdown]);

  return (
    <div className="space-y-4">
      {/* Period + groupBy selector */}
      <div className="bg-white rounded-xl border p-4 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Period</label>
          <select
            value={period.start && period.end ? `${period.start}__${period.end}` : ""}
            onChange={e => {
              const [s, ed] = e.target.value.split("__");
              setPeriod({ start: s, end: ed });
            }}
            className="w-full px-2.5 py-2 border rounded-lg text-sm">
            {periods.length === 0 && <option>No periods uploaded</option>}
            {periods.map(p => (
              <option key={`${p.period_start}__${p.period_end}`} value={`${p.period_start}__${p.period_end}`}>
                {formatDateDMY(p.period_start)} → {formatDateDMY(p.period_end)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Group By</label>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)}
            className="w-full px-2.5 py-2 border rounded-lg text-sm">
            <option value="branch">Branch</option>
            <option value="officer">Officer</option>
            <option value="product">Product</option>
            <option value="funder">Funder</option>
            <option value="center">Center</option>
          </select>
        </div>
        <div className="md:col-span-2 text-xs text-gray-500">
          {loading ? "Loading…" : headline && headline.demand > 0 ? (
            <>Demand <b>{formatLakhs(headline.demand)}</b> · Collected <b>{formatLakhs(headline.collected)}</b> · {breakdown.length} {groupBy}s · {headline.accounts?.toLocaleString() || 0} accts</>
          ) : "—"}
        </div>
        <button onClick={load}
          className="w-full py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700">
          Refresh
        </button>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <button type="button"
          onClick={() => openDrill && openDrill({
            periodStart: period.start, periodEnd: period.end,
            from: period.start, to: period.end,
            title: "Collection Efficiency",
            subtitle: headline ? `${formatLakhs(headline.collected)} of ${formatLakhs(headline.demand)} demanded` : "",
          })}
          className="rounded-xl border p-4 bg-gradient-to-br from-teal-50 to-cyan-50 border-teal-200 text-left w-full cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 active:translate-y-0 relative group">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-teal-700 opacity-80">
            <Gauge size={14} /> Collection Efficiency
            <ChevronRight size={12} className="ml-auto opacity-40 group-hover:opacity-100 group-hover:translate-x-0.5 transition" />
          </div>
          <div className={`text-3xl font-bold mt-1 ${ceColor(headline?.cePct)}`}>
            {headline ? formatPct(headline.cePct, 2) : "—"}
          </div>
          <div className="text-[11px] text-gray-500 mt-1">
            {headline ? `${formatLakhs(headline.collected)} of ${formatLakhs(headline.demand)} demanded` : ""}
          </div>
        </button>
        <KpiCard icon={<DollarSign />} label="Principal Demand" color="indigo"
          value={formatLakhs(headline?.principal_demand || 0)}
          sub={`Collected ${formatLakhs(headline?.principal_collected || 0)} · click for detail`}
          onClick={() => openDrill && openDrill({
            periodStart: period.start, periodEnd: period.end,
            from: period.start, to: period.end,
            title: "Principal Demand",
            subtitle: `${formatLakhs(headline?.principal_demand || 0)} demanded · ${formatLakhs(headline?.principal_collected || 0)} collected`,
          })} />
        <KpiCard icon={<DollarSign />} label="Interest Demand" color="amber"
          value={formatLakhs(headline?.interest_demand || 0)}
          sub={`Collected ${formatLakhs(headline?.interest_collected || 0)} · click for detail`}
          onClick={() => openDrill && openDrill({
            periodStart: period.start, periodEnd: period.end,
            from: period.start, to: period.end,
            title: "Interest Demand",
            subtitle: `${formatLakhs(headline?.interest_demand || 0)} demanded · ${formatLakhs(headline?.interest_collected || 0)} collected`,
          })} />
        <KpiCard icon={<Users />} label="Accounts with Demand" color="teal"
          value={(headline?.accounts || 0).toLocaleString()}
          sub={`${breakdown.length} ${groupBy}s tracked · click for detail`}
          onClick={() => openDrill && openDrill({
            periodStart: period.start, periodEnd: period.end,
            from: period.start, to: period.end,
            title: "Accounts with Demand",
            subtitle: `${(headline?.accounts || 0).toLocaleString()} accounts in period`,
          })} />
      </div>

      {/* Ranked CE% bar chart */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-gray-800">Collection Efficiency by {groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}</h3>
            <p className="text-xs text-gray-500">Top 15 by demand. Bars coloured by CE% (red &lt; 50%, amber 50-85%, green 85%+).</p>
          </div>
          <button onClick={() => downloadCSV(breakdown, `ce-${groupBy}-${period.end}.csv`)}
            className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
        </div>
        <ResponsiveContainer width="100%" height={Math.max(260, top15.length * 28)}>
          <BarChart data={top15} layout="vertical" margin={{ left: 100 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" domain={[0, (dataMax) => Math.max(100, Math.ceil(dataMax))]} fontSize={11} tickFormatter={v => `${v}%`} />
            <YAxis dataKey="label" type="category" fontSize={10} width={120} />
            <Tooltip
              formatter={(v, n, p) => n === "cePct" ? [`${Number(v).toFixed(1)}%`, "CE%"] : [v, n]}
              labelFormatter={(l, p) => p?.[0]?.payload?.fullLabel || l} />
            <Bar dataKey="cePct" name="CE%" radius={[0, 4, 4, 0]}>
              {top15.map((r, i) => {
                const c = r.cePct >= 95 ? "#059669" : r.cePct >= 85 ? "#10b981" : r.cePct >= 70 ? "#f59e0b" : r.cePct >= 50 ? "#f97316" : "#ef4444";
                return <Cell key={i} fill={c} />;
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Full breakdown table */}
      <div className="bg-white rounded-xl border">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Full Breakdown</h3>
          <span className="text-xs text-gray-500">{breakdown.length.toLocaleString()} rows</span>
        </div>
        <div className="overflow-x-auto max-h-96 overflow-y-auto">
          <SortableSection initialKey="collected" initialDir="desc" render={sort => (
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-gray-50 text-gray-600 uppercase text-[10px]">
                <tr>
                  <th className="text-left px-4 py-2">{sort.header("label", groupBy.charAt(0).toUpperCase() + groupBy.slice(1))}</th>
                  <th className="text-right px-4 py-2">{sort.header("accounts", "Accts")}</th>
                  <th className="text-right px-4 py-2">{sort.header("demand", "Demand")}</th>
                  <th className="text-right px-4 py-2">{sort.header("collected", "Collected")}</th>
                  <th className="text-right px-4 py-2">{sort.header("cePct", "CE%")}</th>
                  <th className="text-right px-4 py-2">{sort.header("principal_overdue", "Prin. Overdue")}</th>
                  <th className="text-right px-4 py-2">{sort.header("interest_overdue", "Int. Overdue")}</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const sortedBreakdown = sort.apply(breakdown);
                  if (sortedBreakdown.length === 0) {
                    return <tr><td colSpan={7} className="text-center text-gray-400 py-6">No data for selected period.</td></tr>;
                  }
                  return sortedBreakdown.map((r, i) => {
                    const slice = {
                      periodStart: period.start, periodEnd: period.end,
                      from: period.start, to: period.end,
                      title: `${groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}: ${r.label}`,
                      subtitle: `${formatDateDMY(period.start)} → ${formatDateDMY(period.end)} · CE% ${formatPct(r.cePct, 1)}`,
                    };
                    if (groupBy === "branch")  slice.branch = r.label;
                    if (groupBy === "product") slice.product = r.label;
                    const drillable = groupBy === "branch" || groupBy === "product";
                    return (
                      <tr key={i}
                          onClick={drillable && openDrill ? () => openDrill(slice) : undefined}
                          className={`border-t hover:bg-gray-50 ${drillable ? "cursor-pointer" : ""}`}>
                        <td className="px-4 py-1.5 font-medium text-gray-800">{r.label}</td>
                        <td className="px-4 py-1.5 text-right">{(r.accounts || 0).toLocaleString()}</td>
                        <td className="px-4 py-1.5 text-right">{formatLakhs(r.demand)}</td>
                        <td className="px-4 py-1.5 text-right text-teal-700 font-medium">{formatLakhs(r.collected)}</td>
                        <td className={`px-4 py-1.5 text-right font-semibold ${ceColor(r.cePct)}`}>{formatPct(r.cePct)}</td>
                        <td className="px-4 py-1.5 text-right text-red-600">{formatLakhs(r.principal_overdue)}</td>
                        <td className="px-4 py-1.5 text-right text-amber-600">{formatLakhs(r.interest_overdue)}</td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          )} />
        </div>
      </div>

      {/* Funder mix + Recovery velocity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-gray-800">Funder / Fund Source Mix</h3>
              <p className="text-xs text-gray-500">CE% broken out by funder — helpful when reporting to each lender.</p>
            </div>
            <button onClick={() => downloadCSV(funderMix, `funder-mix-${period.end}.csv`)}
              className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
          </div>
          <div className="overflow-y-auto max-h-72">
            <SortableSection initialKey="collected" initialDir="desc" render={sort => (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-2">{sort.header("funder", "Funder")}</th>
                    <th className="py-2 pr-2">{sort.header("fund_source", "Fund Source")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("principal_outstanding_end", "POS End")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("demand", "Demand")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("collected", "Collected")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("cePct", "CE%")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const sortedFunder = sort.apply(funderMix);
                    if (sortedFunder.length === 0) {
                      return <tr><td colSpan={6} className="py-4 text-center text-gray-400">None.</td></tr>;
                    }
                    return sortedFunder.map((f, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-1.5 pr-2 font-medium">{f.funder}</td>
                        <td className="py-1.5 pr-2 text-gray-600">{f.fund_source}</td>
                        <td className="py-1.5 pr-2 text-right">{formatLakhs(f.principal_outstanding_end)}</td>
                        <td className="py-1.5 pr-2 text-right">{formatLakhs(f.demand)}</td>
                        <td className="py-1.5 pr-2 text-right text-teal-700">{formatLakhs(f.collected)}</td>
                        <td className={`py-1.5 pr-2 text-right font-semibold ${ceColor(f.cePct)}`}>{formatPct(f.cePct)}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            )} />
          </div>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-gray-800">Top Recovery Velocity</h3>
              <p className="text-xs text-gray-500">Accounts with the largest principal reduction in this period — real recovery wins.</p>
            </div>
            <button onClick={() => downloadCSV(recovery, `recovery-velocity-${period.end}.csv`)}
              className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
          </div>
          <div className="overflow-y-auto max-h-72">
            <SortableSection initialKey="principal_reduction" initialDir="desc" render={sort => (
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-gray-500 border-b">
                    <th className="py-2 pr-2">{sort.header("customer_name", "Customer")}</th>
                    <th className="py-2 pr-2">{sort.header("branch_name", "Branch")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("principal_start", "POS Start")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("principal_end", "POS End")}</th>
                    <th className="py-2 pr-2 text-right">{sort.header("principal_reduction", "Reduced")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const sortedRecovery = sort.apply(recovery);
                    if (sortedRecovery.length === 0) {
                      return <tr><td colSpan={5} className="py-4 text-center text-gray-400">None.</td></tr>;
                    }
                    return sortedRecovery.map((r, i) => (
                      <tr key={i} className="border-b">
                        <td className="py-1.5 pr-2">
                          <div className="font-medium">{r.customer_name || "—"}</div>
                          <div className="text-[10px] text-gray-400">{r.loan_account_no}</div>
                        </td>
                        <td className="py-1.5 pr-2">{r.branch_name}</td>
                        <td className="py-1.5 pr-2 text-right text-gray-500">{formatLakhs(r.principal_outstanding_start)}</td>
                        <td className="py-1.5 pr-2 text-right">{formatLakhs(r.principal_outstanding_end)}</td>
                        <td className="py-1.5 pr-2 text-right font-semibold text-emerald-700">{formatLakhs(r.principal_reduced)}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            )} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MonthlyCollectionsView ────────────────────────────────────────────────
// Calendar-month rollup of demand vs collected from od_client_period.
// A "month" here = substr(period_end, 1, 7), so all periods ending in the
// same calendar month are aggregated together.
//
// Layout:
//   1. Headline KPI cards for the latest month
//   2. Monthly rollup table (one row per month, last 36 months)
//   3. Month selector + Group By switcher
//   4. Breakdown table (Branch / Product / Officer) for the selected month
//
// Read-only. No writes, no changes to ingest or any existing endpoint.
function MonthlyCollectionsView({ category, openDrill }) {
  const [months, setMonths]   = useState([]);
  const [loadingMonths, setLoadingMonths] = useState(false);

  const [selectedMonth, setSelectedMonth] = useState("");
  const [groupBy, setGroupBy] = useState("branch");
  const [breakdown, setBreakdown] = useState([]);
  const [loadingBreakdown, setLoadingBreakdown] = useState(false);

  // Load monthly rollup
  const loadMonths = useCallback(async () => {
    setLoadingMonths(true);
    try {
      const catPart = category ? `?category=${encodeURIComponent(category)}` : "";
      const r = await fetch(`${API_BASE}/od/analytics/monthly-collections/summary${catPart}`)
        .then(r => r.json()).catch(() => ({ months: [] }));
      const rows = Array.isArray(r?.months) ? r.months : [];
      setMonths(rows);
      // default-select most recent month on first load
      if (rows.length > 0) {
        setSelectedMonth(prev => prev || rows[0].year_month);
      }
    } finally { setLoadingMonths(false); }
  }, [category]);

  useEffect(() => { loadMonths(); }, [loadMonths]);

  // Load per-group breakdown for the selected month
  const loadBreakdown = useCallback(async () => {
    if (!selectedMonth) { setBreakdown([]); return; }
    setLoadingBreakdown(true);
    try {
      const catPart = category ? `&category=${encodeURIComponent(category)}` : "";
      const r = await fetch(
        `${API_BASE}/od/analytics/monthly-collections/breakdown?yearMonth=${encodeURIComponent(selectedMonth)}&groupBy=${groupBy}${catPart}`
      ).then(r => r.json()).catch(() => ({ rows: [] }));
      setBreakdown(Array.isArray(r?.rows) ? r.rows : []);
    } finally { setLoadingBreakdown(false); }
  }, [selectedMonth, groupBy, category]);

  useEffect(() => { loadBreakdown(); }, [loadBreakdown]);

  // Helpers
  const monthLabel = (ym) => {
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return ym || "—";
    const [y, m] = ym.split("-");
    const names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return `${names[parseInt(m, 10) - 1]} ${y}`;
  };

  const latest = months[0] || null;
  const selectedRow = useMemo(
    () => months.find(m => m.year_month === selectedMonth) || null,
    [months, selectedMonth]
  );

  // Click-to-drill on breakdown rows (branch/product drillable today; officer is
  // not supported by /od/drilldown so we just skip the drill there — same
  // behaviour as the Collection Efficiency tab).
  const openSliceForRow = (row) => {
    if (!openDrill || !selectedRow) return;
    const slice = {
      periodStart: selectedRow.period_start_min,
      periodEnd: selectedRow.period_end_max,
      from: selectedRow.period_start_min,
      to: selectedRow.period_end_max,
      title: `${groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}: ${row.label}`,
      subtitle: `${monthLabel(selectedMonth)} · CE% ${formatPct(row.ce_pct, 1)}`,
    };
    if (groupBy === "branch")  slice.branch  = row.label;
    if (groupBy === "product") slice.product = row.label;
    openDrill(slice);
  };
  const drillable = groupBy === "branch" || groupBy === "product";

  return (
    <div className="space-y-4">
      {/* Headline KPIs for the latest month */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<CalendarRange />} label={latest ? `Latest · ${monthLabel(latest.year_month)}` : "Latest month"} color="teal"
          value={latest ? formatLakhs(latest.total_demand) : "—"}
          sub={latest ? `Demand · ${latest.accounts?.toLocaleString() || 0} accts` : ""} />
        <KpiCard icon={<DollarSign />} label="Principal Collected" color="indigo"
          value={latest ? formatLakhs(latest.principal_collected) : "—"}
          sub={latest ? `of ${formatLakhs(latest.principal_demand)} demanded · ${formatPct(latest.principal_ce_pct, 1)}` : ""} />
        <KpiCard icon={<DollarSign />} label="Interest Collected" color="amber"
          value={latest ? formatLakhs(latest.interest_collected) : "—"}
          sub={latest ? `of ${formatLakhs(latest.interest_demand)} demanded · ${formatPct(latest.interest_ce_pct, 1)}` : ""} />
        <KpiCard icon={<AlertTriangle />} label="Remaining (Total)" color="red"
          value={latest ? formatLakhs(latest.remaining_total) : "—"}
          sub={latest ? `P ${formatLakhs(latest.remaining_principal)} · I ${formatLakhs(latest.remaining_interest)}` : ""} />
      </div>

      {/* Monthly rollup table */}
      <div className="bg-white rounded-xl border">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-800">Monthly Rollup</h3>
            <p className="text-xs text-gray-500">
              One row per calendar month · demand and collections per category · remaining = demand − collected.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {loadingMonths && <span className="text-xs text-gray-400">Loading…</span>}
            <button onClick={loadMonths}
              className="flex items-center gap-1.5 px-2.5 py-1.5 bg-white border rounded-lg text-xs hover:bg-gray-50">
              <RefreshCw size={12} className={loadingMonths ? "animate-spin" : ""} /> Refresh
            </button>
            <button onClick={() => downloadCSV(months, `monthly-collections.csv`)}
              className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 text-gray-600 uppercase text-[10px]">
              <tr>
                <th className="text-left px-4 py-2">Month</th>
                <th className="text-right px-4 py-2">Accts</th>
                <th className="text-right px-4 py-2">Demand</th>
                <th className="text-right px-4 py-2">Prin. Collected</th>
                <th className="text-right px-4 py-2">Int. Collected</th>
                <th className="text-right px-4 py-2">Total Collected</th>
                <th className="text-right px-4 py-2">Remaining (Prin.)</th>
                <th className="text-right px-4 py-2">Remaining (Int.)</th>
                <th className="text-right px-4 py-2">CE%</th>
              </tr>
            </thead>
            <tbody>
              {months.length === 0 ? (
                <tr><td colSpan={9} className="text-center text-gray-400 py-6">
                  {loadingMonths ? "Loading…" : "No client-period data uploaded yet."}
                </td></tr>
              ) : months.map(m => (
                <tr key={m.year_month}
                    onClick={() => setSelectedMonth(m.year_month)}
                    className={`border-t hover:bg-gray-50 cursor-pointer ${selectedMonth === m.year_month ? "bg-teal-50/60" : ""}`}>
                  <td className="px-4 py-1.5 font-medium text-gray-800">{monthLabel(m.year_month)}</td>
                  <td className="px-4 py-1.5 text-right">{(m.accounts || 0).toLocaleString()}</td>
                  <td className="px-4 py-1.5 text-right">{formatLakhs(m.total_demand)}</td>
                  <td className="px-4 py-1.5 text-right text-indigo-700">{formatLakhs(m.principal_collected)}</td>
                  <td className="px-4 py-1.5 text-right text-amber-700">{formatLakhs(m.interest_collected)}</td>
                  <td className="px-4 py-1.5 text-right text-teal-700 font-medium">{formatLakhs(m.total_collected)}</td>
                  <td className="px-4 py-1.5 text-right text-red-600">{formatLakhs(m.remaining_principal)}</td>
                  <td className="px-4 py-1.5 text-right text-red-600">{formatLakhs(m.remaining_interest)}</td>
                  <td className={`px-4 py-1.5 text-right font-semibold ${ceColor(m.ce_pct)}`}>{formatPct(m.ce_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Breakdown controls */}
      <div className="bg-white rounded-xl border p-4 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Month</label>
          <select value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)}
            className="w-full px-2.5 py-2 border rounded-lg text-sm">
            {months.length === 0 && <option value="">No months available</option>}
            {months.map(m => (
              <option key={m.year_month} value={m.year_month}>{monthLabel(m.year_month)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Group By</label>
          <select value={groupBy} onChange={e => setGroupBy(e.target.value)}
            className="w-full px-2.5 py-2 border rounded-lg text-sm">
            <option value="branch">Branch</option>
            <option value="product">Product</option>
            <option value="officer">Officer</option>
          </select>
        </div>
        <div className="md:col-span-2 text-xs text-gray-500">
          {loadingBreakdown ? "Loading…" : selectedRow ? (
            <>Demand <b>{formatLakhs(selectedRow.total_demand)}</b> · Collected <b>{formatLakhs(selectedRow.total_collected)}</b> ·
              {" "}Remaining <b className="text-red-600">{formatLakhs(selectedRow.remaining_total)}</b> ·
              {" "}{breakdown.length} {groupBy}s</>
          ) : "—"}
        </div>
      </div>

      {/* Breakdown table */}
      <div className="bg-white rounded-xl border">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-800">
              {groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}-wise breakdown · {monthLabel(selectedMonth)}
            </h3>
            <p className="text-xs text-gray-500">
              {drillable
                ? "Click a row to open the customer-level drill-down."
                : "Officer-level drill-down not wired today — use Branch or Product to drill into accounts."}
            </p>
          </div>
          <button onClick={() => downloadCSV(breakdown, `monthly-${groupBy}-${selectedMonth}.csv`)}
            className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
        </div>
        <div className="overflow-x-auto max-h-[32rem] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 text-gray-600 uppercase text-[10px]">
              <tr>
                <th className="text-left px-4 py-2">{groupBy.charAt(0).toUpperCase() + groupBy.slice(1)}</th>
                <th className="text-right px-4 py-2">Accts</th>
                <th className="text-right px-4 py-2">Demand</th>
                <th className="text-right px-4 py-2">Prin. Collected</th>
                <th className="text-right px-4 py-2">Int. Collected</th>
                <th className="text-right px-4 py-2">Total Collected</th>
                <th className="text-right px-4 py-2">Remaining (Prin.)</th>
                <th className="text-right px-4 py-2">Remaining (Int.)</th>
                <th className="text-right px-4 py-2">CE%</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.length === 0 ? (
                <tr><td colSpan={9} className="text-center text-gray-400 py-6">
                  {loadingBreakdown ? "Loading…" : "No data for selected month."}
                </td></tr>
              ) : breakdown.map((r, i) => (
                <tr key={`${r.label}-${i}`}
                    onClick={drillable ? () => openSliceForRow(r) : undefined}
                    className={`border-t hover:bg-gray-50 ${drillable ? "cursor-pointer" : ""}`}>
                  <td className="px-4 py-1.5 font-medium text-gray-800">{r.label}</td>
                  <td className="px-4 py-1.5 text-right">{(r.accounts || 0).toLocaleString()}</td>
                  <td className="px-4 py-1.5 text-right">{formatLakhs(r.total_demand)}</td>
                  <td className="px-4 py-1.5 text-right text-indigo-700">{formatLakhs(r.principal_collected)}</td>
                  <td className="px-4 py-1.5 text-right text-amber-700">{formatLakhs(r.interest_collected)}</td>
                  <td className="px-4 py-1.5 text-right text-teal-700 font-medium">{formatLakhs(r.total_collected)}</td>
                  <td className="px-4 py-1.5 text-right text-red-600">{formatLakhs(r.remaining_principal)}</td>
                  <td className="px-4 py-1.5 text-right text-red-600">{formatLakhs(r.remaining_interest)}</td>
                  <td className={`px-4 py-1.5 text-right font-semibold ${ceColor(r.ce_pct)}`}>{formatPct(r.ce_pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── OfficerScorecardView ──────────────────────────────────────────────────
// Merges owned-book (from client-period, keyed on officer_code = relationship officer)
// with posted receipts (from od_collections, keyed on payment_officer_code = who
// physically collected). Cash % flags officers with heavy cash exposure.
function OfficerScorecardView({ category, openDrill }) {
  const { periods, latest } = useLatestPeriod();
  const [period, setPeriod] = useState({ start: "", end: "" });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState("demand");
  const [sortDir, setSortDir] = useState("desc");
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (latest && !period.start) setPeriod({ start: latest.period_start, end: latest.period_end });
  }, [latest]); // eslint-disable-line

  const load = useCallback(async () => {
    if (!period.start || !period.end) return;
    setLoading(true);
    try {
      const catPart = category ? `&category=${encodeURIComponent(category)}` : "";
      const j = await fetch(`${API_BASE}/od/analytics/officer-scorecard?periodStart=${period.start}&periodEnd=${period.end}${catPart}`).then(r => r.json());
      setRows(Array.isArray(j?.rows) ? j.rows : []);
    } finally { setLoading(false); }
  }, [period.start, period.end, category]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let r = q ? rows.filter(o =>
      (o.officer_name || "").toLowerCase().includes(q) ||
      (o.officer_code || "").toLowerCase().includes(q) ||
      (o.branch_name || "").toLowerCase().includes(q)
    ) : [...rows];
    r.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const an = Number(av), bn = Number(bv);
      const numeric = Number.isFinite(an) && Number.isFinite(bn);
      const cmp = numeric ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return r;
  }, [rows, query, sortKey, sortDir]);

  const totals = useMemo(() => rows.reduce((a, r) => ({
    demand:         a.demand         + (r.demand || 0),
    collected:      a.collected      + (r.collected || 0),
    posted:         a.posted         + (r.posted_amount || 0),
    cash:           a.cash           + (r.cash_amount || 0),
    upi:            a.upi            + (r.upi_amount || 0),
    cheque:         a.cheque         + (r.cheque_amount || 0),
    receipts:       a.receipts       + (r.receipts || 0),
    accounts:       a.accounts       + (r.accounts || 0),
  }), { demand: 0, collected: 0, posted: 0, cash: 0, upi: 0, cheque: 0, receipts: 0, accounts: 0 }), [rows]);
  const overallCe = totals.demand > 0 ? (totals.collected / totals.demand) * 100 : null;
  const overallCash = totals.posted > 0 ? (totals.cash / totals.posted) * 100 : null;

  const sortBtn = (key, label) => (
    <button
      onClick={() => {
        if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
        else { setSortKey(key); setSortDir("desc"); }
      }}
      className={`flex items-center gap-0.5 ${sortKey === key ? "text-teal-700 font-semibold" : "text-gray-500"}`}>
      {label}{sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-4 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Period</label>
          <select
            value={period.start && period.end ? `${period.start}__${period.end}` : ""}
            onChange={e => { const [s, ed] = e.target.value.split("__"); setPeriod({ start: s, end: ed }); }}
            className="w-full px-2.5 py-2 border rounded-lg text-sm">
            {periods.length === 0 && <option>No periods uploaded</option>}
            {periods.map(p => (
              <option key={`${p.period_start}__${p.period_end}`} value={`${p.period_start}__${p.period_end}`}>
                {formatDateDMY(p.period_start)} → {formatDateDMY(p.period_end)}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          <label className="block text-xs text-gray-500 mb-1">Search officer / branch</label>
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Name, code, or branch…"
            className="w-full px-2.5 py-2 border rounded-lg text-sm" />
        </div>
        <button onClick={() => downloadCSV(filtered, `officer-scorecard-${period.end}.csv`)}
          className="w-full py-2 bg-white border text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center justify-center gap-1">
          <Download size={14} /> Export CSV
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<Target />} label="Period CE%" color="teal"
          value={formatPct(overallCe)} sub={`${formatLakhs(totals.collected)} of ${formatLakhs(totals.demand)} · click for detail`}
          onClick={() => openDrill && openDrill({
            periodStart: period.start, periodEnd: period.end,
            from: period.start, to: period.end,
            title: "Officer Period CE%",
            subtitle: `${formatPct(overallCe)} across ${rows.length} officers`,
          })} />
        <KpiCard icon={<Activity />} label="Receipts Posted" color="indigo"
          value={totals.receipts.toLocaleString()} sub={`${formatLakhs(totals.posted)} total · click for detail`}
          onClick={() => openDrill && openDrill({
            periodStart: period.start, periodEnd: period.end,
            from: period.start, to: period.end,
            title: "Receipts Posted",
            subtitle: `${totals.receipts.toLocaleString()} receipts · ${formatLakhs(totals.posted)}`,
          })} />
        <KpiCard icon={<Wallet />} label="Cash Share" color="amber"
          value={formatPct(overallCash)} sub={`${formatLakhs(totals.cash)} in cash · click cash receipts`}
          onClick={() => openDrill && openDrill({
            periodStart: period.start, periodEnd: period.end,
            from: period.start, to: period.end,
            mode: "CASH",
            title: "Cash Receipts",
            subtitle: `${formatPct(overallCash)} of posted · ${formatLakhs(totals.cash)}`,
          })} />
        <KpiCard icon={<Users />} label="Active Officers" color="red"
          value={rows.length.toLocaleString()} sub={`${totals.accounts.toLocaleString()} accts in book · click for detail`}
          onClick={() => openDrill && openDrill({
            periodStart: period.start, periodEnd: period.end,
            from: period.start, to: period.end,
            title: "Active Officers",
            subtitle: `${rows.length} officers · ${totals.accounts.toLocaleString()} accounts`,
          })} />
      </div>

      <div className="bg-white rounded-xl border">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Officer Scorecard</h3>
          <span className="text-xs text-gray-500">{loading ? "Loading…" : `${filtered.length} officers`}</span>
        </div>
        <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 text-gray-600 uppercase text-[10px] z-10">
              <tr>
                <th className="text-left px-3 py-2">{sortBtn("officer_name", "Officer")}</th>
                <th className="text-left px-3 py-2">{sortBtn("branch_name", "Branch")}</th>
                <th className="text-right px-3 py-2">{sortBtn("accounts", "Accts")}</th>
                <th className="text-right px-3 py-2">{sortBtn("demand", "Demand")}</th>
                <th className="text-right px-3 py-2">{sortBtn("collected", "Collected")}</th>
                <th className="text-right px-3 py-2">{sortBtn("cePct", "CE%")}</th>
                <th className="text-right px-3 py-2">{sortBtn("posted_amount", "Posted")}</th>
                <th className="text-right px-3 py-2">{sortBtn("receipts", "Receipts")}</th>
                <th className="text-right px-3 py-2">{sortBtn("cash_amount", "Cash")}</th>
                <th className="text-right px-3 py-2">{sortBtn("cashPct", "Cash%")}</th>
                <th className="text-right px-3 py-2">UPI</th>
                <th className="text-right px-3 py-2">Cheque</th>
                <th className="text-right px-3 py-2">{sortBtn("overdue_end", "OD End")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={13} className="text-center text-gray-400 py-6">No officer data.</td></tr>
              ) : filtered.map((o, i) => (
                <tr key={`${o.officer_code}-${i}`}
                    onClick={() => openDrill && openDrill({
                      branch: o.branch_name || undefined,
                      periodStart: period.start, periodEnd: period.end,
                      from: period.start, to: period.end,
                      title: `Officer: ${o.officer_name || o.officer_code}`,
                      subtitle: `${o.branch_name || ""} · ${o.officer_code || ""}`,
                    })}
                    className="border-t hover:bg-teal-50/50 cursor-pointer">
                  <td className="px-3 py-1.5">
                    <div className="font-medium text-gray-800">{o.officer_name || "—"}</div>
                    <div className="text-[10px] text-gray-400">{o.officer_code}</div>
                  </td>
                  <td className="px-3 py-1.5">{o.branch_name || "—"}</td>
                  <td className="px-3 py-1.5 text-right">{(o.accounts || 0).toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">{formatLakhs(o.demand)}</td>
                  <td className="px-3 py-1.5 text-right text-teal-700 font-medium">{formatLakhs(o.collected)}</td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${ceColor(o.cePct)}`}>{o.cePct == null ? "—" : formatPct(o.cePct)}</td>
                  <td className="px-3 py-1.5 text-right">{formatLakhs(o.posted_amount)}</td>
                  <td className="px-3 py-1.5 text-right">{(o.receipts || 0).toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">{formatLakhs(o.cash_amount)}</td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${(o.cashPct ?? 0) > 70 ? "text-red-700" : (o.cashPct ?? 0) > 40 ? "text-amber-700" : "text-emerald-700"}`}>
                    {o.cashPct == null ? "—" : formatPct(o.cashPct, 0)}
                  </td>
                  <td className="px-3 py-1.5 text-right">{formatLakhs(o.upi_amount)}</td>
                  <td className="px-3 py-1.5 text-right">{formatLakhs(o.cheque_amount)}</td>
                  <td className="px-3 py-1.5 text-right text-red-600">{formatLakhs(o.overdue_end)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-2 border-t bg-gray-50 text-[11px] text-gray-500">
          Tip: officers with <b>&gt;70% cash</b> are flagged red — consider UPI-first targets to cut cash handling risk.
        </div>
      </div>
    </div>
  );
}

// ─── DailyCollectionsView ──────────────────────────────────────────────────
// Day-by-day rupees collected with stacked mode breakdown + branch leaderboard
// + overall mode mix pie. Highlights missed days in the selected window.
function DailyCollectionsView({ category, branches, openDrill }) {
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [branch, setBranch] = useState("");
  const [data, setData] = useState({ byDay: [], byBranch: [], modeMix: [] });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      if (branch) p.set("branch", branch);
      if (category) p.set("category", category);
      const j = await fetch(`${API_BASE}/od/analytics/daily-collections?${p.toString()}`).then(r => r.json());
      setData({
        byDay: Array.isArray(j?.byDay) ? j.byDay : [],
        byBranch: Array.isArray(j?.byBranch) ? j.byBranch : [],
        modeMix: Array.isArray(j?.modeMix) ? j.modeMix : [],
      });
    } finally { setLoading(false); }
  }, [from, to, branch, category]);

  useEffect(() => { load(); }, [load]);

  const totals = useMemo(() => data.byDay.reduce((a, r) => ({
    total: a.total + (r.total || 0),
    cash: a.cash + (r.cash || 0),
    upi: a.upi + (r.upi || 0),
    cheque: a.cheque + (r.cheque || 0),
    receipts: a.receipts + (r.receipts || 0),
    days: a.days + 1,
  }), { total: 0, cash: 0, upi: 0, cheque: 0, receipts: 0, days: 0 }), [data.byDay]);

  const avgPerDay = totals.days > 0 ? totals.total / totals.days : 0;
  const peakDay = useMemo(() => data.byDay.reduce((m, r) => (!m || (r.total || 0) > (m.total || 0)) ? r : m, null), [data.byDay]);

  // Build a continuous daily series from (from..to) and mark missed days
  const dailySeries = useMemo(() => {
    if (!from || !to) return [];
    const map = new Map(data.byDay.map(r => [r.day, r]));
    const out = [];
    const start = new Date(from), end = new Date(to);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      const r = map.get(iso);
      out.push({
        day: iso.slice(5), // MM-DD
        total: r?.total || 0, cash: r?.cash || 0, upi: r?.upi || 0, cheque: r?.cheque || 0,
        missed: !r || !r.total,
      });
    }
    return out;
  }, [data.byDay, from, to]);

  const missedDays = dailySeries.filter(d => d.missed).length;

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-4 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="w-full px-2.5 py-2 border rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="w-full px-2.5 py-2 border rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Branch</label>
          <select value={branch} onChange={e => setBranch(e.target.value)}
            className="w-full px-2.5 py-2 border rounded-lg text-sm">
            <option value="">All Branches</option>
            {branches?.map(b => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="md:col-span-1 text-xs text-gray-500">
          {loading ? "Loading…" : (
            <>{totals.receipts.toLocaleString()} receipts · {formatLakhs(totals.total)} · {missedDays} day(s) with zero</>
          )}
        </div>
        <button onClick={load}
          className="w-full py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700">
          Refresh
        </button>
      </div>

      {/* Headline */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<DollarSign />} label="Total Collected" color="teal"
          value={formatLakhs(totals.total)} sub={`${totals.receipts.toLocaleString()} receipts · click for detail`}
          onClick={() => openDrill && openDrill({
            branch: branch || undefined,
            from, to,
            title: "Total Collected",
            subtitle: `${formatDateDMY(from)} → ${formatDateDMY(to)}${branch ? " · " + branch : ""}`,
          })} />
        <KpiCard icon={<TrendingUp />} label="Daily Avg" color="indigo"
          value={formatLakhs(avgPerDay)} sub={`${totals.days} day(s) with activity · click for detail`}
          onClick={() => openDrill && openDrill({
            branch: branch || undefined,
            from, to,
            title: "Daily Average",
            subtitle: `${formatLakhs(avgPerDay)}/day across ${totals.days} active days`,
          })} />
        <KpiCard icon={<Wallet />} label="Cash / UPI Split" color="amber"
          value={totals.total > 0 ? `${((totals.cash/totals.total)*100).toFixed(0)}% / ${((totals.upi/totals.total)*100).toFixed(0)}%` : "—"}
          sub={`Cash ${formatLakhs(totals.cash)} · UPI ${formatLakhs(totals.upi)} · click cash`}
          onClick={() => openDrill && openDrill({
            branch: branch || undefined,
            from, to,
            mode: "CASH",
            title: "Cash Receipts",
            subtitle: `${formatLakhs(totals.cash)} · ${((totals.cash/Math.max(totals.total,1))*100).toFixed(0)}% of total`,
          })} />
        <KpiCard icon={<Target />} label="Peak Day" color="red"
          value={peakDay ? formatLakhs(peakDay.total) : "—"}
          sub={peakDay ? `${formatDateDMY(peakDay.day)} · click for detail` : ""}
          onClick={peakDay ? () => openDrill && openDrill({
            branch: branch || undefined,
            from: peakDay.day, to: peakDay.day,
            title: `Peak day: ${formatDateDMY(peakDay.day)}`,
            subtitle: `${formatLakhs(peakDay.total)} collected · ${peakDay.receipts || 0} receipts`,
          }) : undefined} />
      </div>

      {/* Daily stacked bars */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-gray-800">Daily Collections (stacked by mode)</h3>
            <p className="text-xs text-gray-500">Days with zero receipts are rendered as gaps — useful for spotting off-days or posting lags.</p>
          </div>
          <button onClick={() => downloadCSV(data.byDay, `daily-collections-${from}_${to}.csv`)}
            className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={dailySeries}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="day" fontSize={10} />
            <YAxis fontSize={10} tickFormatter={v => `${Math.round(v / 100000)}L`} />
            <Tooltip formatter={v => formatLakhs(v)} />
            <Legend />
            <Bar dataKey="cash" stackId="a" fill="#f59e0b" name="Cash" />
            <Bar dataKey="upi" stackId="a" fill="#10b981" name="UPI" />
            <Bar dataKey="cheque" stackId="a" fill="#6366f1" name="Cheque/DD" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Branch leaderboard + mode mix pie */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-800">Top Branches — Period</h3>
            <button onClick={() => downloadCSV(data.byBranch, `branch-collections-${from}_${to}.csv`)}
              className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
          </div>
          <div className="overflow-y-auto max-h-80">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-2">Branch</th>
                  <th className="py-2 pr-2 text-right">Receipts</th>
                  <th className="py-2 pr-2 text-right">Total</th>
                  <th className="py-2 pr-2 text-right">Cash</th>
                  <th className="py-2 pr-2 text-right">UPI</th>
                  <th className="py-2 pr-2 text-right">Cheque</th>
                  <th className="py-2 pr-2 text-right">Cash%</th>
                </tr>
              </thead>
              <tbody>
                {data.byBranch.length === 0 ? (
                  <tr><td colSpan={7} className="py-4 text-center text-gray-400">None.</td></tr>
                ) : data.byBranch.slice(0, 100).map((b, i) => {
                  const cashPct = b.total > 0 ? (b.cash / b.total) * 100 : 0;
                  return (
                    <tr key={i} className="border-b hover:bg-teal-50/50 cursor-pointer"
                        onClick={() => openDrill && openDrill({
                          branch: b.branch, from, to,
                          title: `Branch: ${b.branch}`,
                          subtitle: `Receipts ${formatDateDMY(from)} → ${formatDateDMY(to)}`,
                        })}>
                      <td className="py-1.5 pr-2 font-medium">{b.branch}</td>
                      <td className="py-1.5 pr-2 text-right">{(b.receipts || 0).toLocaleString()}</td>
                      <td className="py-1.5 pr-2 text-right text-teal-700 font-medium">{formatLakhs(b.total)}</td>
                      <td className="py-1.5 pr-2 text-right">{formatLakhs(b.cash)}</td>
                      <td className="py-1.5 pr-2 text-right">{formatLakhs(b.upi)}</td>
                      <td className="py-1.5 pr-2 text-right">{formatLakhs(b.cheque)}</td>
                      <td className={`py-1.5 pr-2 text-right font-semibold ${cashPct > 70 ? "text-red-600" : cashPct > 40 ? "text-amber-600" : "text-emerald-700"}`}>
                        {cashPct.toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold text-gray-800 mb-3">Mode Mix</h3>
          {data.modeMix.length === 0 ? (
            <div className="text-gray-400 text-sm">No data.</div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={data.modeMix} cx="50%" cy="50%" innerRadius={50} outerRadius={80}
                    dataKey="total" nameKey="mode"
                    paddingAngle={1} minAngle={2}
                    isAnimationActive={false}>
                    {data.modeMix.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [formatLakhs(v), n]} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-3 space-y-1 text-xs">
                {data.modeMix.map((m, i) => {
                  const pct = totals.total > 0 ? (m.total / totals.total) * 100 : 0;
                  return (
                    <div key={i} className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                        <span className="text-gray-700">{m.mode}</span>
                      </div>
                      <span className="text-gray-500">{formatLakhs(m.total)} <span className="text-gray-400">({pct.toFixed(0)}%)</span></span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── RiskTriageView ────────────────────────────────────────────────────────
// NPA ageing + death-case tracker + installments-due distribution
// — driven by the Overdue Report snapshot.
function RiskTriageView({ category, openDrill }) {
  const [snap, setSnap] = useState("");
  const [ageing, setAgeing] = useState(null);
  const [deaths, setDeaths] = useState(null);
  const [inst, setInst] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (snap) params.set("snapshotDate", snap);
      if (category) params.set("category", category);
      const q = params.toString() ? `?${params.toString()}` : "";
      const [ag, de, ins] = await Promise.all([
        fetch(`${API_BASE}/od/analytics/npa-ageing${q}`).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/od/analytics/death-cases${q}`).then(r => r.json()).catch(() => null),
        fetch(`${API_BASE}/od/analytics/installments-due${q}`).then(r => r.json()).catch(() => null),
      ]);
      setAgeing(ag); setDeaths(de); setInst(ins);
      if (!snap && ag?.snapshotDate) setSnap(ag.snapshotDate);
    } finally { setLoading(false); }
  }, [snap, category]);

  useEffect(() => { load(); }, [load]);

  const ageingChart = useMemo(() => {
    if (!ageing?.buckets) return [];
    return ageing.buckets.map(b => ({
      name: b.bucket,
      accounts: b.accounts || 0,
      principalL: Math.round((b.principal || 0) / 100000),
      totalOd: (b.principal || 0) + (b.interest || 0),
    }));
  }, [ageing]);

  const instChart = useMemo(() => {
    if (!inst?.buckets) return [];
    return inst.buckets.map(b => ({
      name: b.bucket,
      accounts: b.accounts || 0,
      principalL: Math.round((b.principal || 0) / 100000),
    }));
  }, [inst]);

  const ageingTotals = useMemo(() => (ageing?.buckets || []).reduce((a, b) => ({
    accounts: a.accounts + (b.accounts || 0),
    principal: a.principal + (b.principal || 0),
    interest: a.interest + (b.interest || 0),
  }), { accounts: 0, principal: 0, interest: 0 }), [ageing]);

  const overTwelve = (ageing?.buckets || [])
    .filter(b => b.bucket === "12-24 months" || b.bucket === "24+ months")
    .reduce((a, b) => ({ accounts: a.accounts + (b.accounts || 0), principal: a.principal + (b.principal || 0) }), { accounts: 0, principal: 0 });

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-4 flex items-end gap-3">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Snapshot Date (Overdue Report)</label>
          <input type="date" value={snap} onChange={e => setSnap(e.target.value)}
            className="w-full md:w-56 px-2.5 py-2 border rounded-lg text-sm" />
        </div>
        <div className="flex-1 text-xs text-gray-500">
          {loading ? "Loading…" : ageing?.snapshotDate ? (
            <>Snapshot: <b>{formatDateDMY(ageing.snapshotDate)}</b> · {ageing.totalNpaAccounts?.toLocaleString() || 0} NPA accts</>
          ) : "—"}
        </div>
        <button onClick={load}
          className="py-2 px-4 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700">
          Refresh
        </button>
      </div>

      {/* Headline */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<AlertTriangle />} label="NPA Accounts" color="red"
          value={(ageing?.totalNpaAccounts || 0).toLocaleString()}
          sub={`${formatLakhs(ageingTotals.principal + ageingTotals.interest)} total OD · click for customers`}
          onClick={() => openDrill && openDrill({
            npaOnly: true,
            title: "NPA Accounts",
            subtitle: `${(ageing?.totalNpaAccounts || 0).toLocaleString()} NPA · ${formatLakhs(ageingTotals.principal + ageingTotals.interest)} OD`,
          })} />
        <KpiCard icon={<Layers />} label="12-Month+ Stranded" color="amber"
          value={overTwelve.accounts.toLocaleString()}
          sub={`${formatLakhs(overTwelve.principal)} principal · click for customers`}
          onClick={() => openDrill && openDrill({
            npaOnly: true,
            minMonthsStranded: 12,
            title: "12-Month+ Stranded NPA",
            subtitle: `${overTwelve.accounts.toLocaleString()} accounts · ${formatLakhs(overTwelve.principal)} principal`,
          })} />
        <KpiCard icon={<Skull />} label="Death Cases" color="indigo"
          value={(deaths?.totals?.accounts || 0).toLocaleString()}
          sub={`${formatLakhs(deaths?.totals?.principal || 0)} principal · click for customers`}
          onClick={() => openDrill && openDrill({
            deathOnly: true,
            title: "Death Cases",
            subtitle: `${(deaths?.totals?.accounts || 0).toLocaleString()} cases · ${formatLakhs(deaths?.totals?.principal || 0)} principal`,
          })} />
        <KpiCard icon={<Clock />} label="Installments Due > 6" color="teal"
          value={((inst?.buckets || []).filter(b => b.min >= 7).reduce((s, b) => s + b.accounts, 0)).toLocaleString()}
          sub="Long-dormant / structural defaulters · click for customers"
          onClick={() => openDrill && openDrill({
            minInstallmentsDue: 7,
            title: "Installments Due > 6",
            subtitle: "Long-dormant / structural defaulters",
          })} />
      </div>

      {/* NPA ageing + Installments-due side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-gray-800">NPA Ageing</h3>
              <p className="text-xs text-gray-500">Bucketed by months since First NPA Date — older buckets are harder to recover.</p>
            </div>
            <button onClick={() => downloadCSV(ageing?.buckets || [], `npa-ageing-${snap}.csv`)}
              className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={ageingChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis yAxisId="l" fontSize={11} />
              <YAxis yAxisId="r" orientation="right" fontSize={11} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="l" dataKey="accounts" fill="#ef4444" name="Accounts" />
              <Bar yAxisId="r" dataKey="principalL" fill="#f59e0b" name="Principal (L)" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-gray-800">Installments Due — distribution</h3>
              <p className="text-xs text-gray-500">1 installment = skipped once; 7+ = structural defaulter needing escalation.</p>
            </div>
            <button onClick={() => downloadCSV(inst?.buckets || [], `installments-due-${snap}.csv`)}
              className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={instChart}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={11} />
              <YAxis yAxisId="l" fontSize={11} />
              <YAxis yAxisId="r" orientation="right" fontSize={11} />
              <Tooltip />
              <Legend />
              <Bar yAxisId="l" dataKey="accounts" fill="#0f766e" name="Accounts" />
              <Bar yAxisId="r" dataKey="principalL" fill="#8b5cf6" name="Principal (L)" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* NPA stranded top + Death cases */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-gray-800">Top Stranded NPA Accounts</h3>
              <p className="text-xs text-gray-500">Longest time as NPA — write-off / legal-notice candidates.</p>
            </div>
            <button onClick={() => downloadCSV(ageing?.top || [], `npa-stranded-${snap}.csv`)}
              className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
          </div>
          <div className="overflow-y-auto max-h-80">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-2">Customer</th>
                  <th className="py-2 pr-2">Branch / Officer</th>
                  <th className="py-2 pr-2 text-right">Months NPA</th>
                  <th className="py-2 pr-2 text-right">Principal</th>
                  <th className="py-2 pr-2 text-right">Inst. Due</th>
                </tr>
              </thead>
              <tbody>
                {(ageing?.top || []).length === 0 ? (
                  <tr><td colSpan={5} className="py-4 text-center text-gray-400">None.</td></tr>
                ) : ageing.top.map((r, i) => (
                  <tr key={i} className="border-b hover:bg-red-50/50 cursor-pointer"
                      onClick={() => openDrill && openDrill({
                        branch: r.branch_name,
                        title: r.customer_name || r.loan_account_no,
                        subtitle: `NPA · ${r.branch_name} · ${r.officer_name || ""}`,
                      })}>
                    <td className="py-1.5 pr-2">
                      <div className="font-medium">{r.customer_name || "—"}</div>
                      <div className="text-[10px] text-gray-400">{r.loan_account_no}</div>
                    </td>
                    <td className="py-1.5 pr-2">
                      <div>{r.branch_name}</div>
                      <div className="text-[10px] text-gray-400">{r.officer_name}</div>
                    </td>
                    <td className="py-1.5 pr-2 text-right font-semibold text-red-700">
                      {r.monthsAsNpa != null ? r.monthsAsNpa.toFixed(1) : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-right">{formatINR(r.principal_outstanding)}</td>
                    <td className="py-1.5 pr-2 text-right">{r.installments_due}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-gray-800">Death Cases</h3>
              <p className="text-xs text-gray-500">Flagged as deceased — insurance claim / guarantor pursuit candidates.</p>
            </div>
            <button onClick={() => downloadCSV(deaths?.rows || [], `death-cases-${snap}.csv`)}
              className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
          </div>
          <div className="overflow-y-auto max-h-80">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="text-left text-gray-500 border-b">
                  <th className="py-2 pr-2">Customer / Loan</th>
                  <th className="py-2 pr-2">Branch</th>
                  <th className="py-2 pr-2">Flagged</th>
                  <th className="py-2 pr-2 text-right">Principal</th>
                  <th className="py-2 pr-2 text-right">Interest</th>
                </tr>
              </thead>
              <tbody>
                {(deaths?.rows || []).length === 0 ? (
                  <tr><td colSpan={5} className="py-4 text-center text-gray-400">None.</td></tr>
                ) : deaths.rows.map((r, i) => (
                  <tr key={i} className="border-b hover:bg-indigo-50/50 cursor-pointer"
                      onClick={() => openDrill && openDrill({
                        branch: r.branch_name,
                        title: r.customer_name || r.loan_account_no,
                        subtitle: `Death case · ${r.branch_name}${r.guarantor_name ? " · Guar: " + r.guarantor_name : ""}`,
                      })}>
                    <td className="py-1.5 pr-2">
                      <div className="font-medium">{r.customer_name || "—"}</div>
                      <div className="text-[10px] text-gray-400">{r.loan_account_no}</div>
                      {r.guarantor_name && <div className="text-[10px] text-gray-500">Guar: {r.guarantor_name}</div>}
                    </td>
                    <td className="py-1.5 pr-2">{r.branch_name}</td>
                    <td className="py-1.5 pr-2 text-gray-600">{r.death_flagged_date ? formatDateDMY(r.death_flagged_date) : "—"}</td>
                    <td className="py-1.5 pr-2 text-right">{formatINR(r.principal_outstanding)}</td>
                    <td className="py-1.5 pr-2 text-right">{formatINR(r.interest_outstanding)}</td>
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

// ─── BranchPerformanceView ─────────────────────────────────────────────────
// Per-branch scorecard with click-through to customer-level detail.
function BranchPerformanceView({ category, openDrill }) {
  const { periods, latest } = useLatestPeriod();
  const [period, setPeriod] = useState({ start: "", end: "" });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("principal_outstanding");
  const [sortDir, setSortDir] = useState("desc");

  useEffect(() => {
    if (latest && !period.start) setPeriod({ start: latest.period_start, end: latest.period_end });
  }, [latest]); // eslint-disable-line

  const load = useCallback(async () => {
    if (!period.start || !period.end) return;
    setLoading(true);
    try {
      const catPart = category ? `&category=${encodeURIComponent(category)}` : "";
      const j = await fetch(`${API_BASE}/od/analytics/branch-scorecard?periodStart=${period.start}&periodEnd=${period.end}${catPart}`).then(r => r.json());
      setRows(Array.isArray(j?.rows) ? j.rows : []);
    } finally { setLoading(false); }
  }, [period.start, period.end, category]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = q ? rows.filter(r => (r.branch || "").toLowerCase().includes(q)) : [...rows];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const an = Number(av), bn = Number(bv);
      const numeric = Number.isFinite(an) && Number.isFinite(bn);
      const cmp = numeric ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, query, sortKey, sortDir]);

  const totals = useMemo(() => rows.reduce((a, r) => ({
    accounts: a.accounts + (r.accounts || 0),
    principal_outstanding: a.principal_outstanding + (r.principal_outstanding || 0),
    demand: a.demand + (r.demand || 0),
    collected: a.collected + (r.collected || 0),
    principal_overdue: a.principal_overdue + (r.principal_overdue || 0),
    interest_overdue: a.interest_overdue + (r.interest_overdue || 0),
    receipts: a.receipts + (r.receipts || 0),
    posted_amount: a.posted_amount + (r.posted_amount || 0),
    cash_amount: a.cash_amount + (r.cash_amount || 0),
    npa_accounts: a.npa_accounts + (r.npa_accounts || 0),
  }), { accounts: 0, principal_outstanding: 0, demand: 0, collected: 0, principal_overdue: 0, interest_overdue: 0, receipts: 0, posted_amount: 0, cash_amount: 0, npa_accounts: 0 }), [rows]);

  const overallCe = totals.demand > 0 ? (totals.collected / totals.demand) * 100 : null;
  const overallCash = totals.posted_amount > 0 ? (totals.cash_amount / totals.posted_amount) * 100 : null;
  const worst = useMemo(() => rows.filter(r => r.cePct != null).sort((a, b) => a.cePct - b.cePct)[0] || null, [rows]);
  const best = useMemo(() => rows.filter(r => r.cePct != null && r.demand > 0).sort((a, b) => b.cePct - a.cePct)[0] || null, [rows]);

  const chartData = useMemo(() => filtered.slice(0, 20).map(r => ({
    branch: r.branch.length > 18 ? r.branch.slice(0, 16) + "…" : r.branch,
    fullBranch: r.branch,
    odL: Math.round(((r.principal_overdue || 0) + (r.interest_overdue || 0)) / 100000),
    cePct: Number(r.cePct || 0),
  })), [filtered]);

  const drill = (branch, titleSuffix = "") => openDrill({
    branch,
    periodStart: period.start,
    periodEnd: period.end,
    from: period.start,
    to: period.end,
    title: `Branch: ${branch}`,
    subtitle: titleSuffix || `${formatDateDMY(period.start)} → ${formatDateDMY(period.end)}`,
  });

  const sortBtn = (key, label) => (
    <button
      onClick={() => {
        if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
        else { setSortKey(key); setSortDir("desc"); }
      }}
      className={`flex items-center gap-0.5 ${sortKey === key ? "text-teal-700 font-semibold" : "text-gray-500"}`}>
      {label}{sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* Period selector */}
      <div className="bg-white rounded-xl border p-4 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Period</label>
          <select
            value={period.start && period.end ? `${period.start}__${period.end}` : ""}
            onChange={e => { const [s, ed] = e.target.value.split("__"); setPeriod({ start: s, end: ed }); }}
            className="w-full px-2.5 py-2 border rounded-lg text-sm">
            {periods.length === 0 && <option>No periods uploaded</option>}
            {periods.map(p => (
              <option key={`${p.period_start}__${p.period_end}`} value={`${p.period_start}__${p.period_end}`}>
                {formatDateDMY(p.period_start)} → {formatDateDMY(p.period_end)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Search branch</label>
          <input type="text" value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Branch name…"
            className="w-full px-2.5 py-2 border rounded-lg text-sm" />
        </div>
        <div className="text-xs text-gray-500 self-center">
          {loading ? "Loading…" : `${rows.length} branches tracked`}
        </div>
        <button onClick={() => downloadCSV(filtered, `branch-scorecard-${period.end}.csv`)}
          className="w-full py-2 bg-white border text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center justify-center gap-1">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Headline KPIs (clickable) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<Building2 />} label="Branches Tracked" color="teal"
          value={rows.length.toLocaleString()}
          sub={`${totals.accounts.toLocaleString()} accounts · ${formatLakhs(totals.principal_outstanding)} book`}
          onClick={() => openDrill({
            periodStart: period.start, periodEnd: period.end,
            from: period.start, to: period.end,
            title: "All Branches",
            subtitle: `${rows.length} branches · ${totals.accounts.toLocaleString()} accounts`,
          })} />
        <KpiCard icon={<Target />} label="Portfolio CE%" color="indigo"
          value={formatPct(overallCe)}
          sub={`${formatLakhs(totals.collected)} of ${formatLakhs(totals.demand)} · click for detail`}
          onClick={() => openDrill({
            periodStart: period.start, periodEnd: period.end,
            from: period.start, to: period.end,
            title: "Portfolio Collection Efficiency",
            subtitle: `${formatPct(overallCe)} — all branches combined`,
          })} />
        <KpiCard icon={<AlertTriangle />} label="Weakest Branch" color="red"
          value={worst ? `${worst.branch} — ${formatPct(worst.cePct, 0)}` : "—"}
          sub={worst ? `OD ${formatLakhs((worst.principal_overdue || 0) + (worst.interest_overdue || 0))}` : ""}
          onClick={worst ? () => drill(worst.branch, "Weakest branch by CE%") : undefined} />
        <KpiCard icon={<CheckCircle />} label="Strongest Branch" color="amber"
          value={best ? `${best.branch} — ${formatPct(best.cePct, 0)}` : "—"}
          sub={best ? `${(best.accounts || 0).toLocaleString()} accounts · ${formatLakhs(best.collected)} collected` : ""}
          onClick={best ? () => drill(best.branch, "Strongest branch by CE%") : undefined} />
      </div>

      {/* Ranked chart */}
      <div className="bg-white rounded-xl border p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="font-semibold text-gray-800">Branch OD Exposure & CE%</h3>
            <p className="text-xs text-gray-500">Top 20 by overdue. Click any bar to drilldown.</p>
          </div>
          <span className="text-xs text-gray-500">{filtered.length} shown</span>
        </div>
        <ResponsiveContainer width="100%" height={Math.max(280, chartData.length * 24)}>
          <BarChart data={chartData} layout="vertical" margin={{ left: 90 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis type="number" fontSize={10} />
            <YAxis dataKey="branch" type="category" fontSize={10} width={120} />
            <Tooltip
              formatter={(v, n) => n === "CE%" ? [`${Number(v).toFixed(1)}%`, "CE%"] : [`Rs. ${v}L`, "OD"]}
              labelFormatter={(l, p) => p?.[0]?.payload?.fullBranch || l} />
            <Legend />
            <Bar dataKey="odL" fill="#ef4444" name="OD (L)" radius={[0, 4, 4, 0]}
              onClick={(d) => d?.fullBranch && drill(d.fullBranch)}
              style={{ cursor: "pointer" }} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Scorecard table */}
      <div className="bg-white rounded-xl border">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Branch Scorecard</h3>
          <span className="text-xs text-gray-500">Cash% &gt; 70% flagged red. Click any row for detail.</span>
        </div>
        <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 text-gray-600 uppercase text-[10px] z-10">
              <tr>
                <th className="text-left px-3 py-2">{sortBtn("branch", "Branch")}</th>
                <th className="text-right px-3 py-2">{sortBtn("accounts", "Accts")}</th>
                <th className="text-right px-3 py-2">{sortBtn("officers", "Officers")}</th>
                <th className="text-right px-3 py-2">{sortBtn("principal_outstanding", "Book (P.O/S)")}</th>
                <th className="text-right px-3 py-2">{sortBtn("demand", "Demand")}</th>
                <th className="text-right px-3 py-2">{sortBtn("collected", "Collected")}</th>
                <th className="text-right px-3 py-2">{sortBtn("cePct", "CE%")}</th>
                <th className="text-right px-3 py-2">{sortBtn("principal_overdue", "OD (P+I)")}</th>
                <th className="text-right px-3 py-2">{sortBtn("receipts", "Receipts")}</th>
                <th className="text-right px-3 py-2">{sortBtn("cashPct", "Cash%")}</th>
                <th className="text-right px-3 py-2">{sortBtn("npa_accounts", "NPA")}</th>
                <th className="text-right px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={12} className="text-center text-gray-400 py-6">No branch data. Upload a Client-Wise Collection Report to populate.</td></tr>
              ) : filtered.map((r, i) => {
                const od = (r.principal_overdue || 0) + (r.interest_overdue || 0);
                return (
                  <tr key={r.branch + "-" + i}
                      onClick={() => drill(r.branch)}
                      className="border-t hover:bg-teal-50/50 cursor-pointer group">
                    <td className="px-3 py-1.5 font-medium text-gray-800 group-hover:text-teal-800">{r.branch}</td>
                    <td className="px-3 py-1.5 text-right">{(r.accounts || 0).toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right">{r.officers || 0}</td>
                    <td className="px-3 py-1.5 text-right">{formatLakhs(r.principal_outstanding)}</td>
                    <td className="px-3 py-1.5 text-right">{formatLakhs(r.demand)}</td>
                    <td className="px-3 py-1.5 text-right text-teal-700 font-medium">{formatLakhs(r.collected)}</td>
                    <td className={`px-3 py-1.5 text-right font-semibold ${ceColor(r.cePct)}`}>{r.cePct == null ? "—" : formatPct(r.cePct, 1)}</td>
                    <td className="px-3 py-1.5 text-right text-red-600">{formatLakhs(od)}</td>
                    <td className="px-3 py-1.5 text-right">{(r.receipts || 0).toLocaleString()}</td>
                    <td className={`px-3 py-1.5 text-right font-semibold ${(r.cashPct ?? 0) > 70 ? "text-red-700" : (r.cashPct ?? 0) > 40 ? "text-amber-700" : "text-emerald-700"}`}>
                      {r.cashPct == null ? "—" : formatPct(r.cashPct, 0)}
                    </td>
                    <td className="px-3 py-1.5 text-right">{r.npa_accounts || 0}</td>
                    <td className="px-3 py-1.5 text-right"><ChevronRight size={14} className="opacity-30 group-hover:opacity-100 text-teal-700" /></td>
                  </tr>
                );
              })}
            </tbody>
            {filtered.length > 0 && (
              <tfoot className="sticky bottom-0 bg-gray-50 font-semibold text-gray-800 text-[11px]">
                <tr>
                  <td className="px-3 py-2">Totals</td>
                  <td className="px-3 py-2 text-right">{totals.accounts.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">—</td>
                  <td className="px-3 py-2 text-right">{formatLakhs(totals.principal_outstanding)}</td>
                  <td className="px-3 py-2 text-right">{formatLakhs(totals.demand)}</td>
                  <td className="px-3 py-2 text-right text-teal-700">{formatLakhs(totals.collected)}</td>
                  <td className={`px-3 py-2 text-right ${ceColor(overallCe)}`}>{overallCe == null ? "—" : formatPct(overallCe, 1)}</td>
                  <td className="px-3 py-2 text-right text-red-600">{formatLakhs(totals.principal_overdue + totals.interest_overdue)}</td>
                  <td className="px-3 py-2 text-right">{totals.receipts.toLocaleString()}</td>
                  <td className={`px-3 py-2 text-right ${(overallCash ?? 0) > 70 ? "text-red-700" : (overallCash ?? 0) > 40 ? "text-amber-700" : "text-emerald-700"}`}>
                    {overallCash == null ? "—" : formatPct(overallCash, 0)}
                  </td>
                  <td className="px-3 py-2 text-right">{totals.npa_accounts}</td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── ProductPerformanceView ────────────────────────────────────────────────
// Per-product scorecard + collections-by-product mode mix + branch × product
// CE% heatmap. Cells and rows are clickable to open the shared drilldown.
function ProductPerformanceView({ category, openDrill }) {
  const { periods, latest } = useLatestPeriod();
  const [period, setPeriod] = useState({ start: "", end: "" });
  const [rows, setRows] = useState([]);
  const [collByProduct, setCollByProduct] = useState([]);
  const [matrix, setMatrix] = useState({ branches: [], products: [], matrix: [] });
  const [loading, setLoading] = useState(false);
  const [sortKey, setSortKey] = useState("principal_outstanding");
  const [sortDir, setSortDir] = useState("desc");
  // Matrix size cap — with 212 branches × 379 products the raw heatmap is
  // unreadable AND forces horizontal overflow. Default to the biggest
  // 20 branches × 15 products by book size; user can expand to see all.
  const [matrixExpanded, setMatrixExpanded] = useState(false);

  useEffect(() => {
    if (latest && !period.start) setPeriod({ start: latest.period_start, end: latest.period_end });
  }, [latest]); // eslint-disable-line

  const load = useCallback(async () => {
    if (!period.start || !period.end) return;
    setLoading(true);
    try {
      const catPart = category ? `&category=${encodeURIComponent(category)}` : "";
      const qs = `periodStart=${period.start}&periodEnd=${period.end}`;
      const [ps, cp, mx] = await Promise.all([
        fetch(`${API_BASE}/od/analytics/product-scorecard?${qs}${catPart}`).then(r => r.json()),
        fetch(`${API_BASE}/od/analytics/collections-by-product?from=${period.start}&to=${period.end}${catPart}`).then(r => r.json()),
        fetch(`${API_BASE}/od/analytics/branch-product-matrix?${qs}${catPart}`).then(r => r.json()),
      ]);
      setRows(Array.isArray(ps?.rows) ? ps.rows : []);
      setCollByProduct(Array.isArray(cp?.rows) ? cp.rows : []);
      setMatrix({
        branches: Array.isArray(mx?.branches) ? mx.branches : [],
        products: Array.isArray(mx?.products) ? mx.products : [],
        matrix:   Array.isArray(mx?.matrix)   ? mx.matrix   : [],
      });
    } finally { setLoading(false); }
  }, [period.start, period.end, category]);

  useEffect(() => { load(); }, [load]);

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const an = Number(av), bn = Number(bv);
      const numeric = Number.isFinite(an) && Number.isFinite(bn);
      const cmp = numeric ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  const totals = useMemo(() => rows.reduce((a, r) => ({
    accounts: a.accounts + (r.accounts || 0),
    principal_outstanding: a.principal_outstanding + (r.principal_outstanding || 0),
    demand: a.demand + (r.demand || 0),
    collected: a.collected + (r.collected || 0),
    principal_overdue: a.principal_overdue + (r.principal_overdue || 0),
    interest_overdue: a.interest_overdue + (r.interest_overdue || 0),
    receipts: a.receipts + (r.receipts || 0),
    posted_amount: a.posted_amount + (r.posted_amount || 0),
    cash_amount: a.cash_amount + (r.cash_amount || 0),
  }), { accounts: 0, principal_outstanding: 0, demand: 0, collected: 0, principal_overdue: 0, interest_overdue: 0, receipts: 0, posted_amount: 0, cash_amount: 0 }), [rows]);

  const overallCe = totals.demand > 0 ? (totals.collected / totals.demand) * 100 : null;
  const worst = useMemo(() => rows.filter(r => r.cePct != null && r.demand > 0).sort((a, b) => a.cePct - b.cePct)[0] || null, [rows]);
  const best = useMemo(() => rows.filter(r => r.cePct != null && r.demand > 0).sort((a, b) => b.cePct - a.cePct)[0] || null, [rows]);

  // Build matrix lookup
  const matrixLookup = useMemo(() => {
    const m = new Map();
    for (const c of matrix.matrix) {
      m.set(`${c.branch}||${c.product}`, c);
    }
    return m;
  }, [matrix.matrix]);

  // Keep only the biggest branches/products when collapsed — otherwise the
  // heatmap has tens of thousands of cells and becomes a wall of colour.
  const MATRIX_TOP_BRANCHES = 20;
  const MATRIX_TOP_PRODUCTS = 15;
  const visibleMatrix = useMemo(() => {
    if (matrixExpanded) return { branches: matrix.branches, products: matrix.products };
    const byBookDesc = (a, b) => (b.book || 0) - (a.book || 0);
    const branches = [...matrix.branches].sort(byBookDesc).slice(0, MATRIX_TOP_BRANCHES);
    const products = [...matrix.products].sort(byBookDesc).slice(0, MATRIX_TOP_PRODUCTS);
    return { branches, products };
  }, [matrix.branches, matrix.products, matrixExpanded]);
  const matrixTrimmed =
    matrix.branches.length > visibleMatrix.branches.length ||
    matrix.products.length > visibleMatrix.products.length;

  const drill = (product, branch) => openDrill({
    product: product || undefined,
    branch: branch || undefined,
    periodStart: period.start,
    periodEnd: period.end,
    from: period.start,
    to: period.end,
    title: branch && product ? `${branch} × ${product}` : product ? `Product: ${product}` : `Branch: ${branch}`,
    subtitle: `${formatDateDMY(period.start)} → ${formatDateDMY(period.end)}`,
  });

  const cellColor = (ce) => {
    if (ce == null) return "bg-gray-50 text-gray-300";
    if (ce >= 95) return "bg-emerald-600 text-white";
    if (ce >= 85) return "bg-emerald-400 text-white";
    if (ce >= 70) return "bg-amber-400 text-gray-900";
    if (ce >= 50) return "bg-orange-500 text-white";
    return "bg-red-600 text-white";
  };

  const sortBtn = (key, label) => (
    <button
      onClick={() => {
        if (sortKey === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
        else { setSortKey(key); setSortDir("desc"); }
      }}
      className={`flex items-center gap-0.5 ${sortKey === key ? "text-teal-700 font-semibold" : "text-gray-500"}`}>
      {label}{sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border p-4 grid grid-cols-2 md:grid-cols-4 gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Period</label>
          <select
            value={period.start && period.end ? `${period.start}__${period.end}` : ""}
            onChange={e => { const [s, ed] = e.target.value.split("__"); setPeriod({ start: s, end: ed }); }}
            className="w-full px-2.5 py-2 border rounded-lg text-sm">
            {periods.length === 0 && <option>No periods uploaded</option>}
            {periods.map(p => (
              <option key={`${p.period_start}__${p.period_end}`} value={`${p.period_start}__${p.period_end}`}>
                {formatDateDMY(p.period_start)} → {formatDateDMY(p.period_end)}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2 text-xs text-gray-500 self-center">
          {loading ? "Loading…" : `${rows.length} products · ${matrix.branches.length} branches · ${matrix.matrix.length} branch×product intersections`}
        </div>
        <button onClick={() => downloadCSV(sorted, `product-scorecard-${period.end}.csv`)}
          className="w-full py-2 bg-white border text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center justify-center gap-1">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Headline */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard icon={<Package />} label="Products Tracked" color="teal"
          value={rows.length.toLocaleString()}
          sub={`${totals.accounts.toLocaleString()} accounts · ${formatLakhs(totals.principal_outstanding)} book`}
          onClick={() => openDrill({
            periodStart: period.start, periodEnd: period.end,
            from: period.start, to: period.end,
            title: "All Products",
            subtitle: `${rows.length} products · ${totals.accounts.toLocaleString()} accounts`,
          })} />
        <KpiCard icon={<Target />} label="Portfolio CE%" color="indigo"
          value={formatPct(overallCe)}
          sub={`${formatLakhs(totals.collected)} of ${formatLakhs(totals.demand)} · click for detail`}
          onClick={() => openDrill({
            periodStart: period.start, periodEnd: period.end,
            from: period.start, to: period.end,
            title: "Portfolio CE% — Products",
            subtitle: formatPct(overallCe),
          })} />
        <KpiCard icon={<CheckCircle />} label="Best Product" color="teal"
          value={best ? `${best.product} — ${formatPct(best.cePct, 0)}` : "—"}
          sub={best ? `${(best.accounts || 0).toLocaleString()} accounts` : ""}
          onClick={best ? () => drill(best.product) : undefined} />
        <KpiCard icon={<AlertTriangle />} label="Weakest Product" color="red"
          value={worst ? `${worst.product} — ${formatPct(worst.cePct, 0)}` : "—"}
          sub={worst ? `OD ${formatLakhs((worst.principal_overdue || 0) + (worst.interest_overdue || 0))}` : ""}
          onClick={worst ? () => drill(worst.product) : undefined} />
      </div>

      {/* Product scorecard table */}
      <div className="bg-white rounded-xl border">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Product Scorecard</h3>
          <span className="text-xs text-gray-500">Click any row for detail.</span>
        </div>
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 text-gray-600 uppercase text-[10px] z-10">
              <tr>
                <th className="text-left px-3 py-2">{sortBtn("product", "Product")}</th>
                <th className="text-right px-3 py-2">{sortBtn("accounts", "Accts")}</th>
                <th className="text-right px-3 py-2">{sortBtn("branches", "Branches")}</th>
                <th className="text-right px-3 py-2">{sortBtn("principal_outstanding", "Book")}</th>
                <th className="text-right px-3 py-2">{sortBtn("demand", "Demand")}</th>
                <th className="text-right px-3 py-2">{sortBtn("collected", "Collected")}</th>
                <th className="text-right px-3 py-2">{sortBtn("cePct", "CE%")}</th>
                <th className="text-right px-3 py-2">{sortBtn("principal_overdue", "OD (P)")}</th>
                <th className="text-right px-3 py-2">{sortBtn("receipts", "Receipts")}</th>
                <th className="text-right px-3 py-2">{sortBtn("cashPct", "Cash%")}</th>
                <th className="text-right px-3 py-2">{sortBtn("npa_accounts", "NPA")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.length === 0 ? (
                <tr><td colSpan={12} className="text-center text-gray-400 py-6">No product data. Upload a Client-Wise Collection Report to populate.</td></tr>
              ) : sorted.map((r, i) => (
                <tr key={r.product + "-" + i}
                    onClick={() => drill(r.product)}
                    className="border-t hover:bg-indigo-50/50 cursor-pointer group">
                  <td className="px-3 py-1.5 font-medium text-gray-800 group-hover:text-indigo-800">{r.product}</td>
                  <td className="px-3 py-1.5 text-right">{(r.accounts || 0).toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">{r.branches || 0}</td>
                  <td className="px-3 py-1.5 text-right">{formatLakhs(r.principal_outstanding)}</td>
                  <td className="px-3 py-1.5 text-right">{formatLakhs(r.demand)}</td>
                  <td className="px-3 py-1.5 text-right text-teal-700 font-medium">{formatLakhs(r.collected)}</td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${ceColor(r.cePct)}`}>{r.cePct == null ? "—" : formatPct(r.cePct, 1)}</td>
                  <td className="px-3 py-1.5 text-right text-red-600">{formatLakhs(r.principal_overdue)}</td>
                  <td className="px-3 py-1.5 text-right">{(r.receipts || 0).toLocaleString()}</td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${(r.cashPct ?? 0) > 70 ? "text-red-700" : (r.cashPct ?? 0) > 40 ? "text-amber-700" : "text-emerald-700"}`}>
                    {r.cashPct == null ? "—" : formatPct(r.cashPct, 0)}
                  </td>
                  <td className="px-3 py-1.5 text-right">{r.npa_accounts || 0}</td>
                  <td className="px-3 py-1.5 text-right"><ChevronRight size={14} className="opacity-30 group-hover:opacity-100 text-indigo-700" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Collections by product */}
      <div className="bg-white rounded-xl border">
        <div className="px-5 py-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-800">Collections by Product — {formatDateDMY(period.start)} → {formatDateDMY(period.end)}</h3>
          <button onClick={() => downloadCSV(collByProduct, `collections-by-product-${period.end}.csv`)}
            className="text-xs text-teal-700 flex items-center gap-1"><Download size={12} /> CSV</button>
        </div>
        <div className="overflow-x-auto max-h-80 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-gray-50 text-gray-600 uppercase text-[10px] z-10">
              <tr>
                <th className="text-left px-3 py-2">Product</th>
                <th className="text-right px-3 py-2">Receipts</th>
                <th className="text-right px-3 py-2">Accounts</th>
                <th className="text-right px-3 py-2">Branches</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-right px-3 py-2">Cash</th>
                <th className="text-right px-3 py-2">UPI/Digital</th>
                <th className="text-right px-3 py-2">Cheque/DD</th>
                <th className="text-right px-3 py-2">Cash %</th>
                <th className="text-right px-3 py-2">Avg Receipt</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {collByProduct.length === 0 ? (
                <tr><td colSpan={11} className="text-center text-gray-400 py-6">No receipts in this window.</td></tr>
              ) : collByProduct.map((r, i) => (
                <tr key={r.product + "-" + i}
                    onClick={() => drill(r.product)}
                    className="border-t hover:bg-amber-50/50 cursor-pointer group">
                  <td className="px-3 py-1.5 font-medium group-hover:text-amber-800">{r.product}</td>
                  <td className="px-3 py-1.5 text-right">{(r.receipts || 0).toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">{(r.accounts || 0).toLocaleString()}</td>
                  <td className="px-3 py-1.5 text-right">{r.branches || 0}</td>
                  <td className="px-3 py-1.5 text-right text-teal-700 font-medium">{formatLakhs(r.total)}</td>
                  <td className="px-3 py-1.5 text-right">{formatLakhs(r.cash)}</td>
                  <td className="px-3 py-1.5 text-right">{formatLakhs(r.upi)}</td>
                  <td className="px-3 py-1.5 text-right">{formatLakhs(r.cheque)}</td>
                  <td className={`px-3 py-1.5 text-right font-semibold ${(r.cashPct ?? 0) > 70 ? "text-red-700" : (r.cashPct ?? 0) > 40 ? "text-amber-700" : "text-emerald-700"}`}>
                    {r.cashPct == null ? "—" : formatPct(r.cashPct, 0)}
                  </td>
                  <td className="px-3 py-1.5 text-right">{formatINR(r.avg_receipt || 0)}</td>
                  <td className="px-3 py-1.5 text-right"><ChevronRight size={14} className="opacity-30 group-hover:opacity-100 text-amber-700" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Branch × Product heatmap */}
      <div className="bg-white rounded-xl border max-w-full overflow-hidden">
        <div className="px-5 py-3 border-b flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-800 flex items-center gap-1.5"><Grid3x3 size={16} /> Branch × Product CE% Matrix</h3>
            <p className="text-xs text-gray-500">
              {matrixTrimmed && !matrixExpanded
                ? `Showing top ${visibleMatrix.branches.length} branches × ${visibleMatrix.products.length} products by book size (of ${matrix.branches.length} × ${matrix.products.length}).`
                : `Colour shows CE%. Click any cell to drill into that branch-product slice.`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {matrixTrimmed && (
              <button
                onClick={() => setMatrixExpanded(v => !v)}
                className="text-xs px-2 py-1 border rounded-md hover:bg-gray-50 text-gray-700">
                {matrixExpanded ? "Show top only" : `Show all ${matrix.branches.length}×${matrix.products.length}`}
              </button>
            )}
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="px-1.5 py-0.5 rounded bg-red-600 text-white">&lt;50%</span>
              <span className="px-1.5 py-0.5 rounded bg-orange-500 text-white">50-70</span>
              <span className="px-1.5 py-0.5 rounded bg-amber-400 text-gray-900">70-85</span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-400 text-white">85-95</span>
              <span className="px-1.5 py-0.5 rounded bg-emerald-600 text-white">95%+</span>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
          {visibleMatrix.branches.length === 0 ? (
            <div className="text-center text-gray-400 py-10">No matrix data.</div>
          ) : (
            <table className="text-[10px] border-separate border-spacing-0.5 p-2">
              <thead className="sticky top-0 bg-white z-10">
                <tr>
                  <th className="sticky left-0 bg-white text-left px-2 py-2 text-gray-500 uppercase tracking-wide min-w-[140px] z-20">Branch ↓ / Product →</th>
                  {visibleMatrix.products.map(p => (
                    <th key={p.product} className="px-2 py-2 text-gray-600 font-semibold min-w-[90px] text-center">
                      <div className="truncate max-w-[100px]" title={p.product}>{p.product}</div>
                      <div className={`text-[9px] ${ceColor(p.cePct)}`}>{p.cePct == null ? "—" : formatPct(p.cePct, 0)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleMatrix.branches.map(b => (
                  <tr key={b.branch}>
                    <td className="sticky left-0 bg-white text-left px-2 py-1 font-medium text-gray-800 z-10 cursor-pointer hover:text-teal-700"
                        onClick={() => drill(null, b.branch)}>
                      <div className="truncate max-w-[130px]" title={b.branch}>{b.branch}</div>
                      <div className={`text-[9px] ${ceColor(b.cePct)}`}>{b.cePct == null ? "—" : formatPct(b.cePct, 0)}</div>
                    </td>
                    {visibleMatrix.products.map(p => {
                      const cell = matrixLookup.get(`${b.branch}||${p.product}`);
                      const ce = cell ? cell.cePct : null;
                      const empty = !cell;
                      return (
                        <td key={p.product}
                            className={`text-center font-semibold cursor-pointer transition-opacity ${cellColor(ce)} ${empty ? "opacity-40" : "hover:opacity-80"}`}
                            title={cell ? `${b.branch} × ${p.product}\n${cell.accounts} accts · CE% ${ce == null ? "—" : formatPct(ce, 1)}\nDemand ${formatLakhs(cell.demand)} · Collected ${formatLakhs(cell.collected)}` : "No data"}
                            onClick={() => !empty && drill(p.product, b.branch)}>
                          <div className="px-1.5 py-1">
                            {empty ? "—" : (ce == null ? "—" : `${Math.round(ce)}%`)}
                            {cell && <div className="text-[8px] opacity-80">{cell.accounts}a</div>}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default { CustomerInfoPanel, DataUploadPage, CollectionDashboard };
