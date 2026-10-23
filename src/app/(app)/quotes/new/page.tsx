import Link from "next/link";
import { requireTenant } from "@/server/session";
import { NewQuoteForm } from "./form";

export default async function NewQuotePage() {
  const { repo } = await requireTenant();
  const settings = await repo.settings();
  return (
    <section className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">New quote</h1>
        <p className="text-sm text-stone-500">
          Paste the customer&apos;s email or website form. You&apos;ll get a draft to check. Nothing is sent to anyone.
        </p>
      </div>
      {!settings.hasApiKey ? (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Add your company&apos;s AI key in <Link href="/settings" className="underline">Settings</Link> before drafting quotes.
        </div>
      ) : (
        <NewQuoteForm />
      )}
    </section>
  );
}
