import { requireTenant } from "@/server/session";
import { formatGBP } from "@/lib/money";
import { UNIT_LABEL } from "@/lib/units";
import type { RateStatus } from "@/db/schema";

const STATUS_STYLE: Record<RateStatus, string> = {
  active: "bg-green-100 text-green-800",
  superseded: "bg-stone-200 text-stone-600",
  included: "bg-stone-200 text-stone-600",
  needs_review: "bg-amber-100 text-amber-800",
  not_offered: "bg-red-100 text-red-800",
  system: "bg-blue-100 text-blue-800",
};

const STATUS_HELP: Record<RateStatus, string> = {
  active: "Used for quotes",
  superseded: "Old duplicate, not used",
  included: "Included in another item",
  needs_review: "No usable price, not used until someone confirms it",
  not_offered: "We don't do this; the AI will say so",
  system: "Applied automatically",
};

export default async function RatesPage() {
  const { repo } = await requireTenant();
  const rates = await repo.listRates();
  const attention = rates.filter((r) => r.status === "needs_review" || r.reviewFlag);

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Price list</h1>
        <p className="text-sm text-stone-500">
          Imported from your spreadsheet. Only <strong>active</strong> rates are ever used in a quote. All prices ex VAT.
        </p>
      </div>

      {attention.length > 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm">
          <p className="font-medium text-amber-900">{attention.length === 1 ? "1 rate needs" : `${attention.length} rates need`} someone to check {attention.length === 1 ? "it" : "them"}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-amber-900">
            {attention.map((r) => (
              <li key={r.id}>
                <span className="font-mono">{r.code}</span> {r.description}: {r.reviewFlag ?? r.importNotes.at(-1)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="overflow-x-auto rounded border border-stone-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-stone-100 text-left text-stone-600">
            <tr>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 text-right">Rate</th>
              <th className="px-3 py-2">Unit</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">What we did with it</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rates.map((r) => (
              <tr key={r.id} className={r.status === "active" ? "" : "text-stone-500"}>
                <td className="px-3 py-2 font-mono">{r.code}</td>
                <td className="px-3 py-2">
                  {r.description}
                  {r.addons.map((a) => (
                    <div key={a.label} className="text-xs text-stone-500">
                      + {a.label}: {formatGBP(a.amountPence)} {a.per === "unit" ? `per ${UNIT_LABEL[r.unit]}` : "each"}
                    </div>
                  ))}
                  {r.caveats.map((c) => (
                    <div key={c} className="text-xs text-stone-500">· {c}</div>
                  ))}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{r.ratePence === null ? "—" : formatGBP(r.ratePence)}</td>
                <td className="px-3 py-2">{UNIT_LABEL[r.unit]}</td>
                <td className="px-3 py-2">
                  <span title={STATUS_HELP[r.status]} className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[r.status]}`}>
                    {r.status.replace("_", " ")}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-stone-500">
                  {r.importNotes.join(" ")}
                  <div className="mt-1 text-stone-400">
                    Sheet: {r.original.Unit} · {r.original.Rate}
                    {r.original.Notes ? ` · "${r.original.Notes}"` : ""}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
