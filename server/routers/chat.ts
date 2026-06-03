import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { createServiceClient } from "@/lib/supabase/service";
import { processChatInstruction } from "@/lib/pipeline/chat";
import type { PipelineRuleSpec } from "@/lib/pipeline/rule-schema";

export const chatRouter = createTRPCRouter({
  getOrCreateSession: protectedProcedure
    .input(z.object({ contextType: z.enum(["source", "sync"]), contextId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: existing } = await ctx.supabase
        .from("chat_sessions")
        .select("*")
        .eq("merchant_id", ctx.user.id)
        .eq("context_type", input.contextType)
        .eq("context_id", input.contextId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      if (existing) return existing;

      const { data, error } = await ctx.supabase
        .from("chat_sessions")
        .insert({ merchant_id: ctx.user.id, context_type: input.contextType, context_id: input.contextId })
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data;
    }),

  getMessages: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("chat_messages")
        .select("*")
        .eq("session_id", input.sessionId)
        .order("created_at", { ascending: true });

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data ?? [];
    }),

  sendMessage: protectedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      sourceId: z.string().uuid(),
      message: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const service = createServiceClient();

      // Save user message
      await ctx.supabase.from("chat_messages").insert({
        session_id: input.sessionId,
        role: "user",
        content: input.message,
      });

      // Load source + sample products
      const { data: source } = await ctx.supabase
        .from("data_sources")
        .select("*")
        .eq("id", input.sourceId)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!source) throw new TRPCError({ code: "NOT_FOUND" });

      const { data: products } = await service
        .from("canonical_products")
        .select("*")
        .eq("source_id", input.sourceId)
        .eq("dedup_status", "kept")
        .limit(200);

      // Load message history for context
      const { data: history } = await ctx.supabase
        .from("chat_messages")
        .select("role, content")
        .eq("session_id", input.sessionId)
        .order("created_at", { ascending: true })
        .limit(20);

      const result = await processChatInstruction({
        instruction: input.message,
        source,
        products: products ?? [],
        history: (history ?? []).slice(0, -1), // exclude the message we just saved
      });

      // Save assistant response
      const { data: assistantMsg } = await ctx.supabase
        .from("chat_messages")
        .insert({
          session_id: input.sessionId,
          role: "assistant",
          content: result.explanation,
          payload: result,
        })
        .select()
        .single();

      return assistantMsg;
    }),

  applyOperation: protectedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      messageId: z.string().uuid(),
      sourceId: z.string().uuid(),
      saveAsRule: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const service = createServiceClient();

      // Get the assistant message with the payload
      const { data: msg } = await ctx.supabase
        .from("chat_messages")
        .select("*")
        .eq("id", input.messageId)
        .single();

      if (!msg?.payload) throw new TRPCError({ code: "NOT_FOUND" });

      const payload = msg.payload as {
        rule: Record<string, unknown>;
        affected_count: number;
        instruction: string;
      };

      if (!payload.rule) throw new TRPCError({ code: "BAD_REQUEST", message: "No rule in payload" });

      // Save as pipeline rule if requested
      let ruleId: string | null = null;
      if (input.saveAsRule) {
        const { data: savedRule } = await ctx.supabase
          .from("pipeline_rules")
          .insert({
            source_id: input.sourceId,
            merchant_id: ctx.user.id,
            label: payload.rule.label,
            plain_english: payload.rule.plain_english,
            stage: payload.rule.stage ?? "quality",
            conditions: payload.rule.condition,
            actions: payload.rule.action,
            enabled: true,
            sort_order: 999,
            origin: "chat",
          })
          .select()
          .single();
        ruleId = savedRule?.id ?? null;
      }

      // Log batch operation
      await ctx.supabase.from("batch_operations").insert({
        merchant_id: ctx.user.id,
        context_type: "source",
        context_id: input.sourceId,
        instruction: payload.instruction,
        affected_count: payload.affected_count,
        status: "applied",
        rule_id: ruleId,
        applied_at: new Date().toISOString(),
      });

      // Re-run pipeline to apply
      const { data: source } = await ctx.supabase
        .from("data_sources")
        .select("*")
        .eq("id", input.sourceId)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!source) throw new TRPCError({ code: "NOT_FOUND" });

      // Import and run pipeline inline
      const { applyRules } = await import("@/lib/pipeline/rule-engine");
      const { default: Papa } = await import("papaparse");

      const { data: fileData } = await service.storage.from("feeds").download(source.storage_path);
      if (!fileData) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const csvText = await fileData.text();
      const parsed = Papa.parse<Record<string, string>>(csvText, { header: true, skipEmptyLines: true });

      const { data: rulesData } = await service
        .from("pipeline_rules")
        .select("*")
        .eq("source_id", input.sourceId)
        .eq("enabled", true)
        .order("sort_order", { ascending: true });

      const specs = (rulesData ?? []).map((r) => ({
        label: r.label,
        plain_english: r.plain_english,
        stage: r.stage,
        condition: r.conditions,
        action: r.actions,
      }));

      const rawRows = parsed.data;

      // Always include the chat rule in this run (whether saved permanently or not)
      const chatSpec = payload.rule as unknown as PipelineRuleSpec;
      const allSpecs = [...(specs as PipelineRuleSpec[]), chatSpec];
      const { rows } = applyRules(rawRows, allSpecs);

      await service.from("canonical_products").delete().eq("source_id", input.sourceId);

      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH).map((row, offset) => ({
          source_id: input.sourceId,
          merchant_id: ctx.user.id,
          row_index: i + offset,
          data: row,
          original_data: rawRows[i + offset],
          dedup_status: "kept",
          validation_issues: [],
        }));
        await service.from("canonical_products").insert(batch);
      }

      await service.from("data_sources")
        .update({ pipeline_status: "done", pipeline_last_run_at: new Date().toISOString() })
        .eq("id", input.sourceId);

      return { success: true, ruleId };
    }),
});
