export type RuleCondition =
  | { type: "always" }
  | { type: "field_empty"; field: string }
  | { type: "field_matches"; field: string; pattern: string }
  | { type: "field_not_in"; field: string; values: string[] };

export type RuleAction =
  | { type: "trim"; field: string }
  | { type: "lowercase"; field: string }
  | { type: "uppercase"; field: string }
  | { type: "replace"; field: string; find: string; replace: string }
  | { type: "replace_map"; field: string; map: Record<string, string> }
  | { type: "set_default"; field: string; value: string }
  | { type: "prefix"; field: string; value: string }
  | { type: "suffix"; field: string; value: string }
  | { type: "strip_html"; field: string }
  | { type: "normalize_price"; field: string }
  | { type: "flag_issue"; field: string; message: string }
  | { type: "template"; field: string; template: string }; // e.g. "{Brand} - {Title}"

export type PipelineRuleSpec = {
  label: string;
  plain_english: string;
  stage: "format" | "quality" | "validation";
  condition: RuleCondition;
  action: RuleAction;
};

export type ProposedRule = PipelineRuleSpec & {
  affected_count: number;
  preview: { before: string; after: string }[];
};
