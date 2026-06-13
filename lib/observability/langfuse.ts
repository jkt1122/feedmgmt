import { Langfuse } from "langfuse";

/**
 * Langfuse tracing for the Feed Assistant.
 *
 * This is intentionally a thin, optional layer: if the three LANGFUSE_* env
 * vars are not set, getLangfuse() returns null and every call site no-ops, so
 * the agent runs identically with or without observability configured.
 *
 * Concepts (classic imperative SDK):
 *  - trace      = one logical interaction (one chat turn, one audit run)
 *  - generation = one LLM call inside that trace (the repair-loop retry is its
 *                 own generation under the same trace)
 *  - flush      = on serverless (Vercel) the function can be frozen the moment
 *                 it returns, so traces MUST be flushed before we return or they
 *                 are silently dropped. Always `await flushLangfuse()`.
 */

let client: Langfuse | null = null;
let initialized = false;

/** Strip surrounding single/double quotes that .env values are sometimes wrapped in. */
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && /^(".*"|'.*')$/.test(trimmed)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Read an env var, falling back to .env.local (same quirk as ANTHROPIC_API_KEY). */
function readEnv(name: string): string | undefined {
  const fromProcess = process.env[name];
  if (fromProcess) return unquote(fromProcess);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("fs") as typeof import("fs");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require("path") as typeof import("path");
    const content = fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8");
    const match = content.match(new RegExp(`^${name}=(.+)$`, "m"));
    return match ? unquote(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

export function getLangfuse(): Langfuse | null {
  if (initialized) return client;
  initialized = true;

  const publicKey = readEnv("LANGFUSE_PUBLIC_KEY");
  const secretKey = readEnv("LANGFUSE_SECRET_KEY");
  if (!publicKey || !secretKey) return null;

  client = new Langfuse({
    publicKey,
    secretKey,
    // Defaults to Langfuse Cloud; point at a self-hosted instance by setting
    // LANGFUSE_BASE_URL (e.g. http://localhost:3000). Both spellings accepted.
    baseUrl:
      readEnv("LANGFUSE_BASE_URL") ??
      readEnv("LANGFUSE_BASEURL") ??
      "https://cloud.langfuse.com",
  });
  return client;
}

/**
 * Where this trace is running, so local vs Vercel runs are distinguishable in
 * the Langfuse UI. Vercel sets VERCEL_ENV to production/preview/development.
 */
export function tracingEnvironment(): string {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv) return `vercel:${vercelEnv}`;
  if (process.env.VERCEL) return "vercel";
  return "local";
}

/** Flush pending events. Safe to call when Langfuse is not configured. */
export async function flushLangfuse(): Promise<void> {
  if (!client) return;
  try {
    await client.flushAsync();
  } catch {
    /* never let observability break the request */
  }
}
