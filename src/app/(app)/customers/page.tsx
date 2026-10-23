import { requireTenant } from "@/server/session";

export default async function CustomersPage() {
  const { repo } = await requireTenant();
  const customers = await repo.listCustomers();
  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Customers</h1>
        <p className="text-sm text-stone-500">Imported from your list. Duplicate rows were merged; each merge says why, so a bad one can be spotted.</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {customers.map((c) => (
          <div key={c.id} className="rounded border border-stone-200 bg-white p-4 text-sm">
            <p className="font-medium">{c.displayName}{c.companyName && <span className="font-normal text-stone-500"> · {c.companyName}</span>}</p>
            {c.address && <p className="text-stone-600">{c.address}</p>}
            <ul className="mt-2 space-y-0.5">
              {c.contacts.map((ct) => (
                <li key={ct.id} className="text-stone-700">
                  {ct.email ?? "no email"}{ct.phone && ` · ${ct.phone}`}
                  {ct.role !== "primary" && <span className="ml-1 rounded bg-stone-100 px-1.5 text-xs">{ct.role}</span>}
                </li>
              ))}
            </ul>
            {(c.paymentTerms || c.internalNotes) && (
              <p className="mt-2 text-stone-600">{[c.paymentTerms && `Terms: ${c.paymentTerms}`, c.internalNotes].filter(Boolean).join(" · ")}</p>
            )}
            {c.importNotes.length > 1 && (
              <ul className="mt-2 text-xs text-stone-400">{c.importNotes.map((n) => <li key={n}>{n}</li>)}</ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
