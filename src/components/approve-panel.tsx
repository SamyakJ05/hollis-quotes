"use client";

import { useActionState } from "react";
import { approveQuote, declineQuote } from "@/app/(app)/quotes/actions";

export function ApprovePanel({ quoteId, dangerCount, priced }: { quoteId: string; dangerCount: number; priced: boolean }) {
  const [state, action, pending] = useActionState(approveQuote.bind(null, quoteId), undefined);
  return (
    <div className="space-y-3 rounded border border-stone-300 bg-white p-4">
      <h2 className="font-medium">Approve</h2>
      <p className="text-sm text-stone-600">
        {priced
          ? "Approving marks this quote as ready to send. It locks the quote and records who approved it. Nothing is emailed by this app."
          : "There's no price here, by design. Approving marks the reply (e.g. arranging a site visit) as ready to send."}
      </p>
      {dangerCount > 0 && (
        <p className="text-sm text-red-800">This enquiry has {dangerCount} security warning{dangerCount > 1 ? "s" : ""}. Read them first.</p>
      )}
      <form action={action} className="space-y-3">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="checked" value="yes" className="mt-1" />
          <span>I&apos;ve checked the items, quantities, prices and message, and saved any changes.</span>
        </label>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        <div className="flex gap-2">
          <button disabled={pending} className="rounded bg-green-700 px-4 py-2 text-sm text-white disabled:opacity-60">{priced ? "Approve quote" : "Approve reply"}</button>
          <button formAction={declineQuote.bind(null, quoteId)} className="rounded border border-stone-300 px-4 py-2 text-sm">Decline</button>
        </div>
      </form>
    </div>
  );
}
