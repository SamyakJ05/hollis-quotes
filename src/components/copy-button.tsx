"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="rounded border border-stone-300 bg-white px-3 py-1 text-sm"
    >
      {done ? "Copied" : "Copy quote text"}
    </button>
  );
}
