import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runSyncPipeline } from "@/lib/pipeline/sync-runner";
import { exportGoogleTSV, exportMetaCSV, getExportFilename } from "@/lib/pipeline/export";
import { getPlatformDefaultRules } from "@/lib/pipeline/platform-defaults";
import { getPlatformDefaultRuleSpec, validatePipelineRuleSpec } from "@/lib/pipeline/rule-catalog";
import { fingerprintRule } from "@/lib/pipeline/proposals";

const FilterRuleSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(["is", "is_not", "contains", "greater_than", "less_than"]),
  value: z.string(),
});

const BATCH_SIZE = 500;

async function persistSyncProducts(
  service: ReturnType<typeof createServiceClient>,
  syncId: string,
  merchantId: string,
  result: Awaited<ReturnType<typeof runSyncPipeline>>
) {
  await service.from("sync_products").delete().eq("sync_id", syncId);

  for (let i = 0; i < result.rows.length; i += BATCH_SIZE) {
    const batch = result.rows.slice(i, i + BATCH_SIZE).map((row, offset) => ({
      sync_id: syncId,
      merchant_id: merchantId,
      row_index: i + offset,
      data: row,
      pre_transform_data: result.preTransformRows[i + offset] ?? row,
      validation_issues: result.validationIssuesByRow.get(i + offset) ?? [],
    }));
    await service.from("sync_products").insert(batch);
  }

  await service
    .from("platform_syncs")
    .update({
      column_mapping: result.columnMapping,
      last_product_count: result.rows.length,
      last_filtered_out: result.filteredOutCount,
      pipeline_status: "done",
      last_run_at: new Date().toISOString(),
    })
    .eq("id", syncId);
}

export const syncRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("platform_syncs")
      .select("*")
      .eq("merchant_id", ctx.user.id)
      .order("created_at", { ascending: false });

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("platform_syncs")
        .select("*")
        .eq("id", input.id)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (error || !data) throw new TRPCError({ code: "NOT_FOUND" });
      return data;
    }),

  // Create sync and immediately run the pipeline
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        platform: z.enum(["google_shopping", "meta_catalog"]),
        source_ids: z.array(z.string().uuid()).min(1),
        filter_rules: z.array(FilterRuleSchema).default([]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const service = createServiceClient();

      const { data: sync, error } = await ctx.supabase
        .from("platform_syncs")
        .insert({
          merchant_id: ctx.user.id,
          name: input.name,
          platform: input.platform,
          source_ids: input.source_ids,
          filter_rules: input.filter_rules,
          pipeline_status: "running",
          recommendations_seen: false,
        })
        .select()
        .single();

      if (error || !sync) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error?.message });

      // Auto-run pipeline immediately
      try {
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
        await persistSyncProducts(service, sync.id, sync.merchant_id, result);
      } catch {
        await service.from("platform_syncs").update({ pipeline_status: "error" }).eq("id", sync.id);
      }

      return sync;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        source_ids: z.array(z.string().uuid()).min(1).optional(),
        filter_rules: z.array(FilterRuleSchema).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input;
      const { error } = await ctx.supabase
        .from("platform_syncs")
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("merchant_id", ctx.user.id);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("platform_syncs")
        .delete()
        .eq("id", input.id)
        .eq("merchant_id", ctx.user.id);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  run: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const service = createServiceClient();

      const { data: sync } = await ctx.supabase
        .from("platform_syncs")
        .select("*")
        .eq("id", input.id)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!sync) throw new TRPCError({ code: "NOT_FOUND" });

      await ctx.supabase
        .from("platform_syncs")
        .update({ pipeline_status: "running" })
        .eq("id", input.id);

      try {
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

        await persistSyncProducts(service, sync.id, sync.merchant_id, result);

        return {
          rowCount: result.rows.length,
          filteredOutCount: result.filteredOutCount,
          issueCount: result.validationIssuesByRow.size,
        };
      } catch (err) {
        await ctx.supabase
          .from("platform_syncs")
          .update({ pipeline_status: "error" })
          .eq("id", input.id);
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: String(err) });
      }
    }),

  getProducts: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: sync } = await ctx.supabase
        .from("platform_syncs")
        .select("id, platform, column_mapping, last_product_count, last_filtered_out, pipeline_status")
        .eq("id", input.id)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!sync) throw new TRPCError({ code: "NOT_FOUND" });

      if (sync.pipeline_status === "idle" || sync.pipeline_status === "running") {
        return {
          rows: [],
          preTransformRows: [],
          columnMapping: sync.column_mapping ?? {},
          issuesByRow: {},
          totalRows: 0,
          filteredOutCount: 0,
          neverRun: sync.pipeline_status === "idle",
          isRunning: sync.pipeline_status === "running",
        };
      }

      const { data: products, error } = await ctx.supabase
        .from("sync_products")
        .select("row_index, data, pre_transform_data, validation_issues")
        .eq("sync_id", input.id)
        .eq("merchant_id", ctx.user.id)
        .order("row_index", { ascending: true })
        .limit(500);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      const rows = (products ?? []).map((p) => p.data as Record<string, string>);
      const preTransformRows = (products ?? []).map((p) => p.pre_transform_data as Record<string, string>);
      const issuesByRow: Record<string, { field: string; message: string }[]> = {};
      for (const p of products ?? []) {
        const issues = p.validation_issues as { field: string; message: string }[];
        if (issues?.length > 0) issuesByRow[String(p.row_index)] = issues;
      }

      return {
        rows,
        preTransformRows,
        columnMapping: sync.column_mapping ?? {},
        issuesByRow,
        totalRows: sync.last_product_count ?? rows.length,
        filteredOutCount: sync.last_filtered_out ?? 0,
        neverRun: false,
        isRunning: false,
      };
    }),

  // Returns platform default rules as pending recommendations (not yet accepted)
  getRecommendations: protectedProcedure
    .input(z.object({ syncId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: sync } = await ctx.supabase
        .from("platform_syncs")
        .select("platform, recommendations_seen")
        .eq("id", input.syncId)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!sync) throw new TRPCError({ code: "NOT_FOUND" });
      if (sync.recommendations_seen) return { recommendations: [], seen: true };

      // Find which platform defaults have already been accepted (saved as pipeline_rules)
      const { data: existingRules } = await ctx.supabase
        .from("pipeline_rules")
        .select("plain_english")
        .eq("sync_id", input.syncId)
        .eq("merchant_id", ctx.user.id);

      const acceptedLabels = new Set((existingRules ?? []).map((r) => r.plain_english));

      const allDefaults = getPlatformDefaultRules(sync.platform);
      const pending = allDefaults.filter((r) => !acceptedLabels.has(r.plain_english));

      return { recommendations: pending, seen: false };
    }),

  // Accept one or all platform recommendations — saves them as pipeline_rules
  acceptRecommendations: protectedProcedure
    .input(
      z.object({
        syncId: z.string().uuid(),
        ruleIds: z.array(z.string()), // platform default rule ids to accept, or ["__all__"]
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data: sync } = await ctx.supabase
        .from("platform_syncs")
        .select("platform, merchant_id")
        .eq("id", input.syncId)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!sync) throw new TRPCError({ code: "NOT_FOUND" });

      const allDefaults = getPlatformDefaultRules(sync.platform);
      const toAccept = input.ruleIds[0] === "__all__"
        ? allDefaults
        : allDefaults.filter((r) => input.ruleIds.includes(r.id));

      if (toAccept.length === 0) return { accepted: 0 };

      const { data: existing } = await ctx.supabase
        .from("pipeline_rules")
        .select("sort_order")
        .eq("sync_id", input.syncId)
        .eq("merchant_id", ctx.user.id)
        .order("sort_order", { ascending: false })
        .limit(1);

      let nextOrder = ((existing?.[0]?.sort_order as number) ?? 0) + 1;

      const specs = toAccept.map((rule) => getPlatformDefaultRuleSpec(rule.id));
      if (specs.some((rule) => rule === null)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "One or more platform recommendations are not in the rule catalog.",
        });
      }

      const inserts = specs.map((rule) => ({
        merchant_id: ctx.user.id,
        sync_id: input.syncId,
        source_id: null,
        label: rule!.label,
        plain_english: rule!.plain_english,
        stage: rule!.stage,
        conditions: rule!.condition,
        actions: rule!.action,
        enabled: true,
        sort_order: nextOrder++,
        origin: "platform_spec",
      }));

      const { error } = await ctx.supabase.from("pipeline_rules").insert(inserts);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      for (const rule of specs) {
        await ctx.supabase.from("rule_memories").upsert(
          {
            merchant_id: ctx.user.id,
            sync_id: input.syncId,
            platform: sync.platform,
            scope: "sync",
            decision: "accepted",
            fingerprint: fingerprintRule(rule!),
            origin: "platform_spec",
            rule_spec: rule,
          },
          { onConflict: "merchant_id,sync_id,fingerprint,decision" }
        );
      }

      // Mark recommendations as seen so the panel doesn't re-appear
      await ctx.supabase
        .from("platform_syncs")
        .update({ recommendations_seen: true })
        .eq("id", input.syncId)
        .eq("merchant_id", ctx.user.id);

      return { accepted: inserts.length };
    }),

  // Mark all recommendations as seen (user dismissed without accepting)
  dismissRecommendations: protectedProcedure
    .input(z.object({ syncId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("platform_syncs")
        .update({ recommendations_seen: true })
        .eq("id", input.syncId)
        .eq("merchant_id", ctx.user.id);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  getSourceIssues: protectedProcedure
    .input(z.object({ syncId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: sync } = await ctx.supabase
        .from("platform_syncs")
        .select("source_ids")
        .eq("id", input.syncId)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!sync) throw new TRPCError({ code: "NOT_FOUND" });

      const issues: { sourceName: string; sourceId: string; count: number; sample: string[] }[] = [];

      for (const sourceId of (sync.source_ids as string[])) {
        const { data: source } = await ctx.supabase
          .from("data_sources")
          .select("id, name")
          .eq("id", sourceId)
          .eq("merchant_id", ctx.user.id)
          .single();

        if (!source) continue;

        const { count } = await ctx.supabase
          .from("canonical_products")
          .select("*", { count: "exact", head: true })
          .eq("source_id", sourceId)
          .eq("merchant_id", ctx.user.id)
          .neq("validation_issues", "[]");

        if ((count ?? 0) > 0) {
          const { data: sample } = await ctx.supabase
            .from("canonical_products")
            .select("validation_issues")
            .eq("source_id", sourceId)
            .eq("merchant_id", ctx.user.id)
            .neq("validation_issues", "[]")
            .limit(5);

          const msgs = new Set<string>();
          for (const p of sample ?? []) {
            for (const issue of (p.validation_issues as { field: string; message: string }[]) ?? []) {
              msgs.add(issue.message);
              if (msgs.size >= 3) break;
            }
          }

          issues.push({
            sourceId: source.id,
            sourceName: source.name,
            count: count ?? 0,
            sample: Array.from(msgs),
          });
        }
      }

      return issues;
    }),

  getRules: protectedProcedure
    .input(z.object({ syncId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("pipeline_rules")
        .select("*")
        .eq("sync_id", input.syncId)
        .eq("merchant_id", ctx.user.id)
        .order("sort_order", { ascending: true });

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data ?? [];
    }),

  saveRule: protectedProcedure
    .input(
      z.object({
        syncId: z.string().uuid(),
        label: z.string().min(1),
        plain_english: z.string(),
        stage: z.enum(["format", "quality", "validation"]),
        conditions: z.any(),
        actions: z.any(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const validation = validatePipelineRuleSpec({
        label: input.label,
        plain_english: input.plain_english,
        stage: input.stage,
        condition: input.conditions,
        action: input.actions,
      });
      if (!validation.ok) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Invalid rule: ${validation.reason}` });
      }

      const { data: existing } = await ctx.supabase
        .from("pipeline_rules")
        .select("sort_order")
        .eq("sync_id", input.syncId)
        .eq("merchant_id", ctx.user.id)
        .order("sort_order", { ascending: false })
        .limit(1);

      const nextOrder = ((existing?.[0]?.sort_order as number) ?? 0) + 1;

      const { data, error } = await ctx.supabase
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
          sort_order: nextOrder,
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data;
    }),

  toggleRule: protectedProcedure
    .input(z.object({ ruleId: z.string().uuid(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("pipeline_rules")
        .update({ enabled: input.enabled })
        .eq("id", input.ruleId)
        .eq("merchant_id", ctx.user.id);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  getExport: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data: sync } = await ctx.supabase
        .from("platform_syncs")
        .select("id, name, platform, column_mapping, pipeline_status")
        .eq("id", input.id)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!sync) throw new TRPCError({ code: "NOT_FOUND" });
      if (sync.pipeline_status === "idle") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Run the sync first before exporting." });
      }

      const { data: products } = await ctx.supabase
        .from("sync_products")
        .select("data")
        .eq("sync_id", input.id)
        .eq("merchant_id", ctx.user.id)
        .order("row_index", { ascending: true });

      const rows = (products ?? []).map((p) => p.data as Record<string, string>);
      const columnMapping = (sync.column_mapping ?? {}) as Record<string, string>;

      const content = sync.platform === "google_shopping"
        ? exportGoogleTSV(rows, columnMapping)
        : exportMetaCSV(rows, columnMapping);

      return { content, filename: getExportFilename(sync.name, sync.platform), rowCount: rows.length };
    }),
});
