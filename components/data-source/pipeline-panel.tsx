"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { DEFAULT_RULES } from "@/lib/pipeline/defaults";
import { cn } from "@/lib/utils";
import {
  ChevronDown, ChevronUp, Sparkles, Loader2,
  ToggleLeft, ToggleRight, Trash2, Globe, Lock, ArrowUpRight, X,
} from "lucide-react";


export function PipelinePanel({
  sourceId,
  onRulesApplied,
}: {
  sourceId: string;
  onRulesApplied: () => void;
}) {
  const [panelOpen, setPanelOpen] = useState(false);

  const { data: allRules, refetch: refetchRules } = trpc.pipeline.listRules.useQuery({ sourceId });
  const { data: disabledDefaults = [], refetch: refetchDisabled } = trpc.pipeline.getDisabledDefaults.useQuery({ sourceId });
  const toggleRule = trpc.pipeline.toggleRule.useMutation({ onSuccess: () => refetchRules() });
  const deleteRule = trpc.pipeline.deleteRule.useMutation({ onSuccess: () => refetchRules() });
  const promoteToGlobal = trpc.pipeline.promoteToGlobal.useMutation({ onSuccess: () => refetchRules() });
  const toggleDefaultRule = trpc.pipeline.toggleDefaultRule.useMutation({ onSuccess: () => refetchDisabled() });

  const globalRules = (allRules ?? []).filter((r) => r.scope === "global");
  const sourceRules = (allRules ?? []).filter((r) => r.scope === "source");
  const disabledSet = new Set(disabledDefaults);
  const activeDefaultCount = DEFAULT_RULES.filter((r) => !disabledSet.has(r.id)).length;
  const activeCount = (allRules ?? []).filter((r) => r.enabled).length + activeDefaultCount;
  const hasUserRules = (allRules ?? []).length > 0;

  return (
    <div className="border-b border-border bg-surface flex-shrink-0">
      {/* Strip header — always visible */}
      <button
        onClick={() => setPanelOpen((o) => !o)}
        className="w-full flex items-center text-left transition-colors hover:bg-mist cursor-pointer"
      >
        <div className="flex items-center gap-2.5 px-6 py-2.5 flex-1 min-w-0">
          <div className="w-5 h-5 rounded bg-lavender flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-3 h-3 text-electric" />
          </div>
          <span className="text-xs font-semibold text-accent-text">
            {activeCount} transformation rule{activeCount !== 1 ? "s" : ""} active
          </span>
          <span className="text-xs text-slate">
            ({DEFAULT_RULES.length} default{hasUserRules ? ` · ${(allRules ?? []).filter(r => r.enabled).length} yours` : ""})
          </span>
        </div>
        <div className="flex items-center gap-3 px-6 py-2.5 flex-shrink-0">
          <span className="text-xs text-electric font-medium">
            {panelOpen ? "Hide rules" : "View rules"}
          </span>
          {panelOpen
            ? <ChevronUp className="w-3.5 h-3.5 text-slate" />
            : <ChevronDown className="w-3.5 h-3.5 text-slate" />
          }
        </div>
      </button>

      {/* Expanded rules panel */}
      {panelOpen && (
        <div className="border-t border-border/50 bg-mist/40">
          {/* Source-specific rules */}
          {sourceRules.length > 0 && (
            <RuleSection title="This feed" count={sourceRules.length}>
              {sourceRules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  label={rule.label}
                  stage={rule.stage}
                  enabled={rule.enabled}
                  matchCount={rule.last_match_count}
                  onToggle={() => toggleRule.mutate({ ruleId: rule.id, enabled: !rule.enabled })}
                  onDelete={() => deleteRule.mutate({ ruleId: rule.id })}
                  onPromote={() => promoteToGlobal.mutate({ ruleId: rule.id })}
                  promoting={promoteToGlobal.isPending && promoteToGlobal.variables?.ruleId === rule.id}
                />
              ))}
            </RuleSection>
          )}

          {/* User global rules */}
          {globalRules.length > 0 && (
            <RuleSection title="Your global rules" count={globalRules.length} icon={<Globe className="w-3 h-3 text-electric" />}>
              {globalRules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  label={rule.label}
                  stage={rule.stage}
                  enabled={rule.enabled}
                  matchCount={rule.last_match_count}
                  isGlobal
                  onToggle={() => toggleRule.mutate({ ruleId: rule.id, enabled: !rule.enabled })}
                  onDelete={() => deleteRule.mutate({ ruleId: rule.id })}
                />
              ))}
            </RuleSection>
          )}

          {/* Default rules — can be disabled per feed */}
          <RuleSection
            title="Default rules"
            count={activeDefaultCount}
            icon={<Lock className="w-3 h-3 text-slate" />}
            hint="Applied automatically to all feeds"
          >
            {DEFAULT_RULES.map((rule) => {
              const isDisabled = disabledSet.has(rule.id);
              return (
                <div
                  key={rule.id}
                  className={cn(
                    "flex items-center gap-3 py-1.5 px-3 rounded-lg border",
                    isDisabled
                      ? "bg-surface/40 border-border/40 opacity-50"
                      : "bg-surface/60 border-border/60"
                  )}
                >
                  <StageBadge stage={rule.stage} />
                  <span className={cn("text-sm truncate flex-1", isDisabled ? "line-through text-slate" : "text-ink/70")}>
                    {rule.label}
                  </span>
                  {isDisabled ? (
                    <button
                      onClick={() => toggleDefaultRule.mutate({ sourceId, ruleId: rule.id, disabled: false })}
                      className="text-xs text-electric hover:underline shrink-0"
                      title="Re-enable for this feed"
                    >
                      Re-enable
                    </button>
                  ) : (
                    <button
                      onClick={() => toggleDefaultRule.mutate({ sourceId, ruleId: rule.id, disabled: true })}
                      className="p-1 text-slate/40 hover:text-red-400 transition-colors shrink-0"
                      title="Remove for this feed"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </RuleSection>

          {!hasUserRules && (
            <p className="px-6 py-3 text-xs text-slate">
              No custom rules yet. Ask the Feed Assistant to analyze your feed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function RuleSection({
  title,
  count,
  icon,
  hint,
  children,
}: {
  title: string;
  count: number;
  icon?: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-6 py-3 border-b border-border/30 last:border-0">
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-xs font-semibold text-slate uppercase tracking-wide">{title}</span>
        <span className="text-xs text-slate/60 font-data">({count})</span>
        {hint && <span className="text-xs text-slate/50 ml-1">· {hint}</span>}
      </div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function RuleRow({
  label,
  stage,
  enabled,
  matchCount,
  isGlobal,
  onToggle,
  onDelete,
  onPromote,
  promoting,
}: {
  label: string;
  stage: string;
  enabled: boolean;
  matchCount: number | null;
  isGlobal?: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onPromote?: () => void;
  promoting?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-surface border border-border">
      <div className="flex items-center gap-2.5 min-w-0">
        <StageBadge stage={stage} />
        <span className="text-sm text-ink truncate">{label}</span>
        {isGlobal && (
          <span
            className="text-xs font-semibold text-electric bg-lavender px-1.5 py-0.5 rounded shrink-0"
            title="This rule runs on all your feeds"
          >
            Global
          </span>
        )}
        {matchCount !== null && (
          <span className="text-xs text-slate font-data shrink-0">{matchCount} rows</span>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0 ml-3">
        {onPromote && !isGlobal && (
          <button
            onClick={onPromote}
            disabled={promoting}
            className="p-1 hover:text-electric text-slate/50 transition-colors"
            title="Save to all feeds (promote to global)"
          >
            {promoting
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <ArrowUpRight className="w-3.5 h-3.5" />
            }
          </button>
        )}
        <button
          onClick={onToggle}
          className="p-1 hover:text-ink text-slate transition-colors"
          title={enabled ? "Disable" : "Enable"}
        >
          {enabled
            ? <ToggleRight className="w-4 h-4 text-electric" />
            : <ToggleLeft className="w-4 h-4" />
          }
        </button>
        <button
          onClick={onDelete}
          className="p-1 hover:text-red-500 text-slate transition-colors"
          title={isGlobal ? "Remove from all feeds" : "Delete rule"}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

function StageBadge({ stage }: { stage: string }) {
  return (
    <span className={cn(
      "text-xs font-semibold px-1.5 py-0.5 rounded shrink-0",
      stage === "format" ? "bg-blue-50 text-blue-600" :
      stage === "quality" ? "bg-amber-50 text-amber-700" :
      "bg-red-50 text-red-600"
    )}>
      {stage}
    </span>
  );
}
