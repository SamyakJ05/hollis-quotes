/**
 * The ONLY way app code reads or writes tenant data.
 *
 * makeRepo(db, companyId) returns functions that are already bound to one
 * company. companyId comes from the logged-in user's database record
 * (src/server/session.ts), never from a URL, form field or the AI.
 * Every query below filters on companyId; asking for another company's
 * row by id simply returns nothing.
 */
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import type { DB } from "@/db";
import {
  auditEvents,
  companies,
  companySettings,
  customerContacts,
  customers,
  enquiries,
  quoteLines,
  quotes,
  rates,
  users,
} from "@/db/schema";
import { decryptSecret, encryptSecret, last4 } from "@/lib/crypto";
import { lineTotal } from "@/lib/money";
import type { BuiltQuote, PricingSettings, RateForPricing } from "@/quote/build";
import { computeTotals } from "@/quote/totals";
import type { Unit } from "@/db/schema";
import { normaliseEmail, normalisePhone } from "@/lib/contact";

export type Repo = ReturnType<typeof makeRepo>;

export function makeRepo(db: DB, companyId: string, userId: string | null = null) {
  const audit = (entity: string, entityId: string | null, action: string, detail?: unknown) =>
    db.insert(auditEvents).values({ companyId, userId, entity, entityId, action, detail: detail ?? null });

  const getCustomer = async (id: string) => {
    const [c] = await db
      .select()
      .from(customers)
      .where(and(eq(customers.companyId, companyId), eq(customers.id, id)));
    return c ?? null;
  };

  return {
    companyId,

    async company() {
      const [c] = await db.select().from(companies).where(eq(companies.id, companyId));
      return c;
    },

    /** Settings WITHOUT the encrypted key. Safe to pass to the UI. */
    async settings() {
      const [s] = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId));
      if (!s) throw new Error("Company settings missing");
      const { encryptedApiKey, ...safe } = s;
      return { ...safe, hasApiKey: Boolean(encryptedApiKey) };
    },

    async saveApiKey(provider: "anthropic" | "openai", apiKey: string, model: string | null) {
      await db
        .update(companySettings)
        .set({
          aiProvider: provider,
          aiModel: model,
          encryptedApiKey: encryptSecret(apiKey, companyId),
          apiKeyLast4: last4(apiKey),
          apiKeyUpdatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(companySettings.companyId, companyId));
      await audit("settings", null, "api_key_updated", { provider, last4: last4(apiKey) });
    },

    async removeApiKey() {
      await db
        .update(companySettings)
        .set({ encryptedApiKey: null, apiKeyLast4: null, apiKeyUpdatedAt: new Date(), updatedAt: new Date() })
        .where(eq(companySettings.companyId, companyId));
      await audit("settings", null, "api_key_removed");
    },

    /** Server-side only, at the moment of an AI call. Never returned to a client. */
    async aiCredentials() {
      const [s] = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId));
      if (!s?.encryptedApiKey) return null;
      return { provider: s.aiProvider, model: s.aiModel, apiKey: decryptSecret(s.encryptedApiKey, companyId) };
    },

    async listRates() {
      return db.select().from(rates).where(eq(rates.companyId, companyId)).orderBy(asc(rates.code));
    },

    async activeRates() {
      return db
        .select()
        .from(rates)
        .where(and(eq(rates.companyId, companyId), eq(rates.status, "active")))
        .orderBy(asc(rates.code));
    },

    async listCustomers() {
      const cs = await db
        .select()
        .from(customers)
        .where(eq(customers.companyId, companyId))
        .orderBy(asc(customers.displayName));
      const contacts = cs.length
        ? await db
            .select()
            .from(customerContacts)
            .where(and(eq(customerContacts.companyId, companyId), inArray(customerContacts.customerId, cs.map((c) => c.id))))
        : [];
      return cs.map((c) => ({ ...c, contacts: contacts.filter((ct) => ct.customerId === c.id) }));
    },

    getCustomer,

    /** Deterministic match on exact email or phone. Fuzzy suggestions are a human decision. */
    async findCustomerByContact(email: string | null, phone: string | null) {
      const e = email ? normaliseEmail(email) : null;
      const p = phone ? normalisePhone(phone) : null;
      const conds = [e ? eq(customerContacts.email, e) : undefined, p ? eq(customerContacts.phone, p) : undefined].filter(
        Boolean,
      );
      if (!conds.length) return null;
      const [hit] = await db
        .select({ customerId: customerContacts.customerId, email: customerContacts.email, phone: customerContacts.phone })
        .from(customerContacts)
        .where(and(eq(customerContacts.companyId, companyId), or(...conds)))
        .limit(1);
      if (!hit) return null;
      const customer = await getCustomer(hit.customerId);
      return customer ? { customer, matchedOn: e && hit.email === e ? ("email" as const) : ("phone" as const) } : null;
    },

    /** Possible matches for a person to confirm: same surname, or same (non-webmail) email domain. */
    async suggestCustomers(fromName: string | null, fromEmail: string | null) {
      const all = await db.select().from(customers).where(eq(customers.companyId, companyId));
      const contacts = await db.select().from(customerContacts).where(eq(customerContacts.companyId, companyId));
      const surname = fromName?.trim().split(/\s+/).pop()?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
      const domain = fromEmail?.split("@")[1]?.toLowerCase() ?? "";
      const webmail = /^(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|aol|btinternet|sky|example)\./;
      return all.filter((c) => {
        if (surname.length > 2 && `${c.displayName} ${c.companyName ?? ""}`.toLowerCase().includes(surname)) return true;
        if (domain && !webmail.test(domain)) {
          return contacts.some((ct) => ct.customerId === c.id && ct.email?.endsWith(`@${domain}`));
        }
        return false;
      });
    },

    async getEnquiry(id: string) {
      const [e] = await db.select().from(enquiries).where(and(eq(enquiries.companyId, companyId), eq(enquiries.id, id)));
      return e ?? null;
    },

    async listQuotes() {
      return db.select().from(quotes).where(eq(quotes.companyId, companyId)).orderBy(desc(quotes.createdAt));
    },

    async getQuote(id: string) {
      const [q] = await db.select().from(quotes).where(and(eq(quotes.companyId, companyId), eq(quotes.id, id)));
      if (!q) return null;
      const lines = await db
        .select()
        .from(quoteLines)
        .where(and(eq(quoteLines.companyId, companyId), eq(quoteLines.quoteId, id)))
        .orderBy(asc(quoteLines.position));
      return { ...q, lines };
    },

    /** Everything the AI prompt and the pricing engine need, for this company only. */
    async pricingContext() {
      const [c] = await db.select().from(companies).where(eq(companies.id, companyId));
      const [s] = await db.select().from(companySettings).where(eq(companySettings.companyId, companyId));
      const all = await db.select().from(rates).where(eq(rates.companyId, companyId)).orderBy(asc(rates.code));
      const settings: PricingSettings = {
        minimumChargePence: s.minimumChargePence,
        vatRateBps: s.vatRateBps,
        siteVisitAreaM2: s.siteVisitAreaM2,
        siteVisitKeywords: s.siteVisitKeywords,
      };
      const pricingRates: RateForPricing[] = all.map((r) => ({
        code: r.code,
        description: r.description,
        unit: r.unit,
        ratePence: r.ratePence,
        status: r.status,
        addons: r.addons,
        caveats: r.caveats,
        reviewFlag: r.reviewFlag,
        importNotes: r.importNotes,
      }));
      return { companyName: c.name, tradingArea: c.tradingArea, estimatingNotes: s.estimatingNotes, settings, rates: pricingRates };
    },

    async createDraftQuote(input: {
      rawText: string;
      fromEmail: string | null;
      subject: string | null;
      customerId: string | null;
      built: BuiltQuote;
      aiOutput: unknown;
      aiProvider: string;
      aiModel: string;
    }) {
      return db.transaction(async (tx) => {
        const [enq] = await tx
          .insert(enquiries)
          .values({ companyId, rawText: input.rawText, fromEmail: input.fromEmail, subject: input.subject, createdBy: userId })
          .returning();
        const b = input.built;
        const [q] = await tx
          .insert(quotes)
          .values({
            companyId,
            enquiryId: enq.id,
            customerId: input.customerId,
            status: "draft",
            outcome: b.outcome,
            jobSummary: b.jobSummary,
            aiOutput: input.aiOutput,
            aiProvider: input.aiProvider,
            aiModel: input.aiModel,
            flags: b.flags,
            details: b.details,
            customerMessage: b.customerMessage,
            ...b.totals,
          })
          .returning();
        if (b.lines.length) {
          await tx.insert(quoteLines).values(b.lines.map((l) => ({ ...l, companyId, quoteId: q.id })));
        }
        await tx.insert(auditEvents).values({
          companyId,
          userId,
          entity: "quote",
          entityId: q.id,
          action: "ai_draft_created",
          detail: { outcome: b.outcome, totalPence: b.totals.totalPence, flags: b.flags.length, model: input.aiModel },
        });
        return q.id;
      });
    },

    /**
     * A person's edits. Only drafts can change. Totals are recomputed here from
     * the submitted lines, so the minimum charge and VAT always hold.
     */
    async saveQuoteEdits(
      quoteId: string,
      edit: {
        customerId: string | null;
        customerMessage: string;
        lines: { rateCode: string | null; description: string; unit: Unit; quantityMilli: number; unitPricePence: number; source: "ai" | "human" | "rule"; working: string | null; assumption: string | null }[];
      },
    ) {
      return db.transaction(async (tx) => {
        const [q] = await tx
          .select()
          .from(quotes)
          .where(and(eq(quotes.companyId, companyId), eq(quotes.id, quoteId)));
        if (!q) return { ok: false as const, error: "Quote not found" };
        if (q.status !== "draft") return { ok: false as const, error: "Only drafts can be edited" };
        if (edit.customerId) {
          const [c] = await tx
            .select({ id: customers.id })
            .from(customers)
            .where(and(eq(customers.companyId, companyId), eq(customers.id, edit.customerId)));
          if (!c) return { ok: false as const, error: "Unknown customer" };
        }
        const [s] = await tx.select().from(companySettings).where(eq(companySettings.companyId, companyId));
        const lines = edit.lines.map((l, i) => ({ ...l, position: i, lineTotalPence: lineTotal(l.quantityMilli, l.unitPricePence) }));
        const priced = q.outcome === "priced" || lines.length > 0;
        const totals = computeTotals(lines.map((l) => l.lineTotalPence), {
          minimumChargePence: s.minimumChargePence,
          vatRateBps: s.vatRateBps,
          priced,
        });
        await tx.delete(quoteLines).where(and(eq(quoteLines.companyId, companyId), eq(quoteLines.quoteId, quoteId)));
        if (lines.length) await tx.insert(quoteLines).values(lines.map((l) => ({ ...l, companyId, quoteId })));
        await tx
          .update(quotes)
          .set({
            ...totals,
            outcome: priced ? "priced" : q.outcome,
            customerId: edit.customerId,
            customerMessage: edit.customerMessage,
            updatedAt: new Date(),
          })
          .where(and(eq(quotes.companyId, companyId), eq(quotes.id, quoteId)));
        await tx.insert(auditEvents).values({
          companyId,
          userId,
          entity: "quote",
          entityId: quoteId,
          action: "edited",
          detail: { before: { totalPence: q.totalPence }, after: { totalPence: totals.totalPence, lines: lines.length } },
        });
        return { ok: true as const };
      });
    },

    /** The only way a quote leaves draft. Needs a signed-in person. */
    async setQuoteStatus(quoteId: string, status: "approved" | "declined") {
      if (!userId) throw new Error("A person must approve quotes");
      const updated = await db
        .update(quotes)
        .set({
          status,
          approvedBy: status === "approved" ? userId : null,
          approvedAt: status === "approved" ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(and(eq(quotes.companyId, companyId), eq(quotes.id, quoteId), eq(quotes.status, "draft")))
        .returning({ id: quotes.id, totalPence: quotes.totalPence });
      if (!updated.length) return false;
      await audit("quote", quoteId, status, { totalPence: updated[0].totalPence });
      return true;
    },

    async userNames() {
      const rows = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.companyId, companyId));
      return new Map(rows.map((r) => [r.id, r.name]));
    },

    async auditTrail(entityId: string) {
      return db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.companyId, companyId), eq(auditEvents.entityId, entityId)))
        .orderBy(asc(auditEvents.createdAt));
    },

    audit,
  };
}
