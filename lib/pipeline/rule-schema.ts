import { z } from "zod";

// ── Zod validators ────────────────────────────────────────────────────────────
// These are the source of truth. TypeScript types are derived from them below.

export const RuleConditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("always") }),
  z.object({ type: z.literal("field_empty"), field: z.string().min(1) }),
  z.object({ type: z.literal("field_matches"), field: z.string().min(1), pattern: z.string().min(1) }),
  z.object({ type: z.literal("field_not_in"), field: z.string().min(1), values: z.array(z.string()) }),
]);

export const RuleActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("trim"), field: z.string().min(1) }),
  z.object({ type: z.literal("lowercase"), field: z.string().min(1) }),
  z.object({ type: z.literal("uppercase"), field: z.string().min(1) }),
  z.object({ type: z.literal("replace"), field: z.string().min(1), find: z.string(), replace: z.string() }),
  z.object({ type: z.literal("replace_map"), field: z.string().min(1), map: z.record(z.string(), z.string()) }),
  z.object({ type: z.literal("set_default"), field: z.string().min(1), value: z.string() }),
  z.object({ type: z.literal("set_value"), field: z.string().min(1), value: z.string() }),
  z.object({ type: z.literal("prefix"), field: z.string().min(1), value: z.string() }),
  z.object({ type: z.literal("suffix"), field: z.string().min(1), value: z.string() }),
  z.object({ type: z.literal("strip_html"), field: z.string().min(1) }),
  z.object({ type: z.literal("normalize_price"), field: z.string().min(1) }),
  z.object({ type: z.literal("flag_issue"), field: z.string().min(1), message: z.string().min(1) }),
  z.object({ type: z.literal("template"), field: z.string().min(1), template: z.string().min(1) }),
  z.object({ type: z.literal("truncate"), field: z.string().min(1), max_length: z.number().int().positive() }),
]);

export const PipelineRuleSpecSchema = z.object({
  label: z.string().min(1),
  plain_english: z.string(),
  stage: z.enum(["format", "quality", "validation"]),
  condition: RuleConditionSchema,
  action: RuleActionSchema,
});

// ── TypeScript types (derived — don't edit manually) ─────────────────────────

export type RuleCondition = z.infer<typeof RuleConditionSchema>;
export type RuleAction = z.infer<typeof RuleActionSchema>;
export type PipelineRuleSpec = z.infer<typeof PipelineRuleSpecSchema>;

export type ProposedRule = PipelineRuleSpec & {
  affected_count: number;
  preview: { before: string; after: string }[];
};
