"use client";

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Send, Loader2, Sparkles, BookmarkPlus, Check, ScanSearch } from "lucide-react";
import type { ChatResult } from "@/lib/pipeline/chat";
import type { AuditReport, AuditFinding } from "@/lib/pipeline/audit";
import type { PlatformDefaultRuleMeta } from "@/lib/pipeline/platform-defaults";

type AuditPayload = AuditReport & { type: "audit_report" };

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  payload?: (ChatResult & { type?: never }) | AuditPayload | null;
  created_at: string;
};

// Synthetic recommendation message shown before any user interaction
type RecommendationState = "pending" | "accepted" | "dismissed";

export function SyncChat({
  syncId,
  syncName,
  platform,
  recommendationsSeen,
  onRulesChanged,
}: {
  syncId: string;
  syncName: string;
  platform: "google_shopping" | "meta_catalog";
  recommendationsSeen: boolean;
  onRulesChanged: () => void;
}) {
  // Auto-open when there are pending recommendations
  const [open, setOpen] = useState(!recommendationsSeen);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const pendingRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  // Recommendation state
  const [recState, setRecState] = useState<RecommendationState>(
    recommendationsSeen ? "dismissed" : "pending"
  );
  const [selectedRecs, setSelectedRecs] = useState<Set<string>>(new Set());
  const [rerunning, setRerunning] = useState(false);

  const platformLabel = platform === "google_shopping" ? "Google Shopping" : "Meta Catalog";
  const utils = trpc.useUtils();

  const { data: recData } = trpc.sync.getRecommendations.useQuery(
    { syncId },
    { enabled: recState === "pending" }
  );
  const recommendations: PlatformDefaultRuleMeta[] = recData?.recommendations ?? [];

  const runSync = trpc.sync.run.useMutation({
    onSuccess: () => {
      utils.sync.get.invalidate({ id: syncId });
      utils.sync.getRules.invalidate({ syncId });
      utils.sync.getRecommendations.invalidate({ syncId });
      utils.sync.getProducts.invalidate({ id: syncId });
      setRerunning(false);
    },
    onError: () => setRerunning(false),
  });

  const acceptRules = trpc.sync.acceptRecommendations.useMutation({
    onSuccess: () => {
      setRecState("accepted");
      setRerunning(true);
      runSync.mutate({ id: syncId });
    },
  });

  const dismissRecs = trpc.sync.dismissRecommendations.useMutation({
    onSuccess: () => setRecState("dismissed"),
  });

  const getOrCreate = trpc.chat.getOrCreateSession.useMutation({
    onSuccess: (session) => {
      setSessionId(session.id);
      if (pendingRef.current) {
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending === "__audit__") {
          runAudit.mutate({ syncId, sessionId: session.id });
        } else {
          sendMsg.mutate({ sessionId: session.id, syncId, message: pending });
        }
      }
    },
  });

  const sendMsg = trpc.chat.sendSyncMessage.useMutation({
    onSuccess: (msg) => {
      if (msg) setMessages((m) => [...m, msg as Message]);
    },
  });

  const applyOp = trpc.chat.applySyncOperation.useMutation({
    onSuccess: (_, vars) => {
      setAppliedIds((s) => new Set(s).add(vars.messageId));
      if (vars.saveAsRule) setSavedIds((s) => new Set(s).add(vars.messageId));
      onRulesChanged();
    },
  });

  const runAudit = trpc.chat.runSyncAudit.useMutation({
    onSuccess: (msg) => {
      if (msg) setMessages((m) => [...m, msg as Message]);
    },
  });

  useEffect(() => {
    if (open && !sessionId) {
      getOrCreate.mutate({ contextType: "sync", contextId: syncId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, syncId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, recState]);

  const submit = () => {
    const msg = input.trim();
    if (!msg) return;
    setInput("");
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", content: msg, created_at: new Date().toISOString() },
    ]);
    if (!sessionId) {
      pendingRef.current = msg;
      getOrCreate.mutate({ contextType: "sync", contextId: syncId });
    } else {
      sendMsg.mutate({ sessionId, syncId, message: msg });
    }
  };

  const toggleRec = (id: string) =>
    setSelectedRecs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const handleSelectAll = () => {
    if (selectedRecs.size === recommendations.length) setSelectedRecs(new Set());
    else setSelectedRecs(new Set(recommendations.map((r) => r.id)));
  };

  const handleAcceptSelected = () => {
    const ids = selectedRecs.size > 0 ? Array.from(selectedRecs) : ["__all__"];
    acceptRules.mutate({ syncId, ruleIds: ids });
  };

  const handleAcceptAll = () => acceptRules.mutate({ syncId, ruleIds: ["__all__"] });

  const isLoading = sendMsg.isPending || getOrCreate.isPending || runAudit.isPending;

  const handleAudit = () => {
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", content: "Audit my feed", created_at: new Date().toISOString() },
    ]);
    if (!sessionId) {
      // create session first, then fire audit via pendingRef equivalent
      pendingRef.current = "__audit__";
      getOrCreate.mutate({ contextType: "sync", contextId: syncId });
    } else {
      runAudit.mutate({ syncId, sessionId });
    }
  };

  const formatRules = recommendations.filter((r) => r.stage === "format");
  const validationRules = recommendations.filter((r) => r.stage === "validation" || r.stage === "quality");

  return (
    <div className={cn(
      "border-t-2 border-primary bg-card flex flex-col flex-shrink-0 transition-all duration-200",
      open ? "h-[380px]" : "h-11"
    )}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-11 flex items-center gap-2.5 px-5 flex-shrink-0 border-b border-border hover:bg-accent transition-colors w-full text-left"
      >
        <div className="w-5 h-5 rounded-md bg-primary flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-3 h-3 text-primary-foreground" />
        </div>
        <span className="text-sm font-bold text-foreground">Feed Assistant</span>
        <span className="text-xs text-muted-foreground font-mono">· {syncName} · {platformLabel}</span>
        {recState === "pending" && recommendations.length > 0 && (
          <span className="ml-1 text-xs font-semibold text-primary-foreground bg-primary px-1.5 py-0.5 rounded-full">
            {recommendations.length} recommendations
          </span>
        )}
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground border border-border rounded px-2 py-0.5 bg-background">
          {open ? "Collapse" : "Expand"}
        </span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>

      {open && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-3 min-h-0">

            {/* Recommendation message — shown as a structured assistant message */}
            {recState === "pending" && recommendations.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Feed Assistant</div>
                <div className="bg-background border border-border rounded-xl overflow-hidden max-w-[92%]">
                  {/* Message body */}
                  <div className="px-4 py-3">
                    <p className="text-sm text-foreground leading-relaxed mb-3">
                      I can help make this feed ready for <strong>{platformLabel}</strong>. Here are recommended changes based on platform specs and best practices:
                    </p>

                    {/* Format rules */}
                    {formatRules.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Format &amp; Normalization</div>
                        <div className="flex flex-col gap-1">
                          {formatRules.map((rule) => (
                            <button
                              key={rule.id}
                              type="button"
                              onClick={() => toggleRec(rule.id)}
                              className={cn(
                                "flex items-start gap-2.5 px-3 py-2 rounded-lg border text-left transition-all",
                                selectedRecs.has(rule.id)
                                  ? "border-primary bg-accent"
                                  : "border-border bg-card hover:border-muted-foreground/40"
                              )}
                            >
                              <div className={cn(
                                "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors",
                                selectedRecs.has(rule.id) ? "bg-primary border-primary" : "border-border bg-background"
                              )}>
                                {selectedRecs.has(rule.id) && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-foreground">{rule.label}</div>
                                <div className="text-xs text-muted-foreground mt-0.5">{rule.plain_english}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Validation rules */}
                    {validationRules.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">Validation &amp; Quality Checks</div>
                        <div className="flex flex-col gap-1">
                          {validationRules.map((rule) => (
                            <button
                              key={rule.id}
                              type="button"
                              onClick={() => toggleRec(rule.id)}
                              className={cn(
                                "flex items-start gap-2.5 px-3 py-2 rounded-lg border text-left transition-all",
                                selectedRecs.has(rule.id)
                                  ? "border-primary bg-accent"
                                  : "border-border bg-card hover:border-muted-foreground/40"
                              )}
                            >
                              <div className={cn(
                                "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors",
                                selectedRecs.has(rule.id) ? "bg-primary border-primary" : "border-border bg-background"
                              )}>
                                {selectedRecs.has(rule.id) && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-foreground">{rule.label}</div>
                                <div className="text-xs text-muted-foreground mt-0.5">{rule.plain_english}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions footer */}
                  <div className="px-4 py-2.5 border-t border-border bg-card flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={handleAcceptAll}
                      disabled={acceptRules.isPending}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      <Check className="w-3 h-3" />
                      {acceptRules.isPending ? "Applying…" : "Accept all"}
                    </button>
                    {selectedRecs.size > 0 && selectedRecs.size < recommendations.length && (
                      <button
                        type="button"
                        onClick={handleAcceptSelected}
                        disabled={acceptRules.isPending}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-primary text-primary hover:bg-accent transition-colors disabled:opacity-50"
                      >
                        Accept selected ({selectedRecs.size})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSelectAll()}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {selectedRecs.size === recommendations.length ? "Deselect all" : "Select all"}
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissRecs.mutate({ syncId })}
                      disabled={dismissRecs.isPending}
                      className="text-xs text-muted-foreground hover:text-foreground ml-auto transition-colors"
                    >
                      Skip for now
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Accepted confirmation */}
            {recState === "accepted" && (
              <div className="flex flex-col gap-1.5">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Feed Assistant</div>
                <div className="bg-background border border-border rounded-xl px-4 py-3 max-w-[92%] text-sm text-muted-foreground leading-relaxed">
                  {rerunning ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary flex-shrink-0" />
                      <span>Rules saved — re-running sync to apply them…</span>
                    </span>
                  ) : (
                    <>
                      <span className="text-success font-semibold">✓ Done.</span> The sync has been re-run with the accepted rules. You can toggle them on/off in the rules panel above, or ask me to add more.
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Empty state with prominent audit CTA */}
            {messages.length === 0 && recState !== "pending" && (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={handleAudit}
                  disabled={isLoading}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-primary bg-accent hover:bg-accent/80 transition-colors text-left disabled:opacity-50"
                >
                  <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
                    <ScanSearch className="w-4 h-4 text-primary-foreground" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">Audit my feed</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Find issues, missing fields, and optimization opportunities</div>
                  </div>
                </button>
                <p className="text-xs text-muted-foreground px-1">
                  Or ask me to optimize titles, fix missing fields, or add custom rules to this sync.
                </p>
              </div>
            )}

            {messages.map((msg) => {
              if (msg.role === "user") {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="bg-primary text-primary-foreground text-sm px-3 py-2 rounded-xl max-w-xs">
                      {msg.content.split("\n\n[Proposed")[0]}
                    </div>
                  </div>
                );
              }

              // Audit report message
              const payload = msg.payload as (ChatResult & { type?: never }) | AuditPayload | null;
              if (payload && "type" in payload && payload.type === "audit_report") {
                const report = payload as AuditPayload;
                const warnings = report.findings.filter((f) => f.tier === "warning");
                const opportunities = report.findings.filter((f) => f.tier === "opportunity");
                const ok = report.findings.filter((f) => f.tier === "ok");
                return (
                  <AuditReportMessage
                    key={msg.id}
                    report={report}
                    warnings={warnings}
                    opportunities={opportunities}
                    ok={ok}
                    syncId={syncId}
                    onRuleSaved={onRulesChanged}
                    setInput={setInput}
                  />
                );
              }

              // Regular chat message
              const chatPayload = payload as ChatResult | null;
              const hasRule = chatPayload?.rule != null && !chatPayload?.is_question;
              const isApplied = appliedIds.has(msg.id);
              const isSaved = savedIds.has(msg.id);

              return (
                <div key={msg.id} className="flex flex-col gap-1.5 max-w-[88%]">
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Feed Assistant</div>
                  <div className="bg-background border border-border rounded-xl overflow-hidden text-sm">
                    <div className="px-4 py-3 text-muted-foreground leading-relaxed">
                      {chatPayload?.explanation ?? msg.content.split("\n\n[Proposed")[0]}
                    </div>
                    {hasRule && (
                      <div className="px-4 py-2.5 border-t border-border bg-card flex items-center gap-2">
                        {isApplied ? (
                          <span className="text-xs text-success font-medium">
                            {isSaved ? "✓ Saved to sync rules" : "✓ Applied"}
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                applyOp.mutate({ sessionId: sessionId!, messageId: msg.id, syncId, saveAsRule: true })
                              }
                              disabled={applyOp.isPending}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                            >
                              <BookmarkPlus className="w-3 h-3" />
                              Save to sync
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                applyOp.mutate({ sessionId: sessionId!, messageId: msg.id, syncId, saveAsRule: false })
                              }
                              disabled={applyOp.isPending}
                              className="text-xs font-medium text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-lg border border-border hover:bg-background transition-colors"
                            >
                              Apply once
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3 h-3 animate-spin" />
                Thinking…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-5 pb-3 pt-2 flex-shrink-0">
            {/* Suggestion chips — shown when there are messages and input is empty */}
            {!input && messages.length > 0 && recState !== "pending" && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {[
                  platform === "google_shopping"
                    ? "Optimize titles for Google Shopping"
                    : "Optimize titles for Meta Catalog",
                  "Fix a specific product by ID",
                  "Add custom label for price tier",
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setInput(suggestion)}
                    className="text-xs text-muted-foreground px-2.5 py-1 rounded-full border border-border bg-background hover:border-primary hover:text-primary transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 items-center">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submit()}
                placeholder="Ask the assistant to optimize, fix, or adjust any product or field…"
                className="flex-1 text-sm bg-background border border-border rounded-xl px-4 py-2 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
              <button
                type="button"
                onClick={submit}
                disabled={!input.trim() || isLoading}
                className="w-9 h-9 bg-primary rounded-xl flex items-center justify-center text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-1.5 px-1">
              Changes apply to this sync only · source data is never modified · you can fix individual products by ID
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function AuditReportMessage({
  report,
  warnings,
  opportunities,
  ok,
  syncId,
  onRuleSaved,
  setInput,
}: {
  report: AuditPayload;
  warnings: AuditFinding[];
  opportunities: AuditFinding[];
  ok: AuditFinding[];
  syncId: string;
  onRuleSaved: () => void;
  setInput: (v: string) => void;
}) {
  const [savedRuleIds, setSavedRuleIds] = useState<Set<number>>(new Set());
  const [savingIdx, setSavingIdx] = useState<number | null>(null);

  const saveAuditRule = trpc.chat.saveAuditRule.useMutation({
    onSuccess: () => {
      onRuleSaved();
    },
  });

  const tierIcon = (tier: AuditFinding["tier"]) => {
    if (tier === "ok") return <span className="text-success font-bold text-sm">✓</span>;
    if (tier === "warning") return <span className="text-warning font-bold text-sm">▲</span>;
    return <span className="text-primary font-bold text-sm">✦</span>;
  };

  const renderFindings = (findings: AuditFinding[], startIndex: number) =>
    findings.map((finding, i) => {
      const idx = startIndex + i;
      return (
        <div key={idx} className="flex items-start gap-2.5 py-2.5 border-b border-border last:border-0">
          <div className="w-5 flex-shrink-0 flex justify-center pt-0.5">{tierIcon(finding.tier)}</div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-mono text-muted-foreground bg-card border border-border rounded px-1.5 py-0.5">
                {finding.field}
              </span>
              {finding.scope === "pattern" && finding.affected_count > 1 && (
                <span className="text-xs text-muted-foreground">{finding.affected_count} products</span>
              )}
            </div>
            <p className="text-xs text-foreground mt-1 leading-relaxed">{finding.message}</p>
            {/* Actions */}
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {finding.scope === "pattern" && finding.suggested_rule && (
                savedRuleIds.has(idx) ? (
                  <span className="text-xs text-success font-medium">✓ Rule saved</span>
                ) : (
                  <button
                    type="button"
                    disabled={savingIdx === idx || saveAuditRule.isPending}
                    onClick={() => {
                      setSavingIdx(idx);
                      saveAuditRule.mutate(
                        { syncId, rule: finding.suggested_rule! },
                        {
                          onSuccess: () => {
                            setSavedRuleIds((s) => new Set(s).add(idx));
                            setSavingIdx(null);
                          },
                          onError: () => setSavingIdx(null),
                        }
                      );
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                  >
                    {savingIdx === idx ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookmarkPlus className="w-3 h-3" />}
                    Fix all {finding.affected_count} products
                  </button>
                )
              )}
              {finding.scope === "single" && (
                <button
                  type="button"
                  onClick={() =>
                    setInput(
                      finding.affected_row_indexes?.length
                        ? `Fix product at row ${finding.affected_row_indexes[0]}: ${finding.message}`
                        : finding.message
                    )
                  }
                  className="text-xs text-primary hover:underline transition-colors"
                >
                  Fix this product →
                </button>
              )}
            </div>
          </div>
        </div>
      );
    });

  return (
    <div className="flex flex-col gap-1.5 max-w-[92%]">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Feed Assistant</div>
      <div className="bg-background border border-border rounded-xl overflow-hidden text-sm">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm text-muted-foreground leading-relaxed">{report.summary}</p>
        </div>
        <div className="divide-y divide-border">
          {warnings.length > 0 && (
            <div className="px-4 py-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Issues</div>
              {renderFindings(warnings, 0)}
            </div>
          )}
          {opportunities.length > 0 && (
            <div className="px-4 py-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Opportunities</div>
              {renderFindings(opportunities, warnings.length)}
            </div>
          )}
          {ok.length > 0 && (
            <div className="px-4 py-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Looking Good</div>
              {renderFindings(ok, warnings.length + opportunities.length)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
