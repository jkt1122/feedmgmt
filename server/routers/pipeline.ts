import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { createServiceClient } from "@/lib/supabase/service";
import { analyzeDataForRules } from "@/lib/pipeline/analyze";
import Papa from "papaparse";

export const pipelineRouter = createTRPCRouter({
  // Analyze data and return proposed rules (does not save anything)
  analyze: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const service = createServiceClient();

      const { data: source } = await ctx.supabase
        .from("data_sources")
        .select("*")
        .eq("id", input.sourceId)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!source) throw new TRPCError({ code: "NOT_FOUND" });

      // Download CSV
      const { data: fileData, error: dlErr } = await service.storage
        .from("feeds")
        .download(source.storage_path);

      if (dlErr || !fileData) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Could not download source file" });

      const csvText = await fileData.text();
      const parsed = Papa.parse<Record<string, string>>(csvText, {
        header: true,
        skipEmptyLines: true,
      });

      const proposed = await analyzeDataForRules(
        parsed.data,
        source.column_mapping ?? {}
      );

      return proposed;
    }),

  // Save approved rules
  saveRules: protectedProcedure
    .input(
      z.object({
        sourceId: z.string().uuid(),
        rules: z.array(
          z.object({
            label: z.string(),
            plain_english: z.string(),
            stage: z.enum(["format", "quality", "validation"]),
            condition: z.record(z.string(), z.unknown()),
            action: z.record(z.string(), z.unknown()),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Get current max sort_order
      const { data: existing } = await ctx.supabase
        .from("pipeline_rules")
        .select("sort_order")
        .eq("source_id", input.sourceId)
        .order("sort_order", { ascending: false })
        .limit(1);

      const baseOrder = (existing?.[0]?.sort_order ?? -1) + 1;

      const rows = input.rules.map((rule, i) => ({
        source_id: input.sourceId,
        merchant_id: ctx.user.id,
        label: rule.label,
        plain_english: rule.plain_english,
        stage: rule.stage,
        conditions: rule.condition,
        actions: rule.action,
        enabled: true,
        sort_order: baseOrder + i,
        origin: "ai_recommended",
      }));

      const { error } = await ctx.supabase.from("pipeline_rules").insert(rows);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      return { saved: rows.length };
    }),

  // List rules for a source
  listRules: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from("pipeline_rules")
        .select("*")
        .eq("source_id", input.sourceId)
        .eq("merchant_id", ctx.user.id)
        .order("sort_order", { ascending: true });

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return data ?? [];
    }),

  // Toggle a rule on/off
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

  // Delete a rule
  deleteRule: protectedProcedure
    .input(z.object({ ruleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { error } = await ctx.supabase
        .from("pipeline_rules")
        .delete()
        .eq("id", input.ruleId)
        .eq("merchant_id", ctx.user.id);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { success: true };
    }),
});
