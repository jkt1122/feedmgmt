import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runPipelineTransform } from "@/lib/pipeline/runner";

export const dataSourceRouter = createTRPCRouter({
  list: protectedProcedure.query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from("data_sources")
      .select("*")
      .eq("merchant_id", ctx.user.id)
      .order("uploaded_at", { ascending: false });

    if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
    return data ?? [];
  }),

  getProducts: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("canonical_products")
        .select("*")
        .eq("source_id", input.sourceId)
        .eq("merchant_id", ctx.user.id)
        .order("row_index", { ascending: true })
        .limit(500);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data ?? [];
    }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("data_sources")
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
        originalFilename: z.string(),
        storagePath: z.string(),
        columnMapping: z.record(z.string(), z.string()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("data_sources")
        .insert({
          merchant_id: ctx.user.id,
          name: input.name,
          original_filename: input.originalFilename,
          storage_path: input.storagePath,
          column_mapping: input.columnMapping ?? {},
          pipeline_status: "idle",
        })
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data;
    }),

  updateMapping: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        columnMapping: z.record(z.string(), z.string()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("data_sources")
        .update({ column_mapping: input.columnMapping })
        .eq("id", input.id)
        .eq("merchant_id", ctx.user.id)
        .select()
        .single();

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data;
    }),

  runPipeline: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const service = createServiceClient();

      // Fetch the data source (verify ownership)
      const { data: source, error: srcErr } = await ctx.supabase
        .from("data_sources")
        .select("*")
        .eq("id", input.id)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (srcErr || !source) throw new TRPCError({ code: "NOT_FOUND" });

      // Mark as running
      await ctx.supabase
        .from("data_sources")
        .update({ pipeline_status: "running" })
        .eq("id", input.id);

      try {
        const { rawRows, rows, validationIssuesByRow, dbRuleIds, matchCounts } =
          await runPipelineTransform({
            serviceClient: service,
            source: {
              id: input.id,
              storage_path: source.storage_path,
              column_mapping: source.column_mapping ?? {},
              merchant_id: ctx.user.id,
              disabled_default_rules: source.disabled_default_rules ?? [],
            },
          });

        // Update last_match_count on DB rules
        if (dbRuleIds.length > 0 && matchCounts.length > 0) {
          for (let i = 0; i < dbRuleIds.length; i++) {
            await service
              .from("pipeline_rules")
              .update({ last_match_count: matchCounts[i], last_run_at: new Date().toISOString() })
              .eq("id", dbRuleIds[i]);
          }
        }

        // Clear and rebuild canonical products
        await service.from("canonical_products").delete().eq("source_id", input.id);

        const BATCH = 500;
        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH).map((row, offset) => ({
            source_id: input.id,
            merchant_id: ctx.user.id,
            row_index: i + offset,
            data: row,
            original_data: rawRows[i + offset],
            dedup_status: "kept",
            validation_issues: validationIssuesByRow.get(i + offset) ?? [],
          }));

          const { error: insertErr } = await service.from("canonical_products").insert(batch);
          if (insertErr) throw new Error(insertErr.message);
        }

        // Mark done
        await service
          .from("data_sources")
          .update({
            pipeline_status: "done",
            pipeline_last_run_at: new Date().toISOString(),
          })
          .eq("id", input.id);

        return { rowCount: rows.length };
      } catch (e) {
        await service
          .from("data_sources")
          .update({ pipeline_status: "error" })
          .eq("id", input.id);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: e instanceof Error ? e.message : "Pipeline failed",
        });
      }
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const service = createServiceClient();

      // Get storage path before deleting
      const { data: source } = await ctx.supabase
        .from("data_sources")
        .select("storage_path")
        .eq("id", input.id)
        .eq("merchant_id", ctx.user.id)
        .single();

      // Delete from storage
      if (source?.storage_path) {
        await service.storage.from("feeds").remove([source.storage_path]);
      }

      const { error } = await ctx.supabase
        .from("data_sources")
        .delete()
        .eq("id", input.id)
        .eq("merchant_id", ctx.user.id);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),
});
