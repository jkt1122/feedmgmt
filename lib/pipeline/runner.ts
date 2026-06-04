// Shared pipeline data transformation: defaults → user globals → source rules.
// Returns processed rows + validation issues. DB writes stay in callers.

import Papa from "papaparse";
import { SupabaseClient } from "@supabase/supabase-js";
import { applyRules } from "./rule-engine";
import { applyDefaultTransformations } from "./defaults";
import type { PipelineRuleSpec } from "./rule-schema";

type RunOptions = {
  serviceClient: SupabaseClient;
  source: {
    id: string;
    storage_path: string;
    column_mapping: Record<string, string>;
    merchant_id: string;
    disabled_default_rules?: string[];
  };
  extraRules?: PipelineRuleSpec[];
};

export type RunResult = {
  rawRows: Record<string, string>[];
  rows: Record<string, string>[];
  validationIssuesByRow: Map<number, { field: string; message: string }[]>;
  dbRuleIds: string[];
  matchCounts: number[];
};

export async function runPipelineTransform({
  serviceClient,
  source,
  extraRules = [],
}: RunOptions): Promise<RunResult> {
  const { data: fileData, error: dlErr } = await serviceClient.storage
    .from("feeds")
    .download(source.storage_path);

  if (dlErr || !fileData) throw new Error(dlErr?.message ?? "Download failed");

  const csvText = await fileData.text();
  const mapping: Record<string, string> = source.column_mapping ?? {};

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error("CSV parse failed: " + parsed.errors[0].message);
  }

  const rawRows = parsed.data;

  // Step 1: default global transformations
  const { rows: afterDefaults, issues: defaultIssues } = applyDefaultTransformations(
    rawRows,
    mapping,
    source.disabled_default_rules ?? []
  );

  // Step 2: user global rules (source_id IS NULL)
  const { data: globalRulesData } = await serviceClient
    .from("pipeline_rules")
    .select("*")
    .is("source_id", null)
    .eq("merchant_id", source.merchant_id)
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  // Step 3: source-specific rules
  const { data: sourceRulesData } = await serviceClient
    .from("pipeline_rules")
    .select("*")
    .eq("source_id", source.id)
    .eq("merchant_id", source.merchant_id)
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  const allDbRules = [...(globalRulesData ?? []), ...(sourceRulesData ?? [])];
  const allSpecs: PipelineRuleSpec[] = [
    ...allDbRules.map((r) => ({
      label: r.label,
      plain_english: r.plain_english,
      stage: r.stage,
      condition: r.conditions as PipelineRuleSpec["condition"],
      action: r.actions as PipelineRuleSpec["action"],
    })),
    ...extraRules,
  ];

  const { rows, matchCounts } = allSpecs.length > 0
    ? applyRules(afterDefaults, allSpecs)
    : { rows: afterDefaults, matchCounts: [] };

  // Build per-row validation issue map from default pass
  const validationIssuesByRow = new Map<number, { field: string; message: string }[]>();
  for (const issue of defaultIssues) {
    const list = validationIssuesByRow.get(issue.rowIndex) ?? [];
    list.push({ field: issue.field, message: issue.message });
    validationIssuesByRow.set(issue.rowIndex, list);
  }

  return {
    rawRows,
    rows,
    validationIssuesByRow,
    dbRuleIds: allDbRules.map((r) => r.id),
    matchCounts,
  };
}
