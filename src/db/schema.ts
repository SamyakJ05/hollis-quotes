/**
 * Database schema.
 *
 * Tenancy model: every tenant-owned table carries `company_id`. Cross-table
 * references between tenant rows use COMPOSITE foreign keys (id, company_id),
 * so the database itself refuses e.g. a quote in company A that points at a
 * customer in company B. The app layer also scopes every query by the
 * session's company (see src/server/tenant.ts) — this is the second wall.
 *
 * Money is stored as integer pence. Quantities are stored as integer
 * thousandths ("milli-units") so 27.871 m2 is exact. No floats near money.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const companyId = () => uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" });

export const UNITS = ["m2", "m3", "lin_m", "each", "load", "tonne", "day", "job"] as const;
export type Unit = (typeof UNITS)[number];

/**
 * active       – the AI may pick it, the pricing engine will price it
 * superseded   – an older duplicate of another code; kept for history only
 * included     – not charged separately (e.g. kiln-dried sand inside block paving)
 * needs_review – no usable price yet (TBC, or the unit/price is in doubt)
 * not_offered  – a service the company does not do (e.g. dropped kerbs)
 * system       – applied by the pricing engine, never chosen as a line (minimum charge)
 */
export const RATE_STATUSES = ["active", "superseded", "included", "needs_review", "not_offered", "system"] as const;
export type RateStatus = (typeof RATE_STATUSES)[number];

export const companies = pgTable("companies", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  tradingArea: text("trading_area"),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    companyId: companyId(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["owner", "staff"] }).notNull().default("staff"),
    createdAt: createdAt(),
  },
  (t) => [index("users_company_idx").on(t.companyId)],
);

export const companySettings = pgTable("company_settings", {
  companyId: uuid("company_id")
    .primaryKey()
    .references(() => companies.id, { onDelete: "cascade" }),
  aiProvider: text("ai_provider", { enum: ["anthropic", "openai"] }).notNull().default("anthropic"),
  aiModel: text("ai_model"),
  /** AES-256-GCM ciphertext, bound to company_id as AAD. Never sent to the browser. */
  encryptedApiKey: text("encrypted_api_key"),
  apiKeyLast4: text("api_key_last4"),
  apiKeyUpdatedAt: timestamp("api_key_updated_at", { withTimezone: true }),
  vatRateBps: integer("vat_rate_bps").notNull().default(2000), // 20.00%
  minimumChargePence: integer("minimum_charge_pence").notNull().default(0),
  /** Jobs above this area (m2) always go to a site visit, never an emailed price. */
  siteVisitAreaM2: integer("site_visit_area_m2").notNull().default(150),
  quoteValidityDays: integer("quote_validity_days").notNull().default(30),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RateAddon = { label: string; amountPence: number; per: "unit" | "item" };

export const rates = pgTable(
  "rates",
  {
    id: id(),
    companyId: companyId(),
    code: text("code").notNull(),
    description: text("description").notNull(),
    unit: text("unit", { enum: UNITS }).notNull(),
    /** Ex-VAT price in pence. Null when there is no usable price. */
    ratePence: integer("rate_pence"),
    status: text("status", { enum: RATE_STATUSES }).notNull(),
    supersededBy: text("superseded_by"),
    /** Price-affecting options parsed out of free-text notes (herringbone +£4/m2, road permit +£60). */
    addons: jsonb("addons").$type<RateAddon[]>().notNull().default([]),
    /** Conditions the reviewer and customer must see (subject to perc test, base must be sound). */
    caveats: jsonb("caveats").$type<string[]>().notNull().default([]),
    /** Usable, but someone should check it (e.g. converted from an inc-VAT price). */
    reviewFlag: text("review_flag"),
    priceEnteredIncVat: boolean("price_entered_inc_vat").notNull().default(false),
    /** Exactly what was in the spreadsheet, for audit. */
    original: jsonb("original").$type<Record<string, string>>().notNull(),
    importNotes: jsonb("import_notes").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [unique("rates_company_code_uq").on(t.companyId, t.code)],
);

export const customers = pgTable(
  "customers",
  {
    id: id(),
    companyId: companyId(),
    displayName: text("display_name").notNull(),
    companyName: text("company_name"),
    address: text("address"),
    postcode: text("postcode"),
    /** Internal only. Never shown on a quote or sent to the AI. */
    internalNotes: text("internal_notes"),
    paymentTerms: text("payment_terms"),
    billingEmail: text("billing_email"),
    importNotes: jsonb("import_notes").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (t) => [unique("customers_id_company_uq").on(t.id, t.companyId), index("customers_company_idx").on(t.companyId)],
);

export const customerContacts = pgTable(
  "customer_contacts",
  {
    id: id(),
    companyId: companyId(),
    customerId: uuid("customer_id").notNull(),
    name: text("name"),
    email: text("email"),
    phone: text("phone"),
    role: text("role", { enum: ["primary", "billing", "other"] }).notNull().default("primary"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      columns: [t.customerId, t.companyId],
      foreignColumns: [customers.id, customers.companyId],
      name: "contacts_customer_same_company_fk",
    }).onDelete("cascade"),
    index("contacts_company_email_idx").on(t.companyId, t.email),
    index("contacts_company_phone_idx").on(t.companyId, t.phone),
  ],
);

export const enquiries = pgTable(
  "enquiries",
  {
    id: id(),
    companyId: companyId(),
    rawText: text("raw_text").notNull(),
    fromEmail: text("from_email"),
    subject: text("subject"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [unique("enquiries_id_company_uq").on(t.id, t.companyId)],
);

export const QUOTE_STATUSES = ["draft", "approved", "declined"] as const;
export const QUOTE_OUTCOMES = ["priced", "site_visit", "cannot_quote"] as const;

export const quotes = pgTable(
  "quotes",
  {
    id: id(),
    companyId: companyId(),
    enquiryId: uuid("enquiry_id").notNull(),
    customerId: uuid("customer_id"),
    /** Only a human action moves a quote out of draft. The AI never writes this column. */
    status: text("status", { enum: QUOTE_STATUSES }).notNull().default("draft"),
    outcome: text("outcome", { enum: QUOTE_OUTCOMES }).notNull(),
    jobSummary: text("job_summary"),
    /** Full validated AI response, kept for audit and debugging. */
    aiOutput: jsonb("ai_output"),
    aiProvider: text("ai_provider"),
    aiModel: text("ai_model"),
    flags: jsonb("flags").$type<{ level: "info" | "warn" | "danger"; message: string }[]>().notNull().default([]),
    subtotalPence: integer("subtotal_pence").notNull().default(0),
    minimumChargeAppliedPence: integer("minimum_charge_applied_pence").notNull().default(0),
    vatPence: integer("vat_pence").notNull().default(0),
    totalPence: integer("total_pence").notNull().default(0),
    customerMessage: text("customer_message"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("quotes_id_company_uq").on(t.id, t.companyId),
    foreignKey({
      columns: [t.enquiryId, t.companyId],
      foreignColumns: [enquiries.id, enquiries.companyId],
      name: "quotes_enquiry_same_company_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.customerId, t.companyId],
      foreignColumns: [customers.id, customers.companyId],
      name: "quotes_customer_same_company_fk",
    }),
    index("quotes_company_idx").on(t.companyId),
  ],
);

export const quoteLines = pgTable(
  "quote_lines",
  {
    id: id(),
    companyId: companyId(),
    quoteId: uuid("quote_id").notNull(),
    position: integer("position").notNull(),
    rateCode: text("rate_code"),
    description: text("description").notNull(),
    unit: text("unit", { enum: UNITS }).notNull(),
    quantityMilli: integer("quantity_milli").notNull(),
    unitPricePence: integer("unit_price_pence").notNull(),
    lineTotalPence: integer("line_total_pence").notNull(),
    source: text("source", { enum: ["ai", "human", "rule"] }).notNull(),
    working: text("working"),
    assumption: text("assumption"),
  },
  (t) => [
    foreignKey({
      columns: [t.quoteId, t.companyId],
      foreignColumns: [quotes.id, quotes.companyId],
      name: "lines_quote_same_company_fk",
    }).onDelete("cascade"),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    companyId: companyId(),
    userId: uuid("user_id").references(() => users.id),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(),
    detail: jsonb("detail"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_company_idx").on(t.companyId, t.createdAt)],
);
