"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { X, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
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
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] gap-0 p-0">
        <DialogHeader className="px-6 py-4 border-b border-border">
          <DialogTitle>Edit sync setup</DialogTitle>
          <DialogDescription>Changes take effect on the next run</DialogDescription>
        </DialogHeader>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-5 flex flex-col gap-5">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="sync-name">Sync name</Label>
            <Input
              id="sync-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Sources */}
          <div>
            <Label className="mb-2 block">Data sources</Label>
            <div className="flex flex-col gap-2">
              {sources.map((src) => {
                const selected = selectedSources.includes(src.id);
                return (
                  <label
                    key={src.id}
                    className="flex items-center gap-3 px-4 py-2.5 rounded-lg border border-border bg-background cursor-pointer transition-colors hover:border-muted-foreground/40 has-data-[state=checked]:border-primary has-data-[state=checked]:bg-accent"
                  >
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => toggleSource(src.id)}
                    />
                    <span className={selected ? "text-sm font-medium text-primary" : "text-sm font-medium text-foreground"}>
                      {src.name}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Filter rules */}
          <div>
            <Label className="mb-2 block">Filter rules</Label>
            <div className="flex flex-col gap-2 mb-2">
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
            <Button variant="outline" size="sm" onClick={addFilter}>
              <Plus />
              Add filter
            </Button>
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border sm:justify-between">
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            onClick={() => updateSync.mutate({
              id: sync.id,
              name: name.trim(),
              source_ids: selectedSources,
              filter_rules: filterRules.filter((f) => f.value.trim() !== ""),
            })}
            disabled={!canSave || updateSync.isPending}
          >
            {updateSync.isPending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
