import Anthropic from "@anthropic-ai/sdk";
import type { PipelineRuleSpec, ProposedRule } from "./rule-schema";
import { previewRule } from "./rule-engine";
import { DEFAULT_RULES } from "./defaults";
import { renderRuleCatalogForPrompt, validatePipelineRuleSpec } from "./rule-catalog";

const DEFAULT_RULE_LABELS = DEFAULT_RULES.map((r) => r.label);

const SYSTEM_PROMPT = `You are a data quality expert analyzing product catalog CSV data for e-commerce feed management.

Your job is to identify data quality issues and propose pipeline transformation rules to fix them.

You must respond with a JSON array of rule objects. Each rule has this exact structure:
{
  "label": "Short rule name (e.g. 'Trim whitespace from titles')",
  "plain_english": "What this rule does in plain English",
  "stage": "format" | "quality" | "validation",
  "condition": <condition object>,
  "action": <action object>
}

${renderRuleCatalogForPrompt()}

IMPORTANT:
- Use the exact source column names from the data (not canonical field names)
- Propose 3-8 rules maximum — only the most impactful ones
- Focus on: inconsistent categorical values, brand-specific formatting, missing optional-but-recommended fields, custom label opportunities
- Do NOT suggest rules that are already handled automatically (listed below) — focus on feed-specific issues
- Return ONLY the JSON array, no other text

Already handled automatically (do not suggest these):
${DEFAULT_RULE_LABELS.map((l) => `- ${l}`).join("\n")}`;


export async function analyzeDataForRules(
  rows: Record<string, string>[],
  columnMapping: Record<string, string>
): Promise<ProposedRule[]> {
  // Read key directly from .env.local as a fallback for hot-reload env issues
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
  // Sample up to 50 rows
  const sample = rows.slice(0, 50);

  // Build a summary of unique values per column (for categorical fields)
  const columns = Object.keys(rows[0] ?? {});
  const columnSummary: Record<string, string[]> = {};
  for (const col of columns) {
    const unique = Array.from(new Set(sample.map((r) => r[col] ?? "").filter(Boolean)));
    columnSummary[col] = unique.slice(0, 20);
  }

  // Build reverse mapping: source column → canonical field name
  const reverseMapping: Record<string, string> = {};
  for (const [canonical, source] of Object.entries(columnMapping)) {
    if (source) reverseMapping[source] = canonical;
  }

  const prompt = `Analyze this product catalog data and propose transformation rules.

Column mapping (source column → canonical field):
${JSON.stringify(reverseMapping, null, 2)}

Sample data (${sample.length} rows of ${rows.length} total):
${JSON.stringify(sample.slice(0, 10), null, 2)}

Unique values per column (to spot inconsistencies):
${Object.entries(columnSummary)
  .map(([col, vals]) => `${col}: ${vals.map((v) => JSON.stringify(v)).join(", ")}`)
  .join("\n")}

Propose transformation rules to improve data quality.`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      { role: "user", content: prompt },
    ],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  // Reconstruct prefilled opening, strip any trailing code fence
  const raw = "[" + text.replace(/```[\s\S]*$/, "").trim();

  // Extract each complete JSON object individually — more robust than parsing the whole array
  const objectMatches = raw.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g) ?? [];
  const specs: PipelineRuleSpec[] = [];
  for (const objStr of objectMatches) {
    try {
      const parsed = JSON.parse(objStr);
      const validation = validatePipelineRuleSpec(parsed);
      if (validation.ok) {
        specs.push(validation.rule);
      }
    } catch {
      // skip malformed objects
    }
  }

  if (specs.length === 0) throw new Error("Claude returned no valid rules");

  // Generate previews for each proposed rule
  return specs.map((spec) => {
    const { affected_count, preview } = previewRule(rows, spec);
    return { ...spec, affected_count, preview };
  });
}
