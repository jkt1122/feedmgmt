"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ChevronRight, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

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
      <div className="h-13 border-b border-border bg-card flex items-center px-6 gap-3 flex-shrink-0">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
            New sync
            <span className={cn(
              "text-xs font-bold px-1.5 py-0.5 rounded",
              platform === "google_shopping"
                ? "bg-info/10 text-info"
                : "bg-primary/10 text-primary"
            )}>
              {platformLabel}
            </span>
          </div>
          <div className="text-xs text-muted-foreground font-mono mt-0.5">
            Configure this sync then save to activate
          </div>
        </div>
      </div>

      <div className="flex-1 px-8 py-7 flex flex-col gap-5 max-w-2xl">
        {/* Intro */}
        <div>
          <h2 className="text-base font-bold text-foreground mb-1">
            Set up a {platformLabel} sync
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Give it a name, pick your data sources, and add any filters.
            After creating, the Feed Assistant will suggest platform-specific rules for you to review.
          </p>
        </div>

        {/* Step 1: Name + sources */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Step 1</div>
            <div className="text-sm font-bold text-foreground mb-0.5">Name and data sources</div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              Give this sync a name and pick which transformed sources to include.
              Multiple sources are merged and deduplicated automatically.
            </div>
          </div>
          <div className="px-5 py-4">
            <Label htmlFor="sync-name" className="mb-1.5 block">Sync name</Label>
            <Input
              id="sync-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Summer Footwear, All Products, Clearance Only…"
              className="mb-4"
            />

            <Label className="mb-2 block">Data sources</Label>
            <div className="flex flex-col gap-2">
              {sources.length === 0 && (
                <p className="text-xs text-muted-foreground py-2">No data sources yet — add one first.</p>
              )}
              {sources.map((src) => {
                const selected = selectedSources.includes(src.id);
                return (
                  <label
                    key={src.id}
                    className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-background cursor-pointer transition-all hover:border-muted-foreground/40 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-accent"
                  >
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => toggleSource(src.id)}
                    />
                    <div>
                      <div className={cn(
                        "text-sm font-semibold",
                        selected ? "text-primary" : "text-foreground"
                      )}>
                        {src.name}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-0.5">
                        {src.pipeline_status === "done" ? "Pipeline complete" : "Pending pipeline"}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>

            {selectedSources.length > 1 && (
              <div className="mt-3 text-xs text-muted-foreground flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg">
                <span className="opacity-70">⟳</span>
                <span>
                  <strong>{selectedSources.length} sources</strong> combined · duplicates removed automatically
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Filter rules */}
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">Step 2 — optional</div>
            <div className="text-sm font-bold text-foreground mb-0.5">Filter rules</div>
            <div className="text-xs text-muted-foreground leading-relaxed">
              Limit which products are included in this sync. Leave empty to include everything.
            </div>
          </div>
          <div className="px-5 py-4">
            <div className="flex flex-col gap-2 mb-3">
              {filterRules.map((rule, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select
                    value={rule.field}
                    onValueChange={(v) => updateFilter(i, { field: v as string })}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FILTER_FIELDS.map((f) => (
                        <SelectItem key={f} value={f}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={rule.operator}
                    onValueChange={(v) => updateFilter(i, { operator: v as FilterRule["operator"] })}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue>
                        {(value) => OPERATORS.find((o) => o.value === value)?.label}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map((op) => (
                        <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={rule.value}
                    onChange={(e) => updateFilter(i, { value: e.target.value })}
                    placeholder="value"
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeFilter(i)}
                    aria-label="Remove filter"
                  >
                    <X />
                  </Button>
                </div>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={addFilter} className="border-dashed">
              <Plus />
              Add filter
            </Button>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border mt-1">
          <span className="text-xs text-muted-foreground">Settings can be changed any time after saving</span>
          <Button
            size="lg"
            onClick={handleSubmit}
            disabled={!canSubmit || createSync.isPending}
          >
            {createSync.isPending ? "Creating sync…" : "Create sync"}
            {!createSync.isPending && <ChevronRight />}
          </Button>
        </div>

        {createSync.error && (
          <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg px-4 py-2">
            {createSync.error.message}
          </div>
        )}
      </div>
    </div>
  );
}
