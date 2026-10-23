/**
 * Calls the company's own model with the company's own key.
 * Both providers are forced to answer through one tool, then the result is
 * validated with Zod. One retry with the validation error; then we give up
 * loudly rather than guess.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { DraftSchema, draftJsonSchema, type Draft } from "./draft-schema";

export type AiCredentials = { provider: "anthropic" | "openai"; apiKey: string; model: string | null };
export type DraftCaller = (system: string, user: string) => Promise<{ draft: Draft; model: string; raw: unknown }>;

export const DEFAULT_MODELS = { anthropic: "claude-sonnet-5-5", openai: "gpt-5.4-mini" } as const;
const TOOL_NAME = "submit_draft";
const TOOL_DESCRIPTION = "Submit the draft quote for human review.";

export class AiError extends Error {
  constructor(message: string, public readonly userMessage: string) {
    super(message);
  }
}

async function callAnthropic(creds: AiCredentials, system: string, messages: Anthropic.MessageParam[]) {
  const client = new Anthropic({ apiKey: creds.apiKey, timeout: 90_000, maxRetries: 1 });
  const model = creds.model || DEFAULT_MODELS.anthropic;
  const res = await client.messages.create({
    model,
    max_tokens: 4000,
    system,
    messages,
    tools: [{ name: TOOL_NAME, description: TOOL_DESCRIPTION, input_schema: draftJsonSchema() as Anthropic.Tool.InputSchema }],
    tool_choice: { type: "tool", name: TOOL_NAME },
  });
  const block = res.content.find((b) => b.type === "tool_use");
  return { model, raw: block?.type === "tool_use" ? block.input : null, toolUseId: block?.type === "tool_use" ? block.id : null, content: res.content };
}

async function callOpenAI(creds: AiCredentials, system: string, user: string, feedback: string | null) {
  const client = new OpenAI({ apiKey: creds.apiKey, timeout: 90_000, maxRetries: 1 });
  const model = creds.model || DEFAULT_MODELS.openai;
  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
      ...(feedback ? [{ role: "user" as const, content: feedback }] : []),
    ],
    tools: [{ type: "function", function: { name: TOOL_NAME, description: TOOL_DESCRIPTION, parameters: draftJsonSchema() } }],
    tool_choice: { type: "function", function: { name: TOOL_NAME } },
  });
  const call = res.choices[0]?.message.tool_calls?.[0];
  const args = call && "function" in call ? call.function.arguments : null;
  let raw: unknown = null;
  try {
    raw = args ? JSON.parse(args) : null;
  } catch {
    raw = null;
  }
  return { model, raw };
}

function describeIssues(err: unknown): string {
  const issues = (err as { issues?: { path: PropertyKey[]; message: string }[] }).issues ?? [];
  return issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
}

export function makeDraftCaller(creds: AiCredentials): DraftCaller {
  return async (system, user) => {
    try {
      if (creds.provider === "anthropic") {
        const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
        let r = await callAnthropic(creds, system, messages);
        let parsed = DraftSchema.safeParse(r.raw);
        if (!parsed.success && r.toolUseId) {
          messages.push({ role: "assistant", content: r.content });
          messages.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: r.toolUseId,
                is_error: true,
                content: `Invalid. Fix these and call ${TOOL_NAME} again:\n${describeIssues(parsed.error)}`,
              },
            ],
          });
          r = await callAnthropic(creds, system, messages);
          parsed = DraftSchema.safeParse(r.raw);
        }
        if (!parsed.success) throw new AiError(describeIssues(parsed.error), "The AI's answer didn't fit the expected shape. Try again.");
        return { draft: parsed.data, model: r.model, raw: r.raw };
      }
      let r = await callOpenAI(creds, system, user, null);
      let parsed = DraftSchema.safeParse(r.raw);
      if (!parsed.success) {
        r = await callOpenAI(creds, system, user, `Your last answer was invalid. Fix:\n${describeIssues(parsed.error)}`);
        parsed = DraftSchema.safeParse(r.raw);
      }
      if (!parsed.success) throw new AiError(describeIssues(parsed.error), "The AI's answer didn't fit the expected shape. Try again.");
      return { draft: parsed.data, model: r.model, raw: r.raw };
    } catch (e) {
      if (e instanceof AiError) throw e;
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) throw new AiError(String(e), "The API key was rejected. Check it in Settings.");
      if (status === 404) throw new AiError(String(e), "That model isn't available on this API key. Check the model in Settings.");
      if (status === 429) throw new AiError(String(e), "The AI provider is rate-limiting this key. Wait a minute and try again.");
      throw new AiError(String(e), "The AI provider didn't respond properly. Try again in a moment.");
    }
  };
}

/** Cheap call used when a key is saved, so a typo is caught immediately. */
export async function verifyKey(creds: AiCredentials): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    if (creds.provider === "anthropic") {
      await new Anthropic({ apiKey: creds.apiKey, timeout: 20_000, maxRetries: 0 }).models.list({ limit: 1 });
    } else {
      await new OpenAI({ apiKey: creds.apiKey, timeout: 20_000, maxRetries: 0 }).models.list();
    }
    return { ok: true };
  } catch (e) {
    const status = (e as { status?: number }).status;
    return { ok: false, message: status === 401 ? "That key was rejected by the provider." : "Couldn't check the key with the provider." };
  }
}
