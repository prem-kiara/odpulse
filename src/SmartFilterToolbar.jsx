// SmartFilterToolbar — reusable "modern" filter UI for ODPulse tables.
//
// Renders, top-to-bottom:
//   1. Toolbar row: global search box + 2-4 quick dropdowns + "More Filters" button
//   2. Active-filter chips: removable tags showing the current filter state
//   3. (On demand) A right-side slide-in panel with advanced filters
//
// The component is config-driven: each table passes a `columns` schema
// declaring which fields are searchable, which get quick-dropdowns, and
// which live in the advanced panel. The toolbar manages filter state
// internally and emits a derived predicate via `onChange(predicate)` so
// callers can run it over their own row data without coupling to a specific
// data shape.
//
// Example usage:
//   <SmartFilterToolbar
//     columns={[
//       { field: "customer_name",  label: "Customer",  kind: "search" },
//       { field: "loan_account_no", label: "Loan #",   kind: "search" },
//       { field: "branch",         label: "Branch",   kind: "quick",   options: branchList },
//       { field: "status",         label: "Status",   kind: "quick",   options: ["Active","Closed","Pending","Overdue"] },
//       { field: "loan_amount",    label: "Amount",   kind: "range",   advanced: true },
//       { field: "disbursement_date_iso", label: "Date", kind: "date",  advanced: true },
//     ]}
//     onChange={setFilterPredicate}
//   />
//   ...
//   const visibleRows = rows.filter(filterPredicate);

import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Search, Filter as FilterIcon, X, Calendar } from "lucide-react";

// Coerce a value to a number for safe numeric comparisons. Returns null
// when the value isn't a real number (NaN, undefined, empty string).
function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Default predicate: matches everything. Used when no filters are active.
const ALL_PASS = () => true;

export default function SmartFilterToolbar({ columns = [], onChange, placeholder = "Search…" }) {
  // Quick filters are dropdowns rendered inline in the toolbar
  const quickCols = useMemo(() => columns.filter(c => c.kind === "quick"), [columns]);
  // Advanced filters live in the side panel only (not shown inline)
  const advancedCols = useMemo(() => columns.filter(c => c.advanced || c.kind === "range" || c.kind === "date"), [columns]);
  // Searchable text fields — used by the global search box
  const searchCols = useMemo(() => columns.filter(c => c.kind === "search"), [columns]);

  const [searchText, setSearchText] = useState("");
  const [quickValues, setQuickValues] = useState({});  // { field: selectedValue | "" }
  const [advancedValues, setAdvancedValues] = useState({}); // { field: { min, max } | { from, to } | value }
  const [panelOpen, setPanelOpen] = useState(false);

  // Derive a predicate function from the current filter state and emit it
  // to the parent. The predicate must be pure-of-state and stable enough
  // to be passed to `Array.filter()`.
  useEffect(() => {
    if (typeof onChange !== "function") return;

    const trimmedSearch = searchText.trim().toLowerCase();
    const activeQuick = Object.entries(quickValues).filter(([, v]) => v !== "" && v != null);
    const activeAdv   = Object.entries(advancedValues).filter(([, v]) => {
      if (v == null) return false;
      if (typeof v === "object") {
        return (v.min != null && v.min !== "") || (v.max != null && v.max !== "")
            || (v.from != null && v.from !== "") || (v.to != null && v.to !== "");
      }
      return v !== "";
    });

    // Fast path: no filters of any kind active → pass everything through.
    if (!trimmedSearch && activeQuick.length === 0 && activeAdv.length === 0) {
      onChange(ALL_PASS);
      return;
    }

    const predicate = (row) => {
      // 1. Global search across the declared search columns.
      if (trimmedSearch) {
        let found = false;
        for (const c of searchCols) {
          const v = row[c.field];
          if (v != null && String(v).toLowerCase().includes(trimmedSearch)) { found = true; break; }
        }
        if (!found) return false;
      }
      // 2. Quick dropdowns — exact match on the selected value (case-insensitive).
      for (const [field, sel] of activeQuick) {
        const v = row[field];
        if (v == null || String(v).toLowerCase() !== String(sel).toLowerCase()) return false;
      }
      // 3. Advanced — range / date / multi-select.
      for (const [field, val] of activeAdv) {
        const colDef = advancedCols.find(c => c.field === field);
        if (!colDef) continue;
        if (colDef.kind === "range") {
          const n = toNum(row[field]);
          const min = toNum(val.min);
          const max = toNum(val.max);
          if (min != null && (n == null || n < min)) return false;
          if (max != null && (n == null || n > max)) return false;
        } else if (colDef.kind === "date") {
          const iso = String(row[field] || "").slice(0, 10); // YYYY-MM-DD
          if (val.from && iso && iso < val.from) return false;
          if (val.to   && iso && iso > val.to)   return false;
          if ((val.from || val.to) && !iso) return false;
        } else if (Array.isArray(val) && val.length > 0) {
          // multi-select advanced filter
          const v = row[field];
          if (!val.some(sel => String(v).toLowerCase() === String(sel).toLowerCase())) return false;
        }
      }
      return true;
    };
    onChange(predicate);
  }, [searchText, quickValues, advancedValues, columns, onChange, searchCols, advancedCols]);

  // Build the list of active chips for the "Active filters" row.
  const chips = useMemo(() => {
    const out = [];
    if (searchText.trim()) {
      out.push({ id: "__search", label: `"${searchText.trim()}"`, onRemove: () => setSearchText("") });
    }
    for (const [field, v] of Object.entries(quickValues)) {
      if (!v) continue;
      const col = quickCols.find(c => c.field === field);
      out.push({
        id: `q:${field}`,
        label: `${col?.label || field}: ${v}`,
        onRemove: () => setQuickValues(prev => ({ ...prev, [field]: "" })),
      });
    }
    for (const [field, v] of Object.entries(advancedValues)) {
      if (!v) continue;
      const col = advancedCols.find(c => c.field === field);
      const name = col?.label || field;
      if (typeof v === "object" && (v.min != null || v.max != null)) {
        if (v.min === "" && v.max === "") continue;
        const parts = [];
        if (v.min !== "" && v.min != null) parts.push(`≥${v.min}`);
        if (v.max !== "" && v.max != null) parts.push(`≤${v.max}`);
        if (parts.length === 0) continue;
        out.push({
          id: `r:${field}`,
          label: `${name}: ${parts.join(" ")}`,
          onRemove: () => setAdvancedValues(prev => ({ ...prev, [field]: { min: "", max: "" } })),
        });
      } else if (typeof v === "object" && (v.from || v.to)) {
        const parts = [];
        if (v.from) parts.push(`from ${v.from}`);
        if (v.to)   parts.push(`to ${v.to}`);
        out.push({
          id: `d:${field}`,
          label: `${name}: ${parts.join(" ")}`,
          onRemove: () => setAdvancedValues(prev => ({ ...prev, [field]: { from: "", to: "" } })),
        });
      } else if (Array.isArray(v) && v.length > 0) {
        out.push({
          id: `m:${field}`,
          label: `${name}: ${v.length} selected`,
          onRemove: () => setAdvancedValues(prev => ({ ...prev, [field]: [] })),
        });
      }
    }
    return out;
  }, [searchText, quickValues, advancedValues, quickCols, advancedCols]);

  const clearAll = useCallback(() => {
    setSearchText("");
    setQuickValues({});
    setAdvancedValues({});
  }, []);

  return (
    <div>
      <div className="smart-filter-toolbar">
        {/* Global search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-8 pr-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-teal-500"
          />
        </div>

        {/* Quick dropdowns — inline */}
        {quickCols.slice(0, 4).map((c) => (
          <select
            key={c.field}
            value={quickValues[c.field] || ""}
            onChange={(e) => setQuickValues(prev => ({ ...prev, [c.field]: e.target.value }))}
            className="px-3 py-2 border rounded-lg text-sm bg-white"
          >
            <option value="">All {c.label}</option>
            {(c.options || []).map(o => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        ))}

        {/* More Filters — opens the side panel when there are advanced filters */}
        {advancedCols.length > 0 && (
          <button
            onClick={() => setPanelOpen(true)}
            className="px-3 py-2 border rounded-lg text-sm bg-white hover:bg-gray-50 flex items-center gap-1"
          >
            <FilterIcon size={14} /> More Filters
            {advancedCols.some(c => {
              const v = advancedValues[c.field];
              return v && typeof v === "object" && (v.min || v.max || v.from || v.to);
            }) && <span className="ml-1 inline-block w-2 h-2 bg-teal-500 rounded-full" />}
          </button>
        )}

        {/* Clear-all shortcut shown only when something is active */}
        {chips.length > 0 && (
          <button
            onClick={clearAll}
            className="px-3 py-2 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded-lg"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {chips.map(chip => (
            <span key={chip.id} className="smart-filter-chip">
              {chip.label}
              <button onClick={chip.onRemove} aria-label="Remove filter">×</button>
            </span>
          ))}
        </div>
      )}

      {/* Advanced filter side panel */}
      <div className={`smart-filter-overlay ${panelOpen ? "open" : ""}`} onClick={() => setPanelOpen(false)} />
      <aside className={`smart-filter-panel ${panelOpen ? "open" : ""}`}>
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h3 className="font-semibold text-gray-800">Advanced Filters</h3>
          <button onClick={() => setPanelOpen(false)} className="p-1 hover:bg-gray-100 rounded">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {advancedCols.map(c => {
            const v = advancedValues[c.field] || (c.kind === "range" ? { min: "", max: "" } : (c.kind === "date" ? { from: "", to: "" } : []));
            if (c.kind === "range") {
              return (
                <div key={c.field}>
                  <label className="block text-xs font-medium text-gray-700 uppercase tracking-wide mb-1">{c.label}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="Min"
                      value={v.min || ""}
                      onChange={(e) => setAdvancedValues(prev => ({ ...prev, [c.field]: { ...v, min: e.target.value } }))}
                      className="no-spinner flex-1 px-3 py-2 border rounded-lg text-sm"
                    />
                    <span className="text-gray-400">to</span>
                    <input
                      type="number"
                      placeholder="Max"
                      value={v.max || ""}
                      onChange={(e) => setAdvancedValues(prev => ({ ...prev, [c.field]: { ...v, max: e.target.value } }))}
                      className="no-spinner flex-1 px-3 py-2 border rounded-lg text-sm"
                    />
                  </div>
                </div>
              );
            }
            if (c.kind === "date") {
              return (
                <div key={c.field}>
                  <label className="block text-xs font-medium text-gray-700 uppercase tracking-wide mb-1 flex items-center gap-1">
                    <Calendar size={12} /> {c.label}
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={v.from || ""}
                      onChange={(e) => setAdvancedValues(prev => ({ ...prev, [c.field]: { ...v, from: e.target.value } }))}
                      className="flex-1 px-3 py-2 border rounded-lg text-sm"
                    />
                    <span className="text-gray-400">to</span>
                    <input
                      type="date"
                      value={v.to || ""}
                      onChange={(e) => setAdvancedValues(prev => ({ ...prev, [c.field]: { ...v, to: e.target.value } }))}
                      className="flex-1 px-3 py-2 border rounded-lg text-sm"
                    />
                  </div>
                </div>
              );
            }
            // Default: multi-select via checkboxes
            const selected = Array.isArray(v) ? v : [];
            return (
              <div key={c.field}>
                <label className="block text-xs font-medium text-gray-700 uppercase tracking-wide mb-2">{c.label}</label>
                <div className="space-y-1 max-h-48 overflow-y-auto pr-2">
                  {(c.options || []).map(opt => (
                    <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-2 py-1 rounded">
                      <input
                        type="checkbox"
                        checked={selected.includes(opt)}
                        onChange={(e) => {
                          const next = e.target.checked
                            ? [...selected, opt]
                            : selected.filter(s => s !== opt);
                          setAdvancedValues(prev => ({ ...prev, [c.field]: next }));
                        }}
                        className="rounded"
                      />
                      <span className="text-gray-700">{opt}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t p-3 flex gap-2">
          <button onClick={clearAll} className="flex-1 px-3 py-2 text-sm border rounded-lg hover:bg-gray-50">Clear all</button>
          <button onClick={() => setPanelOpen(false)} className="flex-1 px-3 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700">Apply</button>
        </div>
      </aside>
    </div>
  );
}
