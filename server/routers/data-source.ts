import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { createServiceClient } from "@/lib/supabase/service";
import { applyRules } from "@/lib/pipeline/rule-engine";
import type { PipelineRuleSpec } from "@/lib/pipeline/rule-schema";
import Papa from "papaparse";

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
        // Download CSV from storage
        const { data: fileData, error: dlErr } = await service.storage
          .from("feeds")
          .download(source.storage_path);

        if (dlErr || !fileData) throw new Error(dlErr?.message ?? "Download failed");

        const csvText = await fileData.text();
        const mapping: Record<string, string> = source.column_mapping ?? {};

        // Parse CSV
        const parsed = Papa.parse<Record<string, string>>(csvText, {
          header: true,
          skipEmptyLines: true,
        });

        if (parsed.errors.length > 0 && parsed.data.length === 0) {
          throw new Error("CSV parse failed: " + parsed.errors[0].message);
        }

        // Load enabled pipeline rules for this source
        const { data: rulesData } = await service
          .from("pipeline_rules")
          .select("*")
          .eq("source_id", input.id)
          .eq("enabled", true)
          .order("sort_order", { ascending: true });

        const ruleSpecs: PipelineRuleSpec[] = (rulesData ?? []).map((r) => ({
          label: r.label,
          plain_english: r.plain_english,
          stage: r.stage,
          condition: r.conditions as PipelineRuleSpec["condition"],
          action: r.actions as PipelineRuleSpec["action"],
        }));

        // Apply rules to all rows
        const rawRows = parsed.data;
        const { rows, matchCounts } = ruleSpecs.length > 0
          ? applyRules(rawRows, ruleSpecs)
          : { rows: rawRows, matchCounts: [] };

        // Update last_match_count on each rule
        if (rulesData && matchCounts.length > 0) {
          for (let i = 0; i < rulesData.length; i++) {
            await service
              .from("pipeline_rules")
              .update({ last_match_count: matchCounts[i], last_run_at: new Date().toISOString() })
              .eq("id", rulesData[i].id);
          }
        }

        // Clear existing canonical products for this source
        await service
          .from("canonical_products")
          .delete()
          .eq("source_id", input.id);

        // Build and insert canonical rows in batches
        const BATCH = 500;

        for (let i = 0; i < rows.length; i += BATCH) {
          const batch = rows.slice(i, i + BATCH).map((row, offset) => {
            const originalRow = rawRows[i + offset];
            const validationIssues: { field: string; message: string }[] = [];

            for (const [canonical, sourceCol] of Object.entries(mapping)) {
              if (!sourceCol) continue;
              const val = row[sourceCol];
              if (
                ["id", "title", "price", "availability"].includes(canonical) &&
                (!val || val.trim() === "")
              ) {
                validationIssues.push({
                  field: canonical,
                  message: `Missing required field: ${canonical}`,
                });
              }
            }

            return {
              source_id: input.id,
              merchant_id: ctx.user.id,
              row_index: i + offset,
              data: row,
              original_data: originalRow,
              dedup_status: "kept",
              validation_issues: validationIssues,
            };
          });

          const { error: insertErr } = await service
            .from("canonical_products")
            .insert(batch);

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
