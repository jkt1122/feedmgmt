import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { createServiceClient } from "@/lib/supabase/service";
import { processChatInstruction } from "@/lib/pipeline/chat";
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

  // Source-level chat (sendMessage / applyOperation) was removed: sources are
  // raw, read-only uploads — all transformation lives at the sync level.
  // See DESIGN_BRIEF_feed_assistant.md §2.

  sendSyncMessage: protectedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      syncId: z.string().uuid(),
      message: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const service = createServiceClient();

      const { data: savedUserMsg } = await ctx.supabase
        .from("chat_messages")
        .insert({
          session_id: input.sessionId,
          role: "user",
          content: input.message,
        })
        .select("id")
        .single();

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

      const { data: recentHistory } = await ctx.supabase
        .from("chat_messages")
        .select("id, role, content")
        .eq("session_id", input.sessionId)
        .order("created_at", { ascending: false })
        .limit(20);

      const history = (recentHistory ?? [])
        .filter((m) => m.id !== savedUserMsg?.id)
        .reverse()
        .map((m) => ({ role: m.role, content: m.content }));

      // Past accept/reject decisions for this sync, so the model proposes
      // with awareness of what the merchant already approved or turned down
      const { data: memories } = await ctx.supabase
        .from("rule_memories")
        .select("decision, rule_spec")
        .eq("merchant_id", ctx.user.id)
        .eq("sync_id", input.syncId);

      const ruleMemories = (memories ?? []).map((m) => ({
        decision: m.decision as "accepted" | "rejected",
        label: (m.rule_spec as { plain_english?: string; label?: string })?.plain_english
          ?? (m.rule_spec as { label?: string })?.label
          ?? "unknown rule",
      }));

      const platformLabel = sync.platform === "google_shopping" ? "Google Shopping" : "Meta Catalog";

      const fakeSource = {
        name: `${sync.name} (${platformLabel} sync)`,
        column_mapping: result.columnMapping,
      };

      const chatResult = await processChatInstruction({
        instruction: input.message,
        source: fakeSource,
        products: sampleProducts,
        history,
        ruleMemories,
      });

      if (chatResult.rule && !chatResult.is_question) {
        const fingerprint = fingerprintRule(chatResult.rule);
        // Latest decision wins if both an accept and a reject row exist
        const { data: memory } = await ctx.supabase
          .from("rule_memories")
          .select("decision")
          .eq("merchant_id", ctx.user.id)
          .eq("sync_id", input.syncId)
          .eq("fingerprint", fingerprint)
          .order("created_at", { ascending: false })
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
      const auditFingerprint = fingerprintRule(input.rule);
      // A new accept supersedes any earlier reject of the same rule
      await ctx.supabase
        .from("rule_memories")
        .delete()
        .eq("merchant_id", ctx.user.id)
        .eq("sync_id", input.syncId)
        .eq("fingerprint", auditFingerprint)
        .eq("decision", "rejected");
      await ctx.supabase.from("rule_memories").upsert(
        {
          merchant_id: ctx.user.id,
          sync_id: input.syncId,
          platform: sync.platform,
          scope: "sync",
          decision: "accepted",
          fingerprint: auditFingerprint,
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

      // Save as assistant message with audit_report payload type.
      // Findings are serialized into content so later chat turns (which only
      // see role/content history) retain what was found and recommended.
      const findingsText = report.findings
        .map((f) => {
          const rule = f.suggested_rule ? ` (suggested rule: ${f.suggested_rule.label})` : "";
          return `- [${f.tier}] ${f.field}: ${f.message} (${f.affected_count} affected)${rule}`;
        })
        .join("\n");
      const auditContent = findingsText
        ? `${report.summary}\n\nFindings:\n${findingsText}`
        : report.summary;

      const { data: assistantMsg } = await ctx.supabase
        .from("chat_messages")
        .insert({
          session_id: input.sessionId,
          role: "assistant",
          content: auditContent,
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

        const acceptFingerprint = fingerprintRule(validatedRule);
        // A new accept supersedes any earlier reject of the same rule
        await ctx.supabase
          .from("rule_memories")
          .delete()
          .eq("merchant_id", ctx.user.id)
          .eq("sync_id", input.syncId)
          .eq("fingerprint", acceptFingerprint)
          .eq("decision", "rejected");
        await ctx.supabase.from("rule_memories").upsert(
          {
            merchant_id: ctx.user.id,
            sync_id: input.syncId,
            platform: sync.platform,
            scope: "sync",
            decision: "accepted",
            fingerprint: acceptFingerprint,
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

      const rejectFingerprint = fingerprintRule(validation.rule);
      // A new reject supersedes any earlier accept of the same rule
      await ctx.supabase
        .from("rule_memories")
        .delete()
        .eq("merchant_id", ctx.user.id)
        .eq("sync_id", input.syncId)
        .eq("fingerprint", rejectFingerprint)
        .eq("decision", "accepted");
      await ctx.supabase.from("rule_memories").upsert(
        {
          merchant_id: ctx.user.id,
          sync_id: input.syncId,
          platform: sync.platform,
          scope: "sync",
          decision: "rejected",
          fingerprint: rejectFingerprint,
          origin: "user_request",
          rule_spec: validation.rule,
        },
        { onConflict: "merchant_id,sync_id,fingerprint,decision" }
      );

      return { success: true };
    }),
});
