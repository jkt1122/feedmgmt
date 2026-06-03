"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import type { ProposedRule } from "@/lib/pipeline/rule-schema";
import { cn } from "@/lib/utils";
import { Sparkles, ChevronDown, ChevronUp, Loader2, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";


export function PipelinePanel({
  sourceId,
  onRulesApplied,
}: {
  sourceId: string;
  onRulesApplied: () => void;
}) {
  const [proposed, setProposed] = useState<ProposedRule[] | null>(null);
  const [approved, setApproved] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const { data: savedRules, refetch: refetchRules } = trpc.pipeline.listRules.useQuery({ sourceId });
  const analyze = trpc.pipeline.analyze.useMutation({
    onSuccess: (data) => {
      setProposed(data);
      setApproved(new Set(data.map((_, i) => i)));
    },
    onError: (err) => {
      // Retry once on auth errors (session not yet available on first load)
      if (err.message.includes("UNAUTHORIZED") || err.data?.code === "UNAUTHORIZED") {
        setTimeout(() => analyze.mutate({ sourceId }), 800);
      }
    },
  });
  const saveRules = trpc.pipeline.saveRules.useMutation({
    onSuccess: () => {
      refetchRules();
      setProposed(null);
      onRulesApplied();
    },
  });
  const toggleRule = trpc.pipeline.toggleRule.useMutation({ onSuccess: () => refetchRules() });
  const deleteRule = trpc.pipeline.deleteRule.useMutation({ onSuccess: () => refetchRules() });

  const handleApprove = () => {
    if (!proposed) return;
    const rulesToSave = proposed
      .filter((_, i) => approved.has(i))
      .map((r) => ({
        label: r.label,
        plain_english: r.plain_english,
        stage: r.stage,
        condition: r.condition as Record<string, unknown>,
        action: r.action as Record<string, unknown>,
      }));
    saveRules.mutate({ sourceId, rules: rulesToSave });
  };

  const toggleExpanded = (i: number) => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(i)) { next.delete(i); } else { next.add(i); }
      return next;
    });
  };

  return (
    <div className="border-t border-border bg-surface">
      {/* Header */}
      <div className="px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-electric" />
          <span className="text-sm font-semibold text-ink">Pipeline Rules</span>
          {savedRules && savedRules.length > 0 && (
            <span className="text-xs font-semibold bg-lavender text-accent-text px-2 py-0.5 rounded-full">
              {savedRules.filter((r) => r.enabled).length} active
            </span>
          )}
        </div>
        {!proposed && (
          <Button
            onClick={() => analyze.mutate({ sourceId })}
            disabled={analyze.isPending}
            variant="outline"
            className="h-7 text-xs font-semibold gap-1.5"
          >
            {analyze.isPending ? (
              <><Loader2 className="w-3.5 h-3.5 animate-spin" />Analyzing…</>
            ) : (
              <><Sparkles className="w-3.5 h-3.5 text-electric" />Analyze with AI</>
            )}
          </Button>
        )}
      </div>

      {/* Saved rules list */}
      {!proposed && savedRules && savedRules.length > 0 && (
        <div className="px-6 pb-4 space-y-2">
          {savedRules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between py-2 px-3 rounded-lg bg-surface-2 border border-border"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className={cn(
                  "text-xs font-semibold px-1.5 py-0.5 rounded",
                  rule.stage === "format" ? "bg-blue-50 text-blue-600" :
                  rule.stage === "quality" ? "bg-amber-50 text-amber-700" :
                  "bg-red-50 text-red-600"
                )}>
                  {rule.stage}
                </span>
                <span className="text-sm text-ink truncate">{rule.label}</span>
                {rule.last_match_count !== null && (
                  <span className="text-xs text-slate font-data shrink-0">{rule.last_match_count} rows</span>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0 ml-3">
                <button
                  onClick={() => toggleRule.mutate({ ruleId: rule.id, enabled: !rule.enabled })}
                  className="p-1 hover:text-ink text-slate transition-colors"
                  title={rule.enabled ? "Disable" : "Enable"}
                >
                  {rule.enabled
                    ? <ToggleRight className="w-4 h-4 text-electric" />
                    : <ToggleLeft className="w-4 h-4" />
                  }
                </button>
                <button
                  onClick={() => deleteRule.mutate({ ruleId: rule.id })}
                  className="p-1 hover:text-red-500 text-slate transition-colors"
                  title="Delete rule"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!proposed && (!savedRules || savedRules.length === 0) && (
        <p className="px-6 pb-4 text-sm text-slate">
          No rules yet. Click &ldquo;Analyze with AI&rdquo; to detect data quality issues.
        </p>
      )}

      {/* Proposed rules review */}
      {proposed && (
        <div className="px-6 pb-4">
          <p className="text-sm text-slate mb-3">
            Claude found {proposed.length} suggested rule{proposed.length !== 1 ? "s" : ""}. Review and approve the ones you want.
          </p>

          <div className="space-y-2 mb-4">
            {proposed.map((rule, i) => (
              <div
                key={i}
                className={cn(
                  "border rounded-lg overflow-hidden transition-colors",
                  approved.has(i) ? "border-electric/40 bg-lavender/20" : "border-border bg-surface-2 opacity-60"
                )}
              >
                <div className="flex items-center gap-3 px-3 py-2.5">
                  {/* Checkbox — click anywhere on the row to toggle */}
                  <button
                    onClick={() => setApproved((s) => {
                      const next = new Set(s);
                      if (next.has(i)) { next.delete(i); } else { next.add(i); }
                      return next;
                    })}
                    className={cn(
                      "shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors",
                      approved.has(i)
                        ? "bg-electric border-electric"
                        : "bg-white border-slate/40 hover:border-electric"
                    )}
                    title={approved.has(i) ? "Deselect" : "Select"}
                  >
                    {approved.has(i) && (
                      <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 10 8">
                        <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    )}
                  </button>

                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => setApproved((s) => {
                      const next = new Set(s);
                      if (next.has(i)) { next.delete(i); } else { next.add(i); }
                      return next;
                    })}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "text-xs font-semibold px-1.5 py-0.5 rounded shrink-0",
                        rule.stage === "format" ? "bg-blue-50 text-blue-600" :
                        rule.stage === "quality" ? "bg-amber-50 text-amber-700" :
                        "bg-red-50 text-red-600"
                      )}>
                        {rule.stage}
                      </span>
                      <span className="text-sm font-semibold text-ink truncate">{rule.label}</span>
                      <span className="text-xs font-data text-slate shrink-0">{rule.affected_count} rows</span>
                    </div>
                    <p className="text-xs text-slate mt-0.5">{rule.plain_english}</p>
                  </div>

                  {rule.preview.length > 0 && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpanded(i); }}
                      className="shrink-0 p-1 text-slate hover:text-ink"
                      title="Preview changes"
                    >
                      {expanded.has(i) ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                  )}
                </div>

                {expanded.has(i) && rule.preview.length > 0 && (
                  <div className="px-3 pb-3 border-t border-border/50">
                    <p className="text-xs font-semibold text-slate mt-2 mb-1.5">Before / After</p>
                    <div className="space-y-1">
                      {rule.preview.map((p, j) => (
                        <div key={j} className="grid grid-cols-2 gap-2 text-xs">
                          <span className="font-data text-red-600 bg-red-50 px-2 py-1 rounded truncate" title={p.before}>
                            {p.before || <em className="text-slate">empty</em>}
                          </span>
                          <span className="font-data text-green-700 bg-green-50 px-2 py-1 rounded truncate" title={p.after}>
                            {p.after || <em className="text-slate">empty</em>}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleApprove}
              disabled={saveRules.isPending || approved.size === 0}
              className="bg-electric hover:bg-[#6D28D9] text-white font-semibold text-sm h-8"
            >
              {saveRules.isPending ? "Applying…" : `Apply ${approved.size} rule${approved.size !== 1 ? "s" : ""} to my data`}
            </Button>
            <Button
              variant="outline"
              onClick={() => setProposed(null)}
              disabled={saveRules.isPending}
              className="text-sm h-8"
            >
              Dismiss
            </Button>
            <span className="text-xs text-slate">
              Saves rules and re-runs the pipeline
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
