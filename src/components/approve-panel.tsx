"use client";

import { startTransition, useActionState, useState } from "react";
import { approveQuote, declineQuote } from "@/app/(app)/quotes/actions";
import { useReview } from "./quote-review";

export function ApprovePanel({ quoteId, updatedAtMs, dangerCount, priced }: { quoteId: string; updatedAtMs: number; dangerCount: number; priced: boolean }) {
  const [state, action, pending] = useActionState(approveQuote.bind(null, quoteId, updatedAtMs), undefined);
  const { dirty } = useReview();
  // Controlled, so a refused approval doesn't untick them. The form deliberately has no `action` prop:
  // React 19 resets a form after its action runs, which would untick the boxes behind our state's back.
  const [checked, setChecked] = useState(false);
  const [warnings, setWarnings] = useState(false);
  // A new version of the quote is on screen: the person has to confirm again.
  const [seenVersion, setSeenVersion] = useState(updatedAtMs);
  if (seenVersion !== updatedAtMs) {
    setSeenVersion(updatedAtMs);
    setChecked(false);
    setWarnings(false);
  }
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          startTransition(() => action(fd));
        }}
        className="space-y-3"
      >
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="checked" value="yes" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="mt-1" />
          <span>I&apos;ve checked the items, quantities, prices and message, and saved any changes.</span>
        </label>
        {dangerCount > 0 && (
          <label className="flex items-start gap-2 text-sm text-red-800">
            <input type="checkbox" name="warnings" value="yes" checked={warnings} onChange={(e) => setWarnings(e.target.checked)} className="mt-1" />
            <span>I&apos;ve read the security warning{dangerCount > 1 ? "s" : ""} above and I&apos;m still happy to approve.</span>
          </label>
        )}
        {dirty && <p className="text-sm text-amber-700">Save your changes before approving.</p>}
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        <div className="flex gap-2">
          <button disabled={pending || dirty} className="rounded bg-green-700 px-4 py-2 text-sm text-white disabled:opacity-60">{priced ? "Approve quote" : "Approve reply"}</button>
          <button type="button" onClick={() => startTransition(() => declineQuote(quoteId))} className="rounded border border-stone-300 px-4 py-2 text-sm">Decline</button>
        </div>
      </form>
    </div>
  );
}
