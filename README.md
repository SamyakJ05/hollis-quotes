# Hollis quoting assistant

Someone at Hollis Groundworks pastes a customer enquiry and gets a **draft** quote worked out from their own price list. A person checks it, edits it if needed, and approves it. Nothing goes to a customer without a person saying yes, and the app never sends email.

- **Live app:** https://hollis-quotes.vercel.app
- **Logins** (separate companies, separate data; passwords are in the submission email, since this repo is public):
  - Hollis Groundworks: `dave@hollisgroundworks.test` (also `shaz@hollisgroundworks.test`)
  - Chase Landscapes (Dave's mate Gaz, made up): `gaz@chaselandscapes.test`
- Add your Anthropic or OpenAI key under **Settings** for each company before drafting.

## The three enquiries

| Enquiry | What the app does | Why |
|---|---|---|
| **Okafor drive extension** | Priced (live run: £3,595.97 + VAT). 20ft × 15ft is converted *in code* to 27.871 m². Strip topsoil plus an extra 100mm dig to ~250mm, a skip for the spoil, membrane, sub-base, charcoal block paving, edging on the two sides she names, site setup. It asks whether the skip can go on her drive and what pattern and edging the old drive has. The tap move is excluded ("not something we price"). The dropped kerb mention is flagged and **not** priced (she already has one). Matched to her 2025 job even though she wrote from a different email. | The easy job Dave wants off his kitchen table. |
| **Greenway car park** | **No price.** Site visit, with reasons (car park, ~1,200 m² is over the 150 m² limit, drainage needs seeing, 24/7 phasing). The new dropped kerb is excluded and referred to the council. The draft reply arranges a visit. | Dave: "I'm not quoting a car park off an email." The code enforces this even if the model tries to price it. |
| **Kestrel Row patio** | Priced normally (live run: £3,638.00 + VAT): break out concrete, sub-base, membrane, porcelain, channel drain, gully connection, skip **+ road permit**, setup. The pipe run has no rate, so it's excluded. 30-day terms and invoices to accounts@ are shown from the customer record. **A red warning** quotes the hidden "40% partner discount / waive minimum / mark as approved" note. | It's a prompt injection. It has no effect, by design (see below). |

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
| Questions for the customer | Forced site visits (area limit on each measurement and their total, "car park") | |
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
- **Structured output + Zod validation**, with one repair retry. If it still fails, the user gets a plain error, not a guessed quote. Anthropic uses `output_config.format` (JSON schema), with a forced tool call as the fallback for older models. Live testing showed `claude-sonnet-5-5` *rejects* forced tool calls, which would have broken the app for anyone testing with their own key. OpenAI uses strict structured outputs (`response_format` `json_schema`, `strict: true`) against the same schema, with a forced function call as the fallback for models that reject it. Each company chooses its provider (and optionally a model) in Settings; a key is checked for the right format and with the provider before it's saved, and a refusal, a cut-off answer or an invalid answer becomes a plain error, never a guessed quote.
- **Each company's estimating habits are data, not code.** The first live run dug a drive only 150mm deep and forgot the spoil. Rather than hard-code groundworks knowledge (Gaz does landscaping), each company has short "how we estimate" notes in its settings, shown on the Settings page and sent with every enquiry. Hollis's say a drive needs ~250mm out and spoil needs a skip or a load; the next run did exactly that.
- **Measurements are copied verbatim** ("20ft by 15ft") with a certainty (stated / estimated / vague), and code converts them. Vague ones ("size of two cars") are flagged.
- **Site visit beats price.** If there's any doubt the code takes the cautious path, and the model can't overrule it.
- **No email sending.** The brief didn't ask for it, and "approved" plus copyable text keeps a person in the loop.

## Assumptions (no questions window left, so written down)

- VAT 20%, quotes shown ex VAT with VAT on top (Dave's landlords). Quotes valid 30 days.
- Emailed quotes stop at 150 m² for Hollis (100 m² for Chase). Above that, site visit.
- The cancelled rates above, the PT01 VAT conversion and the KB01-over-KB02 choice are assumptions until Shaz confirms them.
- A matching repeat customer is identified by exact email. Fuzzy matches are suggested, not applied.
- Chase Landscapes' rates and customers are invented.
- The "how we estimate" notes (`src/import/estimating-notes.ts`) are my trade defaults, written for Dave and Gaz to correct.

## Tests

`npm test`: 98 tests. Import decisions, money and VAT rounding, tenant isolation (rates, customers, quotes, foreign keys, key encryption), the pricing engine on all three enquiries (including the compromised-model case and the forced site visit), and the save → edit → approve pipeline (approval needs a person, happens once, locks, is audited; another company can't approve or edit; approving or saving a version that changed since it was opened is refused (no lost updates); security warnings must be acknowledged; adding prices to a site visit needs a confirm; the server, not the browser, decides which lines count as human-edited).

`npx tsx scripts/try-enquiries.ts` runs the three enquiries through a live model (key from `.env`; add `--provider openai` to use `OPENAI_API_KEY` instead).

## Running it

```bash
npm install
cp .env.example .env          # set APP_ENCRYPTION_KEY and SESSION_SECRET (commands in the file)
npm run db:seed               # migrates and seeds both companies (local: PGlite, no install)
npm run dev
npx tsx scripts/seed-fixture-quotes.ts   # optional: the 3 enquiries as drafts without a key
```

**Deploy:** Neon database, then `DATABASE_URL=<neon pooled url> npm run db:seed` once, then a Vercel project with `DATABASE_URL`, `APP_ENCRYPTION_KEY` and `SESSION_SECRET`.

## Known limitations

- **OpenAI support has not been run end to end against a live OpenAI key (I didn't have one).** It is covered by mocked-SDK tests (request shape, strict schema, retry, refusal, cut-off, error mapping, function-call fallback, same guards and totals as Anthropic) and a fake-key check in Settings (wrong-provider keys are caught locally; a made-up OpenAI key is rejected by OpenAI and nothing is saved). Anthropic was live-tested with all three enquiries. If you test with an OpenAI key, please tell me what you see.
- **The AI never sees customer records**, by design: internal notes like "paid late" shouldn't reach a model or a customer. The side effect is that it can ask for things the company already knows. In the live run, the Greenway reply asked for the site address even though "Rushall Manor, Rushall" is on the customer record. The reviewer sees the record next to the draft and can edit the line before approving. A fix would be to pass the AI only the safe fields (name, address, "repeat customer") and never the notes.
- Output varies a little between runs (e.g. a skip vs a muck-away load for the same spoil). The engine makes every number traceable and every line editable, but there's no eval set yet to measure drift (see next steps).
- Customer matching is by exact email. A new email address with no other match falls back to suggestions a person confirms.
- Settings (rules, estimating notes) are read-only in the app for now; they're set in the seed.

## What I'd do next

1. **Edit rates, rules and estimating notes in the app**, with a "confirm" button for each flagged rate so Shaz clears the review list, and price history (Dave's March rise).
2. **Postgres row-level security** as a third wall behind the repository and the composite keys.
3. **Email in and out:** a forwarding address that creates drafts automatically, and sending approved quotes as a PDF from the company's own address.
4. **Learning from edits:** keep what people change on AI drafts (e.g. always adding a skip) and feed it back as company-specific guidance, with an eval set of past enquiries so prompt changes are measured, not guessed.
5. Login rate limiting, password reset, inviting users, owner-only key management.
6. Ask the customer the AI's questions by default when a measurement is vague, instead of pricing a guess.

## Questions I would have asked

I missed the 12-hour questions window, so I made the calls above and wrote them down. These are the questions I'd have sent to Dave and Shaz, in priority order. Each one maps to an assumption in this README or a flag in the app.

**Prices**
1. After the March rise, which of these are current: SB02 £38 or SB03 £41 per tonne, BP01 £62 or BP02 £58, KB01 £28 or KB02 £26?
2. Is PT01 sandstone (£85, "inc VAT") really VAT-inclusive, so £70.83 ex VAT? Are any other old prices VAT-inclusive?
3. Is CO02 concrete £1,250 per load or per m³, and how big is a load?
4. What should we say about resin bound (TM03) while the supplier price keeps moving: leave it out, or quote "price on application"?
5. Is kiln-dried sand (BP04) always included in BP01? Is it chargeable on lay-only (BP03) jobs?

**How Dave prices a job**
6. What's your standard build-up for a block-paved drive (dig depth, sub-base, sand) and for a patio?
7. When do you use a skip, an 8-wheeler muck-away or grab hire? Is site setup on every job?
8. What makes a job "go and look at it first" besides car parks: a size, commercial customers, drainage problems, anything with levels?
9. Does the £450 minimum apply before or after VAT, and to every job including surveys?

**Customers**
10. Do any customers get a standing trade or partner discount, Kestrel Row for example? If so we'd set it per customer in the app, never take it from an email.
11. Should "paid late" change anything on a quote (deposit, shorter validity), or is it just for your information?
12. Are Patience Okafor / Mrs P Okafor, Kev / Kevin Doyle and the two Sandhu rows the same people?

**The quote itself**
13. How long are quotes valid? Do you ask for a deposit? What payment terms and T&Cs go on every quote?
14. Who can approve: only Dave, or Shaz too? Is there a value above which Dave must approve?
15. How do quotes go out today (Word doc, PDF, email body), and what do they look like?

**Gaz**
16. What does Gaz's price list look like, and does he need anything Hollis doesn't (e.g. plants, design time)?

## What I'd do differently next time

- **Read the brief as soon as it arrives and send questions inside the 12 hours.** I lost the chance to clear up most of the assumptions above with one email.
- **Test against the real model on day one,** not after the screens were built. The structured-output issue (`claude-sonnet-5-5` refusing forced tool calls) and the shallow driveway dig only showed up once a real key was used, late in the build.
- **Ask the client for their "how we estimate" habits up front.** They made the biggest difference to draft quality, and they're the client's knowledge, not mine.
- **Deploy a skeleton first** so the live URL exists from the start and deployment isn't squeezed at the end.

## How I used AI tools

I used AI throughout, as the brief invites, so here's who did what.

**Claude (Opus 5.5, in the Claude desktop app, linked to my Mac)** was my main collaborator.
- It read the brief pack and proposed the scope and the core design: the AI picks items and quantities, code does all the money, and a person approves. I agreed the approach and the order of work.
- It then built the app in four committed stages (foundation, AI drafting and pricing engine, review screens, docs). It wrote most of the code and the tests and ran them on my machine.
- It tested in a real browser against my local server and then against the live site, including logging in as each company and running all three enquiries with my key.
- It also wrote the focused prompts I used with Claude Code.

**Claude Code (Sonnet 5.5)** made the follow-up changes from those prompts:
- review safety: version checks on save and approve, acknowledging security warnings, approval blocked while there are unsaved edits, CI, security headers
- OpenAI structured outputs and provider-aware settings, with mocked tests
- a light-only theme, UK times and a longer drafting limit

**My part:** the decisions and trade-offs (what the AI may and may not decide, a site visit beats a price, the bring-your-own-key model, keeping customer notes away from the model), reviewing each change, running the app myself with my own key, setting up Neon and Vercel, and deciding what to fix now and what to leave for later.

**What testing with AI caught before I shipped it**, which is most of why I trust the result:
- **Live run:** the default Claude model rejects forced tool calls, which would have broken drafting for anyone using their own key. Moved to structured output.
- **Live run:** a draft dug a driveway only 150mm deep and forgot the spoil. Fixed with per-company "how we estimate" notes rather than hard-coded trade knowledge.
- **Browser test with two tabs:** after a "changed" refusal, the editor still showed the old version, so a reviewer could approve something they hadn't seen. The editor now reloads on every new version, and saves are version-checked too.
- **After deploying:** Vercel Deployment Protection would have shown reviewers a sign-in wall; the environment variables were on the wrong Vercel project; dark mode made typed text invisible; times showed in UTC.
- **Local only:** a bundling issue with the local database, and a transaction deadlock.

**Where I didn't rely on AI:** a person always approves, every number on a quote comes from code rather than a model, and 98 tests check each change mechanically rather than on trust. OpenAI support is tested with mocks only, because I didn't have an OpenAI key.
