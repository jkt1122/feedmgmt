"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Sparkles, Loader2 } from "lucide-react";
import { getPlatformDefaultRules } from "@/lib/pipeline/platform-defaults";
import type { PlatformDefaultRuleMeta } from "@/lib/pipeline/platform-defaults";

type DbRule = {
  id: string;
  label: string;
  plain_english: string;
  enabled: boolean;
  stage: string;
  origin?: string;
};

function Toggle({ on, onToggle, disabled }: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "w-7 h-4 rounded-full relative transition-colors flex-shrink-0 disabled:opacity-40",
        on ? "bg-primary" : "bg-border"
      )}
      aria-label={on ? "Disable" : "Enable"}
    >
      <span className={cn(
        "absolute top-0.5 w-3 h-3 bg-card rounded-full shadow transition-all",
        on ? "left-3.5" : "left-0.5"
      )} />
    </button>
  );
}

export function SyncRulesPanel({
  syncId,
  platform,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  disabledDefaultRules: _unused,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onRulesChanged: _onRulesChanged,
}: {
  syncId: string;
  platform: "google_shopping" | "meta_catalog";
  disabledDefaultRules: string[];
  onRulesChanged: () => void;
}) {
  const [panelOpen, setPanelOpen] = useState(false);
  const utils = trpc.useUtils();

  const { data: dbRules = [], refetch: refetchRules } = trpc.sync.getRules.useQuery({ syncId });

  const platformDefaults = getPlatformDefaultRules(platform);
  const platformLabel = platform === "google_shopping" ? "Google Shopping" : "Meta Catalog";
  const optimizationLabel = platform === "google_shopping"
    ? "Google Shopping Optimizations"
    : "Meta Catalog Optimizations";

  // Build a lookup: plain_english → DB rule
  const dbByPlainEnglish = new Map<string, DbRule>(
    (dbRules as DbRule[]).map((r) => [r.plain_english, r])
  );

  // Custom rules = DB rules NOT matching any platform default
  const defaultPlainEnglishSet = new Set(platformDefaults.map((r) => r.plain_english));
  const customRules = (dbRules as DbRule[]).filter((r) => !defaultPlainEnglishSet.has(r.plain_english));

  const activeDefaultCount = platformDefaults.filter((d) => {
    const db = dbByPlainEnglish.get(d.plain_english);
    return db?.enabled === true;
  }).length;
  const activeCustomCount = customRules.filter((r) => r.enabled).length;
  const totalActive = activeDefaultCount + activeCustomCount;

  const runSync = trpc.sync.run.useMutation({
    onSuccess: () => {
      utils.sync.getProducts.invalidate({ id: syncId });
      refetchRules();
    },
  });

  const toggleRule = trpc.sync.toggleRule.useMutation({
    onSuccess: () => {
      refetchRules();
      runSync.mutate({ id: syncId });
    },
  });

  const acceptSingle = trpc.sync.acceptRecommendations.useMutation({
    onSuccess: () => {
      refetchRules();
      runSync.mutate({ id: syncId });
    },
  });

  const isBusy = toggleRule.isPending || acceptSingle.isPending || runSync.isPending;

  const handleDefaultToggle = (def: PlatformDefaultRuleMeta) => {
    const db = dbByPlainEnglish.get(def.plain_english);
    if (db) {
      // Already in DB — just flip enabled
      toggleRule.mutate({ ruleId: db.id, enabled: !db.enabled });
    } else {
      // Not yet accepted — accept it now (inserts enabled=true + runs sync)
      acceptSingle.mutate({ syncId, ruleIds: [def.id] });
    }
  };

  if (platformDefaults.length === 0 && customRules.length === 0) return null;

  const formatDefaults = platformDefaults.filter((r) => r.stage === "format");
  const validationDefaults = platformDefaults.filter((r) => r.stage === "validation" || r.stage === "quality");

  return (
    <div className="border-b border-border bg-card flex-shrink-0">
      <button
        onClick={() => setPanelOpen((o) => !o)}
        className="w-full flex items-center text-left transition-colors hover:bg-accent cursor-pointer"
      >
        <div className="flex items-center gap-2.5 px-6 py-2.5 flex-1 min-w-0">
          <div className="w-5 h-5 rounded bg-accent flex items-center justify-center flex-shrink-0">
            <Sparkles className="w-3 h-3 text-primary" />
          </div>
          <span className="text-xs font-semibold text-primary">
            {optimizationLabel}
          </span>
          <span className="text-xs text-muted-foreground">
            {totalActive} of {platformDefaults.length + customRules.length} active
          </span>
          {isBusy && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Re-running…
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 px-6 py-2.5 flex-shrink-0">
          <span className="text-xs text-primary font-medium">
            {panelOpen ? "Hide" : "Manage"}
          </span>
          {panelOpen ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
        </div>
      </button>

      {panelOpen && (
        <div className="px-6 py-4 bg-accent border-t border-border">
          <p className="text-xs text-muted-foreground mb-3">
            Toggle re-runs the sync so changes are reflected immediately in the table.
          </p>

          {/* Platform optimization rules */}
          {formatDefaults.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Format &amp; Normalization
              </div>
              <div className="flex flex-col gap-1.5">
                {formatDefaults.map((def) => {
                  const db = dbByPlainEnglish.get(def.plain_english);
                  const isOn = db?.enabled === true;
                  return (
                    <div key={def.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border">
                      <Toggle on={isOn} onToggle={() => handleDefaultToggle(def)} disabled={isBusy} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground truncate">{def.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{def.plain_english}</div>
                      </div>
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded-full flex-shrink-0",
                        platform === "google_shopping" ? "bg-info/10 text-info" : "bg-primary/10 text-primary"
                      )}>
                        {platformLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {validationDefaults.length > 0 && (
            <div className="mb-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Validation &amp; Quality
              </div>
              <div className="flex flex-col gap-1.5">
                {validationDefaults.map((def) => {
                  const db = dbByPlainEnglish.get(def.plain_english);
                  const isOn = db?.enabled === true;
                  return (
                    <div key={def.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border">
                      <Toggle on={isOn} onToggle={() => handleDefaultToggle(def)} disabled={isBusy} />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground truncate">{def.label}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">{def.plain_english}</div>
                      </div>
                      <span className={cn(
                        "text-xs px-2 py-0.5 rounded-full flex-shrink-0",
                        platform === "google_shopping" ? "bg-info/10 text-info" : "bg-primary/10 text-primary"
                      )}>
                        {platformLabel}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Custom rules from chat */}
          {customRules.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Custom
              </div>
              <div className="flex flex-col gap-1.5">
                {customRules.map((rule) => (
                  <div key={rule.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-card border border-border">
                    <Toggle
                      on={rule.enabled}
                      onToggle={() => toggleRule.mutate({ ruleId: rule.id, enabled: !rule.enabled })}
                      disabled={isBusy}
                    />
                    <span className="text-xs text-foreground flex-1">{rule.label}</span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-background text-muted-foreground border border-border flex-shrink-0">
                      Custom
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
