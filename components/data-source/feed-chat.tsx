"use client";

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageCircle, ChevronDown, ChevronUp, Send, Loader2, CheckCircle2, BookmarkPlus, Globe, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatResult } from "@/lib/pipeline/chat";
import type { ProposedRule } from "@/lib/pipeline/rule-schema";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  payload?: ChatResult | null;
  proposals?: ProposedRule[];   // set for analysis result messages
  created_at: string;
};

export function FeedChat({
  sourceId,
  onDataChanged,
  onRulesApplied,
}: {
  sourceId: string;
  onDataChanged: () => void;
  onRulesApplied?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const pendingMessageRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const getOrCreate = trpc.chat.getOrCreateSession.useMutation({
    onSuccess: (session) => {
      setSessionId(session.id);
      setSessionError(null);
      // Send any queued message
      if (pendingMessageRef.current) {
        const pending = pendingMessageRef.current;
        pendingMessageRef.current = null;
        sendMessage.mutate({ sessionId: session.id, sourceId, message: pending });
      }
    },
    onError: (e) => setSessionError(e.message),
  });

  const sendMessage = trpc.chat.sendMessage.useMutation({
    onSuccess: (msg) => {
      if (msg) setMessages((m) => [...m, msg as Message]);
    },
  });

  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [savedGlobalIds, setSavedGlobalIds] = useState<Set<string>>(new Set());
  const [approvedProposals, setApprovedProposals] = useState<Record<string, Set<number>>>({});
  const [dismissedProposals, setDismissedProposals] = useState<Set<string>>(new Set());

  const analyze = trpc.pipeline.analyze.useMutation({
    onSuccess: (proposals) => {
      const msgId = crypto.randomUUID();
      const analysisMsg: Message = {
        id: msgId,
        role: "assistant",
        content: `I found ${proposals.length} suggested improvement${proposals.length !== 1 ? "s" : ""} for your feed. Review and apply the ones you want.`,
        proposals,
        created_at: new Date().toISOString(),
      };
      setMessages((m) => [...m, analysisMsg]);
      setApprovedProposals((p) => ({ ...p, [msgId]: new Set(proposals.map((_, i) => i)) }));
    },
  });

  const saveRules = trpc.pipeline.saveRules.useMutation({
    onSuccess: () => {
      onRulesApplied?.();
      onDataChanged();
    },
  });

  const applyOp = trpc.chat.applyOperation.useMutation({
    onSuccess: (_, vars) => {
      setAppliedIds((s) => new Set(s).add(vars.messageId));
      if (vars.saveAsGlobalRule) setSavedGlobalIds((s) => new Set(s).add(vars.messageId));
      onDataChanged();
    },
  });

  // Init session when opened
  useEffect(() => {
    if (open && !sessionId) {
      getOrCreate.mutate({ contextType: "source", contextId: sourceId });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sourceId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim() || sendMessage.isPending) return;
    const text = input.trim();
    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      created_at: new Date().toISOString(),
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");

    if (sessionId) {
      sendMessage.mutate({ sessionId, sourceId, message: text });
    } else {
      // Queue message — will send once session is ready
      pendingMessageRef.current = text;
      if (!getOrCreate.isPending) {
        getOrCreate.mutate({ contextType: "source", contextId: sourceId });
      }
    }
  };

  return (
    <div className="border-t border-border bg-card flex-shrink-0">
      {/* Header bar — always visible */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-6 py-3 hover:bg-muted transition-colors"
      >
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Feed Assistant</span>
          <span className="text-xs text-muted-foreground">Ask me to transform your data</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="flex flex-col" style={{ height: 360 }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-3 space-y-4">
            {sessionError && (
              <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded px-3 py-2">
                Setup error: {sessionError}. Make sure you&apos;ve run migration 002 in Supabase.
              </div>
            )}
            {messages.length === 0 && !sessionError && (
              <div className="text-center py-8">
                <p className="text-sm text-muted-foreground">Ask me anything about your feed data.</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  <button
                    onClick={() => {
                      if (!analyze.isPending) analyze.mutate({ sourceId });
                    }}
                    disabled={analyze.isPending}
                    className="text-xs bg-primary text-primary-foreground px-2.5 py-1 rounded-full hover:bg-primary/90 transition-colors flex items-center gap-1 disabled:opacity-50"
                  >
                    {analyze.isPending
                      ? <><Loader2 className="w-3 h-3 animate-spin" />Analyzing…</>
                      : <><Sparkles className="w-3 h-3" />Analyze my feed to identify gaps</>
                    }
                  </button>
                  {[
                    "Capitalize all titles",
                    "How many products are missing brand?",
                    "Normalize availability values",
                  ].map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className="text-xs bg-accent text-primary px-2.5 py-1 rounded-full hover:bg-accent/80 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                msg={msg}
                onApply={(saveAsRule, saveAsGlobalRule) => {
                  if (!sessionId) return;
                  applyOp.mutate({ sessionId, messageId: msg.id, sourceId, saveAsRule, saveAsGlobalRule });
                }}
                applying={applyOp.isPending && applyOp.variables?.messageId === msg.id}
                applied={appliedIds.has(msg.id)}
                savedGlobal={savedGlobalIds.has(msg.id)}
                approvedProposals={approvedProposals[msg.id]}
                onToggleProposal={(i) => setApprovedProposals((prev) => {
                  const s = new Set(prev[msg.id] ?? []);
                  if (s.has(i)) { s.delete(i); } else { s.add(i); }
                  return { ...prev, [msg.id]: s };
                })}
                dismissed={dismissedProposals.has(msg.id)}
                onApplyProposals={(indices) => {
                  const rules = (msg.proposals ?? [])
                    .filter((_, i) => indices.has(i))
                    .map((r) => ({
                      label: r.label,
                      plain_english: r.plain_english,
                      stage: r.stage,
                      condition: r.condition as Record<string, unknown>,
                      action: r.action as Record<string, unknown>,
                    }));
                  saveRules.mutate({ sourceId, rules });
                  setDismissedProposals((s) => new Set(s).add(msg.id));
                }}
                onDismissProposals={() => setDismissedProposals((s) => new Set(s).add(msg.id))}
                savingProposals={saveRules.isPending}
              />
            ))}

            {sendMessage.isPending && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Thinking…</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-6 py-3 border-t border-border flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="e.g. Capitalize all product titles…"
              className="flex-1 bg-muted"
              disabled={sendMessage.isPending}
            />
            <Button
              size="icon-lg"
              onClick={handleSend}
              disabled={!input.trim() || sendMessage.isPending}
              className="shrink-0"
            >
              <Send />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChatMessage({
  msg,
  onApply,
  applying,
  applied,
  savedGlobal,
  approvedProposals,
  onToggleProposal,
  dismissed,
  onApplyProposals,
  onDismissProposals,
  savingProposals,
}: {
  msg: Message;
  onApply: (saveAsRule: boolean, saveAsGlobalRule: boolean) => void;
  applying: boolean;
  applied: boolean;
  savedGlobal?: boolean;
  approvedProposals?: Set<number>;
  onToggleProposal?: (i: number) => void;
  dismissed?: boolean;
  onApplyProposals?: (indices: Set<number>) => void;
  onDismissProposals?: () => void;
  savingProposals?: boolean;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const payload = msg.payload as ChatResult | null | undefined;

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-primary text-primary-foreground text-sm px-3 py-2 rounded-xl rounded-tr-sm max-w-xs">
          {msg.content}
        </div>
      </div>
    );
  }

  // Analysis result — proposed rules inline
  if (msg.proposals && !dismissed) {
    const approved = approvedProposals ?? new Set<number>();
    return (
      <div className="flex flex-col gap-2 max-w-lg">
        <div className="bg-muted border border-border text-sm px-3 py-2.5 rounded-xl rounded-tl-sm text-foreground">
          {msg.content}
        </div>
        <div className="border border-primary/30 rounded-lg overflow-hidden bg-accent/10">
          <div className="space-y-1.5 p-3">
            {msg.proposals.map((rule, i) => (
              <div
                key={i}
                onClick={() => onToggleProposal?.(i)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors",
                  approved.has(i) ? "border-primary/40 bg-accent/30" : "border-border bg-card opacity-60"
                )}
              >
                <div className={cn(
                  "shrink-0 w-3.5 h-3.5 rounded border-2 flex items-center justify-center transition-colors",
                  approved.has(i) ? "bg-primary border-primary" : "bg-card border-muted-foreground/40"
                )}>
                  {approved.has(i) && (
                    <svg className="w-2 h-2 text-primary-foreground" fill="none" viewBox="0 0 10 8">
                      <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span className={cn(
                  "text-xs font-semibold px-1.5 py-0.5 rounded shrink-0",
                  rule.stage === "format" ? "bg-info/10 text-info" :
                  rule.stage === "quality" ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"
                )}>{rule.stage}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-foreground">{rule.label}</span>
                  <span className="text-xs text-muted-foreground ml-2 font-data">{rule.affected_count} rows</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 px-3 py-2.5 border-t border-primary/20">
            <Button
              onClick={() => onApplyProposals?.(approved)}
              disabled={savingProposals || approved.size === 0}
              className="h-7 text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-semibold gap-1"
            >
              {savingProposals ? <><Loader2 className="w-3 h-3 animate-spin" />Applying…</> : `Apply ${approved.size} rule${approved.size !== 1 ? "s" : ""}`}
            </Button>
            <Button onClick={onDismissProposals} variant="outline" className="h-7 text-xs">
              Dismiss
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (msg.proposals && dismissed) {
    return (
      <div className="flex flex-col gap-1 max-w-lg">
        <div className="bg-muted border border-border text-sm px-3 py-2.5 rounded-xl rounded-tl-sm text-foreground">
          {msg.content}
        </div>
        <span className="text-xs text-muted-foreground pl-1">Rules applied ✓</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 max-w-lg">
      <div className="bg-muted border border-border text-sm px-3 py-2.5 rounded-xl rounded-tl-sm text-foreground">
        {msg.content}
      </div>

      {/* Transformation proposal */}
      {payload && !payload.is_question && payload.rule && (
        <div className="border border-primary/30 rounded-lg overflow-hidden bg-accent/10">
          {/* Stats row */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-primary/20">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-primary">
                {payload.affected_count} product{payload.affected_count !== 1 ? "s" : ""} will change
              </span>
              {payload.preview.length > 0 && (
                <button
                  onClick={() => setPreviewOpen((o) => !o)}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                >
                  {previewOpen ? "Hide" : "Preview"}
                  {previewOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                </button>
              )}
            </div>
          </div>

          {/* Before/after preview */}
          {previewOpen && payload.preview.length > 0 && (
            <div className="px-3 py-2 border-b border-primary/20 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground mb-1">Before → After</p>
              {payload.preview.slice(0, 5).map((p, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 text-xs font-data">
                  <span className="bg-destructive/10 text-destructive px-2 py-1 rounded truncate" title={p.before}>
                    {p.before || <em className="text-muted-foreground not-italic">empty</em>}
                  </span>
                  <span className="bg-success/10 text-success px-2 py-1 rounded truncate" title={p.after}>
                    {p.after || <em className="text-muted-foreground not-italic">empty</em>}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Apply actions */}
          <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
            {applied ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-success flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Applied
                </span>
                {savedGlobal && (
                  <span className="text-xs text-primary font-semibold bg-accent px-1.5 py-0.5 rounded flex items-center gap-1">
                    <Globe className="w-3 h-3" /> Saved globally
                  </span>
                )}
              </div>
            ) : (
              <>
                <Button
                  onClick={() => onApply(false, false)}
                  disabled={applying}
                  className="h-7 text-xs bg-primary hover:bg-primary/90 text-primary-foreground font-semibold gap-1"
                >
                  {applying ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  {applying ? "Applying…" : "Apply"}
                </Button>
                <Button
                  onClick={() => onApply(true, false)}
                  disabled={applying}
                  variant="outline"
                  className="h-7 text-xs font-semibold gap-1"
                >
                  <BookmarkPlus className="w-3 h-3" />
                  Save to this feed
                </Button>
                <Button
                  onClick={() => onApply(false, true)}
                  disabled={applying}
                  variant="outline"
                  className="h-7 text-xs font-semibold gap-1 text-primary border-primary/30 hover:bg-accent"
                >
                  <Globe className="w-3 h-3" />
                  Save globally
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
