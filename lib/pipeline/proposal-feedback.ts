import Anthropic from "@anthropic-ai/sdk";
import { renderRuleCatalogForPrompt, validatePipelineRuleSpec } from "./rule-catalog";
import { buildRuleProposal, type ProposalOrigin, type RuleProposal } from "./proposals";
import type { PipelineRuleSpec } from "./rule-schema";

type FeedbackResult =
  | { type: "updated_proposal"; proposal: RuleProposal; message: string }
  | { type: "suppress_similar"; message: string }
  | { type: "clarification"; message: string };

type ModelFeedbackResponse = {
  type?: "updated_proposal" | "suppress_similar" | "clarification";
  message?: string;
  rule?: PipelineRuleSpec;
};

const SYSTEM_PROMPT = `You revise product feed recommendations from user feedback.

You receive:
- the current validated recommendation rule
- dry-run examples showing before/after
- user feedback about what should change

Return ONLY a JSON object:

UPDATED RECOMMENDATION:
{
  "type": "updated_proposal",
  "message": "Short explanation of the revision",
  "rule": <PipelineRuleSpec>
}

SUPPRESS SIMILAR:
{
  "type": "suppress_similar",
  "message": "Short explanation that similar recommendations will be skipped"
}

CLARIFICATION:
{
  "type": "clarification",
  "message": "One short question asking what is needed"
}

Rules:
- Use updated_proposal when the feedback can be represented by the rule catalog.
- Use suppress_similar when the user says they do not want this kind of recommendation.
- Use clarification only when the feedback is ambiguous or unsafe.
- Preserve the original rule condition unless the feedback clearly requires a different target set.
- If the user asks to fill, force, overwrite, or use a fixed fallback value for matched rows, use set_value, not set_default.
- Do not invent columns. Use only fields from the original rule or examples.

${renderRuleCatalogForPrompt()}`;

async function getAnthropicClient() {
  let apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    try {
      const fs = await import("fs");
      const path = await import("path");
      const content = fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
      const match = content.match(/^ANTHROPIC_API_KEY=(.+)$/m);
      if (match) apiKey = match[1].trim();
    } catch {
      // ignore
    }
  }
  return new Anthropic({ apiKey });
}

export async function reviseProposalFromFeedback({
  feedback,
  origin,
  rule,
  rows,
  examples,
}: {
  feedback: string;
  origin: ProposalOrigin;
  rule: PipelineRuleSpec;
  rows: Record<string, string>[];
  examples: { row_index: number; field: string; before: string; after: string }[];
}): Promise<FeedbackResult> {
  const client = await getAnthropicClient();
  const prompt = `Current recommendation:
${JSON.stringify(rule, null, 2)}

Dry-run examples:
${JSON.stringify(examples.slice(0, 5), null, 2)}

User feedback:
"${feedback}"`;

  const response = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1200,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : "{}";

  let parsed: ModelFeedbackResponse;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return {
      type: "clarification",
      message: "I could not turn that feedback into a safe recommendation. Can you rephrase what should happen to the affected rows?",
    };
  }

  if (parsed.type === "suppress_similar") {
    return {
      type: "suppress_similar",
      message: parsed.message || "Got it. I will skip similar recommendations for this sync.",
    };
  }

  if (parsed.type !== "updated_proposal" || !parsed.rule) {
    return {
      type: "clarification",
      message: parsed.message || "What should I change about this recommendation?",
    };
  }

  const validation = validatePipelineRuleSpec(parsed.rule);
  if (!validation.ok) {
    return {
      type: "clarification",
      message: "I understood the feedback, but the revised fix is not one I can safely run yet. Can you describe it another way?",
    };
  }

  const proposal = buildRuleProposal({
    id: `feedback_${Date.now()}`,
    origin,
    rows,
    rule: validation.rule,
  });

  if (!proposal) {
    return {
      type: "clarification",
      message: "The revised recommendation would not affect any rows. What rows should it apply to?",
    };
  }

  return {
    type: "updated_proposal",
    proposal,
    message: parsed.message || "I updated the recommendation based on your feedback.",
  };
}
