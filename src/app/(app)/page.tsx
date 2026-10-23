import Link from "next/link";
import { formatDateTime } from "@/lib/dates";
import { requireTenant } from "@/server/session";
import { formatGBP } from "@/lib/money";
import { OutcomeBadge, StatusBadge } from "@/components/badges";

export default async function QuotesPage() {
  const { repo } = await requireTenant();
  const [quotes, customers] = await Promise.all([repo.listQuotes(), repo.listCustomers()]);
  const names = new Map(customers.map((c) => [c.id, c.companyName ?? c.displayName]));
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Quotes</h1>
        <Link href="/quotes/new" className="rounded bg-stone-900 px-4 py-2 text-sm text-white">New quote</Link>
      </div>
      {quotes.length === 0 ? (
        <p className="rounded border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
          No quotes yet. Paste an enquiry to get a draft.
        </p>
      ) : (
        <div className="overflow-x-auto rounded border border-stone-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-stone-100 text-left text-stone-600">
              <tr>
                <th className="px-3 py-2">Job</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Result</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Total inc VAT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {quotes.map((q) => {
                const danger = q.flags.some((f) => f.level === "danger");
                return (
                  <tr key={q.id} className="hover:bg-stone-50">
                    <td className="px-3 py-2">
                      <Link href={`/quotes/${q.id}`} className="font-medium hover:underline">{danger && "⛔ "}{q.jobSummary ?? "Quote"}</Link>
                      <div className="text-xs text-stone-500">{formatDateTime(q.createdAt)}</div>
                    </td>
                    <td className="px-3 py-2">{q.customerId ? names.get(q.customerId) : <span className="text-stone-400">New</span>}</td>
                    <td className="px-3 py-2"><OutcomeBadge outcome={q.outcome} /></td>
                    <td className="px-3 py-2"><StatusBadge status={q.status} /></td>
                    <td className="px-3 py-2 text-right tabular-nums">{q.outcome === "priced" ? formatGBP(q.totalPence) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
