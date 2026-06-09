// Shared source import: parse the uploaded file and preserve raw rows.
// Transformations now live at the sync level.

import Papa from "papaparse";
import { SupabaseClient } from "@supabase/supabase-js";

type RunOptions = {
  serviceClient: SupabaseClient;
  source: {
    id: string;
    storage_path: string;
    column_mapping: Record<string, string>;
    merchant_id: string;
    disabled_default_rules?: string[];
  };
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
}: RunOptions): Promise<RunResult> {
  const { data: fileData, error: dlErr } = await serviceClient.storage
    .from("feeds")
    .download(source.storage_path);

  if (dlErr || !fileData) throw new Error(dlErr?.message ?? "Download failed");

  const csvText = await fileData.text();

  const parsed = Papa.parse<Record<string, string>>(csvText, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new Error("CSV parse failed: " + parsed.errors[0].message);
  }

  const rawRows = parsed.data;

  return {
    rawRows,
    rows: rawRows,
    validationIssuesByRow: new Map(),
    dbRuleIds: [],
    matchCounts: [],
  };
}
