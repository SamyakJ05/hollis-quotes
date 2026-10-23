# Hollis quoting assistant

Someone at Hollis Groundworks pastes a customer enquiry and gets a **draft** quote worked out from their own price list. A person checks it, edits it if needed, and approves it. Nothing goes to a customer without a person saying yes, and the app never sends email.

- **Live app:** _LINK_
- **Logins** (separate companies, separate data):
  - Hollis Groundworks: `dave@hollisgroundworks.test` / _PASSWORD_ (also `shaz@hollisgroundworks.test`)
  - Chase Landscapes (Dave's mate Gaz, made up): `gaz@chaselandscapes.test` / _PASSWORD_
- Add your Anthropic key under **Settings** for each company before drafting.

## The three enquiries

| Enquiry | What the app does | Why |
|---|---|---|
| **Okafor drive extension** | Priced. 20ft × 15ft is converted *in code* to 27.871 m². Dig, membrane, sub-base, charcoal block paving, edging, one muck-away load, site setup. The tap move is excluded ("not something we price"). The dropped kerb mention is flagged and **not** priced (she already has one). Matched to her 2025 job even though she wrote from a different email. | The easy job Dave wants off his kitchen table. |
| **Greenway car park** | **No price.** Site visit, with reasons (car park, ~1,200 m² is over the 150 m² limit, drainage needs seeing, 24/7 phasing). The new dropped kerb is excluded and referred to the council. The draft reply arranges a visit. | Dave: "I'm not quoting a car park off an email." The code enforces this even if the model tries to price it. |
| **Kestrel Row patio** | Priced normally (break out concrete, sub-base, porcelain, channel drain, gully, skip **+ road permit**, setup). The pipe run has no rate, so it's excluded. 30-day terms and invoices to accounts@ are shown from the customer record. **A red warning** quotes the hidden "40% partner discount / waive minimum / mark as approved" note. | It's a prompt injection. It has no effect, by design (see below). |

## How it works

```
paste enquiry
   │
   ▼
AI (company's own key) ── sees the price list WITHOUT prices
   │   returns: job summary, measurements as the customer wrote them,
   │   rate codes + how each quantity is derived, exclusions,
   │   questions, assumptions, suspicious text, a covering note
   ▼
plain code ── converts units, multiplies, looks up every price itself,
   │          drops unknown/inactive codes, applies options, the minimum
   │          charge and VAT; forces a site visit or flags things the
   │          model can't overrule
   ▼
draft quote (status = draft)
   │
   ▼
person reviews, edits (totals recomputed on the server), ticks "I've checked", approves
   │
   ▼
approved + locked, with who and when; plain text to paste into an email
```

### What the AI decides, and what it deliberately doesn't

| The AI decides | Code decides | Only a person decides |
|---|---|---|
| What the job is | Every price (the model never sees one) | Approving or declining |
| Which price-list items apply | Unit conversion (ft → m, ft² → m²) and all arithmetic | Final prices and quantities (any line can be edited) |
| How each quantity is derived (e.g. area × 0.1m depth) | Whether a code is usable (unknown, retired, TBC, not-offered codes are dropped) | Which customer it is when the email doesn't match |
| What it can't price, and why | The minimum charge (re-applied after every edit) and VAT | Anything a security warning mentions |
| Questions for the customer | Forced site visits (area limit, "car park") | |
| The covering note (no money allowed in it; flagged if it is) | Detecting instructions hidden in the enquiry | |

**Why prices are hidden from the model:** it can't anchor on them, discount them, or invent one. The model's output schema has no field for a price, discount, payment terms or quote status, so an enquiry that asks for those has nowhere to put them. A test runs a *compromised* model answer (invented `DISCOUNT40` line, the not-offered dropped kerb, the old cheaper block price, "40% discount applied, approved" in the message) through the engine: every bad line is dropped, the totals are identical to the honest answer, and it's still a draft.

## The messy data

Shaz's CSVs are in `data/` exactly as sent. The importer does the mechanical clean-up generically (any company's sheet). Judgement calls live in one file per company (`src/import/hollis-decisions.ts`), each with a reason, so Shaz can read and confirm them. The **Rates** page shows the original cell next to what was done with it, and lists the five rates that need a human.

**Rates (40 rows)**
- Units `m2` / `sqm` / `m²`, `lin m` / `m`, `per tonne` normalised. UTF-8 BOM stripped.
- **PT01 "inc VAT"**: £85 stored as **£70.83 ex VAT** and flagged (Dave said some old prices had VAT in).
- Superseded, kept for history but never used: **SB02** (SB03 is the March price), **BP02** ("old price"), **EX06** ("old, use per load").
- Never priced: **KB04** dropped kerbs (not offered: the customer is told to go to the council), **TM03** resin (TBC), **CO02** concrete ("£1,250 … per load not per m3?? check": the unit is in doubt), **KB02** (same item as KB01 at £26 with no spec; probably the pre-March price).
- Options pulled from notes: herringbone +£4/m² (BP01), road permit +£60 (PL01). Caveats ("subject to perc test", "existing base must be sound") are carried onto quotes as conditions.
- **BP04** kiln-dried sand treated as included in BP01. **MI01** £450 minimum is a rule, not a line item. **MI02** vs SB04 (two membranes) kept separate and flagged.

**Customers (13 rows → 9 customers)**, modelled as customer → contacts:
- Merged on same email, same phone, same house-number address + surname, or same company name, and each merge records why: Okafor ×2 (so `patience.okafor64@` finds last year's job), Sandhu ×2, Doyle ×2.
- **M. Hale / accounts@kestrelrow** isn't a duplicate. It's the **billing contact** for Kestrel Row, and "30 day terms" becomes a field.
- Notes like "paid late" are internal: shown to staff, never to the AI or on a quote.

## Keeping companies apart

- Every tenant table has `company_id`. All data access goes through one repository (`src/server/repo.ts`) created from the **signed-in user's database record**. The session cookie only holds a user id, and the company is never taken from a URL or form.
- **Composite foreign keys** `(id, company_id)` mean the database itself refuses e.g. a Hollis quote pointing at a Chase customer.
- Opening another company's quote by id is a 404 (tested, and checked in a browser).
- **API keys:** AES-256-GCM under a server-only master key, with the company id bound in as authenticated data, so a ciphertext copied into another company's row won't decrypt. Write-only in the UI (last 4 characters shown), checked with the provider before saving, never logged, never sent to the browser, decrypted only at the moment of an AI call.

## Decisions and why

- **Next.js 15 + TypeScript + Postgres (Neon) + Drizzle**, as you work. **PGlite** (Postgres in-process) for local dev and tests, so tests run against real Postgres, foreign keys and all, with nothing to install.
- **Money in integer pence, quantities in thousandths.** No floats near money.
- **Forced tool call + Zod validation** for both Anthropic and OpenAI, with one repair retry. If it still fails, the user gets a plain error, not a guessed quote.
- **Measurements are copied verbatim** ("20ft by 15ft") with a certainty (stated / estimated / vague), and code converts them. Vague ones ("size of two cars") are flagged.
- **Site visit beats price.** If there's any doubt the code takes the cautious path, and the model can't overrule it.
- **No email sending.** The brief didn't ask for it, and "approved" plus copyable text keeps a person in the loop.

## Assumptions (no questions window left, so written down)

- VAT 20%, quotes shown ex VAT with VAT on top (Dave's landlords). Quotes valid 30 days.
- Emailed quotes stop at 150 m² for Hollis (100 m² for Chase). Above that, site visit.
- The cancelled rates above, the PT01 VAT conversion and the KB01-over-KB02 choice are assumptions until Shaz confirms them.
- A matching repeat customer is identified by exact email. Fuzzy matches are suggested, not applied.
- Chase Landscapes' rates and customers are invented.

## Tests

`npm test`: 46 tests. Import decisions, money and VAT rounding, tenant isolation (rates, customers, quotes, foreign keys, key encryption), the pricing engine on all three enquiries (including the compromised-model case and the forced site visit), and the save → edit → approve pipeline (approval needs a person, happens once, locks, is audited; another company can't approve or edit).

`npx tsx scripts/try-enquiries.ts` runs the three enquiries through a live model (key from `.env`).

## Running it

```bash
npm install
cp .env.example .env          # set APP_ENCRYPTION_KEY and SESSION_SECRET (commands in the file)
npm run db:seed               # migrates and seeds both companies (local: PGlite, no install)
npm run dev
npx tsx scripts/seed-fixture-quotes.ts   # optional: the 3 enquiries as drafts without a key
```

**Deploy:** Neon database, then `DATABASE_URL=<neon pooled url> npm run db:seed` once, then a Vercel project with `DATABASE_URL`, `APP_ENCRYPTION_KEY` and `SESSION_SECRET`.

## What I'd do next

1. **Edit rates and rules in the app**, with a "confirm" button for each flagged rate so Shaz clears the review list, and price history (Dave's March rise).
2. **Postgres row-level security** as a third wall behind the repository and the composite keys.
3. **Email in and out:** a forwarding address that creates drafts automatically, and sending approved quotes as a PDF from the company's own address.
4. **Learning from edits:** keep what people change on AI drafts (e.g. always adding a skip) and feed it back as company-specific guidance, with an eval set of past enquiries so prompt changes are measured, not guessed.
5. Login rate limiting, password reset, inviting users, owner-only key management.
6. Ask the customer the AI's questions by default when a measurement is vague, instead of pricing a guess.

## How I used AI tools

_Sam to write in his own words._
