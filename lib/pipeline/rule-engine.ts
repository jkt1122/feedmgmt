import type { RuleCondition, RuleAction, PipelineRuleSpec } from "./rule-schema";

export function applyRule(
  row: Record<string, string>,
  spec: PipelineRuleSpec
): { row: Record<string, string>; matched: boolean } {
  if (!matchesCondition(row, spec.condition)) {
    return { row, matched: false };
  }
  return { row: applyAction(row, spec.action), matched: true };
}

export function applyRules(
  rows: Record<string, string>[],
  specs: PipelineRuleSpec[]
): { rows: Record<string, string>[]; matchCounts: number[] } {
  const matchCounts = specs.map(() => 0);

  const result = rows.map((row) => {
    let current = { ...row };
    specs.forEach((spec, i) => {
      const { row: next, matched } = applyRule(current, spec);
      current = next;
      if (matched) matchCounts[i]++;
    });
    return current;
  });

  return { rows: result, matchCounts };
}

function matchesCondition(
  row: Record<string, string>,
  condition: RuleCondition
): boolean {
  switch (condition.type) {
    case "always":
      return true;
    case "field_empty":
      return !row[condition.field] || row[condition.field].trim() === "";
    case "field_matches": {
      const val = row[condition.field] ?? "";
      try {
        return new RegExp(condition.pattern, "i").test(val);
      } catch {
        return false;
      }
    }
    case "field_not_in": {
      const val = (row[condition.field] ?? "").toLowerCase().trim();
      return !condition.values.map((v) => v.toLowerCase()).includes(val);
    }
  }
}

function applyAction(
  row: Record<string, string>,
  action: RuleAction
): Record<string, string> {
  const r = { ...row };
  switch (action.type) {
    case "trim":
      r[action.field] = (r[action.field] ?? "").trim();
      break;
    case "lowercase":
      r[action.field] = (r[action.field] ?? "").toLowerCase();
      break;
    case "uppercase":
      r[action.field] = (r[action.field] ?? "").toUpperCase();
      break;
    case "replace":
      r[action.field] = (r[action.field] ?? "").replaceAll(
        action.find,
        action.replace
      );
      break;
    case "replace_map": {
      const val = (r[action.field] ?? "").toLowerCase().trim();
      r[action.field] = action.map[val] ?? r[action.field];
      break;
    }
    case "set_default":
      if (!r[action.field] || r[action.field].trim() === "") {
        r[action.field] = action.value;
      }
      break;
    case "prefix":
      r[action.field] = action.value + (r[action.field] ?? "");
      break;
    case "suffix":
      r[action.field] = (r[action.field] ?? "") + action.value;
      break;
    case "strip_html":
      r[action.field] = (r[action.field] ?? "").replace(/<[^>]*>/g, "").trim();
      break;
    case "normalize_price": {
      const raw = (r[action.field] ?? "").replace(/[^0-9.]/g, "");
      const num = parseFloat(raw);
      if (!isNaN(num)) r[action.field] = num.toFixed(2);
      break;
    }
    case "flag_issue":
      // flag_issue doesn't modify the row — handled separately in validation
      break;
  }
  return r;
}

export function previewRule(
  rows: Record<string, string>[],
  spec: PipelineRuleSpec,
  maxPreviews = 5
): { affected_count: number; preview: { before: string; after: string }[] } {
  const field = "field" in spec.action ? spec.action.field : "";
  const previews: { before: string; after: string }[] = [];
  let affected_count = 0;

  for (const row of rows) {
    const { row: transformed, matched } = applyRule(row, spec);
    if (!matched) continue;
    affected_count++;
    if (previews.length < maxPreviews) {
      const before = row[field] ?? "";
      const after = transformed[field] ?? "";
      if (before !== after || spec.action.type === "flag_issue") {
        previews.push({ before, after });
      }
    }
  }

  return { affected_count, preview: previews };
}
