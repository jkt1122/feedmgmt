import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runSyncPipeline } from "@/lib/pipeline/sync-runner";
import { exportGoogleTSV, exportMetaCSV, getExportFilename } from "@/lib/pipeline/export";
import { PipelineRuleSpecSchema } from "@/lib/pipeline/rule-schema";

const FilterRuleSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(["is", "is_not", "contains", "greater_than", "less_than"]),
  value: z.string(),
});

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

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        platform: z.enum(["google_shopping", "meta_catalog"]),
        source_ids: z.array(z.string().uuid()).min(1),
        filter_rules: z.array(FilterRuleSchema).default([]),
        schedule: z.enum(["every_6h", "every_12h", "every_24h"]).default("every_12h"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("platform_syncs")
        .insert({
          merchant_id: ctx.user.id,
          name: input.name,
          platform: input.platform,
          source_ids: input.source_ids,
          filter_rules: input.filter_rules,
          schedule: input.schedule,
          pipeline_status: "idle",
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data;
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).optional(),
        source_ids: z.array(z.string().uuid()).min(1).optional(),
        filter_rules: z.array(FilterRuleSchema).optional(),
        schedule: z.enum(["every_6h", "every_12h", "every_24h"]).optional(),
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
            disabled_default_rules: sync.disabled_default_rules ?? [],
          },
        });

        await ctx.supabase
          .from("platform_syncs")
          .update({
            pipeline_status: "done",
            last_run_at: new Date().toISOString(),
          })
          .eq("id", input.id);

        const issueCount = result.validationIssuesByRow.size;
        return {
          rowCount: result.rows.length,
          filteredOutCount: result.filteredOutCount,
          issueCount,
          platformMatchCounts: result.platformMatchCounts,
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
      const service = createServiceClient();

      const { data: sync } = await ctx.supabase
        .from("platform_syncs")
        .select("*")
        .eq("id", input.id)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!sync) throw new TRPCError({ code: "NOT_FOUND" });

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

      const issuesByRow = Object.fromEntries(result.validationIssuesByRow);

      return {
        rows: result.rows.slice(0, 500),
        preTransformRows: result.preTransformRows.slice(0, 500),
        columnMapping: result.columnMapping,
        issuesByRow,
        totalRows: result.rows.length,
        filteredOutCount: result.filteredOutCount,
        platformMatchCounts: result.platformMatchCounts,
      };
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
          label: input.label,
          plain_english: input.plain_english,
          stage: input.stage,
          conditions: input.conditions,
          actions: input.actions,
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

  toggleDefaultRule: protectedProcedure
    .input(z.object({ syncId: z.string().uuid(), ruleId: z.string(), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { data: sync } = await ctx.supabase
        .from("platform_syncs")
        .select("disabled_default_rules")
        .eq("id", input.syncId)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!sync) throw new TRPCError({ code: "NOT_FOUND" });

      const current: string[] = sync.disabled_default_rules ?? [];
      const updated = input.enabled
        ? current.filter((id: string) => id !== input.ruleId)
        : [...current, input.ruleId];

      const { error } = await ctx.supabase
        .from("platform_syncs")
        .update({ disabled_default_rules: updated })
        .eq("id", input.syncId)
        .eq("merchant_id", ctx.user.id);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),

  getExport: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const service = createServiceClient();

      const { data: sync } = await ctx.supabase
        .from("platform_syncs")
        .select("*")
        .eq("id", input.id)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!sync) throw new TRPCError({ code: "NOT_FOUND" });

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

      const content = sync.platform === "google_shopping"
        ? exportGoogleTSV(result.rows, result.columnMapping)
        : exportMetaCSV(result.rows, result.columnMapping);

      const filename = getExportFilename(sync.name, sync.platform);

      return { content, filename, rowCount: result.rows.length };
    }),
});
