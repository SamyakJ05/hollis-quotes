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

// Sanity limits on a person's edits: stops typos (an extra zero) and keeps values inside the integer columns.
const MAX_EDIT_QUANTITY_MILLI = 1_000_000_000;
const MAX_EDIT_PRICE_PENCE = 100_000_000;
const MAX_EDIT_LINE_TOTAL_PENCE = 100_000_000;

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
     * the submitted lines, so the minimum charge and VAT always hold. The client
     * doesn't get to say who wrote a line: a line that matches one already
     * stored keeps its source, anything else is "human".
     */
    async saveQuoteEdits(
      quoteId: string,
      edit: {
        customerId: string | null;
        customerMessage: string;
        /** The version (updatedAt, ms) the person was looking at. A save against any other version is refused. */
        seenUpdatedAtMs: number;
        /** Must be true to add prices to a quote that is not "priced" (site visit / cannot quote). */
        acknowledgeOutcomeChange?: boolean;
        lines: { rateCode: string | null; description: string; unit: Unit; quantityMilli: number; unitPricePence: number; working: string | null; assumption: string | null }[];
      },
    ): Promise<{ ok: true } | { ok: false; error: string; code?: "outcome_change" | "changed" }> {
      return db.transaction(async (tx) => {
        const [q] = await tx
          .select()
          .from(quotes)
          .where(and(eq(quotes.companyId, companyId), eq(quotes.id, quoteId)));
        if (!q) return { ok: false as const, error: "Quote not found" };
        if (q.status !== "draft") return { ok: false as const, error: "Only drafts can be edited" };
        if (q.updatedAt.getTime() !== edit.seenUpdatedAtMs) {
          return {
            ok: false as const,
            code: "changed" as const,
            error: "This quote was changed by someone else after you opened it. Your edits weren't saved. Reload to see the latest version.",
          };
        }
        if (edit.customerId) {
          const [c] = await tx
            .select({ id: customers.id })
            .from(customers)
            .where(and(eq(customers.companyId, companyId), eq(customers.id, edit.customerId)));
          if (!c) return { ok: false as const, error: "Unknown customer" };
        }
        const [s] = await tx.select().from(companySettings).where(eq(companySettings.companyId, companyId));
        const stored = await tx
          .select()
          .from(quoteLines)
          .where(and(eq(quoteLines.companyId, companyId), eq(quoteLines.quoteId, quoteId)));
        const knownCodes = new Set(
          (await tx.select({ code: rates.code }).from(rates).where(eq(rates.companyId, companyId))).map((r) => r.code),
        );

        const sig = (l: { rateCode: string | null; description: string; unit: string; quantityMilli: number; unitPricePence: number }) =>
          `${l.rateCode ?? ""}|${l.description}|${l.unit}|${l.quantityMilli}|${l.unitPricePence}`;
        const pool = [...stored];
        const lines = [];
        for (const [i, l] of edit.lines.entries()) {
          const at = pool.findIndex((e) => sig(e) === sig(l));
          const prior = at >= 0 ? pool.splice(at, 1)[0] : null;
          if (!prior && l.rateCode && !knownCodes.has(l.rateCode)) {
            return { ok: false as const, error: `Line ${i + 1}: ${l.rateCode} isn't on your price list` };
          }
          const total = lineTotal(l.quantityMilli, l.unitPricePence);
          if (l.quantityMilli > MAX_EDIT_QUANTITY_MILLI || l.unitPricePence > MAX_EDIT_PRICE_PENCE || total > MAX_EDIT_LINE_TOTAL_PENCE) {
            return { ok: false as const, error: `Line ${i + 1}: that quantity or price looks wrong (a line can't be over £1,000,000)` };
          }
          lines.push({
            rateCode: l.rateCode,
            description: l.description,
            unit: l.unit,
            quantityMilli: l.quantityMilli,
            unitPricePence: l.unitPricePence,
            source: prior ? prior.source : ("human" as const),
            working: prior ? prior.working : l.working,
            assumption: prior ? prior.assumption : l.assumption,
            position: i,
            lineTotalPence: total,
          });
        }

        // Rules said "no price" (site visit / cannot quote). A person may override, knowingly.
        const overrides = q.outcome !== "priced" && lines.length > 0;
        if (overrides && !edit.acknowledgeOutcomeChange) {
          return {
            ok: false as const,
            code: "outcome_change" as const,
            error: `This quote was marked "${q.outcome.replace("_", " ")}", so no price was produced. Adding prices overrides that. Confirm to continue.`,
          };
        }
        const priced = q.outcome === "priced" || lines.length > 0;
        const totals = computeTotals(lines.map((l) => l.lineTotalPence), {
          minimumChargePence: s.minimumChargePence,
          vatRateBps: s.vatRateBps,
          priced,
        });
        // The "no price, by design" notes stop being true once a person adds prices.
        // Rows from before flags had codes are recognised by their text.
        const staleNote = (f: { code?: string; message: string }) =>
          f.code === "no_price_by_design" ||
          f.message.startsWith("Needs a site visit. No price has been produced") ||
          f.message.startsWith("Nothing on the price list could be used for this job");
        const flags = overrides
          ? [
              ...q.flags.filter((f) => !staleNote(f)),
              { level: "warn" as const, message: `A person added prices to a quote the rules had marked "${q.outcome.replace("_", " ")}".` },
            ]
          : q.flags;
        await tx.delete(quoteLines).where(and(eq(quoteLines.companyId, companyId), eq(quoteLines.quoteId, quoteId)));
        if (lines.length) await tx.insert(quoteLines).values(lines.map((l) => ({ ...l, companyId, quoteId })));
        await tx
          .update(quotes)
          .set({
            ...totals,
            outcome: priced ? "priced" : q.outcome,
            flags,
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
          detail: {
            before: { totalPence: q.totalPence },
            after: { totalPence: totals.totalPence, lines: lines.length },
            ...(overrides ? { outcomeChange: { from: q.outcome, to: "priced" } } : {}),
          },
        });
        return { ok: true as const };
      });
    },

    /**
     * The only way a quote leaves draft. Needs a signed-in person. Approving
     * also needs the version the reviewer was looking at (`seenUpdatedAtMs`),
     * so someone else's edit in the meantime can't be approved unseen, and an
     * acknowledgement when the quote carries security warnings.
     */
    async setQuoteStatus(
      quoteId: string,
      status: "approved" | "declined",
      opts: { seenUpdatedAtMs?: number; acknowledgedWarnings?: boolean } = {},
    ): Promise<{ ok: true } | { ok: false; reason: "not_draft" | "changed" | "warnings_unacknowledged" }> {
      if (!userId) throw new Error("A person must approve quotes");
      if (status === "approved" && opts.seenUpdatedAtMs === undefined) {
        throw new Error("Approving needs the version that was reviewed");
      }
      return db.transaction(async (tx) => {
        const [q] = await tx
          .select()
          .from(quotes)
          .where(and(eq(quotes.companyId, companyId), eq(quotes.id, quoteId)))
          .for("update");
        if (!q || q.status !== "draft") return { ok: false as const, reason: "not_draft" as const };
        const warned = q.flags.some((f) => f.level === "danger");
        if (status === "approved") {
          if (q.updatedAt.getTime() !== opts.seenUpdatedAtMs) return { ok: false as const, reason: "changed" as const };
          if (warned && !opts.acknowledgedWarnings) return { ok: false as const, reason: "warnings_unacknowledged" as const };
        }
        await tx
          .update(quotes)
          .set({
            status,
            approvedBy: status === "approved" ? userId : null,
            approvedAt: status === "approved" ? new Date() : null,
            updatedAt: new Date(),
          })
          .where(and(eq(quotes.companyId, companyId), eq(quotes.id, quoteId)));
        await tx.insert(auditEvents).values({
          companyId,
          userId,
          entity: "quote",
          entityId: quoteId,
          action: status,
          detail: { totalPence: q.totalPence, ...(status === "approved" && warned ? { securityWarningsAcknowledged: true } : {}) },
        });
        return { ok: true as const };
      });
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
