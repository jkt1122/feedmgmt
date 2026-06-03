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

const SYSTEM_PROMPT = `You are a product feed data assistant. You help merchants clean and transform their product catalog data.

You will receive a user instruction and a sample of their product data. You must respond with a JSON object.

The user may ask you to:
1. Transform data (e.g. "capitalize all titles", "add USD to prices", "replace 'yes' with 'in_stock' in availability")
2. Ask questions about their data (e.g. "how many products are missing brand?")

For TRANSFORMATIONS, respond with:
{
  "is_question": false,
  "explanation": "Plain English description of what will happen and how many products are affected",
  "rule": {
    "label": "Short rule name",
    "plain_english": "What this rule does",
    "stage": "format" | "quality" | "validation",
    "condition": <condition object>,
    "action": <action object>
  }
}

For QUESTIONS, respond with:
{
  "is_question": true,
  "explanation": "Direct answer to the question with specific numbers/examples from the data"
}

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
- { "type": "template", "field": "<target_column>", "template": "{OtherColumn} - {TargetColumn}" } // combine fields; use exact source column names in {}

IMPORTANT: Use exact source column names from the data sample. Return ONLY the JSON object, no other text.`;

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
  const sample = rows.slice(0, 20);

  const reverseMapping: Record<string, string> = {};
  for (const [canonical, source_col] of Object.entries(source.column_mapping)) {
    if (source_col) reverseMapping[source_col] = canonical;
  }

  const userPrompt = `Data source: "${source.name}"
Total products: ${rows.length}

Column mapping (source → canonical):
${JSON.stringify(reverseMapping, null, 2)}

Sample data (first 20 rows):
${JSON.stringify(sample, null, 2)}

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
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages,
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";

  // Extract JSON object from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : "{}";

  let parsed: { is_question: boolean; explanation: string; rule?: PipelineRuleSpec };
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

  if (parsed.is_question || !parsed.rule) {
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
