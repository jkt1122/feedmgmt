"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { Sparkles, Check, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PlatformDefaultRuleMeta } from "@/lib/pipeline/platform-defaults";

export function SyncRecommendations({
  syncId,
  platform,
  onAccepted,
  onDismissed,
}: {
  syncId: string;
  platform: "google_shopping" | "meta_catalog";
  onAccepted: () => void;
  onDismissed: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [dismissed, setDismissed] = useState(false);

  const { data, isLoading } = trpc.sync.getRecommendations.useQuery({ syncId });
  const acceptRules = trpc.sync.acceptRecommendations.useMutation({
    onSuccess: () => onAccepted(),
  });
  const dismissAll = trpc.sync.dismissRecommendations.useMutation({
    onSuccess: () => { setDismissed(true); onDismissed(); },
  });

  if (isLoading || !data || data.seen || dismissed) return null;
  const { recommendations } = data;
  if (recommendations.length === 0) return null;

  const platformLabel = platform === "google_shopping" ? "Google Shopping" : "Meta Catalog";
  const formatRules = recommendations.filter((r) => r.stage === "format");
  const validationRules = recommendations.filter((r) => r.stage === "validation" || r.stage === "quality");

  const toggleAccept = (id: string) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAcceptSelected = () => {
    if (accepted.size === 0) return;
    acceptRules.mutate({ syncId, ruleIds: Array.from(accepted) });
  };

  const handleAcceptAll = () => {
    acceptRules.mutate({ syncId, ruleIds: ["__all__"] });
  };

  return (
    <div className="border-b border-border bg-card flex-shrink-0">
      {/* Header strip */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 px-6 py-3 hover:bg-accent transition-colors text-left"
      >
        <div className="w-6 h-6 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-3.5 h-3.5 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-foreground">
            {recommendations.length} {platformLabel} rules recommended
          </span>
          <span className="text-xs text-muted-foreground ml-2">Review and accept to apply to this sync</span>
        </div>
        <span className="text-xs font-medium text-primary">
          {expanded ? "Collapse" : "Review"}
        </span>
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
      </button>

      {expanded && (
        <div className="px-6 pb-5 bg-accent border-t border-border">
          <p className="text-xs text-muted-foreground mt-4 mb-4 leading-relaxed">
            These rules follow {platformLabel} best practices and specs. Accept the ones you want — they will run on every sync and appear in your rules panel.
          </p>

          <div className="flex flex-col gap-2 mb-4">
            {formatRules.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Format &amp; Normalization</div>
                {formatRules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    accepted={accepted.has(rule.id)}
                    onToggle={() => toggleAccept(rule.id)}
                  />
                ))}
              </div>
            )}
            {validationRules.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 mt-3">Validation &amp; Quality</div>
                {validationRules.map((rule) => (
                  <RuleRow
                    key={rule.id}
                    rule={rule}
                    accepted={accepted.has(rule.id)}
                    onToggle={() => toggleAccept(rule.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-3 border-t border-border">
            <Button size="sm" onClick={handleAcceptAll} disabled={acceptRules.isPending}>
              <Check />
              {acceptRules.isPending ? "Applying…" : "Accept all"}
            </Button>
            {accepted.size > 0 && (
              <Button variant="outline" size="sm" onClick={handleAcceptSelected} disabled={acceptRules.isPending}>
                Accept selected ({accepted.size})
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dismissAll.mutate({ syncId })}
              disabled={dismissAll.isPending}
              className="ml-auto"
            >
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  accepted,
  onToggle,
}: {
  rule: PlatformDefaultRuleMeta;
  accepted: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all mb-1",
        accepted
          ? "border-primary bg-accent"
          : "border-border bg-card hover:border-muted-foreground/40"
      )}
    >
      <div className={cn(
        "w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-colors",
        accepted ? "bg-primary border-primary" : "border-border bg-background"
      )}>
        {accepted && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className={cn("text-xs font-medium truncate", accepted ? "text-primary" : "text-foreground")}>
          {rule.label}
        </div>
        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{rule.plain_english}</div>
      </div>
      <span className={cn(
        "text-xs px-2 py-0.5 rounded-full flex-shrink-0",
        rule.stage === "format" ? "bg-info/10 text-info" :
        rule.stage === "quality" ? "bg-warning/10 text-warning" :
        "bg-destructive/10 text-destructive"
      )}>
        {rule.stage}
      </span>
    </button>
  );
}
