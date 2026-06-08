"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { X, Plus } from "lucide-react";

type FilterRule = {
  field: string;
  operator: "is" | "is_not" | "contains" | "greater_than" | "less_than";
  value: string;
};

type Sync = {
  id: string;
  name: string;
  source_ids: string[];
  filter_rules: unknown[];
};

const FILTER_FIELDS = ["availability", "price", "condition", "brand", "category"];
const OPERATORS: { value: FilterRule["operator"]; label: string }[] = [
  { value: "is", label: "is" },
  { value: "is_not", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "greater_than", label: "greater than" },
  { value: "less_than", label: "less than" },
];

export function SyncEditDialog({
  sync,
  onClose,
  onSaved,
}: {
  sync: Sync;
  onClose: () => void;
  onSaved: (updated: Partial<Sync>) => void;
}) {
  const [name, setName] = useState(sync.name);
  const [selectedSources, setSelectedSources] = useState<string[]>(sync.source_ids);
  const [filterRules, setFilterRules] = useState<FilterRule[]>(
    (sync.filter_rules as FilterRule[]) ?? []
  );
  const { data: sources = [] } = trpc.dataSource.list.useQuery();

  const updateSync = trpc.sync.update.useMutation({
    onSuccess: () => {
      onSaved({ name, source_ids: selectedSources, filter_rules: filterRules });
    },
  });

  const toggleSource = (id: string) =>
    setSelectedSources((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]
    );

  const addFilter = () =>
    setFilterRules((prev) => [...prev, { field: "availability", operator: "is", value: "" }]);

  const updateFilter = (i: number, patch: Partial<FilterRule>) =>
    setFilterRules((prev) => prev.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  const removeFilter = (i: number) =>
    setFilterRules((prev) => prev.filter((_, idx) => idx !== i));

  const canSave = name.trim().length > 0 && selectedSources.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-card rounded-2xl border border-border shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div>
            <div className="text-sm font-bold text-foreground">Edit sync setup</div>
            <div className="text-xs text-muted-foreground mt-0.5">Changes take effect on the next run</div>
          </div>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-5">
          {/* Name */}
          <div>
            <label className="text-xs font-semibold text-foreground block mb-1.5">Sync name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full text-sm bg-background border border-border rounded-lg px-3 py-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
            />
          </div>

          {/* Sources */}
          <div>
            <label className="text-xs font-semibold text-foreground block mb-2">Data sources</label>
            <div className="flex flex-col gap-2">
              {sources.map((src) => (
                <button
                  key={src.id}
                  type="button"
                  onClick={() => toggleSource(src.id)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 rounded-lg border text-left transition-all",
                    selectedSources.includes(src.id)
                      ? "border-primary bg-accent"
                      : "border-border bg-background hover:border-muted-foreground/40"
                  )}
                >
                  <input type="checkbox" readOnly checked={selectedSources.includes(src.id)} className="accent-primary w-4 h-4 flex-shrink-0" />
                  <span className={cn("text-sm font-medium", selectedSources.includes(src.id) ? "text-primary" : "text-foreground")}>
                    {src.name}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Filter rules */}
          <div>
            <label className="text-xs font-semibold text-foreground block mb-2">Filter rules</label>
            <div className="flex flex-col gap-2 mb-2">
              {filterRules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={rule.field}
                    onChange={(e) => updateFilter(i, { field: e.target.value })}
                    className="text-sm bg-background border border-border rounded-lg px-3 py-1.5 outline-none focus:border-primary"
                  >
                    {FILTER_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                  <select
                    value={rule.operator}
                    onChange={(e) => updateFilter(i, { operator: e.target.value as FilterRule["operator"] })}
                    className="text-sm bg-background border border-border rounded-lg px-3 py-1.5 outline-none focus:border-primary"
                  >
                    {OPERATORS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
                  </select>
                  <input
                    type="text"
                    value={rule.value}
                    onChange={(e) => updateFilter(i, { value: e.target.value })}
                    placeholder="value"
                    className="flex-1 text-sm bg-background border border-border rounded-lg px-3 py-1.5 outline-none focus:border-primary"
                  />
                  <button type="button" onClick={() => removeFilter(i)} className="text-muted-foreground hover:text-destructive p-1 rounded transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addFilter}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary px-3 py-1.5 rounded-lg border border-dashed border-primary/50 hover:bg-accent transition-colors"
            >
              <Plus className="w-3 h-3" />
              Add filter
            </button>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between flex-shrink-0">
          <button type="button" onClick={onClose} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => updateSync.mutate({
              id: sync.id,
              name: name.trim(),
              source_ids: selectedSources,
              filter_rules: filterRules.filter((f) => f.value.trim() !== ""),
            })}
            disabled={!canSave || updateSync.isPending}
            className={cn(
              "text-sm font-semibold px-5 py-2 rounded-lg transition-colors",
              canSave ? "bg-primary text-primary-foreground hover:bg-primary/90" : "bg-border text-muted-foreground cursor-not-allowed"
            )}
          >
            {updateSync.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
