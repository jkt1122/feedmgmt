import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";
import { createServiceClient } from "@/lib/supabase/service";
import { analyzeDataForRules } from "@/lib/pipeline/analyze";
import { PipelineRuleSpecSchema } from "@/lib/pipeline/rule-schema";
import Papa from "papaparse";

export const pipelineRouter = createTRPCRouter({
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
        global: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const scopeId = input.global ? null : input.sourceId;

      const { data: existing } = await ctx.supabase
        .from("pipeline_rules")
        .select("sort_order")
        .eq("merchant_id", ctx.user.id)
        .order("sort_order", { ascending: false })
        .limit(1);

      const baseOrder = (existing?.[0]?.sort_order ?? -1) + 1;

      const rows = input.rules.map((rule, i) => {
        const parsed = PipelineRuleSpecSchema.safeParse({
          label: rule.label,
          plain_english: rule.plain_english,
          stage: rule.stage,
          condition: rule.condition,
          action: rule.action,
        });
        if (!parsed.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Rule "${rule.label}" is invalid: ${parsed.error.issues[0]?.message ?? "unknown error"}`,
          });
        }
        return {
          source_id: scopeId,
          merchant_id: ctx.user.id,
          label: parsed.data.label,
          plain_english: parsed.data.plain_english,
          stage: parsed.data.stage,
          conditions: parsed.data.condition,
          actions: parsed.data.action,
          enabled: true,
          sort_order: baseOrder + i,
          origin: "ai_recommended",
        };
      });

      const { error } = await ctx.supabase.from("pipeline_rules").insert(rows);
      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });

      return { saved: rows.length };
    }),

  // Returns global rules + source rules, each with a scope field
  listRules: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [{ data: globalRules }, { data: sourceRules }] = await Promise.all([
        ctx.supabase
          .from("pipeline_rules")
          .select("*")
          .is("source_id", null)
          .eq("merchant_id", ctx.user.id)
          .order("sort_order", { ascending: true }),
        ctx.supabase
          .from("pipeline_rules")
          .select("*")
          .eq("source_id", input.sourceId)
          .eq("merchant_id", ctx.user.id)
          .order("sort_order", { ascending: true }),
      ]);

      return [
        ...(globalRules ?? []).map((r) => ({ ...r, scope: "global" as const })),
        ...(sourceRules ?? []).map((r) => ({ ...r, scope: "source" as const })),
      ];
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

  // Toggle a default rule on/off for a specific source
  toggleDefaultRule: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid(), ruleId: z.string(), disabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { data: source } = await ctx.supabase
        .from("data_sources")
        .select("disabled_default_rules")
        .eq("id", input.sourceId)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!source) throw new TRPCError({ code: "NOT_FOUND" });

      const current: string[] = source.disabled_default_rules ?? [];
      const updated = input.disabled
        ? Array.from(new Set([...current, input.ruleId]))
        : current.filter((id) => id !== input.ruleId);

      const { error } = await ctx.supabase
        .from("data_sources")
        .update({ disabled_default_rules: updated })
        .eq("id", input.sourceId)
        .eq("merchant_id", ctx.user.id);

      if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      return { disabled: updated };
    }),

  getDisabledDefaults: protectedProcedure
    .input(z.object({ sourceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { data } = await ctx.supabase
        .from("data_sources")
        .select("disabled_default_rules")
        .eq("id", input.sourceId)
        .eq("merchant_id", ctx.user.id)
        .single();
      return (data?.disabled_default_rules ?? []) as string[];
    }),

  // Promote a source rule to global scope — deletes the source copy
  promoteToGlobal: protectedProcedure
    .input(z.object({ ruleId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { data: rule } = await ctx.supabase
        .from("pipeline_rules")
        .select("*")
        .eq("id", input.ruleId)
        .eq("merchant_id", ctx.user.id)
        .single();

      if (!rule) throw new TRPCError({ code: "NOT_FOUND" });

      // Check for duplicate global rule (same label) to avoid duplication
      const { data: existing } = await ctx.supabase
        .from("pipeline_rules")
        .select("id")
        .is("source_id", null)
        .eq("merchant_id", ctx.user.id)
        .eq("label", rule.label)
        .maybeSingle();

      if (!existing) {
        const { error } = await ctx.supabase.from("pipeline_rules").insert({
          source_id: null,
          merchant_id: ctx.user.id,
          label: rule.label,
          plain_english: rule.plain_english,
          stage: rule.stage,
          conditions: rule.conditions,
          actions: rule.actions,
          enabled: true,
          sort_order: rule.sort_order,
          origin: rule.origin,
        });
        if (error) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: error.message });
      }

      // Delete the source-scoped copy
      await ctx.supabase
        .from("pipeline_rules")
        .delete()
        .eq("id", input.ruleId)
        .eq("merchant_id", ctx.user.id);

      return { success: true };
    }),
});
