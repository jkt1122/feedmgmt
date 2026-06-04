// Sync pipeline: takes canonical products from selected sources, applies filter
// rules, then accepted sync rules (saved pipeline_rules with sync_id).
// Platform defaults are NOT auto-applied — they are proposed as recommendations
// and only run once the user accepts them (they become pipeline_rules).

import { SupabaseClient } from "@supabase/supabase-js";
import { applyRules } from "./rule-engine";
import type { PipelineRuleSpec } from "./rule-schema";

export type FilterRule = {
  field: string;
  operator: "is" | "is_not" | "contains" | "greater_than" | "less_than";
  value: string;
};

export type SyncRunOptions = {
  serviceClient: SupabaseClient;
  sync: {
    id: string;
    merchant_id: string;
    platform: "google_shopping" | "meta_catalog";
    source_ids: string[];
    filter_rules: FilterRule[];
  };
};

export type SyncRunResult = {
  rows: Record<string, string>[];
  preTransformRows: Record<string, string>[];
  columnMapping: Record<string, string>;
  validationIssuesByRow: Map<number, { field: string; message: string }[]>;
  syncRuleIds: string[];
  matchCounts: number[];
  totalSourceRows: number;
  filteredOutCount: number;
};

export async function runSyncPipeline({
  serviceClient,
  sync,
}: SyncRunOptions): Promise<SyncRunResult> {
  // 1. Collect canonical products from all selected sources
  const allProducts: Record<string, string>[] = [];
  let columnMapping: Record<string, string> = {};

  for (const sourceId of sync.source_ids) {
    const { data: source } = await serviceClient
      .from("data_sources")
      .select("column_mapping")
      .eq("id", sourceId)
      .eq("merchant_id", sync.merchant_id)
      .single();

    if (source?.column_mapping) {
      columnMapping = { ...columnMapping, ...source.column_mapping };
    }

    const { data: products } = await serviceClient
      .from("canonical_products")
      .select("*")
      .eq("source_id", sourceId)
      .eq("merchant_id", sync.merchant_id)
      .order("row_index", { ascending: true });

    if (products) {
      for (const p of products) {
        const row: Record<string, string> = {};
        const mapping = source?.column_mapping ?? {};
        for (const [canonical, srcCol] of Object.entries(mapping)) {
          const dataObj = p.data as Record<string, string> | null;
          row[canonical] = String(dataObj?.[srcCol as string] ?? "");
        }
        if (!row.id) row.id = String((p as Record<string, unknown>).product_id ?? "");
        allProducts.push(row);
      }
    }
  }

  const totalSourceRows = allProducts.length;

  // 2. Deduplicate by id (keep first)
  const seen = new Set<string>();
  const deduped = allProducts.filter((r) => {
    const id = r.id ?? "";
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  // 3. Apply filter rules
  const filtered = applyFilterRules(deduped, sync.filter_rules);
  const filteredOutCount = deduped.length - filtered.length;

  // Snapshot before sync rules (for diff/color-coding in UI)
  const preTransformRows = filtered.map((r) => ({ ...r }));

  // 4. Apply accepted sync rules (pipeline_rules with sync_id, enabled=true)
  const { data: syncRulesData } = await serviceClient
    .from("pipeline_rules")
    .select("*")
    .eq("sync_id", sync.id)
    .eq("merchant_id", sync.merchant_id)
    .eq("enabled", true)
    .order("sort_order", { ascending: true });

  const syncSpecs: PipelineRuleSpec[] = (syncRulesData ?? []).map((r) => ({
    label: r.label,
    plain_english: r.plain_english,
    stage: r.stage,
    condition: r.conditions as PipelineRuleSpec["condition"],
    action: r.actions as PipelineRuleSpec["action"],
  }));

  const { rows, matchCounts } = syncSpecs.length > 0
    ? applyRules(filtered, syncSpecs)
    : { rows: filtered, matchCounts: [] };

  return {
    rows,
    preTransformRows,
    columnMapping,
    validationIssuesByRow: new Map(),
    syncRuleIds: (syncRulesData ?? []).map((r) => r.id),
    matchCounts,
    totalSourceRows,
    filteredOutCount,
  };
}

function applyFilterRules(
  rows: Record<string, string>[],
  filters: FilterRule[]
): Record<string, string>[] {
  if (!filters || filters.length === 0) return rows;

  return rows.filter((row) =>
    filters.every((f) => {
      const val = (row[f.field] ?? "").trim();
      switch (f.operator) {
        case "is": return val.toLowerCase() === f.value.toLowerCase();
        case "is_not": return val.toLowerCase() !== f.value.toLowerCase();
        case "contains": return val.toLowerCase().includes(f.value.toLowerCase());
        case "greater_than": return parseFloat(val) > parseFloat(f.value);
        case "less_than": return parseFloat(val) < parseFloat(f.value);
        default: return true;
      }
    })
  );
}
