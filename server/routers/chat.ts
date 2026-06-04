import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { createServiceClient } from "@/lib/supabase/service";
import { processChatInstruction } from "@/lib/pipeline/chat";
import { runPipelineTransform } from "@/lib/pipeline/runner";
import { runSyncPipeline } from "@/lib/pipeline/sync-runner";
import { PipelineRuleSpecSchema } from "@/lib/pipeline/rule-schema";
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

      // Load message history for context (last 10 exchanges = 20 messages)
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

      // Save assistant response — include rule JSON in content so history retains full context
      const assistantContent = result.is_question || !result.rule
        ? result.explanation
        : `${result.explanation}\n\n[Proposed rule: ${JSON.stringify(result.rule)}]`;

      const { data: assistantMsg } = await ctx.supabase
        .from("chat_messages")
        .insert({
          session_id: input.sessionId,
          role: "assistant",
          content: assistantContent,
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
      saveAsGlobalRule: z.boolean().default(false),
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

      // Validate rule shape before doing anything with it
      const ruleValidation = PipelineRuleSpecSchema.safeParse(payload.rule);
      if (!ruleValidation.success) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid rule: ${ruleValidation.error.issues[0]?.message ?? "unknown error"}`,
        });
      }
      const validatedRule = ruleValidation.data;

      // Save as pipeline rule if requested (source or global scope)
      let ruleId: string | null = null;
      if (input.saveAsRule || input.saveAsGlobalRule) {
        const { data: savedRule } = await ctx.supabase
          .from("pipeline_rules")
          .insert({
            source_id: input.saveAsGlobalRule ? null : input.sourceId,
            merchant_id: ctx.user.id,
            label: validatedRule.label,
            plain_english: validatedRule.plain_english,
            stage: validatedRule.stage,
            conditions: validatedRule.condition,
            actions: validatedRule.action,
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

      // Run full pipeline (defaults → globals → source rules).
      // Only inject chatSpec as extraRules when it was NOT saved to DB —
      // if saved, the runner loads it from DB and injecting it again would apply it twice.
      const chatSpec: PipelineRuleSpec = validatedRule;
      const savedToDB = input.saveAsRule || input.saveAsGlobalRule;
      const { rawRows, rows, validationIssuesByRow } = await runPipelineTransform({
        serviceClient: service,
        source: {
          id: input.sourceId,
          storage_path: source.storage_path,
          column_mapping: source.column_mapping ?? {},
          merchant_id: ctx.user.id,
          disabled_default_rules: source.disabled_default_rules ?? [],
        },
        extraRules: savedToDB ? [] : [chatSpec],
      });

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
          validation_issues: validationIssuesByRow.get(i + offset) ?? [],
        }));
        await service.from("canonical_products").insert(batch);
      }

      await service.from("data_sources")
        .update({ pipeline_status: "done", pipeline_last_run_at: new Date().toISOString() })
        .eq("id", input.sourceId);

      return { success: true, ruleId };
    }),

  sendSyncMessage: protectedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      syncId: z.string().uuid(),
      message: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const service = createServiceClient();

      await ctx.supabase.from("chat_messages").insert({
        session_id: input.sessionId,
        role: "user",
        content: input.message,
      });

      const { data: sync } = await ctx.supabase
        .from("platform_syncs")
        .select("*")
        .eq("id", input.syncId)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!sync) throw new TRPCError({ code: "NOT_FOUND" });

      // Get products through sync pipeline (sample)
      const result = await runSyncPipeline({
        serviceClient: service,
        sync: {
          id: sync.id,
          merchant_id: sync.merchant_id,
          platform: sync.platform,
          source_ids: sync.source_ids,
          filter_rules: sync.filter_rules ?? [],
          disabled_default_rules: sync.disabled_default_rules ?? [],
        },
      });

      const sampleProducts = result.rows.slice(0, 200).map((row, i) => ({
        id: crypto.randomUUID(),
        row_index: i,
        data: row,
        original_data: row,
      }));

      const { data: history } = await ctx.supabase
        .from("chat_messages")
        .select("role, content")
        .eq("session_id", input.sessionId)
        .order("created_at", { ascending: true })
        .limit(20);

      const platformLabel = sync.platform === "google_shopping" ? "Google Shopping" : "Meta Catalog";

      const fakeSource = {
        name: `${sync.name} (${platformLabel} sync)`,
        column_mapping: result.columnMapping,
      };

      const chatResult = await processChatInstruction({
        instruction: input.message,
        source: fakeSource,
        products: sampleProducts,
        history: (history ?? []).slice(0, -1),
      });

      const assistantContent = chatResult.is_question || !chatResult.rule
        ? chatResult.explanation
        : `${chatResult.explanation}\n\n[Proposed rule: ${JSON.stringify(chatResult.rule)}]`;

      const { data: assistantMsg } = await ctx.supabase
        .from("chat_messages")
        .insert({
          session_id: input.sessionId,
          role: "assistant",
          content: assistantContent,
          payload: chatResult,
        })
        .select()
        .single();

      return assistantMsg;
    }),

  applySyncOperation: protectedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      messageId: z.string().uuid(),
      syncId: z.string().uuid(),
      saveAsRule: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data: msg } = await ctx.supabase
        .from("chat_messages")
        .select("*")
        .eq("id", input.messageId)
        .single();

      if (!msg?.payload) throw new TRPCError({ code: "NOT_FOUND" });

      const payload = msg.payload as { rule: Record<string, unknown>; affected_count: number; instruction: string };
      if (!payload.rule) throw new TRPCError({ code: "BAD_REQUEST", message: "No rule in payload" });

      const ruleValidation = PipelineRuleSpecSchema.safeParse(payload.rule);
      if (!ruleValidation.success) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid rule: ${ruleValidation.error.issues[0]?.message}` });
      }
      const validatedRule = ruleValidation.data;

      let ruleId: string | null = null;
      if (input.saveAsRule) {
        const { data: savedRule } = await ctx.supabase
          .from("pipeline_rules")
          .insert({
            sync_id: input.syncId,
            source_id: null,
            merchant_id: ctx.user.id,
            label: validatedRule.label,
            plain_english: validatedRule.plain_english,
            stage: validatedRule.stage,
            conditions: validatedRule.condition,
            actions: validatedRule.action,
            enabled: true,
            sort_order: 999,
            origin: "chat",
          })
          .select()
          .single();
        ruleId = savedRule?.id ?? null;
      }

      await ctx.supabase.from("batch_operations").insert({
        merchant_id: ctx.user.id,
        context_type: "sync",
        context_id: input.syncId,
        instruction: payload.instruction,
        affected_count: payload.affected_count,
        status: "applied",
        rule_id: ruleId,
        applied_at: new Date().toISOString(),
      });

      return { success: true, ruleId };
    }),
});
