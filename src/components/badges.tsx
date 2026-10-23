const OUTCOME: Record<string, [string, string]> = {
  priced: ["Priced", "bg-green-100 text-green-800"],
  site_visit: ["Site visit needed", "bg-blue-100 text-blue-800"],
  cannot_quote: ["Can't quote", "bg-stone-200 text-stone-700"],
};
const STATUS: Record<string, [string, string]> = {
  draft: ["Draft, needs checking", "bg-amber-100 text-amber-800"],
  approved: ["Approved", "bg-green-600 text-white"],
  declined: ["Declined", "bg-stone-300 text-stone-700"],
};

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const [label, cls] = OUTCOME[outcome] ?? [outcome, "bg-stone-100"];
  return <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${cls}`}>{label}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const [label, cls] = STATUS[status] ?? [status, "bg-stone-100"];
  return <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${cls}`}>{label}</span>;
}

const FLAG: Record<string, string> = {
  danger: "border-red-300 bg-red-50 text-red-900",
  warn: "border-amber-300 bg-amber-50 text-amber-900",
  info: "border-stone-200 bg-white text-stone-700",
};
const ICON: Record<string, string> = { danger: "⛔", warn: "⚠️", info: "ℹ️" };

export function Flags({ flags }: { flags: { level: string; message: string }[] }) {
  if (!flags.length) return null;
  const order = { danger: 0, warn: 1, info: 2 } as Record<string, number>;
  return (
    <ul className="space-y-2">
      {[...flags].sort((a, b) => order[a.level] - order[b.level]).map((f, i) => (
        <li key={i} className={`rounded border px-3 py-2 text-sm ${FLAG[f.level]}`}>
          <span className="mr-2">{ICON[f.level]}</span>
          {f.message}
        </li>
      ))}
    </ul>
  );
}
