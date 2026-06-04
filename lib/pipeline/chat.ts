import Anthropic from "@anthropic-ai/sdk";
import type { PipelineRuleSpec } from "./rule-schema";
import { previewRule } from "./rule-engine";

type Product = {
  id: string;
  row_index: number;
  data: Record<string, unknown>;
  original_data?: Record<string, unknown>;
};

type DataSource = {
  column_mapping: Record<string, string>;
  name: string;
};

export type ChatResult = {
  explanation: string;
  rule: PipelineRuleSpec | null;
  affected_count: number;
  preview: { row_index: number; field: string; before: string; after: string }[];
  instruction: string;
  is_question: boolean;
};

const SYSTEM_PROMPT = `You are Feed Assistant, a specialist tool for cleaning and transforming product catalog data for Google Merchant Center and Meta Catalog feeds.

Your ONLY job is to help users apply data transformations to their product feed — things like fixing field formats, normalizing values, filling in defaults, or combining fields. You are not a general-purpose assistant.

You will receive a user instruction and their product data. You must respond with a JSON object — one of three types:

---

TYPE 1 — TRANSFORMATION (user wants to change their data):
{
  "type": "transformation",
  "explanation": "Plain English: what will happen and how many products are affected",
  "rule": {
    "label": "Short rule name",
    "plain_english": "What this rule does",
    "stage": "format" | "quality" | "validation",
    "condition": <condition object>,
    "action": <action object>
  }
}

TYPE 2 — DATA QUESTION (user asks about their feed data):
{
  "type": "question",
  "explanation": "Direct answer using specific values and examples from the data provided"
}

TYPE 3 — OUT OF SCOPE (anything not about this feed's data):
{
  "type": "out_of_scope",
  "explanation": "One sentence explaining you can only help with product feed data transformations and questions about this feed."
}

---

Use TYPE 3 for:
- General e-commerce, marketing, or business questions not about this specific feed
- Requests to write code, explain concepts, or do tasks unrelated to feed data
- Questions about other tools, platforms, or systems
- Anything that isn't "look at my feed data" or "transform my feed data"

Use TYPE 2 for questions about the data (counts, distributions, examples). Answer only from the data provided — if you cannot determine the answer from the data shown, say so clearly rather than guessing.

Use TYPE 1 for any instruction to modify, clean, format, or enrich field values.

---

Condition types:
- { "type": "always" }
- { "type": "field_empty", "field": "<source_column_name>" }
- { "type": "field_matches", "field": "<source_column_name>", "pattern": "<regex>" }
- { "type": "field_not_in", "field": "<source_column_name>", "values": ["val1", "val2"] }

Action types:
- { "type": "trim", "field": "<source_column_name>" }
- { "type": "strip_html", "field": "<source_column_name>" }
- { "type": "replace_map", "field": "<source_column_name>", "map": { "old_value": "new_value" } }
- { "type": "normalize_price", "field": "<source_column_name>" }
- { "type": "set_default", "field": "<source_column_name>", "value": "<default>" }
- { "type": "replace", "field": "<source_column_name>", "find": "<text>", "replace": "<text>" }
- { "type": "uppercase", "field": "<source_column_name>" }
- { "type": "lowercase", "field": "<source_column_name>" }
- { "type": "template", "field": "<target_column>", "template": "{OtherColumn} - {TargetColumn}" }

IMPORTANT: Use exact source column names from the data. Return ONLY the JSON object, no other text.`;

export async function processChatInstruction({
  instruction,
  source,
  products,
  history,
}: {
  instruction: string;
  source: DataSource;
  products: Product[];
  history: { role: string; content: string }[];
}): Promise<ChatResult> {
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

  const rows = products.map((p) => p.data as Record<string, string>);

  const reverseMapping: Record<string, string> = {};
  for (const [canonical, source_col] of Object.entries(source.column_mapping)) {
    if (source_col) reverseMapping[source_col] = canonical;
  }

  // Format rows as compact TSV to reduce token usage while keeping all rows visible
  const allColumns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const tsvHeader = ["#", ...allColumns].join("\t");
  const tsvRows = rows.map((r, i) => [i + 1, ...allColumns.map((c) => String(r[c] ?? "").replace(/\t/g, " ").replace(/\n/g, " "))].join("\t"));
  const dataBlock = [tsvHeader, ...tsvRows].join("\n");

  const userPrompt = `Data source: "${source.name}"
Total products: ${rows.length}

Column mapping (source → canonical):
${JSON.stringify(reverseMapping, null, 2)}

All product data (${rows.length} rows):
${dataBlock}

User instruction: "${instruction}"`;

  const messages = [
    ...history.map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user" as const, content: userPrompt },
  ];

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages,
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON object from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : "{}";

  let parsed: { type?: string; is_question?: boolean; explanation: string; rule?: PipelineRuleSpec };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return {
      is_question: true,
      explanation: text || "I couldn't process that instruction. Please try rephrasing.",
      rule: null,
      affected_count: 0,
      preview: [],
      instruction,
    };
  }

  // Normalise: support both new `type` field and legacy `is_question`
  const responseType = parsed.type ?? (parsed.is_question ? "question" : "transformation");

  if (responseType === "question" || responseType === "out_of_scope" || !parsed.rule) {
    return {
      is_question: true,
      explanation: parsed.explanation,
      rule: null,
      affected_count: 0,
      preview: [],
      instruction,
    };
  }

  // Generate row-level preview
  const { affected_count, preview: fieldPreviews } = previewRule(rows, parsed.rule);

  const preview = fieldPreviews.map((p, i) => ({
    row_index: i,
    field: "field" in parsed.rule!.action ? (parsed.rule!.action as { field: string }).field : "",
    before: p.before,
    after: p.after,
  }));

  return {
    is_question: false,
    explanation: parsed.explanation,
    rule: parsed.rule,
    affected_count,
    preview,
    instruction,
  };
}
