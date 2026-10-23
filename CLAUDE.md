# CLAUDE.md: Hollis quoting assistant

Context for Claude Code working in this repo. Read this before changing anything.

## What this is

A take-home build for **Aquilon Tech** (Full-Stack AI Engineer role, Part 1 of 2). The brief (in `../00-Brief-Read-This-First.pdf`, with `../01-voice-note-transcript.md`) is to build an AI quoting tool for a made-up UK groundworks firm, **Hollis Groundworks** (Dave Hollis, office manager Shaz, near Walsall):

- Someone pastes a customer enquiry and gets a **draft quote** worked out from the company's own price list.
- A person reviews, edits and **approves**. Nothing goes to a customer without a human yes. No email sending.
- **Multi-tenant**: it must work for other contractors (Dave's mate Gaz, a landscaper in Cannock = "Chase Landscapes"), and one company must never see another's data.
- **Bring your own key**: each company pastes its own Anthropic or OpenAI key in Settings. Reviewers test with their own Anthropic key.
- Their messy CSVs (`data/hollis-rates.csv`, `data/hollis-customers.csv`, as sent) must be imported.
- Three sample enquiries (`tests/fixtures/*.txt`, originals in `../enquiries/`) must be run through the app.
- Reviewers care about: handling gaps and mess, tenant/key safety, **what the AI decides vs what it doesn't**, and clear honest explanation.

**Part 2** (timed, 55 min, no outside AI): Dave asks for a change to this app via a chat; the candidate writes a plan to build it into this codebase, then reviews a snippet of quoting-app code. So the architecture and invariants below matter: any change must keep them.

Deliverables to utathya@aquilontech.com: live link + a login per company, repo, README, ≤5-minute video of the three enquiries, notes on AI-tool use. Part 2 must be **started by Sat 24 Oct 2026, 2:18pm IST**.

## Stack and commands

Next.js 15 (App Router, server actions) · TypeScript · Tailwind 4 · Drizzle ORM · Postgres (Neon in prod, **PGlite** in-process locally/tests) · Zod 4 · Anthropic SDK 1.x · OpenAI SDK 7.x · Vitest.

```bash
npm install
npm run db:seed        # runs migrations, seeds Hollis + Chase (idempotent; fills estimating notes if missing)
npm run dev            # http://localhost:3000
npm test               # 98 tests (vitest, real Postgres via PGlite)
npm run typecheck
npx drizzle-kit generate --name <change>   # after editing src/db/schema.ts
npx tsx scripts/try-enquiries.ts [model] [fileprefix] [--provider anthropic|openai]  # 3 enquiries vs a live model, needs ANTHROPIC_API_KEY (or OPENAI_API_KEY) in .env
npx tsx scripts/seed-fixture-quotes.ts                 # 3 drafts from hand-written fixtures, no key needed
```

`.env` (git-ignored): `DATABASE_URL` (`pglite:./.pglite` locally, Neon pooled URL in prod), `APP_ENCRYPTION_KEY` (32 bytes base64), `SESSION_SECRET` (≥32 chars), optional `SEED_HOLLIS_PASSWORD` / `SEED_CHASE_PASSWORD`, optional `ANTHROPIC_API_KEY` (only for `try-enquiries.ts`; the app itself never reads it).

Local logins: `dave@hollisgroundworks.test` / `shaz@hollisgroundworks.test` (Hollis), `gaz@chaselandscapes.test` (Chase); passwords from the seed env vars.

## The flow

```
paste enquiry → src/quote/pipeline.ts
  1. parse From/Subject (src/lib/enquiry.ts); exact email match to a customer contact
  2. load THIS company's key (decrypted) + price list + settings (repo.pricingContext)
  3. AI call (src/ai/providers.ts) with prompt from src/ai/prompt.ts → JSON validated by src/ai/draft-schema.ts
  4. src/quote/build.ts: deterministic pricing + guards → BuiltQuote
  5. repo.createDraftQuote: enquiry + quote(status=draft) + lines + audit, in one transaction
review page → edits via repo.saveQuoteEdits (totals recomputed server-side) → repo.setQuoteStatus (approve/decline)
```

## Invariants (do not break these)

1. **The model never sees or writes a price.** The prompt lists active rates as `code | description | unit | options | caveats`, no £. `DraftSchema` has **no fields** for price, discount, terms or status. All money comes from `rates.rate_pence` looked up in `build.ts`.
2. **Code does all arithmetic and unit conversion.** The model copies measurements verbatim (`20ft × 15ft`) with a certainty; `src/quote/measurements.ts` converts. Line quantities = measurement × optional multiplier, optional round-up.
3. **Money is integer pence; quantities are integer thousandths** (`quantity_milli`). Helpers in `src/lib/money.ts` and `src/lib/quantity.ts`. Never use floats for money.
4. **Only `active` rates can be priced.** Statuses: `active | superseded | included | needs_review | not_offered | system`. Unknown/inactive codes from the model are dropped with a flag.
5. **Guards only make a quote more cautious** (`src/quote/guards.ts`, applied in `build.ts`): forced site visit above `site_visit_area_m2` or on `site_visit_keywords` (Hollis: car park); not-offered services mentioned → flag; prompt-injection paragraphs in the raw enquiry → one red flag each; money/discount in the covering note → flag. Site visit / cannot-quote ⇒ zero lines, zero totals. Area limit applies to each measurement and to their total (same-words measurements count once). A line whose unit doesn't fit its measurement, or whose quantity/total is absurd (`MAX_LINE_QUANTITY`, `MAX_LINE_TOTAL_PENCE`), is kept with quantity 0 and a flag for a person to fill in.
6. **Minimum charge and VAT are applied by `src/quote/totals.ts`**, on the AI draft and again after every human edit. Quotes are ex VAT with VAT (20%) on top.
7. **Only a signed-in person changes status.** `setQuoteStatus` requires a userId, only moves `draft → approved|declined`, records who/when, audits; approved quotes are locked (no edits). Saving and approving both need `seenUpdatedAtMs` (the version the reviewer opened; mismatch ⇒ `changed`, nothing is written). The review page renders `<QuoteEditor key={updatedAt}>` so the editor remounts with fresh data whenever the stored quote changes (what's on screen is what approve acts on), and Approve is disabled while the editor has unsaved changes (`ReviewProvider` in `src/components/quote-review.tsx` shares the dirty flag) and, if the quote has a danger flag, `acknowledgedWarnings`. Line `source` is decided on the server (a line matching a stored one keeps its source, anything else is `human`; the client's claim is ignored). Adding prices to a `site_visit`/`cannot_quote` quote needs `acknowledgeOutcomeChange`, adds a warn flag and an audit detail, and drops the "no price, by design" flags (`code: "no_price_by_design"`, or by message for older rows).
8. **Tenant isolation:** all tenant data access goes through `makeRepo(db, companyId, userId)` in `src/server/repo.ts`. `companyId` comes from the logged-in user's DB row (`requireTenant()` in `src/server/session.ts`); the JWT cookie only holds the user id. Never take a company id from a URL, form or the AI. The DB backs this up with **composite FKs `(id, company_id)`** (quotes→customers/enquiries, lines→quotes, contacts→customers). Inside a transaction, query with `tx`, not `db` (PGlite has one connection and will deadlock).
9. **API keys**: AES-256-GCM (`src/lib/crypto.ts`) with the company id as AAD; `repo.settings()` strips the ciphertext; key is write-only in the UI (last 4 shown), verified with the provider on save, decrypted only in `repo.aiCredentials()` at call time. Never log it or send it to the client.
10. **The AI never sees customer records** (internal notes like "paid late"). Matching is deterministic; the review page shows the record to staff only. The enquiry text is wrapped in `<enquiry>` tags and treated as untrusted data.

## AI provider details

- Default models: `claude-sonnet-5-5` (Anthropic), `gpt-5.4-mini` (OpenAI); per-company override in settings.
- **Anthropic uses structured output** (`output_config: { format: { type: "json_schema", schema } }`). `claude-sonnet-5-5` **rejects forced `tool_choice`**; the forced-tool path is only a fallback for older models. `strictSchema()` closes objects, requires all keys, and strips min/max/length constraints for the provider; Zod re-validates with the full rules. One repair retry with the Zod errors, then a user-facing `AiError`.
- **OpenAI uses strict structured outputs** on `chat.completions` (`response_format: { type: "json_schema", json_schema: { name: "submit_draft", schema: strictSchema(...), strict: true } }`): no temperature or token limit set, timeout 120s, `maxRetries` 1. A 400 about `response_format`/`json_schema`/structured outputs falls back to the forced function call (non-strict schema). `message.refusal` → "The AI declined to draft this quote."; `finish_reason: "length"` → "The AI's answer was cut off. Try again."; unparseable or invalid JSON → one repair retry with the Zod issues, then `AiError`. Shared status mapping: 401/403 key rejected, 404 model unavailable, 429 rate limited. Error text is scrubbed of the key and anything `sk-…`-shaped before it can be logged.
- **OpenAI is NOT live-tested** (no key available): it is verified by `tests/providers.test.ts` (mocked SDKs) and a fake-key check in Settings only. Anthropic was live-tested. Don't claim otherwise.
- Provider facts shared by UI and server (default models, labels, key placeholders, `checkKeyFormat`) live in `src/ai/provider-info.ts` (no SDK imports, safe for client components). Settings: the key must match the chosen provider (`sk-ant-` vs `sk-`, with "Switch the provider to …" hints), then `verifyKey` must pass before anything is saved. The key form submits via `onSubmit` (not the form `action` prop) so React 19's post-action form reset can't desync the provider dropdown.
- Per-company **estimating notes** (`company_settings.estimating_notes`, seeded from `src/import/estimating-notes.ts`) are injected into the prompt as "HOW <COMPANY> ESTIMATES". This is how trade knowledge varies by tenant (Hollis: ~250mm drive dig via EX01+EX02, skip/muck-away for spoil, PL02 every job).
- Live results (Sonnet 5.5): Okafor ≈ £3,596 ex VAT, Greenway = site visit with no price, Kestrel = £3,638.00 ex VAT plus one red injection warning. Runs take 25–35s.

## Data import decisions

- `src/import/rates.ts`: generic clean-up (BOM, units `m2/sqm/m²→m2`, `lin m/m→lin_m`, `£1,250`, `TBC`, "inc VAT" → ex VAT + review flag, "old" → superseded, `+£` options need a mapped add-on).
- `src/import/hollis-decisions.ts`: judgement calls with reasons. SB02→SB03, BP02→BP01, EX06→EX05 superseded; KB04 not offered; TM03, CO02, KB02 needs_review; BP04 included; MI01 system (minimum £450); MI02 flagged; herringbone +£4/m², road permit +£60. PT01 £85 inc VAT → £70.83.
- `src/import/customers.ts`: union-find merge on same email / phone / house-number address + surname / company-name token subset; records reasons; billing contacts (accounts@, "invoice" in notes) and "N day terms" parsed. 13 rows → 9 customers.
- Chase data: `data/chase-*.csv`, `src/import/chase-decisions.ts`.

## File map

```
src/db/schema.ts            tables, enums, composite FKs
src/db/index.ts             createDb(url): node-postgres or PGlite
drizzle/                    migrations 0000 init, 0001 quote_details, 0002 estimating_notes
src/import/                 csv, rates, customers, seed, decisions, estimating-notes
src/ai/                     draft-schema (Zod), prompt, providers, provider-info
src/quote/                  measurements, guards, totals, build, pipeline, render-text
src/server/repo.ts          ALL tenant-scoped reads/writes
src/server/session.ts       JWT cookie, currentUser, requireTenant
src/app/login/              login page + actions (bcrypt, dummy-hash timing)
src/app/(app)/              layout (nav), quotes list, quotes/new, quotes/[id], rates, customers, settings
src/components/             quote-editor (client), approve-panel, badges/flags, copy-button
tests/                      import, money, tenancy, build (3 enquiries + compromised model), pipeline
scripts/                    migrate, seed, try-enquiries, seed-fixture-quotes
```

## Gotchas

- **Light-only UI** (`color-scheme: light`, no dark-mode block in `globals.css`); don't reintroduce `prefers-color-scheme: dark` without restyling every card. Form controls get `color: var(--foreground)` explicitly.
- **Dates are UK time**: format with `formatDate`/`formatDateTime` from `src/lib/dates.ts` (Europe/London). Never `toLocaleString` a Date on the server, which runs in UTC on Vercel.
- `src/app/(app)/quotes/new/page.tsx` has `maxDuration = 120` because live drafts take 30-45s and a repair retry can double that.
- `next.config.ts` has `serverExternalPackages: ["@electric-sql/pglite"]`; bundling PGlite breaks its wasm loading.
- PGlite allows **one process** on `./.pglite`: stop `npm run dev` before running seed/migrate/scripts against it.
- `node_modules` is platform-specific (esbuild, swc, lightningcss). Reinstall after moving between macOS and Linux.
- After schema changes: `drizzle-kit generate`, commit the SQL plus `drizzle/meta`, then run `npm run db:seed` (it migrates).
- The `vitest.config.mts` aliases `server-only` to a stub for tests.
- `npm audit` flags PostCSS inside Next 15 (build-time only); Next 16 would fix it but is a major upgrade.

## Status (Fri 23 Oct 2026, evening IST)

Done and committed: foundation, AI drafting + pricing engine, review UI, live end-to-end test with a real key, README (decisions, assumptions, questions I'd have asked, next steps).

Still to do:
1. Deploy: GitHub repo (push), Neon DB, `DATABASE_URL=<neon> SEED_HOLLIS_PASSWORD=… SEED_CHASE_PASSWORD=… npm run db:seed`, Vercel project with `DATABASE_URL`, `APP_ENCRYPTION_KEY`, `SESSION_SECRET`. Then fill the live link and passwords in README.
2. README "How I used AI tools", in Sam's own words.
3. 5-minute video: Dave → Settings key → the three enquiries → edit + approve → Gaz can't see Hollis.
4. Email utathya@aquilontech.com by ~11am IST Sat; Part 2 by 2:18pm IST.

Next-step ideas (also in README): editable rates/rules/notes with "confirm" for flagged rates, Postgres RLS, email in/out + PDF, learning from human edits with an eval set, login rate limiting, owner-only key management, passing safe customer fields (not notes) to the AI.
