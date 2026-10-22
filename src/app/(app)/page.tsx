import { requireTenant } from "@/server/session";

export default async function QuotesPage() {
  const { repo } = await requireTenant();
  const quotes = await repo.listQuotes();
  return (
    <section>
      <h1 className="text-xl font-semibold">Quotes</h1>
      {quotes.length === 0 ? (
        <p className="mt-4 text-sm text-stone-500">No quotes yet.</p>
      ) : (
        <ul className="mt-4 divide-y rounded border bg-white">
          {quotes.map((q) => (
            <li key={q.id} className="px-4 py-3 text-sm">{q.jobSummary ?? q.id} · {q.status}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
