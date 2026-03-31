import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line } from "recharts";
import { Plus, Trash2, LogOut, Settings, Users, GitBranch, LayoutDashboard, FileText, ChevronDown, ChevronRight, ArrowLeft, Search, Eye, EyeOff, Edit2, Save, X, AlertTriangle, CheckCircle, Database, Shield, UserPlus, ChevronUp, Download, Calendar, Tag, Lock, Upload } from "lucide-react";

// ─── Constants & Helpers ────────────────────────────────────────────────────
const COLORS = ["#0f766e", "#06b6d4", "#8b5cf6", "#f59e0b", "#ef4444", "#10b981", "#ec4899", "#6366f1", "#14b8a6", "#f97316"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STORAGE_KEYS = { entries: "odpulse_entries", users: "odpulse_users", branches: "odpulse_branches", config: "odpulse_config", version: "odpulse_version" };
const APP_VERSION = 2; // bump this to force re-seed users & branches

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

const loadData = (key, fallback) => {
  try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : fallback; }
  catch { return fallback; }
};
const saveData = (key, data) => localStorage.setItem(key, JSON.stringify(data));

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
    "Date", "Time", "Branch", "Customer Name", "Customer ID", "Loan Account No.",
    "OD Type",
    "Self OD Amount Due", "Self OD Paid", "Self OD Waiver",
    "Group OD Amount Due", "No. of Customers in Group", "Customer Share (Auto)", "Group OD Paid", "Group OD Waiver",
    "Total Paid", "Total Waiver",
    "Waiver Approver", "Approval Subject", "Approval Date", "Entered By"
  ]];
  entries.forEach(e => {
    const customerShare = e.customerShare !== undefined ? e.customerShare : (e.numberOfCustomers > 0 ? Math.round(e.groupOdAmount / e.numberOfCustomers) : 0);
    rows.push([
      e.date, e.time, e.branch,
      e.customerName, e.customerId, e.loanAccountNo,
      e.odType || "Group OD",
      e.selfOdAmountDue || 0, e.selfOdPaidAmount || 0, e.selfOdWaiver || 0,
      e.groupOdAmount || 0, e.numberOfCustomers || 0, customerShare,
      e.groupOdPaidAmount !== undefined ? e.groupOdPaidAmount : (e.customerShare || 0),
      e.groupOdWaiver !== undefined ? e.groupOdWaiver : (e.waiver || 0),
      getPaidCSV(e), e.waiver || 0,
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

function DateRangeFilter({ dateFrom, dateTo, setDateFrom, setDateTo }) {
  const presets = getDateRangePresets();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Calendar size={16} className="text-teal-600" />
      {presets.map(p => (
        <button key={p.label} onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}
          className={`px-2 py-1 text-xs rounded-full border transition-all ${dateFrom === p.from && dateTo === p.to ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-300 hover:border-teal-400"}`}>
          {p.label}
        </button>
      ))}
      <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-2 py-1 text-xs border rounded" />
      <span className="text-xs text-gray-400">to</span>
      <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-2 py-1 text-xs border rounded" />
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

// ─── Entry Form ─────────────────────────────────────────────────────────────
function EntryForm({ user, branches, entries, setEntries, setPage }) {
  const [branch, setBranch] = useState(user.role === "staff" ? user.branch : "");
  const [date] = useState(nowDate());
  const [customerName, setCustomerName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [loanAccountNo, setLoanAccountNo] = useState("");
  const [odType, setOdType] = useState(""); // "Self OD" | "Group OD"
  // Self OD fields
  const [selfOdAmountDue, setSelfOdAmountDue] = useState("");
  const [selfOdPaidAmount, setSelfOdPaidAmount] = useState("");
  // Group OD fields
  const [numberOfCustomers, setNumberOfCustomers] = useState("");
  const [groupOdAmount, setGroupOdAmount] = useState("");
  const [groupOdPaidAmount, setGroupOdPaidAmount] = useState("");
  const [approvalEmailSubject, setApprovalEmailSubject] = useState("");
  const [showWaiverModal, setShowWaiverModal] = useState(false);
  const [pendingEntry, setPendingEntry] = useState(null);

  // Self OD calculations
  const selfOdDue = Number(selfOdAmountDue) || 0;
  const selfOdPaid = Number(selfOdPaidAmount) || 0;
  const selfOdWaiver = Math.max(0, selfOdDue - selfOdPaid);

  // Group OD calculations
  const numCust = Number(numberOfCustomers) || 0;
  const groupOdDue = Number(groupOdAmount) || 0;
  const customerShare = numCust > 0 ? Math.round(groupOdDue / numCust) : 0; // auto-calc
  const groupOdPaid = Number(groupOdPaidAmount) || 0;
  const groupOdWaiver = Math.max(0, customerShare - groupOdPaid);

  // Totals
  const totalWaiver = (odType === "Self OD" ? selfOdWaiver : 0) + groupOdWaiver;
  const totalPaidAmount = (odType === "Self OD" ? selfOdPaid : 0) + groupOdPaid;

  const handleSave = () => {
    if (!branch) { alert("Please select a branch."); return; }
    if (!customerName.trim()) { alert("Please enter customer name."); return; }
    if (!customerId.trim()) { alert("Please enter customer ID."); return; }
    if (!loanAccountNo.trim()) { alert("Please enter loan account number."); return; }
    if (!odType) { alert("Please select the Type of OD."); return; }
    if (odType === "Self OD") {
      if (selfOdDue <= 0) { alert("Please enter Self OD Amount Due."); return; }
      if (selfOdPaid < 0) { alert("Self OD Paid Amount cannot be negative."); return; }
      if (selfOdPaid > selfOdDue) { alert("Self OD Paid Amount cannot exceed Self OD Amount Due."); return; }
    }
    if (numCust <= 0) { alert("Please enter the total number of customers in the group."); return; }
    if (groupOdDue <= 0) { alert("Please enter Group OD Amount Due."); return; }
    if (groupOdPaid < 0) { alert("Group OD Paid Amount cannot be negative."); return; }
    if (groupOdPaid > customerShare) { alert("Group OD Paid Amount cannot exceed the Customer Share."); return; }
    if (totalWaiver > 0 && !approvalEmailSubject.trim()) { alert("Waiver detected. Please enter the approval email subject line."); return; }

    // Check duplicate
    const isDup = entries.some(e =>
      e.customerId === customerId.trim() && e.loanAccountNo === loanAccountNo.trim() && e.date === date && e.branch === branch
    );
    if (isDup && !confirm("A similar entry already exists for this customer today. Save anyway?")) return;

    const entry = {
      id: generateId(), date, time: nowTime(), branch,
      customerName: customerName.trim(), customerId: customerId.trim(), loanAccountNo: loanAccountNo.trim(),
      odType,
      // Self OD fields (only populated for Self OD type)
      selfOdAmountDue: odType === "Self OD" ? selfOdDue : 0,
      selfOdPaidAmount: odType === "Self OD" ? selfOdPaid : 0,
      selfOdWaiver: odType === "Self OD" ? selfOdWaiver : 0,
      // Group OD fields (always populated)
      groupOdAmount: groupOdDue,
      numberOfCustomers: numCust,
      customerShare, // auto-calc: groupOdAmount / numberOfCustomers
      groupOdPaidAmount: groupOdPaid,
      groupOdWaiver,
      // Totals for dashboard
      totalPaidAmount,
      waiver: totalWaiver,
      waiverApproval: totalWaiver > 0 ? { approverName: user.name, emailSubject: approvalEmailSubject.trim(), approvalDate: date } : null,
      enteredBy: user.id, enteredByName: user.name,
    };

    if (totalWaiver > 0) {
      setPendingEntry(entry);
      setShowWaiverModal(true);
    } else {
      saveEntry(entry);
    }
  };

  const saveEntry = (entry) => {
    const updated = [entry, ...entries];
    setEntries(updated);
    saveData(STORAGE_KEYS.entries, updated);
    // Reset form
    setCustomerName(""); setCustomerId(""); setLoanAccountNo("");
    setOdType(""); setApprovalEmailSubject("");
    setSelfOdAmountDue(""); setSelfOdPaidAmount("");
    setNumberOfCustomers(""); setGroupOdAmount(""); setGroupOdPaidAmount("");
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
      <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2"><Plus size={22} className="text-teal-600" /> New OD Recovery Entry</h2>

      {/* Section 1: Group OD Details */}
      <div className="bg-white rounded-xl shadow-sm border p-5 mb-4">
        <h3 className="text-sm font-semibold text-teal-700 uppercase tracking-wide mb-4">Group OD Details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Branch *</label>
            {user.role === "staff" ? (
              <input type="text" value={user.branch} disabled className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-600" />
            ) : (
              <select value={branch} onChange={e => setBranch(e.target.value)} className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500">
                <option value="">Select Branch</option>
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input type="date" value={date} disabled className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-600" />
          </div>
        </div>
      </div>

      {/* Section 2: Customer Details */}
      <div className="bg-white rounded-xl shadow-sm border p-5 mb-4">
        <h3 className="text-sm font-semibold text-teal-700 uppercase tracking-wide mb-4">Customer Details</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name *</label>
            <input type="text" value={customerName} onChange={e => setCustomerName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="Full name" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Customer ID *</label>
            <input type="text" value={customerId} onChange={e => setCustomerId(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="e.g. CUST001" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Loan Account No. *</label>
            <input type="text" value={loanAccountNo} onChange={e => setLoanAccountNo(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="e.g. LA12345" />
          </div>
        </div>
      </div>

      {/* Section 3: OD Details */}
      <div className="bg-white rounded-xl shadow-sm border p-5 mb-4">
        <h3 className="text-sm font-semibold text-teal-700 uppercase tracking-wide mb-4">OD Details</h3>

        {/* Type of OD dropdown */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-gray-700 mb-1">Type of OD *</label>
          <select value={odType} onChange={e => { setOdType(e.target.value); setSelfOdAmountDue(""); setSelfOdPaidAmount(""); setNumberOfCustomers(""); setGroupOdAmount(""); setGroupOdPaidAmount(""); }}
            className="w-full sm:w-64 px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500">
            <option value="">Select Type</option>
            <option value="Self OD">Self OD</option>
            <option value="Group OD">Group OD</option>
          </select>
        </div>

        {/* ── Group OD fields (shown for both types) ── */}
        {odType && (
          <>
            {/* Self OD section — only for "Self OD" type */}
            {odType === "Self OD" && (
              <div className="mb-5">
                <h4 className="text-xs font-semibold text-indigo-600 uppercase tracking-wide mb-3 pb-1 border-b border-indigo-100">Self OD</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Self OD Amount Due *</label>
                    <input type="number" min="0" value={selfOdAmountDue} onChange={e => setSelfOdAmountDue(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="e.g. 5000" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Paid Amount *</label>
                    <input type="number" min="0" value={selfOdPaidAmount} onChange={e => setSelfOdPaidAmount(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="e.g. 4000" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Waiver (Auto)</label>
                    <input readOnly value={formatINR(selfOdWaiver)}
                      className={`w-full px-3 py-2 border rounded-lg font-semibold cursor-default ${selfOdWaiver > 0 ? "bg-amber-50 border-amber-300 text-amber-700" : "bg-green-50 border-green-300 text-green-700"}`} />
                    {selfOdWaiver > 0 && <p className="text-xs text-amber-600 mt-1 font-medium">Approval required</p>}
                  </div>
                </div>
              </div>
            )}

            {/* Group OD section */}
            <div>
              <h4 className={`text-xs font-semibold uppercase tracking-wide mb-3 pb-1 border-b ${odType === "Self OD" ? "text-indigo-600 border-indigo-100" : "text-teal-600 border-teal-100"}`}>
                Group OD
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Group OD Amount Due *</label>
                  <input type="number" min="0" value={groupOdAmount} onChange={e => setGroupOdAmount(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="e.g. 10000" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Total No. of Customers in Group *</label>
                  <input type="number" min="1" value={numberOfCustomers} onChange={e => setNumberOfCustomers(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="e.g. 4" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {/* Customer Share — auto-calc */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Customer Share (Auto)</label>
                  <input readOnly value={formatINR(customerShare)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg bg-gray-100 text-gray-800 font-semibold cursor-default" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Paid Amount *</label>
                  <input type="number" min="0" value={groupOdPaidAmount} onChange={e => setGroupOdPaidAmount(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-teal-500" placeholder="e.g. 2000" />
                </div>
                {/* Group OD Waiver — auto-calc */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Waiver (Auto)</label>
                  <input readOnly value={formatINR(groupOdWaiver)}
                    className={`w-full px-3 py-2 border rounded-lg font-semibold cursor-default ${groupOdWaiver > 0 ? "bg-amber-50 border-amber-300 text-amber-700" : "bg-green-50 border-green-300 text-green-700"}`} />
                  {groupOdWaiver > 0 && <p className="text-xs text-amber-600 mt-1 font-medium">Approval required</p>}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Inline Approval Email Subject — shown when any waiver > 0 */}
        {totalWaiver > 0 && (
          <div className="mt-4 p-4 bg-amber-50 rounded-lg border border-amber-200">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={16} className="text-amber-600" />
              <p className="text-sm font-semibold text-amber-800">Waiver of {formatINR(totalWaiver)} requires approval</p>
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
        <WaiverApprovalModal waiverAmount={totalWaiver} onConfirm={handleWaiverConfirm} onCancel={() => { setShowWaiverModal(false); setPendingEntry(null); }} />
      )}
    </div>
  );
}

// ─── Records Table ──────────────────────────────────────────────────────────
function RecordsTable({ user, entries, setEntries, config, branches }) {
  const [searchTerm, setSearchTerm] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedId, setExpandedId] = useState(null);

  const canSeeAll = user.role === "admin" || user.role === "elevated_staff";

  const visibleEntries = useMemo(() => {
    let data = entries;
    // Staff sees only their own entries; elevated_staff and admin see all
    if (user.role === "staff") data = data.filter(e => e.enteredBy === user.id);
    if (branchFilter) data = data.filter(e => e.branch === branchFilter);
    if (dateFrom) data = data.filter(e => e.date >= dateFrom);
    if (dateTo) data = data.filter(e => e.date <= dateTo);
    if (searchTerm) {
      const s = searchTerm.toLowerCase();
      data = data.filter(e =>
        (e.customerName || "").toLowerCase().includes(s) ||
        (e.customerId || "").toLowerCase().includes(s) ||
        (e.loanAccountNo || "").toLowerCase().includes(s) ||
        (e.branch || "").toLowerCase().includes(s)
      );
    }
    return data;
  }, [entries, user, config, branchFilter, dateFrom, dateTo, searchTerm]);

  const canDelete = user.role === "admin" || config.allowStaffDelete;

  const handleDelete = (id) => {
    if (!confirm("Delete this entry?")) return;
    const updated = entries.filter(e => e.id !== id);
    setEntries(updated);
    saveData(STORAGE_KEYS.entries, updated);
  };

  // Helper: backward compat — old entries used customerShare as paid, new entries have totalPaidAmount
  const getPaid = (e) => e.totalPaidAmount !== undefined ? e.totalPaidAmount : (Number(e.customerShare) || 0);
  const totalRecovered = visibleEntries.reduce((s, e) => s + getPaid(e), 0);
  const totalWaiver = visibleEntries.reduce((s, e) => s + (Number(e.waiver) || 0), 0);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2"><FileText size={22} className="text-teal-600" /> Recovery Records</h2>
        <button onClick={() => exportToCSV(visibleEntries, `odpulse-records-${nowDate()}.csv`)}
          className="flex items-center gap-1 px-3 py-1.5 bg-teal-50 text-teal-700 rounded-lg text-sm hover:bg-teal-100 transition-colors">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl shadow-sm border p-4 mb-4 space-y-3">
        <div className="flex flex-wrap gap-3">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-teal-500" placeholder="Search by name, ID, loan no..." />
            </div>
          </div>
          {canSeeAll && (
            <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
              <option value="">All Branches</option>
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
        </div>
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
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Date</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Branch</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Customer</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600">OD Type</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Group OD</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Paid</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Waiver</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">No records found</td></tr>
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
                    <td className="px-4 py-3">
                      {e.odType ? (
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${e.odType === "Self OD" ? "bg-indigo-100 text-indigo-700" : "bg-teal-100 text-teal-700"}`}>{e.odType}</span>
                      ) : <span className="text-gray-400 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{formatINR(e.groupOdAmount)}</td>
                    <td className="px-4 py-3 text-right font-medium text-teal-700">{formatINR(getPaid(e))}</td>
                    <td className="px-4 py-3 text-right">
                      {e.waiver > 0 ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                          <AlertTriangle size={10} /> {formatINR(e.waiver)}
                        </span>
                      ) : (
                        <span className="text-green-600 text-xs">No waiver</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
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
                      <td colSpan={8} className="px-6 py-4 space-y-3">
                        {/* Self OD breakdown — only for Self OD entries */}
                        {e.odType === "Self OD" && (
                          <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                            <p className="text-xs font-semibold text-indigo-700 mb-2 uppercase tracking-wide">Self OD</p>
                            <div className="grid grid-cols-3 gap-3 text-sm">
                              <div><span className="text-gray-500">Amount Due:</span> <span className="font-medium">{formatINR(e.selfOdAmountDue)}</span></div>
                              <div><span className="text-gray-500">Paid:</span> <span className="font-medium text-teal-700">{formatINR(e.selfOdPaidAmount)}</span></div>
                              <div><span className="text-gray-500">Waiver:</span> <span className={`font-medium ${e.selfOdWaiver > 0 ? "text-amber-600" : "text-green-600"}`}>{formatINR(e.selfOdWaiver)}</span></div>
                            </div>
                          </div>
                        )}
                        {/* Group OD breakdown */}
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
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
function Dashboard({ user, entries, branches, config }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [drillBranch, setDrillBranch] = useState(null);

  const visibleEntries = useMemo(() => {
    let data = entries;
    // Staff sees only their own entries; elevated_staff and admin see all
    if (user.role === "staff") data = data.filter(e => e.enteredBy === user.id);
    if (dateFrom) data = data.filter(e => e.date >= dateFrom);
    if (dateTo) data = data.filter(e => e.date <= dateTo);
    return data;
  }, [entries, user, config, dateFrom, dateTo]);

  // Helper: backward compat — old entries used customerShare as paid, new entries have totalPaidAmount
  const getEntryPaid = (e) => e.totalPaidAmount !== undefined ? e.totalPaidAmount : (Number(e.customerShare) || 0);

  const stats = useMemo(() => {
    const totalRecovered = visibleEntries.reduce((s, e) => s + getEntryPaid(e), 0);
    const totalGroupOD = visibleEntries.reduce((s, e) => s + (Number(e.groupOdAmount) || 0), 0);
    const totalWaiver = visibleEntries.reduce((s, e) => s + (Number(e.waiver) || 0), 0);
    const entriesWithWaiver = visibleEntries.filter(e => (Number(e.waiver) || 0) > 0).length;

    // Branch breakdown
    const byBranch = {};
    visibleEntries.forEach(e => {
      if (!byBranch[e.branch]) byBranch[e.branch] = { branch: e.branch, recovered: 0, waiver: 0, groupOD: 0, count: 0 };
      byBranch[e.branch].recovered += getEntryPaid(e);
      byBranch[e.branch].waiver += Number(e.waiver) || 0;
      byBranch[e.branch].groupOD += Number(e.groupOdAmount) || 0;
      byBranch[e.branch].count += 1;
    });
    const branchData = Object.values(byBranch).sort((a, b) => b.recovered - a.recovered);

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

    return { totalRecovered, totalGroupOD, totalWaiver, entriesWithWaiver, branchData, monthData, totalEntries: visibleEntries.length };
  }, [visibleEntries]);

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
        <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2"><LayoutDashboard size={22} className="text-teal-600" /> Dashboard</h2>
      </div>
      <div className="mb-4"><DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} setDateFrom={setDateFrom} setDateTo={setDateTo} /></div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 mb-1">Total Entries</p>
          <p className="text-2xl font-bold text-gray-800">{stats.totalEntries}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 mb-1">Total Recovered</p>
          <p className="text-2xl font-bold text-teal-700">{formatLakhs(stats.totalRecovered)}</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 mb-1">Total Waiver</p>
          <p className="text-2xl font-bold text-amber-700">{formatLakhs(stats.totalWaiver)}</p>
          <p className="text-xs text-gray-400">{stats.entriesWithWaiver} entries</p>
        </div>
        <div className="bg-white rounded-xl border p-4">
          <p className="text-xs text-gray-500 mb-1">Group OD Total</p>
          <p className="text-2xl font-bold text-gray-600">{formatLakhs(stats.totalGroupOD)}</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Branch Performance */}
        {stats.branchData.length > 0 && (
          <div className="bg-white rounded-xl border p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Recovery by Branch</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={stats.branchData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" tickFormatter={v => formatLakhs(v)} tick={{ fontSize: 11 }} />
                <YAxis dataKey="branch" type="category" width={100} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatINR(v)} />
                <Legend />
                <Bar dataKey="recovered" name="Recovered" fill="#0f766e" radius={[0, 4, 4, 0]} cursor="pointer"
                  onClick={(data) => setDrillBranch(data.branch)} />
                <Bar dataKey="waiver" name="Waiver" fill="#f59e0b" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <p className="text-xs text-gray-400 mt-2 text-center">Click a branch bar to drill down</p>
          </div>
        )}

        {/* Monthly Trend */}
        {stats.monthData.length > 0 && (
          <div className="bg-white rounded-xl border p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Monthly Recovery Trend</h3>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={stats.monthData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tickFormatter={v => formatLakhs(v)} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => formatINR(v)} />
                <Legend />
                <Line type="monotone" dataKey="recovered" name="Recovered" stroke="#0f766e" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="waiver" name="Waiver" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Branch cards */}
      {stats.branchData.length > 0 && (
        <div>
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
    </div>
  );
}

// ─── Admin Panel ────────────────────────────────────────────────────────────
function AdminPanel({ users, setUsers, branches, setBranches, config, setConfig, entries, setEntries }) {
  const [tab, setTab] = useState("users");
  const [newUser, setNewUser] = useState({ username: "", password: "Dhanam@123", name: "", role: "staff", branch: "" });
  const [newBranch, setNewBranch] = useState("");
  const [showPassId, setShowPassId] = useState(null);
  const [editingBranch, setEditingBranch] = useState(null);
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
    if (!confirm("This will delete ALL entries. Are you sure?")) return;
    if (!confirm("This action cannot be undone. Proceed?")) return;
    setEntries([]); saveData(STORAGE_KEYS.entries, []);
  };

  // ── Bulk Upload Parsers ──
  const parseCSV = (text) => {
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
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
        // Parse date: accept dd-mm-yyyy, dd/mm/yyyy, or yyyy-mm-dd
        let rawDate = (r.Date || r.date || "").trim();
        if (rawDate.includes("/")) rawDate = rawDate.replace(/\//g, "-");
        if (/^\d{2}-\d{2}-\d{4}$/.test(rawDate)) {
          const [d, m, y] = rawDate.split("-");
          rawDate = `${y}-${m}-${d}`;
        }
        if (!rawDate) rawDate = nowDate();
        const odType = (r["OD Type"] || r.odType || "Group OD").trim();
        const selfOdAmountDue = Number(r["Self OD Amount Due"] || r.selfOdAmountDue || 0);
        const selfOdPaidAmount = Number(r["Self OD Paid"] || r.selfOdPaidAmount || 0);
        const selfOdWaiver = Math.max(0, selfOdAmountDue - selfOdPaidAmount);
        const groupOdAmount = Number(r["Group OD Amount Due"] || r["Group OD Amount"] || r.groupOdAmount || 0);
        const numberOfCustomers = Number(r["No. of Customers"] || r["No. of Customers in Group"] || r.numberOfCustomers || 1);
        const customerShare = numberOfCustomers > 0 ? Math.round(groupOdAmount / numberOfCustomers) : 0;
        const groupOdPaidAmount = Number(r["Group OD Paid"] || r.groupOdPaidAmount || 0);
        const groupOdWaiver = Math.max(0, customerShare - groupOdPaidAmount);
        const totalPaidAmount = (odType === "Self OD" ? selfOdPaidAmount : 0) + groupOdPaidAmount;
        const totalWaiver = (odType === "Self OD" ? selfOdWaiver : 0) + groupOdWaiver;
        const approvalSubject = (r["Approval Subject"] || r["Waiver Approval Subject"] || "").trim();

        newEntries.push({
          id: generateId(), date: rawDate, time: (r.Time || r.time || "00:00").trim(), branch,
          customerName, customerId, loanAccountNo, odType,
          selfOdAmountDue: odType === "Self OD" ? selfOdAmountDue : 0,
          selfOdPaidAmount: odType === "Self OD" ? selfOdPaidAmount : 0,
          selfOdWaiver: odType === "Self OD" ? selfOdWaiver : 0,
          groupOdAmount, numberOfCustomers, customerShare, groupOdPaidAmount, groupOdWaiver,
          totalPaidAmount, waiver: totalWaiver,
          waiverApproval: totalWaiver > 0 && approvalSubject ? { approverName: (r["Waiver Approver"] || "Bulk Upload").trim(), emailSubject: approvalSubject, approvalDate: rawDate } : null,
          enteredBy: "admin", enteredByName: "Bulk Upload",
        });
        added++;
      });
      const allEntries = [...newEntries, ...entries];
      setEntries(allEntries); saveData(STORAGE_KEYS.entries, allEntries);
      alert(`Imported ${added} entries. Total: ${allEntries.length}`);
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
          {/* Bulk Upload Entries */}
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-gray-800 mb-2 flex items-center gap-2"><Upload size={18} className="text-teal-600" /> Bulk Upload Entries (Historical Data)</h3>
            <p className="text-sm text-gray-500 mb-3">Upload a CSV file with columns: Date, Branch, Customer Name, Customer ID, Loan Account No., OD Type, Self OD Amount Due, Self OD Paid, Group OD Amount Due, No. of Customers, Group OD Paid, Time, Approval Subject, Waiver Approver</p>
            <p className="text-xs text-gray-400 mb-3">Date format: dd-mm-yyyy or yyyy-mm-dd. OD Type: "Self OD" or "Group OD". Waivers are auto-calculated.</p>
            <label className="inline-flex items-center gap-2 px-4 py-2 bg-teal-600 text-white rounded-lg text-sm hover:bg-teal-700 cursor-pointer transition-colors">
              <Upload size={14} /> Choose CSV File
              <input type="file" accept=".csv" onChange={handleBulkEntries} className="hidden" />
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
                const csv = "Date,Branch,Customer Name,Customer ID,Loan Account No.,OD Type,Self OD Amount Due,Self OD Paid,Group OD Amount Due,No. of Customers,Group OD Paid,Time,Approval Subject,Waiver Approver\n01-04-2025,Annur,Sample Customer,CUST001,LA001,Group OD,0,0,50000,5,8000,10:30,,";
                const blob = new Blob([csv], { type: "text/csv" });
                const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "entries-template.csv"; a.click();
              }} className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200 transition-colors flex items-center gap-1">
                <Download size={14} /> Entries Template
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

  useEffect(() => {
    const savedVersion = loadData(STORAGE_KEYS.version, 0);
    const needsMigration = savedVersion < APP_VERSION;

    if (needsMigration) {
      // Force re-seed users and branches on version bump
      saveData(STORAGE_KEYS.users, DEFAULT_USERS); setUsers(DEFAULT_USERS);
      saveData(STORAGE_KEYS.branches, DEFAULT_BRANCHES); setBranches(DEFAULT_BRANCHES);
      saveData(STORAGE_KEYS.version, APP_VERSION);
    } else {
      const savedUsers = loadData(STORAGE_KEYS.users, null);
      if (!savedUsers) { saveData(STORAGE_KEYS.users, DEFAULT_USERS); setUsers(DEFAULT_USERS); }
      else setUsers(savedUsers);

      const savedBranches = loadData(STORAGE_KEYS.branches, null);
      if (!savedBranches) { saveData(STORAGE_KEYS.branches, DEFAULT_BRANCHES); setBranches(DEFAULT_BRANCHES); }
      else setBranches(savedBranches);
    }

    setConfig(loadData(STORAGE_KEYS.config, DEFAULT_CONFIG));
    setEntries(loadData(STORAGE_KEYS.entries, []));
  }, []);

  const handleLogin = (u) => { setUser(u); setPage("dashboard"); };
  const handleLogout = () => { setUser(null); setPage("dashboard"); setSidebarOpen(false); };

  if (!user) return <LoginScreen onLogin={handleLogin} users={users} setUsers={setUsers} />;

  const isAdmin = user.role === "admin";
  const isElevated = user.role === "elevated_staff";

  const navItems = [
    { key: "dashboard", icon: LayoutDashboard, label: "Dashboard" },
    ...(!isElevated ? [{ key: "entry", icon: Plus, label: "New Entry" }] : []),
    { key: "records", icon: FileText, label: "Records" },
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
              <p className="text-xs text-gray-400">{user.role === "elevated_staff" ? "MIS Staff" : user.role} • {user.branch || "Unassigned"}</p>
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
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${page === item.key ? "bg-teal-50 text-teal-700" : "text-gray-600 hover:bg-gray-50"}`}>
                <item.icon size={18} /> {item.label}
              </button>
            ))}
          </nav>
        </aside>

        {/* Overlay */}
        {sidebarOpen && <div className="fixed inset-0 bg-black/30 z-20 lg:hidden" onClick={() => setSidebarOpen(false)} />}

        {/* Main content */}
        <main className="flex-1 p-4 lg:p-6 min-h-[calc(100vh-60px)]">
          {page === "dashboard" && <Dashboard user={user} entries={entries} branches={branches} config={config} />}
          {page === "entry" && <EntryForm user={user} branches={branches} entries={entries} setEntries={setEntries} setPage={setPage} />}
          {page === "records" && <RecordsTable user={user} entries={entries} setEntries={setEntries} config={config} branches={branches} />}
          {page === "admin" && user.role === "admin" && <AdminPanel users={users} setUsers={setUsers} branches={branches} setBranches={setBranches} config={config} setConfig={setConfig} entries={entries} setEntries={setEntries} />}
        </main>
      </div>
    </div>
  );
}
