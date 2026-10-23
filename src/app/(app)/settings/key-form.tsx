"use client";

import { useActionState } from "react";
import { saveKey } from "./actions";

export function KeyForm({ provider, model }: { provider: string; model: string }) {
  const [state, action, pending] = useActionState(saveKey, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          <span className="block text-stone-600">Provider</span>
          <select name="provider" defaultValue={provider} className="mt-1 rounded border border-stone-300 bg-white px-2 py-1.5">
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-stone-600">Model (optional)</span>
          <input name="model" defaultValue={model} placeholder="default" className="mt-1 rounded border border-stone-300 px-2 py-1.5" />
        </label>
      </div>
      <label className="block text-sm">
        <span className="block text-stone-600">API key</span>
        <input name="apiKey" type="password" autoComplete="off" required placeholder="sk-ant-…" className="mt-1 w-full max-w-md rounded border border-stone-300 px-2 py-1.5 font-mono" />
      </label>
      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700">{state.ok}</p>}
      <button disabled={pending} className="rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-60">
        {pending ? "Checking key…" : "Save key"}
      </button>
    </form>
  );
}
