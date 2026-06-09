import {
  PipelineRuleSpecSchema,
  type PipelineRuleSpec,
  type RuleAction,
  type RuleCondition,
} from "./rule-schema";
import {
  getPlatformDefaultRules,
  type PlatformDefaultRuleMeta,
} from "./platform-defaults";

export type RuleCatalogPrimitive = {
  type: string;
  shape: string;
  description: string;
};

export type RuleValidationResult =
  | { ok: true; rule: PipelineRuleSpec }
  | { ok: false; reason: string };

export const CONDITION_CATALOG: RuleCatalogPrimitive[] = [
  {
    type: "always",
    shape: '{ "type": "always" }',
    description: "Matches every row.",
  },
  {
    type: "field_empty",
    shape: '{ "type": "field_empty", "field": "<field>" }',
    description: "Matches rows where a field is missing or blank.",
  },
  {
    type: "field_matches",
    shape: '{ "type": "field_matches", "field": "<field>", "pattern": "<regex>" }',
    description: "Matches rows where a field matches a case-insensitive regular expression.",
  },
  {
    type: "field_not_in",
    shape: '{ "type": "field_not_in", "field": "<field>", "values": ["value"] }',
    description: "Matches rows where a normalized field value is not one of the listed values.",
  },
];

export const ACTION_CATALOG: RuleCatalogPrimitive[] = [
  {
    type: "trim",
    shape: '{ "type": "trim", "field": "<field>" }',
    description: "Trim leading and trailing whitespace.",
  },
  {
    type: "lowercase",
    shape: '{ "type": "lowercase", "field": "<field>" }',
    description: "Lowercase a field value.",
  },
  {
    type: "uppercase",
    shape: '{ "type": "uppercase", "field": "<field>" }',
    description: "Uppercase a field value.",
  },
  {
    type: "replace",
    shape: '{ "type": "replace", "field": "<field>", "find": "<text>", "replace": "<text>" }',
    description: "Replace exact text occurrences in a field.",
  },
  {
    type: "replace_map",
    shape: '{ "type": "replace_map", "field": "<field>", "map": { "old": "new" } }',
    description: "Map normalized categorical values to approved values.",
  },
  {
    type: "set_default",
    shape: '{ "type": "set_default", "field": "<field>", "value": "<default>" }',
    description: "Set a default value only when the target field is blank.",
  },
  {
    type: "prefix",
    shape: '{ "type": "prefix", "field": "<field>", "value": "<text>" }',
    description: "Add text to the beginning of a field.",
  },
  {
    type: "suffix",
    shape: '{ "type": "suffix", "field": "<field>", "value": "<text>" }',
    description: "Add text to the end of a field.",
  },
  {
    type: "strip_html",
    shape: '{ "type": "strip_html", "field": "<field>" }',
    description: "Remove HTML tags from a field.",
  },
  {
    type: "normalize_price",
    shape: '{ "type": "normalize_price", "field": "<field>" }',
    description: "Convert a price-like field to a two-decimal numeric value.",
  },
  {
    type: "flag_issue",
    shape: '{ "type": "flag_issue", "field": "<field>", "message": "<issue description>" }',
    description: "Flag an issue without changing the row data.",
  },
  {
    type: "template",
    shape: '{ "type": "template", "field": "<target_field>", "template": "{OtherField} - {TargetField}" }',
    description: "Build a field from literal text and {FieldName} placeholders.",
  },
  {
    type: "truncate",
    shape: '{ "type": "truncate", "field": "<field>", "max_length": 150 }',
    description: "Shorten a field to a maximum character length.",
  },
];

export function renderRuleCatalogForPrompt(): string {
  return `Condition types:
${CONDITION_CATALOG.map((c) => `- ${c.shape}: ${c.description}`).join("\n")}

Action types:
${ACTION_CATALOG.map((a) => `- ${a.shape}: ${a.description}`).join("\n")}`;
}

export function validatePipelineRuleSpec(candidate: unknown): RuleValidationResult {
  const parsed = PipelineRuleSpecSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      ok: false,
      reason: parsed.error.issues[0]?.message ?? "Rule does not match the building-block catalog.",
    };
  }

  return { ok: true, rule: parsed.data };
}

function spec(
  meta: PlatformDefaultRuleMeta,
  condition: RuleCondition,
  action: RuleAction
): PipelineRuleSpec {
  return {
    label: meta.label,
    plain_english: meta.plain_english,
    stage: meta.stage,
    condition,
    action,
  };
}

const GOOGLE_AVAILABILITY_MAP = {
  yes: "in_stock",
  "1": "in_stock",
  true: "in_stock",
  available: "in_stock",
  instock: "in_stock",
  "in stock": "in_stock",
  "in-stock": "in_stock",
  no: "out_of_stock",
  "0": "out_of_stock",
  false: "out_of_stock",
  "out of stock": "out_of_stock",
  "out-of-stock": "out_of_stock",
  outofstock: "out_of_stock",
  "sold out": "out_of_stock",
  sold_out: "out_of_stock",
  "pre-order": "preorder",
  pre_order: "preorder",
  backorder: "backorder",
  "back order": "backorder",
};

const META_AVAILABILITY_MAP = {
  in_stock: "in stock",
  instock: "in stock",
  yes: "in stock",
  "1": "in stock",
  true: "in stock",
  available: "in stock",
  out_of_stock: "out of stock",
  outofstock: "out of stock",
  no: "out of stock",
  "0": "out of stock",
  false: "out of stock",
  "out-of-stock": "out of stock",
  "sold out": "out of stock",
  preorder: "preorder",
  "pre-order": "preorder",
  pre_order: "preorder",
  backorder: "available for order",
  "back order": "available for order",
};

const GOOGLE_CONDITION_MAP = {
  new: "new",
  "brand new": "new",
  NEW: "new",
  New: "new",
  used: "used",
  Used: "used",
  USED: "used",
  "like new": "used",
  "like-new": "used",
  refurbished: "refurbished",
  Refurbished: "refurbished",
  REFURBISHED: "refurbished",
  refurb: "refurbished",
  reconditioned: "refurbished",
};

const META_CONDITION_MAP = {
  new: "new",
  "brand new": "new",
  NEW: "new",
  New: "new",
  used: "used",
  Used: "used",
  USED: "used",
  "like new": "used_like_new",
  "like-new": "used_like_new",
  refurbished: "refurbished",
  Refurbished: "refurbished",
  REFURBISHED: "refurbished",
  refurb: "refurbished",
  reconditioned: "refurbished",
  "certified pre-owned": "cpo",
  cpo: "cpo",
};

export function getPlatformDefaultRuleSpec(ruleId: string): PipelineRuleSpec | null {
  const meta = getPlatformDefaultRules("google_shopping")
    .concat(getPlatformDefaultRules("meta_catalog"))
    .find((rule) => rule.id === ruleId);

  if (!meta) return null;

  switch (ruleId) {
    case "google_normalize_availability":
      return spec(meta, { type: "always" }, { type: "replace_map", field: "availability", map: GOOGLE_AVAILABILITY_MAP });
    case "meta_normalize_availability":
      return spec(meta, { type: "always" }, { type: "replace_map", field: "availability", map: META_AVAILABILITY_MAP });
    case "google_normalize_condition":
      return spec(meta, { type: "always" }, { type: "replace_map", field: "condition", map: GOOGLE_CONDITION_MAP });
    case "meta_normalize_condition":
      return spec(meta, { type: "always" }, { type: "replace_map", field: "condition", map: META_CONDITION_MAP });
    case "google_truncate_title":
    case "meta_truncate_title":
      return spec(meta, { type: "always" }, { type: "truncate", field: "title", max_length: 150 });
    case "meta_truncate_description":
      return spec(meta, { type: "always" }, { type: "truncate", field: "description", max_length: 9999 });
    case "google_flag_missing_brand":
    case "meta_flag_missing_brand":
      return spec(meta, { type: "field_empty", field: "brand" }, { type: "flag_issue", field: "brand", message: "Brand is missing" });
    case "google_flag_missing_gtin":
      return spec(meta, { type: "field_empty", field: "gtin" }, { type: "flag_issue", field: "gtin", message: "GTIN missing for branded product" });
    case "meta_flag_missing_gtin":
      return spec(meta, { type: "field_empty", field: "gtin" }, { type: "flag_issue", field: "gtin", message: "GTIN missing for product matching" });
    case "google_flag_short_description":
      return spec(meta, { type: "field_matches", field: "description", pattern: "^.{1,99}$" }, { type: "flag_issue", field: "description", message: "Description is too short for Google Shopping" });
    case "google_flag_missing_image":
    case "meta_flag_missing_image":
      return spec(meta, { type: "field_empty", field: "image_link" }, { type: "flag_issue", field: "image_link", message: "Missing image URL" });
    default:
      return null;
  }
}

export function getPlatformDefaultRuleSpecs(
  platform: "google_shopping" | "meta_catalog"
): PipelineRuleSpec[] {
  return getPlatformDefaultRules(platform)
    .map((rule) => getPlatformDefaultRuleSpec(rule.id))
    .filter((rule): rule is PipelineRuleSpec => rule !== null);
}

export function getBasicFixRuleSpecs(): PipelineRuleSpec[] {
  return [
    {
      label: "Trim whitespace from titles",
      plain_english: "Removes leading and trailing whitespace from product titles.",
      stage: "format",
      condition: { type: "always" },
      action: { type: "trim", field: "title" },
    },
    {
      label: "Trim whitespace from descriptions",
      plain_english: "Removes leading and trailing whitespace from product descriptions.",
      stage: "format",
      condition: { type: "always" },
      action: { type: "trim", field: "description" },
    },
    {
      label: "Trim whitespace from brands",
      plain_english: "Removes leading and trailing whitespace from brand values.",
      stage: "format",
      condition: { type: "always" },
      action: { type: "trim", field: "brand" },
    },
    {
      label: "Strip HTML from titles",
      plain_english: "Removes HTML tags from product titles.",
      stage: "format",
      condition: { type: "field_matches", field: "title", pattern: "<[^>]+>" },
      action: { type: "strip_html", field: "title" },
    },
    {
      label: "Strip HTML from descriptions",
      plain_english: "Removes HTML tags from product descriptions.",
      stage: "format",
      condition: { type: "field_matches", field: "description", pattern: "<[^>]+>" },
      action: { type: "strip_html", field: "description" },
    },
    {
      label: "Normalize price format",
      plain_english: "Formats price values as two-decimal numbers.",
      stage: "format",
      condition: { type: "always" },
      action: { type: "normalize_price", field: "price" },
    },
    {
      label: "Normalize sale price format",
      plain_english: "Formats sale price values as two-decimal numbers.",
      stage: "format",
      condition: { type: "always" },
      action: { type: "normalize_price", field: "sale_price" },
    },
    {
      label: "Flag missing title",
      plain_english: "Flags products that are missing a title.",
      stage: "validation",
      condition: { type: "field_empty", field: "title" },
      action: { type: "flag_issue", field: "title", message: "Missing required field: title" },
    },
    {
      label: "Flag missing price",
      plain_english: "Flags products that are missing a price.",
      stage: "validation",
      condition: { type: "field_empty", field: "price" },
      action: { type: "flag_issue", field: "price", message: "Missing required field: price" },
    },
    {
      label: "Flag missing availability",
      plain_english: "Flags products that are missing availability.",
      stage: "validation",
      condition: { type: "field_empty", field: "availability" },
      action: { type: "flag_issue", field: "availability", message: "Missing required field: availability" },
    },
    {
      label: "Flag missing condition",
      plain_english: "Flags products that are missing condition.",
      stage: "validation",
      condition: { type: "field_empty", field: "condition" },
      action: { type: "flag_issue", field: "condition", message: "Missing required field: condition" },
    },
    {
      label: "Flag missing image URL",
      plain_english: "Flags products that are missing an image URL.",
      stage: "validation",
      condition: { type: "field_empty", field: "image_link" },
      action: { type: "flag_issue", field: "image_link", message: "Missing image URL" },
    },
  ];
}
