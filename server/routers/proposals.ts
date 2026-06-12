import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { createServiceClient } from "@/lib/supabase/service";
import { runSyncPipeline } from "@/lib/pipeline/sync-runner";
import { getPlatformDefaultRules } from "@/lib/pipeline/platform-defaults";
import { getBasicFixRuleSpecs, getPlatformDefaultRuleSpec, validatePipelineRuleSpec } from "@/lib/pipeline/rule-catalog";
import { buildRuleProposal, fingerprintRule, preferenceKeyForRule } from "@/lib/pipeline/proposals";
import { reviseProposalFromFeedback } from "@/lib/pipeline/proposal-feedback";
import type { PipelineRuleSpec } from "@/lib/pipeline/rule-schema";
import type { ProposalOrigin } from "@/lib/pipeline/proposals";

const ProposalOriginSchema = z.enum(["basic_fix", "platform_spec", "agent_reasoned", "user_request"]);

async function loadSync(ctx: { supabase: ReturnType<typeof createServiceClient>; user: { id: string } }, syncId: string) {
  const { data: sync } = await ctx.supabase
    .from("platform_syncs")
    .select("*")
    .eq("id", syncId)
    .eq("merchant_id", ctx.user.id)
    .single();

  if (!sync) throw new TRPCError({ code: "NOT_FOUND" });
  return sync;
}

async function nextSortOrder(
  supabase: ReturnType<typeof createServiceClient>,
  merchantId: string,
  syncId: string
) {
  const { data: existing } = await supabase
    .from("pipeline_rules")
    .select("sort_order")
    .eq("sync_id", syncId)
    .eq("merchant_id", merchantId)
    .order("sort_order", { ascending: false })
    .limit(1);

  return ((existing?.[0]?.sort_order as number) ?? 0) + 1;
}

async function rememberDecision({
  supabase,
  merchantId,
  syncId,
  platform,
  fingerprint,
  origin,
  decision,
  rule,
  feedbackText,
  sourceFingerprint,
  replacementFingerprint,
  preferenceKey,
  replacementRule,
}: {
  supabase: ReturnType<typeof createServiceClient>;
  merchantId: string;
  syncId: string;
  platform: "google_shopping" | "meta_catalog";
  fingerprint: string;
  origin: ProposalOrigin;
  decision: "accepted" | "rejected";
  rule: PipelineRuleSpec;
  feedbackText?: string;
  sourceFingerprint?: string;
  replacementFingerprint?: string;
  preferenceKey?: string;
  replacementRule?: PipelineRuleSpec;
}) {
  await supabase
    .from("rule_memories")
    .upsert(
      {
        merchant_id: merchantId,
        sync_id: syncId,
        platform,
        scope: "sync",
        decision,
        fingerprint,
        origin,
        rule_spec: rule,
        feedback_text: feedbackText ?? null,
        source_fingerprint: sourceFingerprint ?? null,
        replacement_fingerprint: replacementFingerprint ?? null,
        preference_key: preferenceKey ?? preferenceKeyForRule(rule),
        replacement_rule_spec: replacementRule ?? null,
      },
      { onConflict: "merchant_id,sync_id,fingerprint,decision" }
    );
}

export const proposalsRouter = createTRPCRouter({
  list: protectedProcedure
    .input(z.object({ syncId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const service = createServiceClient();
      const sync = await loadSync(ctx, input.syncId);

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

      const platformRules = getPlatformDefaultRules(sync.platform)
        .map((rule) => ({ id: rule.id, origin: "platform_spec" as const, spec: getPlatformDefaultRuleSpec(rule.id) }))
        .filter((entry): entry is { id: string; origin: "platform_spec"; spec: PipelineRuleSpec } => entry.spec !== null);
      const basicRules = getBasicFixRuleSpecs().map((rule) => ({
        id: `basic_${fingerprintRule(rule).slice(0, 12)}`,
        origin: "basic_fix" as const,
        spec: rule,
      }));
      const candidateRules = [...basicRules, ...platformRules];

      const candidateFingerprints = candidateRules.map((entry) => fingerprintRule(entry.spec));
      const candidatePreferenceKeys = candidateRules.map((entry) => preferenceKeyForRule(entry.spec));

      const [{ data: memories }, { data: existingRules }] = await Promise.all([
        ctx.supabase
          .from("rule_memories")
          .select("fingerprint, preference_key")
          .eq("merchant_id", ctx.user.id)
          .eq("sync_id", input.syncId)
          .or(`fingerprint.in.(${candidateFingerprints.join(",")}),preference_key.in.(${candidatePreferenceKeys.join(",")})`),
        ctx.supabase
          .from("pipeline_rules")
          .select("conditions, actions")
          .eq("merchant_id", ctx.user.id)
          .eq("sync_id", input.syncId),
      ]);

      const settled = new Set((memories ?? []).map((memory) => memory.fingerprint as string));
      const settledPreferenceKeys = new Set(
        (memories ?? [])
          .map((memory) => memory.preference_key as string | null)
          .filter((key): key is string => Boolean(key))
      );
      for (const rule of existingRules ?? []) {
        const validation = validatePipelineRuleSpec({
          label: "Existing rule",
          plain_english: "",
          stage: "format",
          condition: rule.conditions,
          action: rule.actions,
        });
        if (validation.ok) settled.add(fingerprintRule(validation.rule));
      }

      const proposals = candidateRules
        .filter((entry) => !settled.has(fingerprintRule(entry.spec)) && !settledPreferenceKeys.has(preferenceKeyForRule(entry.spec)))
        .map((entry) =>
          buildRuleProposal({
            id: entry.id,
            origin: entry.origin,
            rows: result.rows,
            rule: entry.spec,
          })
        )
        .filter((proposal) => proposal !== null);

      return { proposals };
    }),

  accept: protectedProcedure
    .input(
      z.object({
        syncId: z.string().uuid(),
        proposalId: z.string(),
        origin: ProposalOriginSchema,
        rule: z.unknown(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const validation = validatePipelineRuleSpec(input.rule);
      if (!validation.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid rule: ${validation.reason}` });
      }

      const sync = await loadSync(ctx, input.syncId);
      const fingerprint = fingerprintRule(validation.rule);
      const sortOrder = await nextSortOrder(ctx.supabase, ctx.user.id, input.syncId);

      const { data: savedRule, error } = await ctx.supabase
        .from("pipeline_rules")
        .insert({
          merchant_id: ctx.user.id,
          sync_id: input.syncId,
          source_id: null,
          label: validation.rule.label,
          plain_english: validation.rule.plain_english,
          stage: validation.rule.stage,
          conditions: validation.rule.condition,
          actions: validation.rule.action,
          enabled: true,
          sort_order: sortOrder,
          origin: input.origin === "platform_spec" ? "platform_spec" : input.origin === "agent_reasoned" ? "ai_recommended" : "user_created",
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      await rememberDecision({
        supabase: ctx.supabase,
        merchantId: ctx.user.id,
        syncId: input.syncId,
        platform: sync.platform,
        fingerprint,
        origin: input.origin,
        decision: "accepted",
        rule: validation.rule,
      });

      return { ruleId: savedRule.id, proposalId: input.proposalId };
    }),

  reject: protectedProcedure
    .input(
      z.object({
        syncId: z.string().uuid(),
        proposalId: z.string(),
        origin: ProposalOriginSchema,
        rule: z.unknown(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const validation = validatePipelineRuleSpec(input.rule);
      if (!validation.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid rule: ${validation.reason}` });
      }

      const sync = await loadSync(ctx, input.syncId);
      await rememberDecision({
        supabase: ctx.supabase,
        merchantId: ctx.user.id,
        syncId: input.syncId,
        platform: sync.platform,
        fingerprint: fingerprintRule(validation.rule),
        origin: input.origin,
        decision: "rejected",
        rule: validation.rule,
      });

      return { proposalId: input.proposalId };
    }),

  feedback: protectedProcedure
    .input(
      z.object({
        syncId: z.string().uuid(),
        proposalId: z.string(),
        origin: ProposalOriginSchema,
        rule: z.unknown(),
        feedback: z.string().min(1),
        examples: z.array(
          z.object({
            row_index: z.number(),
            field: z.string(),
            before: z.string(),
            after: z.string(),
          })
        ).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const validation = validatePipelineRuleSpec(input.rule);
      if (!validation.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid rule: ${validation.reason}` });
      }

      const service = createServiceClient();
      const sync = await loadSync(ctx, input.syncId);
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

      const sourceFingerprint = fingerprintRule(validation.rule);
      const sourcePreferenceKey = preferenceKeyForRule(validation.rule);
      const revision = await reviseProposalFromFeedback({
        feedback: input.feedback,
        origin: "user_request",
        rule: validation.rule,
        rows: result.rows,
        examples: input.examples,
      });

      if (revision.type === "updated_proposal") {
        await rememberDecision({
          supabase: ctx.supabase,
          merchantId: ctx.user.id,
          syncId: input.syncId,
          platform: sync.platform,
          fingerprint: sourceFingerprint,
          origin: input.origin,
          decision: "rejected",
          rule: validation.rule,
          feedbackText: input.feedback,
          sourceFingerprint,
          replacementFingerprint: revision.proposal.fingerprint,
          preferenceKey: sourcePreferenceKey,
          replacementRule: revision.proposal.rule,
        });

        return {
          type: "updated_proposal" as const,
          message: revision.message,
          proposal: revision.proposal,
        };
      }

      if (revision.type === "suppress_similar") {
        await rememberDecision({
          supabase: ctx.supabase,
          merchantId: ctx.user.id,
          syncId: input.syncId,
          platform: sync.platform,
          fingerprint: sourceFingerprint,
          origin: input.origin,
          decision: "rejected",
          rule: validation.rule,
          feedbackText: input.feedback,
          sourceFingerprint,
          preferenceKey: sourcePreferenceKey,
        });

        return {
          type: "suppress_similar" as const,
          message: revision.message,
        };
      }

      return {
        type: "clarification" as const,
        message: revision.message,
      };
    }),

  acceptMany: protectedProcedure
    .input(
      z.object({
        syncId: z.string().uuid(),
        proposals: z.array(
          z.object({
            proposalId: z.string(),
            origin: ProposalOriginSchema,
            rule: z.unknown(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const sync = await loadSync(ctx, input.syncId);
      let sortOrder = await nextSortOrder(ctx.supabase, ctx.user.id, input.syncId);
      const rows = [];

      for (const proposal of input.proposals) {
        const validation = validatePipelineRuleSpec(proposal.rule);
        if (!validation.ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid rule: ${validation.reason}` });
        }
        rows.push({
          merchant_id: ctx.user.id,
          sync_id: input.syncId,
          source_id: null,
          label: validation.rule.label,
          plain_english: validation.rule.plain_english,
          stage: validation.rule.stage,
          conditions: validation.rule.condition,
          actions: validation.rule.action,
          enabled: true,
          sort_order: sortOrder++,
          origin: proposal.origin === "platform_spec" ? "platform_spec" : proposal.origin === "agent_reasoned" ? "ai_recommended" : "user_created",
          fingerprint: fingerprintRule(validation.rule),
          proposalOrigin: proposal.origin,
          rule: validation.rule,
        });
      }

      if (rows.length === 0) return { accepted: 0 };

      const { error } = await ctx.supabase.from("pipeline_rules").insert(
        rows.map(({ fingerprint: _fingerprint, proposalOrigin: _proposalOrigin, rule: _rule, ...row }) => row)
      );
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      for (const row of rows) {
        await rememberDecision({
          supabase: ctx.supabase,
          merchantId: ctx.user.id,
          syncId: input.syncId,
          platform: sync.platform,
          fingerprint: row.fingerprint,
          origin: row.proposalOrigin,
          decision: "accepted",
          rule: row.rule,
        });
      }

      return { accepted: rows.length };
    }),

  rejectMany: protectedProcedure
    .input(
      z.object({
        syncId: z.string().uuid(),
        proposals: z.array(
          z.object({
            proposalId: z.string(),
            origin: ProposalOriginSchema,
            rule: z.unknown(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const sync = await loadSync(ctx, input.syncId);
      let rejected = 0;

      for (const proposal of input.proposals) {
        const validation = validatePipelineRuleSpec(proposal.rule);
        if (!validation.ok) continue;
        await rememberDecision({
          supabase: ctx.supabase,
          merchantId: ctx.user.id,
          syncId: input.syncId,
          platform: sync.platform,
          fingerprint: fingerprintRule(validation.rule),
          origin: proposal.origin,
          decision: "rejected",
          rule: validation.rule,
        });
        rejected++;
      }

      return { rejected };
    }),
});
