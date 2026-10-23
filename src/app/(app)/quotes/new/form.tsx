"use client";

import { useActionState } from "react";
import { createQuote } from "../actions";

export function NewQuoteForm() {
  const [state, action, pending] = useActionState(createQuote, undefined);
  return (
    <form action={action} className="space-y-3">
      <textarea
        name="enquiry"
        required
        rows={18}
        placeholder={"From: Jane Smith <jane@example.com>\nSubject: Patio quote\n\nHi, could you quote for..."}
        className="w-full rounded border border-stone-300 bg-white p-3 font-mono text-sm"
      />
      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      <button disabled={pending} className="rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-60">
        {pending ? "Drafting… this takes about 20–40 seconds" : "Draft quote"}
      </button>
    </form>
  );
}
