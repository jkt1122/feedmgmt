"use client";

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Send, Loader2, Sparkles, BookmarkPlus, Check, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChatResult } from "@/lib/pipeline/chat";
import type { AuditReport, AuditFinding } from "@/lib/pipeline/audit";
import type { PipelineRuleSpec } from "@/lib/pipeline/rule-schema";

type AuditPayload = AuditReport & { type: "audit_report" };

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  payload?: (ChatResult & { type?: never }) | AuditPayload | null;
  created_at: string;
};

// Synthetic recommendation message shown before any user interaction
type RecommendationState = "pending" | "dismissed";

type RuleProposal = {
  id: string;
  fingerprint: string;
  origin: "basic_fix" | "platform_spec" | "agent_reasoned" | "user_request";
  scope: "sync";
  rule: PipelineRuleSpec;
  dry_run: {
    affected_count: number;
    examples: { row_index: number; field: string; before: string; after: string }[];
  };
};

function isAuditIntent(message: string) {
  const normalized = message.toLowerCase();
  return (
    /\b(audit|check|scan|inspect)\b.*\b(feed|data|data source|source|products?)\b/.test(normalized) ||
    /\b(find|run)\b.*\b(additional|more)\b.*\b(issues?|checks?|opportunities)\b/.test(normalized) ||
    /\b(additional|more)\b.*\b(issues?|checks?|opportunities)\b/.test(normalized)
  );
}

export function SyncChat({
  syncId,
  platform,
  recommendationsSeen,
  onRulesChanged,
}: {
  syncId: string;
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
  const feedbackTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());

  // Recommendation state
  const [recState, setRecState] = useState<RecommendationState>(
    "pending"
  );
  const [reviewIntroSeen, setReviewIntroSeen] = useState(false);
  const [rerunning, setRerunning] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState<string | null>(null);
  const [reviewFeedbackFading, setReviewFeedbackFading] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [revisedRecommendation, setRevisedRecommendation] = useState<RuleProposal | null>(null);

  const platformLabel = platform === "google_shopping" ? "Google Shopping" : "Meta Catalog";
  const utils = trpc.useUtils();

  const { data: proposalData } = trpc.proposals.list.useQuery(
    { syncId },
    { enabled: recState === "pending" }
  );
  const recommendations = (proposalData?.proposals ?? []) as RuleProposal[];

  const runSync = trpc.sync.run.useMutation({
    onSuccess: () => {
      utils.sync.get.invalidate({ id: syncId });
      utils.sync.getRules.invalidate({ syncId });
      utils.sync.getRecommendations.invalidate({ syncId });
      utils.sync.getProducts.invalidate({ id: syncId });
      utils.proposals.list.invalidate({ syncId });
      setRerunning(false);
    },
    onError: () => setRerunning(false),
  });

  const showReviewFeedback = (message: string, onDone?: () => void) => {
    feedbackTimersRef.current.forEach(clearTimeout);
    feedbackTimersRef.current = [];
    setReviewFeedback(message);
    setReviewFeedbackFading(false);

    feedbackTimersRef.current = [
      setTimeout(() => setReviewFeedbackFading(true), 1400),
      setTimeout(() => {
        setReviewFeedback(null);
        setReviewFeedbackFading(false);
        onDone?.();
      }, 2200),
    ];
  };

  const acceptRule = trpc.proposals.accept.useMutation({
    onSuccess: () => {
      showReviewFeedback(
        "Fixed. This will be applied on future resyncs and can be changed under Manage optimizations.",
        () => setRevisedRecommendation(null)
      );
      setFeedbackOpen(false);
      setFeedbackText("");
      setFeedbackMessage(null);
      setRerunning(true);
      runSync.mutate({ id: syncId });
    },
  });

  const rejectRule = trpc.proposals.reject.useMutation({
    onSuccess: () => {
      setFeedbackOpen(false);
      setFeedbackText("");
      setFeedbackMessage(null);
      setRevisedRecommendation(null);
      showReviewFeedback(
        "Rejected for this sync. You can change it later under Manage optimizations.",
        () => utils.proposals.list.invalidate({ syncId })
      );
    },
  });

  const sendFeedback = trpc.proposals.feedback.useMutation({
    onSuccess: (result) => {
      if (result.type === "updated_proposal") {
        setRevisedRecommendation(result.proposal as RuleProposal);
        setFeedbackOpen(false);
        setFeedbackText("");
        setFeedbackMessage(result.message);
        return;
      }

      if (result.type === "suppress_similar") {
        setFeedbackOpen(false);
        setFeedbackText("");
        setFeedbackMessage(null);
        setRevisedRecommendation(null);
        showReviewFeedback(result.message, () => utils.proposals.list.invalidate({ syncId }));
        return;
      }

      setFeedbackMessage(result.message);
    },
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

  const rejectOp = trpc.chat.rejectSyncOperation.useMutation({
    onSuccess: (_, vars) => {
      setRejectedIds((s) => new Set(s).add(vars.messageId));
      utils.proposals.list.invalidate({ syncId });
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
    return () => {
      feedbackTimersRef.current.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, recState]);

  useEffect(() => {
    if (recState === "pending" && proposalData && recommendations.length === 0) {
      setRecState("dismissed");
    }
  }, [proposalData, recState, recommendations.length]);

  const submit = () => {
    const msg = input.trim();
    if (!msg) return;
    setInput("");
    if (isAuditIntent(msg)) {
      startAudit(msg);
      return;
    }
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

  const currentRecommendation = revisedRecommendation ?? recommendations[0] ?? null;
  const isReviewingRecommendations = recState === "pending" && recommendations.length > 0;
  const showReviewIntro = isReviewingRecommendations && !reviewIntroSeen && !reviewFeedback;
  const isWorkingRecommendation = acceptRule.isPending || rejectRule.isPending || rerunning || sendFeedback.isPending || Boolean(reviewFeedback);

  const handleAcceptRecommendation = () => {
    if (!currentRecommendation) return;
    acceptRule.mutate({
      syncId,
      proposalId: currentRecommendation.id,
      origin: currentRecommendation.origin,
      rule: currentRecommendation.rule,
    });
  };

  const handleRejectRecommendation = () => {
    if (!currentRecommendation) return;
    rejectRule.mutate({
      syncId,
      proposalId: currentRecommendation.id,
      origin: currentRecommendation.origin,
      rule: currentRecommendation.rule,
    });
  };

  const handleFeedbackSubmit = () => {
    const feedback = feedbackText.trim();
    if (!currentRecommendation || !feedback) return;
    setFeedbackMessage(null);
    sendFeedback.mutate({
      syncId,
      proposalId: currentRecommendation.id,
      origin: currentRecommendation.origin,
      rule: currentRecommendation.rule,
      feedback,
      examples: currentRecommendation.dry_run.examples,
    });
  };

  const isLoading = sendMsg.isPending || getOrCreate.isPending || runAudit.isPending;

  const startAudit = (label: string) => {
    setMessages((m) => [
      ...m,
      { id: crypto.randomUUID(), role: "user", content: label, created_at: new Date().toISOString() },
    ]);
    if (!sessionId) {
      // create session first, then fire audit via pendingRef equivalent
      pendingRef.current = "__audit__";
      getOrCreate.mutate({ contextType: "sync", contextId: syncId });
    } else {
      runAudit.mutate({ syncId, sessionId });
    }
  };

  const handleAudit = () => startAudit("Find additional issues on the data");

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
            {isReviewingRecommendations && (
              <div className="flex flex-col gap-1.5">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Feed Assistant</div>
                <div className="bg-background border border-border rounded-xl max-w-[92%]">
                  <div className="px-4 py-3">
                    {reviewFeedback ? (
                      <div
                        className={cn(
                          "rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground transition-opacity duration-700",
                          reviewFeedbackFading && "opacity-0"
                        )}
                      >
                        {reviewFeedback}
                      </div>
                    ) : showReviewIntro ? (
                      <div className="space-y-2">
                        <p className="text-sm text-foreground leading-relaxed">
                          I can inspect the source data, fix feed issues, and prepare a clean output optimized for <strong>{platformLabel}</strong>.
                        </p>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          I’ll walk you through each recommendation so accepted fixes can be applied automatically on future resyncs.
                        </p>
                      </div>
                    ) : currentRecommendation && (
                      <div className="rounded-lg border border-border bg-card px-3 py-2">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {revisedRecommendation ? "Updated recommendation" : "Next recommendation"}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {recommendations.length} remaining
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="text-xs font-medium text-foreground">{currentRecommendation.rule.label}</div>
                          <div className="text-xs text-muted-foreground font-data">{currentRecommendation.dry_run.affected_count} rows</div>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{currentRecommendation.rule.plain_english}</div>
                        <ProposalExamples proposal={currentRecommendation} />
                      </div>
                    )}
                    {feedbackMessage && !reviewFeedback && (
                      <div className="mt-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                        {feedbackMessage}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

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
                    <div className="text-sm font-semibold text-foreground">Find additional issues on the data</div>
                    <div className="text-xs text-muted-foreground mt-0.5">AI will go through your data again to find additional issues and optimization opportunities</div>
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
                  />
                );
              }

              // Regular chat message
              const chatPayload = payload as ChatResult | null;
              const hasRule = chatPayload?.rule != null && !chatPayload?.is_question;
              const isApplied = appliedIds.has(msg.id);
              const isSaved = savedIds.has(msg.id);
              const isRejected = rejectedIds.has(msg.id);

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
                          <div>
                            <div className="text-xs text-success font-medium">
                              {isSaved ? "✓ Fixed" : "✓ Applied"}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              The same fix will be applied whenever this sync runs. You can change it under Manage optimizations.
                            </div>
                          </div>
                        ) : isRejected ? (
                          <div>
                            <div className="text-xs text-muted-foreground font-medium">
                              Rejected for this sync
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              You can change this later under Manage optimizations.
                            </div>
                          </div>
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
                              onClick={() => rejectOp.mutate({ messageId: msg.id, syncId })}
                              disabled={rejectOp.isPending}
                              className="text-xs font-medium text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-lg border border-border hover:bg-background transition-colors"
                            >
                              Reject
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
            {isReviewingRecommendations ? (
              <div className="flex gap-2 items-center justify-end">
                {reviewFeedback ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Preparing next recommendation…
                  </div>
                ) : showReviewIntro ? (
                  <Button
                    type="button"
                    size="lg"
                    onClick={() => setReviewIntroSeen(true)}
                    className="ml-auto"
                  >
                    Continue
                  </Button>
                ) : feedbackOpen ? (
                  <>
                    <Input
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleFeedbackSubmit()}
                      placeholder="Tell the assistant what to change about this recommendation"
                      className="flex-1"
                      disabled={sendFeedback.isPending}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="lg"
                      onClick={() => {
                        setFeedbackOpen(false);
                        setFeedbackText("");
                        setFeedbackMessage(null);
                      }}
                      disabled={sendFeedback.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="lg"
                      onClick={handleFeedbackSubmit}
                      disabled={!feedbackText.trim() || sendFeedback.isPending}
                    >
                      {sendFeedback.isPending ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Send className="w-3 h-3" />
                      )}
                      Send
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="lg"
                      onClick={handleRejectRecommendation}
                      disabled={isWorkingRecommendation}
                    >
                      {rejectRule.isPending ? "Rejecting…" : "Reject"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="lg"
                      onClick={() => {
                        setFeedbackOpen(true);
                        setFeedbackMessage(null);
                      }}
                      disabled={isWorkingRecommendation}
                    >
                      Give feedback
                    </Button>
                    <Button
                      type="button"
                      size="lg"
                      onClick={handleAcceptRecommendation}
                      disabled={isWorkingRecommendation}
                    >
                      <Check className="w-3 h-3" />
                      {acceptRule.isPending || rerunning ? "Applying…" : "Accept"}
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <>
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
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submit()}
                    placeholder="Ask the assistant to update a specific row or multiple rows"
                    className="flex-1"
                  />
                  <Button
                    size="icon-lg"
                    onClick={submit}
                    disabled={!input.trim() || isLoading}
                    className="shrink-0"
                  >
                    <Send />
                  </Button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ProposalExamples({ proposal }: { proposal: RuleProposal }) {
  if (proposal.dry_run.examples.length === 0) return null;

  return (
    <div className="mt-2 space-y-1">
      {proposal.dry_run.examples.slice(0, 2).map((example) => (
        <div
          key={`${proposal.id}-${example.row_index}`}
          className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        >
          <span className="text-muted-foreground font-data">#{example.row_index + 1}</span>
          <span className="truncate text-muted-foreground" title={example.before}>
            {example.before || "blank"}
          </span>
          <span className="text-muted-foreground">→</span>
          <span className="truncate text-foreground" title={example.after}>
            {example.after || "flagged"}
          </span>
        </div>
      ))}
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
}: {
  report: AuditPayload;
  warnings: AuditFinding[];
  opportunities: AuditFinding[];
  ok: AuditFinding[];
  syncId: string;
  onRuleSaved: () => void;
}) {
  const [savedRuleIds, setSavedRuleIds] = useState<Set<number>>(new Set());
  const [rejectedRuleIds, setRejectedRuleIds] = useState<Set<number>>(new Set());
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [feedbackIdx, setFeedbackIdx] = useState<number | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [revisedAuditProposal, setRevisedAuditProposal] = useState<RuleProposal | null>(null);

  const saveAuditRule = trpc.chat.saveAuditRule.useMutation({
    onSuccess: () => {
      onRuleSaved();
    },
  });
  const rejectAuditRule = trpc.proposals.reject.useMutation();
  const sendAuditFeedback = trpc.proposals.feedback.useMutation({
    onSuccess: (result) => {
      if (result.type === "updated_proposal") {
        setRevisedAuditProposal(result.proposal as RuleProposal);
        setFeedbackIdx(null);
        setFeedbackText("");
        setFeedbackMessage(result.message);
        return;
      }

      if (result.type === "suppress_similar" && currentAction) {
        setRevisedAuditProposal(null);
        setFeedbackIdx(null);
        setFeedbackText("");
        setFeedbackMessage(null);
        setRejectedRuleIds((s) => new Set(s).add(currentAction.idx));
        return;
      }

      setFeedbackMessage(result.message);
    },
  });

  const tierIcon = (tier: AuditFinding["tier"]) => {
    if (tier === "ok") return <span className="text-success font-bold text-sm">✓</span>;
    if (tier === "warning") return <span className="text-warning font-bold text-sm">▲</span>;
    return <span className="text-primary font-bold text-sm">✦</span>;
  };

  const allFindings = [...warnings, ...opportunities, ...ok].map((finding, idx) => ({
    finding,
    idx,
  }));
  const actionableFindings = allFindings.filter(({ finding }) => finding.suggested_rule);
  const currentAction = actionableFindings.find(
    ({ idx }) => !savedRuleIds.has(idx) && !rejectedRuleIds.has(idx)
  );
  const completedAction = [...actionableFindings]
    .reverse()
    .find(({ idx }) => savedRuleIds.has(idx) || rejectedRuleIds.has(idx));
  const remainingActionCount = actionableFindings.filter(
    ({ idx }) => !savedRuleIds.has(idx) && !rejectedRuleIds.has(idx)
  ).length;
  const otherFindings = allFindings.filter(({ finding }) => !finding.suggested_rule);

  const renderExamples = (finding: AuditFinding, idx: number) => {
    if (!finding.dry_run?.examples?.length) return null;

    return (
      <div className="mt-2 space-y-1">
        {finding.dry_run.examples.slice(0, 2).map((example) => (
          <div
            key={`${idx}-${example.row_index}`}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1.5 text-xs"
          >
            <span className="text-muted-foreground font-data">#{example.row_index + 1}</span>
            <span className="truncate text-muted-foreground" title={example.before}>
              {example.before || "blank"}
            </span>
            <span className="text-muted-foreground">→</span>
            <span className="truncate text-foreground" title={example.after}>
              {example.after || "flagged"}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const currentRule = revisedAuditProposal?.rule ?? currentAction?.finding.suggested_rule ?? null;
  const currentExamples = revisedAuditProposal?.dry_run.examples ?? currentAction?.finding.dry_run?.examples ?? [];
  const currentField =
    revisedAuditProposal && "field" in revisedAuditProposal.rule.action
      ? revisedAuditProposal.rule.action.field
      : currentAction?.finding.field ?? "";
  const currentAffectedCount = revisedAuditProposal?.dry_run.affected_count ?? currentAction?.finding.affected_count ?? 0;
  const currentMessage = revisedAuditProposal?.rule.plain_english ?? currentAction?.finding.message ?? "";

  const submitAuditFeedback = () => {
    const feedback = feedbackText.trim();
    if (!currentAction || !currentRule || !feedback) return;
    setFeedbackMessage(null);
    sendAuditFeedback.mutate({
      syncId,
      proposalId: `audit-${currentAction.idx}`,
      origin: revisedAuditProposal?.origin ?? "agent_reasoned",
      rule: currentRule,
      feedback,
      examples: currentExamples,
    });
  };

  return (
    <div className="flex flex-col gap-1.5 max-w-[92%]">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Feed Assistant</div>
      <div className="bg-background border border-border rounded-xl overflow-hidden text-sm">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm text-muted-foreground leading-relaxed">{report.summary}</p>
        </div>
        <div className="px-4 py-3">
          {completedAction && (
            <div className="mb-3 rounded-lg border border-border bg-card px-3 py-2">
              {savedRuleIds.has(completedAction.idx) ? (
                <>
                  <div className="text-xs text-success font-medium">✓ Fixed</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    The same fix will be applied whenever this sync runs. You can change it under Manage optimizations.
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xs text-muted-foreground font-medium">Rejected for this sync</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    You can change this later under Manage optimizations.
                  </div>
                </>
              )}
            </div>
          )}

          {currentAction ? (
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {revisedAuditProposal ? "Updated recommendation" : "Next recommendation"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {remainingActionCount} remaining
                  </span>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="w-5 flex-shrink-0 flex justify-center">{tierIcon(currentAction.finding.tier)}</span>
                  <span className="text-xs font-mono text-muted-foreground bg-background border border-border rounded px-1.5 py-0.5">
                    {currentField}
                  </span>
                  {currentAffectedCount > 0 && (
                    <span className="text-xs text-muted-foreground">
                      {currentAffectedCount} {currentAffectedCount === 1 ? "product" : "products"}
                    </span>
                  )}
                </div>
                <p className="text-xs text-foreground mt-1 leading-relaxed">
                  {currentMessage}
                </p>
                {revisedAuditProposal ? (
                  <ProposalExamples proposal={revisedAuditProposal} />
                ) : (
                  renderExamples(currentAction.finding, currentAction.idx)
                )}
                {feedbackMessage && (
                  <div className="mt-2 rounded-lg border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground">
                    {feedbackMessage}
                  </div>
                )}
              </div>
              <div className="px-3 py-2.5 border-t border-border bg-background flex items-center justify-end gap-2">
                {feedbackIdx === currentAction.idx ? (
                  <>
                    <Input
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submitAuditFeedback()}
                      placeholder="Tell the assistant what to change"
                      className="h-7 flex-1 text-xs"
                      disabled={sendAuditFeedback.isPending}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={sendAuditFeedback.isPending}
                      onClick={() => {
                        setFeedbackIdx(null);
                        setFeedbackText("");
                        setFeedbackMessage(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!feedbackText.trim() || sendAuditFeedback.isPending}
                      onClick={submitAuditFeedback}
                    >
                      {sendAuditFeedback.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      Send
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={savingIdx === currentAction.idx || saveAuditRule.isPending || rejectAuditRule.isPending || sendAuditFeedback.isPending}
                      onClick={() =>
                        rejectAuditRule.mutate(
                          {
                            syncId,
                            proposalId: `audit-${currentAction.idx}`,
                            origin: revisedAuditProposal?.origin ?? "agent_reasoned",
                            rule: currentRule!,
                          },
                          {
                            onSuccess: () => {
                              setRejectedRuleIds((s) => new Set(s).add(currentAction.idx));
                              setRevisedAuditProposal(null);
                              setFeedbackMessage(null);
                            },
                          }
                        )
                      }
                    >
                      {rejectAuditRule.isPending ? "Rejecting…" : "Reject"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={savingIdx === currentAction.idx || saveAuditRule.isPending || rejectAuditRule.isPending || sendAuditFeedback.isPending}
                      onClick={() => {
                        setFeedbackIdx(currentAction.idx);
                        setFeedbackMessage(null);
                      }}
                    >
                      Give feedback
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={savingIdx === currentAction.idx || saveAuditRule.isPending || rejectAuditRule.isPending || sendAuditFeedback.isPending}
                      onClick={() => {
                        if (!currentRule) return;
                        setSavingIdx(currentAction.idx);
                        saveAuditRule.mutate(
                          { syncId, rule: currentRule },
                          {
                            onSuccess: () => {
                              setSavedRuleIds((s) => new Set(s).add(currentAction.idx));
                              setSavingIdx(null);
                              setRevisedAuditProposal(null);
                              setFeedbackMessage(null);
                            },
                            onError: () => setSavingIdx(null),
                          }
                        );
                      }}
                    >
                      {savingIdx === currentAction.idx ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                      Accept
                    </Button>
                  </>
                )}
              </div>
            </div>
          ) : actionableFindings.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              No more audit recommendations to review.
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              No automated fixes were found in this audit.
            </div>
          )}

          {!currentAction && otherFindings.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                Other observations
              </div>
              <div className="space-y-2">
                {otherFindings.slice(0, 4).map(({ finding, idx }) => (
                  <div key={idx} className="flex items-start gap-2">
                    <div className="w-5 flex-shrink-0 flex justify-center pt-0.5">{tierIcon(finding.tier)}</div>
                    <div className="min-w-0">
                      <span className="text-xs font-mono text-muted-foreground bg-card border border-border rounded px-1.5 py-0.5">
                        {finding.field}
                      </span>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{finding.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
