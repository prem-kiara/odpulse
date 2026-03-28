import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line } from "recharts";
import { Plus, Trash2, LogOut, Settings, Users, GitBranch, LayoutDashboard, FileText, ChevronDown, ChevronRight, ArrowLeft, Search, Eye, EyeOff, Edit2, Save, X, AlertTriangle, CheckCircle, Database, Shield, UserPlus, ChevronUp, Download, Calendar, Tag } from "lucide-react";

// ─── Constants & Helpers ────────────────────────────────────────────────────
const COLORS = ["#0f766e", "#06b6d4", "#8b5cf6", "#f59e0b", "#ef4444", "#10b981", "#ec4899", "#6366f1", "#14b8a6", "#f97316"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const STORAGE_KEYS = { entries: "odpulse_entries", users: "odpulse_users", branches: "odpulse_branches", config: "odpulse_config" };
const STATUS_OPTIONS = [
  { value: "pending", label: "Pending", color: "bg-yellow-100 text-yellow-800" },
  { value: "partial", label: "Partial Recovery", color: "bg-blue-100 text-blue-800" },
  { value: "recovered", label: "Fully Recovered", color: "bg-green-100 text-green-800" },
];

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

const loadData = (key, fallback) => {
  try { const d = localStorage.getItem(key); return d ? JSON.parse(d) : fallback; }
  catch { return fallback; }
};
const saveData = (key, data) => localStorage.setItem(key, JSON.stringify(data));

const DEFAULT_BRANCHES = ["Head Office", "Branch 1", "Branch 2", "Branch 3", "Branch 4", "Branch 5"];
const DEFAULT_USERS = [
  { id: "admin", username: "admin", password: "admin123", role: "admin", name: "Administrator", branch: "Head Office", active: true },
  { id: "staff1", username: "staff1", password: "staff123", role: "staff", name: "Staff User 1", branch: "Branch 1", active: true },
];
const DEFAULT_CONFIG = { companyName: "OD Pulse - MFI Recovery Tracker", allowStaffEdit: false, allowStaffDelete: false, staffSeeAllBranches: false };

// ─── CSV Export Helper ──────────────────────────────────────────────────────
const exportToCSV = (entries, filename) => {
  const rows = [["Date", "Time", "Branch", "Group Name", "Group OD Amount", "Status", "Customer Name", "Customer ID", "Loan Account No.", "Customer Contribution", "Customer OD Amount", "Entered By"]];
  entries.forEach(e => {
    e.groupMembers.forEach((m, i) => {
      rows.push([
        i === 0 ? e.date : "", i === 0 ? e.time : "", i === 0 ? e.branch : "",
        i === 0 ? (e.groupName || "") : "", i === 0 ? e.groupOdAmount : "", i === 0 ? (e.status || "pending") : "",
        m.customerName, m.customerId, m.loanAccountNo, m.customerContribution || 0, m.customerOdAmount || 0,
        i === 0 ? (e.enteredByName || e.enteredBy) : ""
      ]);
    });
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
      <Calendar size={15} className="text-gray-400" />
      <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 outline-none" />
      <span className="text-gray-400 text-xs">to</span>
      <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-lg text-xs focus:ring-2 focus:ring-teal-500 outline-none" />
      <div className="flex gap-1 flex-wrap">
        {presets.map(p => (
          <button key={p.label} onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}
            className={`px-2 py-1 text-xs rounded-full border transition-colors ${dateFrom === p.from && dateTo === p.to ? "bg-teal-600 text-white border-teal-600" : "border-gray-300 text-gray-500 hover:border-teal-400 hover:text-teal-600"}`}>
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Status Badge ───────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const s = STATUS_OPTIONS.find(o => o.value === status) || STATUS_OPTIONS[0];
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.color}`}>{s.label}</span>;
}

// ─── Toast Notification ─────────────────────────────────────────────────────
function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
  const bg = type === "success" ? "bg-green-500" : type === "error" ? "bg-red-500" : "bg-blue-500";
  return (
    <div className={`fixed top-4 right-4 z-50 ${bg} text-white px-5 py-3 rounded-lg shadow-xl flex items-center gap-2`} style={{ animation: "fadeIn 0.3s ease" }}>
      {type === "success" ? <CheckCircle size={18} /> : type === "error" ? <AlertTriangle size={18} /> : <CheckCircle size={18} />}
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onClose} className="ml-2 hover:opacity-70"><X size={14} /></button>
    </div>
  );
}

// ─── Login Screen ────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, companyName }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = (e) => {
    e.preventDefault();
    const users = loadData(STORAGE_KEYS.users, DEFAULT_USERS);
    const user = users.find(u => u.username === username && u.password === password && u.active);
    if (user) { onLogin(user); setError(""); }
    else setError("Invalid username or password");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-700 via-teal-600 to-cyan-600 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="bg-teal-700 px-8 py-8 text-center">
          <div className="w-16 h-16 bg-white bg-opacity-20 rounded-full flex items-center justify-center mx-auto mb-4">
            <Shield size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">{companyName}</h1>
          <p className="text-teal-200 text-sm mt-1">Group OD Recovery Management</p>
        </div>
        <form onSubmit={handleLogin} className="px-8 py-8 space-y-5">
          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2 rounded-lg">{error}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none" placeholder="Enter username" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <div className="relative">
              <input type={showPw ? "text" : "password"} value={password} onChange={e => setPassword(e.target.value)} className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none pr-10" placeholder="Enter password" />
              <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          <button type="submit" className="w-full bg-teal-600 hover:bg-teal-700 text-white py-2.5 rounded-lg font-semibold transition-colors">Sign In</button>
        </form>
      </div>
    </div>
  );
}

// ─── Sidebar Navigation ─────────────────────────────────────────────────────
function Sidebar({ currentPage, setCurrentPage, user, onLogout }) {
  const isAdmin = user.role === "admin";
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "entry", label: "New Entry", icon: Plus },
    { id: "records", label: "All Records", icon: FileText },
    ...(isAdmin ? [
      { id: "admin-users", label: "Manage Users", icon: Users },
      { id: "admin-branches", label: "Manage Branches", icon: GitBranch },
      { id: "admin-config", label: "Settings", icon: Settings },
    ] : []),
  ];
  return (
    <div className="w-60 bg-teal-800 text-white flex flex-col min-h-screen shrink-0">
      <div className="px-5 py-5 border-b border-teal-700">
        <h2 className="text-lg font-bold">OD Pulse</h2>
        <p className="text-teal-300 text-xs mt-0.5">{user.name} ({user.role})</p>
        <p className="text-teal-400 text-xs">{user.branch}</p>
      </div>
      <nav className="flex-1 py-3">
        {navItems.map(item => (
          <button key={item.id} onClick={() => setCurrentPage(item.id)}
            className={`w-full flex items-center gap-3 px-5 py-2.5 text-sm transition-colors ${currentPage === item.id ? "bg-teal-700 text-white font-semibold" : "text-teal-200 hover:bg-teal-700 hover:text-white"}`}>
            <item.icon size={18} /> {item.label}
          </button>
        ))}
      </nav>
      <div className="border-t border-teal-700 p-4">
        <button onClick={onLogout} className="w-full flex items-center justify-center gap-2 text-teal-200 hover:text-white text-sm py-2 rounded-lg hover:bg-teal-700 transition-colors">
          <LogOut size={16} /> Sign Out
        </button>
      </div>
    </div>
  );
}

// ─── Duplicate Warning Modal ─────────────────────────────────────────────────
function DuplicateWarning({ duplicates, onProceed, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center">
            <AlertTriangle size={20} className="text-yellow-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-800">Possible Duplicate Detected</h3>
            <p className="text-sm text-gray-500">The following members may already exist in the system:</p>
          </div>
        </div>
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4 max-h-48 overflow-y-auto">
          {duplicates.map((d, i) => (
            <div key={i} className="text-sm text-yellow-800 py-1">
              <span className="font-medium">{d.memberName}</span> (ID: {d.memberId}, Loan: {d.loanNo}) — already in entry dated {d.existingDate} ({d.existingBranch})
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50">Go Back & Edit</button>
          <button onClick={onProceed} className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg text-sm font-medium">Save Anyway</button>
        </div>
      </div>
    </div>
  );
}

// ─── Data Entry Form ─────────────────────────────────────────────────────────
function EntryForm({ user, branches, onSave, editEntry, onCancelEdit, allEntries }) {
  const blankMember = () => ({ id: generateId(), customerName: "", customerId: "", loanAccountNo: "", customerContribution: "", customerOdAmount: "" });
  const blankForm = () => ({
    id: generateId(),
    date: nowDate(),
    time: nowTime(),
    branch: user.role === "staff" ? user.branch : branches[0] || "",
    groupName: "",
    groupOdAmount: "",
    status: "pending",
    groupMembers: [blankMember()],
    enteredBy: user.username,
    enteredByName: user.name,
  });

  const [form, setForm] = useState(editEntry || blankForm());
  const [expandedMembers, setExpandedMembers] = useState(new Set([form.groupMembers[0]?.id]));
  const [showDupWarning, setShowDupWarning] = useState(false);
  const [pendingDuplicates, setPendingDuplicates] = useState([]);

  useEffect(() => {
    if (editEntry) {
      setForm({ ...editEntry, status: editEntry.status || "pending" });
      setExpandedMembers(new Set(editEntry.groupMembers.map(m => m.id)));
    }
  }, [editEntry]);

  const updateForm = (key, val) => setForm(prev => ({ ...prev, [key]: val }));
  const updateMember = (idx, key, val) => {
    setForm(prev => {
      const members = [...prev.groupMembers];
      members[idx] = { ...members[idx], [key]: val };
      return { ...prev, groupMembers: members };
    });
  };
  const addMember = () => {
    const m = blankMember();
    setForm(prev => ({ ...prev, groupMembers: [...prev.groupMembers, m] }));
    setExpandedMembers(prev => new Set([...prev, m.id]));
  };
  const removeMember = (idx) => {
    if (form.groupMembers.length <= 1) return;
    setForm(prev => ({ ...prev, groupMembers: prev.groupMembers.filter((_, i) => i !== idx) }));
  };
  const toggleMember = (id) => {
    setExpandedMembers(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  // Duplicate detection
  const checkDuplicates = (formData) => {
    const dupes = [];
    const otherEntries = allEntries.filter(e => e.id !== formData.id);
    formData.groupMembers.forEach(m => {
      if (!m.customerId && !m.loanAccountNo) return;
      otherEntries.forEach(existing => {
        existing.groupMembers.forEach(em => {
          if ((m.customerId && m.customerId === em.customerId) || (m.loanAccountNo && m.loanAccountNo === em.loanAccountNo)) {
            dupes.push({
              memberName: m.customerName, memberId: m.customerId, loanNo: m.loanAccountNo,
              existingDate: existing.date, existingBranch: existing.branch
            });
          }
        });
      });
    });
    return dupes;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.branch || !form.groupOdAmount || form.groupMembers.some(m => !m.customerName || !m.customerId || !m.loanAccountNo)) {
      alert("Please fill in all required fields (Branch, Group OD Amount, and all member details: Name, ID, Loan Account No.)");
      return;
    }
    const dupes = checkDuplicates(form);
    if (dupes.length > 0) {
      setPendingDuplicates(dupes);
      setShowDupWarning(true);
      return;
    }
    doSave();
  };

  const doSave = () => {
    onSave({ ...form, updatedAt: new Date().toISOString() });
    if (!editEntry) { setForm(blankForm()); setExpandedMembers(new Set()); }
    setShowDupWarning(false);
  };

  return (
    <div className="max-w-4xl mx-auto">
      {showDupWarning && <DuplicateWarning duplicates={pendingDuplicates} onProceed={doSave} onCancel={() => setShowDupWarning(false)} />}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">{editEntry ? "Edit Entry" : "New Group OD Entry"}</h2>
          <p className="text-gray-500 text-sm mt-1">Enter group overdue recovery details</p>
        </div>
        {editEntry && (
          <button onClick={onCancelEdit} className="text-gray-500 hover:text-gray-700 flex items-center gap-1 text-sm"><X size={16} /> Cancel Edit</button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-700 mb-4">Group Information</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Date *</label>
              <input type="date" value={form.date} onChange={e => updateForm("date", e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Time *</label>
              <input type="time" value={form.time} onChange={e => updateForm("time", e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Branch *</label>
              <select value={form.branch} onChange={e => updateForm("branch", e.target.value)} disabled={user.role === "staff"} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-sm bg-white disabled:bg-gray-100">
                {branches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Group Name</label>
              <input type="text" value={form.groupName || ""} onChange={e => updateForm("groupName", e.target.value)} placeholder="e.g. Shakti SHG, Pragati Group" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Group OD Amount (Rs.) *</label>
              <input type="number" value={form.groupOdAmount} onChange={e => updateForm("groupOdAmount", e.target.value)} placeholder="0" min="0" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-1">Recovery Status</label>
              <select value={form.status} onChange={e => updateForm("status", e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-sm bg-white">
                {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Group Members */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-700">Group Members ({form.groupMembers.length})</h3>
            <button type="button" onClick={addMember} className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
              <UserPlus size={16} /> Add Person
            </button>
          </div>
          <div className="space-y-3">
            {form.groupMembers.map((member, idx) => (
              <div key={member.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between bg-gray-50 px-4 py-3 cursor-pointer" onClick={() => toggleMember(member.id)}>
                  <div className="flex items-center gap-2">
                    {expandedMembers.has(member.id) ? <ChevronDown size={16} className="text-gray-500" /> : <ChevronRight size={16} className="text-gray-500" />}
                    <span className="text-sm font-medium text-gray-700">
                      Person {idx + 1}{member.customerName ? ` — ${member.customerName}` : ""}
                    </span>
                    {member.customerId && <span className="text-xs text-gray-400 ml-2">ID: {member.customerId}</span>}
                  </div>
                  {form.groupMembers.length > 1 && (
                    <button type="button" onClick={(e) => { e.stopPropagation(); removeMember(idx); }} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
                  )}
                </div>
                {expandedMembers.has(member.id) && (
                  <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Customer Name *</label>
                      <input type="text" value={member.customerName} onChange={e => updateMember(idx, "customerName", e.target.value)} placeholder="Full name" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Customer ID *</label>
                      <input type="text" value={member.customerId} onChange={e => updateMember(idx, "customerId", e.target.value)} placeholder="e.g. CUS001" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Loan Account No. *</label>
                      <input type="text" value={member.loanAccountNo} onChange={e => updateMember(idx, "loanAccountNo", e.target.value)} placeholder="e.g. LA0001" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Customer Contribution (Rs.)</label>
                      <input type="number" value={member.customerContribution} onChange={e => updateMember(idx, "customerContribution", e.target.value)} placeholder="0" min="0" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-sm" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Customer OD Amount (Rs.)</label>
                      <input type="number" value={member.customerOdAmount} onChange={e => updateMember(idx, "customerOdAmount", e.target.value)} placeholder="0" min="0" className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-sm" />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3">
          {editEntry && <button type="button" onClick={onCancelEdit} className="px-6 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium">Cancel</button>}
          <button type="submit" className="px-8 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-semibold transition-colors shadow-sm">
            {editEntry ? "Update Entry" : "Save Entry"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Records Table ───────────────────────────────────────────────────────────
function RecordsTable({ entries, user, config, onEdit, onDelete, branches }) {
  const [search, setSearch] = useState("");
  const [filterBranch, setFilterBranch] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [expanded, setExpanded] = useState(new Set());

  const canEdit = user.role === "admin" || config.allowStaffEdit;
  const canDelete = user.role === "admin" || config.allowStaffDelete;

  const filtered = useMemo(() => {
    let data = [...entries];
    if (filterBranch !== "All") data = data.filter(e => e.branch === filterBranch);
    if (filterStatus !== "All") data = data.filter(e => (e.status || "pending") === filterStatus);
    if (dateFrom) data = data.filter(e => e.date >= dateFrom);
    if (dateTo) data = data.filter(e => e.date <= dateTo);
    if (search) {
      const s = search.toLowerCase();
      data = data.filter(e =>
        e.branch.toLowerCase().includes(s) || (e.groupName || "").toLowerCase().includes(s) ||
        e.groupMembers.some(m => m.customerName.toLowerCase().includes(s) || m.customerId.toLowerCase().includes(s) || m.loanAccountNo.toLowerCase().includes(s))
      );
    }
    data.sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (sortKey === "groupOdAmount") { va = Number(va); vb = Number(vb); }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return data;
  }, [entries, filterBranch, filterStatus, dateFrom, dateTo, search, sortKey, sortDir]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  };
  const SortIcon = ({ col }) => sortKey === col ? (sortDir === "asc" ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : null;
  const totalRecovered = filtered.reduce((s, e) => s + Number(e.groupOdAmount || 0), 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-800">All Records</h2>
          <p className="text-gray-500 text-sm mt-1">{filtered.length} entries — Total: {formatINR(totalRecovered)}</p>
        </div>
        <button onClick={() => exportToCSV(filtered, `od-records-${nowDate()}.csv`)} className="flex items-center gap-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          <Download size={15} /> Export CSV
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-4 border-b border-gray-100 space-y-3">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-48">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, ID, group name, account no..." className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none" />
            </div>
            <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-teal-500">
              <option value="All">All Branches</option>
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-teal-500">
              <option value="All">All Status</option>
              {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} setDateFrom={setDateFrom} setDateTo={setDateTo} />
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600">
              <tr>
                <th className="px-4 py-3 text-left w-8"></th>
                <th className="px-4 py-3 text-left cursor-pointer hover:text-teal-700" onClick={() => toggleSort("date")}><span className="flex items-center gap-1">Date <SortIcon col="date" /></span></th>
                <th className="px-4 py-3 text-left cursor-pointer hover:text-teal-700" onClick={() => toggleSort("branch")}><span className="flex items-center gap-1">Branch <SortIcon col="branch" /></span></th>
                <th className="px-4 py-3 text-left">Group Name</th>
                <th className="px-4 py-3 text-right cursor-pointer hover:text-teal-700" onClick={() => toggleSort("groupOdAmount")}><span className="flex items-center justify-end gap-1">Group OD Amt <SortIcon col="groupOdAmount" /></span></th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Members</th>
                <th className="px-4 py-3 text-left">Entered By</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 && <tr><td colSpan="9" className="px-4 py-12 text-center text-gray-400">No records found</td></tr>}
              {filtered.map((entry) => (
                <React.Fragment key={entry.id}>
                  <tr className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3">
                      <button onClick={() => setExpanded(prev => { const s = new Set(prev); s.has(entry.id) ? s.delete(entry.id) : s.add(entry.id); return s; })} className="text-gray-400 hover:text-gray-700">
                        {expanded.has(entry.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                      </button>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800">{entry.date}<br/><span className="text-xs text-gray-400">{entry.time}</span></td>
                    <td className="px-4 py-3"><span className="bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full text-xs font-medium">{entry.branch}</span></td>
                    <td className="px-4 py-3 text-gray-600 text-sm">{entry.groupName || <span className="text-gray-300 italic">—</span>}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-800">{formatINR(entry.groupOdAmount)}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={entry.status || "pending"} /></td>
                    <td className="px-4 py-3 text-center text-gray-600">{entry.groupMembers.length}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{entry.enteredByName || entry.enteredBy}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        {canEdit && <button onClick={() => onEdit(entry)} className="text-blue-500 hover:text-blue-700 p-1" title="Edit"><Edit2 size={14} /></button>}
                        {canDelete && <button onClick={() => { if (confirm("Delete this entry?")) onDelete(entry.id); }} className="text-red-400 hover:text-red-600 p-1" title="Delete"><Trash2 size={14} /></button>}
                      </div>
                    </td>
                  </tr>
                  {expanded.has(entry.id) && (
                    <tr key={entry.id + "_detail"}>
                      <td colSpan="9" className="bg-gray-50 px-8 py-4">
                        <table className="w-full text-xs">
                          <thead className="text-gray-500"><tr><th className="text-left pb-2">Customer Name</th><th className="text-left pb-2">Customer ID</th><th className="text-left pb-2">Loan Account No.</th><th className="text-right pb-2">Contribution</th><th className="text-right pb-2">OD Amount</th></tr></thead>
                          <tbody className="divide-y divide-gray-200">
                            {entry.groupMembers.map(m => (
                              <tr key={m.id}><td className="py-1.5 font-medium text-gray-700">{m.customerName}</td><td className="py-1.5 text-gray-500">{m.customerId}</td><td className="py-1.5 text-gray-500">{m.loanAccountNo}</td><td className="py-1.5 text-right text-gray-600">{formatINR(m.customerContribution || 0)}</td><td className="py-1.5 text-right text-gray-600">{formatINR(m.customerOdAmount || 0)}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ──────────────────────────────────────────────────────────────
function Dashboard({ entries, branches }) {
  const [drillView, setDrillView] = useState(null);
  const [selectedBranch, setSelectedBranch] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState("desc");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Date-filtered entries used everywhere in dashboard
  const dateFiltered = useMemo(() => {
    let data = entries;
    if (dateFrom) data = data.filter(e => e.date >= dateFrom);
    if (dateTo) data = data.filter(e => e.date <= dateTo);
    return data;
  }, [entries, dateFrom, dateTo]);

  const totalRecovered = dateFiltered.reduce((s, e) => s + Number(e.groupOdAmount || 0), 0);
  const totalMembers = dateFiltered.reduce((s, e) => s + e.groupMembers.length, 0);
  const statusCounts = useMemo(() => {
    const counts = { pending: 0, partial: 0, recovered: 0 };
    dateFiltered.forEach(e => { counts[e.status || "pending"] = (counts[e.status || "pending"] || 0) + 1; });
    return counts;
  }, [dateFiltered]);

  const byBranch = useMemo(() => {
    const map = {};
    branches.forEach(b => { map[b] = 0; });
    dateFiltered.forEach(e => { map[e.branch] = (map[e.branch] || 0) + Number(e.groupOdAmount || 0); });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [dateFiltered, branches]);

  const byMonth = useMemo(() => {
    const map = {};
    dateFiltered.forEach(e => {
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      map[key] = map[key] || { key, label, value: 0 };
      map[key].value += Number(e.groupOdAmount || 0);
    });
    return Object.values(map).sort((a, b) => a.key.localeCompare(b.key));
  }, [dateFiltered]);

  const branchMonthly = useMemo(() => {
    if (!selectedBranch) return [];
    const map = {};
    dateFiltered.filter(e => e.branch === selectedBranch).forEach(e => {
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      map[key] = map[key] || { key, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, value: 0 };
      map[key].value += Number(e.groupOdAmount || 0);
    });
    return Object.values(map).sort((a, b) => a.key.localeCompare(b.key));
  }, [dateFiltered, selectedBranch]);

  const monthBranch = useMemo(() => {
    if (!selectedMonth) return [];
    const map = {};
    dateFiltered.filter(e => { const d = new Date(e.date); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}` === selectedMonth; })
      .forEach(e => { map[e.branch] = (map[e.branch] || 0) + Number(e.groupOdAmount || 0); });
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [dateFiltered, selectedMonth]);

  const filteredEntries = useMemo(() => {
    let data = [...dateFiltered];
    if (search) {
      const s = search.toLowerCase();
      data = data.filter(e => e.branch.toLowerCase().includes(s) || (e.groupName || "").toLowerCase().includes(s) || e.groupMembers.some(m => m.customerName.toLowerCase().includes(s) || m.customerId.toLowerCase().includes(s)));
    }
    data.sort((a, b) => { let va = a[sortKey], vb = b[sortKey]; if (sortKey === "groupOdAmount") { va = Number(va); vb = Number(vb); } return sortDir === "asc" ? (va < vb ? -1 : 1) : (va > vb ? -1 : 1); });
    return data;
  }, [dateFiltered, search, sortKey, sortDir]);

  const toggleSort = (key) => { if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir("asc"); } };

  const goBack = () => {
    if (selectedBranch) setSelectedBranch(null);
    else if (selectedMonth) setSelectedMonth(null);
    else { setDrillView(null); setSearch(""); }
  };

  // ── Summary View ──
  if (!drillView) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-800">Dashboard</h2>
          <button onClick={() => exportToCSV(dateFiltered, `od-dashboard-${nowDate()}.csv`)} className="flex items-center gap-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium">
            <Download size={14} /> Export CSV
          </button>
        </div>

        {/* Date Range */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
          <DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} setDateFrom={setDateFrom} setDateTo={setDateTo} />
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <button onClick={() => setDrillView("total")} className="text-left bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-teal-300 transition-all group">
            <p className="text-xs text-gray-500 mb-1">Total Group OD Recovered</p>
            <p className="text-2xl font-bold text-teal-700 group-hover:text-teal-600">{formatLakhs(totalRecovered)}</p>
            <p className="text-xs text-gray-400 mt-1">{dateFiltered.length} entries — Click for details</p>
          </button>
          <button onClick={() => setDrillView("byBranch")} className="text-left bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-cyan-300 transition-all group">
            <p className="text-xs text-gray-500 mb-1">Recovery by Branch</p>
            <p className="text-2xl font-bold text-cyan-700 group-hover:text-cyan-600">{byBranch.filter(b => b.value > 0).length} branches</p>
            <p className="text-xs text-gray-400 mt-1">of {branches.length} total — Click for branch-wise</p>
          </button>
          <button onClick={() => setDrillView("byMonth")} className="text-left bg-white rounded-xl shadow-sm border border-gray-200 p-5 hover:shadow-md hover:border-purple-300 transition-all group">
            <p className="text-xs text-gray-500 mb-1">Recovery by Month</p>
            <p className="text-2xl font-bold text-purple-700 group-hover:text-purple-600">{byMonth.length} months</p>
            <p className="text-xs text-gray-400 mt-1">{totalMembers} total members — Click for monthly</p>
          </button>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5">
            <p className="text-xs text-gray-500 mb-2">Recovery Status</p>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs"><span className="text-yellow-700">Pending</span><span className="font-bold">{statusCounts.pending}</span></div>
              <div className="flex justify-between text-xs"><span className="text-blue-700">Partial</span><span className="font-bold">{statusCounts.partial}</span></div>
              <div className="flex justify-between text-xs"><span className="text-green-700">Recovered</span><span className="font-bold">{statusCounts.recovered}</span></div>
            </div>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-base font-semibold text-gray-700 mb-4">Recovery by Branch</h3>
            {byBranch.some(b => b.value > 0) ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={byBranch} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tickFormatter={v => formatLakhs(v)} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={v => formatINR(v)} />
                  <Bar dataKey="value" fill="#0f766e" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : <p className="text-gray-400 text-center py-12 text-sm">No data yet</p>}
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-base font-semibold text-gray-700 mb-4">Monthly Recovery Trend</h3>
            {byMonth.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={byMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={v => formatLakhs(v)} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={v => formatINR(v)} />
                  <Line type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: "#8b5cf6", r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            ) : <p className="text-gray-400 text-center py-12 text-sm">No data yet</p>}
          </div>
        </div>

        {byBranch.filter(b => b.value > 0).length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-base font-semibold text-gray-700 mb-4">Branch-wise Distribution</h3>
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={byBranch.filter(b => b.value > 0)} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={95} label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}>
                  {byBranch.filter(b => b.value > 0).map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={v => formatINR(v)} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    );
  }

  // ── Drill-down: Total → All Details ──
  if (drillView === "total") {
    return (
      <div>
        <button onClick={goBack} className="flex items-center gap-1 text-teal-600 hover:text-teal-800 mb-4 text-sm font-medium"><ArrowLeft size={16} /> Back to Dashboard</button>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-2xl font-bold text-gray-800">Total Group OD Recovered</h2>
            <p className="text-gray-500 text-sm">Total: {formatINR(totalRecovered)} — {filteredEntries.length} records</p>
          </div>
          <button onClick={() => exportToCSV(filteredEntries, `od-total-detail-${nowDate()}.csv`)} className="flex items-center gap-1.5 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium"><Download size={14} /> Export</button>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-4 border-b border-gray-100">
            <div className="relative max-w-md">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, ID, branch, group name..." className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 outline-none" />
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th className="px-4 py-3 text-left cursor-pointer" onClick={() => toggleSort("date")}>Date {sortKey === "date" ? (sortDir === "asc" ? "↑" : "↓") : ""}</th>
                  <th className="px-4 py-3 text-left cursor-pointer" onClick={() => toggleSort("branch")}>Branch {sortKey === "branch" ? (sortDir === "asc" ? "↑" : "↓") : ""}</th>
                  <th className="px-4 py-3 text-left">Group Name</th>
                  <th className="px-4 py-3 text-right cursor-pointer" onClick={() => toggleSort("groupOdAmount")}>Group OD Amt {sortKey === "groupOdAmount" ? (sortDir === "asc" ? "↑" : "↓") : ""}</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Members</th>
                  <th className="px-4 py-3 text-left">Customer Names</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredEntries.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{e.date}<br/><span className="text-xs text-gray-400">{e.time}</span></td>
                    <td className="px-4 py-3"><span className="bg-teal-50 text-teal-700 px-2 py-0.5 rounded-full text-xs font-medium">{e.branch}</span></td>
                    <td className="px-4 py-3 text-gray-600">{e.groupName || "—"}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatINR(e.groupOdAmount)}</td>
                    <td className="px-4 py-3 text-center"><StatusBadge status={e.status || "pending"} /></td>
                    <td className="px-4 py-3 text-center">{e.groupMembers.length}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{e.groupMembers.map(m => m.customerName).join(", ")}</td>
                  </tr>
                ))}
                {filteredEntries.length === 0 && <tr><td colSpan="7" className="px-4 py-12 text-center text-gray-400">No records found</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ── Drill-down: By Branch ──
  if (drillView === "byBranch") {
    if (selectedBranch) {
      return (
        <div>
          <button onClick={goBack} className="flex items-center gap-1 text-teal-600 hover:text-teal-800 mb-4 text-sm font-medium"><ArrowLeft size={16} /> Back to Branch List</button>
          <h2 className="text-2xl font-bold text-gray-800 mb-1">{selectedBranch} — Monthly Split</h2>
          <p className="text-gray-500 text-sm mb-5">Total: {formatINR(byBranch.find(b => b.name === selectedBranch)?.value || 0)}</p>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={branchMonthly}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tickFormatter={v => formatLakhs(v)} tick={{ fontSize: 11 }} /><Tooltip formatter={v => formatINR(v)} /><Bar dataKey="value" fill="#0f766e" radius={[4, 4, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-sm"><thead className="bg-gray-50 text-gray-600"><tr><th className="px-4 py-3 text-left">Month</th><th className="px-4 py-3 text-right">Amount Recovered</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {branchMonthly.map(m => <tr key={m.key} className="hover:bg-gray-50"><td className="px-4 py-3 font-medium">{m.label}</td><td className="px-4 py-3 text-right font-semibold">{formatINR(m.value)}</td></tr>)}
                <tr className="bg-teal-50 font-bold"><td className="px-4 py-3">Total</td><td className="px-4 py-3 text-right">{formatINR(branchMonthly.reduce((s, m) => s + m.value, 0))}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    return (
      <div>
        <button onClick={goBack} className="flex items-center gap-1 text-teal-600 hover:text-teal-800 mb-4 text-sm font-medium"><ArrowLeft size={16} /> Back to Dashboard</button>
        <h2 className="text-2xl font-bold text-gray-800 mb-1">Group OD Recovered by Branch</h2>
        <p className="text-gray-500 text-sm mb-5">Click a branch to see monthly split</p>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byBranch} layout="vertical" margin={{ left: 10 }}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis type="number" tickFormatter={v => formatLakhs(v)} tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11 }} /><Tooltip formatter={v => formatINR(v)} /><Bar dataKey="value" fill="#0f766e" radius={[0, 4, 4, 0]} cursor="pointer" onClick={(data) => setSelectedBranch(data.name)} /></BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm"><thead className="bg-gray-50 text-gray-600"><tr><th className="px-4 py-3 text-left">Branch</th><th className="px-4 py-3 text-right">Amount Recovered</th><th className="px-4 py-3 text-center">Entries</th><th className="px-4 py-3 w-8"></th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {byBranch.map(b => (
                <tr key={b.name} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedBranch(b.name)}>
                  <td className="px-4 py-3 font-medium text-teal-700">{b.name}</td><td className="px-4 py-3 text-right font-semibold">{formatINR(b.value)}</td><td className="px-4 py-3 text-center text-gray-500">{dateFiltered.filter(e => e.branch === b.name).length}</td><td className="px-4 py-3"><ChevronRight size={16} className="text-gray-400" /></td>
                </tr>
              ))}
              <tr className="bg-teal-50 font-bold"><td className="px-4 py-3">Total</td><td className="px-4 py-3 text-right">{formatINR(totalRecovered)}</td><td className="px-4 py-3 text-center">{dateFiltered.length}</td><td></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Drill-down: By Month ──
  if (drillView === "byMonth") {
    if (selectedMonth) {
      const monthLabel = byMonth.find(m => m.key === selectedMonth)?.label || selectedMonth;
      return (
        <div>
          <button onClick={goBack} className="flex items-center gap-1 text-teal-600 hover:text-teal-800 mb-4 text-sm font-medium"><ArrowLeft size={16} /> Back to Month List</button>
          <h2 className="text-2xl font-bold text-gray-800 mb-1">{monthLabel} — Branch-wise Split</h2>
          <p className="text-gray-500 text-sm mb-5">Total: {formatINR(byMonth.find(m => m.key === selectedMonth)?.value || 0)}</p>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthBranch}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="name" tick={{ fontSize: 11 }} /><YAxis tickFormatter={v => formatLakhs(v)} tick={{ fontSize: 11 }} /><Tooltip formatter={v => formatINR(v)} /><Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-sm"><thead className="bg-gray-50 text-gray-600"><tr><th className="px-4 py-3 text-left">Branch</th><th className="px-4 py-3 text-right">Amount Recovered</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {monthBranch.map(b => <tr key={b.name} className="hover:bg-gray-50"><td className="px-4 py-3 font-medium">{b.name}</td><td className="px-4 py-3 text-right font-semibold">{formatINR(b.value)}</td></tr>)}
                <tr className="bg-purple-50 font-bold"><td className="px-4 py-3">Total</td><td className="px-4 py-3 text-right">{formatINR(monthBranch.reduce((s, b) => s + b.value, 0))}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    return (
      <div>
        <button onClick={goBack} className="flex items-center gap-1 text-teal-600 hover:text-teal-800 mb-4 text-sm font-medium"><ArrowLeft size={16} /> Back to Dashboard</button>
        <h2 className="text-2xl font-bold text-gray-800 mb-1">Group OD Recovered by Month</h2>
        <p className="text-gray-500 text-sm mb-5">Click a month to see branch-wise split</p>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byMonth}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tickFormatter={v => formatLakhs(v)} tick={{ fontSize: 11 }} /><Tooltip formatter={v => formatINR(v)} /><Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} cursor="pointer" onClick={(data) => setSelectedMonth(data.key)} /></BarChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm"><thead className="bg-gray-50 text-gray-600"><tr><th className="px-4 py-3 text-left">Month</th><th className="px-4 py-3 text-right">Amount Recovered</th><th className="px-4 py-3 text-center">Entries</th><th className="px-4 py-3 w-8"></th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {byMonth.map(m => (
                <tr key={m.key} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedMonth(m.key)}>
                  <td className="px-4 py-3 font-medium text-purple-700">{m.label}</td><td className="px-4 py-3 text-right font-semibold">{formatINR(m.value)}</td>
                  <td className="px-4 py-3 text-center text-gray-500">{dateFiltered.filter(e => { const d = new Date(e.date); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}` === m.key; }).length}</td>
                  <td className="px-4 py-3"><ChevronRight size={16} className="text-gray-400" /></td>
                </tr>
              ))}
              <tr className="bg-purple-50 font-bold"><td className="px-4 py-3">Total</td><td className="px-4 py-3 text-right">{formatINR(totalRecovered)}</td><td className="px-4 py-3 text-center">{dateFiltered.length}</td><td></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  return null;
}

// ─── Admin: Manage Users ─────────────────────────────────────────────────────
function AdminUsers({ users, setUsers, branches }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ username: "", password: "", name: "", role: "staff", branch: branches[0] || "", active: true });

  const startAdd = () => { setEditing("new"); setForm({ username: "", password: "", name: "", role: "staff", branch: branches[0] || "", active: true }); };
  const startEdit = (u) => { setEditing(u.id); setForm({ ...u }); };
  const handleSave = () => {
    if (!form.username || !form.password || !form.name) { alert("Fill all fields"); return; }
    if (editing === "new") {
      if (users.some(u => u.username === form.username)) { alert("Username already exists"); return; }
      setUsers([...users, { ...form, id: generateId() }]);
    } else { setUsers(users.map(u => u.id === editing ? { ...u, ...form } : u)); }
    setEditing(null);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-800">Manage Users</h2>
        <button onClick={startAdd} className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium"><UserPlus size={16} /> Add User</button>
      </div>
      {editing && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="text-lg font-semibold text-gray-700 mb-4">{editing === "new" ? "Add New User" : "Edit User"}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-gray-600 mb-1">Name</label><input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 outline-none" /></div>
            <div><label className="block text-sm font-medium text-gray-600 mb-1">Username</label><input type="text" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} disabled={editing !== "new"} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 outline-none disabled:bg-gray-100" /></div>
            <div><label className="block text-sm font-medium text-gray-600 mb-1">Password</label><input type="text" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 outline-none" /></div>
            <div><label className="block text-sm font-medium text-gray-600 mb-1">Role</label><select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-teal-500"><option value="staff">Staff</option><option value="admin">Admin</option></select></div>
            <div><label className="block text-sm font-medium text-gray-600 mb-1">Branch</label><select value={form.branch} onChange={e => setForm({ ...form, branch: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-teal-500">{branches.map(b => <option key={b} value={b}>{b}</option>)}</select></div>
            <div className="flex items-end"><label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={form.active} onChange={e => setForm({ ...form, active: e.target.checked })} className="rounded border-gray-300 text-teal-600 focus:ring-teal-500" /><span className="text-sm text-gray-700">Active</span></label></div>
          </div>
          <div className="flex justify-end gap-3 mt-5">
            <button onClick={() => setEditing(null)} className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50">Cancel</button>
            <button onClick={handleSave} className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-medium">Save</button>
          </div>
        </div>
      )}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-600"><tr><th className="px-4 py-3 text-left">Name</th><th className="px-4 py-3 text-left">Username</th><th className="px-4 py-3 text-left">Role</th><th className="px-4 py-3 text-left">Branch</th><th className="px-4 py-3 text-center">Status</th><th className="px-4 py-3 text-center">Actions</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{u.name}</td><td className="px-4 py-3 text-gray-500">{u.username}</td>
                <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${u.role === "admin" ? "bg-purple-50 text-purple-700" : "bg-blue-50 text-blue-700"}`}>{u.role}</span></td>
                <td className="px-4 py-3 text-gray-600">{u.branch}</td>
                <td className="px-4 py-3 text-center"><span className={`px-2 py-0.5 rounded-full text-xs ${u.active ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{u.active ? "Active" : "Inactive"}</span></td>
                <td className="px-4 py-3 text-center"><button onClick={() => startEdit(u)} className="text-blue-500 hover:text-blue-700 p-1"><Edit2 size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Admin: Manage Branches ──────────────────────────────────────────────────
function AdminBranches({ branches, setBranches }) {
  const [newBranch, setNewBranch] = useState("");
  const [editIdx, setEditIdx] = useState(-1);
  const [editVal, setEditVal] = useState("");

  const addBranch = () => {
    if (!newBranch.trim()) return;
    if (branches.includes(newBranch.trim())) { alert("Branch already exists"); return; }
    setBranches([...branches, newBranch.trim()]); setNewBranch("");
  };
  const saveBranchEdit = (idx) => { if (!editVal.trim()) return; const u = [...branches]; u[idx] = editVal.trim(); setBranches(u); setEditIdx(-1); };
  const removeBranch = (idx) => { if (branches.length <= 1) { alert("Must have at least one branch"); return; } if (confirm(`Remove "${branches[idx]}"?`)) setBranches(branches.filter((_, i) => i !== idx)); };

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Manage Branches</h2>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex gap-3">
          <input type="text" value={newBranch} onChange={e => setNewBranch(e.target.value)} onKeyDown={e => e.key === "Enter" && addBranch()} placeholder="New branch name..." className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 outline-none" />
          <button onClick={addBranch} className="flex items-center gap-1.5 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium"><Plus size={16} /> Add</button>
        </div>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm"><thead className="bg-gray-50 text-gray-600"><tr><th className="px-4 py-3 text-left">#</th><th className="px-4 py-3 text-left">Branch Name</th><th className="px-4 py-3 text-center">Actions</th></tr></thead>
          <tbody className="divide-y divide-gray-100">
            {branches.map((b, i) => (
              <tr key={i} className="hover:bg-gray-50">
                <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                <td className="px-4 py-3">{editIdx === i ? <input type="text" value={editVal} onChange={e => setEditVal(e.target.value)} onKeyDown={e => e.key === "Enter" && saveBranchEdit(i)} className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-teal-500 outline-none" autoFocus /> : <span className="font-medium">{b}</span>}</td>
                <td className="px-4 py-3 text-center">
                  {editIdx === i ? (
                    <div className="flex items-center justify-center gap-1"><button onClick={() => saveBranchEdit(i)} className="text-green-600 hover:text-green-800 p-1"><Save size={14} /></button><button onClick={() => setEditIdx(-1)} className="text-gray-400 hover:text-gray-600 p-1"><X size={14} /></button></div>
                  ) : (
                    <div className="flex items-center justify-center gap-1"><button onClick={() => { setEditIdx(i); setEditVal(b); }} className="text-blue-500 hover:text-blue-700 p-1"><Edit2 size={14} /></button><button onClick={() => removeBranch(i)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={14} /></button></div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Admin: Settings ─────────────────────────────────────────────────────────
function AdminConfig({ config, setConfig, onResetDB }) {
  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-6">Settings</h2>
      <div className="space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-700 mb-4">General</h3>
          <div><label className="block text-sm font-medium text-gray-600 mb-1">Company / App Name</label><input type="text" value={config.companyName} onChange={e => setConfig({ ...config, companyName: e.target.value })} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-teal-500 outline-none" /></div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h3 className="text-lg font-semibold text-gray-700 mb-4">Staff Permissions</h3>
          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={config.allowStaffEdit} onChange={e => setConfig({ ...config, allowStaffEdit: e.target.checked })} className="rounded border-gray-300 text-teal-600 focus:ring-teal-500" /><span className="text-sm text-gray-700">Allow staff to edit their own entries</span></label>
            <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={config.allowStaffDelete} onChange={e => setConfig({ ...config, allowStaffDelete: e.target.checked })} className="rounded border-gray-300 text-teal-600 focus:ring-teal-500" /><span className="text-sm text-gray-700">Allow staff to delete their own entries</span></label>
            <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={config.staffSeeAllBranches || false} onChange={e => setConfig({ ...config, staffSeeAllBranches: e.target.checked })} className="rounded border-gray-300 text-teal-600 focus:ring-teal-500" /><span className="text-sm text-gray-700">Allow staff to see all branch data (if off, staff sees only their branch)</span></label>
          </div>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-red-200 p-6">
          <h3 className="text-lg font-semibold text-red-700 mb-2">Danger Zone</h3>
          <p className="text-sm text-gray-500 mb-4">Reset all data to defaults. This will delete all entries, users, and branches.</p>
          <button onClick={() => { if (confirm("Are you sure? This will DELETE ALL DATA and reset everything to defaults.")) onResetDB(); }}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition-colors"><Database size={16} /> Reset Database</button>
        </div>
      </div>
    </div>
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [currentPage, setCurrentPage] = useState("dashboard");
  const [entries, setEntries] = useState(() => loadData(STORAGE_KEYS.entries, []));
  const [users, setUsers] = useState(() => loadData(STORAGE_KEYS.users, DEFAULT_USERS));
  const [branches, setBranches] = useState(() => loadData(STORAGE_KEYS.branches, DEFAULT_BRANCHES));
  const [config, setConfig] = useState(() => loadData(STORAGE_KEYS.config, DEFAULT_CONFIG));
  const [editEntry, setEditEntry] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => saveData(STORAGE_KEYS.entries, entries), [entries]);
  useEffect(() => saveData(STORAGE_KEYS.users, users), [users]);
  useEffect(() => saveData(STORAGE_KEYS.branches, branches), [branches]);
  useEffect(() => saveData(STORAGE_KEYS.config, config), [config]);

  const showToast = (message, type = "success") => setToast({ message, type });

  // Staff data isolation: filter entries by branch if staff + setting is off
  const visibleEntries = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === "admin") return entries;
    if (config.staffSeeAllBranches) return entries;
    return entries.filter(e => e.branch === currentUser.branch);
  }, [entries, currentUser, config.staffSeeAllBranches]);

  const handleSaveEntry = (entry) => {
    if (entries.some(e => e.id === entry.id)) {
      setEntries(prev => prev.map(e => e.id === entry.id ? entry : e));
      showToast("Entry updated successfully");
    } else {
      setEntries(prev => [...prev, entry]);
      showToast("Entry saved successfully");
    }
    setEditEntry(null);
    setCurrentPage("records");
  };

  const handleDeleteEntry = (id) => { setEntries(prev => prev.filter(e => e.id !== id)); showToast("Entry deleted", "info"); };
  const handleEdit = (entry) => { setEditEntry(entry); setCurrentPage("entry"); };
  const handleResetDB = () => { setEntries([]); setUsers(DEFAULT_USERS); setBranches(DEFAULT_BRANCHES); setConfig(DEFAULT_CONFIG); showToast("Database reset to defaults", "info"); };
  const handleLogout = () => { setCurrentUser(null); setCurrentPage("dashboard"); setEditEntry(null); };

  useEffect(() => { try { const s = sessionStorage.getItem("odpulse_session"); if (s) setCurrentUser(JSON.parse(s)); } catch {} }, []);
  useEffect(() => { if (currentUser) sessionStorage.setItem("odpulse_session", JSON.stringify(currentUser)); else sessionStorage.removeItem("odpulse_session"); }, [currentUser]);

  if (!currentUser) return (<><LoginScreen onLogin={setCurrentUser} companyName={config.companyName} />{toast && <Toast {...toast} onClose={() => setToast(null)} />}</>);

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar currentPage={currentPage} setCurrentPage={(p) => { setCurrentPage(p); setEditEntry(null); }} user={currentUser} onLogout={handleLogout} />
      <main className="flex-1 p-8 overflow-auto">
        {currentPage === "dashboard" && <Dashboard entries={visibleEntries} branches={branches} />}
        {currentPage === "entry" && <EntryForm user={currentUser} branches={branches} onSave={handleSaveEntry} editEntry={editEntry} onCancelEdit={() => { setEditEntry(null); setCurrentPage("records"); }} allEntries={entries} />}
        {currentPage === "records" && <RecordsTable entries={visibleEntries} user={currentUser} config={config} onEdit={handleEdit} onDelete={handleDeleteEntry} branches={branches} />}
        {currentPage === "admin-users" && <AdminUsers users={users} setUsers={setUsers} branches={branches} />}
        {currentPage === "admin-branches" && <AdminBranches branches={branches} setBranches={setBranches} />}
        {currentPage === "admin-config" && <AdminConfig config={config} setConfig={setConfig} onResetDB={handleResetDB} />}
      </main>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}
