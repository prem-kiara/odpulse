// FilterSidebar — drawer-style reusable filter panel for ODPulse.
//
// Renders a compact "Filters" trigger button that opens a slide-over panel
// from the right edge of the viewport. The panel contains config-driven
// filter sections: date range, radio, checkbox, multi-select-with-search.
// Filters auto-apply on every change (no Apply button). A "Clear All"
// button at the top resets every section.
//
// Pages drop <FilterSidebar /> anywhere they want the trigger to appear
// (typically the page header toolbar). The drawer is portaled to the
// viewport via fixed positioning so it never disrupts the page layout.
//
// Usage:
//   <FilterSidebar
//     sections={[
//       { id: "dateRange",    type: "date-range", label: "Date" },
//       { id: "loanCategory", type: "radio",      label: "Loan Category",
//         options: [{value:"",label:"All"},{value:"group",label:"Group"}] },
//       { id: "branch",  type: "multi-search", label: "Branch", options: branches, searchable: true },
//       { id: "product", type: "multi-search", label: "Product", options: products, searchable: true },
//       { id: "loanStatus", type: "checkbox", label: "Loan Status",
//         options: ["Active","Closed","Pending","Overdue"] },
//     ]}
//     value={filters}
//     onChange={setFilters}
//     triggerClassName="..."  // optional Tailwind override for the button
//   />
//
// Filter state shape (what `value` looks like):
//   {
//     dateRange:     { from: "2026-01-01", to: "2026-12-31" },
//     loanCategory:  "group",
//     branch:        ["Annur", "Chinnamanur"],
//     product:       [],
//     loanStatus:    ["Active", "Overdue"],
//   }

import React, { useState, useMemo, useEffect } from "react";
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

// Returns a row predicate from the current filter state and section schema.
// Pages can use this for client-side filtering, or build their own.
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
        <span className="text-xs text-gray-500 w-10">From</span>
        <input type="date" value={v.from || ""}
          onChange={(e) => onChange({ ...v, from: e.target.value })}
          className="flex-1 px-2 py-1.5 border rounded text-xs focus:ring-1 focus:ring-teal-500"
        />
      </div>
      <div className="flex items-center gap-2">
        <Calendar size={12} className="text-gray-400" />
        <span className="text-xs text-gray-500 w-10">To</span>
        <input type="date" value={v.to || ""}
          onChange={(e) => onChange({ ...v, to: e.target.value })}
          className="flex-1 px-2 py-1.5 border rounded text-xs focus:ring-1 focus:ring-teal-500"
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
        return (
          <label key={optValue || "any"} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 px-1.5 py-1 rounded">
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
                const willCheck = e.target.checked;
                // Functional update: read the CURRENT value at dispatch time
                // (via the parent's valueRef-backed onChange) so two rapid
                // clicks don't overwrite each other's selections.
                onChange((curV) => {
                  const arr = Array.isArray(curV) ? curV : [];
                  return willCheck
                    ? (arr.includes(optValue) ? arr : [...arr, optValue])
                    : arr.filter(x => x !== optValue);
                });
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
    if (!q.trim()) return opts.slice(0, 50);
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
            className="w-full pl-7 pr-2 py-1.5 border rounded text-xs focus:ring-1 focus:ring-teal-500"
          />
        </div>
      )}
      {v.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {v.map(item => (
            <span key={item} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-teal-50 text-teal-700 border border-teal-200 rounded text-[10px]">
              {item}
              <button onClick={() => onChange((curV) => (Array.isArray(curV) ? curV : []).filter(x => x !== item))}
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
                  const willCheck = e.target.checked;
                  onChange((curV) => {
                    const arr = Array.isArray(curV) ? curV : [];
                    return willCheck
                      ? (arr.includes(optValue) ? arr : [...arr, optValue])
                      : arr.filter(x => x !== optValue);
                  });
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

function Section({ section, value, onChange, defaultExpanded = true }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const isActive = !isEmptyValue(section, value);
  return (
    <div className="border-b border-gray-100 last:border-b-0">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-gray-50 transition-colors"
      >
        <span className="text-xs font-semibold text-gray-700 uppercase tracking-wide flex items-center gap-1.5">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {section.label}
          {isActive && <span className="ml-1 inline-block w-2 h-2 bg-teal-500 rounded-full" title="Filter active" />}
        </span>
      </button>
      {expanded && (
        <div className="px-4 pb-3">
          {section.type === "date-range" && <DateRangeSection value={value} onChange={onChange} />}
          {section.type === "radio" && <RadioSection section={section} value={value} onChange={onChange} />}
          {section.type === "checkbox" && <CheckboxSection section={section} value={value} onChange={onChange} />}
          {section.type === "multi-search" && <MultiSearchSection section={section} value={value} onChange={onChange} />}
        </div>
      )}
    </div>
  );
}

// ─── Main component (drawer with trigger button) ────────────────────────────

export default function FilterSidebar({
  sections = [],
  value = {},
  onChange,
  title = "Filters",
  triggerLabel = "Filters",
  triggerClassName = "",
}) {
  const [open, setOpen] = useState(false);

  // Close on ESC for keyboard accessibility.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  // Active filter count — shown as a badge on the trigger button so users
  // know they've narrowed the data even when the drawer is closed.
  const activeCount = useMemo(() => {
    return sections.reduce((n, s) => n + (isEmptyValue(s, value?.[s.id]) ? 0 : 1), 0);
  }, [sections, value]);

  // Stable ref to the current value so section onChange handlers can read
  // the LIVE value at click-time, not the value captured at render time.
  // This is the key fix for the click-race: rapid clicks were overwriting
  // each other because each one computed `next` from the same stale prop.
  const valueRef = React.useRef(value);
  React.useEffect(() => { valueRef.current = value; }, [value]);

  const setSectionValue = React.useCallback((id, updater) => {
    if (typeof onChange !== "function") return;
    const curSectionValue = valueRef.current?.[id];
    const nextSectionValue = typeof updater === "function" ? updater(curSectionValue) : updater;
    // Bail if value didn't actually change — avoids a render and the
    // accompanying focus-jump that contributed to perceived flicker.
    if (Object.is(curSectionValue, nextSectionValue)) return;
    onChange({ ...valueRef.current, [id]: nextSectionValue });
  }, [onChange]);
  const clearAll = React.useCallback(() => {
    if (typeof onChange !== "function") return;
    const empty = {};
    for (const s of sections) empty[s.id] = defaultEmpty(s);
    onChange(empty);
  }, [sections, onChange]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={triggerClassName || "inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"}
        aria-label="Open filters"
      >
        <FilterIcon size={14} className="text-teal-600" />
        <span>{triggerLabel}</span>
        {activeCount > 0 && (
          <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 bg-teal-600 text-white text-[10px] font-bold rounded-full">
            {activeCount}
          </span>
        )}
      </button>

      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/30 z-40 transition-opacity ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={() => setOpen(false)}
      />

      {/* Slide-over drawer (slides in from the right edge of the viewport) */}
      <aside
        className={`fixed top-0 right-0 bottom-0 w-full sm:w-96 bg-white shadow-2xl z-50 flex flex-col transition-transform duration-200 ${open ? "translate-x-0" : "translate-x-full"}`}
        aria-hidden={!open}
      >
        {/* Header: title + clear all + close */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
          <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
            <FilterIcon size={14} className="text-teal-600" />
            {title}
            {activeCount > 0 && (
              <span className="text-[10px] bg-teal-100 text-teal-700 px-1.5 py-0.5 rounded-full font-medium">{activeCount}</span>
            )}
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={clearAll}
              disabled={activeCount === 0}
              className={`text-xs px-2 py-1 rounded ${activeCount === 0 ? "text-gray-300 cursor-not-allowed" : "text-red-600 hover:bg-red-50"}`}
            >
              Clear All
            </button>
            <button
              onClick={() => setOpen(false)}
              className="p-1 hover:bg-gray-200 rounded text-gray-500"
              aria-label="Close filters"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Sections (scrollable) */}
        <div className="flex-1 overflow-y-auto">
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

        {/* Footer: hint that changes auto-apply (no Apply button needed) */}
        <div className="border-t bg-gray-50 px-4 py-2.5 flex items-center justify-between">
          <p className="text-[11px] text-gray-500">Changes apply automatically.</p>
          <button
            onClick={() => setOpen(false)}
            className="px-3 py-1.5 bg-teal-600 text-white text-xs font-medium rounded-lg hover:bg-teal-700"
          >
            Done
          </button>
        </div>
      </aside>
    </>
  );
}
