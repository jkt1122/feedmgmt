import { createHash } from "crypto";
import { applyRule } from "./rule-engine";
import type { PipelineRuleSpec } from "./rule-schema";

export type ProposalOrigin = "basic_fix" | "platform_spec" | "agent_reasoned" | "user_request";
export type ProposalScope = "sync";

export type RuleDryRunExample = {
  row_index: number;
  field: string;
  before: string;
  after: string;
};

export type RuleDryRun = {
  affected_count: number;
  examples: RuleDryRunExample[];
};

export type RuleProposal = {
  id: string;
  fingerprint: string;
  origin: ProposalOrigin;
  scope: ProposalScope;
  rule: PipelineRuleSpec;
  dry_run: RuleDryRun;
};

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintRule(rule: PipelineRuleSpec): string {
  return createHash("sha256")
    .update(stableStringify({ condition: rule.condition, action: rule.action }))
    .digest("hex");
}

export function preferenceKeyForRule(rule: PipelineRuleSpec): string {
  const conditionField = "field" in rule.condition ? rule.condition.field : "any";
  const actionField = "field" in rule.action ? rule.action.field : "any";
  return [
    rule.stage,
    rule.condition.type,
    conditionField,
    rule.action.type,
    actionField,
  ].join(":");
}

export function dryRunRule(
  rows: Record<string, string>[],
  rule: PipelineRuleSpec,
  maxExamples = 5
): RuleDryRun {
  const field = "field" in rule.action ? rule.action.field : "";
  const examples: RuleDryRunExample[] = [];
  let affected_count = 0;

  rows.forEach((row, rowIndex) => {
    const { row: transformed, matched } = applyRule(row, rule);
    if (!matched) return;

    const before = row[field] ?? "";
    const after = transformed[field] ?? "";
    const changed = before !== after || rule.action.type === "flag_issue";
    if (!changed) return;

    affected_count++;
    if (examples.length < maxExamples) {
      examples.push({
        row_index: rowIndex,
        field,
        before,
        after,
      });
    }
  });

  return { affected_count, examples };
}

export function buildRuleProposal({
  id,
  origin,
  rows,
  rule,
}: {
  id?: string;
  origin: ProposalOrigin;
  rows: Record<string, string>[];
  rule: PipelineRuleSpec;
}): RuleProposal | null {
  const fingerprint = fingerprintRule(rule);
  const dry_run = dryRunRule(rows, rule);
  if (dry_run.affected_count === 0) return null;

  return {
    id: id ?? fingerprint,
    fingerprint,
    origin,
    scope: "sync",
    rule,
    dry_run,
  };
}
