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

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line,
} from "recharts";
import {
  Activity, Calendar, Download, FileText, FileSpreadsheet, FileDown,
  TrendingUp, Wallet, Receipt, Users, Filter, Info, Search,
  ChevronUp, ChevronDown, RefreshCw, Building2, Package,
} from "lucide-react";
import { usePagination, PaginationBar } from "./Pagination";
import FilterSidebar from "./FilterSidebar";

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

// ─── Group Loan product grouping (UI-only) ─────────────────────────────────
// Roll up 250+ raw product codes into 4 user-facing groups. Active ONLY when
// categoryFilter === "group". Backend API contracts stay unchanged: when the
// user picks a group, we skip the `product=` query param and filter the
// returned `recent` array client-side. KPI tiles continue to reflect the
// API response (server-aggregated) — accepted limitation per spec.
const GROUP_LOAN_PRODUCT_MAP = {
  "OLD-JLG": [
    // Originally-listed codes
    "15K_FN_27_23", "20K_F_23_1Y", "20K_FN_27_24", "20K_FN_28_24_WI",
    "25K_F_23_1Y", "25K_FN_27_25", "25K_FN_28_25",
    "30K_F_19.7_1Y", "30K_F_23_1Y", "30K_FN_26_26", "30K_FN_26_26_JV",
    "30K_FN_27_25", "30K_FN_28_25", "30K_FN_28_25_JV", "30K_FN_28_25_WI",
    "30K_M_23_1Y", "30K_MDT_28_15WI", "30K_MDT_28_18WI", "30K_MDY_28_15",
    "30K_MNDT_27_15", "30K_MNDT_28_15", "30K_MNDT_28_18", "30K_MNDT_28_24",
    "35K_MNDT_27_17", "35K_MNDT_28_17",
    "40K_FN_26_30_PK", "40K_FN_27_30", "40K_FN_28_30", "40K_FN_28_30_WI",
    "40K_FN_28_30_JV", "40K_MNDT_26_24", "40K_MNDT_27_18", "40K_MNDT_28_18",
    "40K_MNDT_28_24", "40K_MNDY_28_24", "40K_MN_28_24(KCPL)",
    "45K_MNDT_27_18",
    "50K_FN_26_35_PK", "50K_FN_27_36", "50K_FN_28_36", "50K_FN_28_36_WI",
    "50K_MD_26_18_PK", "50K_MDY_28_20WI", "50K_MNDT_26_24", "50K_MNDT_27_20",
    "50K_MNDT_28_20", "50K_MNDT_28_24", "50K_MNDY_26_17", "50K_MNDY_27_20",
    "50K_MNDY_28_20", "50K_MNDY_28_24", "50K_MN_27_24(KCPL)",
    "60K_FN_27_37", "60K_FN_27_37_AN", "60K_FN_28_37", "60K_FN_28_37_WI",
    "60K_MDY_28_22WI", "60K_MNDT_27_22", "60K_MNDT_28_22", "60K_MNDT_28_24",
    "60K_MNDY_27_20", "60K_MNDY_27_AN", "60K_MNDY_28_22", "60K_MNDY_28_24",
    "70K_MNDT_28_24", "70K_MNMS_28_24",
    // ── Added 2026-05 from check_other_bucket.mjs report (older-format
    //    Group products that were falling into "Other"). All have the
    //    same K-prefix + interest/tenure pattern as the codes above.
    "5K_M_0_1Y",
    "10K_F_23_1Y",
    "15K_F_23_1Y_MG", "15K_F_26_25",
    "20K_F_19.7_1Y", "20K_F_26_26", "20K_Func_Loan", "20K_MN_23_1Y", "20K_MNDT_27_12",
    "25K_F_19.7_1Y", "25K_F_26_26",
    "30K_F_19.86_1Y", "30K_F_26_26",
    "30K_FN_26_26_PK",
    "30K_M_19.7_1Y", "30K_M_19.86_1Y", "30K_M_26_12",
    "30K_MDY_28_18", "30K_MNDY_26_12", "30K_MNDY_28_24",
    "35K_FN_27_28",
    "36K_M_2Y",
    "40K_F_19.7_2Y", "40K_F_26_30",
    "40K_MNDY_26_15", "40K_MNDY_27_18", "40K_MNDY_28_18",
    "45K_FN_27_33", "45K_M_23_2Y", "45K_MNDT_28_18",
    "54K_M_23_2Y",
    "55K_MNDT_27_21", "55K_MNDT_28_21",
    // ── Folded into OLD-JLG (per spec: keep only the original 4 buckets).
    //    These were briefly split into ML-MN / RE / RS sub-buckets but
    //    rolled back into OLD-JLG so the dropdown stays at the original
    //    4 categories. Underlying product_name on each row is preserved
    //    — this is purely a UI-side rollup.
    // ── ML_MN family (Micro-Loan Monthly + IND variants) ─────────────
    "ML_MN_1K_27_1", "ML_MN_2K_27_2", "ML_MN_3K_27_3", "ML_MN_4K_27_4",
    "ML_MN_5K_27_5", "ML_MN_6K_27_5", "ML_MN_7K_27_6", "ML_MN_8K_27_7",
    "ML_MN_9K_27_8", "ML_MN_10K_27_8", "ML_MN_11K_27_9", "ML_MN_12K_27_9",
    "ML_MN_13K_27_10", "ML_MN_14K_27_10", "ML_MN_15K_27_10",
    "ML_MN_16K_27_11", "ML_MN_17K_27_11", "ML_MN_18K_27_11",
    "ML_MN_19K_27_11", "ML_MN_20K_27_11", "ML_MN_21K_27_11",
    "ML_MN_22K_27_11", "ML_MN_23K_27_12", "ML_MN_24K_27_12",
    "ML_MN_25K_27_12", "ML_MN_26K_27_12", "ML_MN_27K_27_13",
    "ML_MN_28K_27_13", "ML_MN_29K_27_13", "ML_MN_29K_27_14",
    "ML_MN_30K_27_13", "ML_MN_30K_27_15", "ML_MN_31K_27_13",
    "ML_MN_31K_27_15", "ML_MN_32K_27_13", "ML_MN_32K_27_15",
    "ML_MN_33K_27_13", "ML_MN_33K_27_15", "ML_MN_34K_27_13",
    "ML_MN_34K_27_15", "ML_MN_35K_27_14", "ML_MN_35K_27_15",
    "ML_MN_36K_27_14", "ML_MN_36K_27_16", "ML_MN_37K_27_14",
    "ML_MN_37K_27_16", "ML_MN_38K_27_15", "ML_MN_38K_27_16",
    "ML_MN_39K_27_15", "ML_MN_39K_27_17", "ML_MN_40K_27_15",
    "ML_MN_40K_27_17", "ML_MN_41K_27_16", "ML_MN_41K_27_18",
    "ML_MN_42K_27_16", "ML_MN_42K_27_18", "ML_MN_43K_27_16",
    "ML_MN_43K_27_18", "ML_MN_44K_27_17", "ML_MN_44K_27_19",
    "ML_MN_45K_27_17", "ML_MN_45K_27_19", "ML_MN_46K_27_17",
    "ML_MN_46K_27_19", "ML_MN_47K_27_17", "ML_MN_47K_27_19",
    "ML_MN_48K_27_17", "ML_MN_48K_27_20", "ML_MN_49K_27_17",
    "ML_MN_49K_27_19", "ML_MN_50K_27_17", "ML_MN_50K_27_20",
    "ML_MN_51K_27_18", "ML_MN_51K_27_20", "ML_MN_52K_27_18",
    "ML_MN_52K_27_21", "ML_MN_53K_27_18", "ML_MN_53K_27_21",
    "ML_MN_54K_27_18", "ML_MN_54K_27_21", "ML_MN_55K_27_18",
    "ML_MN_55K_27_21", "ML_MN_56K_27_18", "ML_MN_56K_27_21",
    "ML_MN_57K_27_18", "ML_MN_57K_27_20", "ML_MN_58K_27_18",
    "ML_MN_58K_27_21", "ML_MN_59K_27_18", "ML_MN_59K_27_21",
    "ML_MN_60K_27_18", "ML_MN_60K_27_21", "ML_MN_61K_27_19",
    "ML_MN_61K_27_21", "ML_MN_62K_27_19", "ML_MN_62K_27_22",
    "ML_MN_63K_27_19", "ML_MN_63K_27_22", "ML_MN_64K_27_19",
    "ML_MN_64K_27_22", "ML_MN_65K_27_19", "ML_MN_65K_27_22",
    "ML_MN_66K_27_20", "ML_MN_67K_27_20", "ML_MN_67K_27_23",
    "ML_MN_68K_27_20", "ML_MN_68K_27_24", "ML_MN_69K_27_20",
    "ML_MN_69K_27_23", "ML_MN_70K_27_24", "ML_MN_71K_27_22",
    "ML_MN_71K_27_24", "ML_MN_72K_27_25", "ML_MN_73K_27_22",
    "ML_MN_73K_27_26", "ML_MN_74K_27_22", "ML_MN_75K_27_26",
    "ML_MN_76K_27_26", "ML_MN_77K_27_26", "ML_MN_78K_27_27",
    "ML_MN_79K_27_24", "ML_MN_79K_27_28", "ML_MN_81K_27_29",
    "ML_MN_82K_27_24", "ML_MN_84K_27_29", "ML_MN_85K_27_29",
    "ML_MN_1K_IND", "ML_MN_3K_IND", "ML_MN_4K_IND", "ML_MN_5K_IND",
    "ML_MN_6K_IND", "ML_MN_7K_IND", "ML_MN_14K_IND", "ML_MN_15K_IND",
    "ML_MD_19K_27_11",
    // ── RE family (Recurring Weekly + Fortnightly) ───────────────────
    "RE_WK_1K", "RE_WK_2K", "RE_WK_3K", "RE_WK_4K", "RE_WK_5K", "RE_WK_6K",
    "RE_WK_7K", "RE_WK_8K", "RE_WK_9K", "RE_WK_10K", "RE_WK_11K", "RE_WK_12K",
    "RE_WK_13K", "RE_WK_14K", "RE_WK_15K", "RE_WK_16K", "RE_WK_17K", "RE_WK_18K",
    "RE_WK_19K", "RE_WK_20K", "RE_WK_21K", "RE_WK_22K", "RE_WK_23K", "RE_WK_24K",
    "RE_WK_25K", "RE_WK_26K", "RE_WK_27K", "RE_WK_28K", "RE_WK_29K", "RE_WK_30K",
    "RE_FN_6K_9", "RE_FN_7K_10", "RE_FN_8K_12", "RE_FN_9K_13", "RE_FN_10K_15",
    "RE_FN_10K_15_AL", "RE_FN_11K_16", "RE_FN_12K_18", "RE_FN_13K_18",
    "RE_FN_14K_17", "RE_FN_15K_19", "RE_FN_16K_18", "RE_FN_17K_19",
    "RE_FN_18K_20", "RE_FN_19K_21", "RE_FN_20K_22", "RE_FN_21K_22",
    "RE_FN_23K_22", "RE_FN_24K_22", "RE_FN_25K_22",
    "RE_14K_FN_19.7New",
    // ── RS family (Recurring Small Fortnightly) ──────────────────────
    "RS_FN_2K_4", "RS_FN_3K_6", "RS_FN_4K_8", "RS_FN_5K_10", "RS_FN_6K_12",
    "RS_FN_7K_14", "RS_FN_8K_15", "RS_FN_9K_17", "RS_FN_10K_18",
    "RS_FN_11K_19", "RS_FN_12K_19", "RS_FN_13K_20", "RS_FN_14K_21",
    "RS_FN_15K_21", "RS_FN_16K_22", "RS_FN_17K_22", "RS_FN_18K_23",
    "RS_FN_19K_24", "RS_FN_22K_27", "RS_FN_23K_27", "RS_FN_28K_28",
    "RS_FN_37K_29",
  ],
  "JLG": [
    "30K_MNDT_28_15", "30K_MNDT_28_18", "30K_MNDT_28_24",
    "40K_FN_28_30_JV", "40K_MN_28_24", "40K_MNDT_28_18", "40K_MNDT_28_24",
    "50K_MN_27_24", "50K_MNDT_28_24",
    "60K_MNDT_28_24", "70K_MNDT_28_24", "70K_MNMS_28_24",
  ],
  "VM - JLG": [
    "JLG_20000", "JLG_25000", "JLG_25K_YRD", "JLG_28000", "JLG_30000",
    // OTY variant
    "JLG_30000_OTY",
  ],
  "VM - GOLDJLG": [
    "CGL_1G_New", "CGL_33K", "CGL_34K", "CGL_35K", "CGL_36K",
    "CGL_36K_26W", "CLG_35K_26W",
    // Ooty / OTY variants
    "CGL_41K_26-Ooty", "CGL_40K_OTY_26W", "CGL_39K_OTY_26",
  ],
};
const GROUP_LOAN_GROUPS = Object.keys(GROUP_LOAN_PRODUCT_MAP);
const PRODUCT_TO_GROUP_LOAN = (() => {
  const m = {};
  for (const [g, codes] of Object.entries(GROUP_LOAN_PRODUCT_MAP)) {
    for (const c of codes) m[c] = g;
  }
  return m;
})();
const isGroupLoanGroup = (val) => GROUP_LOAN_GROUPS.includes(val);

// ─── Individual Loan category grouping (UI-only) ───────────────────────────
// Roll up 65 raw individual product codes into 12 user-facing "Category of
// Loan" buckets (per the Individual loan product list reference CSV).
// Active ONLY when categoryFilter === "individual". Same client-side-only
// pattern as the Group Loan grouping above — backend untouched, no schema
// or API changes. The values are matched against the raw product_name field
// the API returns; product_name itself is preserved on every record so
// internal logic that depends on it is unaffected.
const INDIVIDUAL_LOAN_PRODUCT_MAP = {
  "KMCL_STBL": [
    "1.25L_IND_28_24", "1.25L_IND_30_24", "1.5L_IND_28_24",
    "1L_IND_28_24", "1L_IND_29_24", "2L_IND1_28_24",
    "50K_IND_28_24", "60K_IND_30_24",
  ],
  "KMCL_PL": [
    "1L_IND_30_24", "60K_IND_28_24", "70K_IND_28_24", "80K_IND_28_24",
  ],
  "KMCL_MLAP": [
    "10L_IND_24_84", "12L_IND_24_120", "15L_IND1_24_120", "15L_IND_24_120",
    "1L_IND_24_84", "2.25L_IND_24_36", "25L_IND_24_120", "25L_IND_24_120_1",
    "2L_IND_24_36", "3.5L_IND_24_120", "3.5L_IND_24_84", "3L_IND_24_24",
    "3L_IND_24_60_3", "4.5L_IND_24_120", "4L_IND1_24_84", "4L_IND_24_36",
    "4L_IND_24_84_2", "5L_IND_24_60", "5L_IND_24_72", "5L_IND_24_84",
    "6.5L_IND_24_60", "6L_IND_24_84", "7L_IND_24_120", "7L_IND_24_120_2",
    "7L_IND_24_36", "8.5L_IND_24_120", "8L_IND1_24_120", "8L_IND_24_118",
    "8L_IND_24_60", "Loan Against Property", "M_LAP_Old_Clone",
  ],
  "KMCL_GL": [
    "GOLD_18%", "GOLD_EMI_24", "GOLD_HALFYEARLY",
    "GOLD_MONTHLY_24%", "GOLD_QUARTERLY", "GOLD_SEC",
  ],
  "KMCL_GPL": [
    "Gold PL Plus", "Gold PL Plus (Interest Only)",
    "PL_EMI", "PL_FLEXI", "PL_FLEXI_24",
  ],
  "GRC_GL":  ["GOLD_GRC"],
  "GRC_GPL": ["GOLD_GRC_PLFLEXI"],
  "SKPB_GL": ["HO_GOLD_MONTHLY", "SKPB_GOLD_MONTHLY"],
  "VM_GL":   ["GOLD LOAN M-INT", "GOLD_MONTHLY_E"],
  "VM_GPL":  ["Erode_PL", "PL_FLEXI_E", "PL_Others"],
  "MIG":     ["ML_MN_8K_IND"],
  "SSS":     ["Sowbhagyam Scheme"],
};
const INDIVIDUAL_LOAN_GROUPS = Object.keys(INDIVIDUAL_LOAN_PRODUCT_MAP);
const PRODUCT_TO_INDIVIDUAL_LOAN = (() => {
  const m = {};
  for (const [g, codes] of Object.entries(INDIVIDUAL_LOAN_PRODUCT_MAP)) {
    for (const c of codes) m[c] = g;
  }
  return m;
})();
const isIndividualLoanGroup = (val) => INDIVIDUAL_LOAN_GROUPS.includes(val);

// ─── Merged map (used when categoryFilter === "" / All) ────────────────────
// Union of Group + Individual buckets, so the All-category view also shows
// the rollup labels in the dropdown / pie / table instead of 250+ raw codes.
// Group and Individual code namespaces are disjoint by construction
// (group products use codes like "30K_FN_28_25", individual products use
// "1L_IND_28_24" / "GOLD_*" / etc.) so the spread merge is safe.
const MERGED_LOAN_PRODUCT_MAP = { ...GROUP_LOAN_PRODUCT_MAP, ...INDIVIDUAL_LOAN_PRODUCT_MAP };
const MERGED_LOAN_GROUPS = [...GROUP_LOAN_GROUPS, ...INDIVIDUAL_LOAN_GROUPS];
const MERGED_PRODUCT_TO_LOAN = { ...PRODUCT_TO_GROUP_LOAN, ...PRODUCT_TO_INDIVIDUAL_LOAN };

// ─── Unified accessors ─────────────────────────────────────────────────────
// Single switch point for "which mapping is active right now" so the rollup
// logic below works identically across All / Group / Individual without
// scattering category checks throughout the component.
function getActiveProductMap(categoryFilter) {
  if (categoryFilter === "group")      return GROUP_LOAN_PRODUCT_MAP;
  if (categoryFilter === "individual") return INDIVIDUAL_LOAN_PRODUCT_MAP;
  return MERGED_LOAN_PRODUCT_MAP;
}
function getActiveGroups(categoryFilter) {
  if (categoryFilter === "group")      return GROUP_LOAN_GROUPS;
  if (categoryFilter === "individual") return INDIVIDUAL_LOAN_GROUPS;
  return MERGED_LOAN_GROUPS;
}
function getActiveProductToGroup(categoryFilter) {
  if (categoryFilter === "group")      return PRODUCT_TO_GROUP_LOAN;
  if (categoryFilter === "individual") return PRODUCT_TO_INDIVIDUAL_LOAN;
  return MERGED_PRODUCT_TO_LOAN;
}
function isActiveGroupLabel(val, categoryFilter) {
  return getActiveGroups(categoryFilter).includes(val);
}


// ─── Customer-grouped list (used by the "Unique Customers" focused view) ──
// Pulled out as its own component so we can use the usePagination hook
// without breaking the rules-of-hooks (no conditional hook calls in the
// parent component when this view isn't selected).
function CustomerListView({ recent, summary, custSortKey, custSortDir, handleCustSort, formatINR, formatNum }) {
  const arr = useMemo(() => {
    const grouped = new Map();
    for (const r of recent) {
      const k = r.customer_number || r.customer_name || "-";
      const cur = grouped.get(k) || { id: k, name: r.customer_name || "", branch: r.branch || "", loans: 0, total: 0 };
      cur.loans += 1;
      cur.total += Number(r.loan_amount) || 0;
      grouped.set(k, cur);
    }
    const out = [...grouped.values()];
    out.sort((a, b) => {
      const av = a[custSortKey], bv = b[custSortKey];
      const an = Number(av), bn = Number(bv);
      const numeric = Number.isFinite(an) && Number.isFinite(bn) && av !== "" && bv !== "";
      const cmp = numeric ? an - bn : String(av ?? "").localeCompare(String(bv ?? ""));
      return custSortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [recent, custSortKey, custSortDir]);

  const pg = usePagination(arr, 10);

  return (
    <SectionCard
      title="Total Disbursements per Customer"
      subtitle={`${formatNum(summary.count)} disbursements across ${formatNum(summary.customerCount)} unique customers — sortable by Loans or Total Disbursed`}
    >
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
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
            ) : pg.pageRows.map(c => (
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
      <PaginationBar {...pg} label="customers" />
    </SectionCard>
  );
}

// ─── main component ─────────────────────────────────────────────────────────
export default function ReportsAnalytics({ user }) {
  // Filter state — applied separately so users can edit without firing fetches
  const [fromDate, setFromDate] = useState(monthsAgoISO(6));
  const [toDate, setToDate] = useState(todayISO());
  // Branch and Product filters are MULTI-select. Empty array = no filter
  // (all branches / all products). The previous single-select strings
  // are gone — every dependent path that used them is updated below.
  const [branchFilter, setBranchFilter] = useState([]);   // string[]
  const [productFilter, setProductFilter] = useState([]); // string[]
  const [categoryFilter, setCategoryFilter] = useState(""); // "" | "group" | "individual"
  // Filters are reactive — every change triggers a debounced refetch (no
  // Apply button). The 250ms debounce on the date input prevents spamming
  // the API while the user is still typing characters into the date picker.

  // Data state
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Recent-disbursements table state
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState("disbursement_date_iso");
  const [sortDir, setSortDir] = useState("desc");
  // Status filter local to the table — lets the user narrow rows to
  // Active / Closed / Pending without leaving the current view (e.g.
  // they can be in the Principal Outstanding view AND filter to
  // closed-only). "" = no filter.
  // Multi-select Loan Status filter. Array of status strings; empty array
  // means "no filter / show all". Powered by:
  //   - the FilterSidebar's Loan Status checkbox section (multi-select)
  //   - the inline table dropdown above the Disbursements table (single-select;
  //     it sets the array to [value] or [] so the two UIs stay in sync).
  const [tableStatusFilters, setTableStatusFilters] = useState([]);
  // Backward-compat alias for places that still read a single-value string:
  // the inline <select> binds to this, since it can only show one value at
  // a time. When the sidebar selects multiple, the inline dropdown shows
  // the first one (or "" if empty).
  const tableStatusFilter = tableStatusFilters[0] || "";
  const setTableStatusFilter = (v) => setTableStatusFilters(v ? [v] : []);

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

  // Display mode for the Product-wise Disbursements section: user picks
  // between the bar chart and the breakdown table — only one is shown at
  // a time, full width.
  const [productDisplayMode, setProductDisplayMode] = useState("chart"); // "chart" | "table"
  const handleCustSort = (key) => {
    if (custSortKey === key) setCustSortDir(d => d === "asc" ? "desc" : "asc");
    else { setCustSortKey(key); setCustSortDir("desc"); }
  };

  // Branch dropdown options — derived from the initial unfiltered fetch.
  // Static so the user can always switch between any branch.
  const [branchOptions, setBranchOptions] = useState([]);

  // Refs to the multi-select <details> dropdowns so we can close them when
  // the user clicks anywhere outside. Native <details> only closes when
  // <summary> is clicked again — that's annoying for picker UIs.
  const branchDetailsRef = useRef(null);
  const productDetailsRef = useRef(null);
  useEffect(() => {
    const handleOutside = (e) => {
      if (branchDetailsRef.current && branchDetailsRef.current.open
          && !branchDetailsRef.current.contains(e.target)) {
        branchDetailsRef.current.removeAttribute("open");
      }
      if (productDetailsRef.current && productDetailsRef.current.open
          && !productDetailsRef.current.contains(e.target)) {
        productDetailsRef.current.removeAttribute("open");
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  // Product dropdown options — always returns the rollup labels for the
  // current category. Group → 4 group labels. Individual → 12 category
  // labels. All → union of all 16 buckets (rendered as optgroups in the
  // dropdown JSX below). The raw-code fallback only applies if the active
  // mapping ever returns an empty list, which is no longer reachable for
  // any of the three categories.
  const [productsByCategory, setProductsByCategory] = useState({ "": [], group: [], individual: [] });
  const productOptions = useMemo(() => {
    const groups = getActiveGroups(categoryFilter);
    if (groups.length) return groups;
    return productsByCategory[categoryFilter] || productsByCategory[""] || [];
  }, [categoryFilter, productsByCategory]);

  // ── main data fetch ──
  // Reactive: re-fires whenever any filter or the status view changes.
  // 250 ms debounce so date inputs don't spam the API as the user types.
  const fetchData = useCallback(async () => {
    setLoading(true); setErrorMsg("");
    try {
      const p = new URLSearchParams();
      if (fromDate) p.set("from", fromDate);
      if (toDate)   p.set("to", toDate);
      // Multi-select branch — server accepts a comma-separated list.
      if (branchFilter.length > 0) p.set("branch", branchFilter.join(","));
      // Multi-select product. Active group labels (OLD-JLG, KMCL_STBL, etc.)
      // aren't real product codes; the API only matches raw codes. So we
      // expand any selected bucket label into its underlying raw codes
      // before sending. Real raw codes pass through unchanged.
      const expandedProducts = [];
      for (const p2 of productFilter) {
        if (isActiveGroupLabel(p2, categoryFilter)) {
          const map = getActiveProductMap(categoryFilter);
          if (map && map[p2]) expandedProducts.push(...map[p2]);
        } else {
          expandedProducts.push(p2);
        }
      }
      if (expandedProducts.length > 0) p.set("product", expandedProducts.join(","));
      if (categoryFilter) p.set("category", categoryFilter);
      if (view === "active" || view === "closed" || view === "pending" || view === "overdue") {
        p.set("status", view);
      }
      // No cap — load every record matching the current filters so the table
      // and its count reflect the complete filtered set. Pagination stays
      // client-side.
      p.set("limit", "0");
      const res = await fetch(`/api/od/disbursements?${p.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setErrorMsg(e.message || "Failed to load disbursement data");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, branchFilter, productFilter, categoryFilter, view]);

  useEffect(() => {
    const t = setTimeout(() => fetchData(), 250);
    return () => clearTimeout(t);
  }, [fetchData]);

  // ── one-time options fetch on mount ──
  // Populates the Branch dropdown (full universe) and the per-category Product
  // cache so the Product dropdown filters dynamically when the user toggles
  // Loan Category. Three small fetches; runs once.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/od/disbursements").then(r => r.json()).catch(() => ({ byBranch: [], byProduct: [] })),
      fetch("/api/od/disbursements?category=group").then(r => r.json()).catch(() => ({ byProduct: [] })),
      fetch("/api/od/disbursements?category=individual").then(r => r.json()).catch(() => ({ byProduct: [] })),
    ]).then(([all, group, individual]) => {
      if (cancelled) return;
      // Branch dropdown — full universe of branches in the dataset, sorted
      // alphabetically so the user can scan/find easily. byBranch from the
      // API is no longer capped (was top 30 — silently hid branches outside
      // that slice from the dropdown).
      setBranchOptions(
        (all.byBranch || [])
          .map(b => b.key)
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b))
      );
      setProductsByCategory({
        "":           (all.byProduct        || []).map(p => p.key).filter(Boolean),
        group:        (group.byProduct      || []).map(p => p.key).filter(Boolean),
        individual:   (individual.byProduct || []).map(p => p.key).filter(Boolean),
      });
    });
    return () => { cancelled = true; };
  }, []);

  // When the user switches Loan Category, clear the Product filter if the
  // currently-selected product isn't valid for the new category. Uses
  // `productOptions` (the user-facing list, which is the 4 groups when
  // category=group) so a Group Loan group label like "OLD-JLG" survives
  // category re-toggles within Group, but clears when switching to All /
  // Individual where group labels aren't options.
  // When the user switches Loan Category, drop any selected products that
  // no longer appear in the new category's option list. Multi-select
  // version: filter the array instead of clearing the whole thing, so
  // valid selections that survive the toggle stay intact.
  useEffect(() => {
    if (productFilter.length === 0) return;
    if (productOptions.length === 0) return;
    const valid = productFilter.filter(p => productOptions.includes(p));
    if (valid.length !== productFilter.length) setProductFilter(valid);
  }, [productOptions, productFilter]);

  // Sync the table sort to whichever KPI/view is selected, so the data the
  // user sees matches the focus they picked. Users can still click any column
  // header to override.
  useEffect(() => {
    switch (view) {
      case "amount":
      case "avgTicket":
        setSortKey("loan_amount"); setSortDir("desc"); break;
      case "principal":
        setSortKey("principal_outstanding"); setSortDir("desc"); break;
      case "overdue":
        setSortKey("overdue_amount"); setSortDir("desc"); break;
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

  // Preset handlers — set the date directly, the debounced effect picks it up.

  const handlePresetThisMonth = () => { setFromDate(startOfMonthISO()); setToDate(todayISO()); };
  const handlePresetLast3Months = () => { setFromDate(monthsAgoISO(3)); setToDate(todayISO()); };
  const handlePresetThisYear = () => { setFromDate(startOfYearISO()); setToDate(todayISO()); };

  // ── derived ──
  const apiSummary = data?.summary || { count: 0, totalAmount: 0, avgTicket: 0, customerCount: 0, active: 0, closed: 0, pending: 0, principalOutstanding: 0 };
  const byBranch = data?.byBranch || [];
  const byProduct = data?.byProduct || [];
  const byCategory = data?.byCategory || [];
  const byMonth = data?.byMonth || [];
  const recent = data?.recent || [];
  // All-date Principal Outstanding feed (drives the principal drill-down so
  // it matches the date-independent Principal Outstanding card).
  const principalRecent = data?.principalRecent || [];

  // KPI summary — server now filters by raw codes (bucket labels are
  // expanded to their underlying codes before the request), so apiSummary
  // already reflects the right numbers. No client-side recompute needed.
  const summary = apiSummary;

  const filteredRecent = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Status filter — only when one of the status pills is selected.
    const statusFilter = view === "active" ? "Active"
                       : view === "closed" ? "Closed"
                       : view === "pending" ? "Pending"
                       : null;
    // Bucket / branch / product filtering is now done server-side (the
    // fetchData expands bucket labels into raw codes before the request),
    // so the recent array is already narrowed correctly. Only status,
    // search, and the principal-focused-view filter happen here.
    //
    // Principal Outstanding view: hide rows that contribute zero to the
    // displayed total. Closed loans have principal_outstanding = 0 by
    // design (they no longer appear in pool_snapshots), so listing them
    // here with "—" is noise. The aggregated stats above the table still
    // come from the server's authoritative summary, unchanged.
    const principalOnly = view === "principal";
    // Local table-level status filter. AND-combines with the view-driven
    // statusFilter — if a view like "active" is selected AND the user
    // picks "closed" in the table dropdown, no rows match (correct: those
    // are mutually exclusive).
    // Multi-select status filter: row passes if its status matches ANY of
    // the selected statuses. Overdue is special — it's an attribute (not a
    // mutually-exclusive status), so selecting it requires overdue_amount > 0.
    const statusSet = new Set(tableStatusFilters);
    const baseRows = view === "principal" ? principalRecent : recent;
    let arr = baseRows.filter(r => {
      if (principalOnly && (Number(r.principal_outstanding) || 0) <= 0) return false;
      if (statusFilter && r.status !== statusFilter) return false;
      if (statusSet.size > 0) {
        const wantsOverdue = statusSet.has("Overdue");
        const overdueOK = wantsOverdue && (Number(r.overdue_amount) || 0) > 0;
        const directOK = statusSet.has(r.status);
        if (!overdueOK && !directOK) return false;
      } else if (false) {
        return false;
      }
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
  }, [recent, search, sortKey, sortDir, view, productFilter, categoryFilter, tableStatusFilters]);

  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  // Pagination for the Recent Disbursements table — paginates the already
  // sorted+filtered+search-narrowed list, so existing search/sort/filters
  // continue to work unchanged.
  const recentPg = usePagination(filteredRecent, 10);

  // ── exports ──
  // The page fetches `recent` with a default 5000-row cap to keep page
  // loads snappy. Exports need the full dataset (up to the hard 50000
  // cap), so each export function re-fetches with limit=50000 against
  // the same filter set, then maps the result. This isolates the slow
  // case to the moment the user clicks Export, not every page load.
  const fetchAllForExport = useCallback(async () => {
    const p = new URLSearchParams();
    if (fromDate) p.set("from", fromDate);
    if (toDate)   p.set("to", toDate);
    if (branchFilter.length > 0) p.set("branch", branchFilter.join(","));
    const expandedProducts = [];
    for (const p2 of productFilter) {
      if (isActiveGroupLabel(p2, categoryFilter)) {
        const map = getActiveProductMap(categoryFilter);
        if (map && map[p2]) expandedProducts.push(...map[p2]);
      } else {
        expandedProducts.push(p2);
      }
    }
    if (expandedProducts.length > 0) p.set("product", expandedProducts.join(","));
    if (categoryFilter) p.set("category", categoryFilter);
    if (view === "active" || view === "closed" || view === "pending") p.set("status", view);
    p.set("limit", "0");   // 0 = all matching rows, no cap — matches the table
    try {
      const res = await fetch(`/api/od/disbursements?${p.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      let arr = (view === "principal" && Array.isArray(json.principalRecent)) ? json.principalRecent : (json.recent || []);
      // Apply the same client-side filters (search, table-status, principal-only)
      const q = search.trim().toLowerCase();
      if (view === "principal") arr = arr.filter(r => (Number(r.principal_outstanding) || 0) > 0);
      // Multi-select status filter for the export path: matches any of the selected.
      if (tableStatusFilters.length > 0) {
        const statusSet = new Set(tableStatusFilters);
        const wantsOverdue = statusSet.has("Overdue");
        arr = arr.filter(r => {
          if (wantsOverdue && (Number(r.overdue_amount) || 0) > 0) return true;
          return statusSet.has(r.status);
        });
      }
      if (q) {
        arr = arr.filter(r =>
          (r.customer_name || "").toLowerCase().includes(q) ||
          (r.loan_account_no || "").toLowerCase().includes(q) ||
          (r.customer_number || "").toLowerCase().includes(q) ||
          (r.branch || "").toLowerCase().includes(q) ||
          (r.product_name || "").toLowerCase().includes(q));
      }
      return arr;
    } catch (e) {
      console.error("Export re-fetch failed:", e);
      alert("Export could not load the full dataset — no file was downloaded, to avoid giving you a partial report. Please retry; if it persists, narrow the date range.");
      throw e;   // never silently ship a truncated file
    }
  }, [fromDate, toDate, branchFilter, productFilter, categoryFilter, view, search, tableStatusFilters, filteredRecent]);

  // Export schema mirrors the on-screen table: every column the user sees
  // in Recent Disbursements / Overdue Accounts ends up in the download.
  // Numeric fields are exported as raw numbers so spreadsheets can total
  // them; date is the parsed ISO string for cross-system compatibility.
  const exportRowsForCSV = (rows) =>
    (rows || filteredRecent).map((r) => ({
      LoanAccount: r.loan_account_no || "",
      CustomerID: r.customer_number || "",
      CustomerName: r.customer_name || "",
      Branch: r.branch || "",
      Product: r.product_name || "",
      Category: r.loan_category || "",
      DisbursementDate: r.disbursement_date_iso || "",
      LoanAmount: r.loan_amount || 0,
      PrincipalOutstanding: r.principal_outstanding || 0,
      PrincipalRepaid: r.principal_repaid || 0,
      InterestOutstanding: r.interest_outstanding || 0,
      ForeclosureAmount: r.arrear_amount || 0,
      PrincipalOverdue: r.principal_overdue || 0,
      InterestOverdue: r.interest_overdue || 0,
      OverdueAmount: r.overdue_amount || 0,
      DPDDays: r.overdue_days || 0,
      DPDClassification: r.account_dpd_classification || "",
      Status: r.status || "",
      LoanStatus: r.portfolio_status || "",
    }));

  const handleExportCSV = async () => {
    const all = await fetchAllForExport();
    downloadCSV(exportRowsForCSV(all), `disbursements-${todayISO()}.csv`);
  };
  const handleExportExcel = async () => {
    const all = await fetchAllForExport();
    downloadCSV(exportRowsForCSV(all), `disbursements-${todayISO()}.xls`);
  };
  const handleExportPDF = async () => {
    const all = await fetchAllForExport();
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) return;
    // Same column set as the on-screen Recent Disbursements table so the
    // printed report matches what the user is looking at — Principal Out,
    // Overdue, DPD Days, DPD Class included.
    const rowsHtml = all
      .map(r => {
        const dpdClass = r.account_dpd_classification || "";
        const principalOut = Number(r.principal_outstanding) || 0;
        const interestOut  = Number(r.interest_outstanding) || 0;
        const arrearAmt    = Number(r.arrear_amount) || 0;
        const overdueAmt   = Number(r.overdue_amount) || 0;
        const dpdDays      = Number(r.overdue_days) || 0;
        return (
          `<tr>` +
          `<td>${r.disbursement_date_iso || ""}</td>` +
          `<td>${r.customer_name || ""}</td>` +
          `<td>${r.loan_account_no || ""}</td>` +
          `<td>${r.branch || ""}</td>` +
          `<td>${r.product_name || ""}</td>` +
          `<td>${r.loan_category || ""}</td>` +
          `<td style="text-align:right">${formatINR(r.loan_amount)}</td>` +
          `<td style="text-align:right">${principalOut > 0 ? formatINR(principalOut) : "—"}</td>` +
          `<td style="text-align:right">${interestOut > 0 ? formatINR(interestOut) : "—"}</td>` +
          `<td style="text-align:right">${arrearAmt > 0 ? formatINR(arrearAmt) : "—"}</td>` +
          `<td style="text-align:right">${overdueAmt > 0 ? formatINR(overdueAmt) : "—"}</td>` +
          `<td style="text-align:right">${dpdDays > 0 ? dpdDays : "—"}</td>` +
          `<td>${dpdClass || "—"}</td>` +
          `<td>${r.status || ""}</td>` +
          `</tr>`
        );
      }).join("");
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
      <div>Period: ${fromDate} → ${toDate}${branchFilter.length > 0 ? ` · Branch: ${branchFilter.length === 1 ? branchFilter[0] : `${branchFilter.length} branches`}` : ""}${productFilter.length > 0 ? ` · Product: ${productFilter.length === 1 ? productFilter[0] : `${productFilter.length} products`}` : ""}${categoryFilter ? ` · Category: ${categoryFilter}` : ""} · Generated: ${new Date().toLocaleString()}</div>
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
        <th>Overdue</th><td>${formatNum(summary.overdue || 0)}</td>
      </tr><tr>
        <th>Principal Outstanding</th><td>${formatINR(summary.principalOutstanding || 0)}</td>
        <th>Overdue Amount</th><td>${formatINR(summary.overdueAmount || 0)}</td>
        <th></th><td></td>
        <th></th><td></td>
      </tr></table>
      <h2>Disbursements (showing ${all.length})</h2>
      <table>
        <thead><tr>
          <th>Date</th>
          <th>Customer</th>
          <th>Loan A/C</th>
          <th>Branch</th>
          <th>Product</th>
          <th>Category</th>
          <th style="text-align:right">Amount</th>
          <th style="text-align:right">Principal Out.</th>
          <th style="text-align:right">Interest Out.</th>
          <th style="text-align:right">Foreclosure Amount</th>
          <th style="text-align:right">Overdue</th>
          <th style="text-align:right">DPD Days</th>
          <th>DPD Class</th>
          <th>Status</th>
        </tr></thead>
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

  // ── product breakdown (table + pie chart source) ──
  // When category=group OR category=individual, roll up the raw product
  // codes into the active mapping's user-facing buckets (4 group labels or
  // 12 individual category labels). Codes that don't appear in the hardcoded
  // map fall into an "Other" bucket so nothing is silently dropped from the
  // totals. For category=All, byProduct is used as-is.
  // Each bucket also carries a `codes` list of underlying raw products,
  // which the breakdown table surfaces via a tooltip — handy for diagnosing
  // which codes ended up in "Other".
  const productBreakdown = useMemo(() => {
    const productToGroup = getActiveProductToGroup(categoryFilter);
    const groups = getActiveGroups(categoryFilter);
    if (!productToGroup || !groups.length) {
      return byProduct.map(p => ({
        key: p.key,
        total: Number(p.total) || 0,
        count: Number(p.count) || 0,
        codes: [p.key],
      }));
    }
    const buckets = new Map();
    for (const g of groups) buckets.set(g, { key: g, total: 0, count: 0, codes: [] });
    buckets.set("Other", { key: "Other", total: 0, count: 0, codes: [] });
    for (const p of byProduct) {
      const g = productToGroup[p.key] || "Other";
      const b = buckets.get(g);
      b.total += Number(p.total) || 0;
      b.count += Number(p.count) || 0;
      b.codes.push(p.key);
    }
    return [...buckets.values()].filter(b => b.count > 0).sort((a, b) => b.total - a.total);
  }, [byProduct, categoryFilter]);

  // Total used to compute the share-percentage column in the breakdown table.
  const productBreakdownTotal = useMemo(
    () => productBreakdown.reduce((acc, p) => acc + (Number(p.total) || 0), 0),
    [productBreakdown]
  );

  // ── breakdown table sort (Bucket / Loans / Total / Share) ──
  // productBreakdown is already returned sorted by total desc; keeping that
  // as the default. Click a column header to override.
  const [bdSortKey, setBdSortKey] = useState("total");
  const [bdSortDir, setBdSortDir] = useState("desc");
  const handleBdSort = (key) => {
    if (bdSortKey === key) setBdSortDir(d => d === "asc" ? "desc" : "asc");
    else { setBdSortKey(key); setBdSortDir("desc"); }
  };
  const sortedProductBreakdown = useMemo(() => {
    const arr = [...productBreakdown];
    arr.sort((a, b) => {
      let av, bv;
      switch (bdSortKey) {
        case "key":   av = String(a.key || ""); bv = String(b.key || ""); break;
        case "count": av = Number(a.count) || 0; bv = Number(b.count) || 0; break;
        case "share":
        case "total": av = Number(a.total) || 0; bv = Number(b.total) || 0; break;
        default:      av = Number(a.total) || 0; bv = Number(b.total) || 0;
      }
      const cmp = (typeof av === "number" && typeof bv === "number")
        ? av - bv
        : String(av).localeCompare(String(bv));
      return bdSortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [productBreakdown, bdSortKey, bdSortDir]);

  // ── product bar chart series — every bucket from productBreakdown.
  // Variable name kept as `productPie` for backwards compat with existing
  // references; the section now renders a horizontal bar chart, not a pie.
  const productPie = useMemo(
    () => productBreakdown.map(p => ({ name: p.key, value: p.total, count: p.count })),
    [productBreakdown]
  );

  // ────────────────────────────────────────────────────────────────────────
  // ─── Memoize FilterSidebar inputs so click events don't race with the
  // page's auto-refresh re-renders. Without these refs the `sections`
  // array, `value` object, and `onChange` callback would be recreated on
  // every render; the FilterSidebar's internal useMemo (activeCount) and
  // child Section components would see different reference identities
  // each cycle, which when combined with rapid clicks made the checkbox /
  // radio selections flicker.
  const fsSections = useMemo(() => ([
    { id: "dateRange",    type: "date-range", label: "Disbursement Date" },
    { id: "loanCategory", type: "radio",       label: "Loan Category",
      options: [
        { value: "",            label: "All Categories" },
        { value: "group",       label: "Group Loans" },
        { value: "individual",  label: "Individual Loans" },
      ] },
    { id: "branch",  type: "multi-search", label: "Branch",
      options: branchOptions, searchable: true },
    // Product filter uses the same pattern as Branch: a stable options list
    // (productOptions) fetched once on mount and refined by Loan Category.
    // The previous wiring `(data?.byProduct || []).map(p => p.key)` rebuilt
    // the options on every data refresh, which made the Product section
    // feel less consistent than Branch. Now they're symmetric: type=
    // multi-search, searchable=true, stable options array, chips for
    // selected items, individual × to remove each one.
    { id: "product", type: "multi-search", label: "Product",
      options: productOptions, searchable: true },
    // Loan Status — multi-select checkbox. tableStatusFilters is now an
    // array of status strings, so users can pick multiple statuses and the
    // row filter does an "any-of" match. The inline <select> above the
    // table stays single-select and binds to the first array entry.
    { id: "loanStatus", type: "checkbox", label: "Loan Status",
      options: [
        { value: "Active",  label: "Active" },
        { value: "Closed",  label: "Closed" },
        { value: "Pending", label: "Pending" },
        { value: "Overdue", label: "Overdue" },
      ] },
  ]), [branchOptions, productOptions]);

  const fsValue = useMemo(() => ({
    dateRange:    { from: fromDate, to: toDate },
    loanCategory: categoryFilter,
    branch:       branchFilter,
    product:      productFilter,
    loanStatus:   tableStatusFilters,
  }), [fromDate, toDate, categoryFilter, branchFilter, productFilter, tableStatusFilters]);

  const fsOnChange = useCallback((next) => {
    if (next.dateRange) {
      if (next.dateRange.from !== fromDate) setFromDate(next.dateRange.from || monthsAgoISO(6));
      if (next.dateRange.to   !== toDate)   setToDate(next.dateRange.to   || todayISO());
    }
    if (next.loanCategory !== undefined && next.loanCategory !== categoryFilter) setCategoryFilter(next.loanCategory);
    if (Array.isArray(next.branch))  setBranchFilter(next.branch);
    if (Array.isArray(next.product)) setProductFilter(next.product);
    if (Array.isArray(next.loanStatus)) {
      // Bail if identical to avoid spurious re-renders (which were
      // contributing to perceived flicker on rapid clicks).
      const same = next.loanStatus.length === tableStatusFilters.length
                && next.loanStatus.every((s, i) => s === tableStatusFilters[i]);
      if (!same) setTableStatusFilters(next.loanStatus);
    }
  }, [fromDate, toDate, categoryFilter, branchFilter, productFilter, tableStatusFilters]);

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
        <div className="flex items-center gap-2">
          {/* Modern filter drawer — opens on click, slides in from the right
              edge of the viewport. Reads and writes the page's existing filter
              state hooks so the existing data pipeline (fetch, memos, charts,
              table, pagination) keeps working untouched. */}
          <FilterSidebar
            title="Filters"
            triggerLabel="Filters"
            sections={fsSections}
            value={fsValue}
            onChange={fsOnChange}
          />
          <button
            onClick={fetchData}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs bg-teal-600 text-white px-3 py-2 rounded-lg hover:bg-teal-700 disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* 2. Filter Toolbar — reactive (no Apply button). Every change auto-refreshes. */}
      <div className="bg-gray-50 border rounded-xl px-4 py-3 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
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
            {/* Multi-select branch dropdown — pick any number of branches.
                Empty selection = all branches. Uses native details/summary
                with a click-outside handler (see useEffect above) that
                auto-closes the panel when the user clicks anywhere else. */}
            <details ref={branchDetailsRef} className="relative w-full">
              <summary className="list-none w-full px-3 py-1.5 border rounded-lg text-sm bg-white cursor-pointer flex items-center justify-between hover:border-teal-400">
                <span className="truncate">
                  {branchFilter.length === 0
                    ? "All branches"
                    : branchFilter.length === 1
                      ? branchFilter[0]
                      : `${branchFilter.length} branches selected`}
                </span>
                <ChevronDown size={12} className="text-gray-400" />
              </summary>
              <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-white border rounded-lg shadow-lg p-2">
                <div className="flex justify-between items-center pb-1.5 mb-1.5 border-b">
                  <button type="button" onClick={() => setBranchFilter([...branchOptions])}
                    className="text-[11px] text-teal-700 hover:underline">Select all</button>
                  <button type="button" onClick={() => setBranchFilter([])}
                    className="text-[11px] text-gray-500 hover:underline">Clear</button>
                </div>
                {branchOptions.length === 0 ? (
                  <div className="text-xs text-gray-400 px-1 py-2">No branches available.</div>
                ) : branchOptions.map(b => (
                  <label key={b} className="flex items-center gap-2 px-1.5 py-1 hover:bg-teal-50 rounded cursor-pointer text-xs">
                    <input type="checkbox" checked={branchFilter.includes(b)}
                      onChange={() => setBranchFilter(prev => prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b])}
                      className="accent-teal-600" />
                    <span className="flex-1 truncate">{b}</span>
                  </label>
                ))}
              </div>
            </details>
          </div>
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block flex items-center gap-1">
              <Package size={11} /> Product
            </label>
            {/* Multi-select product dropdown — pick any number of products
                or buckets. When Category=All, the list is split into Group
                and Individual sections via grouped headers. Empty selection
                = all products. Auto-closes on click-outside (see useEffect). */}
            <details ref={productDetailsRef} className="relative w-full">
              <summary className="list-none w-full px-3 py-1.5 border rounded-lg text-sm bg-white cursor-pointer flex items-center justify-between hover:border-teal-400">
                <span className="truncate">
                  {productFilter.length === 0
                    ? "All products"
                    : productFilter.length === 1
                      ? productFilter[0]
                      : `${productFilter.length} products selected`}
                </span>
                <ChevronDown size={12} className="text-gray-400" />
              </summary>
              <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-white border rounded-lg shadow-lg p-2">
                <div className="flex justify-between items-center pb-1.5 mb-1.5 border-b">
                  <button type="button" onClick={() => {
                    const all = categoryFilter === ""
                      ? [...GROUP_LOAN_GROUPS, ...INDIVIDUAL_LOAN_GROUPS]
                      : [...productOptions];
                    setProductFilter(all);
                  }} className="text-[11px] text-teal-700 hover:underline">Select all</button>
                  <button type="button" onClick={() => setProductFilter([])}
                    className="text-[11px] text-gray-500 hover:underline">Clear</button>
                </div>
                {(() => {
                  const renderItem = (p) => (
                    <label key={p} className="flex items-center gap-2 px-1.5 py-1 hover:bg-teal-50 rounded cursor-pointer text-xs">
                      <input type="checkbox" checked={productFilter.includes(p)}
                        onChange={() => setProductFilter(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])}
                        className="accent-teal-600" />
                      <span className="flex-1 truncate">{p}</span>
                    </label>
                  );
                  if (categoryFilter === "") return (
                    <>
                      <div className="text-[10px] uppercase text-gray-400 tracking-wide px-1.5 mt-1 mb-0.5">Group Loan</div>
                      {GROUP_LOAN_GROUPS.map(renderItem)}
                      <div className="text-[10px] uppercase text-gray-400 tracking-wide px-1.5 mt-2 mb-0.5">Individual Loan</div>
                      {INDIVIDUAL_LOAN_GROUPS.map(renderItem)}
                    </>
                  );
                  if (productOptions.length === 0) {
                    return <div className="text-xs text-gray-400 px-1 py-2">No products available.</div>;
                  }
                  return productOptions.map(renderItem);
                })()}
              </div>
            </details>
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
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3 items-center">
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
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <SummaryCard icon={Activity} label="Total Disbursements" value={formatNum(summary.count)}
          accent="teal" hint={`Click to see per-customer breakdown · across ${formatNum(summary.customerCount)} customers`}
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
        {/* Principal Outstanding — current portfolio principal from latest
            pool snapshot per loan, filtered by branch / product / category
            just like the other tiles. Closed loans contribute 0. Clicking
            switches to the principal-focused detail view below. */}
        <SummaryCard icon={Wallet} label="Principal Outstanding" value={formatINR(summary.principalOutstanding || 0)}
          accent="rose" hint="Click to see the loans contributing to this principal"
          onClick={() => setKpiView("principal")} active={view === "principal"} />
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
          ["principal", "Principal Outstanding"],
          ["customers", "By Customer"],
          ["active", "Active"],
          ["closed", "Closed"],
          ["pending", "Pending"],
          ["overdue", "Overdue"],
        ].map(([k, label]) => (
          <button key={k} onClick={() => setView(k)}
            className={`text-[11px] px-2.5 py-1 border rounded-md ${view === k ? "bg-teal-600 text-white border-teal-700" : "bg-white text-gray-700 hover:bg-gray-100"}`}>
            {label}
          </button>
        ))}
      </div>

      {/* 4. Status split — clickable. Visible on Overview AND on the
          active / closed / pending / overdue focused views. */}
      {(view === "overview" || view === "active" || view === "closed" || view === "pending" || view === "overdue") && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
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
          {/* 4th tile — Overdue. Counts loans whose latest pool snapshot
              has principal_overdue + interest_overdue > 0. Click to filter
              the Recent Disbursements table to those accounts. */}
          <button type="button" onClick={() => setKpiView("overdue")}
            className={`bg-rose-50 border rounded-xl p-3 text-center cursor-pointer hover:shadow-md transition-shadow ${view === "overdue" ? "border-rose-500 ring-2 ring-rose-500 shadow-md" : "border-rose-200"}`}>
            <p className="text-[11px] text-rose-700 uppercase tracking-wide">Overdue</p>
            <p className="text-2xl font-extrabold text-rose-700">{formatNum(summary.overdue || 0)}</p>
            <p className="text-[10px] text-gray-500">{formatINR(summary.overdueAmount || 0)} due across these</p>
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

      {/* Focused view — Principal Outstanding details: stats strip + the
          recent-disbursements table below (already sorted by principal
          desc via the view-sort sync useEffect). Loans with zero
          outstanding (closed) are hidden in the count/avg, but kept in
          the recent table since users may want to see them. */}
      {view === "principal" && (() => {
        // Reconciliation: sum the Principal Outstanding column from the SAME
        // rows shown in the table (filteredRecent), then compare to the card's
        // server value. With only dashboard filters (date/branch/product/
        // category) applied they are identical; a table search/status chip
        // narrows the shown rows into a subset of the card.
        const positives = filteredRecent.filter(r => Number(r.principal_outstanding) > 0);
        const cardTotal = Number(summary.principalOutstanding) || 0;
        const columnTotal = positives.reduce((s, r) => s + (Number(r.principal_outstanding) || 0), 0);
        const reconciles = Math.round(columnTotal) === Math.round(cardTotal);
        const totalPrincipal = columnTotal;
        const positiveCount = positives.length;
        const avgPrincipal = positiveCount > 0
          ? totalPrincipal / positiveCount
          : 0;
        const maxPrincipal = positives.reduce(
          (m, r) => Math.max(m, Number(r.principal_outstanding) || 0), 0);
        const minPrincipal = positives.reduce(
          (m, r) => {
            const v = Number(r.principal_outstanding) || 0;
            return (m === null || v < m) ? v : m;
          }, null) || 0;
        return (
          <SectionCard
            title="Principal Outstanding — current portfolio"
            subtitle={`${formatINR(totalPrincipal)} across ${formatNum(positiveCount)} loans with positive principal (latest pool snapshot — current book, not filtered by disbursement date)`}
          >
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
                <p className="text-[11px] text-rose-700">Total Outstanding</p>
                <p className="text-sm font-bold text-rose-700">{formatINR(totalPrincipal)}</p>
              </div>
              <div className="bg-gray-50 border rounded-lg p-3">
                <p className="text-[11px] text-gray-500">Loans with Principal</p>
                <p className="text-sm font-bold">{formatNum(positiveCount)}</p>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
                <p className="text-[11px] text-emerald-700">Average Principal</p>
                <p className="text-sm font-bold text-emerald-700">{formatINR(Math.round(avgPrincipal))}</p>
              </div>
              <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3">
                <p className="text-[11px] text-indigo-700">Range</p>
                <p className="text-sm font-bold text-indigo-700">{formatINR(minPrincipal)} – {formatINR(maxPrincipal)}</p>
              </div>
            </div>
            <p className={`text-[11px] mb-2 font-medium ${reconciles ? "text-emerald-700" : "text-amber-700"}`}>
              {reconciles
                ? `✓ Drill-down column total ${formatINR(columnTotal)} reconciles exactly with the Principal Outstanding card.`
                : `Showing ${formatINR(columnTotal)} of the card's ${formatINR(cardTotal)} — a table search / status filter is narrowing these rows; clear it to reconcile with the card.`}
            </p>
            <p className="text-[11px] text-gray-500">
              Closed loans (those with a foreclosure record) contribute Rs. 0 here even when their disbursement appears below.
              The Recent Disbursements table is sorted by principal outstanding (descending) — click any column header to override.
            </p>
          </SectionCard>
        );
      })()}

      {/* Focused view — Customer-grouped list (sortable + paginated). Used
          by both the dedicated "By Customer" view AND the Total
          Disbursements ("count") view, so the user always sees who owns
          how many loans + their cumulative amount when drilling into
          either tile. */}
      {(view === "customers" || view === "count") && (
        <CustomerListView
          recent={recent}
          summary={summary}
          custSortKey={custSortKey}
          custSortDir={custSortDir}
          handleCustSort={handleCustSort}
          formatINR={formatINR}
          formatNum={formatNum}
        />
      )}

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
        <SectionCard
          title="Product-wise Disbursements"
          subtitle={
            categoryFilter === "group"
              ? "Rolled up into the 4 group-loan buckets (OLD-JLG, JLG, VM - JLG, VM - GOLDJLG). Unmapped codes fall into 'Other'."
              : categoryFilter === "individual"
                ? "Rolled up into the 12 individual-loan categories (KMCL_STBL, KMCL_PL, KMCL_MLAP, KMCL_GL, KMCL_GPL, GRC_GL, GRC_GPL, SKPB_GL, VM_GL, VM_GPL, MIG, SSS). Unmapped codes fall into 'Other'."
                : "Rolled up into 16 buckets — 4 group-loan + 12 individual-loan. Unmapped codes fall into 'Other'."
          }
          action={
            <div className="inline-flex rounded-lg border overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setProductDisplayMode("chart")}
                className={`px-3 py-1 ${productDisplayMode === "chart" ? "bg-teal-600 text-white" : "bg-white text-gray-700 hover:bg-gray-100"}`}
              >Chart</button>
              <button
                type="button"
                onClick={() => setProductDisplayMode("table")}
                className={`px-3 py-1 border-l ${productDisplayMode === "table" ? "bg-teal-600 text-white" : "bg-white text-gray-700 hover:bg-gray-100"}`}
              >Table</button>
            </div>
          }
        >
          {productPie.length === 0 ? (
            <div className="text-gray-400 text-sm py-6 text-center">No data.</div>
          ) : productDisplayMode === "chart" ? (
            /* Horizontal bar chart, full width — one bar per bucket sorted
               by total disbursement amount. Y-axis carries the bucket label,
               X-axis the amount in K/L/Cr. Height grows with bucket count
               (28px per bar, min 260px). */
            <ResponsiveContainer width="100%" height={Math.max(260, productPie.length * 28)}>
              <BarChart
                data={productPie}
                layout="vertical"
                margin={{ top: 8, right: 16, left: 8, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" fontSize={11}
                  tickFormatter={v => v >= 1e7 ? `${(v / 1e7).toFixed(1)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : `${Math.round(v / 1000)}K`}
                />
                <YAxis type="category" dataKey="name" fontSize={11} width={130} interval={0} />
                <Tooltip
                  formatter={(v, n, e) => [`${formatINR(v)} (${formatNum(e.payload.count)} loans)`, e.payload.name]}
                />
                <Bar dataKey="value" name="Disbursed">
                  {productPie.map((p, i) => <Cell key={p.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            /* Tabular breakdown, full width — Bucket / Loans / Total /
               Share % with colored swatches that match the bar chart. */
            <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <SortHeader sortKey="key"   currentKey={bdSortKey} currentDir={bdSortDir} onSort={handleBdSort}>
                        {categoryFilter === "group"      ? "Group"
                          : categoryFilter === "individual" ? "Category"
                          : "Bucket"}
                      </SortHeader>
                      <SortHeader sortKey="count" currentKey={bdSortKey} currentDir={bdSortDir} onSort={handleBdSort} align="right">Loans</SortHeader>
                      <SortHeader sortKey="total" currentKey={bdSortKey} currentDir={bdSortDir} onSort={handleBdSort} align="right">Total</SortHeader>
                      <SortHeader sortKey="share" currentKey={bdSortKey} currentDir={bdSortDir} onSort={handleBdSort} align="right">Share</SortHeader>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {sortedProductBreakdown.length === 0 ? (
                      <tr><td colSpan={4} className="px-3 py-6 text-center text-gray-400">No products.</td></tr>
                    ) : sortedProductBreakdown.map((p, i) => {
                      const share = productBreakdownTotal > 0
                        ? ((p.total / productBreakdownTotal) * 100).toFixed(1)
                        : "0.0";
                      // Tooltip surfaces the underlying raw product codes
                      // — most useful on the "Other" row so the user can
                      // see which codes weren't mapped into the 4 groups.
                      const codeList = (p.codes && p.codes.length)
                        ? p.codes.slice(0, 50).join(", ") + (p.codes.length > 50 ? `, …(+${p.codes.length - 50} more)` : "")
                        : "";
                      const _hasActiveMap = !!getActiveProductMap(categoryFilter);
                      const tooltip = (_hasActiveMap && p.key === "Other" && codeList)
                        ? `Unmapped product codes:\n${codeList}`
                        : codeList;
                      return (
                        <tr key={p.key} className="hover:bg-gray-50" title={tooltip}>
                          <td className="px-3 py-2 font-medium text-gray-800">
                            <span
                              className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-middle"
                              style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                            />
                            {p.key}
                            {_hasActiveMap && p.key === "Other" && (
                              <span className="ml-2 text-[10px] text-gray-400">(hover to inspect)</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">{formatNum(p.count)}</td>
                          <td className="px-3 py-2 text-right font-semibold">{formatINR(p.total)}</td>
                          <td className="px-3 py-2 text-right text-gray-500">{share}%</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
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
             : view === "overdue" ? "Overdue Accounts"
             : view === "customers" ? "Recent Disbursements (per-customer view shown above)"
             : view === "count" ? "All Disbursement Records (per-customer summary above)"
             : view === "amount" ? "Disbursements (sorted by amount)"
             : view === "principal" ? "Loans with Principal Outstanding"
             : "Recent Disbursements"}
        subtitle={`Showing ${filteredRecent.length} of ${recent.length} disbursements${
          view === "active" || view === "closed" || view === "pending" ? ` filtered to ${view}`
          : view === "overdue" ? " — only loans with principal_overdue + interest_overdue > 0"
          : view === "principal" ? " — closed loans (principal = 0) hidden"
          : ""}`}
        action={
          <div className="flex items-center gap-2">
            {/* Status filter — works in any view, AND-combines with the
                view-driven status (when one is set). "All" clears it. */}
            <select
              value={tableStatusFilter}
              onChange={e => setTableStatusFilter(e.target.value)}
              className="border rounded-md px-2 py-1 text-xs bg-white"
              title="Filter rows by status"
            >
              <option value="">All statuses</option>
              <option value="Active">Active</option>
              <option value="Closed">Closed</option>
              <option value="Pending">Pending</option>
              <option value="Overdue">Overdue</option>
            </select>
            <div className="relative">
              <Search size={12} className="absolute left-2 top-2 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search name / loan / branch…"
                className="border rounded-md pl-7 pr-2 py-1 text-xs w-56" />
            </div>
          </div>
        }
      >
        {/* stable-table-wrap + table-layout:fixed prevents the Paid Amount /
            Foreclosure Amount columns from wobbling as rows scroll. The
            <colgroup> below pins each column to a fixed width regardless
            of cell content. Sticky thead via the .stable-table CSS class.

            NO inline maxHeight: with pagination keeping the table short, an
            internal scroll container never scrolls, which means sticky thead
            has nothing to stick to. Letting the page handle vertical scroll
            lets the sticky header pin to the viewport instead. */}
        <div className="stable-table-wrap rounded-lg border">
          <table className="stable-table text-xs">
            <colgroup>
              <col style={{ width: "100px" }} /> {/* Date */}
              <col style={{ width: "160px" }} /> {/* Customer */}
              <col style={{ width: "120px" }} /> {/* Loan A/C */}
              <col style={{ width: "140px" }} /> {/* Branch */}
              <col style={{ width: "140px" }} /> {/* Product */}
              <col style={{ width: "110px" }} /> {/* Category */}
              <col style={{ width: "110px" }} /> {/* Amount */}
              <col style={{ width: "120px" }} /> {/* Principal Out. */}
              <col style={{ width: "120px" }} /> {/* Principal Repaid */}
              <col style={{ width: "120px" }} /> {/* Interest Out. */}
              <col style={{ width: "140px" }} /> {/* Foreclosure Amount */}
              <col style={{ width: "110px" }} /> {/* Overdue */}
              <col style={{ width: "80px" }} />  {/* DPD Days */}
              <col style={{ width: "90px" }} />  {/* DPD Class */}
              <col style={{ width: "90px" }} />  {/* Status */}
              <col style={{ width: "90px" }} />  {/* Loan Status */}
            </colgroup>
            <thead>
              <tr>
                <SortHeader sortKey="disbursement_date_iso" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Date</SortHeader>
                <SortHeader sortKey="customer_name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Customer</SortHeader>
                <SortHeader sortKey="loan_account_no" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Loan A/C</SortHeader>
                <SortHeader sortKey="branch" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Branch</SortHeader>
                <SortHeader sortKey="product_name" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Product</SortHeader>
                <SortHeader sortKey="loan_category" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Category</SortHeader>
                <SortHeader sortKey="loan_amount" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right">Amount</SortHeader>
                <SortHeader sortKey="principal_outstanding" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right">Principal Out.</SortHeader>
                <SortHeader sortKey="principal_repaid" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right">Principal Repaid</SortHeader>
                <SortHeader sortKey="interest_outstanding" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right">Interest Out.</SortHeader>
                <SortHeader sortKey="arrear_amount" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right">Foreclosure Amount</SortHeader>
                <SortHeader sortKey="overdue_amount" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right">Overdue</SortHeader>
                <SortHeader sortKey="overdue_days" currentKey={sortKey} currentDir={sortDir} onSort={handleSort} align="right">DPD Days</SortHeader>
                <SortHeader sortKey="account_dpd_classification" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>DPD Class</SortHeader>
                <SortHeader sortKey="status" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Status</SortHeader>
                <SortHeader sortKey="portfolio_status" currentKey={sortKey} currentDir={sortDir} onSort={handleSort}>Loan Status</SortHeader>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRecent.length === 0 ? (
                <tr><td colSpan={16} className="px-3 py-6 text-center text-gray-400">No disbursements match the current filters.</td></tr>
              ) : (
                recentPg.pageRows.map((r) => (
                  <tr key={r.loan_account_no} className="hover:bg-gray-50">
                    <td className="px-3 py-2 text-gray-700">{r.disbursement_date_iso || "—"}</td>
                    <td className="px-3 py-2 font-medium text-gray-800">{r.customer_name || "—"}</td>
                    <td className="px-3 py-2 font-mono text-gray-500">{r.loan_account_no}</td>
                    <td className="px-3 py-2 text-gray-700">{r.branch || "—"}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {/* Active rollup display: when category=group, raw
                          codes (e.g. "30K_FN_26_26") are shown as their
                          group label (e.g. "OLD-JLG"); when category=
                          individual, raw codes (e.g. "1L_IND_28_24") are
                          shown as their Category-of-Loan bucket (e.g.
                          "KMCL_STBL"). Underlying r.product_name is
                          unchanged on the row. Codes not in the active map
                          render as "Other (raw_code)" so the user can still
                          see what's behind them. category=All keeps raw
                          codes as-is. */}
                      {(() => {
                        const _ptg = getActiveProductToGroup(categoryFilter);
                        if (!_ptg) return r.product_name || "—";
                        const mapped = _ptg[r.product_name];
                        if (mapped) return mapped;
                        return (
                          <span title={r.product_name || ""} className="italic text-gray-500">
                            Other{r.product_name ? ` (${r.product_name})` : ""}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        /GROUP/i.test(r.loan_category || "") ? "bg-teal-100 text-teal-700"
                        : /INDIVIDUAL/i.test(r.loan_category || "") ? "bg-indigo-100 text-indigo-700"
                        : "bg-gray-100 text-gray-700"
                      }`}>{r.loan_category || "—"}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold">{formatINR(r.loan_amount)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${(Number(r.principal_outstanding) || 0) > 0 ? "text-rose-700" : "text-gray-400"}`}>
                      {(Number(r.principal_outstanding) || 0) > 0 ? formatINR(r.principal_outstanding) : "—"}
                    </td>
                    {/* Principal Repaid = Disbursed - Principal Outstanding. */}
                    <td className={`px-3 py-2 text-right font-medium ${(Number(r.principal_repaid) || 0) > 0 ? "text-emerald-700" : "text-gray-400"}`}>
                      {(Number(r.principal_repaid) || 0) > 0 ? formatINR(r.principal_repaid) : "—"}
                    </td>
                    {/* Interest Outstanding — accumulated interest balance
                        from the latest pool snapshot. */}
                    <td className={`px-3 py-2 text-right font-medium ${(Number(r.interest_outstanding) || 0) > 0 ? "text-indigo-700" : "text-gray-400"}`}>
                      {(Number(r.interest_outstanding) || 0) > 0 ? formatINR(r.interest_outstanding) : "—"}
                    </td>
                    {/* Foreclosure Amount = Principal Outstanding + Interest Outstanding. */}
                    <td className={`px-3 py-2 text-right font-semibold ${(Number(r.arrear_amount) || 0) > 0 ? "text-gray-900" : "text-gray-400"}`}>
                      {(Number(r.arrear_amount) || 0) > 0 ? formatINR(r.arrear_amount) : "—"}
                    </td>
                    <td className={`px-3 py-2 text-right font-medium ${(Number(r.overdue_amount) || 0) > 0 ? "text-amber-700" : "text-gray-400"}`}>
                      {(Number(r.overdue_amount) || 0) > 0 ? formatINR(r.overdue_amount) : "—"}
                    </td>
                    {/* DPD Days — number of days the loan has been overdue. */}
                    <td className={`px-3 py-2 text-right font-medium ${(Number(r.overdue_days) || 0) > 0 ? "text-rose-700" : "text-gray-400"}`}>
                      {(Number(r.overdue_days) || 0) > 0 ? formatNum(r.overdue_days) : "—"}
                    </td>
                    {/* Account DPD classification — bucket label from the
                        pool snapshot (Regular / SMA-0 / SMA-1 / SMA-2 / NPA). */}
                    <td className="px-3 py-2">
                      {r.account_dpd_classification ? (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          r.account_dpd_classification === "NPA" ? "bg-red-100 text-red-700"
                          : r.account_dpd_classification === "SMA-2" ? "bg-orange-100 text-orange-700"
                          : r.account_dpd_classification === "SMA-1" ? "bg-amber-100 text-amber-700"
                          : r.account_dpd_classification === "SMA-0" ? "bg-yellow-100 text-yellow-700"
                          : "bg-emerald-100 text-emerald-700"
                        }`}>{r.account_dpd_classification}</span>
                      ) : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        r.status === "Closed" ? "bg-gray-200 text-gray-700"
                        : r.status === "Active" ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                      }`}>{r.status}</span>
                    </td>
                    {/* Loan Status (Active / NPA) - NPA when RBI classification is NPA (90+ DPD). */}
                    <td className="px-3 py-2">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                        r.portfolio_status === "NPA" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
                      }`}>{r.portfolio_status || "—"}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <PaginationBar {...recentPg} label={search ? `disbursements (filtered by "${search}")` : "disbursements"} />
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
