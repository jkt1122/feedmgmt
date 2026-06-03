"use client";

import { useState, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { MessageCircle, ChevronDown, ChevronUp, Send, Loader2, CheckCircle2, BookmarkPlus } from "lucide-react";
import type { ChatResult } from "@/lib/pipeline/chat";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  payload?: ChatResult | null;
  created_at: string;
};

export function FeedChat({
  sourceId,
  onDataChanged,
}: {
  sourceId: string;
  onDataChanged: () => void;
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

  const applyOp = trpc.chat.applyOperation.useMutation({
    onSuccess: (_, vars) => {
      setAppliedIds((s) => new Set(s).add(vars.messageId));
      onDataChanged();
    },
  });

  // Init session when opened
  useEffect(() => {
    if (open && !sessionId) {
      getOrCreate.mutate({ contextType: "source", contextId: sourceId });
    }
  }, [open]);

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
    <div className="border-t border-border bg-surface flex-shrink-0">
      {/* Header bar — always visible */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-6 py-3 hover:bg-surface-2 transition-colors"
      >
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-electric" />
          <span className="text-sm font-semibold text-ink">Feed Assistant</span>
          <span className="text-xs text-slate">Ask me to transform your data</span>
        </div>
        {open ? <ChevronDown className="w-4 h-4 text-slate" /> : <ChevronUp className="w-4 h-4 text-slate" />}
      </button>

      {open && (
        <div className="flex flex-col" style={{ height: 360 }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-3 space-y-4">
            {sessionError && (
              <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
                Setup error: {sessionError}. Make sure you&apos;ve run migration 002 in Supabase.
              </div>
            )}
            {messages.length === 0 && !sessionError && (
              <div className="text-center py-8">
                <p className="text-sm text-slate">Ask me anything about your feed data.</p>
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {[
                    "Capitalize all titles",
                    "How many products are missing brand?",
                    "Normalize availability values",
                    "Add 'Free Shipping' suffix to titles over $50",
                  ].map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className="text-xs bg-lavender text-accent-text px-2.5 py-1 rounded-full hover:bg-lavender/80 transition-colors"
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
                onApply={(saveAsRule) => {
                  if (!sessionId) return;
                  applyOp.mutate({ sessionId, messageId: msg.id, sourceId, saveAsRule });
                }}
                applying={applyOp.isPending && applyOp.variables?.messageId === msg.id}
                applied={appliedIds.has(msg.id)}
              />
            ))}

            {sendMessage.isPending && (
              <div className="flex items-center gap-2 text-slate text-sm">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Thinking…</span>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-6 py-3 border-t border-border flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="e.g. Capitalize all product titles…"
              className="flex-1 text-sm bg-surface-2 border border-border rounded-lg px-3 py-2 outline-none focus:border-electric focus:ring-2 focus:ring-electric/20 placeholder:text-slate/50"
              disabled={sendMessage.isPending}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || sendMessage.isPending}
              className="bg-electric hover:bg-[#6D28D9] text-white h-9 w-9 p-0 shrink-0"
            >
              <Send className="w-4 h-4" />
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
}: {
  msg: Message;
  onApply: (saveAsRule: boolean) => void;
  applying: boolean;
  applied: boolean;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const payload = msg.payload as ChatResult | null | undefined;

  if (msg.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="bg-electric text-white text-sm px-3 py-2 rounded-xl rounded-tr-sm max-w-xs">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 max-w-lg">
      <div className="bg-surface-2 border border-border text-sm px-3 py-2.5 rounded-xl rounded-tl-sm text-ink">
        {msg.content}
      </div>

      {/* Transformation proposal */}
      {payload && !payload.is_question && payload.rule && (
        <div className="border border-electric/30 rounded-lg overflow-hidden bg-lavender/10">
          {/* Stats row */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-electric/20">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-accent-text">
                {payload.affected_count} product{payload.affected_count !== 1 ? "s" : ""} will change
              </span>
              {payload.preview.length > 0 && (
                <button
                  onClick={() => setPreviewOpen((o) => !o)}
                  className="text-xs text-slate hover:text-ink flex items-center gap-0.5"
                >
                  {previewOpen ? "Hide" : "Preview"}
                  {previewOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                </button>
              )}
            </div>
          </div>

          {/* Before/after preview */}
          {previewOpen && payload.preview.length > 0 && (
            <div className="px-3 py-2 border-b border-electric/20 space-y-1.5">
              <p className="text-xs font-semibold text-slate mb-1">Before → After</p>
              {payload.preview.slice(0, 5).map((p, i) => (
                <div key={i} className="grid grid-cols-2 gap-2 text-xs font-data">
                  <span className="bg-red-50 text-red-700 px-2 py-1 rounded truncate" title={p.before}>
                    {p.before || <em className="text-slate not-italic">empty</em>}
                  </span>
                  <span className="bg-green-50 text-green-700 px-2 py-1 rounded truncate" title={p.after}>
                    {p.after || <em className="text-slate not-italic">empty</em>}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Apply actions */}
          <div className="flex items-center gap-2 px-3 py-2">
            {applied ? (
              <span className="text-xs font-semibold text-green-600 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Applied
              </span>
            ) : (
              <>
                <Button
                  onClick={() => onApply(false)}
                  disabled={applying}
                  className="h-7 text-xs bg-electric hover:bg-[#6D28D9] text-white font-semibold gap-1"
                >
                  {applying ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  {applying ? "Applying…" : "Apply"}
                </Button>
                <Button
                  onClick={() => onApply(true)}
                  disabled={applying}
                  variant="outline"
                  className="h-7 text-xs font-semibold gap-1"
                >
                  <BookmarkPlus className="w-3 h-3" />
                  Apply & save as rule
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
