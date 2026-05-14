// FilterSidebar — reusable left-rail filter panel for ODPulse.
//
// Usage:
//   <FilterSidebar
//     sections={[
//       { id: "dateRange", type: "date-range", label: "Date" },
//       { id: "loanCategory", type: "radio", label: "Loan Category",
//         options: [
//           { value: "", label: "All" },
//           { value: "Group Loan", label: "Group Loan" },
//           { value: "Individual Loan", label: "Individual Loan" },
//         ] },
//       { id: "branch", type: "multi-search", label: "Branch", options: branchList, searchable: true },
//       { id: "product", type: "multi-search", label: "Product", options: productList, searchable: true },
//       { id: "loanStatus", type: "checkbox", label: "Loan Status",
//         options: ["Active", "Closed", "Pending", "Overdue"] },
//       { id: "officer", type: "multi-search", label: "Officer", options: officerList, searchable: true },
//       { id: "paymentStatus", type: "radio", label: "Payment Status",
//         options: [
//           { value: "", label: "All" }, { value: "paid", label: "Paid" }, { value: "unpaid", label: "Unpaid" },
//         ] },
//     ]}
//     value={filters}                 // current filter state — controlled
//     onChange={setFilters}           // auto-applied on every change (no Apply button)
//   />
//
// Filter state shape (what `value` looks like):
//   {
//     dateRange:     { from: "2026-01-01", to: "2026-12-31" },
//     loanCategory:  "Group Loan",
//     branch:        ["Annur", "Chinnamanur"],
//     product:       [],
//     loanStatus:    ["Active", "Overdue"],
//     officer:       [],
//     paymentStatus: "unpaid",
//   }
//
// The parent derives a predicate from `value` and applies it to its data.
// Use FilterSidebar.makePredicate(sections, value) for a default predicate
// or build your own — the component is intentionally agnostic about how
// the filter state maps to row matching.

import React, { useState, useMemo } from "react";
import { Search, X, ChevronDown, ChevronRight, Calendar, Filter as FilterIcon } from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────────────────────

function isEmptyValue(section, v) {
  if (v == null) return true;
  if (section.type === "date-range") return !v?.from && !v?.to;
  if (section.type === "checkbox" || section.type === "multi-search") {
    return !Array.isArray(v) || v.length === 0;
  }
  if (section.type === "radio") return v === "";
  return v === "" || v === false;
}

function defaultEmpty(section) {
  if (section.type === "date-range") return { from: "", to: "" };
  if (section.type === "checkbox" || section.type === "multi-search") return [];
  if (section.type === "radio") return "";
  return "";
}

// Returns a row predicate that maps each section's filter value to a row check.
// `rowAccessor[id]` returns the row's value for that section's id (default: row[id]).
FilterSidebar.makePredicate = function makePredicate(sections, value, rowAccessor = {}) {
  return (row) => {
    for (const s of sections) {
      const v = value?.[s.id];
      if (isEmptyValue(s, v)) continue;
      const rv = rowAccessor[s.id] ? rowAccessor[s.id](row) : row?.[s.id];
      if (s.type === "date-range") {
        const iso = String(rv || "").slice(0, 10);
        if (v.from && iso && iso < v.from) return false;
        if (v.to   && iso && iso > v.to)   return false;
        if ((v.from || v.to) && !iso) return false;
      } else if (s.type === "radio") {
        if (String(rv ?? "").toLowerCase() !== String(v).toLowerCase()) return false;
      } else if (s.type === "checkbox" || s.type === "multi-search") {
        const set = new Set(v.map(x => String(x).toLowerCase()));
        if (!set.has(String(rv ?? "").toLowerCase())) return false;
      }
    }
    return true;
  };
};

// ─── Section renderers ──────────────────────────────────────────────────────

function DateRangeSection({ value, onChange }) {
  const v = value || { from: "", to: "" };
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Calendar size={12} className="text-gray-400" />
        <span className="text-xs text-gray-500">From</span>
        <input type="date" value={v.from || ""}
          onChange={(e) => onChange({ ...v, from: e.target.value })}
          className="flex-1 px-2 py-1 border rounded text-xs focus:ring-1 focus:ring-teal-500"
        />
      </div>
      <div className="flex items-center gap-2">
        <Calendar size={12} className="text-gray-400" />
        <span className="text-xs text-gray-500">To</span>
        <input type="date" value={v.to || ""}
          onChange={(e) => onChange({ ...v, to: e.target.value })}
          className="flex-1 px-2 py-1 border rounded text-xs focus:ring-1 focus:ring-teal-500"
        />
      </div>
    </div>
  );
}

function RadioSection({ section, value, onChange }) {
  const v = value ?? "";
  return (
    <div className="space-y-1">
      {(section.options || []).map(opt => {
        const optValue = typeof opt === "object" ? opt.value : opt;
        const optLabel = typeof opt === "object" ? opt.label : opt;
        const id = `${section.id}-${optValue || "any"}`;
        return (
          <label key={id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-1.5 py-1 rounded">
            <input
              type="radio"
              name={section.id}
              value={optValue}
              checked={v === optValue}
              onChange={() => onChange(optValue)}
              className="text-teal-600 focus:ring-teal-500"
            />
            <span className="text-gray-700">{optLabel}</span>
          </label>
        );
      })}
    </div>
  );
}

function CheckboxSection({ section, value, onChange }) {
  const v = Array.isArray(value) ? value : [];
  return (
    <div className="space-y-1">
      {(section.options || []).map(opt => {
        const optValue = typeof opt === "object" ? opt.value : opt;
        const optLabel = typeof opt === "object" ? opt.label : opt;
        const checked = v.includes(optValue);
        return (
          <label key={optValue} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-1.5 py-1 rounded">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => {
                const next = e.target.checked ? [...v, optValue] : v.filter(x => x !== optValue);
                onChange(next);
              }}
              className="rounded text-teal-600 focus:ring-teal-500"
            />
            <span className="text-gray-700">{optLabel}</span>
          </label>
        );
      })}
    </div>
  );
}

function MultiSearchSection({ section, value, onChange }) {
  const v = Array.isArray(value) ? value : [];
  const [q, setQ] = useState("");
  const filteredOptions = useMemo(() => {
    const opts = section.options || [];
    if (!q.trim()) return opts.slice(0, 50); // cap initial render for perf
    const needle = q.trim().toLowerCase();
    return opts.filter(o => {
      const label = typeof o === "object" ? o.label : o;
      return String(label).toLowerCase().includes(needle);
    }).slice(0, 100);
  }, [section.options, q]);
  const totalCount = (section.options || []).length;

  return (
    <div className="space-y-2">
      {section.searchable !== false && (
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Search ${section.label.toLowerCase()}…`}
            className="w-full pl-7 pr-2 py-1 border rounded text-xs focus:ring-1 focus:ring-teal-500"
          />
        </div>
      )}
      {v.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {v.map(item => (
            <span key={item} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-teal-50 text-teal-700 border border-teal-200 rounded text-[10px]">
              {item}
              <button onClick={() => onChange(v.filter(x => x !== item))}
                className="ml-0.5 hover:text-teal-900" aria-label={`Remove ${item}`}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="max-h-44 overflow-y-auto border border-gray-100 rounded">
        {filteredOptions.map(opt => {
          const optValue = typeof opt === "object" ? opt.value : opt;
          const optLabel = typeof opt === "object" ? opt.label : opt;
          const checked = v.includes(optValue);
          return (
            <label key={optValue} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-2 py-1">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  const next = e.target.checked ? [...v, optValue] : v.filter(x => x !== optValue);
                  onChange(next);
                }}
                className="rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="text-gray-700 truncate" title={optLabel}>{optLabel}</span>
            </label>
          );
        })}
        {filteredOptions.length === 0 && (
          <div className="text-xs text-gray-400 px-2 py-2 text-center">No matches</div>
        )}
      </div>
      {q.trim() === "" && totalCount > 50 && (
        <p className="text-[10px] text-gray-400">Showing first 50 of {totalCount} — type to search.</p>
      )}
    </div>
  );
}

// ─── Section wrapper (collapsible heading) ──────────────────────────────────

function Section({ section, value, onChange, defaultExpanded = true }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isActive = !isEmptyValue(section, value);

  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {section.label}
          {isActive && <span className="ml-1 inline-block w-2 h-2 bg-teal-500 rounded-full" title="Filter active" />}
        </span>
      </button>
      {expanded && (
        <div className="px-3 pb-3">
          {section.type === "date-range" && <DateRangeSection value={value} onChange={onChange} />}
          {section.type === "radio" && <RadioSection section={section} value={value} onChange={onChange} />}
          {section.type === "checkbox" && <CheckboxSection section={section} value={value} onChange={onChange} />}
          {section.type === "multi-search" && <MultiSearchSection section={section} value={value} onChange={onChange} />}
        </div>
      )}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export default function FilterSidebar({
  sections = [],
  value = {},
  onChange,
  title = "Filters",
  className = "",
  // Mobile: render as a drawer toggled by a top button. Desktop: fixed left rail.
  mobile = false,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // Count of active filters across all sections — shown in the "Clear All" header
  const activeCount = useMemo(() => {
    return sections.reduce((n, s) => n + (isEmptyValue(s, value?.[s.id]) ? 0 : 1), 0);
  }, [sections, value]);

  const setSectionValue = (id, v) => {
    if (typeof onChange !== "function") return;
    onChange({ ...value, [id]: v });
  };
  const clearAll = () => {
    if (typeof onChange !== "function") return;
    const empty = {};
    for (const s of sections) empty[s.id] = defaultEmpty(s);
    onChange(empty);
  };

  const panel = (
    <div className={`bg-white border border-gray-200 rounded-lg ${className}`}>
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-200 bg-gray-50 rounded-t-lg">
        <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
          <FilterIcon size={14} className="text-teal-600" /> {title}
          {activeCount > 0 && (
            <span className="text-[10px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full font-medium">{activeCount}</span>
          )}
        </h3>
        <button
          onClick={clearAll}
          disabled={activeCount === 0}
          className={`text-xs ${activeCount === 0 ? "text-gray-300 cursor-not-allowed" : "text-red-600 hover:text-red-700 hover:underline"}`}
        >
          Clear All
        </button>
      </div>
      <div>
        {sections.map(section => (
          <Section
            key={section.id}
            section={section}
            value={value?.[section.id]}
            onChange={(v) => setSectionValue(section.id, v)}
            defaultExpanded={section.defaultExpanded !== false}
          />
        ))}
      </div>
    </div>
  );

  if (!mobile) return panel;

  // Mobile drawer mode
  return (
    <>
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <FilterIcon size={14} /> Filters
        {activeCount > 0 && (
          <span className="text-[10px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full font-medium">{activeCount}</span>
        )}
      </button>
      <div className={`fixed inset-0 bg-black/30 z-40 transition-opacity ${mobileOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={() => setMobileOpen(false)} />
      <aside className={`fixed top-0 bottom-0 left-0 w-80 max-w-[85%] bg-white shadow-2xl z-50 overflow-y-auto transition-transform ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="sticky top-0 flex items-center justify-between px-3 py-2.5 border-b bg-white">
          <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
          <button onClick={() => setMobileOpen(false)} className="p-1 hover:bg-gray-100 rounded">
            <X size={16} />
          </button>
        </div>
        {panel}
      </aside>
    </>
  );
}
