"use client";

import { useMemo, useState, useTransition } from "react";
import type { Unit } from "@/db/schema";
import { formatGBP, lineTotal, parsePounds } from "@/lib/money";
import { formatQuantity, parseQuantityMilli, penceToPoundsInput } from "@/lib/quantity";
import { UNIT_LABEL } from "@/lib/units";
import { computeTotals } from "@/quote/totals";
import { saveQuote } from "@/app/(app)/quotes/actions";

type Line = {
  key: string;
  rateCode: string | null;
  description: string;
  unit: Unit;
  quantity: string;
  unitPrice: string;
  source: "ai" | "human" | "rule";
  working: string | null;
  assumption: string | null;
};

export type EditorProps = {
  quoteId: string;
  locked: boolean;
  outcome: string;
  initialLines: {
    rateCode: string | null;
    description: string;
    unit: Unit;
    quantityMilli: number;
    unitPricePence: number;
    source: "ai" | "human" | "rule";
    working: string | null;
    assumption: string | null;
  }[];
  initialMessage: string;
  initialCustomerId: string | null;
  customers: { id: string; label: string }[];
  rates: { code: string; description: string; unit: Unit; ratePence: number }[];
  minimumChargePence: number;
  vatRateBps: number;
};

let n = 0;
const key = () => `l${++n}`;

export function QuoteEditor(p: EditorProps) {
  const [lines, setLines] = useState<Line[]>(() =>
    p.initialLines.map((l) => ({
      key: key(),
      rateCode: l.rateCode,
      description: l.description,
      unit: l.unit,
      quantity: formatQuantity(l.quantityMilli),
      unitPrice: penceToPoundsInput(l.unitPricePence),
      source: l.source,
      working: l.working,
      assumption: l.assumption,
    })),
  );
  const [message, setMessage] = useState(p.initialMessage);
  const [customerId, setCustomerId] = useState(p.initialCustomerId);
  const [addCode, setAddCode] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();

  const computed = useMemo(() => {
    const totals = lines.map((l) => {
      const q = parseQuantityMilli(l.quantity);
      const pr = parsePounds(l.unitPrice);
      return q === null || pr === null ? null : lineTotal(q, pr);
    });
    const valid = totals.every((t) => t !== null);
    const sum = computeTotals(totals.map((t) => t ?? 0), {
      minimumChargePence: p.minimumChargePence,
      vatRateBps: p.vatRateBps,
      priced: p.outcome === "priced" || lines.length > 0,
    });
    return { totals, valid, sum };
  }, [lines, p.minimumChargePence, p.vatRateBps, p.outcome]);

  const update = (k: string, patch: Partial<Line>) => {
    setDirty(true);
    setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch, source: "human" } : l)));
  };

  const addLine = () => {
    setDirty(true);
    const rate = p.rates.find((r) => r.code === addCode);
    setLines((ls) => [
      ...ls,
      rate
        ? { key: key(), rateCode: rate.code, description: rate.description, unit: rate.unit, quantity: "1", unitPrice: penceToPoundsInput(rate.ratePence), source: "human", working: null, assumption: null }
        : { key: key(), rateCode: null, description: "", unit: "job", quantity: "1", unitPrice: "0.00", source: "human", working: null, assumption: null },
    ]);
    setAddCode("");
  };

  const save = () =>
    start(async () => {
      const res = await saveQuote(p.quoteId, {
        customerId,
        customerMessage: message,
        lines: lines.map(({ key: _k, ...l }) => l),
      });
      setStatus(res.ok ? { ok: true, text: "Saved" } : { ok: false, text: res.error ?? "Couldn't save" });
      if (res.ok) setDirty(false);
    });

  const input = "rounded border border-stone-300 px-2 py-1 disabled:border-transparent disabled:bg-transparent";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="customer">Customer</label>
        <select
          id="customer"
          disabled={p.locked}
          value={customerId ?? ""}
          onChange={(e) => { setCustomerId(e.target.value || null); setDirty(true); }}
          className={`${input} block w-full max-w-md bg-white text-sm`}
        >
          <option value="">New customer / not matched</option>
          {p.customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto rounded border border-stone-200 bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-stone-100 text-left text-stone-600">
            <tr>
              <th className="px-3 py-2">Item</th>
              <th className="px-3 py-2 w-28">Qty</th>
              <th className="px-3 py-2 w-16">Unit</th>
              <th className="px-3 py-2 w-28">Rate £</th>
              <th className="px-3 py-2 w-28 text-right">Total</th>
              {!p.locked && <th className="w-10" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 align-top">
            {lines.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-4 text-stone-500">No priced lines.{p.outcome !== "priced" && " That's deliberate: see the reasons above."}</td></tr>
            )}
            {lines.map((l, i) => (
              <tr key={l.key}>
                <td className="px-3 py-2">
                  <div className="flex items-start gap-2">
                    {l.rateCode && <span className="mt-1 font-mono text-xs text-stone-400">{l.rateCode}</span>}
                    <input disabled={p.locked} value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} className={`${input} w-full`} />
                  </div>
                  {l.working && <p className="mt-1 text-xs text-stone-500">{l.working}</p>}
                  {l.assumption && <p className="mt-1 text-xs text-amber-700">Assumed: {l.assumption}</p>}
                  {l.source === "human" && <p className="mt-1 text-xs text-blue-700">Edited by a person</p>}
                </td>
                <td className="px-3 py-2">
                  <input disabled={p.locked} inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} className={`${input} w-24 tabular-nums`} />
                </td>
                <td className="px-3 py-2 pt-3 text-stone-600">{UNIT_LABEL[l.unit]}</td>
                <td className="px-3 py-2">
                  <input disabled={p.locked} inputMode="decimal" value={l.unitPrice} onChange={(e) => update(l.key, { unitPrice: e.target.value })} className={`${input} w-24 tabular-nums`} />
                </td>
                <td className="px-3 py-2 pt-3 text-right tabular-nums">
                  {computed.totals[i] === null ? <span className="text-red-700">check</span> : formatGBP(computed.totals[i]!)}
                </td>
                {!p.locked && (
                  <td className="px-2 py-2">
                    <button title="Remove line" onClick={() => { setDirty(true); setLines((ls) => ls.filter((x) => x.key !== l.key)); }} className="text-stone-400 hover:text-red-700">✕</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-stone-200 text-sm">
            <tr><td colSpan={4} className="px-3 py-1 text-right text-stone-600">Subtotal (ex VAT)</td><td className="px-3 py-1 text-right tabular-nums">{formatGBP(computed.sum.subtotalPence)}</td></tr>
            {computed.sum.minimumChargeAppliedPence > 0 && (
              <tr><td colSpan={4} className="px-3 py-1 text-right text-stone-600">Minimum charge top-up</td><td className="px-3 py-1 text-right tabular-nums">{formatGBP(computed.sum.minimumChargeAppliedPence)}</td></tr>
            )}
            <tr><td colSpan={4} className="px-3 py-1 text-right text-stone-600">VAT at {p.vatRateBps / 100}%</td><td className="px-3 py-1 text-right tabular-nums">{formatGBP(computed.sum.vatPence)}</td></tr>
            <tr className="font-semibold"><td colSpan={4} className="px-3 py-2 text-right">Total</td><td className="px-3 py-2 text-right tabular-nums">{formatGBP(computed.sum.totalPence)}</td></tr>
          </tfoot>
        </table>
      </div>

      {!p.locked && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <select value={addCode} onChange={(e) => setAddCode(e.target.value)} className={`${input} max-w-full bg-white`}>
            <option value="">Custom line</option>
            {p.rates.map((r) => (
              <option key={r.code} value={r.code}>{r.code} · {r.description} · {formatGBP(r.ratePence)}/{UNIT_LABEL[r.unit]}</option>
            ))}
          </select>
          <button onClick={addLine} className="rounded border border-stone-300 bg-white px-3 py-1">Add line</button>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-sm font-medium" htmlFor="message">Message to the customer</label>
        <textarea id="message" disabled={p.locked} rows={8} value={message} onChange={(e) => { setMessage(e.target.value); setDirty(true); }} className={`${input} w-full bg-white text-sm`} />
      </div>

      {!p.locked && (
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={pending || !computed.valid} className="rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50">
            {pending ? "Saving…" : "Save changes"}
          </button>
          {dirty && <span className="text-sm text-amber-700">Unsaved changes. Save before approving.</span>}
          {status && !dirty && <span className={`text-sm ${status.ok ? "text-green-700" : "text-red-700"}`}>{status.text}</span>}
          {status && !status.ok && dirty && <span className="text-sm text-red-700">{status.text}</span>}
        </div>
      )}
    </div>
  );
}
