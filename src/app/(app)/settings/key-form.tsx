"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { DEFAULT_MODELS, PROVIDER_INFO, type Provider } from "@/ai/provider-info";
import { saveKey } from "./actions";

export function KeyForm({ provider, model }: { provider: Provider; model: string }) {
  const [state, action, pending] = useActionState(saveKey, undefined);
  const [chosen, setChosen] = useState<Provider>(provider);
  const keyInput = useRef<HTMLInputElement>(null);
  const info = PROVIDER_INFO[chosen];
  // A saved key is never kept in the page: clear the box once it has been accepted.
  useEffect(() => {
    if (state?.ok && keyInput.current) keyInput.current.value = "";
  }, [state]);
  return (
    // No `action` prop on purpose: React 19 resets a form after its action runs, which would snap the
    // provider dropdown back to its default while our state still says otherwise.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="space-y-3"
    >
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          <span className="block text-stone-600">Provider</span>
          <select
            name="provider"
            value={chosen}
            onChange={(e) => setChosen(e.target.value as Provider)}
            className="mt-1 rounded border border-stone-300 bg-white px-2 py-1.5"
          >
            <option value="anthropic">{PROVIDER_INFO.anthropic.label} (Claude)</option>
            <option value="openai">{PROVIDER_INFO.openai.label}</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-stone-600">Model (optional)</span>
          <input
            name="model"
            defaultValue={model}
            placeholder={DEFAULT_MODELS[chosen]}
            className="mt-1 rounded border border-stone-300 px-2 py-1.5 font-mono"
          />
        </label>
      </div>
      <label className="block text-sm">
        <span className="block text-stone-600">API key</span>
        <input
          ref={keyInput}
          name="apiKey"
          type="password"
          autoComplete="off"
          required
          placeholder={info.keyPlaceholder}
          className="mt-1 w-full max-w-md rounded border border-stone-300 px-2 py-1.5 font-mono"
        />
        <span className="mt-1 block text-xs text-stone-500">{info.keyHelp} Leave the model blank to use {DEFAULT_MODELS[chosen]}.</span>
      </label>
      {state?.error && <p className="text-sm text-red-700">{state.error}</p>}
      {state?.ok && <p className="text-sm text-green-700">{state.ok}</p>}
      <button disabled={pending} className="rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-60">
        {pending ? "Checking key…" : "Save key"}
      </button>
    </form>
  );
}
