"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { getPlatformDefaultRules } from "@/lib/pipeline/platform-defaults";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";

type SyncRule = {
  id: string;
  label: string;
  enabled: boolean;
  stage: string;
  conditions?: unknown;
  actions?: unknown;
};

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "w-7 h-4 rounded-full relative transition-colors flex-shrink-0",
        on ? "bg-electric" : "bg-border"
      )}
      aria-label={on ? "Disable rule" : "Enable rule"}
    >
      <span
        className={cn(
          "absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all",
          on ? "left-3.5" : "left-0.5"
        )}
      />
    </button>
  );
}

export function SyncRulesPanel({
  syncId,
  platform,
  disabledDefaultRules,
  onRulesChanged,
}: {
  syncId: string;
  platform: "google_shopping" | "meta_catalog";
  disabledDefaultRules: string[];
  onRulesChanged: () => void;
}) {
  const [panelOpen, setPanelOpen] = useState(false);

  const platformDefaultRules = getPlatformDefaultRules(platform);
  const { data: syncRules = [], refetch: refetchRules } = trpc.sync.getRules.useQuery({ syncId });

  const toggleRule = trpc.sync.toggleRule.useMutation({
    onSuccess: () => { refetchRules(); onRulesChanged(); },
  });
  const toggleDefault = trpc.sync.toggleDefaultRule.useMutation({
    onSuccess: onRulesChanged,
  });

  const disabledSet = new Set(disabledDefaultRules);
  const activeDefaultCount = platformDefaultRules.filter((r) => !disabledSet.has(r.id)).length;
  const activeUserCount = syncRules.filter((r) => r.enabled).length;
  const activeCount = activeDefaultCount + activeUserCount;

  const platformLabel = platform === "google_shopping" ? "Google Shopping" : "Meta Catalog";

  return (
    <div className="border-b border-border bg-surface flex-shrink-0">
      <button
        onClick={() => setPanelOpen((o) => !o)}
        className="w-full flex items-center text-left transition-colors hover:bg-mist cursor-pointer"
      >
        <div className="flex items-center gap-2.5 px-6 py-2.5 flex-1 min-w-0">
          <div className="w-5 h-5 rounded bg-lavender flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-3 h-3 text-electric" />
          </div>
          <span className="text-xs font-semibold text-accent-text">
            {activeCount} rule{activeCount !== 1 ? "s" : ""} active
          </span>
          <span className="text-xs text-slate">
            ({activeDefaultCount} {platformLabel} spec{activeUserCount > 0 ? ` · ${activeUserCount} custom` : ""})
          </span>
        </div>
        <div className="flex items-center gap-3 px-6 py-2.5 flex-shrink-0">
          <span className="text-xs text-electric font-medium">
            {panelOpen ? "Hide rules" : "Manage rules"}
          </span>
          {panelOpen ? <ChevronUp className="w-3.5 h-3.5 text-slate" /> : <ChevronDown className="w-3.5 h-3.5 text-slate" />}
        </div>
      </button>

      {panelOpen && (
        <div className="px-6 py-4 bg-mist border-t border-border">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-ink">Active rules</span>
            <span className="text-xs text-slate">Toggle to enable / disable · ask the Feed Assistant to add rules</span>
          </div>

          <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto">
            {/* Platform default rules */}
            {platformDefaultRules.map((rule) => {
              const isOn = !disabledSet.has(rule.id);
              return (
                <div
                  key={rule.id}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface border border-border"
                >
                  <Toggle
                    on={isOn}
                    onToggle={() =>
                      toggleDefault.mutate({ syncId, ruleId: rule.id, enabled: !isOn })
                    }
                  />
                  <span className="text-xs text-ink flex-1">{rule.label}</span>
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full",
                    platform === "google_shopping"
                      ? "bg-blue-50 text-blue-700"
                      : "bg-lavender text-deep"
                  )}>
                    {platformLabel} spec
                  </span>
                </div>
              );
            })}

            {/* User sync rules */}
            {syncRules.map((rule: SyncRule) => (
              <div
                key={rule.id}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface border border-border"
              >
                <Toggle
                  on={rule.enabled}
                  onToggle={() => toggleRule.mutate({ ruleId: rule.id, enabled: !rule.enabled })}
                />
                <span className="text-xs text-ink flex-1">{rule.label}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-background text-slate border border-border">
                  Custom
                </span>
              </div>
            ))}

            {syncRules.length === 0 && platformDefaultRules.length === 0 && (
              <p className="text-xs text-slate py-2">No rules yet — ask the Feed Assistant to add some.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
