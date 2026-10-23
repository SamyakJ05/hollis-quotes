import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/server/session";
import { Flags, OutcomeBadge, StatusBadge } from "@/components/badges";
import { QuoteEditor } from "@/components/quote-editor";
import { ApprovePanel } from "@/components/approve-panel";
import { ReviewProvider } from "@/components/quote-review";
import { CopyButton } from "@/components/copy-button";
import { renderQuoteText } from "@/quote/render-text";
import { parseEnquiryHeaders } from "@/lib/enquiry";

const REASON_LABEL: Record<string, string> = {
  not_offered: "We don't do this",
  no_price: "No current price",
  out_of_scope: "Not on our price list",
  needs_site_visit: "Needs a site visit",
};

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { repo } = await requireTenant();
  const quote = await repo.getQuote(id);
  if (!quote) notFound(); // also what another company sees

  const [enquiry, settings, company, customers, rates, names, trail] = await Promise.all([
    repo.getEnquiry(quote.enquiryId),
    repo.settings(),
    repo.company(),
    repo.listCustomers(),
    repo.activeRates(),
    repo.userNames(),
    repo.auditTrail(quote.id),
  ]);
  const customer = quote.customerId ? customers.find((c) => c.id === quote.customerId) ?? null : null;
  const headers = enquiry ? parseEnquiryHeaders(enquiry.rawText) : null;
  const suggestions = !customer && headers ? await repo.suggestCustomers(headers.fromName, headers.fromEmail) : [];
  const d = quote.details;
  const locked = quote.status !== "draft";
  const dangerCount = quote.flags.filter((f) => f.level === "danger").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-stone-500 hover:underline">← Quotes</Link>
          <h1 className="mt-1 text-xl font-semibold">{quote.jobSummary ?? "Quote"}</h1>
          <p className="text-sm text-stone-500">
            {enquiry?.subject ?? "Pasted enquiry"} · drafted {quote.createdAt.toLocaleString("en-GB")} by {quote.aiModel}
          </p>
        </div>
        <div className="flex gap-2">
          <OutcomeBadge outcome={quote.outcome} />
          <StatusBadge status={quote.status} />
        </div>
      </div>

      <Flags flags={quote.flags} />

      <ReviewProvider>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          {d && d.siteVisitReasons.length > 0 && (
            <div className="rounded border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
              <p className="font-medium">Why this needs a site visit</p>
              <ul className="mt-1 list-disc pl-5">{d.siteVisitReasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </div>
          )}

          {/* key: remount with fresh data whenever the stored quote changes, so what's on screen is what approve acts on */}
          <QuoteEditor
            key={quote.updatedAt.getTime()}
            updatedAtMs={quote.updatedAt.getTime()}
            quoteId={quote.id}
            locked={locked}
            outcome={quote.outcome}
            initialLines={quote.lines}
            initialMessage={quote.customerMessage ?? ""}
            initialCustomerId={quote.customerId}
            customers={customers.map((c) => ({ id: c.id, label: [c.displayName, c.companyName, c.address].filter(Boolean).join(" · ") }))}
            rates={rates.filter((r) => r.ratePence !== null).map((r) => ({ code: r.code, description: r.description, unit: r.unit, ratePence: r.ratePence! }))}
            minimumChargePence={settings.minimumChargePence}
            vatRateBps={settings.vatRateBps}
          />

          {d && (
            <div className="grid gap-4 sm:grid-cols-2">
              {d.measurements.length > 0 && (
                <Box title="Measurements (converted in code)">
                  {d.measurements.map((m) => (
                    <li key={m.id}>
                      <span className="font-medium">{m.label}</span>: {m.working}
                      <div className="text-xs text-stone-500">“{m.sourceText}” · {m.certainty}</div>
                    </li>
                  ))}
                </Box>
              )}
              {d.exclusions.length > 0 && (
                <Box title="Not included">
                  {d.exclusions.map((e, i) => (
                    <li key={i}><span className="font-medium">{e.request}</span> <span className="text-xs text-stone-500">({REASON_LABEL[e.reason]})</span>: {e.note}</li>
                  ))}
                </Box>
              )}
              {d.questions.length > 0 && <Box title="Questions for the customer">{d.questions.map((q) => <li key={q}>{q}</li>)}</Box>}
              {d.assumptions.length > 0 && <Box title="Assumptions">{d.assumptions.map((a) => <li key={a}>{a}</li>)}</Box>}
              {d.conditions.length > 0 && <Box title="Conditions from your price list">{d.conditions.map((c) => <li key={c}>{c}</li>)}</Box>}
            </div>
          )}

          {quote.status === "approved" && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">Ready to send</h2>
                <CopyButton text={renderQuoteText({ ...quote, companyName: company.name, customerName: customer?.displayName ?? null, vatRateBps: settings.vatRateBps, validityDays: settings.quoteValidityDays, details: d })} />
              </div>
              <pre className="whitespace-pre-wrap rounded border border-stone-200 bg-white p-4 text-sm">
                {renderQuoteText({ ...quote, companyName: company.name, customerName: customer?.displayName ?? null, vatRateBps: settings.vatRateBps, validityDays: settings.quoteValidityDays, details: d })}
              </pre>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded border border-stone-200 bg-white p-4 text-sm">
            <h2 className="font-medium">Customer</h2>
            {customer ? (
              <div className="mt-2 space-y-1">
                <p className="font-medium">{customer.displayName}{customer.companyName && <span className="font-normal text-stone-500"> · {customer.companyName}</span>}</p>
                {customer.address && <p className="text-stone-600">{customer.address}</p>}
                {customer.paymentTerms && <p>Terms: {customer.paymentTerms}</p>}
                {customer.billingEmail && <p>Invoices to: {customer.billingEmail}</p>}
                {customer.internalNotes && (
                  <p className="mt-2 rounded bg-stone-100 p-2 text-stone-700"><span className="text-xs uppercase text-stone-500">Internal note</span><br />{customer.internalNotes}</p>
                )}
                <p className="text-xs text-stone-500">Matched on the sender&apos;s email. Never shown to the customer or the AI.</p>
              </div>
            ) : (
              <div className="mt-2 space-y-2 text-stone-600">
                <p>Not matched to an existing customer{headers?.fromEmail ? ` (${headers.fromEmail})` : ""}.</p>
                {suggestions.length > 0 && (
                  <p>Possibly: {suggestions.map((s) => s.displayName).join(", ")}. Pick them in the Customer box if it&apos;s the same person.</p>
                )}
              </div>
            )}
          </div>

          {quote.status === "draft" ? (
            <ApprovePanel quoteId={quote.id} updatedAtMs={quote.updatedAt.getTime()} dangerCount={dangerCount} priced={quote.outcome === "priced"} />
          ) : (
            <div className="rounded border border-stone-200 bg-white p-4 text-sm">
              <p>
                {quote.status === "approved" ? "Approved" : "Declined"}
                {quote.approvedBy && ` by ${names.get(quote.approvedBy) ?? "someone"}`}
                {quote.approvedAt && ` on ${quote.approvedAt.toLocaleString("en-GB")}`}. Locked.
              </p>
            </div>
          )}

          <details className="rounded border border-stone-200 bg-white p-4 text-sm">
            <summary className="cursor-pointer font-medium">Original enquiry</summary>
            <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs text-stone-700">{enquiry?.rawText}</pre>
          </details>

          <div className="rounded border border-stone-200 bg-white p-4 text-sm">
            <h2 className="font-medium">History</h2>
            <ul className="mt-2 space-y-1 text-stone-600">
              {trail.map((t) => (
                <li key={t.id}>{t.createdAt.toLocaleString("en-GB")}: {t.action.replaceAll("_", " ")}{t.userId ? ` (${names.get(t.userId)})` : ""}</li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
      </ReviewProvider>
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-stone-200 bg-white p-4 text-sm">
      <h3 className="font-medium">{title}</h3>
      <ul className="mt-2 space-y-2 text-stone-700">{children}</ul>
    </div>
  );
}
