import { requireTenant } from "@/server/session";
import { formatDate } from "@/lib/dates";
import { formatGBP } from "@/lib/money";
import { DEFAULT_MODELS, PROVIDER_INFO } from "@/ai/provider-info";
import { KeyForm } from "./key-form";
import { removeKey } from "./actions";

export default async function SettingsPage() {
  const { repo, user } = await requireTenant();
  const s = await repo.settings();
  return (
    <section className="max-w-3xl space-y-8">
      <h1 className="text-xl font-semibold">Settings</h1>

      <div className="space-y-4 rounded border border-stone-200 bg-white p-5">
        <div>
          <h2 className="font-medium">AI key for {user.companyName}</h2>
          <p className="text-sm text-stone-500">
            Quotes are drafted with your company&apos;s own key. It&apos;s encrypted before it&apos;s stored, only used on our server
            when drafting your quotes, and can&apos;t be viewed again after saving, not even by you.
          </p>
        </div>
        {s.hasApiKey ? (
          <div className="flex flex-wrap items-center gap-3 rounded bg-stone-50 p-3 text-sm">
            <span>
              {PROVIDER_INFO[s.aiProvider].label} key ending <span className="font-mono">…{s.apiKeyLast4}</span>
              {s.apiKeyUpdatedAt && <> · saved {formatDate(s.apiKeyUpdatedAt)}</>} · model{" "}
              <span className="font-mono">{s.aiModel ?? DEFAULT_MODELS[s.aiProvider]}</span>
            </span>
            <form action={removeKey} className="ml-auto">
              <button className="text-red-700 underline">Remove key</button>
            </form>
          </div>
        ) : (
          <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">No key saved yet. Quotes can&apos;t be drafted until one is added.</p>
        )}
        <KeyForm provider={s.aiProvider} model={s.aiModel ?? ""} />
      </div>

      <div className="space-y-2 rounded border border-stone-200 bg-white p-5 text-sm">
        <h2 className="font-medium">Quoting rules</h2>
        <dl className="grid grid-cols-[200px_1fr] gap-y-1">
          <dt className="text-stone-500">Minimum charge</dt><dd>{formatGBP(s.minimumChargePence)} ex VAT</dd>
          <dt className="text-stone-500">VAT</dt><dd>{s.vatRateBps / 100}%, shown on top of ex-VAT prices</dd>
          <dt className="text-stone-500">Site visit above</dt><dd>{s.siteVisitAreaM2} m²</dd>
          <dt className="text-stone-500">Always site visit for</dt><dd>{s.siteVisitKeywords.length ? s.siteVisitKeywords.join(", ") : "—"}</dd>
          <dt className="text-stone-500">Quotes valid for</dt><dd>{s.quoteValidityDays} days</dd>
        </dl>
        <div className="pt-3">
          <h3 className="font-medium">How we estimate</h3>
          <p className="text-xs text-stone-500">Given to the AI with every enquiry, so drafts follow your habits.</p>
          <pre className="mt-2 whitespace-pre-wrap rounded bg-stone-50 p-3 font-sans text-sm text-stone-700">{s.estimatingNotes ?? "None yet."}</pre>
        </div>
        <p className="text-xs text-stone-500">Editing these in the app is on the to-do list.</p>
      </div>
    </section>
  );
}
