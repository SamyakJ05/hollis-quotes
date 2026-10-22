"use client";

import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <main className="min-h-screen grid place-items-center bg-stone-100 px-4">
      <form action={action} className="w-full max-w-sm rounded-lg border border-stone-200 bg-white p-6 shadow-sm space-y-4">
        <div>
          <h1 className="text-lg font-semibold text-stone-900">Quote drafts</h1>
          <p className="text-sm text-stone-500">Sign in to your company account.</p>
        </div>
        <label className="block text-sm">
          <span className="text-stone-700">Email</span>
          <input name="email" type="email" required autoComplete="email" className="mt-1 w-full rounded border border-stone-300 px-3 py-2" />
        </label>
        <label className="block text-sm">
          <span className="text-stone-700">Password</span>
          <input name="password" type="password" required autoComplete="current-password" className="mt-1 w-full rounded border border-stone-300 px-3 py-2" />
        </label>
        {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
        <button disabled={pending} className="w-full rounded bg-stone-900 px-3 py-2 text-white disabled:opacity-60">
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
