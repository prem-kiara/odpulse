import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line } from "recharts";
import { Plus, Trash2, LogOut, Settings, Users, GitBranch, LayoutDashboard, FileText, ChevronDown, ChevronRight, ArrowLeft, Search, Eye, EyeOff, Edit2, Save, X, AlertTriangle, CheckCircle, Database, Shield, UserPlus, ChevronUp, Download, Calendar, Tag, Lock, Upload, Bell, Clock, CreditCard, TrendingUp } from "lucide-react";
import { CustomerInfoPanel, DataUploadPage, CollectionDashboard } from "./OdInsights.jsx";

// ─── Constants & Helpers ────────────────────────────────────────────────────
const COLORS = ["#0f766e", "#06b6d4", "#8b5cf6", "#f59e0b", "#ef4444", "#10b981", "#ec4899", "#6366f1", "#14b8a6", "#f97316"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STORAGE_KEYS = { entries: "odpulse_entries", users: "odpulse_users", branches: "odpulse_branches", config: "odpulse_config", version: "odpulse_version", notifications: "odpulse_notifications", lastBulkUpload: "odpulse_last_bulk_upload" };
const APP_VERSION = 4; // bump this to force re-seed users & branches

const formatINR = (num) => {
  if (!num && num !== 0) return "Rs. 0";
  const n = Number(num);
  const parts = Math.abs(n).toFixed(0).split("");
  let formatted = "";
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
  if (n >= 10000000) return `Rs. ${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000) return `Rs. ${(n / 100000).toFixed(2)} L`;
  if (n >= 1000) return `Rs. ${(n / 1000).toFixed(1)} K`;
  return formatINR(n);
};

const generateId = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
const nowDate = () => new Date().toISOString().split("T")[0];
const nowTime = () => new Date().toTimeString().slice(0, 5);
const formatDateDMY = (isoDate) => {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-");
  return `${d}-${m}-${y}`;
};

// ─── API + localStorage helpers ────────────────────────────────────────────
const API_BASE = "/api";

const loadData = (key, fallback) => {
  try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : fallback; }
  catch { return fallback; }
};

const saveData = (key, data) => {
  localStorage.setItem(key, JSON.stringify(data));
  // Fire-and-forget sync to server
  const collectionMap = {
    [STORAGE_KEYS.entries]: "entries",
    [STORAGE_KEYS.users]: "users",
    [STORAGE_KEYS.branches]: "branches",
    [STORAGE_KEYS.config]: "config",
    [STORAGE_KEYS.notifications]: "notifications",
  };
  const collection = collectionMap[key];
  if (collection) {
    fetch(`${API_BASE}/${collection}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }).catch(err => console.warn("[API sync]", err.message));
  }
};

const fetchAPI = async (collection, fallback) => {
  try {
    const res = await fetch(`${API_BASE}/${collection}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[API fetch ${collection}]`, err.message);
    return null; // signal to use localStorage fallback
  }
};

const DEFAULT_BRANCHES = [
  "Head Office", "Annur", "Thondamuthur", "Kinathukadavu", "Palladam", "Ganapathy",
  "Gobichettipalayam", "Paramathivelur", "Tiruchengode", "Kattuputhur", "Kulithalai",
  "Rasipuram", "Ambai", "Alangulam", "Surandai", "Tenkasi", "Eral", "Tuticorin",
  "Palayamkottai", "Rajapalayam", "Sanakarankovil", "Srivilliputhur", "Periyakulam",
  "Chinnamanur", "Kariyapatti", "RR Nagar", "Thirupuvanam", "Valayankulam", "Checkanurani"
];
const DEFAULT_USERS = [
  { id: "admin", username: "admin", password: "admin123", role: "admin", name: "Administrator", branch: "Head Office", active: true, mustChangePassword: false },
  { id: "u_vijila", username: "vijila", password: "Dhanam@123", role: "staff", name: "Vijila", branch: "", active: true, mustChangePassword: true },
  { id: "u_padmapriya", username: "padmapriya", password: "Dhanam@123", role: "staff", name: "Padmapriya", branch: "", active: true, mustChangePassword: true },
  { id: "u_sasikala", username: "sasikala", password: "Dhanam@123", role: "staff", name: "Sasikala", branch: "", active: true, mustChangePassword: true },
  { id: "u_kaviya", username: "kaviya", password: "Dhanam@123", role: "staff", name: "Kaviya", branch: "", active: true, mustChangePassword: true },
  { id: "u_sandhiya", username: "sandhiya", password: "Dhanam@123", role: "staff", name: "Sandhiya", branch: "", active: true, mustChangePassword: true },
  { id: "u_poongodi", username: "poongodi", password: "Dhanam@123", role: "staff", name: "Poongodi", branch: "", active: true, mustChangePassword: true },
  { id: "u_kersiyal", username: "kersiyal", password: "Dhanam@123", role: "staff", name: "Kersiyal", branch: "", active: true, mustChangePassword: true },
  { id: "u_maheshwari", username: "maheshwari", password: "Dhanam@123", role: "staff", name: "Maheshwari", branch: "", active: true, mustChangePassword: true },
  { id: "u_dinesh", username: "dinesh", password: "Dhanam@123", role: "elevated_staff", name: "Dinesh", branch: "Head Office", active: true, mustChangePassword: true },
];
const DEFAULT_CONFIG = { companyName: "OD Pulse - MFI Recovery Tracker", allowStaffEdit: false, allowStaffDelete: false, staffSeeAllBranches: false };

// ─── CSV Export Helper ──────────────────────────────────────────────────────
const exportToCSV = (entries, filename) => {
  const getPaidCSV = (e) => e.totalPaidAmount !== undefined ? e.totalPaidAmount : (Number(e.customerShare) || 0);
  const rows = [[
    "Date", "Time", "Branch", "Customer Name", "Customer ID", "Loan Account No.", "Phone", "Aadhaar (Last 4)",
    "OD Type", "SMA Bucket",
    "OD Amount Due", "No. of Customers in Group", "Customer Share (Auto)", "OD Paid", "OD Waiver",
    "Total Paid", "Total Waiver",
    "Payment Mode", "UPI Reference", "PTP Date",
    "Waiver Approver", "Approval Subject", "Approval Date", "Recorded By"
  ]];
  entries.forEach(e => {
    const isIndiv = e.odType === "Individual OD";
    const customerShare = isIndiv ? e.amountDue : (e.customerShare !== undefined ? e.customerShare : (e.numberOfCustomers > 0 ? Math.round(e.groupOdAmount / e.numberOfCustomers) : 0));
    const odAmountDue = isIndiv ? (e.amountDue || 0) : (e.groupOdAmount || 0);
    const odPaid = isIndiv ? (e.paidAmount !== undefined ? e.paidAmount : getPaidCSV(e)) : (e.groupOdPaidAmount !== undefined ? e.groupOdPaidAmount : (e.customerShare || 0));
    const odWaiver = isIndiv ? (e.waiver || 0) : (e.groupOdWaiver !== undefined ? e.groupOdWaiver : (e.waiver || 0));
    const aadhaarLast4 = e.aadhaar ? `XXXX XXXX ${String(e.aadhaar).slice(-4)}` : "";
    rows.push([
      e.date, e.time, e.branch,
      e.customerName, e.customerId, e.loanAccountNo,
      e.phone || "", aadhaarLast4,
      e.odType || "Group OD", isIndiv ? (e.smaBucket || "") : "",
      odAmountDue, isIndiv ? 1 : (e.numberOfCustomers || 0), isIndiv ? odAmountDue : customerShare,
      odPaid, odWaiver,
      getPaidCSV(e), e.waiver || 0,
      e.paymentMode || "", e.upiReference || "", e.ptpDate || "",
      e.waiverApproval ? e.waiverApproval.approverName : "",
      e.waiverApproval ? e.waiverApproval.emailSubject : "",
      e.waiverApproval ? e.waiverApproval.approvalDate : "",
      e.enteredByName || e.enteredBy
    ]);
  });
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename || "od-pulse-export.csv";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// ─── Date Range Helper ──────────────────────────────────────────────────────
const getDateRangePresets = () => {
  const today = new Date();
  const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);
  const startOfQuarter = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1);
  const startOfYear = new Date(today.getFullYear(), 0, 1);
  const fmt = (d) => d.toISOString().split("T")[0];
  return [
    { label: "All Time", from: "", to: "" },
    { label: "Today", from: fmt(today), to: fmt(today) },
    { label: "This Month", from: fmt(startOfMonth), to: fmt(today) },
    { label: "Last Month", from: fmt(startOfLastMonth), to: fmt(endOfLastMonth) },
    { label: "This Quarter", from: fmt(startOfQuarter), to: fmt(today) },
    { label: "This Year", from: fmt(startOfYear), to: fmt(today) },
  ];
};

// ─── Multi-Select Dropdown ──────────────────────────────────────────────────
function MultiSelectDropdown({ label, options, selected, onChange, colorClass = "teal" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (value) => onChange(selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value]);
  const selectAll = () => onChange(options.map(o => o.value));
  const clearAll = () => onChange([]);

  const btnColor = colorClass === "indigo"
    ? "border-indigo-300 bg-indigo-50 text-indigo-700"
    : "border-teal-300 bg-teal-50 text-teal-700";
  const checkColor = colorClass === "indigo" ? "accent-indigo-600" : "accent-teal-600";

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 px-3 py-2 border rounded-lg text-sm transition-colors hover:shadow-sm ${selected.length > 0 ? btnColor : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"}`}>
        {selected.length === 0 ? `All ${label}` : `${label}: ${selected.length} selected`}
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {/* Selected pills */}
      {selected.length > 0 && (
        <div className="absolute top-full left-0 mt-0.5 flex flex-wrap gap-1 z-10 pointer-events-none max-w-xs">
          {/* pills shown inline in the filter bar — handled outside this component */}
        </div>
      )}
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-xl z-30 w-56 max-h-64 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b text-xs text-gray-500">
            <span className="font-semibold">{label}</span>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-teal-600 hover:underline">All</button>
              <span>·</span>
              <button onClick={clearAll} className="text-red-500 hover:underline">Clear</button>
            </div>
          </div>
          {/* Options */}
          <div className="overflow-y-auto flex-1">
            {options.length === 0
              ? <p className="px-3 py-3 text-xs text-gray-400">No options available</p>
              : options.map(opt => (
                <label key={opt.value} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={selected.includes(opt.value)} onChange={() => toggle(opt.value)} className={`rounded ${checkColor}`} />
                  <span className="text-sm text-gray-700 truncate">{opt.label}</span>
                </label>
              ))
            }
          </div>
        </div>
      )}
    </div>
  );
}

function DateRangeFilter({ dateFrom, dateTo, setDateFrom, setDateTo }) {
  const presets = getDateRangePresets();
  const [activePreset, setActivePreset] = useState(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Calendar size={16} className="text-teal-600" />
      {presets.map(p => (
        <button key={p.label} onClick={() => { setDateFrom(p.from); setDateTo(p.to); setActivePreset(p.label); }}
          className={`px-2 py-1 text-xs rounded-full border transition-all ${activePreset === p.label && dateFrom === p.from && dateTo === p.to ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-300 hover:border-teal-400"}`}>
          {p.label}
        </button>
      ))}
      <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setActivePreset(null); }} className="px-2 py-1 text-xs border rounded" />
      <span className="text-xs text-gray-400">to</span>
      <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setActivePreset(null); }} className="px-2 py-1 text-xs border rounded" />
    </div>
  );
}

// ─── Waiver Approval Modal ──────────────────────────────────────────────────
function WaiverApprovalModal({ waiverAmount, onConfirm, onCancel }) {
  const [approverName, setApproverName] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [approvalDate, setApprovalDate] = useState(nowDate());

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-amber-100 rounded-lg"><AlertTriangle size={24} className="text-amber-600" /></div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">Waiver Approval Required</h3>
            <p className="text-sm text-gray-500">Waiver of {formatINR(waiverAmount)} detected</p>
          </div>
        </div>
        <p className="text-sm text-gray-600 mb-4">This entry has a waiver component. Please provide the approval details below.</p>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Approver Name *</label>
            <input type="text" value={approverName} onChange={e => setApproverName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500" placeholder="e.g. Regional Manager" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Approval Email Subject *</label>
            <input type="text" value={emailSubject} onChange={e => setEmailSubject(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500" placeholder="e.g. OD Waiver Approval - Branch 1" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Approval Date *</label>
            <input type="date" value={approvalDate} onChange={e => setApprovalDate(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500" />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onCancel} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
          <button onClick={() => {
            if (!approverName.trim() || !emailSubject.trim() || !approvalDate) {
              alert("Please fill in all approval fields.");
              return;
            }
            onConfirm({ approverName: approverName.trim(), emailSubject: emailSubject.trim(), approvalDate });
          }} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium">
            Confirm & Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Customer Picker Modal ───────────────────────────────────────────────────
function CustomerPicker({ matches, onSelect, onClose, accentColor = "teal" }) {
  const ring = accentColor === "indigo" ? "hover:border-indigo-300 hover:bg-indigo-50" : "hover:border-teal-300 hover:bg-teal-50";
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl p-5 w-full max-w-md">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-800">Multiple accounts found — select one</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded"><X size={16} /></button>
        </div>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {matches.map((c, i) => (
            <button key={i} onClick={() => onSelect(c)}
              className={`w-full text-left p-3 rounded-lg border transition-colors ${ring}`}>
              <div className="font-medium text-gray-800">{c.name}</div>
              <div className="text-xs text-gray-500 mt-0.5">Loan: {c.loanAccountNo} &nbsp;·&nbsp; ID: {c.customerId}</div>
            </button>
          ))}
        </div>
        <button onClick={onClose} className="mt-3 w-full px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Cancel</button>
      </div>
    </div>
  );
}

// ─── Entry Form ─────────────────────────────────────────────────────────────
function EntryForm({ user, branches, entries, setEntries, setPage }) {
  const [branch, setBranch] = useState(user.branch || "");
  const [date] = useState(nowDate());
  const [customerName, setCustomerName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [loanAccountNo, setLoanAccountNo] = useState("");
  // Group OD fields
  const [numberOfCustomers, setNumberOfCustomers] = useState("");
  const [groupOdAmount, setGroupOdAmount] = useState("");
  const [groupOdPaidAmount, setGroupOdPaidAmount] = useState("");
  const [approvalEmailSubject, setApprovalEmailSubject] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [upiReference, setUpiReference] = useState("");
  const [ptpDate, setPtpDate] = useState("");
  const [ptpTime, setPtpTime] = useState("");
  const [showWaiverModal, setShowWaiverModal] = useState(false);
  const [pendingEntry, setPendingEntry] = useState(null);
  // Customer lookup
  const [phone, setPhone] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [aadhaarEditable, setAadhaarEditable] = useState(true);
  const [autoFilledFields, setAutoFilledFields] = useState(new Set());
  const [lookupStatus, setLookupStatus] = useState("");
  const [customerMatches, setCustomerMatches] = useState([]);
  const [odSnap, setOdSnap] = useState(null); // auto-populated OD snapshot from CustomerInfoPanel
  const [customerCenters, setCustomerCenters] = useState([]);
  const [memberArrearOverride, setMemberArrearOverride] = useState(0);
  const [memberAlreadyCollected, setMemberAlreadyCollected] = useState(0);
  const lookupTimerRef = useRef(null);

  const fetchCentersForPhone = (phoneNum) => {
    const clean = phoneNum.replace(/\D/g, "");
    if (clean.length < 10) return;
    fetch(`${API_BASE}/pool/lookup?phone=${clean}`)
      .then(r => r.json())
      .then(data => {
        if (!data.found) return;
        const uniqueCenters = [...new Set(data.results.map(r => r.centerName).filter(Boolean))];
        Promise.all(uniqueCenters.map(cn =>
          fetch(`${API_BASE}/pool/center?name=${encodeURIComponent(cn)}`).then(r => r.json())
        )).then(results => setCustomerCenters(results.filter(r => r.found)));
      }).catch(() => {});
  };

  const applyCustomer = (c) => {
    setCustomerName(c.name);
    setCustomerId(c.customerId);
    setLoanAccountNo(c.loanAccountNo);
    if (c.aadhaar) { setAadhaar(c.aadhaar); setAadhaarEditable(false); }
    if (c.phone) setPhone(c.phone);
    setAutoFilledFields(new Set(["customerName", "customerId", "loanAccountNo", "aadhaar"]));
    setCustomerMatches([]);
    setLookupStatus("found");
    if (c.phone) fetchCentersForPhone(c.phone);
  };
  const doLookup = (type, value) => {
    const clean = value.replace(/\D/g, "");
    if (clean.length < 8) { setLookupStatus(""); setCustomerMatches([]); return; }
    setLookupStatus("searching");
    fetch(`${API_BASE}/customers/lookup?${type}=${clean}`)
      .then(r => r.json())
      .then(data => {
        if (data.found) {
          if (data.customers.length === 1) { applyCustomer(data.customers[0]); }
          else { setCustomerMatches(data.customers); setLookupStatus("multiple"); }
        } else { setCustomerMatches([]); setLookupStatus("notfound"); }
      })
      .catch(() => setLookupStatus(""));
  };
  const handlePhoneChange = (val) => {
    setPhone(val);
    clearTimeout(lookupTimerRef.current);
    lookupTimerRef.current = setTimeout(() => doLookup("phone", val), 600);
    if (val.replace(/\D/g, "").length >= 10) fetchCentersForPhone(val);
  };
  const handleAadhaarInputChange = (val) => {
    setAadhaar(val);
    clearTimeout(lookupTimerRef.current);
    lookupTimerRef.current = setTimeout(() => doLookup("aadhaar", val), 600);
  };
  const handleAutoFilledChange = (fieldLabel, setter, newValue) => {
    if (autoFilledFields.has(fieldLabel)) {
      if (!window.confirm(`"${fieldLabel}" was auto-filled from the customer database. Are you sure you want to modify it?`)) return;
      setAutoFilledFields(prev => { const n = new Set(prev); n.delete(fieldLabel); return n; });
    }
    setter(newValue);
  };

  // Check if PTP date+time is in the future
  const isPtpFuture = (() => {
    if (!ptpDate) return false;
    const ptpDateTime = new Date(`${ptpDate}T${ptpTime || "23:59"}`);
    return ptpDateTime > new Date();
  })();

  // Group OD calculations
  const numCust = Number(numberOfCustomers) || 0;
  const groupOdDue = Number(groupOdAmount) || 0;
  const customerShare = memberArrearOverride > 0 ? memberArrearOverride : (numCust > 0 ? Math.round(groupOdDue / numCust) : 0);
  const groupOdPaid = isPtpFuture ? 0 : (Number(groupOdPaidAmount) || 0);
  const waiver = isPtpFuture ? 0 : Math.max(0, customerShare - memberAlreadyCollected - groupOdPaid);

  const handleSave = () => {
    if (!branch) { alert("Please select a branch."); return; }
    if (!customerName.trim()) { alert("Please enter customer name."); return; }
    if (!customerId.trim()) { alert("Please enter customer ID."); return; }
    if (!loanAccountNo.trim()) { alert("Please enter loan account number."); return; }
    if (numCust <= 0) { alert("Please enter the total number of customers in the group."); return; }
    if (groupOdDue <= 0) { alert("Please enter Group OD Amount Due."); return; }
    if (!isPtpFuture && groupOdPaid < 0) { alert("Paid Amount cannot be negative."); return; }
    if (!paymentMode) { alert("Please select a Payment Mode."); return; }
    if (paymentMode === "UPI" && !upiReference.trim()) { alert("Please enter UPI Transaction Reference."); return; }
    if (paymentMode === "Cash" && ptpDate && !isValidDate(ptpDate)) { alert("Please enter a valid PTP date."); return; }
    if (paymentMode === "Cash" && ptpDate && !ptpTime) { alert("Please enter PTP time."); return; }
    if (!isPtpFuture && waiver > 0 && !approvalEmailSubject.trim()) { alert("Waiver detected. Please enter the approval email subject line."); return; }

    // Check duplicate
    const isDup = entries.some(e =>
      e.customerId === customerId.trim() && e.loanAccountNo === loanAccountNo.trim() && e.date === date && e.branch === branch
    );
    if (isDup && !confirm("A similar entry already exists for this customer today. Save anyway?")) return;

    const entry = {
      id: generateId(), date, time: nowTime(), branch,
      customerName: customerName.trim(), customerId: customerId.trim(), loanAccountNo: loanAccountNo.trim(),
      phone: phone.trim(), aadhaar: aadhaar.replace(/\D/g, ""),
      odType: "Group OD",
      selfOdAmountDue: 0, selfOdPaidAmount: 0, selfOdWaiver: 0,
      groupOdAmount: groupOdDue,
      numberOfCustomers: numCust,
      customerShare,
      groupOdPaidAmount: isPtpFuture ? 0 : groupOdPaid,
      groupOdWaiver: isPtpFuture ? 0 : waiver,
      totalPaidAmount: isPtpFuture ? 0 : groupOdPaid,
      waiver: isPtpFuture ? 0 : waiver,
      paymentMode,
      upiReference: paymentMode === "UPI" ? upiReference.trim() : "",
      ptpDate: paymentMode === "Cash" ? ptpDate : "",
      ptpTime: paymentMode === "Cash" ? ptpTime : "",
      ptpStatus: isPtpFuture ? "pending" : "na", // "pending" = awaiting payment, "paid" = settled, "na" = not applicable
      ptpPaidDate: null,
      ptpPaymentRef: null,
      ptpReminderSent: false,
      waiverApproval: (!isPtpFuture && waiver > 0) ? { approverName: user.name, emailSubject: approvalEmailSubject.trim(), approvalDate: date } : null,
      enteredBy: user.id, enteredByName: user.name,
    };

    if (waiver > 0) {
      setPendingEntry(entry);
      setShowWaiverModal(true);
    } else {
      saveEntry(entry);
    }
  };

  const isValidDate = (dateStr) => {
    const d = new Date(dateStr);
    return d instanceof Date && !isNaN(d);
  };

  const saveEntry = (entry) => {
    const updated = [entry, ...entries];
    setEntries(updated);
    // Save to localStorage only (don't fire full-array POST to server)
    localStorage.setItem(STORAGE_KEYS.entries, JSON.stringify(updated));
    // Use append endpoint for server (avoids duplicate from full-array sync)
    fetch(`${API_BASE}/entries/append`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }).catch(err => console.warn("[API append]", err.message));

    // Create persistent PTP notification if PTP is pending
    if (entry.ptpStatus === "pending" && entry.ptpDate) {
      const existingNotifs = loadData(STORAGE_KEYS.notifications, []);
      // Collect unique recipient IDs (entry creator + admins/elevated, no duplicates)
      const allUsers = loadData(STORAGE_KEYS.users, []);
      const recipientIds = new Set();
      recipientIds.add(entry.enteredBy);
      allUsers.filter(u => u.role === "admin" || u.role === "elevated_staff").forEach(u => recipientIds.add(u.id));

      const ptpNotifs = [...recipientIds].map(userId => ({
        id: generateId(),
        type: "ptp_pending",
        message: `PTP Pending: ${entry.customerName} (${entry.customerId}) - Branch: ${entry.branch} - PTP: ${formatDateDMY(entry.ptpDate)} ${entry.ptpTime || ""} - Customer Share: ${formatINR(entry.customerShare)}`,
        entryId: entry.id,
        userId: entry.enteredBy,
        forUserId: userId,
        date: new Date().toISOString(),
        read: false,
        ptpDate: entry.ptpDate,
        ptpTime: entry.ptpTime,
        persistent: true,
      }));
      const allNotifs = [...ptpNotifs, ...existingNotifs];
      saveData(STORAGE_KEYS.notifications, allNotifs);
    }

    // Reset form
    setCustomerName(""); setCustomerId(""); setLoanAccountNo("");
    setApprovalEmailSubject("");
    setNumberOfCustomers(""); setGroupOdAmount(""); setGroupOdPaidAmount("");
    setPaymentMode(""); setUpiReference(""); setPtpDate(""); setPtpTime("");
    setPhone(""); setAadhaar(""); setAadhaarEditable(true);
    setAutoFilledFields(new Set()); setLookupStatus(""); setCustomerMatches([]);
    setCustomerCenters([]); setMemberArrearOverride(0); setMemberAlreadyCollected(0);
    setPage("records");
  };

  const handleWaiverConfirm = (approval) => {
    if (pendingEntry) {
      saveEntry({ ...pendingEntry, waiverApproval: approval });
      setPendingEntry(null);
      setShowWaiverModal(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2"><Plus size={22} className="text-teal-600" /> Group OD Entry</h2>

      {customerCenters.length > 0 && customerCenters.map((cs, ci) => {
        const CLOSED_S = ["Closed", "Written Off"];
        const DELINQ_DPD = ["SMA-0", "SMA-1", "SMA-2", "NPA"];
        const centerLoanNos = new Set(cs.members.map(m => m.loanNumber));
        const centerEntries = entries.filter(e => centerLoanNos.has(e.loanAccountNo));
        const totalCollected = centerEntries.reduce((s, e) => s + (Number(e.groupOdPaidAmount) || 0), 0);
        const nonClosedCount = cs.count - cs.closedCount;
        const perMemberShare = nonClosedCount > 0 ? Math.round(cs.totalArrear / nonClosedCount) : 0;
        const remainingArrear = Math.max(0, Math.round(cs.totalArrear) - totalCollected);

        const enriched = cs.members.map(m => {
          const isClosed = CLOSED_S.includes(m.loanStatus);
          const isDelinquent = !isClosed && DELINQ_DPD.includes(m.customerDPDClass);
          const memberCollected = centerEntries
            .filter(e => e.loanAccountNo === m.loanNumber)
            .reduce((s, e) => s + (Number(e.groupOdPaidAmount) || 0), 0);
          const memberRemaining = Math.max(0, Math.round(m.arrearAmountTillDate) - memberCollected);
          const isSettledToday = !isClosed && memberCollected > 0 && memberRemaining === 0;
          const isPartiallyPaid = !isClosed && memberCollected > 0 && memberRemaining > 0;
          return { ...m, isClosed, isDelinquent, memberCollected, memberRemaining, isSettledToday, isPartiallyPaid };
        });

        const settledTodayCount = enriched.filter(m => m.isSettledToday).length;
        const pendingMembers = enriched.filter(m => !m.isClosed && !m.isSettledToday);
        const settledMembers = enriched.filter(m => m.isSettledToday);
        const closedMembers = enriched.filter(m => m.isClosed);
        const adjustedActive = cs.activeCount + settledTodayCount;
        const remainingPerMember = pendingMembers.length > 0 ? Math.round(remainingArrear / pendingMembers.length) : 0;

        const MemberRow = ({ m, idx }) => (
          <tr key={m.loanNumber}
            onClick={() => {
              if (m.isClosed || m.isSettledToday) return;
              setCustomerName(m.memberName);
              setCustomerId(m.customerNumber);
              setLoanAccountNo(m.loanNumber);
              setPhone(m.phone || "");
              setNumberOfCustomers(String(nonClosedCount));
              setGroupOdAmount(String(Math.round(cs.totalArrear)));
              setMemberArrearOverride(Math.round(m.arrearAmountTillDate));
              setMemberAlreadyCollected(m.memberCollected || 0);
              setAutoFilledFields(new Set(["customerName", "customerId", "loanAccountNo"]));
              setLookupStatus("found");
              window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
            }}
            className={`transition-colors ${m.isClosed || m.isSettledToday ? "opacity-60 bg-gray-50" : m.isPartiallyPaid ? "bg-yellow-50 cursor-pointer hover:bg-yellow-100" : "cursor-pointer hover:bg-teal-50"}`}
            title={m.isClosed ? "Loan closed" : m.isSettledToday ? "Fully settled today" : m.isPartiallyPaid ? `Partial — ${formatINR(m.memberRemaining)} remaining` : "Click to fill form"}>
            <td className="px-3 py-2.5 text-gray-400">{idx}</td>
            <td className="px-3 py-2.5 font-semibold text-gray-800">
              {m.memberName}
              {m.isSettledToday && <span className="ml-1 text-green-600 text-xs font-bold">✓ Settled</span>}
              {m.isPartiallyPaid && <span className="ml-1 text-yellow-600 text-xs font-bold">~ Partial</span>}
            </td>
            <td className="px-3 py-2.5 text-gray-500 font-mono text-xs">{m.loanNumber}</td>
            <td className="px-3 py-2.5 text-gray-500">{m.customerNumber}</td>
            <td className="px-3 py-2.5 text-right font-bold text-red-700">{formatINR(Math.round(m.arrearAmountTillDate))}</td>
            <td className="px-3 py-2.5 text-right font-bold text-green-700">{m.memberCollected > 0 ? formatINR(m.memberCollected) : "—"}</td>
            <td className="px-3 py-2.5 text-right font-bold">
              {m.memberRemaining > 0
                ? <span className="text-orange-700">{formatINR(m.memberRemaining)}</span>
                : m.memberCollected > 0
                  ? <span className="text-green-600 font-bold">Cleared</span>
                  : <span className="text-red-700">{formatINR(Math.round(m.arrearAmountTillDate))}</span>}
            </td>
            <td className="px-3 py-2.5 text-center">
              {m.isSettledToday
                ? <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">0d</span>
                : <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${m.customerDPD > 90 ? "bg-red-100 text-red-700" : m.customerDPD > 60 ? "bg-orange-100 text-orange-700" : m.customerDPD > 30 ? "bg-yellow-100 text-yellow-700" : m.customerDPD > 0 ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>{m.customerDPD}d</span>}
            </td>
            <td className="px-3 py-2.5 text-center">
              {m.isClosed
                ? <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-gray-200 text-gray-500">Closed</span>
                : m.isSettledToday
                  ? <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-200 text-green-800">Regular</span>
                  : m.isDelinquent
                    ? <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${m.customerDPDClass === "NPA" ? "bg-red-100 text-red-700" : m.customerDPDClass === "SMA-2" ? "bg-orange-100 text-orange-700" : m.customerDPDClass === "SMA-1" ? "bg-yellow-100 text-yellow-700" : "bg-blue-100 text-blue-700"}`}>{m.customerDPDClass}</span>
                    : <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-green-100 text-green-700">Active</span>}
            </td>
          </tr>
        );

        return (
          <div key={ci} className="bg-white rounded-xl shadow-sm border p-5 mb-4">
            <h3 className="text-sm font-semibold text-teal-700 uppercase tracking-wide mb-3">
              Group / Center {customerCenters.length > 1 ? `#${ci + 1}` : ""}: {cs.centerName}
            </h3>
            <div>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
                <div className="bg-teal-50 border border-teal-200 rounded-lg p-2.5 text-center">
                  <p className="text-xs text-gray-500 mb-1">Total</p>
                  <p className="text-xl font-extrabold text-teal-700">{cs.count}</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-2.5 text-center">
                  <p className="text-xs text-gray-500 mb-1">Regular</p>
                  <p className="text-xl font-extrabold text-green-700">{adjustedActive > 0 ? adjustedActive : "—"}</p>
                  {settledTodayCount > 0 && <p className="text-xs text-green-500">(+{settledTodayCount} settled)</p>}
                </div>
                {[["SMA-0","blue"],["SMA-1","yellow"],["SMA-2","orange"],["NPA","red"]].map(([bucket, color]) => {
                  const cnt = pendingMembers.filter(m => m.customerDPDClass === bucket).length;
                  return (
                    <div key={bucket} className={`bg-${color}-50 border border-${color}-200 rounded-lg p-2.5 text-center`}>
                      <p className="text-xs text-gray-500 mb-1">{bucket}</p>
                      <p className={`text-xl font-extrabold text-${color}-700`}>{cnt > 0 ? cnt : "—"}</p>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-2.5 text-center">
                  <p className="text-xs text-gray-500 mb-1">Closed</p>
                  <p className="text-xl font-extrabold text-gray-500">{cs.closedCount > 0 ? cs.closedCount : "—"}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-2.5 text-center">
                  <p className="text-xs text-gray-500 mb-1">Individual OD Share (Till Today)</p>
                  <p className="text-lg font-extrabold text-red-700">{formatINR(perMemberShare)}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 mb-1">Total Group OD (Principal)</p>
                  <p className="text-sm font-bold text-red-700">{formatINR(Math.round(cs.totalPrincipalOverdue))}</p>
                </div>
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 mb-1">Total Arrear Till Today</p>
                  <p className="text-sm font-bold text-red-700">{formatINR(Math.round(cs.totalArrear))}</p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500 mb-1">Total Collected (Today)</p>
                  <p className="text-sm font-bold text-green-700">{formatINR(totalCollected)}</p>
                </div>
                <div className={`${remainingArrear > 0 ? "bg-orange-50 border-orange-200" : "bg-green-50 border-green-200"} border rounded-lg p-3 text-center`}>
                  <p className="text-xs text-gray-500 mb-1">Remaining Arrear</p>
                  <p className={`text-sm font-bold ${remainingArrear > 0 ? "text-orange-700" : "text-green-700"}`}>{formatINR(remainingArrear)}</p>
                  {remainingArrear > 0 && pendingMembers.length > 0 && (
                    <p className="text-xs text-orange-600 mt-0.5">≈ {formatINR(remainingPerMember)}/member</p>
                  )}
                </div>
              </div>
              {pendingMembers.length > 0 && (
                <>
                  <p className="text-xs text-teal-600 mb-2 font-medium">👆 Click a member row to auto-fill their details into the form below</p>
                  <div className="overflow-x-auto rounded-lg border mb-3">
                    <table className="w-full text-xs">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600">#</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600">Member Name</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600">Loan No.</th>
                          <th className="px-3 py-2 text-left font-semibold text-gray-600">Customer ID</th>
                          <th className="px-3 py-2 text-right font-semibold text-gray-600">Arrear (Till Today)</th>
                          <th className="px-3 py-2 text-right font-semibold text-green-600">Collected</th>
                          <th className="px-3 py-2 text-right font-semibold text-orange-600">Remaining</th>
                          <th className="px-3 py-2 text-center font-semibold text-gray-600">DPD</th>
                          <th className="px-3 py-2 text-center font-semibold text-gray-600">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {pendingMembers.map((m, i) => <MemberRow key={m.loanNumber} m={m} idx={i + 1} />)}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              {settledMembers.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-1">✓ Settled Today ({settledMembers.length})</p>
                  <div className="overflow-x-auto rounded-lg border border-green-200">
                    <table className="w-full text-xs">
                      <thead className="bg-green-50">
                        <tr>
                          <th className="px-3 py-2 text-left font-semibold text-green-700">#</th>
                          <th className="px-3 py-2 text-left font-semibold text-green-700">Member Name</th>
                          <th className="px-3 py-2 text-left font-semibold text-green-700">Loan No.</th>
                          <th className="px-3 py-2 text-left font-semibold text-green-700">Customer ID</th>
                          <th className="px-3 py-2 text-right font-semibold text-green-700">Arrear (Till Today)</th>
                          <th className="px-3 py-2 text-right font-semibold text-green-700">Collected</th>
                          <th className="px-3 py-2 text-right font-semibold text-green-700">Remaining</th>
                          <th className="px-3 py-2 text-center font-semibold text-green-700">DPD</th>
                          <th className="px-3 py-2 text-center font-semibold text-green-700">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-green-100">
                        {settledMembers.map((m, i) => <MemberRow key={m.loanNumber} m={m} idx={i + 1} />)}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {closedMembers.length > 0 && (
                <p className="text-xs text-gray-400 text-center">{closedMembers.length} closed loan{closedMembers.length > 1 ? "s" : ""} not shown</p>
              )}
            </div>
          </div>
        );
      })}

      {/* Section 1: Customer Details */}
      <div className="bg-white rounded-xl shadow-sm border p-5 mb-4">
        <h3 className="text-sm font-semibold text-teal-700 uppercase tracking-wide mb-4">Customer Details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Branch *</label>
            <select value={branch} onChange={e => setBranch(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500">
              <option value="">Select Branch</option>
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input type="date" value={date} disabled className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-600" />
          </div>
        </div>
        {/* Lookup fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number <span className="text-gray-400 font-normal">(for auto-fill)</span></label>
            <input type="tel" value={phone} onChange={e => handlePhoneChange(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="10-digit mobile number" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Aadhaar Number <span className="text-gray-400 font-normal">(for auto-fill)</span></label>
            {!aadhaarEditable && aadhaar ? (
              <div className="flex gap-2">
                <input disabled value={`XXXX XXXX ${aadhaar.slice(-4)}`} className="flex-1 px-3 py-2 border rounded-lg bg-gray-100 text-gray-600" />
                <button type="button" onClick={() => {
                  if (window.confirm("Aadhaar was auto-filled from the customer database. Do you want to edit it?")) {
                    setAadhaarEditable(true);
                    setAutoFilledFields(prev => { const n = new Set(prev); n.delete("aadhaar"); return n; });
                  }
                }} className="px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-xs text-gray-700 flex items-center gap-1">
                  <Edit2 size={12} /> Edit
                </button>
              </div>
            ) : (
              <input type="text" value={aadhaar} onChange={e => handleAadhaarInputChange(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="12-digit Aadhaar number" />
            )}
          </div>
        </div>
        {/* Lookup status */}
        {lookupStatus === "searching" && <p className="text-xs text-gray-500 mb-3">🔍 Searching customer database...</p>}
        {lookupStatus === "found" && <p className="text-xs text-green-600 mb-3">✓ Customer auto-filled from database. You can still edit the fields below.</p>}
        {lookupStatus === "notfound" && <p className="text-xs text-amber-600 mb-3">⚠ Customer not found in database. Please fill in the details manually.</p>}
        {lookupStatus === "multiple" && <p className="text-xs text-blue-600 mb-3">Multiple accounts found — select one from the list.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
              Customer Name * {autoFilledFields.has("customerName") && <span className="text-teal-600 text-xs font-normal whitespace-nowrap">● filled</span>}
            </label>
            <input type="text" value={customerName}
              onChange={e => handleAutoFilledChange("customerName", setCustomerName, e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 ${autoFilledFields.has("customerName") ? "bg-teal-50 border-teal-200" : ""}`}
              placeholder="Full name" />
          </div>
          <div>
            <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
              Customer ID * {autoFilledFields.has("customerId") && <span className="text-teal-600 text-xs font-normal whitespace-nowrap">● filled</span>}
            </label>
            <input type="text" value={customerId}
              onChange={e => handleAutoFilledChange("customerId", setCustomerId, e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 ${autoFilledFields.has("customerId") ? "bg-teal-50 border-teal-200" : ""}`}
              placeholder="e.g. CUST001" />
          </div>
          <div>
            <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
              Loan Account No. * {autoFilledFields.has("loanAccountNo") && <span className="text-teal-600 text-xs font-normal whitespace-nowrap">● filled</span>}
            </label>
            <input type="text" value={loanAccountNo}
              onChange={e => handleAutoFilledChange("loanAccountNo", setLoanAccountNo, e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 ${autoFilledFields.has("loanAccountNo") ? "bg-teal-50 border-teal-200" : ""}`}
              placeholder="e.g. LA12345" />
          </div>
        </div>
        <CustomerInfoPanel loanAccountNo={loanAccountNo} customerId={customerId} hideValueBoxes onData={setOdSnap} />
      </div>

      {/* Section 2b: OD Snapshot — auto-populated from latest uploaded pool + accrued data */}
      <div className="bg-white rounded-xl shadow-sm border p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-teal-700 uppercase tracking-wide">OD Snapshot (auto)</h3>
          <span className="text-[11px] text-gray-400">
            {odSnap ? `As of ${odSnap.poolSnapshotDate || "—"}${odSnap.accruedSnapshotDate ? ` · Accrued ${odSnap.accruedSnapshotDate}` : ""}` : "Enter Loan A/C or Customer ID to look up"}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Principal Outstanding</label>
            <input type="text" readOnly tabIndex={-1} value={odSnap ? formatINR(odSnap.principalOutstanding) : "—"}
              className="w-full px-3 py-2 border rounded-lg bg-gray-50 text-gray-800 font-medium cursor-default" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Unpaid Interest</label>
            <input type="text" readOnly tabIndex={-1} value={odSnap ? formatINR(odSnap.unpaidInterest) : "—"}
              className="w-full px-3 py-2 border rounded-lg bg-gray-50 text-gray-800 font-medium cursor-default" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Accrued Interest</label>
            <input type="text" readOnly tabIndex={-1} value={odSnap ? formatINR(odSnap.accruedInterest) : "—"}
              className="w-full px-3 py-2 border rounded-lg bg-gray-50 text-gray-800 font-medium cursor-default" />
          </div>
          <div>
            <label className="block text-sm font-medium text-teal-800 mb-1">Foreclosure Amount</label>
            <input type="text" readOnly tabIndex={-1} value={odSnap ? formatINR(odSnap.foreclosureValue) : "—"}
              className="w-full px-3 py-2 border-2 border-teal-500 rounded-lg bg-teal-50 text-teal-900 font-bold cursor-default" />
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mt-2">Foreclosure = Principal Outstanding + Unpaid Interest + Accrued Interest. Values refresh automatically from the latest uploaded OD reports.</p>
      </div>

      {/* Section 3: Transaction Details */}
      <div className="bg-white rounded-xl shadow-sm border p-5 mb-4">
        <h3 className="text-sm font-semibold text-teal-700 uppercase tracking-wide mb-4">Transaction Details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount Due *</label>
            <input type="number" min="0" value={groupOdAmount} onChange={e => setGroupOdAmount(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="e.g. 10000" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Group Size *</label>
            <input type="number" min="1" value={numberOfCustomers} onChange={e => setNumberOfCustomers(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="e.g. 4" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Mode *</label>
            <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500">
              <option value="">Select</option>
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
            </select>
          </div>
          {paymentMode === "Cash" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">PTP Date & Time</label>
              <div className="flex gap-2">
                <input type="date" value={ptpDate} onChange={e => setPtpDate(e.target.value)}
                  className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500" />
                <input type="time" value={ptpTime} onChange={e => setPtpTime(e.target.value)}
                  className="w-28 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500" />
              </div>
              <p className="text-xs text-gray-500 mt-1">Set when the customer has promised to pay</p>
            </div>
          )}
          {paymentMode === "UPI" && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">UPI Transaction Reference *</label>
              <input type="text" value={upiReference} onChange={e => setUpiReference(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="e.g. UPI_TRANS_12345" />
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer Share</label>
            <input readOnly value={formatINR(customerShare)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-100 text-gray-800 font-semibold cursor-default" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Paid Amount {isPtpFuture ? "" : "*"}</label>
            {isPtpFuture ? (
              <div>
                <input readOnly value="Payment pending (PTP)"
                  className="w-full px-3 py-2 border border-orange-300 rounded-lg bg-orange-50 text-orange-700 font-medium cursor-not-allowed" />
                <p className="text-xs text-orange-600 mt-1 flex items-center gap-1"><Clock size={10} /> PTP is in the future — payment will be recorded later</p>
              </div>
            ) : (
              <input type="number" min="0" value={groupOdPaidAmount} onChange={e => setGroupOdPaidAmount(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="e.g. 2000" />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Waiver (Auto)</label>
            <input readOnly value={formatINR(waiver)}
              className={`w-full px-3 py-2 border rounded-lg font-semibold cursor-default ${waiver > 0 ? "bg-amber-50 border-amber-300 text-amber-700" : "bg-green-50 border-green-300 text-green-700"}`} />
            {waiver > 0 && <p className="text-xs text-amber-600 mt-1 font-medium">Approval required</p>}
          </div>
        </div>

        {/* Inline Approval Email Subject — shown when waiver > 0 */}
        {waiver > 0 && (
          <div className="mt-4 p-4 bg-amber-50 rounded-lg border border-amber-200">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={16} className="text-amber-600" />
              <p className="text-sm font-semibold text-amber-800">Waiver of {formatINR(waiver)} requires approval</p>
            </div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Approval Email Subject *</label>
            <input type="text" value={approvalEmailSubject} onChange={e => setApprovalEmailSubject(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500" placeholder="e.g. OD Waiver Approval - Branch Name - Customer Name" />
          </div>
        )}
      </div>

      <button onClick={handleSave}
        className="w-full py-3 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-teal-200">
        <Save size={18} /> Save Entry
      </button>

      {showWaiverModal && (
        <WaiverApprovalModal waiverAmount={waiver} onConfirm={handleWaiverConfirm} onCancel={() => { setShowWaiverModal(false); setPendingEntry(null); }} />
      )}
      {customerMatches.length > 1 && lookupStatus === "multiple" && (
        <CustomerPicker matches={customerMatches} accentColor="teal"
          onSelect={c => applyCustomer(c)}
          onClose={() => { setCustomerMatches([]); setLookupStatus(""); }} />
      )}
    </div>
  );
}

// ─── Individual OD Entry Form ────────────────────────────────────────────────
function IndividualEntryForm({ user, branches, entries, setEntries, setPage }) {
  const [branch, setBranch] = useState(user.branch || "");
  const [date] = useState(nowDate());
  const [customerName, setCustomerName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [loanAccountNo, setLoanAccountNo] = useState("");
  const [amountDue, setAmountDue] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [approvalEmailSubject, setApprovalEmailSubject] = useState("");
  const [paymentMode, setPaymentMode] = useState("");
  const [upiReference, setUpiReference] = useState("");
  const [ptpDate, setPtpDate] = useState("");
  const [ptpTime, setPtpTime] = useState("");
  const [smaBucket, setSmaBucket] = useState("");
  const [waiverInput, setWaiverInput] = useState("");
  const [showWaiverModal, setShowWaiverModal] = useState(false);
  const [pendingEntry, setPendingEntry] = useState(null);
  // Customer lookup
  const [phone, setPhone] = useState("");
  const [aadhaar, setAadhaar] = useState("");
  const [aadhaarEditable, setAadhaarEditable] = useState(true);
  const [autoFilledFields, setAutoFilledFields] = useState(new Set());
  const [lookupStatus, setLookupStatus] = useState("");
  const [customerMatches, setCustomerMatches] = useState([]);
  const [odSnap, setOdSnap] = useState(null); // auto-populated OD snapshot from CustomerInfoPanel
  const lookupTimerRef = useRef(null);

  const applyCustomer = (c) => {
    setCustomerName(c.name);
    setCustomerId(c.customerId);
    setLoanAccountNo(c.loanAccountNo);
    if (c.aadhaar) { setAadhaar(c.aadhaar); setAadhaarEditable(false); }
    if (c.phone) setPhone(c.phone);
    setAutoFilledFields(new Set(["customerName", "customerId", "loanAccountNo", "aadhaar"]));
    setCustomerMatches([]);
    setLookupStatus("found");
  };
  const doLookup = (type, value) => {
    const clean = value.replace(/\D/g, "");
    if (clean.length < 8) { setLookupStatus(""); setCustomerMatches([]); return; }
    setLookupStatus("searching");
    fetch(`${API_BASE}/customers/lookup?${type}=${clean}`)
      .then(r => r.json())
      .then(data => {
        if (data.found) {
          if (data.customers.length === 1) { applyCustomer(data.customers[0]); }
          else { setCustomerMatches(data.customers); setLookupStatus("multiple"); }
        } else { setCustomerMatches([]); setLookupStatus("notfound"); }
      })
      .catch(() => setLookupStatus(""));
  };
  const handlePhoneChange = (val) => {
    setPhone(val);
    clearTimeout(lookupTimerRef.current);
    lookupTimerRef.current = setTimeout(() => doLookup("phone", val), 600);
  };
  const handleAadhaarInputChange = (val) => {
    setAadhaar(val);
    clearTimeout(lookupTimerRef.current);
    lookupTimerRef.current = setTimeout(() => doLookup("aadhaar", val), 600);
  };
  const handleAutoFilledChange = (fieldLabel, setter, newValue) => {
    if (autoFilledFields.has(fieldLabel)) {
      if (!window.confirm(`"${fieldLabel}" was auto-filled from the customer database. Are you sure you want to modify it?`)) return;
      setAutoFilledFields(prev => { const n = new Set(prev); n.delete(fieldLabel); return n; });
    }
    setter(newValue);
  };

  const isPtpFuture = (() => {
    if (!ptpDate) return false;
    const ptpDateTime = new Date(`${ptpDate}T${ptpTime || "23:59"}`);
    return ptpDateTime > new Date();
  })();

  const due = Number(amountDue) || 0;
  const paid = isPtpFuture ? 0 : (Number(paidAmount) || 0);
  const waiver = isPtpFuture ? 0 : (Number(waiverInput) || 0);

  const isValidDate = (dateStr) => { const d = new Date(dateStr); return d instanceof Date && !isNaN(d); };

  const handleSave = () => {
    if (!branch) { alert("Please select a branch."); return; }
    if (!customerName.trim()) { alert("Please enter customer name."); return; }
    if (!loanAccountNo.trim()) { alert("Please enter loan account number."); return; }
    if (due <= 0) { alert("Please enter OD Amount Due."); return; }
    if (!isPtpFuture && paid < 0) { alert("Paid Amount cannot be negative."); return; }
    if (!paymentMode) { alert("Please select a Payment Mode."); return; }
    if (paymentMode === "UPI" && !upiReference.trim()) { alert("Please enter UPI Transaction Reference."); return; }
    if (paymentMode === "Cash" && ptpDate && !isValidDate(ptpDate)) { alert("Please enter a valid PTP date."); return; }
    if (paymentMode === "Cash" && ptpDate && !ptpTime) { alert("Please enter PTP time."); return; }
    if (!isPtpFuture && waiver > 0 && !approvalEmailSubject.trim()) { alert("Waiver detected. Please enter the approval email subject line."); return; }

    // Auto-detect CSB: no Customer ID + hyphenated loan number (e.g. 0269-80394391-657201)
    const isCSBCustomer = !customerId.trim() && /\d+-\d+-\d+/.test(loanAccountNo.trim());

    const isDup = entries.some(e =>
      e.loanAccountNo === loanAccountNo.trim() && e.date === date && e.branch === branch && e.odType === "Individual OD"
    );
    if (isDup && !confirm("A similar entry already exists for this customer today. Save anyway?")) return;

    const entry = {
      id: generateId(), date, time: nowTime(), branch,
      customerName: customerName.trim(), customerId: customerId.trim(), loanAccountNo: loanAccountNo.trim(),
      phone: phone.trim(), aadhaar: aadhaar.replace(/\D/g, ""),
      odType: "Individual OD",
      isCSBCustomer: isCSBCustomer || undefined,
      smaBucket: smaBucket || "",
      amountDue: due,
      paidAmount: isPtpFuture ? 0 : paid,
      waiver: isPtpFuture ? 0 : waiver,
      totalPaidAmount: isPtpFuture ? 0 : paid,
      paymentMode,
      upiReference: paymentMode === "UPI" ? upiReference.trim() : "",
      ptpDate: paymentMode === "Cash" ? ptpDate : "",
      ptpTime: paymentMode === "Cash" ? ptpTime : "",
      ptpStatus: isPtpFuture ? "pending" : "na",
      ptpPaidDate: null,
      ptpPaymentRef: null,
      ptpReminderSent: false,
      waiverApproval: (!isPtpFuture && waiver > 0) ? { approverName: user.name, emailSubject: approvalEmailSubject.trim(), approvalDate: date } : null,
      enteredBy: user.id, enteredByName: user.name,
    };

    if (waiver > 0) {
      setPendingEntry(entry);
      setShowWaiverModal(true);
    } else {
      saveIndivEntry(entry);
    }
  };

  const saveIndivEntry = (entry) => {
    const updated = [entry, ...entries];
    setEntries(updated);
    localStorage.setItem(STORAGE_KEYS.entries, JSON.stringify(updated));
    fetch(`${API_BASE}/entries/append`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }).catch(err => console.warn("[API append]", err.message));

    if (entry.ptpStatus === "pending" && entry.ptpDate) {
      const existingNotifs = loadData(STORAGE_KEYS.notifications, []);
      const allUsers = loadData(STORAGE_KEYS.users, []);
      const recipientIds = new Set();
      recipientIds.add(entry.enteredBy);
      allUsers.filter(u => u.role === "admin" || u.role === "elevated_staff").forEach(u => recipientIds.add(u.id));
      const ptpNotifs = [...recipientIds].map(userId => ({
        id: generateId(),
        type: "ptp_pending",
        message: `PTP Pending: ${entry.customerName} (${entry.customerId}) - Branch: ${entry.branch} - PTP: ${formatDateDMY(entry.ptpDate)} ${entry.ptpTime || ""} - Amount Due: ${formatINR(entry.amountDue)}`,
        entryId: entry.id,
        userId: entry.enteredBy,
        forUserId: userId,
        date: new Date().toISOString(),
        read: false,
        ptpDate: entry.ptpDate,
        ptpTime: entry.ptpTime,
        persistent: true,
      }));
      saveData(STORAGE_KEYS.notifications, [...ptpNotifs, ...existingNotifs]);
    }

    setCustomerName(""); setCustomerId(""); setLoanAccountNo("");
    setAmountDue(""); setPaidAmount(""); setWaiverInput(""); setApprovalEmailSubject("");
    setPaymentMode(""); setUpiReference(""); setPtpDate(""); setPtpTime("");
    setSmaBucket(""); setPhone(""); setAadhaar(""); setAadhaarEditable(true);
    setAutoFilledFields(new Set()); setLookupStatus(""); setCustomerMatches([]);
    setPage("ind_records");
  };

  const handleWaiverConfirm = (approval) => {
    if (pendingEntry) {
      saveIndivEntry({ ...pendingEntry, waiverApproval: approval });
      setPendingEntry(null);
      setShowWaiverModal(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2"><Plus size={22} className="text-indigo-600" /> Individual OD Entry</h2>

      {/* Customer Details */}
      <div className="bg-white rounded-xl shadow-sm border p-5 mb-4">
        <h3 className="text-sm font-semibold text-indigo-700 uppercase tracking-wide mb-4">Customer Details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Branch *</label>
            <select value={branch} onChange={e => setBranch(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500">
              <option value="">Select Branch</option>
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input type="date" value={date} disabled className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-600" />
          </div>
        </div>
        {/* Lookup fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number <span className="text-gray-400 font-normal">(for auto-fill)</span></label>
            <input type="tel" value={phone} onChange={e => handlePhoneChange(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500" placeholder="10-digit mobile number" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Aadhaar Number <span className="text-gray-400 font-normal">(for auto-fill)</span></label>
            {!aadhaarEditable && aadhaar ? (
              <div className="flex gap-2">
                <input disabled value={`XXXX XXXX ${aadhaar.slice(-4)}`} className="flex-1 px-3 py-2 border rounded-lg bg-gray-100 text-gray-600" />
                <button type="button" onClick={() => {
                  if (window.confirm("Aadhaar was auto-filled from the customer database. Do you want to edit it?")) {
                    setAadhaarEditable(true);
                    setAutoFilledFields(prev => { const n = new Set(prev); n.delete("aadhaar"); return n; });
                  }
                }} className="px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-xs text-gray-700 flex items-center gap-1">
                  <Edit2 size={12} /> Edit
                </button>
              </div>
            ) : (
              <input type="text" value={aadhaar} onChange={e => handleAadhaarInputChange(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500" placeholder="12-digit Aadhaar number" />
            )}
          </div>
        </div>
        {lookupStatus === "searching" && <p className="text-xs text-gray-500 mb-3">🔍 Searching customer database...</p>}
        {lookupStatus === "found" && <p className="text-xs text-green-600 mb-3">✓ Customer auto-filled from database. You can still edit the fields below.</p>}
        {lookupStatus === "notfound" && <p className="text-xs text-amber-600 mb-3">⚠ Customer not found in database. Please fill in the details manually.</p>}
        {lookupStatus === "multiple" && <p className="text-xs text-blue-600 mb-3">Multiple accounts found — select one from the list.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
              Customer Name * {autoFilledFields.has("customerName") && <span className="text-indigo-600 text-xs font-normal whitespace-nowrap">● filled</span>}
            </label>
            <input type="text" value={customerName}
              onChange={e => handleAutoFilledChange("customerName", setCustomerName, e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 ${autoFilledFields.has("customerName") ? "bg-indigo-50 border-indigo-200" : ""}`}
              placeholder="Full name" />
          </div>
          <div>
            <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
              Customer ID {autoFilledFields.has("customerId") && <span className="text-indigo-600 text-xs font-normal whitespace-nowrap">● filled</span>}
              <span className="text-gray-400 font-normal text-xs">(optional)</span>
            </label>
            <input type="text" value={customerId}
              onChange={e => handleAutoFilledChange("customerId", setCustomerId, e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 ${autoFilledFields.has("customerId") ? "bg-indigo-50 border-indigo-200" : ""}`}
              placeholder="e.g. CUST001" />
          </div>
          <div>
            <label className="flex items-center gap-1 text-sm font-medium text-gray-700 mb-1">
              Loan Account No. * {autoFilledFields.has("loanAccountNo") && <span className="text-indigo-600 text-xs font-normal whitespace-nowrap">● filled</span>}
            </label>
            <input type="text" value={loanAccountNo}
              onChange={e => handleAutoFilledChange("loanAccountNo", setLoanAccountNo, e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 ${autoFilledFields.has("loanAccountNo") ? "bg-indigo-50 border-indigo-200" : ""}`}
              placeholder="e.g. LA12345" />
          </div>
        </div>
        {customerMatches.length > 1 && lookupStatus === "multiple" && (
          <CustomerPicker matches={customerMatches} accentColor="indigo"
            onSelect={c => applyCustomer(c)}
            onClose={() => { setCustomerMatches([]); setLookupStatus(""); }} />
        )}
        <CustomerInfoPanel loanAccountNo={loanAccountNo} customerId={customerId} hideValueBoxes onData={setOdSnap} />
      </div>

      {/* OD Snapshot — auto-populated from latest uploaded pool + accrued data */}
      <div className="bg-white rounded-xl shadow-sm border p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-indigo-700 uppercase tracking-wide">OD Snapshot (auto)</h3>
          <span className="text-[11px] text-gray-400">
            {odSnap ? `As of ${odSnap.poolSnapshotDate || "—"}${odSnap.accruedSnapshotDate ? ` · Accrued ${odSnap.accruedSnapshotDate}` : ""}` : "Enter Loan A/C or Customer ID to look up"}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Principal Outstanding</label>
            <input type="text" readOnly tabIndex={-1} value={odSnap ? formatINR(odSnap.principalOutstanding) : "—"}
              className="w-full px-3 py-2 border rounded-lg bg-gray-50 text-gray-800 font-medium cursor-default" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Unpaid Interest</label>
            <input type="text" readOnly tabIndex={-1} value={odSnap ? formatINR(odSnap.unpaidInterest) : "—"}
              className="w-full px-3 py-2 border rounded-lg bg-gray-50 text-gray-800 font-medium cursor-default" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Accrued Interest</label>
            <input type="text" readOnly tabIndex={-1} value={odSnap ? formatINR(odSnap.accruedInterest) : "—"}
              className="w-full px-3 py-2 border rounded-lg bg-gray-50 text-gray-800 font-medium cursor-default" />
          </div>
          <div>
            <label className="block text-sm font-medium text-indigo-800 mb-1">Foreclosure Amount</label>
            <input type="text" readOnly tabIndex={-1} value={odSnap ? formatINR(odSnap.foreclosureValue) : "—"}
              className="w-full px-3 py-2 border-2 border-indigo-500 rounded-lg bg-indigo-50 text-indigo-900 font-bold cursor-default" />
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mt-2">Foreclosure = Principal Outstanding + Unpaid Interest + Accrued Interest. Values refresh automatically from the latest uploaded OD reports.</p>
      </div>

      {/* Transaction Details */}
      <div className="bg-white rounded-xl shadow-sm border p-5 mb-4">
        <h3 className="text-sm font-semibold text-indigo-700 uppercase tracking-wide mb-4">Transaction Details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">OD Amount Due *</label>
            <input type="number" min="0" value={amountDue} onChange={e => setAmountDue(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500" placeholder="e.g. 10000" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Mode *</label>
            <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500">
              <option value="">Select</option>
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
            </select>
          </div>
        </div>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">SMA Bucket</label>
          <select value={smaBucket} onChange={e => setSmaBucket(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500">
            <option value="">Select SMA Bucket</option>
            <option value="SMA-0">SMA-0 (1–30 DPD)</option>
            <option value="SMA-1">SMA-1 (31–60 DPD)</option>
            <option value="SMA-2">SMA-2 (61–90 DPD)</option>
            <option value="NPA">NPA (&gt;90 DPD)</option>
          </select>
        </div>
        {paymentMode === "Cash" && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">PTP Date & Time</label>
            <div className="flex gap-2">
              <input type="date" value={ptpDate} onChange={e => setPtpDate(e.target.value)}
                className="flex-1 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500" />
              <input type="time" value={ptpTime} onChange={e => setPtpTime(e.target.value)}
                className="w-28 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500" />
            </div>
            <p className="text-xs text-gray-500 mt-1">Set when the customer has promised to pay</p>
          </div>
        )}
        {paymentMode === "UPI" && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">UPI Transaction Reference *</label>
            <input type="text" value={upiReference} onChange={e => setUpiReference(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500" placeholder="e.g. UPI_TRANS_12345" />
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Paid Amount {isPtpFuture ? "" : "*"}</label>
            {isPtpFuture ? (
              <div>
                <input readOnly value="Payment pending (PTP)"
                  className="w-full px-3 py-2 border border-orange-300 rounded-lg bg-orange-50 text-orange-700 font-medium cursor-not-allowed" />
                <p className="text-xs text-orange-600 mt-1 flex items-center gap-1"><Clock size={10} /> PTP is in the future — payment will be recorded later</p>
              </div>
            ) : (
              <input type="number" min="0" value={paidAmount} onChange={e => setPaidAmount(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500" placeholder="e.g. 10000" />
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Waiver Amount</label>
            <input type="number" min="0" value={waiverInput} onChange={e => setWaiverInput(e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 ${waiver > 0 ? "bg-amber-50 border-amber-300" : ""}`}
              placeholder="0 (leave blank if none)" />
            {waiver > 0 && <p className="text-xs text-amber-600 mt-1 font-medium">Approval required</p>}
          </div>
        </div>
        {waiver > 0 && (
          <div className="mt-4 p-4 bg-amber-50 rounded-lg border border-amber-200">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={16} className="text-amber-600" />
              <p className="text-sm font-semibold text-amber-800">Waiver of {formatINR(waiver)} requires approval</p>
            </div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Approval Email Subject *</label>
            <input type="text" value={approvalEmailSubject} onChange={e => setApprovalEmailSubject(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500" placeholder="e.g. OD Waiver Approval - Branch Name - Customer Name" />
          </div>
        )}
      </div>

      <button onClick={handleSave}
        className="w-full py-3 bg-indigo-600 text-white rounded-xl font-semibold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-200">
        <Save size={18} /> Save Entry
      </button>

      {showWaiverModal && (
        <WaiverApprovalModal waiverAmount={waiver} onConfirm={handleWaiverConfirm} onCancel={() => { setShowWaiverModal(false); setPendingEntry(null); }} />
      )}
    </div>
  );
}

// ─── PTP Payment Modal ─────────────────────────────────────────────────────
function PTPPaymentModal({ entry, onSave, onCancel }) {
  const [paidAmount, setPaidAmount] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");

  const customerShare = entry.odType === "Individual OD"
    ? (entry.amountDue || 0)
    : (entry.customerShare || (entry.numberOfCustomers > 0 ? Math.round(entry.groupOdAmount / entry.numberOfCustomers) : 0));
  const paid = Number(paidAmount) || 0;
  const waiver = Math.max(0, customerShare - paid);

  const handleSubmit = () => {
    if (paid <= 0) { alert("Please enter a valid paid amount."); return; }
    if (!paymentRef.trim()) { alert("Please enter a payment reference."); return; }
    onSave({
      groupOdPaidAmount: paid,
      totalPaidAmount: paid,
      groupOdWaiver: waiver,
      waiver,
      ptpStatus: "paid",
      ptpPaidDate: nowDate(),
      ptpPaymentRef: paymentRef.trim(),
      ptpPaymentMode: paymentMode,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-teal-100 rounded-lg"><CreditCard size={24} className="text-teal-600" /></div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">Record PTP Payment</h3>
            <p className="text-sm text-gray-500">{entry.customerName} ({entry.customerId})</p>
          </div>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 mb-4 text-sm space-y-1">
          <div className="flex justify-between"><span className="text-gray-500">Branch:</span><span className="font-medium">{entry.branch}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">{entry.odType === "Individual OD" ? "OD Amount Due:" : "Group OD Amount:"}</span><span className="font-medium">{formatINR(entry.odType === "Individual OD" ? entry.amountDue : entry.groupOdAmount)}</span></div>
          {entry.odType !== "Individual OD" && <div className="flex justify-between"><span className="text-gray-500">Customer Share:</span><span className="font-medium">{formatINR(customerShare)}</span></div>}
          <div className="flex justify-between"><span className="text-gray-500">PTP Date:</span><span className="font-medium">{formatDateDMY(entry.ptpDate)} {entry.ptpTime || ""}</span></div>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Mode *</label>
            <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500">
              <option value="Cash">Cash</option>
              <option value="UPI">UPI</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Paid Amount *</label>
            <input type="number" min="0" value={paidAmount} onChange={e => setPaidAmount(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="Enter amount paid" />
            {paid > 0 && paid < customerShare && (
              <p className="text-xs text-amber-600 mt-1">Waiver of {formatINR(waiver)} will be applied</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Payment Reference *</label>
            <input type="text" value={paymentRef} onChange={e => setPaymentRef(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="e.g. Receipt No. / UPI Ref / Cash Ref" />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onCancel} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
          <button onClick={handleSubmit} className="flex-1 px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 transition-colors font-medium">
            Record Payment
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Records Table ──────────────────────────────────────────────────────────
function RecordsTable({ user, entries, setEntries, config, branches, notifications, setNotifications, odTypeFilter }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedBranches, setSelectedBranches] = useState([]);
  const [selectedStaff, setSelectedStaff] = useState([]);
  const [paymentModeFilter, setPaymentModeFilter] = useState("");
  const [ptpStatusFilter, setPtpStatusFilter] = useState("");
  const [smaBucketFilter, setSmaBucketFilter] = useState("");
  const [csbFilter, setCsbFilter] = useState(false);
  const [sortField, setSortField] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [ptpPaymentEntry, setPtpPaymentEntry] = useState(null); // entry being paid

  const canSeeAll = user.role === "admin" || user.role === "elevated_staff";

  // Derive unique staff from entries (filtered by odTypeFilter so only relevant staff show)
  const staffOptions = useMemo(() => {
    const typeFiltered = odTypeFilter === "Group OD"
      ? entries.filter(e => !e.odType || e.odType === "Group OD")
      : odTypeFilter === "Individual OD"
        ? entries.filter(e => e.odType === "Individual OD")
        : entries;
    const map = {};
    typeFiltered.forEach(e => {
      if (e.enteredBy && !map[e.enteredBy]) map[e.enteredBy] = e.enteredByName || e.enteredBy;
    });
    return Object.entries(map).map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [entries, odTypeFilter]);

  const handlePTPPayment = (paymentData) => {
    if (!ptpPaymentEntry) return;
    const updated = entries.map(e =>
      e.id === ptpPaymentEntry.id ? { ...e, ...paymentData } : e
    );
    setEntries(updated);
    saveData(STORAGE_KEYS.entries, updated);

    // Clear persistent PTP notifications for this entry
    const updatedNotifs = notifications.filter(n => !(n.entryId === ptpPaymentEntry.id && n.type === "ptp_pending"));

    // Collect unique recipient IDs (entry creator + admins/elevated, no duplicates)
    const allUsers = loadData(STORAGE_KEYS.users, []);
    const recipientIds = new Set();
    // Always notify the original entry creator
    recipientIds.add(ptpPaymentEntry.enteredBy);
    // Notify all admins and elevated staff
    allUsers.filter(u => u.role === "admin" || u.role === "elevated_staff").forEach(u => recipientIds.add(u.id));

    const paidNotifs = [...recipientIds].map(userId => ({
      id: generateId(),
      type: "ptp_paid",
      message: `PTP Payment Received: ${ptpPaymentEntry.customerName} (${ptpPaymentEntry.customerId}) - Branch: ${ptpPaymentEntry.branch} - Amount: ${formatINR(paymentData.totalPaidAmount)} - Ref: ${paymentData.ptpPaymentRef}`,
      entryId: ptpPaymentEntry.id,
      userId: ptpPaymentEntry.enteredBy,
      forUserId: userId,
      date: new Date().toISOString(),
      read: false,
      persistent: false,
    }));

    const newNotifs = [...paidNotifs, ...updatedNotifs];
    setNotifications(newNotifs);
    saveData(STORAGE_KEYS.notifications, newNotifs);

    setPtpPaymentEntry(null);
  };

  // Helper: backward compat — old entries used customerShare as paid, new entries have totalPaidAmount
  const getPaid = (e) => e.totalPaidAmount !== undefined ? e.totalPaidAmount : (Number(e.customerShare) || 0);

  const visibleEntries = useMemo(() => {
    let data = entries;
    // Filter by OD type
    if (odTypeFilter === "Group OD") data = data.filter(e => !e.odType || e.odType === "Group OD");
    else if (odTypeFilter === "Individual OD") data = data.filter(e => e.odType === "Individual OD");
    // Staff sees only their own entries; elevated_staff and admin see all
    if (user.role === "staff") data = data.filter(e => e.enteredBy === user.id);
    // Multi-select branch filter (OR within branches)
    if (selectedBranches.length > 0) data = data.filter(e => selectedBranches.includes(e.branch));
    // Multi-select staff filter (OR within staff) — cross-combined AND with branches
    if (selectedStaff.length > 0) data = data.filter(e => selectedStaff.includes(e.enteredBy));
    if (paymentModeFilter) data = data.filter(e => (e.ptpPaymentMode || e.paymentMode || "") === paymentModeFilter);
    if (smaBucketFilter) data = data.filter(e => (e.smaBucket || "") === smaBucketFilter);
    if (csbFilter) data = data.filter(e => e.isCSBCustomer === true);
    if (ptpStatusFilter) {
      if (ptpStatusFilter === "pending") data = data.filter(e => e.ptpStatus === "pending");
      else if (ptpStatusFilter === "paid") data = data.filter(e => e.ptpStatus === "paid");
      else if (ptpStatusFilter === "na") data = data.filter(e => !e.ptpStatus || e.ptpStatus === "na");
    }
    if (dateFrom) data = data.filter(e => e.date >= dateFrom);
    if (dateTo) data = data.filter(e => e.date <= dateTo);
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      data = data.filter(e =>
        (e.customerName || "").toLowerCase().includes(s) ||
        (e.customerId || "").toLowerCase().includes(s) ||
        (e.loanAccountNo || "").toLowerCase().includes(s) ||
        (e.branch || "").toLowerCase().includes(s) ||
        (e.enteredByName || "").toLowerCase().includes(s)
      );
    }
    // Sorting
    data = [...data].sort((a, b) => {
      let cmp = 0;
      if (sortField === "date") cmp = (a.date || "").localeCompare(b.date || "");
      else if (sortField === "paid") cmp = getPaid(a) - getPaid(b);
      else if (sortField === "waiver") cmp = (Number(a.waiver) || 0) - (Number(b.waiver) || 0);
      else if (sortField === "groupod") cmp = (Number(a.groupOdAmount) || 0) - (Number(b.groupOdAmount) || 0);
      else if (sortField === "branch") cmp = (a.branch || "").localeCompare(b.branch || "");
      else if (sortField === "customer") cmp = (a.customerName || "").localeCompare(b.customerName || "");
      else if (sortField === "staff") cmp = (a.enteredByName || a.enteredBy || "").localeCompare(b.enteredByName || b.enteredBy || "");
      else if (sortField === "sma") cmp = (a.smaBucket || "").localeCompare(b.smaBucket || "");
      return sortDir === "desc" ? -cmp : cmp;
    });
    return data;
  }, [entries, user, config, selectedBranches, selectedStaff, paymentModeFilter, smaBucketFilter, csbFilter, ptpStatusFilter, dateFrom, dateTo, searchTerm, sortField, sortDir]);

  const canDelete = user.role === "admin" || config.allowStaffDelete;

  const handleDelete = (id) => {
    if (!confirm("Delete this entry?")) return;
    const updated = entries.filter(e => e.id !== id);
    setEntries(updated);
    saveData(STORAGE_KEYS.entries, updated);
  };

  const totalRecovered = visibleEntries.reduce((s, e) => s + getPaid(e), 0);
  const totalWaiver = visibleEntries.reduce((s, e) => s + (Number(e.waiver) || 0), 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          <FileText size={22} className={odTypeFilter === "Individual OD" ? "text-indigo-600" : "text-teal-600"} />
          {odTypeFilter === "Individual OD" ? "Individual OD Records" : "Group OD Records"}
        </h2>
        <button onClick={() => exportToCSV(visibleEntries, `odpulse-records-${nowDate()}.csv`)}
          className="flex items-center gap-1 px-3 py-1.5 bg-teal-50 text-teal-700 rounded-lg text-sm hover:bg-teal-100 transition-colors">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border p-4 mb-4 space-y-3">
        {/* Row 1: search + dropdowns */}
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-teal-500" placeholder="Search by name, ID, loan no..." />
            </div>
          </div>
          {canSeeAll && (
            <MultiSelectDropdown
              label="Branches"
              options={branches.map(b => ({ value: b, label: b }))}
              selected={selectedBranches}
              onChange={setSelectedBranches}
              colorClass={odTypeFilter === "Individual OD" ? "indigo" : "teal"}
            />
          )}
          {canSeeAll && staffOptions.length > 0 && (
            <MultiSelectDropdown
              label="Staff"
              options={staffOptions}
              selected={selectedStaff}
              onChange={setSelectedStaff}
              colorClass={odTypeFilter === "Individual OD" ? "indigo" : "teal"}
            />
          )}
          <select value={paymentModeFilter} onChange={e => setPaymentModeFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
            <option value="">All Payment Modes</option>
            <option value="Cash">Cash</option>
            <option value="UPI">UPI</option>
          </select>
          {odTypeFilter === "Individual OD" && (
            <select value={smaBucketFilter} onChange={e => setSmaBucketFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
              <option value="">All SMA Buckets</option>
              <option value="SMA-0">SMA-0 (1–30 DPD)</option>
              <option value="SMA-1">SMA-1 (31–60 DPD)</option>
              <option value="SMA-2">SMA-2 (61–90 DPD)</option>
              <option value="NPA">NPA (&gt;90 DPD)</option>
            </select>
          )}
          {odTypeFilter === "Individual OD" && (
            <button
              onClick={() => setCsbFilter(f => !f)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${csbFilter ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"}`}>
              {csbFilter ? "✓ CSB Only" : "CSB Bank"}
            </button>
          )}
          <select value={ptpStatusFilter} onChange={e => setPtpStatusFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
            <option value="">All Status</option>
            <option value="pending">PTP Pending</option>
            <option value="paid">PTP Paid</option>
            <option value="na">Regular (No PTP)</option>
          </select>
        </div>
        {/* Active filter pills */}
        {(selectedBranches.length > 0 || selectedStaff.length > 0) && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {selectedBranches.map(b => (
              <span key={b} className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs font-medium">
                {b}
                <button onClick={() => setSelectedBranches(selectedBranches.filter(x => x !== b))} className="hover:text-teal-900"><X size={10} /></button>
              </span>
            ))}
            {selectedStaff.map(sid => {
              const opt = staffOptions.find(o => o.value === sid);
              return (
                <span key={sid} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-medium">
                  {opt ? opt.label : sid}
                  <button onClick={() => setSelectedStaff(selectedStaff.filter(x => x !== sid))} className="hover:text-indigo-900"><X size={10} /></button>
                </span>
              );
            })}
            {(selectedBranches.length > 0 && selectedStaff.length > 0) && (
              <button onClick={() => { setSelectedBranches([]); setSelectedStaff([]); }}
                className="px-2 py-0.5 text-xs text-red-500 hover:text-red-700 hover:underline">
                Clear all filters
              </button>
            )}
          </div>
        )}
        <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} setDateFrom={setDateFrom} setDateTo={setDateTo} />
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-white rounded-lg border p-3 text-center">
          <p className="text-xs text-gray-500">Entries</p>
          <p className="text-lg font-bold text-gray-800">{visibleEntries.length}</p>
        </div>
        <div className="bg-white rounded-lg border p-3 text-center">
          <p className="text-xs text-gray-500">Total Recovered</p>
          <p className="text-lg font-bold text-teal-700">{formatLakhs(totalRecovered)}</p>
        </div>
        <div className="bg-white rounded-lg border p-3 text-center">
          <p className="text-xs text-gray-500">Total Waiver</p>
          <p className="text-lg font-bold text-amber-700">{formatLakhs(totalWaiver)}</p>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                {[
                  { key: "date", label: "Date", align: "left" },
                  { key: "branch", label: "Branch", align: "left" },
                  { key: "customer", label: "Customer", align: "left" },
                  { key: "groupod", label: "Group OD", align: "right" },
                  { key: "paid", label: "Paid", align: "right" },
                  { key: "waiver", label: "Waiver", align: "right" },
                ].map(col => (
                  <th key={col.key} className={`text-${col.align} px-4 py-3 font-semibold text-gray-600 cursor-pointer hover:text-teal-700 select-none`}
                    onClick={() => { if (sortField === col.key) setSortDir(sortDir === "desc" ? "asc" : "desc"); else { setSortField(col.key); setSortDir("desc"); } }}>
                    {col.label} {sortField === col.key ? (sortDir === "desc" ? "↓" : "↑") : ""}
                  </th>
                ))}
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Mode</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 cursor-pointer hover:text-teal-700 select-none"
                  onClick={() => { if (sortField === "staff") setSortDir(sortDir === "desc" ? "asc" : "desc"); else { setSortField("staff"); setSortDir("asc"); } }}>
                  Staff {sortField === "staff" ? (sortDir === "desc" ? "↓" : "↑") : ""}
                </th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400">No records found</td></tr>
              ) : visibleEntries.map(e => {
                const paid = getPaid(e);
                return (
                <React.Fragment key={e.id}>
                  <tr className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => setExpandedId(expandedId === e.id ? null : e.id)}>
                    <td className="px-4 py-3">
                      <div className="font-medium">{formatDateDMY(e.date)}</div>
                      <div className="text-xs text-gray-400">{e.time}</div>
                    </td>
                    <td className="px-4 py-3">{e.branch}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{e.customerName}</div>
                      <div className="text-xs text-gray-400">{e.customerId} | {e.loanAccountNo}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{formatINR(e.groupOdAmount)}</td>
                    <td className="px-4 py-3 text-right font-medium text-teal-700">
                      {e.ptpStatus === "pending" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs font-medium">
                          <Clock size={10} /> PTP
                        </span>
                      ) : (
                        formatINR(getPaid(e))
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {e.ptpStatus === "pending" ? (
                        <span className="text-orange-600 text-xs">{formatDateDMY(e.ptpDate)} {e.ptpTime || ""}</span>
                      ) : e.waiver > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                          <AlertTriangle size={10} /> {formatINR(e.waiver)}
                        </span>
                      ) : (
                        <span className="text-green-600 text-xs">No waiver</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-left">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        (e.ptpPaymentMode || e.paymentMode) === "UPI" ? "bg-blue-100 text-blue-700" :
                        (e.ptpPaymentMode || e.paymentMode) === "Cash" ? "bg-green-100 text-green-700" :
                        "bg-gray-100 text-gray-500"
                      }`}>{e.ptpPaymentMode || e.paymentMode || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-sm font-medium text-gray-700">{e.enteredByName || e.enteredBy || "—"}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {e.ptpStatus === "pending" && (
                          <button onClick={(ev) => { ev.stopPropagation(); setPtpPaymentEntry(e); }}
                            className="px-2 py-1 bg-teal-600 text-white rounded text-xs hover:bg-teal-700 flex items-center gap-1">
                            <CreditCard size={10} /> Pay
                          </button>
                        )}
                        <button onClick={(ev) => { ev.stopPropagation(); setExpandedId(expandedId === e.id ? null : e.id); }}
                          className="p-1 hover:bg-gray-200 rounded">{expandedId === e.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
                        {canDelete && (
                          <button onClick={(ev) => { ev.stopPropagation(); handleDelete(e.id); }}
                            className="p-1 hover:bg-red-100 rounded text-red-500"><Trash2 size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === e.id && (
                    <tr className="bg-gray-50">
                      <td colSpan={9} className="px-6 py-4 space-y-3">
                        {/* OD pool/accrued live view */}
                        <CustomerInfoPanel loanAccountNo={e.loanAccountNo} customerId={e.customerId} />
                        {/* OD breakdown — Group or Individual */}
                        {e.odType === "Individual OD" ? (
                          <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                            <p className="text-xs font-semibold text-indigo-700 mb-2 uppercase tracking-wide">Individual OD</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                              <div><span className="text-gray-500">Amount Due:</span> <span className="font-medium">{formatINR(e.amountDue)}</span></div>
                              <div><span className="text-gray-500">Paid:</span> <span className="font-medium text-indigo-700">{formatINR(e.paidAmount !== undefined ? e.paidAmount : e.totalPaidAmount)}</span></div>
                              <div><span className="text-gray-500">Waiver:</span> <span className={`font-medium ${(e.waiver || 0) > 0 ? "text-amber-600" : "text-green-600"}`}>{formatINR(e.waiver || 0)}</span></div>
                              {e.smaBucket && <div><span className="text-gray-500">SMA Bucket:</span> <span className={`font-medium px-2 py-0.5 rounded-full text-xs ${e.smaBucket === "NPA" ? "bg-red-100 text-red-700" : e.smaBucket === "SMA-2" ? "bg-orange-100 text-orange-700" : e.smaBucket === "SMA-1" ? "bg-amber-100 text-amber-700" : "bg-yellow-100 text-yellow-700"}`}>{e.smaBucket}</span></div>}
                            </div>
                          </div>
                        ) : (
                          <div className="p-3 bg-teal-50 rounded-lg border border-teal-100">
                            <p className="text-xs font-semibold text-teal-700 mb-2 uppercase tracking-wide">Group OD</p>
                            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
                              <div><span className="text-gray-500">Amount Due:</span> <span className="font-medium">{formatINR(e.groupOdAmount)}</span></div>
                              <div><span className="text-gray-500">No. of Customers:</span> <span className="font-medium">{e.numberOfCustomers}</span></div>
                              <div><span className="text-gray-500">Customer Share:</span> <span className="font-medium">{formatINR(e.customerShare || (e.numberOfCustomers > 0 ? Math.round(e.groupOdAmount / e.numberOfCustomers) : 0))}</span></div>
                              <div><span className="text-gray-500">Paid:</span> <span className="font-medium text-teal-700">{formatINR(e.groupOdPaidAmount !== undefined ? e.groupOdPaidAmount : e.customerShare)}</span></div>
                              <div><span className="text-gray-500">Waiver:</span> <span className={`font-medium ${(e.groupOdWaiver || e.waiver) > 0 ? "text-amber-600" : "text-green-600"}`}>{formatINR(e.groupOdWaiver !== undefined ? e.groupOdWaiver : e.waiver)}</span></div>
                            </div>
                          </div>
                        )}
                        {/* Payment Details */}
                        {(e.paymentMode || e.ptpDate) && (
                          <div className={`p-3 rounded-lg border ${e.ptpStatus === "pending" ? "bg-orange-50 border-orange-200" : "bg-blue-50 border-blue-100"}`}>
                            <p className={`text-xs font-semibold mb-2 uppercase tracking-wide ${e.ptpStatus === "pending" ? "text-orange-700" : "text-blue-700"}`}>Payment Details</p>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                              {e.paymentMode && <div><span className="text-gray-500">Payment Mode:</span> <span className="font-medium">{e.ptpPaymentMode || e.paymentMode}</span></div>}
                              {e.upiReference && <div><span className="text-gray-500">UPI Reference:</span> <span className="font-medium">{e.upiReference}</span></div>}
                              {e.ptpDate && <div><span className="text-gray-500">PTP Date:</span> <span className="font-medium">{formatDateDMY(e.ptpDate)} {e.ptpTime || ""}</span></div>}
                              {e.ptpStatus && <div><span className="text-gray-500">PTP Status:</span> <span className={`font-medium ${e.ptpStatus === "pending" ? "text-orange-600" : e.ptpStatus === "paid" ? "text-green-600" : ""}`}>{e.ptpStatus === "pending" ? "Awaiting Payment" : e.ptpStatus === "paid" ? "Paid" : "N/A"}</span></div>}
                              {e.ptpPaidDate && <div><span className="text-gray-500">Payment Date:</span> <span className="font-medium text-green-700">{formatDateDMY(e.ptpPaidDate)}</span></div>}
                              {e.ptpPaymentRef && <div><span className="text-gray-500">Payment Ref:</span> <span className="font-medium">{e.ptpPaymentRef}</span></div>}
                            </div>
                            {e.ptpStatus === "pending" && (
                              <button onClick={() => setPtpPaymentEntry(e)}
                                className="mt-3 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 flex items-center gap-2">
                                <CreditCard size={14} /> Record Payment
                              </button>
                            )}
                          </div>
                        )}
                        {/* Meta info */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                          <div><span className="text-gray-500">Entered By:</span> <span className="font-medium">{e.enteredByName || e.enteredBy}</span></div>
                          <div><span className="text-gray-500">Entry Time:</span> <span className="font-medium">{formatDateDMY(e.date)} {e.time}</span></div>
                          <div><span className="text-gray-500">Total Paid:</span> <span className="font-medium text-teal-700">{formatINR(paid)}</span></div>
                        </div>
                        {e.waiverApproval && (
                          <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                            <p className="text-xs font-semibold text-amber-800 mb-2">Waiver Approval Details</p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                              <div><span className="text-gray-500">Approver:</span> <span className="font-medium">{e.waiverApproval.approverName}</span></div>
                              <div><span className="text-gray-500">Email Subject:</span> <span className="font-medium">{e.waiverApproval.emailSubject}</span></div>
                              <div><span className="text-gray-500">Approval Date:</span> <span className="font-medium">{e.waiverApproval.approvalDate}</span></div>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {ptpPaymentEntry && (
        <PTPPaymentModal
          entry={ptpPaymentEntry}
          onSave={handlePTPPayment}
          onCancel={() => setPtpPaymentEntry(null)}
        />
      )}
    </div>
  );
}

// ─── Notifications Page ─────────────────────────────────────────────────────
function NotificationsPage({ user, users, notifications, setNotifications }) {
  const [filterUser, setFilterUser] = useState("");

  const isAdminOrElevated = user.role === "admin" || user.role === "elevated_staff";
  const visibleNotifs = isAdminOrElevated
    ? filterUser ? notifications.filter(n => n.forUserId === filterUser).sort((a, b) => new Date(b.date) - new Date(a.date)) : notifications.sort((a, b) => new Date(b.date) - new Date(a.date))
    : notifications.filter(n => n.forUserId === user.id).sort((a, b) => new Date(b.date) - new Date(a.date));

  const unreadCount = visibleNotifs.filter(n => !n.read && n.type !== "ptp_pending").length;
  const pendingPtpCount = visibleNotifs.filter(n => n.type === "ptp_pending").length;

  const handleMarkAsRead = (id) => {
    const notif = notifications.find(n => n.id === id);
    if (notif && notif.type === "ptp_pending") return; // Cannot mark PTP pending as read
    const updated = notifications.map(n => n.id === id ? { ...n, read: true } : n);
    setNotifications(updated);
    saveData(STORAGE_KEYS.notifications, updated);
  };

  const handleMarkAllAsRead = () => {
    // Skip ptp_pending — those can only be cleared by recording payment
    const updated = notifications.map(n =>
      visibleNotifs.find(v => v.id === n.id) && n.type !== "ptp_pending" ? { ...n, read: true } : n
    );
    setNotifications(updated);
    saveData(STORAGE_KEYS.notifications, updated);
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2"><Bell size={22} className="text-teal-600" /> Notifications</h2>

      {isAdminOrElevated && (
        <div className="mb-4 flex gap-2">
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
            <option value="">All Users</option>
            {users.filter(u => u.role === "staff").map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
      )}

      {unreadCount > 0 && (
        <button onClick={handleMarkAllAsRead} className="mb-4 px-4 py-2 bg-teal-100 text-teal-700 rounded-lg text-sm hover:bg-teal-200 transition-colors">
          Mark all as read
        </button>
      )}

      {visibleNotifs.length === 0 ? (
        <div className="bg-white rounded-xl border p-8 text-center">
          <p className="text-gray-500">No notifications</p>
        </div>
      ) : (() => {
        const unreadNotifs = visibleNotifs.filter(n => !n.read || n.type === "ptp_pending");
        const readNotifs = visibleNotifs.filter(n => n.read && n.type !== "ptp_pending");
        const renderNotif = (n) => (
          <div key={n.id} className={`bg-white rounded-lg border p-4 transition-colors ${
            n.type === "ptp_pending" ? "bg-orange-50 border-orange-200" :
            n.type === "ptp_paid" ? "bg-green-50 border-green-200" :
            n.read ? "bg-gray-50 border-gray-200" : "bg-blue-50 border-blue-200"
          }`}>
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {n.type === "ptp_pending" && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-200 text-orange-800 rounded-full text-xs font-medium"><Clock size={10} /> PTP Pending</span>}
                  {n.type === "ptp_paid" && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-200 text-green-800 rounded-full text-xs font-medium"><CheckCircle size={10} /> Payment Received</span>}
                  {n.type === "ptp_reminder" && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-200 text-blue-800 rounded-full text-xs font-medium"><Bell size={10} /> Reminder</span>}
                </div>
                <p className={`text-sm ${n.read && n.type !== "ptp_pending" ? "text-gray-500" : "text-gray-800 font-medium"}`}>{n.message}</p>
                <p className="text-xs text-gray-400 mt-1">{formatDateDMY(n.date.split("T")[0])} {n.date.split("T")[1]?.slice(0, 5)}</p>
              </div>
              {!n.read && n.type !== "ptp_pending" && (
                <button onClick={() => handleMarkAsRead(n.id)} className="ml-2 px-2 py-1 bg-teal-600 text-white rounded text-xs hover:bg-teal-700">
                  Mark read
                </button>
              )}
            </div>
          </div>
        );
        return (
          <div className="space-y-3">
            {unreadNotifs.length > 0 && (
              <>
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Unread / Pending</h3>
                {unreadNotifs.map(renderNotif)}
              </>
            )}
            {readNotifs.length > 0 && (
              <>
                {unreadNotifs.length > 0 && <hr className="my-4 border-gray-200" />}
                <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Read</h3>
                {readNotifs.map(renderNotif)}
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
function Dashboard({ user, entries, branches, config }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [drillBranch, setDrillBranch] = useState(null);
  const [drillStaff, setDrillStaff] = useState(null);
  const [drillPanel, setDrillPanel] = useState(null); // "entries" | "recovered" | "waiver" | "groupod"
  const [dashView, setDashView] = useState("group"); // "group" | "individual"

  const resetDrill = () => { setDrillBranch(null); setDrillStaff(null); setDrillPanel(null); };

  const allVisibleEntries = useMemo(() => {
    let data = entries;
    // Staff sees only their own entries; elevated_staff and admin see all
    if (user.role === "staff") data = data.filter(e => e.enteredBy === user.id);
    if (dateFrom) data = data.filter(e => e.date >= dateFrom);
    if (dateTo) data = data.filter(e => e.date <= dateTo);
    return data;
  }, [entries, user, config, dateFrom, dateTo]);

  const visibleEntries = useMemo(() => {
    if (dashView === "group") return allVisibleEntries.filter(e => !e.odType || e.odType === "Group OD");
    if (dashView === "csb") return allVisibleEntries.filter(e => e.odType === "Individual OD" && e.isCSBCustomer === true);
    return allVisibleEntries.filter(e => e.odType === "Individual OD");
  }, [allVisibleEntries, dashView]);

  // Helper: backward compat — old entries used customerShare as paid, new entries have totalPaidAmount
  const getEntryPaid = (e) => e.totalPaidAmount !== undefined ? e.totalPaidAmount : (Number(e.customerShare) || 0);

  // Helper: get the OD amount due (Group OD uses groupOdAmount; Individual OD uses amountDue)
  const getODAmount = (e) => e.odType === "Individual OD" ? (Number(e.amountDue) || 0) : (Number(e.groupOdAmount) || 0);

  const stats = useMemo(() => {
    const totalRecovered = visibleEntries.reduce((s, e) => s + getEntryPaid(e), 0);
    const totalGroupOD = visibleEntries.reduce((s, e) => s + getODAmount(e), 0);
    const totalWaiver = visibleEntries.reduce((s, e) => s + (Number(e.waiver) || 0), 0);
    const entriesWithWaiver = visibleEntries.filter(e => (Number(e.waiver) || 0) > 0).length;

    // Branch breakdown
    const byBranch = {};
    visibleEntries.forEach(e => {
      if (!byBranch[e.branch]) byBranch[e.branch] = { branch: e.branch, recovered: 0, waiver: 0, groupOD: 0, count: 0 };
      byBranch[e.branch].recovered += getEntryPaid(e);
      byBranch[e.branch].waiver += Number(e.waiver) || 0;
      byBranch[e.branch].groupOD += getODAmount(e);
      byBranch[e.branch].count += 1;
    });
    const branchData = Object.values(byBranch).sort((a, b) => b.recovered - a.recovered);

    // Staff breakdown
    const byStaff = {};
    visibleEntries.forEach(e => {
      const staffName = e.enteredByName || e.enteredBy || "Unknown";
      const staffId = e.enteredBy || "unknown";
      if (!byStaff[staffId]) byStaff[staffId] = { staffId, staff: staffName, recovered: 0, waiver: 0, groupOD: 0, count: 0 };
      byStaff[staffId].recovered += getEntryPaid(e);
      byStaff[staffId].waiver += Number(e.waiver) || 0;
      byStaff[staffId].groupOD += getODAmount(e);
      byStaff[staffId].count += 1;
    });
    const staffData = Object.values(byStaff).sort((a, b) => b.recovered - a.recovered);

    // Monthly trend
    const byMonth = {};
    visibleEntries.forEach(e => {
      const m = e.date ? e.date.substring(0, 7) : "Unknown";
      if (!byMonth[m]) byMonth[m] = { month: m, recovered: 0, waiver: 0, count: 0 };
      byMonth[m].recovered += getEntryPaid(e);
      byMonth[m].waiver += Number(e.waiver) || 0;
      byMonth[m].count += 1;
    });
    const monthData = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));

    // Payment mode breakdown
    const byPaymentMode = {};
    visibleEntries.forEach(e => {
      const mode = e.ptpPaymentMode || e.paymentMode || "Not Specified";
      if (!byPaymentMode[mode]) byPaymentMode[mode] = { mode, recovered: 0, waiver: 0, count: 0 };
      byPaymentMode[mode].recovered += getEntryPaid(e);
      byPaymentMode[mode].waiver += Number(e.waiver) || 0;
      byPaymentMode[mode].count += 1;
    });
    const paymentModeData = Object.values(byPaymentMode).sort((a, b) => b.recovered - a.recovered);

    return { totalRecovered, totalGroupOD, totalWaiver, entriesWithWaiver, branchData, staffData, monthData, paymentModeData, totalEntries: visibleEntries.length };
  }, [visibleEntries]);

  if (drillPanel) {
    // Determine which entries to show and what columns to highlight
    let panelTitle = "All Entries";
    let panelEntries = visibleEntries;
    let highlightField = null;
    if (drillPanel === "recovered") { panelTitle = "Recovery Details"; highlightField = "paid"; }
    else if (drillPanel === "waiver") { panelTitle = "Waiver Details"; panelEntries = visibleEntries.filter(e => (Number(e.waiver) || 0) > 0); highlightField = "waiver"; }
    else if (drillPanel === "groupod") { panelTitle = "Group OD Details"; highlightField = "groupod"; }

    // Group by branch for summary
    const byBranch = {};
    panelEntries.forEach(e => {
      if (!byBranch[e.branch]) byBranch[e.branch] = { branch: e.branch, entries: 0, recovered: 0, waiver: 0, groupOD: 0 };
      byBranch[e.branch].entries += 1;
      byBranch[e.branch].recovered += getEntryPaid(e);
      byBranch[e.branch].waiver += Number(e.waiver) || 0;
      byBranch[e.branch].groupOD += Number(e.groupOdAmount) || 0;
    });
    const branchSummary = Object.values(byBranch).sort((a, b) => b.recovered - a.recovered);

    return (
      <div>
        <button onClick={() => setDrillPanel(null)} className="flex items-center gap-1 text-teal-600 hover:text-teal-800 mb-4 text-sm font-medium">
          <ArrowLeft size={16} /> Back to Dashboard
        </button>
        <h2 className="text-xl font-bold text-gray-900 mb-4">{panelTitle}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-500">Total Entries</p><p className="text-2xl font-bold">{panelEntries.length}</p></div>
          <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-500">Total Recovered</p><p className="text-2xl font-bold text-teal-700">{formatLakhs(panelEntries.reduce((s, e) => s + getEntryPaid(e), 0))}</p></div>
          <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-500">Total Waiver</p><p className="text-2xl font-bold text-amber-700">{formatLakhs(panelEntries.reduce((s, e) => s + (Number(e.waiver) || 0), 0))}</p></div>
          <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-500">Total OD Due</p><p className="text-2xl font-bold text-gray-600">{formatLakhs(panelEntries.reduce((s, e) => s + getODAmount(e), 0))}</p></div>
        </div>

        {/* Branch-wise breakdown */}
        <div className="bg-white rounded-xl border overflow-hidden mb-6">
          <h3 className="text-sm font-semibold text-gray-700 p-4 border-b">Branch-wise Breakdown</h3>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-2">Branch</th>
                <th className="text-right px-4 py-2">Entries</th>
                <th className="text-right px-4 py-2">Recovered</th>
                <th className="text-right px-4 py-2">Waiver</th>
                <th className="text-right px-4 py-2">Group OD</th>
              </tr>
            </thead>
            <tbody>
              {branchSummary.map(b => (
                <tr key={b.branch} className="border-b hover:bg-gray-50 cursor-pointer" onClick={() => { setDrillPanel(null); setDrillBranch(b.branch); }}>
                  <td className="px-4 py-2 font-medium">{b.branch}</td>
                  <td className="px-4 py-2 text-right">{b.entries}</td>
                  <td className={`px-4 py-2 text-right font-medium ${highlightField === "paid" ? "text-teal-700" : ""}`}>{formatINR(b.recovered)}</td>
                  <td className={`px-4 py-2 text-right font-medium ${highlightField === "waiver" ? "text-amber-700" : ""}`}>{b.waiver > 0 ? formatINR(b.waiver) : "—"}</td>
                  <td className={`px-4 py-2 text-right font-medium ${highlightField === "groupod" ? "text-gray-700" : ""}`}>{formatINR(b.groupOD)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Recent entries */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <h3 className="text-sm font-semibold text-gray-700 p-4 border-b">Recent Entries ({Math.min(panelEntries.length, 25)} of {panelEntries.length})</h3>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-left px-4 py-2">Branch</th>
                <th className="text-left px-4 py-2">Customer</th>
                <th className="text-right px-4 py-2">Paid</th>
                <th className="text-right px-4 py-2">Waiver</th>
                <th className="text-left px-4 py-2">Payment Mode</th>
              </tr>
            </thead>
            <tbody>
              {panelEntries.slice(0, 25).map(e => (
                <tr key={e.id} className="border-b">
                  <td className="px-4 py-2">{formatDateDMY(e.date)}</td>
                  <td className="px-4 py-2">{e.branch}</td>
                  <td className="px-4 py-2">{e.customerName} <span className="text-xs text-gray-400">({e.customerId})</span></td>
                  <td className="px-4 py-2 text-right text-teal-700 font-medium">{formatINR(getEntryPaid(e))}</td>
                  <td className="px-4 py-2 text-right">{e.waiver > 0 ? <span className="text-amber-600">{formatINR(e.waiver)}</span> : <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-2">{e.ptpPaymentMode || e.paymentMode || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (drillStaff) {
    const staffEntries = visibleEntries.filter(e => (e.enteredBy || "unknown") === drillStaff.staffId);
    const staffRecovered = staffEntries.reduce((s, e) => s + getEntryPaid(e), 0);
    const staffWaiver = staffEntries.reduce((s, e) => s + (Number(e.waiver) || 0), 0);

    const byMonth = {};
    staffEntries.forEach(e => {
      const m = e.date ? e.date.substring(0, 7) : "Unknown";
      if (!byMonth[m]) byMonth[m] = { month: m, recovered: 0, waiver: 0, count: 0 };
      byMonth[m].recovered += getEntryPaid(e);
      byMonth[m].waiver += Number(e.waiver) || 0;
      byMonth[m].count += 1;
    });
    const mData = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));

    return (
      <div>
        <button onClick={() => setDrillStaff(null)} className="flex items-center gap-1 text-teal-600 hover:text-teal-800 mb-4 text-sm font-medium">
          <ArrowLeft size={16} /> Back to Overview
        </button>
        <h2 className="text-xl font-bold text-gray-900 mb-4">{drillStaff.staff} — Staff Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-500">Entries</p><p className="text-2xl font-bold">{staffEntries.length}</p></div>
          <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-500">Recovered</p><p className="text-2xl font-bold text-teal-700">{formatLakhs(staffRecovered)}</p></div>
          <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-500">Waiver</p><p className="text-2xl font-bold text-amber-700">{formatLakhs(staffWaiver)}</p></div>
        </div>
        {mData.length > 0 && (
          <div className="bg-white rounded-xl border p-4 mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Monthly Trend</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={mData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={v => formatLakhs(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatINR(v)} />
                <Legend />
                <Bar dataKey="recovered" name="Recovered" fill="#0f766e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="waiver" name="Waiver" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="bg-white rounded-xl border overflow-hidden">
          <h3 className="text-sm font-semibold text-gray-700 p-4 border-b">Recent Entries</h3>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-left px-4 py-2">Branch</th>
                <th className="text-left px-4 py-2">Customer</th>
                <th className="text-right px-4 py-2">Share Paid</th>
                <th className="text-right px-4 py-2">Waiver</th>
              </tr>
            </thead>
            <tbody>
              {staffEntries.slice(0, 20).map(e => (
                <tr key={e.id} className="border-b">
                  <td className="px-4 py-2">{formatDateDMY(e.date)}</td>
                  <td className="px-4 py-2">{e.branch}</td>
                  <td className="px-4 py-2">{e.customerName} <span className="text-xs text-gray-400">({e.customerId})</span></td>
                  <td className="px-4 py-2 text-right text-teal-700 font-medium">{formatINR(getEntryPaid(e))}</td>
                  <td className="px-4 py-2 text-right">{e.waiver > 0 ? <span className="text-amber-600">{formatINR(e.waiver)}</span> : <span className="text-gray-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (drillBranch) {
    const branchEntries = visibleEntries.filter(e => e.branch === drillBranch);
    const branchRecovered = branchEntries.reduce((s, e) => s + getEntryPaid(e), 0);
    const branchWaiver = branchEntries.reduce((s, e) => s + (Number(e.waiver) || 0), 0);

    const byMonth = {};
    branchEntries.forEach(e => {
      const m = e.date ? e.date.substring(0, 7) : "Unknown";
      if (!byMonth[m]) byMonth[m] = { month: m, recovered: 0, waiver: 0, count: 0 };
      byMonth[m].recovered += getEntryPaid(e);
      byMonth[m].waiver += Number(e.waiver) || 0;
      byMonth[m].count += 1;
    });
    const mData = Object.values(byMonth).sort((a, b) => a.month.localeCompare(b.month));

    return (
      <div>
        <button onClick={() => setDrillBranch(null)} className="flex items-center gap-1 text-teal-600 hover:text-teal-800 mb-4 text-sm font-medium">
          <ArrowLeft size={16} /> Back to Overview
        </button>
        <h2 className="text-xl font-bold text-gray-900 mb-4">{drillBranch} — Branch Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-500">Entries</p><p className="text-2xl font-bold">{branchEntries.length}</p></div>
          <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-500">Recovered</p><p className="text-2xl font-bold text-teal-700">{formatLakhs(branchRecovered)}</p></div>
          <div className="bg-white rounded-xl border p-4"><p className="text-xs text-gray-500">Waiver</p><p className="text-2xl font-bold text-amber-700">{formatLakhs(branchWaiver)}</p></div>
        </div>
        {mData.length > 0 && (
          <div className="bg-white rounded-xl border p-4 mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Monthly Trend</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={mData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={v => formatLakhs(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatINR(v)} />
                <Legend />
                <Bar dataKey="recovered" name="Recovered" fill="#0f766e" radius={[4, 4, 0, 0]} />
                <Bar dataKey="waiver" name="Waiver" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {/* Recent entries */}
        <div className="bg-white rounded-xl border overflow-hidden">
          <h3 className="text-sm font-semibold text-gray-700 p-4 border-b">Recent Entries</h3>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-2">Date</th>
                <th className="text-left px-4 py-2">Customer</th>
                <th className="text-right px-4 py-2">Share Paid</th>
                <th className="text-right px-4 py-2">Waiver</th>
              </tr>
            </thead>
            <tbody>
              {branchEntries.slice(0, 20).map(e => (
                <tr key={e.id} className="border-b">
                  <td className="px-4 py-2">{formatDateDMY(e.date)}</td>
                  <td className="px-4 py-2">{e.customerName} <span className="text-xs text-gray-400">({e.customerId})</span></td>
                  <td className="px-4 py-2 text-right text-teal-700 font-medium">{formatINR(getEntryPaid(e))}</td>
                  <td className="px-4 py-2 text-right">{e.waiver > 0 ? <span className="text-amber-600">{formatINR(e.waiver)}</span> : <span className="text-gray-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2"><LayoutDashboard size={22} className={dashView === "individual" ? "text-indigo-600" : "text-teal-600"} /> Dashboard</h2>
      </div>
      {/* OD Type Toggle */}
      <div className="flex gap-3 mb-4">
        <button onClick={() => { setDashView("group"); resetDrill(); }}
          className={`px-5 py-2 rounded-xl font-semibold text-sm transition-colors flex items-center gap-2 ${dashView === "group" ? "bg-teal-600 text-white shadow-md shadow-teal-200" : "bg-white text-gray-600 border hover:bg-gray-50"}`}>
          <Users size={15} /> Group OD
        </button>
        <button onClick={() => { setDashView("individual"); resetDrill(); }}
          className={`px-5 py-2 rounded-xl font-semibold text-sm transition-colors flex items-center gap-2 ${dashView === "individual" ? "bg-indigo-600 text-white shadow-md shadow-indigo-200" : "bg-white text-gray-600 border hover:bg-gray-50"}`}>
          <UserPlus size={15} /> Individual OD
        </button>
        <button onClick={() => { setDashView("csb"); resetDrill(); }}
          className={`px-5 py-2 rounded-xl font-semibold text-sm transition-colors flex items-center gap-2 ${dashView === "csb" ? "bg-blue-600 text-white shadow-md shadow-blue-200" : "bg-white text-gray-600 border hover:bg-gray-50"}`}>
          <CreditCard size={15} /> CSB Bank
        </button>
      </div>
      <div className="mb-4"><DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} setDateFrom={setDateFrom} setDateTo={setDateTo} /></div>

      {/* KPI Cards — clickable */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setDrillPanel("entries")}>
          <p className="text-xs text-gray-500 mb-1">Total Entries</p>
          <p className="text-2xl font-bold text-gray-800">{stats.totalEntries}</p>
          <p className="text-xs text-teal-600 mt-1">View details →</p>
        </div>
        <div className="bg-white rounded-xl border p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setDrillPanel("recovered")}>
          <p className="text-xs text-gray-500 mb-1">Total Recovered</p>
          <p className="text-2xl font-bold text-teal-700">{formatLakhs(stats.totalRecovered)}</p>
          <p className="text-xs text-teal-600 mt-1">View details →</p>
        </div>
        <div className="bg-white rounded-xl border p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setDrillPanel("waiver")}>
          <p className="text-xs text-gray-500 mb-1">Total Waiver</p>
          <p className="text-2xl font-bold text-amber-700">{formatLakhs(stats.totalWaiver)}</p>
          <p className="text-xs text-gray-400">{stats.entriesWithWaiver} entries · <span className="text-teal-600">View details →</span></p>
        </div>
        <div className="bg-white rounded-xl border p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setDrillPanel("groupod")}>
          <p className="text-xs text-gray-500 mb-1">{dashView === "individual" ? "Total Individual OD Due" : dashView === "csb" ? "Total CSB OD Due" : "Total Group OD Due"}</p>
          <p className="text-2xl font-bold text-gray-600">{formatLakhs(stats.totalGroupOD)}</p>
          <p className="text-xs text-teal-600 mt-1">View details →</p>
        </div>
      </div>

      {/* CSB quick-link chip when viewing Individual OD */}
      {dashView === "individual" && (() => {
        const csbCount = allVisibleEntries.filter(e => e.odType === "Individual OD" && e.isCSBCustomer === true).length;
        if (csbCount === 0) return null;
        return (
          <div className="mb-4 flex">
            <button onClick={() => { setDashView("csb"); resetDrill(); }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-100 transition-colors">
              <CreditCard size={14} /> {csbCount} CSB Bank entries — view separately →
            </button>
          </div>
        );
      })()}

      {/* CSB Bank info banner */}
      {dashView === "csb" && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6 flex items-center gap-3">
          <CreditCard size={20} className="text-blue-600 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-blue-800">CSB Bank OD Portfolio</p>
            <p className="text-xs text-blue-600 mt-0.5">
              {stats.totalEntries} entries across {new Set(visibleEntries.map(e => e.branch)).size} branches. These customers have CSB Bank loan accounts (hyphenated loan numbers) without Dhanam Customer IDs.
            </p>
          </div>
        </div>
      )}

      {/* Charts: Monthly Trend & Payment Mode */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {stats.monthData.length > 0 && (
          <div className="bg-white rounded-xl border p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Monthly Recovery Trend</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={stats.monthData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} tickFormatter={v => { const [y, m] = v.split("-"); return MONTHS[parseInt(m, 10) - 1] + " " + y; }} />
                <YAxis tickFormatter={v => formatLakhs(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatINR(v)} />
                <Legend />
                <Bar dataKey="recovered" name="Recovered" fill="#f97316" radius={[4, 4, 0, 0]} />
                <Bar dataKey="waiver" name="Waiver" fill="#fdba74" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {stats.paymentModeData.length > 0 && (
          <div className="bg-white rounded-xl border p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Recovery by Payment Mode</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={stats.paymentModeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="mode" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={v => formatLakhs(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatINR(v)} />
                <Legend />
                <Bar dataKey="recovered" name="Recovered" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                <Bar dataKey="waiver" name="Waiver" fill="#67e8f9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="flex justify-center gap-4 mt-2 text-xs text-gray-500">
              {stats.paymentModeData.map(p => (
                <span key={p.mode}>{p.mode}: {p.count} entries</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Branch cards */}
      {stats.branchData.length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Branch Summary</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {stats.branchData.map(b => (
              <div key={b.branch} className="bg-white rounded-xl border p-4 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setDrillBranch(b.branch)}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-gray-800">{b.branch}</h4>
                  <span className="text-xs bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full">{b.count} entries</span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500">Recovered</p>
                    <p className="text-lg font-bold text-teal-700">{formatLakhs(b.recovered)}</p>
                  </div>
                  {b.waiver > 0 && (
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Waiver</p>
                      <p className="text-sm font-bold text-amber-600">{formatLakhs(b.waiver)}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Staff cards */}
      {stats.staffData.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Staff Summary</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {stats.staffData.map(s => (
              <div key={s.staffId} className="bg-white rounded-xl border p-4 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setDrillStaff(s)}>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-semibold text-gray-800">{s.staff}</h4>
                  <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">{s.count} entries</span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500">Recovered</p>
                    <p className="text-lg font-bold text-indigo-700">{formatLakhs(s.recovered)}</p>
                  </div>
                  {s.waiver > 0 && (
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Waiver</p>
                      <p className="text-sm font-bold text-amber-600">{formatLakhs(s.waiver)}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CSB Approval Modal ───────────────────────────────────────────────────────
function CSBApprovalModal({ candidates, groupODRows, failedRows, onConfirm, onReject }) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="p-5 border-b">
          <h3 className="font-bold text-gray-900 text-lg">CSB Bank Customers Detected</h3>
          <p className="text-sm text-gray-600 mt-1">
            {candidates.length} entries have no Customer ID but have CSB-format loan numbers (e.g. 0269-XXXXXXXX-657201).
            Are these CSB Bank customers?
          </p>
        </div>
        <div className="overflow-y-auto flex-1 p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer List ({candidates.length})</p>
          <div className="space-y-1 max-h-48 overflow-y-auto border rounded-lg p-2 bg-gray-50">
            {candidates.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-1 border-b last:border-0">
                <span className="font-medium text-gray-800">{r.customerName}</span>
                <span className="text-xs text-gray-500">{r.branch} · {r.loanAccountNo}</span>
              </div>
            ))}
          </div>
          {groupODRows.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-amber-800 mb-1">⚠ {groupODRows.length} Group OD entries detected — will NOT be imported</p>
              <div className="text-xs text-amber-700 space-y-0.5 max-h-24 overflow-y-auto">
                {groupODRows.map((r, i) => <div key={i}>{r.customerName} ({r.branch})</div>)}
              </div>
            </div>
          )}
          {failedRows.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-xs font-semibold text-red-800 mb-1">✗ {failedRows.length} entries will be skipped (missing required fields)</p>
              <div className="text-xs text-red-700 space-y-0.5 max-h-24 overflow-y-auto">
                {failedRows.map((r, i) => <div key={i}>{r.customerName || "(no name)"} — {r.reason}</div>)}
              </div>
            </div>
          )}
        </div>
        <div className="p-4 border-t flex gap-3">
          <button onClick={onConfirm}
            className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm">
            ✓ Yes, these are CSB customers — import them
          </button>
          <button onClick={onReject}
            className="flex-1 py-2.5 bg-gray-200 text-gray-700 rounded-lg font-medium hover:bg-gray-300 transition-colors text-sm">
            ✗ No — skip them
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Admin Panel ────────────────────────────────────────────────────────────
function AdminPanel({ users, setUsers, branches, setBranches, config, setConfig, entries, setEntries, notifications, setNotifications }) {
  const [tab, setTab] = useState("users");
  const [newUser, setNewUser] = useState({ username: "", password: "Dhanam@123", name: "", role: "staff", branch: "" });
  const [newBranch, setNewBranch] = useState("");
  const [showPassId, setShowPassId] = useState(null);
  const [editingBranch, setEditingBranch] = useState(null);
  const [lastBulkUpload, setLastBulkUpload] = useState(() => loadData(STORAGE_KEYS.lastBulkUpload, null));
  const [pendingBulkImport, setPendingBulkImport] = useState(null); // holds parsed data waiting for CSB decision

  const handleUndoBulkUpload = () => {
    if (!lastBulkUpload) return;
    const { type, ids, count, timestamp } = lastBulkUpload;
    const dateStr = new Date(timestamp).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
    if (!window.confirm(`Undo the bulk upload of ${count} ${type} entries from ${dateStr}?\n\nThis will permanently remove those ${count} entries. This cannot be undone.`)) return;
    const idSet = new Set(ids);
    const updated = entries.filter(e => !idSet.has(e.id));
    const removed = entries.length - updated.length;
    setEntries(updated);
    saveData(STORAGE_KEYS.entries, updated); // saves to localStorage + fires POST to server
    localStorage.removeItem(STORAGE_KEYS.lastBulkUpload);
    setLastBulkUpload(null);
    alert(`Done. Removed ${removed} entries. Records restored to before the upload.`);
  };

  const downloadResultFile = (imported, csbRows, csbApproved, groupODRows, failedRows) => {
    const lines = [];
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rowCols = (r) => [r.date, r.branch, r.customerName, r.customerId || "", r.loanAccountNo, r.amountDue, r.paidAmount, r.paymentMode || "", r.smaBucket || ""].map(q).join(",");

    lines.push("BULK UPLOAD RESULT REPORT");
    lines.push(`Generated: ${new Date().toLocaleString("en-IN")}`);
    lines.push("");

    lines.push(`== SUCCESSFULLY IMPORTED (${imported.length}) ==`);
    lines.push(["Date","Branch","Customer Name","Customer ID","Loan Account No.","OD Amount Due","OD Paid","Payment Mode","SMA Bucket"].map(q).join(","));
    imported.forEach(r => lines.push(rowCols(r)));
    lines.push("");

    if (csbRows.length > 0) {
      const label = csbApproved ? `CSB BANK ENTRIES — IMPORTED (${csbRows.length})` : `CSB BANK ENTRIES — SKIPPED (${csbRows.length})`;
      lines.push(`== ${label} ==`);
      lines.push(["Date","Branch","Customer Name","Customer ID","Loan Account No.","OD Amount Due","OD Paid","Payment Mode","SMA Bucket"].map(q).join(","));
      csbRows.forEach(r => lines.push(rowCols(r)));
      lines.push("");
    }

    if (groupODRows.length > 0) {
      lines.push(`== GROUP OD ENTRIES DETECTED — NOT IMPORTED (${groupODRows.length}) ==`);
      lines.push(["Date","Branch","Customer Name","Customer ID","Loan Account No.","OD Amount Due","OD Paid","Payment Mode","Asset Type"].map(q).join(","));
      groupODRows.forEach(r => lines.push([r.date, r.branch, r.customerName, r.customerId || "", r.loanAccountNo, r.amountDue, r.paidAmount, r.paymentMode || "", "Group OD"].map(q).join(",")));
      lines.push("");
    }

    if (failedRows.length > 0) {
      lines.push(`== FAILED / SKIPPED ENTRIES (${failedRows.length}) ==`);
      lines.push(["Customer Name","Branch","Loan Account No.","Reason"].map(q).join(","));
      failedRows.forEach(r => lines.push([r.customerName || "", r.branch || "", r.loanAccountNo || "", r.reason].map(q).join(",")));
    }

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `bulk-upload-result-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  const finalizeBulkIndivImport = (validRows, csbRows, csbApproved, groupODRows, failedRows) => {
    const toImport = csbApproved ? [...validRows, ...csbRows] : validRows;
    const allEntries = [...toImport, ...entries];
    setEntries(allEntries);
    saveData(STORAGE_KEYS.entries, allEntries);
    const snapshot = { type: "Individual OD", ids: toImport.map(e => e.id), count: toImport.length, timestamp: new Date().toISOString() };
    saveData(STORAGE_KEYS.lastBulkUpload, snapshot);
    setLastBulkUpload(snapshot);
    setPendingBulkImport(null);
    downloadResultFile(validRows, csbRows, csbApproved, groupODRows, failedRows);
    const csbMsg = csbRows.length > 0 ? (csbApproved ? `\n• ${csbRows.length} CSB entries imported.` : `\n• ${csbRows.length} CSB entries skipped.`) : "";
    const groupMsg = groupODRows.length > 0 ? `\n• ${groupODRows.length} Group OD entries were NOT imported (see result file).` : "";
    const failMsg = failedRows.length > 0 ? `\n• ${failedRows.length} entries failed (see result file).` : "";
    alert(`Import complete.\n• ${validRows.length} Individual OD entries imported.${csbMsg}${groupMsg}${failMsg}\n\nA result file has been downloaded.`);
  };

  const [editBranchName, setEditBranchName] = useState("");

  const handleAddUser = () => {
    if (!newUser.username || !newUser.password || !newUser.name) { alert("Fill in all fields."); return; }
    if (users.some(u => u.username === newUser.username)) { alert("Username already exists."); return; }
    const u = { ...newUser, id: generateId(), active: true, mustChangePassword: true };
    const updated = [...users, u];
    setUsers(updated); saveData(STORAGE_KEYS.users, updated);
    setNewUser({ username: "", password: "Dhanam@123", name: "", role: "staff", branch: "" });
  };

  const toggleUser = (id) => {
    const updated = users.map(u => u.id === id ? { ...u, active: !u.active } : u);
    setUsers(updated); saveData(STORAGE_KEYS.users, updated);
  };

  const deleteUser = (id) => {
    if (!confirm("Delete this user?")) return;
    const updated = users.filter(u => u.id !== id);
    setUsers(updated); saveData(STORAGE_KEYS.users, updated);
  };

  const addBranch = () => {
    if (!newBranch.trim()) return;
    if (branches.includes(newBranch.trim())) { alert("Branch already exists."); return; }
    const updated = [...branches, newBranch.trim()];
    setBranches(updated); saveData(STORAGE_KEYS.branches, updated);
    setNewBranch("");
  };

  const removeBranch = (b) => {
    if (!confirm(`Remove branch "${b}"?`)) return;
    const updated = branches.filter(x => x !== b);
    setBranches(updated); saveData(STORAGE_KEYS.branches, updated);
  };

  const startEditBranch = (b) => { setEditingBranch(b); setEditBranchName(b); };

  const saveEditBranch = () => {
    if (!editBranchName.trim()) return;
    if (editBranchName.trim() !== editingBranch && branches.includes(editBranchName.trim())) { alert("Branch name already exists."); return; }
    // Update branches list
    const updatedBranches = branches.map(b => b === editingBranch ? editBranchName.trim() : b);
    setBranches(updatedBranches); saveData(STORAGE_KEYS.branches, updatedBranches);
    // Update users assigned to old branch
    const updatedUsers = users.map(u => u.branch === editingBranch ? { ...u, branch: editBranchName.trim() } : u);
    setUsers(updatedUsers); saveData(STORAGE_KEYS.users, updatedUsers);
    // Update entries with old branch
    const updatedEntries = entries.map(e => e.branch === editingBranch ? { ...e, branch: editBranchName.trim() } : e);
    setEntries(updatedEntries); saveData(STORAGE_KEYS.entries, updatedEntries);
    setEditingBranch(null); setEditBranchName("");
  };

  const handleConfigChange = (key, value) => {
    const updated = { ...config, [key]: value };
    setConfig(updated); saveData(STORAGE_KEYS.config, updated);
  };

  const resetAllData = () => {
    if (!confirm("This will delete ALL entries and notifications. Users and branches will be kept. Are you sure?")) return;
    if (!confirm("This action cannot be undone. Proceed?")) return;
    setEntries([]); saveData(STORAGE_KEYS.entries, []);
    setNotifications([]); saveData(STORAGE_KEYS.notifications, []);
    // Mark that this was a deliberate reset so migration logic doesn't re-upload stale localStorage
    localStorage.setItem("odpulse_reset_ts", Date.now().toString());
  };

  // ── Bulk Upload Parsers ──
  const parseCSV = (text) => {
    // Strip UTF-8 BOM and normalize CRLF → LF so headers/cells never carry stray bytes
    const cleaned = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    const lines = cleaned.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
    return lines.slice(1).map(line => {
      const vals = [];
      let current = ""; let inQuote = false;
      for (const ch of line) {
        if (ch === '"') { inQuote = !inQuote; }
        else if (ch === "," && !inQuote) { vals.push(current.trim()); current = ""; }
        else { current += ch; }
      }
      vals.push(current.trim());
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
      return obj;
    });
  };

  const handleBulkBranches = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCSV(ev.target.result);
      const nameKey = Object.keys(rows[0] || {}).find(k => k.toLowerCase().includes("branch") || k.toLowerCase().includes("name")) || Object.keys(rows[0] || {})[0];
      if (!nameKey) { alert("Could not find a branch name column."); return; }
      const newBranches = rows.map(r => r[nameKey]?.trim()).filter(Boolean);
      const unique = [...new Set([...branches, ...newBranches])];
      setBranches(unique); saveData(STORAGE_KEYS.branches, unique);
      alert(`Added ${unique.length - branches.length} new branches. Total: ${unique.length}`);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleBulkUsers = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCSV(ev.target.result);
      let added = 0;
      const updated = [...users];
      rows.forEach(r => {
        const username = (r.username || r.Username || "").trim();
        const name = (r.name || r.Name || r["Full Name"] || "").trim();
        const role = (r.role || r.Role || "staff").trim();
        const branch = (r.branch || r.Branch || "").trim();
        const password = (r.password || r.Password || "Dhanam@123").trim();
        if (!username || !name) return;
        if (updated.some(u => u.username === username)) return;
        updated.push({ id: generateId(), username, password, name, role, branch, active: true, mustChangePassword: true });
        added++;
      });
      setUsers(updated); saveData(STORAGE_KEYS.users, updated);
      alert(`Added ${added} new users. Total: ${updated.length}`);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleBulkEntries = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCSV(ev.target.result);
      let added = 0;
      const newEntries = [];
      rows.forEach(r => {
        const customerName = (r["Customer Name"] || r.customerName || "").trim();
        const customerId = (r["Customer ID"] || r.customerId || "").trim();
        const loanAccountNo = (r["Loan Account No"] || r["Loan Account No."] || r.loanAccountNo || "").trim();
        const branch = (r.Branch || r.branch || "").trim();
        if (!customerName || !customerId || !branch) return;

        // Parse date: accept dd-mm-yyyy, dd/mm/yyyy, dd-mm-yy, dd/mm/yy, mm/dd/yyyy, yyyy-mm-dd, dd.mm.yyyy
        let rawDate = (r.Date || r.date || "").trim();
        // Replace . or / separators with -
        rawDate = rawDate.replace(/[./]/g, "-");
        // Expand 2-digit year (Excel auto-format quirk: "3-3-26" → "3-3-2026")
        if (/^\d{1,2}-\d{1,2}-\d{2}$/.test(rawDate)) {
          const p = rawDate.split("-");
          p[2] = "20" + p[2];
          rawDate = p.join("-");
        }
        // dd-mm-yyyy → yyyy-mm-dd
        if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(rawDate)) {
          const parts = rawDate.split("-");
          const d = parts[0].padStart(2, "0");
          const m = parts[1].padStart(2, "0");
          const y = parts[2];
          // Validate: if first part > 12, it's dd-mm-yyyy; if second part > 12, it's mm-dd-yyyy
          if (Number(d) > 12) {
            rawDate = `${y}-${m}-${d}`;
          } else if (Number(m) > 12) {
            rawDate = `${y}-${d}-${m}`;
          } else {
            // Assume dd-mm-yyyy (Indian format)
            rawDate = `${y}-${m}-${d}`;
          }
        }
        // Validate the resulting date
        if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) rawDate = "";
        if (rawDate) {
          const testDate = new Date(rawDate + "T00:00:00");
          if (isNaN(testDate.getTime())) rawDate = "";
        }
        if (!rawDate) rawDate = nowDate();

        // Helper: strip commas, currency symbols (₹/$/€/£), and any stray non-numeric bytes
        // (handles mangled UTF-8 rupee like "�7800" from Excel exports).
        const num = (v) => {
          if (v === null || v === undefined || v === "") return 0;
          const cleaned = String(v).replace(/[^\d.\-]/g, "");
          const n = Number(cleaned);
          return isNaN(n) ? 0 : n;
        };

        const odType = (r["OD Type"] || r.odType || "Group OD").trim();
        const selfOdAmountDue = num(r["Self OD Amount Due"] || r.selfOdAmountDue);
        const selfOdPaidAmount = num(r["Self OD Paid"] || r.selfOdPaidAmount);
        const selfOdWaiver = num(r["Self OD Waiver"] || r.selfOdWaiver) || Math.max(0, selfOdAmountDue - selfOdPaidAmount);
        const groupOdAmount = num(r["Group OD Amount Due"] || r["Group OD Amount"] || r.groupOdAmount);
        const numberOfCustomers = num(r["No. of Customers"] || r["No. of Customers in Group"] || r.numberOfCustomers) || 1;
        const customerShare = num(r["Customer Share (Auto)"] || r["Customer Share"]) || (numberOfCustomers > 0 ? Math.round(groupOdAmount / numberOfCustomers) : 0);
        const groupOdPaidAmount = num(r["Group OD Paid"] || r.groupOdPaidAmount);
        const groupOdWaiver = num(r["Group OD Waiver"] || r.groupOdWaiver) || Math.max(0, customerShare - groupOdPaidAmount);

        // Check for explicit Total Paid / Total Waiver columns first
        const totalPaidAmount = num(r["Total Paid"] || r.totalPaidAmount) || ((odType === "Self OD" ? selfOdPaidAmount : 0) + groupOdPaidAmount);
        const totalWaiver = num(r["Total Waiver"] || r.waiver) || ((odType === "Self OD" ? selfOdWaiver : 0) + groupOdWaiver);

        const approvalSubject = (r["Approval Subject"] || r["Waiver Approval Subject"] || "").trim();
        const recordedByRaw = (r["Recorded By"] || r["Entered By"] || r.recordedBy || "").trim();
        // Match recorded-by name to an actual user ID
        const matchedUser = recordedByRaw ? users.find(u =>
          u.name.toLowerCase() === recordedByRaw.toLowerCase() ||
          u.username.toLowerCase() === recordedByRaw.toLowerCase()
        ) : null;
        const enteredById = matchedUser ? matchedUser.id : (recordedByRaw || "admin");
        const enteredByName = matchedUser ? matchedUser.name : (recordedByRaw || "Bulk Upload");
        const paymentMode = (r["Payment Mode"] || r.paymentMode || "").trim();
        const upiReference = (r["UPI Reference"] || r.upiReference || "").trim();

        // PTP date also needs parsing
        let ptpDateRaw = (r["PTP Date"] || r.ptpDate || "").trim();
        if (ptpDateRaw) {
          ptpDateRaw = ptpDateRaw.replace(/[./]/g, "-");
          // Expand 2-digit year (e.g. "3-3-26" → "3-3-2026")
          if (/^\d{1,2}-\d{1,2}-\d{2}$/.test(ptpDateRaw)) {
            const p = ptpDateRaw.split("-");
            p[2] = "20" + p[2];
            ptpDateRaw = p.join("-");
          }
          if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(ptpDateRaw)) {
            const parts = ptpDateRaw.split("-");
            ptpDateRaw = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
          }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(ptpDateRaw)) ptpDateRaw = "";
        }

        newEntries.push({
          id: generateId(), date: rawDate, time: (r.Time || r.time || "00:00").trim(), branch,
          customerName, customerId, loanAccountNo, odType,
          selfOdAmountDue: odType === "Self OD" ? selfOdAmountDue : 0,
          selfOdPaidAmount: odType === "Self OD" ? selfOdPaidAmount : 0,
          selfOdWaiver: odType === "Self OD" ? selfOdWaiver : 0,
          groupOdAmount, numberOfCustomers, customerShare, groupOdPaidAmount, groupOdWaiver,
          totalPaidAmount, waiver: totalWaiver,
          paymentMode, upiReference, ptpDate: ptpDateRaw, ptpReminderSent: false,
          waiverApproval: totalWaiver > 0 && approvalSubject ? { approverName: (r["Waiver Approver"] || "Bulk Upload").trim(), emailSubject: approvalSubject, approvalDate: rawDate } : null,
          enteredBy: enteredById, enteredByName: enteredByName,
        });
        added++;
      });
      const allEntries = [...newEntries, ...entries];
      setEntries(allEntries); saveData(STORAGE_KEYS.entries, allEntries);
      const bulkSnapshot = { type: "Group OD", ids: newEntries.map(e => e.id), count: added, timestamp: new Date().toISOString() };
      saveData(STORAGE_KEYS.lastBulkUpload, bulkSnapshot);
      setLastBulkUpload(bulkSnapshot);
      alert(`Imported ${added} Group OD entries. Total: ${allEntries.length}\n\nYou can undo this upload from the Admin panel if needed.`);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleBulkIndividualEntries = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCSV(ev.target.result);

      const validRows = [];
      const csbRows = [];
      const groupODRows = [];
      const failedRows = [];

      const parseRow = (r) => {
        const customerName = (r["Customer Name"] || r.customerName || "").trim();
        const customerId = (r["Customer ID"] || r.customerId || "").trim();
        const loanAccountNo = (r["Loan Account No"] || r["Loan Account No."] || r.loanAccountNo || "").trim();
        const branch = (r.Branch || r.branch || "").trim();

        // Check for Group OD in Asset Type / SMA Bucket column
        const assetTypeRaw = (r["SMA Bucket"] || r["Asset Type"] || r["SMA"] || r.smaBucket || "").trim();
        if (assetTypeRaw.toLowerCase() === "group od") {
          const num = (v) => { const c = String(v || "").replace(/[^\d.\-]/g, ""); const n = Number(c); return isNaN(n) ? 0 : n; };
          groupODRows.push({ customerName, branch, loanAccountNo, customerId, amountDue: num(r["OD Amount Due"] || r["Amount Due"] || r.amountDue), paidAmount: num(r["OD Paid"] || r["Paid Amount"] || r.paidAmount), paymentMode: (r["Payment Mode"] || "").trim() });
          return;
        }

        if (!customerName || !branch) {
          failedRows.push({ customerName, branch, loanAccountNo, reason: "Missing customer name or branch" });
          return;
        }

        // Parse date
        let rawDate = (r.Date || r.date || "").trim();
        rawDate = rawDate.replace(/[./]/g, "-");
        if (/^\d{1,2}-\d{1,2}-\d{2}$/.test(rawDate)) { const p = rawDate.split("-"); p[2] = "20" + p[2]; rawDate = p.join("-"); }
        if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(rawDate)) {
          const parts = rawDate.split("-");
          const d = parts[0].padStart(2, "0"), m = parts[1].padStart(2, "0"), y = parts[2];
          rawDate = `${y}-${m}-${d}`;
        }
        if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) rawDate = "";
        if (!rawDate) rawDate = nowDate();

        const num = (v) => { const c = String(v || "").replace(/[^\d.\-]/g, ""); const n = Number(c); return isNaN(n) ? 0 : n; };
        const amountDue = num(r["OD Amount Due"] || r["Amount Due"] || r.amountDue);
        const paidAmount = num(r["OD Paid"] || r["Paid Amount"] || r.paidAmount);
        // Waiver is manually specified. If no Waiver column in CSV, defaults to 0.
        const waiver = num(r["Waiver"] || r["Waiver Amount"] || r.waiver || 0);
        const approvalSubject = (r["Approval Subject"] || "").trim();
        const recordedByRaw = (r["Recorded By"] || r["Entered By"] || "").trim();
        const matchedUser = recordedByRaw ? users.find(u => u.name.toLowerCase() === recordedByRaw.toLowerCase() || u.username.toLowerCase() === recordedByRaw.toLowerCase()) : null;
        const enteredById = matchedUser ? matchedUser.id : (recordedByRaw || "admin");
        const enteredByName = matchedUser ? matchedUser.name : (recordedByRaw || "Bulk Upload");
        const paymentMode = (r["Payment Mode"] || r.paymentMode || "").trim();
        const upiReference = (r["UPI Reference"] || r.upiReference || "").trim();
        const smaBucket = ["SMA-0", "SMA-1", "SMA-2", "NPA"].includes(assetTypeRaw) ? assetTypeRaw : "";

        let ptpDateRaw = (r["PTP Date"] || r.ptpDate || "").trim();
        if (ptpDateRaw) {
          ptpDateRaw = ptpDateRaw.replace(/[./]/g, "-");
          if (/^\d{1,2}-\d{1,2}-\d{2}$/.test(ptpDateRaw)) { const p = ptpDateRaw.split("-"); p[2] = "20" + p[2]; ptpDateRaw = p.join("-"); }
          if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(ptpDateRaw)) { const parts = ptpDateRaw.split("-"); ptpDateRaw = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`; }
          if (!/^\d{4}-\d{2}-\d{2}$/.test(ptpDateRaw)) ptpDateRaw = "";
        }

        const entry = {
          id: generateId(), date: rawDate, time: (r.Time || r.time || "00:00").trim(), branch,
          customerName, loanAccountNo,
          odType: "Individual OD",
          smaBucket,
          amountDue, paidAmount, waiver, totalPaidAmount: paidAmount,
          paymentMode, upiReference, ptpDate: ptpDateRaw, ptpReminderSent: false,
          waiverApproval: waiver > 0 && approvalSubject ? { approverName: (r["Waiver Approver"] || "Bulk Upload").trim(), emailSubject: approvalSubject, approvalDate: rawDate } : null,
          enteredBy: enteredById, enteredByName,
        };

        // CSB Bank detection: no Customer ID + loan number contains hyphens (e.g. 0269-80394391-657201)
        const isCSB = !customerId && /\d+-\d+-\d+/.test(loanAccountNo);
        // Mahashemam detection: no Customer ID + no Loan Account No (Aadhaar-only customers)
        const aadhaar = (r["Aadhaar"] || r["Aadhaar No"] || r["Aadhaar Number"] || r.aadhaar || "").trim().replace(/\D/g, "");
        const isMahashemam = !customerId && !loanAccountNo;
        if (isCSB) {
          csbRows.push({ ...entry, customerId: "", isCSBCustomer: true });
        } else if (isMahashemam) {
          // Aadhaar-only customers belong to Mahashemam branch
          validRows.push({ ...entry, customerId: "", loanAccountNo: "", branch: "Mahashemam", aadhaar, isMahashemamCustomer: true });
        } else if (!customerId) {
          // No Customer ID and no CSB pattern — skip
          failedRows.push({ customerName, branch, loanAccountNo, reason: "Missing Customer ID (not a CSB format loan number)" });
        } else {
          validRows.push({ ...entry, customerId, aadhaar });
        }
      };

      rows.forEach(parseRow);

      // If CSB candidates found, show modal for approval
      if (csbRows.length > 0) {
        setPendingBulkImport({ validRows, csbRows, groupODRows, failedRows });
      } else {
        // No CSB rows — finalize directly
        finalizeBulkIndivImport(validRows, [], false, groupODRows, failedRows);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div>
      <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2"><Settings size={22} className="text-teal-600" /> Admin Panel</h2>
      <div className="flex flex-wrap gap-2 mb-6">
        {[{ key: "users", icon: Users, label: "Users" }, { key: "branches", icon: GitBranch, label: "Branches" }, { key: "bulk", icon: Upload, label: "Bulk Upload" }, { key: "settings", icon: Settings, label: "Settings" }].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? "bg-teal-600 text-white" : "bg-white text-gray-600 border hover:bg-gray-50"}`}>
            <t.icon size={16} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "users" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2"><UserPlus size={18} /> Add New User</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <input type="text" placeholder="Username" value={newUser.username} onChange={e => setNewUser({ ...newUser, username: e.target.value })} className="px-3 py-2 border rounded-lg text-sm" />
              <input type="text" placeholder="Password" value={newUser.password} onChange={e => setNewUser({ ...newUser, password: e.target.value })} className="px-3 py-2 border rounded-lg text-sm" />
              <input type="text" placeholder="Full Name" value={newUser.name} onChange={e => setNewUser({ ...newUser, name: e.target.value })} className="px-3 py-2 border rounded-lg text-sm" />
              <select value={newUser.role} onChange={e => setNewUser({ ...newUser, role: e.target.value })} className="px-3 py-2 border rounded-lg text-sm">
                <option value="staff">Staff</option><option value="elevated_staff">MIS Staff (All Access)</option><option value="admin">Admin</option>
              </select>
              <select value={newUser.branch} onChange={e => setNewUser({ ...newUser, branch: e.target.value })} className="px-3 py-2 border rounded-lg text-sm">
                <option value="">Select Branch</option>
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <button onClick={handleAddUser} className="mt-3 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 transition-colors">Add User</button>
          </div>
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3">Name</th>
                  <th className="text-left px-4 py-3">Username</th>
                  <th className="text-left px-4 py-3">Password</th>
                  <th className="text-left px-4 py-3">Role</th>
                  <th className="text-left px-4 py-3">Branch</th>
                  <th className="text-center px-4 py-3">Status</th>
                  <th className="text-center px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} className="border-b">
                    <td className="px-4 py-3 font-medium">{u.name}</td>
                    <td className="px-4 py-3">{u.username}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <span>{showPassId === u.id ? u.password : "••••••"}</span>
                        <button onClick={() => setShowPassId(showPassId === u.id ? null : u.id)} className="p-1 hover:bg-gray-100 rounded">
                          {showPassId === u.id ? <EyeOff size={12} /> : <Eye size={12} />}
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.role === "admin" ? "bg-purple-100 text-purple-700" : u.role === "elevated_staff" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>{u.role === "elevated_staff" ? "MIS Staff" : u.role}</span></td>
                    <td className="px-4 py-3">{u.branch || "—"}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleUser(u.id)} className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.active ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {u.active ? "Active" : "Disabled"}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {u.username !== "admin" && (
                        <button onClick={() => deleteUser(u.id)} className="p-1 hover:bg-red-100 rounded text-red-500"><Trash2 size={14} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "branches" && (
        <div className="bg-white rounded-xl border p-5">
          <h3 className="font-semibold text-gray-800 mb-3">Manage Branches</h3>
          <div className="flex gap-2 mb-4">
            <input type="text" placeholder="New branch name" value={newBranch} onChange={e => setNewBranch(e.target.value)} className="flex-1 px-3 py-2 border rounded-lg text-sm" />
            <button onClick={addBranch} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700">Add</button>
          </div>
          <div className="space-y-2">
            {branches.map(b => (
              <div key={b} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                {editingBranch === b ? (
                  <div className="flex items-center gap-2 flex-1 mr-2">
                    <input type="text" value={editBranchName} onChange={e => setEditBranchName(e.target.value)}
                      className="flex-1 px-2 py-1 border rounded text-sm focus:ring-2 focus:ring-teal-500" onKeyDown={e => e.key === "Enter" && saveEditBranch()} />
                    <button onClick={saveEditBranch} className="p-1 hover:bg-green-100 rounded text-green-600"><Save size={14} /></button>
                    <button onClick={() => setEditingBranch(null)} className="p-1 hover:bg-gray-200 rounded text-gray-500"><X size={14} /></button>
                  </div>
                ) : (
                  <>
                    <span className="font-medium text-sm">{b}</span>
                    <div className="flex items-center gap-1">
                      <button onClick={() => startEditBranch(b)} className="p-1 hover:bg-blue-100 rounded text-blue-500"><Edit2 size={14} /></button>
                      <button onClick={() => removeBranch(b)} className="p-1 hover:bg-red-100 rounded text-red-500"><Trash2 size={14} /></button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === "bulk" && (
        <div className="space-y-4">
          {/* Undo Last Bulk Upload */}
          {lastBulkUpload ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-amber-800">Last Bulk Upload</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  {lastBulkUpload.count} {lastBulkUpload.type} entries · {new Date(lastBulkUpload.timestamp).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                </p>
              </div>
              <button onClick={handleUndoBulkUpload}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors whitespace-nowrap">
                Undo Upload
              </button>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
              <p className="text-sm text-gray-500">No recent bulk upload to undo.</p>
            </div>
          )}
          {/* Bulk Upload Group OD Entries */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2"><Upload size={18} className="text-teal-600" /> Bulk Upload Group OD Entries</h3>
            <p className="text-sm text-gray-500 mb-3">Upload a CSV file with columns: Date, Branch, Customer Name, Customer ID, Loan Account No., Group OD Amount Due, No. of Customers, Group OD Paid, Time, Recorded By, Approval Subject, Waiver Approver, Payment Mode, UPI Reference, PTP Date</p>
            <p className="text-xs text-gray-400 mb-3">Date format: dd-mm-yyyy or yyyy-mm-dd. Waivers are auto-calculated. "Recorded By" captures who collected the payment.</p>
            <label className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 cursor-pointer transition-colors">
              <Upload size={14} /> Choose CSV File
              <input type="file" accept=".csv" onChange={handleBulkEntries} className="hidden" />
            </label>
          </div>

          {/* Bulk Upload Individual OD Entries */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2"><Upload size={18} className="text-indigo-600" /> Bulk Upload Individual OD Entries</h3>
            <p className="text-sm text-gray-500 mb-3">Upload a CSV file with columns: Date, Branch, Customer Name, Customer ID, Loan Account No., OD Amount Due, OD Paid, Waiver, SMA Bucket, Time, Recorded By, Approval Subject, Waiver Approver, Payment Mode, UPI Reference, PTP Date</p>
            <p className="text-xs text-gray-400 mb-3">Date format: dd-mm-yyyy or yyyy-mm-dd. Waiver column is optional — if omitted or blank, waiver defaults to 0. SMA Bucket: SMA-0, SMA-1, SMA-2, or NPA. "Recorded By" captures who collected the payment.</p>
            <label className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 cursor-pointer transition-colors">
              <Upload size={14} /> Choose CSV File
              <input type="file" accept=".csv" onChange={handleBulkIndividualEntries} className="hidden" />
            </label>
          </div>

          {/* Bulk Upload Branches */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2"><GitBranch size={18} className="text-teal-600" /> Bulk Upload Branches</h3>
            <p className="text-sm text-gray-500 mb-3">Upload a CSV with a "Branch" or "Name" column. Duplicates are automatically skipped.</p>
            <label className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 cursor-pointer transition-colors">
              <Upload size={14} /> Choose CSV File
              <input type="file" accept=".csv" onChange={handleBulkBranches} className="hidden" />
            </label>
          </div>

          {/* Bulk Upload Users */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2"><Users size={18} className="text-teal-600" /> Bulk Upload Users</h3>
            <p className="text-sm text-gray-500 mb-3">Upload a CSV with columns: username, name, role (staff/elevated_staff/admin), branch, password (optional, defaults to Dhanam@123). Existing usernames are skipped.</p>
            <label className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 cursor-pointer transition-colors">
              <Upload size={14} /> Choose CSV File
              <input type="file" accept=".csv" onChange={handleBulkUsers} className="hidden" />
            </label>
          </div>

          {/* Download Templates */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-gray-800 mb-3">Download CSV Templates</h3>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => {
                const csv = "Date,Branch,Customer Name,Customer ID,Loan Account No.,Group OD Amount Due,No. of Customers,Group OD Paid,Time,Recorded By,Approval Subject,Waiver Approver,Payment Mode,UPI Reference,PTP Date\n01-04-2025,Annur,Sample Customer,CUST001,LA001,50000,5,8000,10:30,Vijila,,,Cash,,";
                const blob = new Blob([csv], { type: "text/csv" });
                const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "group-od-entries-template.csv"; a.click();
              }} className="px-3 py-2 bg-teal-50 text-teal-700 rounded-lg text-sm hover:bg-teal-100 transition-colors flex items-center gap-1">
                <Download size={14} /> Group OD Template
              </button>
              <button onClick={() => {
                const csv = "Date,Branch,Customer Name,Customer ID,Loan Account No.,OD Amount Due,OD Paid,Waiver,SMA Bucket,Time,Recorded By,Approval Subject,Waiver Approver,Payment Mode,UPI Reference,PTP Date\n01-04-2025,Annur,Sample Customer,CUST001,LA001,10000,10000,0,SMA-1,10:30,Vijila,,,Cash,,";
                const blob = new Blob([csv], { type: "text/csv" });
                const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "individual-od-entries-template.csv"; a.click();
              }} className="px-3 py-2 bg-indigo-50 text-indigo-700 rounded-lg text-sm hover:bg-indigo-100 transition-colors flex items-center gap-1">
                <Download size={14} /> Individual OD Template
              </button>
              <button onClick={() => {
                const csv = "Branch\nNew Branch 1\nNew Branch 2";
                const blob = new Blob([csv], { type: "text/csv" });
                const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "branches-template.csv"; a.click();
              }} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors flex items-center gap-1">
                <Download size={14} /> Branches Template
              </button>
              <button onClick={() => {
                const csv = "username,name,role,branch,password\njohn,John Doe,staff,Annur,Dhanam@123";
                const blob = new Blob([csv], { type: "text/csv" });
                const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "users-template.csv"; a.click();
              }} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors flex items-center gap-1">
                <Download size={14} /> Users Template
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingBulkImport && (
        <CSBApprovalModal
          candidates={pendingBulkImport.csbRows}
          groupODRows={pendingBulkImport.groupODRows}
          failedRows={pendingBulkImport.failedRows}
          onConfirm={() => finalizeBulkIndivImport(pendingBulkImport.validRows, pendingBulkImport.csbRows, true, pendingBulkImport.groupODRows, pendingBulkImport.failedRows)}
          onReject={() => finalizeBulkIndivImport(pendingBulkImport.validRows, pendingBulkImport.csbRows, false, pendingBulkImport.groupODRows, [...pendingBulkImport.failedRows, ...pendingBulkImport.csbRows.map(r => ({ ...r, reason: "CSB Bank — rejected by user" }))])}
        />
      )}

      {tab === "settings" && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-gray-800 mb-3">App Settings</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                <input type="text" value={config.companyName} onChange={e => handleConfigChange("companyName", e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div><p className="font-medium text-sm">Allow Staff to Edit Entries</p><p className="text-xs text-gray-500">Staff can modify their own entries</p></div>
                <button onClick={() => handleConfigChange("allowStaffEdit", !config.allowStaffEdit)}
                  className={`w-11 h-6 rounded-full transition-colors ${config.allowStaffEdit ? "bg-teal-600" : "bg-gray-300"}`}>
                  <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${config.allowStaffEdit ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div><p className="font-medium text-sm">Allow Staff to Delete Entries</p><p className="text-xs text-gray-500">Staff can remove their own entries</p></div>
                <button onClick={() => handleConfigChange("allowStaffDelete", !config.allowStaffDelete)}
                  className={`w-11 h-6 rounded-full transition-colors ${config.allowStaffDelete ? "bg-teal-600" : "bg-gray-300"}`}>
                  <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${config.allowStaffDelete ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </div>
              <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div><p className="font-medium text-sm">Staff See All Branches</p><p className="text-xs text-gray-500">Staff can view data from all branches</p></div>
                <button onClick={() => handleConfigChange("staffSeeAllBranches", !config.staffSeeAllBranches)}
                  className={`w-11 h-6 rounded-full transition-colors ${config.staffSeeAllBranches ? "bg-teal-600" : "bg-gray-300"}`}>
                  <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${config.staffSeeAllBranches ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </div>
            </div>
          </div>
          {/* OD Insights access control */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-gray-800 mb-1 flex items-center gap-2"><TrendingUp size={18} className="text-teal-600" /> OD Insights Access</h3>
            <p className="text-xs text-gray-500 mb-4">Admins always have access. Toggle which other users can view the OD Insights dashboards (DPD buckets, efficiency, trends, etc.).</p>
            {(() => {
              const accessList = Array.isArray(config.odInsightsAccessUserIds) ? config.odInsightsAccessUserIds : [];
              const toggleAccess = (uid) => {
                const next = accessList.includes(uid) ? accessList.filter(id => id !== uid) : [...accessList, uid];
                handleConfigChange("odInsightsAccessUserIds", next);
              };
              const nonAdmins = users.filter(u => u.role !== "admin");
              const grantedCount = nonAdmins.filter(u => accessList.includes(u.id)).length;
              const allGranted = nonAdmins.length > 0 && grantedCount === nonAdmins.length;
              const setAll = (grant) => {
                handleConfigChange("odInsightsAccessUserIds", grant ? nonAdmins.map(u => u.id) : []);
              };
              return (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <button onClick={() => setAll(true)} className="text-xs px-3 py-1.5 bg-teal-50 text-teal-700 rounded-lg hover:bg-teal-100 border border-teal-100">Grant all</button>
                    <button onClick={() => setAll(false)} className="text-xs px-3 py-1.5 bg-gray-50 text-gray-600 rounded-lg hover:bg-gray-100 border">Revoke all</button>
                    <span className="text-xs text-gray-500 ml-2">{grantedCount} of {nonAdmins.length} non-admin users granted</span>
                  </div>
                  <div className="max-h-80 overflow-y-auto border rounded-lg divide-y">
                    {users.map(u => {
                      const isUserAdmin = u.role === "admin";
                      const granted = isUserAdmin || accessList.includes(u.id);
                      const roleLabel = u.role === "elevated_staff" ? "MIS Staff" : u.role === "admin" ? "Admin" : "Staff";
                      const roleColor = u.role === "admin" ? "bg-purple-100 text-purple-700" : u.role === "elevated_staff" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700";
                      return (
                        <div key={u.id} className="flex items-center justify-between px-3 py-2.5">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium text-gray-800 truncate">{u.name}</p>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${roleColor}`}>{roleLabel}</span>
                              {!u.active && <span className="text-[10px] text-gray-400">(inactive)</span>}
                            </div>
                            <p className="text-xs text-gray-500 truncate">@{u.username}{u.branch ? ` • ${u.branch}` : ""}</p>
                          </div>
                          {isUserAdmin ? (
                            <span className="text-xs text-gray-400 px-2">Always on</span>
                          ) : (
                            <button onClick={() => toggleAccess(u.id)}
                              className={`w-11 h-6 rounded-full transition-colors flex-shrink-0 ${granted ? "bg-teal-600" : "bg-gray-300"}`}>
                              <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${granted ? "translate-x-5" : "translate-x-0.5"}`} />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}
          </div>
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-amber-700 mb-1 flex items-center gap-2"><AlertTriangle size={18} /> Data Fix</h3>
            <p className="text-xs text-gray-500 mb-3">If Individual OD entries were imported with incorrect waiver amounts (the unpaid balance was mistakenly recorded as a waiver), use this to zero out waivers on all Individual OD entries.</p>
            <button onClick={() => {
              const indivCount = entries.filter(e => e.odType === "Individual OD" && (Number(e.waiver) || 0) > 0).length;
              if (indivCount === 0) { alert("No Individual OD entries with waivers found. Nothing to fix."); return; }
              if (!window.confirm(`This will set waiver = 0 on ${indivCount} Individual OD entries that currently have a waiver amount.\n\nThe unpaid balance will remain as pending dues. Continue?`)) return;
              const fixed = entries.map(e => e.odType === "Individual OD" ? { ...e, waiver: 0, waiverApproval: null } : e);
              setEntries(fixed);
              saveData(STORAGE_KEYS.entries, fixed);
              alert(`Done. Cleared waivers on ${indivCount} Individual OD entries.`);
            }} className="px-4 py-2 bg-amber-600 text-white rounded-lg text-sm hover:bg-amber-700 transition-colors">
              Fix Individual OD Waivers
            </button>
          </div>
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-red-700 mb-3 flex items-center gap-2"><Database size={18} /> Danger Zone</h3>
            <button onClick={resetAllData} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors">Reset All Entries</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Change Password Modal ──────────────────────────────────────────────────
function ChangePasswordModal({ user, users, setUsers, onDone, isForced }) {
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [error, setError] = useState("");
  const [showPass, setShowPass] = useState(false);

  const handleChange = () => {
    if (!newPass || newPass.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (newPass === "Dhanam@123") { setError("Please choose a different password."); return; }
    if (newPass !== confirmPass) { setError("Passwords do not match."); return; }
    const updated = users.map(u => u.id === user.id ? { ...u, password: newPass, mustChangePassword: false } : u);
    setUsers(updated); saveData(STORAGE_KEYS.users, updated);
    onDone({ ...user, password: newPass, mustChangePassword: false });
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 mx-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-teal-100 rounded-lg"><Lock size={24} className="text-teal-600" /></div>
          <div>
            <h3 className="text-lg font-bold text-gray-900">{isForced ? "Change Your Password" : "Update Password"}</h3>
            {isForced && <p className="text-sm text-gray-500">You must set a new password before continuing</p>}
          </div>
        </div>
        {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4 flex items-center gap-2"><AlertTriangle size={16} /> {error}</div>}
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password *</label>
            <div className="relative">
              <input type={showPass ? "text" : "password"} value={newPass} onChange={e => setNewPass(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500 pr-10" placeholder="Min 6 characters" />
              <button onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm Password *</label>
            <input type={showPass ? "text" : "password"} value={confirmPass} onChange={e => setConfirmPass(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="Re-enter password" />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          {!isForced && <button onClick={() => onDone(null)} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>}
          <button onClick={handleChange} className={`${isForced ? "w-full" : "flex-1"} px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 font-medium`}>
            Set Password
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Login Screen ───────────────────────────────────────────────────────────
function LoginScreen({ onLogin, users, setUsers }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [pendingUser, setPendingUser] = useState(null); // user needing password change

  const handleLogin = () => {
    const user = users.find(u => u.username === username && u.password === password && u.active);
    if (!user) { setError("Invalid credentials or account disabled."); return; }
    if (user.mustChangePassword) {
      setPendingUser(user);
    } else {
      onLogin(user);
    }
    setError("");
  };

  const handlePasswordChanged = (updatedUser) => {
    if (updatedUser) onLogin(updatedUser);
    setPendingUser(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-cyan-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-teal-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl font-bold text-white">OD</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">OD Pulse</h1>
          <p className="text-sm text-gray-500 mt-1">MFI Recovery Tracker</p>
        </div>
        {error && <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4 flex items-center gap-2"><AlertTriangle size={16} /> {error}</div>}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()}
              className="w-full px-4 py-2.5 border rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500" placeholder="Enter username" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <div className="relative">
              <input type={showPass ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()}
                className="w-full px-4 py-2.5 border rounded-xl focus:ring-2 focus:ring-teal-500 focus:border-teal-500 pr-10" placeholder="Enter password" />
              <button onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <button onClick={handleLogin} className="w-full py-2.5 bg-teal-600 text-white rounded-xl font-semibold hover:bg-teal-700 transition-colors shadow-lg shadow-teal-200">
            Sign In
          </button>
        </div>
      </div>
      {pendingUser && (
        <ChangePasswordModal user={pendingUser} users={users} setUsers={setUsers} onDone={handlePasswordChanged} isForced={true} />
      )}
    </div>
  );
}

// ─── Main App ───────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState("dashboard");
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [branches, setBranches] = useState([]);
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [entryType, setEntryType] = useState("group"); // "group" | "individual"

  useEffect(() => {
    // Try to load from API first, fall back to localStorage
    const initData = async () => {
      // Fetch all collections from server in parallel
      const [apiEntries, apiUsers, apiBranches, apiConfig, apiNotifications] = await Promise.all([
        fetchAPI("entries", []),
        fetchAPI("users", []),
        fetchAPI("branches", []),
        fetchAPI("config", DEFAULT_CONFIG),
        fetchAPI("notifications", []),
      ]);

      // Determine if API is available (at least one non-null response)
      const apiAvailable = apiEntries !== null || apiUsers !== null;

      // ── Users ──
      let finalUsers;
      if (apiAvailable && apiUsers && apiUsers.length > 0) {
        finalUsers = apiUsers;
        localStorage.setItem(STORAGE_KEYS.users, JSON.stringify(finalUsers));
      } else {
        const savedVersion = loadData(STORAGE_KEYS.version, 0);
        if (savedVersion < APP_VERSION) {
          finalUsers = DEFAULT_USERS;
          saveData(STORAGE_KEYS.users, DEFAULT_USERS);
          saveData(STORAGE_KEYS.version, APP_VERSION);
        } else {
          finalUsers = loadData(STORAGE_KEYS.users, DEFAULT_USERS);
        }
      }
      setUsers(finalUsers);

      // ── Branches ──
      let finalBranches;
      if (apiAvailable && apiBranches && apiBranches.length > 0) {
        finalBranches = apiBranches;
        localStorage.setItem(STORAGE_KEYS.branches, JSON.stringify(finalBranches));
      } else {
        const savedVersion = loadData(STORAGE_KEYS.version, 0);
        if (savedVersion < APP_VERSION) {
          finalBranches = DEFAULT_BRANCHES;
          saveData(STORAGE_KEYS.branches, DEFAULT_BRANCHES);
        } else {
          finalBranches = loadData(STORAGE_KEYS.branches, DEFAULT_BRANCHES);
        }
      }
      setBranches(finalBranches);

      // ── Config ──
      const finalConfig = (apiAvailable && apiConfig && apiConfig.companyName) ? apiConfig : loadData(STORAGE_KEYS.config, DEFAULT_CONFIG);
      setConfig(finalConfig);
      localStorage.setItem(STORAGE_KEYS.config, JSON.stringify(finalConfig));

      // ── Entries ──
      let allEntries;
      if (apiAvailable && apiEntries !== null) {
        // API is the source of truth — always use server data
        allEntries = apiEntries;
        localStorage.setItem(STORAGE_KEYS.entries, JSON.stringify(allEntries));
      } else {
        allEntries = loadData(STORAGE_KEYS.entries, []);
      }
      setEntries(allEntries);

      // ── Notifications ──
      const finalNotifications = (apiAvailable && apiNotifications !== null) ? apiNotifications : loadData(STORAGE_KEYS.notifications, []);
      setNotifications(finalNotifications);
      localStorage.setItem(STORAGE_KEYS.notifications, JSON.stringify(finalNotifications));

      // Clear stale reset flag if present
      localStorage.removeItem("odpulse_reset_ts");
    };

    initData();
  }, []);

  const handleLogin = (u) => { setUser(u); setPage("dashboard"); };
  const handleLogout = () => { setUser(null); setPage("dashboard"); setSidebarOpen(false); };

  if (!user) return <LoginScreen onLogin={handleLogin} users={users} setUsers={setUsers} />;

  const isAdmin = user.role === "admin";
  const isElevated = user.role === "elevated_staff";

  const unreadNotificationsCount = notifications.filter(n =>
    (user.role === "admin" || user.role === "elevated_staff" ? true : n.forUserId === user.id) && (!n.read || n.type === "ptp_pending")
  ).length;

  const navItems = [
    { key: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
    { key: "entry", icon: Plus, label: "New Entry" },
    { key: "records", icon: FileText, label: "Group OD" },
    { key: "ind_records", icon: FileText, label: "Individual OD" },
    ...((isAdmin || (Array.isArray(config.odInsightsAccessUserIds) && config.odInsightsAccessUserIds.includes(user.id))) ? [{ key: "od_insights", icon: TrendingUp, label: "OD Insights" }] : []),
    ...(isAdmin || isElevated ? [{ key: "od_upload", icon: Upload, label: "OD Upload" }] : []),
    { key: "notifications", icon: Bell, label: "Notifications", badge: unreadNotificationsCount > 0 ? unreadNotificationsCount : null },
    ...(isAdmin ? [{ key: "admin", icon: Shield, label: "Admin" }] : []),
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b shadow-sm sticky top-0 z-40">
        <div className="flex items-center justify-between px-4 py-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="lg:hidden p-1.5 hover:bg-gray-100 rounded-lg">
              <div className="space-y-1"><div className="w-5 h-0.5 bg-gray-600" /><div className="w-5 h-0.5 bg-gray-600" /><div className="w-5 h-0.5 bg-gray-600" /></div>
            </button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center"><span className="text-sm font-bold text-white">OD</span></div>
              <span className="font-bold text-gray-900 hidden sm:block">{config.companyName}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium text-gray-700">{user.name}</p>
              <p className="text-xs text-gray-400">{user.role === "elevated_staff" ? "MIS Staff" : user.role} • {user.branch || "All Branches"}</p>
            </div>
            <button onClick={handleLogout} className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors">
              <LogOut size={16} /> Logout
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto flex">
        {/* Sidebar */}
        <aside className={`fixed lg:static inset-y-0 left-0 z-30 w-56 bg-white border-r shadow-lg lg:shadow-none transform transition-transform lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} pt-16 lg:pt-0`}>
          <nav className="p-3 space-y-1">
            {navItems.map(item => (
              <button key={item.key} onClick={() => { setPage(item.key); setSidebarOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors relative ${
                  page === item.key
                    ? item.key === "ind_records" ? "bg-indigo-50 text-indigo-700" : "bg-teal-50 text-teal-700"
                    : "text-gray-600 hover:bg-gray-50"
                }`}>
                <item.icon size={18} className={page === item.key && item.key === "ind_records" ? "text-indigo-600" : ""} /> {item.label}
                {item.badge && <span className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-5 h-5 bg-red-600 text-white text-xs font-bold rounded-full">{item.badge}</span>}
              </button>
            ))}
          </nav>
        </aside>

        {/* Overlay */}
        {sidebarOpen && <div className="fixed inset-0 bg-black/30 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

        {/* Main content */}
        <main className="flex-1 p-4 lg:p-6 min-h-[calc(100vh-60px)]">
          {page === "dashboard" && <Dashboard user={user} entries={entries} branches={branches} config={config} />}
          {page === "entry" && (
            <div>
              {/* Entry type toggle */}
              <div className="flex gap-3 mb-6">
                <button onClick={() => setEntryType("group")}
                  className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-colors flex items-center gap-2 ${entryType === "group" ? "bg-teal-600 text-white shadow-lg shadow-teal-200" : "bg-white text-gray-600 border hover:bg-gray-50"}`}>
                  <Users size={15} /> Group OD Entry
                </button>
                <button onClick={() => setEntryType("individual")}
                  className={`px-5 py-2.5 rounded-xl font-semibold text-sm transition-colors flex items-center gap-2 ${entryType === "individual" ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" : "bg-white text-gray-600 border hover:bg-gray-50"}`}>
                  <UserPlus size={15} /> Individual OD Entry
                </button>
              </div>
              {entryType === "group"
                ? <EntryForm user={user} branches={branches} entries={entries} setEntries={setEntries} setPage={setPage} />
                : <IndividualEntryForm user={user} branches={branches} entries={entries} setEntries={setEntries} setPage={setPage} />
              }
            </div>
          )}
          {page === "records" && <RecordsTable user={user} entries={entries} setEntries={setEntries} config={config} branches={branches} notifications={notifications} setNotifications={setNotifications} odTypeFilter="Group OD" />}
          {page === "ind_records" && <RecordsTable user={user} entries={entries} setEntries={setEntries} config={config} branches={branches} notifications={notifications} setNotifications={setNotifications} odTypeFilter="Individual OD" />}
          {page === "od_insights" && (isAdmin || (Array.isArray(config.odInsightsAccessUserIds) && config.odInsightsAccessUserIds.includes(user.id))) && <CollectionDashboard user={user} entries={entries} branches={branches} />}
          {page === "od_upload" && (isAdmin || isElevated) && <DataUploadPage user={user} />}
          {page === "notifications" && <NotificationsPage user={user} users={users} notifications={notifications} setNotifications={setNotifications} />}
          {page === "admin" && user.role === "admin" && <AdminPanel users={users} setUsers={setUsers} branches={branches} setBranches={setBranches} config={config} setConfig={setConfig} entries={entries} setEntries={setEntries} notifications={notifications} setNotifications={setNotifications} />}
        </main>
      </div>
    </div>
  );
}
