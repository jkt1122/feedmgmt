"use client";

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Send, Loader2, Sparkles, BookmarkPlus, Check } from "lucide-react";
import type { ChatResult } from "@/lib/pipeline/chat";
import type { PlatformDefaultRuleMeta } from "@/lib/pipeline/platform-defaults";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  payload?: ChatResult | null;
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
        sendMsg.mutate({ sessionId: session.id, syncId, message: pending });
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

  const isLoading = sendMsg.isPending || getOrCreate.isPending;

  const formatRules = recommendations.filter((r) => r.stage === "format");
  const validationRules = recommendations.filter((r) => r.stage === "validation" || r.stage === "quality");

  return (
    <div className={cn(
      "border-t-2 border-lavender bg-surface flex flex-col flex-shrink-0 transition-all duration-200",
      open ? "h-[380px]" : "h-11"
    )}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-11 flex items-center gap-2.5 px-5 flex-shrink-0 border-b border-border hover:bg-mist transition-colors w-full text-left"
      >
        <div className="w-5 h-5 rounded-md bg-electric flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-3 h-3 text-white" />
        </div>
        <span className="text-sm font-bold text-ink">Feed Assistant</span>
        <span className="text-xs text-slate font-mono">· {syncName} · {platformLabel}</span>
        {recState === "pending" && recommendations.length > 0 && (
          <span className="ml-1 text-xs font-semibold text-white bg-electric px-1.5 py-0.5 rounded-full">
            {recommendations.length} recommendations
          </span>
        )}
        <span className="flex-1" />
        <span className="text-xs text-slate border border-border rounded px-2 py-0.5 bg-background">
          {open ? "Collapse" : "Expand"}
        </span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate" /> : <ChevronUp className="w-3.5 h-3.5 text-slate" />}
      </button>

      {open && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-3 min-h-0">

            {/* Recommendation message — shown as a structured assistant message */}
            {recState === "pending" && recommendations.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate">Feed Assistant</div>
                <div className="bg-background border border-border rounded-xl overflow-hidden max-w-[92%]">
                  {/* Message body */}
                  <div className="px-4 py-3">
                    <p className="text-sm text-ink leading-relaxed mb-3">
                      I can help make this feed ready for <strong>{platformLabel}</strong>. Here are recommended changes based on platform specs and best practices:
                    </p>

                    {/* Format rules */}
                    {formatRules.length > 0 && (
                      <div className="mb-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate mb-1.5">Format &amp; Normalization</div>
                        <div className="flex flex-col gap-1">
                          {formatRules.map((rule) => (
                            <button
                              key={rule.id}
                              type="button"
                              onClick={() => toggleRec(rule.id)}
                              className={cn(
                                "flex items-start gap-2.5 px-3 py-2 rounded-lg border text-left transition-all",
                                selectedRecs.has(rule.id)
                                  ? "border-electric bg-lavender"
                                  : "border-border bg-surface hover:border-slate/40"
                              )}
                            >
                              <div className={cn(
                                "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors",
                                selectedRecs.has(rule.id) ? "bg-electric border-electric" : "border-border bg-background"
                              )}>
                                {selectedRecs.has(rule.id) && <Check className="w-2.5 h-2.5 text-white" />}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-ink">{rule.label}</div>
                                <div className="text-xs text-slate mt-0.5">{rule.plain_english}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Validation rules */}
                    {validationRules.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate mb-1.5">Validation &amp; Quality Checks</div>
                        <div className="flex flex-col gap-1">
                          {validationRules.map((rule) => (
                            <button
                              key={rule.id}
                              type="button"
                              onClick={() => toggleRec(rule.id)}
                              className={cn(
                                "flex items-start gap-2.5 px-3 py-2 rounded-lg border text-left transition-all",
                                selectedRecs.has(rule.id)
                                  ? "border-electric bg-lavender"
                                  : "border-border bg-surface hover:border-slate/40"
                              )}
                            >
                              <div className={cn(
                                "w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors",
                                selectedRecs.has(rule.id) ? "bg-electric border-electric" : "border-border bg-background"
                              )}>
                                {selectedRecs.has(rule.id) && <Check className="w-2.5 h-2.5 text-white" />}
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-ink">{rule.label}</div>
                                <div className="text-xs text-slate mt-0.5">{rule.plain_english}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions footer */}
                  <div className="px-4 py-2.5 border-t border-border bg-surface flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={handleAcceptAll}
                      disabled={acceptRules.isPending}
                      className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-electric text-white hover:bg-electric/90 transition-colors disabled:opacity-50"
                    >
                      <Check className="w-3 h-3" />
                      {acceptRules.isPending ? "Applying…" : "Accept all"}
                    </button>
                    {selectedRecs.size > 0 && selectedRecs.size < recommendations.length && (
                      <button
                        type="button"
                        onClick={handleAcceptSelected}
                        disabled={acceptRules.isPending}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-electric text-electric hover:bg-lavender transition-colors disabled:opacity-50"
                      >
                        Accept selected ({selectedRecs.size})
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleSelectAll()}
                      className="text-xs text-slate hover:text-ink transition-colors"
                    >
                      {selectedRecs.size === recommendations.length ? "Deselect all" : "Select all"}
                    </button>
                    <button
                      type="button"
                      onClick={() => dismissRecs.mutate({ syncId })}
                      disabled={dismissRecs.isPending}
                      className="text-xs text-slate hover:text-ink ml-auto transition-colors"
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
                <div className="text-xs font-semibold uppercase tracking-wide text-slate">Feed Assistant</div>
                <div className="bg-background border border-border rounded-xl px-4 py-3 max-w-[92%] text-sm text-slate leading-relaxed">
                  {rerunning ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-electric flex-shrink-0" />
                      <span>Rules saved — re-running sync to apply them…</span>
                    </span>
                  ) : (
                    <>
                      <span className="text-green-600 font-semibold">✓ Done.</span> The sync has been re-run with the accepted rules. You can toggle them on/off in the rules panel above, or ask me to add more.
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Regular chat messages */}
            {messages.length === 0 && recState === "dismissed" && (
              <p className="text-xs text-slate">
                Ask me to optimize titles for {platformLabel}, fix missing fields, or add custom rules to this sync.
              </p>
            )}

            {messages.map((msg) => {
              if (msg.role === "user") {
                return (
                  <div key={msg.id} className="flex justify-end">
                    <div className="bg-electric text-white text-sm px-3 py-2 rounded-xl max-w-xs">
                      {msg.content.split("\n\n[Proposed")[0]}
                    </div>
                  </div>
                );
              }

              const payload = msg.payload as ChatResult | null;
              const hasRule = payload?.rule != null && !payload?.is_question;
              const isApplied = appliedIds.has(msg.id);
              const isSaved = savedIds.has(msg.id);

              return (
                <div key={msg.id} className="flex flex-col gap-1.5 max-w-[88%]">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate">Feed Assistant</div>
                  <div className="bg-background border border-border rounded-xl overflow-hidden text-sm">
                    <div className="px-4 py-3 text-slate leading-relaxed">
                      {payload?.explanation ?? msg.content.split("\n\n[Proposed")[0]}
                    </div>
                    {hasRule && (
                      <div className="px-4 py-2.5 border-t border-border bg-surface flex items-center gap-2">
                        {isApplied ? (
                          <span className="text-xs text-green-600 font-medium">
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
                              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-electric text-white hover:bg-electric/90 transition-colors"
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
                              className="text-xs font-medium text-slate hover:text-ink px-2 py-1.5 rounded-lg border border-border hover:bg-background transition-colors"
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
              <div className="flex items-center gap-2 text-xs text-slate">
                <Loader2 className="w-3 h-3 animate-spin" />
                Thinking…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-5 pb-3 pt-2 flex-shrink-0">
            {/* Suggestion chips — only shown when input is empty */}
            {!input && messages.length === 0 && recState !== "pending" && (
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
                    className="text-xs text-slate px-2.5 py-1 rounded-full border border-border bg-background hover:border-electric hover:text-electric transition-colors"
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
                className="flex-1 text-sm bg-background border border-border rounded-xl px-4 py-2 outline-none focus:border-electric focus:ring-2 focus:ring-electric/10"
              />
              <button
                type="button"
                onClick={submit}
                disabled={!input.trim() || isLoading}
                className="w-9 h-9 bg-electric rounded-xl flex items-center justify-center text-white disabled:opacity-40 hover:bg-electric/90 transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-slate mt-1.5 px-1">
              Changes apply to this sync only · source data is never modified · you can fix individual products by ID
            </p>
          </div>
        </>
      )}
    </div>
  );
}
