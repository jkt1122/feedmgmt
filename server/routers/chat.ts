import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { createServiceClient } from "@/lib/supabase/service";
import { processChatInstruction } from "@/lib/pipeline/chat";
import { runPipelineTransform } from "@/lib/pipeline/runner";
import { runSyncPipeline } from "@/lib/pipeline/sync-runner";
import { runSyncAudit } from "@/lib/pipeline/audit";
import { PipelineRuleSpecSchema } from "@/lib/pipeline/rule-schema";
import { validatePipelineRuleSpec } from "@/lib/pipeline/rule-catalog";
import { fingerprintRule } from "@/lib/pipeline/proposals";

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
      const ruleValidation = validatePipelineRuleSpec(payload.rule);
      if (!ruleValidation.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Invalid rule: ${ruleValidation.reason}`,
        });
      }
      const validatedRule = ruleValidation.rule;

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

      // Sources stay raw. Re-import the file without applying transformation rules.
      const { rawRows, rows, validationIssuesByRow } = await runPipelineTransform({
        serviceClient: service,
        source: {
          id: input.sourceId,
          storage_path: source.storage_path,
          column_mapping: source.column_mapping ?? {},
          merchant_id: ctx.user.id,
          disabled_default_rules: source.disabled_default_rules ?? [],
        },
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

      if (chatResult.rule && !chatResult.is_question) {
        const fingerprint = fingerprintRule(chatResult.rule);
        const { data: memory } = await ctx.supabase
          .from("rule_memories")
          .select("decision")
          .eq("merchant_id", ctx.user.id)
          .eq("sync_id", input.syncId)
          .eq("fingerprint", fingerprint)
          .limit(1)
          .maybeSingle();

        if (memory) {
          chatResult.is_question = true;
          chatResult.explanation = memory.decision === "accepted"
            ? "That rule is already saved for this sync."
            : "You already rejected that rule for this sync, so I will not propose it again.";
          chatResult.rule = null;
          chatResult.affected_count = 0;
          chatResult.preview = [];
        }
      }

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

  saveAuditRule: protectedProcedure
    .input(z.object({
      syncId: z.string().uuid(),
      rule: PipelineRuleSpecSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const { data: sync } = await ctx.supabase
        .from("platform_syncs")
        .select("platform")
        .eq("id", input.syncId)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!sync) throw new TRPCError({ code: "NOT_FOUND" });

      const { data: savedRule, error } = await ctx.supabase
        .from("pipeline_rules")
        .insert({
          sync_id: input.syncId,
          source_id: null,
          merchant_id: ctx.user.id,
          label: input.rule.label,
          plain_english: input.rule.plain_english,
          stage: input.rule.stage,
          conditions: input.rule.condition,
          actions: input.rule.action,
          enabled: true,
          sort_order: 999,
          origin: "ai_recommended",
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      await ctx.supabase.from("rule_memories").upsert(
        {
          merchant_id: ctx.user.id,
          sync_id: input.syncId,
          platform: sync.platform,
          scope: "sync",
          decision: "accepted",
          fingerprint: fingerprintRule(input.rule),
          origin: "agent_reasoned",
          rule_spec: input.rule,
        },
        { onConflict: "merchant_id,sync_id,fingerprint,decision" }
      );
      return { ruleId: savedRule.id };
    }),

  runSyncAudit: protectedProcedure
    .input(z.object({ syncId: z.string().uuid(), sessionId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const service = createServiceClient();

      const { data: sync } = await ctx.supabase
        .from("platform_syncs")
        .select("*")
        .eq("id", input.syncId)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!sync) throw new TRPCError({ code: "NOT_FOUND" });

      // Save user message
      await ctx.supabase.from("chat_messages").insert({
        session_id: input.sessionId,
        role: "user",
        content: "Audit my feed",
      });

      // Load persisted sync products (fast path — no pipeline re-run)
      const { data: syncProducts } = await service
        .from("sync_products")
        .select("data")
        .eq("sync_id", input.syncId)
        .order("row_index", { ascending: true })
        .limit(500);

      const rows = (syncProducts ?? []).map((p) => p.data as Record<string, string>);

      // Fall back to pipeline run if no persisted products
      let columnMapping: Record<string, string> = sync.column_mapping ?? {};
      if (rows.length === 0) {
        const result = await runSyncPipeline({
          serviceClient: service,
          sync: {
            id: sync.id,
            merchant_id: sync.merchant_id,
            platform: sync.platform,
            source_ids: sync.source_ids,
            filter_rules: sync.filter_rules ?? [],
          },
        });
        rows.push(...result.rows);
        columnMapping = result.columnMapping;
      }

      const report = await runSyncAudit({
        rows,
        platform: sync.platform,
        columnMapping,
      });

      // Save as assistant message with audit_report payload type
      const { data: assistantMsg } = await ctx.supabase
        .from("chat_messages")
        .insert({
          session_id: input.sessionId,
          role: "assistant",
          content: report.summary,
          payload: { type: "audit_report", ...report },
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

      const ruleValidation = validatePipelineRuleSpec(payload.rule);
      if (!ruleValidation.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid rule: ${ruleValidation.reason}` });
      }
      const validatedRule = ruleValidation.rule;

      let ruleId: string | null = null;
      if (input.saveAsRule) {
        const { data: sync } = await ctx.supabase
          .from("platform_syncs")
          .select("platform")
          .eq("id", input.syncId)
          .eq("merchant_id", ctx.user.id)
          .single();

        if (!sync) throw new TRPCError({ code: "NOT_FOUND" });

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

        await ctx.supabase.from("rule_memories").upsert(
          {
            merchant_id: ctx.user.id,
            sync_id: input.syncId,
            platform: sync.platform,
            scope: "sync",
            decision: "accepted",
            fingerprint: fingerprintRule(validatedRule),
            origin: "user_request",
            rule_spec: validatedRule,
          },
          { onConflict: "merchant_id,sync_id,fingerprint,decision" }
        );
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

  rejectSyncOperation: protectedProcedure
    .input(z.object({
      messageId: z.string().uuid(),
      syncId: z.string().uuid(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data: msg } = await ctx.supabase
        .from("chat_messages")
        .select("*")
        .eq("id", input.messageId)
        .single();

      if (!msg?.payload) throw new TRPCError({ code: "NOT_FOUND" });

      const payload = msg.payload as { rule: Record<string, unknown> };
      if (!payload.rule) throw new TRPCError({ code: "BAD_REQUEST", message: "No rule in payload" });

      const validation = validatePipelineRuleSpec(payload.rule);
      if (!validation.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid rule: ${validation.reason}` });
      }

      const { data: sync } = await ctx.supabase
        .from("platform_syncs")
        .select("platform")
        .eq("id", input.syncId)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!sync) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.supabase.from("rule_memories").upsert(
        {
          merchant_id: ctx.user.id,
          sync_id: input.syncId,
          platform: sync.platform,
          scope: "sync",
          decision: "rejected",
          fingerprint: fingerprintRule(validation.rule),
          origin: "user_request",
          rule_spec: validation.rule,
        },
        { onConflict: "merchant_id,sync_id,fingerprint,decision" }
      );

      return { success: true };
    }),
});
