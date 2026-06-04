"use client";

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Send, Loader2, Sparkles, BookmarkPlus } from "lucide-react";
import type { ChatResult } from "@/lib/pipeline/chat";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  payload?: ChatResult | null;
  created_at: string;
};

export function SyncChat({
  syncId,
  syncName,
  platform,
  onRulesChanged,
}: {
  syncId: string;
  syncName: string;
  platform: "google_shopping" | "meta_catalog";
  onRulesChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const pendingRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const platformLabel = platform === "google_shopping" ? "Google Shopping" : "Meta Catalog";

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
  }, [messages]);

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

  const isLoading = sendMsg.isPending || getOrCreate.isPending;

  return (
    <div
      className={cn(
        "border-t-2 border-lavender bg-surface flex flex-col flex-shrink-0 transition-all",
        open ? "h-72" : "h-11"
      )}
    >
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
        <span className="flex-1" />
        <span className="text-xs text-slate border border-border rounded px-2 py-0.5 bg-background">
          {open ? "Collapse" : "Expand"}
        </span>
        {open ? <ChevronDown className="w-3.5 h-3.5 text-slate" /> : <ChevronUp className="w-3.5 h-3.5 text-slate" />}
      </button>

      {open && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-2.5 min-h-0">
            {messages.length === 0 && (
              <p className="text-xs text-slate">
                Ask me to optimize titles for {platformLabel}, suggest categories, fix issues, or add custom rules.
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
            <div className="flex gap-2 items-center">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && submit()}
                placeholder="Ask the assistant to optimize, filter, or fix anything in this sync…"
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
              Changes apply to this sync only · source data is never modified
            </p>
          </div>
        </>
      )}
    </div>
  );
}
