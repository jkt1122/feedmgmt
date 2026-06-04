"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ChevronRight, X } from "lucide-react";
// eslint-disable-next-line @typescript-eslint/no-unused-vars

type FilterRule = {
  field: string;
  operator: "is" | "is_not" | "contains" | "greater_than" | "less_than";
  value: string;
};

type DataSource = {
  id: string;
  name: string;
  pipeline_status: string;
};

const FILTER_FIELDS = ["availability", "price", "condition", "brand", "category"];
const OPERATORS: { value: FilterRule["operator"]; label: string }[] = [
  { value: "is", label: "is" },
  { value: "is_not", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
];

export function SyncSetupWizard({
  platform,
  sources,
}: {
  platform: "google_shopping" | "meta_catalog";
  sources: DataSource[];
}) {
  const router = useRouter();
  const utils = trpc.useUtils();

  const [name, setName] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);

  const createSync = trpc.sync.create.useMutation({
    onSuccess: async (sync) => {
      await utils.sync.list.invalidate();
      router.push(`/syncs/${sync.id}`);
    },
  });

  const platformLabel = platform === "google_shopping" ? "Google Shopping" : "Meta Catalog";

  const toggleSource = (id: string) => {
    setSelectedSources((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );
  };

  const addFilter = () => {
    setFilterRules((prev) => [
      ...prev,
      { field: "availability", operator: "is", value: "" },
    ]);
  };

  const updateFilter = (i: number, patch: Partial<FilterRule>) => {
    setFilterRules((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  };

  const removeFilter = (i: number) => {
    setFilterRules((prev) => prev.filter((_, idx) => idx !== i));
  };

  const canSubmit = name.trim().length > 0 && selectedSources.length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const validFilters = filterRules.filter((f) => f.value.trim() !== "");
    createSync.mutate({
      name: name.trim(),
      platform,
      source_ids: selectedSources,
      filter_rules: validFilters,
    });
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      {/* Topbar */}
      <div className="h-13 border-b border-border bg-surface flex items-center px-6 gap-3 flex-shrink-0">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink">
            New sync
            <span className={cn(
              "text-xs font-bold px-1.5 py-0.5 rounded",
              platform === "google_shopping"
                ? "bg-blue-50 text-blue-700"
                : "bg-lavender text-deep"
            )}>
              {platformLabel}
            </span>
          </div>
          <div className="text-xs text-slate font-mono mt-0.5">
            Configure this sync then save to activate
          </div>
        </div>
      </div>

      <div className="flex-1 px-8 py-7 flex flex-col gap-5 max-w-2xl">
        {/* Intro */}
        <div>
          <h2 className="text-base font-bold text-ink mb-1">
            Set up a {platformLabel} sync
          </h2>
          <p className="text-sm text-slate leading-relaxed">
            Give it a name, pick your data sources, and add any filters.
            After creating, the Feed Assistant will suggest platform-specific rules for you to review.
          </p>
        </div>

        {/* Step 1: Name + sources */}
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <div className="text-xs font-bold uppercase tracking-wide text-slate mb-1">Step 1</div>
            <div className="text-sm font-bold text-ink mb-0.5">Name and data sources</div>
            <div className="text-xs text-slate leading-relaxed">
              Give this sync a name and pick which transformed sources to include.
              Multiple sources are merged and deduplicated automatically.
            </div>
          </div>
          <div className="px-5 py-4">
            <label className="text-xs font-semibold text-ink block mb-1.5">Sync name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Summer Footwear, All Products, Clearance Only…"
              className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-electric focus:ring-2 focus:ring-electric/10 mb-4"
            />

            <label className="text-xs font-semibold text-ink block mb-2">Data sources</label>
            <div className="flex flex-col gap-2">
              {sources.length === 0 && (
                <p className="text-xs text-slate py-2">No data sources yet — add one first.</p>
              )}
              {sources.map((src) => (
                <button
                  key={src.id}
                  type="button"
                  onClick={() => toggleSource(src.id)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-all",
                    selectedSources.includes(src.id)
                      ? "border-electric bg-lavender"
                      : "border-border bg-background hover:border-slate/40"
                  )}
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={selectedSources.includes(src.id)}
                    className="accent-electric w-4 h-4 flex-shrink-0"
                  />
                  <div>
                    <div className={cn(
                      "text-sm font-semibold",
                      selectedSources.includes(src.id) ? "text-deep" : "text-ink"
                    )}>
                      {src.name}
                    </div>
                    <div className="text-xs text-slate font-mono mt-0.5">
                      {src.pipeline_status === "done" ? "Pipeline complete" : "Pending pipeline"}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {selectedSources.length > 1 && (
              <div className="mt-3 text-xs text-slate flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg">
                <span className="opacity-70">⟳</span>
                <span>
                  <strong>{selectedSources.length} sources</strong> combined · duplicates removed automatically
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Filter rules */}
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <div className="text-xs font-bold uppercase tracking-wide text-slate mb-1">Step 2 — optional</div>
            <div className="text-sm font-bold text-ink mb-0.5">Filter rules</div>
            <div className="text-xs text-slate leading-relaxed">
              Limit which products are included in this sync. Leave empty to include everything.
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="flex flex-col gap-2 mb-3">
              {filterRules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={rule.field}
                    onChange={(e) => updateFilter(i, { field: e.target.value })}
                    className="text-sm bg-background border border-border rounded-lg px-3 py-1.5 outline-none focus:border-electric"
                  >
                    {FILTER_FIELDS.map((f) => (
                      <option key={f} value={f}>{f}</option>
                    ))}
                  </select>
                  <select
                    value={rule.operator}
                    onChange={(e) => updateFilter(i, { operator: e.target.value as FilterRule["operator"] })}
                    className="text-sm bg-background border border-border rounded-lg px-3 py-1.5 outline-none focus:border-electric"
                  >
                    {OPERATORS.map((op) => (
                      <option key={op.value} value={op.value}>{op.label}</option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={rule.value}
                    onChange={(e) => updateFilter(i, { value: e.target.value })}
                    placeholder="value"
                    className="flex-1 text-sm bg-background border border-border rounded-lg px-3 py-1.5 outline-none focus:border-electric"
                  />
                  <button
                    type="button"
                    onClick={() => removeFilter(i)}
                    className="text-slate hover:text-red-600 p-1 rounded transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addFilter}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-electric px-3 py-1.5 rounded-lg border border-dashed border-electric/50 hover:bg-lavender transition-colors"
            >
              + Add filter
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border mt-1">
          <span className="text-xs text-slate">Settings can be changed any time after saving</span>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || createSync.isPending}
            className={cn(
              "inline-flex items-center gap-2 text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors",
              canSubmit
                ? "bg-electric text-white hover:bg-electric/90"
                : "bg-border text-slate cursor-not-allowed"
            )}
          >
            {createSync.isPending ? "Creating sync…" : "Create sync"}
            {!createSync.isPending && <ChevronRight className="w-4 h-4" />}
          </button>
        </div>

        {createSync.error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">
            {createSync.error.message}
          </div>
        )}
      </div>
    </div>
  );
}
