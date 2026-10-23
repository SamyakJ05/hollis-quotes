/**
 * Paste an enquiry -> draft quote, saved as "draft". Nothing here can
 * approve or send anything.
 */
import { buildSystemPrompt, buildUserMessage } from "@/ai/prompt";
import { AiError, makeDraftCaller, type AiCredentials, type DraftCaller } from "@/ai/providers";
import { parseEnquiryHeaders } from "@/lib/enquiry";
import type { Repo } from "@/server/repo";
import { buildQuote } from "./build";

export const MAX_ENQUIRY_CHARS = 20_000;

export async function draftQuoteFromEnquiry(
  repo: Repo,
  rawText: string,
  makeCaller: (creds: AiCredentials) => DraftCaller = makeDraftCaller,
): Promise<{ ok: true; quoteId: string } | { ok: false; error: string }> {
  const text = rawText.trim();
  if (text.length < 20) return { ok: false, error: "Paste the whole enquiry, including the customer's message." };
  if (text.length > MAX_ENQUIRY_CHARS) return { ok: false, error: "That enquiry is too long. Paste just the customer's email." };

  const creds = await repo.aiCredentials();
  if (!creds) return { ok: false, error: "Add your company's AI API key in Settings first." };

  const ctx = await repo.pricingContext();
  const headers = parseEnquiryHeaders(text);
  const match = await repo.findCustomerByContact(headers.fromEmail, null);

  let result;
  try {
    result = await makeCaller(creds)(buildSystemPrompt({ ...ctx, siteVisitAreaM2: ctx.settings.siteVisitAreaM2 }), buildUserMessage(text));
  } catch (e) {
    console.error("AI draft failed", e instanceof AiError ? e.message : e);
    return { ok: false, error: e instanceof AiError ? e.userMessage : "Something went wrong drafting this quote." };
  }

  const built = buildQuote(result.draft, { enquiryText: text, rates: ctx.rates, settings: ctx.settings });
  const quoteId = await repo.createDraftQuote({
    rawText: text,
    fromEmail: headers.fromEmail,
    subject: headers.subject,
    customerId: match?.customer.id ?? null,
    built,
    aiOutput: result.raw,
    aiProvider: creds.provider,
    aiModel: result.model,
  });
  return { ok: true, quoteId };
}
