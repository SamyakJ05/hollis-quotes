/**
 * Provider calls against MOCKED SDKs: no network, no real keys. This is how the
 * OpenAI path is verified (it has not been run against a live OpenAI key);
 * Anthropic was also live-tested with the three enquiries.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  openaiCreate: vi.fn(),
  openaiList: vi.fn(),
  openaiCtor: vi.fn(),
  anthropicCreate: vi.fn(),
  anthropicList: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: h.openaiCreate } };
    models = { list: h.openaiList };
    constructor(opts: unknown) {
      h.openaiCtor(opts);
    }
  },
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: h.anthropicCreate };
    models = { list: h.anthropicList };
  },
}));

import { AiError, makeDraftCaller, strictSchema, verifyKey, type AiCredentials } from "@/ai/providers";
import { DEFAULT_MODELS, checkKeyFormat } from "@/ai/provider-info";
import { draftJsonSchema } from "@/ai/draft-schema";
import { buildSystemPrompt, buildUserMessage } from "@/ai/prompt";
import { parseCsv } from "@/import/csv";
import { normaliseRates } from "@/import/rates";
import { HOLLIS_RATE_DECISIONS } from "@/import/hollis-decisions";
import { buildQuote } from "@/quote/build";
import { kestrelCompromisedDraft, kestrelDraft, okaforDraft } from "./fixtures/drafts";

const OPENAI_KEY = "sk-test-not-a-real-key-000000000000";
const ANTHROPIC_KEY = "sk-ant-test-not-a-real-key-0000000000";
const openai: AiCredentials = { provider: "openai", apiKey: OPENAI_KEY, model: null };
const anthropic: AiCredentials = { provider: "anthropic", apiKey: ANTHROPIC_KEY, model: null };

const rates = normaliseRates(parseCsv(readFileSync("data/hollis-rates.csv", "utf8")), { vatBps: 2000, decisions: HOLLIS_RATE_DECISIONS }).rates;
const settings = { minimumChargePence: 45000, vatRateBps: 2000, siteVisitAreaM2: 150, siteVisitKeywords: ["car park"] };
const system = buildSystemPrompt({ companyName: "Hollis Groundworks", tradingArea: "Walsall", siteVisitAreaM2: 150, estimatingNotes: null, rates });
const user = buildUserMessage("From: a@b.com\n\nPlease quote a patio, about 18 sq m.");

const chat = (content: string | null, over: { refusal?: string | null; finish?: string; tool?: string } = {}) => ({
  choices: [
    {
      finish_reason: over.finish ?? "stop",
      message: {
        content,
        refusal: over.refusal ?? null,
        tool_calls: over.tool ? [{ id: "call_1", type: "function", function: { name: "submit_draft", arguments: over.tool } }] : undefined,
      },
    },
  ],
});
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const reply = (draft: unknown) => chat(JSON.stringify(draft));
const anthropicText = (draft: unknown) => ({ content: [{ type: "text", text: JSON.stringify(draft) }] });

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
});

describe("OpenAI request", () => {
  it("asks for strict structured output against a schema with no price, discount, status or terms fields", async () => {
    h.openaiCreate.mockResolvedValueOnce(reply(okaforDraft));
    await makeDraftCaller(openai)(system, user);

    const params = h.openaiCreate.mock.calls[0][0];
    expect(params.model).toBe(DEFAULT_MODELS.openai);
    expect(params.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "submit_draft", strict: true } });
    expect(params.messages).toEqual([
      { role: "system", content: system },
      { role: "user", content: user },
    ]);
    for (const banned of ["temperature", "max_tokens", "max_completion_tokens", "tools", "tool_choice"]) expect(params).not.toHaveProperty(banned);
    expect(h.openaiCtor).toHaveBeenCalledWith(expect.objectContaining({ apiKey: OPENAI_KEY, timeout: 120_000, maxRetries: 1 }));

    const schema = params.response_format.json_schema.schema;
    const objects: Record<string, unknown>[] = [];
    const propertyNames: string[] = [];
    const keywords = new Set<string>();
    (function walk(node: unknown) {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      const n = node as Record<string, unknown>;
      Object.keys(n).forEach((k) => keywords.add(k));
      if (n.properties) {
        objects.push(n);
        propertyNames.push(...Object.keys(n.properties as object));
      }
      Object.values(n).forEach(walk);
    })(schema);

    expect(schema.type).toBe("object");
    expect(objects.length).toBeGreaterThan(3);
    for (const o of objects) {
      expect(o.additionalProperties).toBe(false);
      expect([...(o.required as string[])].sort()).toEqual(Object.keys(o.properties as object).sort());
    }
    // keywords OpenAI strict mode doesn't accept are stripped before sending
    for (const k of ["minimum", "maximum", "exclusiveMinimum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format", "$schema"]) {
      expect(keywords.has(k)).toBe(false);
    }
    // nullable fields are anyOf [x, null], which strict mode accepts
    expect(JSON.stringify(schema)).toContain('"type":"null"');
    // the model has nowhere to put a price, discount, status or terms
    expect(propertyNames.filter((p) => /price|discount|status|terms|total|payment|£/i.test(p))).toEqual([]);
    expect(system).not.toContain("£");
  });

  it("leaves the schema Anthropic gets valid for strict mode too", () => {
    const sent = strictSchema(draftJsonSchema()) as Record<string, unknown>;
    expect(JSON.stringify(sent)).not.toContain("minLength");
    expect(sent.additionalProperties).toBe(false);
  });
});

describe("OpenAI answers", () => {
  it("returns a valid draft after one call", async () => {
    h.openaiCreate.mockResolvedValueOnce(reply(okaforDraft));
    const r = await makeDraftCaller(openai)(system, user);
    expect(r.draft).toEqual(okaforDraft);
    expect(r.model).toBe(DEFAULT_MODELS.openai);
    expect(h.openaiCreate).toHaveBeenCalledTimes(1);
  });

  it("uses the company's model when it chose one", async () => {
    h.openaiCreate.mockResolvedValueOnce(reply(okaforDraft));
    const r = await makeDraftCaller({ ...openai, model: "gpt-5.5" })(system, user);
    expect(h.openaiCreate.mock.calls[0][0].model).toBe("gpt-5.5");
    expect(r.model).toBe("gpt-5.5");
  });

  it("retries exactly once on an invalid answer, telling the model what was wrong", async () => {
    const bad = JSON.stringify({ job_summary: 42 });
    h.openaiCreate.mockResolvedValueOnce(chat(bad)).mockResolvedValueOnce(reply(okaforDraft));
    const r = await makeDraftCaller(openai)(system, user);
    expect(r.draft).toEqual(okaforDraft);
    expect(h.openaiCreate).toHaveBeenCalledTimes(2);
    const followUp = h.openaiCreate.mock.calls[1][0].messages;
    expect(followUp.slice(-2)).toEqual([
      { role: "assistant", content: bad },
      { role: "user", content: expect.stringContaining("job_summary") },
    ]);
    expect(followUp.at(-1).content).toMatch(/didn't match the required format/);
  });

  it("retries once when the answer isn't JSON at all", async () => {
    h.openaiCreate.mockResolvedValueOnce(chat("Sure! Here is your quote")).mockResolvedValueOnce(reply(okaforDraft));
    await makeDraftCaller(openai)(system, user);
    expect(h.openaiCreate).toHaveBeenCalledTimes(2);
  });

  it("gives up loudly after two invalid answers", async () => {
    h.openaiCreate.mockResolvedValue(chat(JSON.stringify({ nope: true })));
    const err = await makeDraftCaller(openai)(system, user).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.userMessage).toBe("The AI's answer didn't fit the expected shape. Try again.");
    expect(h.openaiCreate).toHaveBeenCalledTimes(2);
  });

  it("maps a refusal", async () => {
    h.openaiCreate.mockResolvedValueOnce(chat(null, { refusal: "I can't help with that." }));
    const err = await makeDraftCaller(openai)(system, user).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.userMessage).toBe("The AI declined to draft this quote.");
    expect(h.openaiCreate).toHaveBeenCalledTimes(1);
  });

  it("maps a cut-off answer", async () => {
    h.openaiCreate.mockResolvedValueOnce(chat('{"job_summary":"Block pav', { finish: "length" }));
    const err = await makeDraftCaller(openai)(system, user).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.userMessage).toBe("The AI's answer was cut off. Try again.");
  });

  it.each([
    [401, "The API key was rejected. Check it in Settings."],
    [403, "The API key was rejected. Check it in Settings."],
    [404, "That model isn't available on this API key. Check the model in Settings."],
    [429, "The AI provider is rate-limiting this key. Wait a minute and try again."],
    [500, "The AI provider didn't respond properly. Try again in a moment."],
  ])("maps HTTP %i, without the key ever appearing in the error text", async (status, userMessage) => {
    h.openaiCreate.mockRejectedValueOnce(httpError(status, `Incorrect API key provided: ${OPENAI_KEY}. Also sk-proj-****abcd and ${OPENAI_KEY.slice(0, 12)}`));
    const err = await makeDraftCaller(openai)(system, user).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.userMessage).toBe(userMessage);
    expect(err.message).not.toContain(OPENAI_KEY);
    expect(err.message).not.toMatch(/sk-(test|proj)/);
  });
});

describe("OpenAI fallback to a forced function call", () => {
  it("is used when the model rejects response_format, and still returns a draft", async () => {
    h.openaiCreate
      .mockRejectedValueOnce(httpError(400, "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model."))
      .mockResolvedValueOnce(chat(null, { tool: JSON.stringify(okaforDraft) }));
    const r = await makeDraftCaller(openai)(system, user);
    expect(r.draft).toEqual(okaforDraft);
    expect(h.openaiCreate).toHaveBeenCalledTimes(2);
    const [first, second] = h.openaiCreate.mock.calls.map((c) => c[0]);
    expect(first).toHaveProperty("response_format");
    expect(second).not.toHaveProperty("response_format");
    expect(second.tool_choice).toEqual({ type: "function", function: { name: "submit_draft" } });
    expect(second.tools[0].function.name).toBe("submit_draft");
  });

  it("stays on the function call for the validation retry", async () => {
    h.openaiCreate
      .mockRejectedValueOnce(httpError(400, "This model does not support structured outputs"))
      .mockResolvedValueOnce(chat(null, { tool: JSON.stringify({ job_summary: 1 }) }))
      .mockResolvedValueOnce(chat(null, { tool: JSON.stringify(okaforDraft) }));
    const r = await makeDraftCaller(openai)(system, user);
    expect(r.draft).toEqual(okaforDraft);
    expect(h.openaiCreate.mock.calls[2][0]).toHaveProperty("tools");
    expect(h.openaiCreate.mock.calls[2][0]).not.toHaveProperty("response_format");
  });

  it("is not used for an unrelated 400", async () => {
    h.openaiCreate.mockRejectedValueOnce(httpError(400, "Your request was malformed in some other way"));
    const err = await makeDraftCaller(openai)(system, user).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(h.openaiCreate).toHaveBeenCalledTimes(1);
  });
});

describe("Anthropic is unchanged", () => {
  it("uses output_config.format with the strict schema", async () => {
    h.anthropicCreate.mockResolvedValueOnce(anthropicText(okaforDraft));
    const r = await makeDraftCaller(anthropic)(system, user);
    expect(r.draft).toEqual(okaforDraft);
    const params = h.anthropicCreate.mock.calls[0][0];
    expect(params.model).toBe(DEFAULT_MODELS.anthropic);
    expect(params.output_config.format).toMatchObject({ type: "json_schema" });
    expect(params.output_config.format.schema.additionalProperties).toBe(false);
    expect(params).not.toHaveProperty("tools");
  });

  it("falls back to the forced tool call on a 400 about output_config", async () => {
    h.anthropicCreate
      .mockRejectedValueOnce(httpError(400, "output_config.format is not supported for this model"))
      .mockResolvedValueOnce({ content: [{ type: "tool_use", id: "tu_1", name: "submit_draft", input: okaforDraft }] });
    const r = await makeDraftCaller(anthropic)(system, user);
    expect(r.draft).toEqual(okaforDraft);
    const second = h.anthropicCreate.mock.calls[1][0];
    expect(second.tool_choice).toEqual({ type: "tool", name: "submit_draft" });
    expect(second).not.toHaveProperty("output_config");
  });

  it("retries once on an invalid answer", async () => {
    h.anthropicCreate.mockResolvedValueOnce(anthropicText({ job_summary: 1 })).mockResolvedValueOnce(anthropicText(okaforDraft));
    await makeDraftCaller(anthropic)(system, user);
    expect(h.anthropicCreate).toHaveBeenCalledTimes(2);
  });

  it("keeps the key out of error text", async () => {
    h.anthropicCreate.mockRejectedValueOnce(httpError(401, `invalid x-api-key ${ANTHROPIC_KEY}`));
    const err = await makeDraftCaller(anthropic)(system, user).catch((e) => e);
    expect(err.userMessage).toBe("The API key was rejected. Check it in Settings.");
    expect(err.message).not.toContain(ANTHROPIC_KEY);
  });
});

describe("the guards hold whichever provider answered", () => {
  it("prices Kestrel Row identically and flags the injection, even when the model obeyed it", async () => {
    const enquiry = readFileSync("tests/fixtures/3-kestrel-row-patio.txt", "utf8");
    h.anthropicCreate.mockResolvedValueOnce(anthropicText(kestrelDraft));
    h.openaiCreate.mockResolvedValueOnce(reply(kestrelCompromisedDraft));
    const fromAnthropic = (await makeDraftCaller(anthropic)(system, user)).draft;
    const fromOpenAI = (await makeDraftCaller(openai)(system, user)).draft;

    const a = buildQuote(fromAnthropic, { enquiryText: enquiry, rates, settings });
    const o = buildQuote(fromOpenAI, { enquiryText: enquiry, rates, settings });
    expect(o.totals).toEqual(a.totals);
    expect(o.lines.map((l) => l.rateCode)).toEqual(a.lines.map((l) => l.rateCode));
    for (const q of [a, o]) {
      expect(q.outcome).toBe("priced");
      expect(q.flags.some((f) => f.level === "danger" && f.message.includes("40% partner discount"))).toBe(true);
      expect(q).not.toHaveProperty("status");
    }
  });
});

describe("saving a key", () => {
  it.each([
    ["anthropic", "sk-ant-api03-abcdefghijklmnopqrstuv", null],
    ["openai", "sk-proj-abcdefghijklmnopqrstuvwxyz", null],
    ["openai", OPENAI_KEY, null],
    ["openai", "sk-ant-api03-abcdefghijklmnopqrstuv", "That looks like an Anthropic key. Switch the provider to Anthropic."],
    ["anthropic", "sk-proj-abcdefghijklmnopqrstuvwxyz", "That looks like an OpenAI key. Switch the provider to OpenAI."],
    ["anthropic", "not-a-key-at-all-not-a-key-at-all", "Anthropic keys start with sk-ant-."],
    ["openai", "not-a-key-at-all-not-a-key-at-all", "OpenAI keys start with sk-."],
  ] as const)("format check: %s %s", (provider, key, expected) => {
    expect(checkKeyFormat(provider, key)).toBe(expected);
  });

  it("verifyKey gives a provider-specific message when the provider rejects the key", async () => {
    h.openaiList.mockRejectedValueOnce(httpError(401, "Incorrect API key"));
    h.anthropicList.mockRejectedValueOnce(httpError(401, "invalid x-api-key"));
    expect(await verifyKey(openai)).toEqual({ ok: false, message: "OpenAI rejected that key." });
    expect(await verifyKey(anthropic)).toEqual({ ok: false, message: "Anthropic rejected that key." });
  });

  it("verifyKey doesn't blame the key for a network problem", async () => {
    h.openaiList.mockRejectedValueOnce(new Error("socket hang up"));
    const r = await verifyKey(openai);
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("Couldn't check the key with OpenAI") });
  });

  it("verifyKey accepts a key the provider accepts", async () => {
    h.openaiList.mockResolvedValueOnce({ data: [] });
    expect(await verifyKey(openai)).toEqual({ ok: true });
  });
});
