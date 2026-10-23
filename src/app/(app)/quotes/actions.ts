"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { UNITS } from "@/db/schema";
import { parsePounds } from "@/lib/money";
import { parseQuantityMilli } from "@/lib/quantity";
import { draftQuoteFromEnquiry } from "@/quote/pipeline";
import { requireTenant } from "@/server/session";

export async function createQuote(_prev: { error?: string } | undefined, form: FormData) {
  const { repo } = await requireTenant();
  const text = String(form.get("enquiry") ?? "");
  const result = await draftQuoteFromEnquiry(repo, text);
  if (!result.ok) return { error: result.error };
  redirect(`/quotes/${result.quoteId}`);
}

const Id = z.string().uuid();

const EditInput = z.object({
  customerId: z.string().uuid().nullable(),
  customerMessage: z.string().max(5000),
  lines: z
    .array(
      z.object({
        rateCode: z.string().max(20).nullable(),
        description: z.string().trim().min(1, "Every line needs a description").max(300),
        unit: z.enum(UNITS),
        quantity: z.string(),
        unitPrice: z.string(),
        source: z.enum(["ai", "human", "rule"]),
        working: z.string().max(1000).nullable(),
        assumption: z.string().max(1000).nullable(),
      }),
    )
    .max(60),
});

export async function saveQuote(quoteId: string, payload: unknown): Promise<{ ok: boolean; error?: string }> {
  if (!Id.safeParse(quoteId).success) return { ok: false, error: "Bad quote id" };
  const parsed = EditInput.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid edit" };
  const lines = [];
  for (const [i, l] of parsed.data.lines.entries()) {
    const quantityMilli = parseQuantityMilli(l.quantity);
    const unitPricePence = parsePounds(l.unitPrice);
    if (quantityMilli === null) return { ok: false, error: `Line ${i + 1}: quantity must be a number (up to 3 decimals)` };
    if (unitPricePence === null) return { ok: false, error: `Line ${i + 1}: price must be in pounds, e.g. 62 or 62.50` };
    lines.push({ ...l, quantityMilli, unitPricePence });
  }
  const { repo } = await requireTenant();
  const res = await repo.saveQuoteEdits(quoteId, { ...parsed.data, lines });
  if (!res.ok) return res;
  revalidatePath(`/quotes/${quoteId}`);
  return { ok: true };
}

export async function approveQuote(quoteId: string, _prev: unknown, form: FormData) {
  if (!Id.safeParse(quoteId).success) return { error: "Bad quote id" };
  if (form.get("checked") !== "yes") return { error: "Tick the box to confirm you've checked the quote." };
  const { repo } = await requireTenant();
  const ok = await repo.setQuoteStatus(quoteId, "approved");
  if (!ok) return { error: "This quote is no longer a draft." };
  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath("/");
  return { error: undefined };
}

export async function declineQuote(quoteId: string) {
  if (!Id.safeParse(quoteId).success) return;
  const { repo } = await requireTenant();
  await repo.setQuoteStatus(quoteId, "declined");
  revalidatePath(`/quotes/${quoteId}`);
  revalidatePath("/");
}
