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
} from "@/db/schema";
import { decryptSecret, encryptSecret, last4 } from "@/lib/crypto";
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

    audit,
  };
}
