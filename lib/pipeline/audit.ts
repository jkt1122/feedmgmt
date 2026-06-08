import Anthropic from "@anthropic-ai/sdk";
import type { PipelineRuleSpec } from "./rule-schema";

export type AuditFindingScope = "single" | "pattern";
export type AuditFindingTier = "ok" | "warning" | "opportunity";

export type AuditFinding = {
  tier: AuditFindingTier;
  scope: AuditFindingScope;
  field: string;
  message: string;
  affected_count: number;
  affected_row_indexes?: number[];
  suggested_rule?: PipelineRuleSpec;
};

export type AuditReport = {
  summary: string;
  findings: AuditFinding[];
};

const SYSTEM_PROMPT = `You are Feed Assistant, an expert in Google Merchant Center and Meta Catalog product feed quality.

You will receive product feed data and must produce a structured audit report. Analyze the data thoroughly and return a JSON object in this exact shape:

{
  "summary": "1-2 sentence overview of feed health",
  "findings": [
    {
      "tier": "ok" | "warning" | "opportunity",
      "scope": "single" | "pattern",
      "field": "<field name>",
      "message": "Specific, actionable description",
      "affected_count": <number>,
      "affected_row_indexes": [<row indexes if scope=single, up to 5>],
      "suggested_rule": <PipelineRuleSpec or null>
    }
  ]
}

Tier definitions:
- "ok": Field looks good, no action needed
- "warning": Missing required/recommended field, invalid value, or platform compliance issue
- "pattern": This is NOT a valid tier — use "warning" or "opportunity" with scope="pattern"
- "opportunity": Optimization that could improve ad performance (title length, keyword ordering, enrichment)

Scope definitions:
- "single": Affects 1–5 specific products (provide affected_row_indexes)
- "pattern": Affects many products with a similar underlying issue (no row indexes needed)

For "warning" + scope="pattern": always include a suggested_rule if the fix is automatable.
For "opportunity" findings: include a suggested_rule when the fix is a rule (e.g. truncate, template, prefix).
For "ok" findings: no suggested_rule needed.

PipelineRuleSpec shape for suggested_rule:
{
  "label": "Short rule name",
  "plain_english": "What this rule does",
  "stage": "format" | "quality" | "validation",
  "condition": { "type": "always" } | { "type": "field_empty", "field": "..." } | { "type": "field_matches", "field": "...", "pattern": "..." } | { "type": "field_not_in", "field": "...", "values": [...] },
  "action": one of the action types below
}

Action types:
- { "type": "trim", "field": "..." }
- { "type": "strip_html", "field": "..." }
- { "type": "replace_map", "field": "...", "map": { "old": "new" } }
- { "type": "normalize_price", "field": "..." }
- { "type": "set_default", "field": "...", "value": "..." }
- { "type": "replace", "field": "...", "find": "...", "replace": "..." }
- { "type": "uppercase", "field": "..." }
- { "type": "lowercase", "field": "..." }
- { "type": "template", "field": "...", "template": "{Col1} {Col2}" }
- { "type": "truncate", "field": "...", "max_length": <number> }
- { "type": "flag_issue", "field": "...", "message": "..." }

Focus on the most impactful findings. Return 4–10 findings total. Prioritize warnings over opportunities. Return ONLY the JSON object.`;

export async function runSyncAudit({
  rows,
  platform,
  columnMapping,
}: {
  rows: Record<string, string>[];
  platform: "google_shopping" | "meta_catalog";
  columnMapping: Record<string, string>;
}): Promise<AuditReport> {
  let apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const envPath = path.resolve(process.cwd(), ".env.local");
      const content = fs.readFileSync(envPath, "utf8");
      const match = content.match(/^ANTHROPIC_API_KEY=(.+)$/m);
      if (match) apiKey = match[1].trim();
    } catch { /* ignore */ }
  }

  const client = new Anthropic({ apiKey });

  const sample = rows.slice(0, 100);
  const allColumns = sample.length > 0 ? Object.keys(sample[0]) : [];
  const tsvHeader = ["#", ...allColumns].join("\t");
  const tsvRows = sample.map((r, i) =>
    [i, ...allColumns.map((c) => String(r[c] ?? "").replace(/\t/g, " ").replace(/\n/g, " "))].join("\t")
  );
  const dataBlock = [tsvHeader, ...tsvRows].join("\n");

  const platformLabel = platform === "google_shopping" ? "Google Shopping" : "Meta Catalog";

  const userPrompt = `Platform: ${platformLabel}
Total products in feed: ${rows.length} (showing first ${sample.length})

Column mapping (canonical → source column):
${JSON.stringify(columnMapping, null, 2)}

Product data (row index in first column):
${dataBlock}

Audit this feed for ${platformLabel} quality, compliance, and optimization opportunities.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : "{}";

  try {
    const parsed = JSON.parse(jsonStr) as AuditReport;
    return {
      summary: parsed.summary ?? "Audit complete.",
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    };
  } catch {
    return {
      summary: "Could not parse audit results. Please try again.",
      findings: [],
    };
  }
}
