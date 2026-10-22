/**
 * Customer list import.
 *
 * Shaz's list has the same people under different names and emails
 * ("Patience Okafor" / "Mrs P Okafor", "Kev" / "Kevin" Doyle) and a billing
 * contact entered as if it were a separate customer (M. Hale / accounts@).
 * We model it as customer -> contacts, and merge rows when they share an
 * email, a phone number, a house-number address + surname, or a company name.
 * Every merge records why, so a human can undo a bad one.
 */
import { normalisePhone, normaliseEmail } from "@/lib/contact";

export type NormalisedContact = {
  name: string | null;
  email: string | null;
  phone: string | null;
  role: "primary" | "billing" | "other";
};

export type NormalisedCustomer = {
  displayName: string;
  companyName: string | null;
  address: string | null;
  postcode: string | null;
  internalNotes: string | null;
  paymentTerms: string | null;
  billingEmail: string | null;
  contacts: NormalisedContact[];
  importNotes: string[];
  sourceRows: number[];
};

type Row = {
  sheetRow: number;
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
  address: string;
  notes: string;
};

const TITLES = /^(mr|mrs|ms|miss|dr)\.?\s+/i;
const STREET_ABBR: [RegExp, string][] = [
  [/\bavenue\b/g, "ave"],
  [/\broad\b/g, "rd"],
  [/\bstreet\b/g, "st"],
  [/\bclose\b/g, "cl"],
  [/\blane\b/g, "ln"],
  [/\bdrive\b/g, "dr"],
];
const COMPANY_NOISE = new Set(["ltd", "limited", "plc", "&", "and", "co", "the"]);
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?)(?:\s*(\d[A-Z]{2}))?\b/i;

function surname(name: string): string {
  const parts = name.replace(TITLES, "").trim().split(/\s+/);
  return (parts[parts.length - 1] ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

/** "14 Linden Avenue, Walsall WS5 3PL" -> "14 linden ave". Only addresses with a house number match. */
function addressKey(address: string): string | null {
  const first = address.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!/^\d+[a-z]?\s+\w/.test(first)) return null;
  let k = first.replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ");
  for (const [re, abbr] of STREET_ABBR) k = k.replace(re, abbr);
  return k;
}

function companyTokens(company: string): string[] {
  return company
    .toLowerCase()
    .replace(/[^a-z0-9& ]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !COMPANY_NOISE.has(t));
}

function isSubset(a: string[], b: string[]): boolean {
  return a.length >= 2 && a.every((t) => b.includes(t));
}

/** A "real" name has no title and no bare initial ("M. Hale", "Mrs P Okafor"). */
function isFullName(name: string): boolean {
  return !TITLES.test(name) && !/^[a-z]\.?\s/i.test(name);
}

export function normaliseCustomers(raw: Record<string, string>[]): NormalisedCustomer[] {
  const rows: Row[] = raw.map((r, i) => ({
    sheetRow: i + 2, // header is row 1 in the spreadsheet
    name: (r.Name ?? "").trim(),
    company: (r.Company ?? "").trim(),
    email: normaliseEmail(r.Email ?? ""),
    phone: normalisePhone(r.Phone ?? ""),
    address: (r.Address ?? "").trim(),
    notes: (r.Notes ?? "").trim(),
  }));

  // Union-find over rows.
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const reasons = new Map<number, string[]>();
  const link = (a: number, b: number, why: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    parent[rb] = ra;
    const list = [...(reasons.get(ra) ?? []), ...(reasons.get(rb) ?? [])];
    list.push(`Merged sheet rows ${rows[a].sheetRow} and ${rows[b].sheetRow}: ${why}`);
    reasons.set(ra, list);
  };

  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (a.email && a.email === b.email) link(i, j, `same email (${a.email})`);
      else if (a.phone && a.phone === b.phone) link(i, j, `same phone (${a.phone})`);
      else {
        const ka = addressKey(a.address);
        const kb = addressKey(b.address);
        if (ka && ka === kb && surname(a.name) === surname(b.name)) {
          link(i, j, `same address ("${ka}") and surname`);
          continue;
        }
        const ta = companyTokens(a.company);
        const tb = companyTokens(b.company);
        if (ta.length && tb.length && (isSubset(ta, tb) || isSubset(tb, ta))) {
          link(i, j, `same company ("${a.company}" / "${b.company}")`);
        }
      }
    }
  }

  const clusters = new Map<number, number[]>();
  rows.forEach((_, i) => {
    const r = find(i);
    clusters.set(r, [...(clusters.get(r) ?? []), i]);
  });

  const customers: NormalisedCustomer[] = [];
  for (const [root, idxs] of clusters) {
    const group = idxs.map((i) => rows[i]);
    const longest = (vals: string[]) => vals.filter(Boolean).sort((x, y) => y.length - x.length)[0] ?? null;

    const fullNames = group.map((r) => r.name).filter(isFullName);
    const displayName = longest(fullNames) ?? longest(group.map((r) => r.name)) ?? "Unknown";
    const companyName = longest(group.map((r) => r.company));
    const withPostcode = group.filter((r) => POSTCODE.test(r.address.split(",").pop() ?? ""));
    const address = longest((withPostcode.length ? withPostcode : group).map((r) => r.address));
    const pc = address ? (address.split(",").pop() ?? "").match(POSTCODE) : null;
    const postcode = pc ? [pc[1], pc[2]].filter(Boolean).join(" ").toUpperCase() : null;

    const noteLines = [
      ...new Set(group.map((r) => r.notes).filter((n) => n && !/^duplicate\??$/i.test(n))),
    ];
    const termsMatch = noteLines.join(" ").match(/(\d+)\s*day terms/i);

    // Contacts: one per distinct email; phone-only rows attach to a matching contact.
    const contacts: NormalisedContact[] = [];
    for (const r of group) {
      const billing =
        (r.email && /^(accounts|invoices?|finance)@/.test(r.email)) || /invoice/i.test(r.notes);
      const role: NormalisedContact["role"] = billing ? "billing" : "primary";
      const existing = contacts.find(
        (c) => (r.email && c.email === r.email) || (!r.email && r.phone && c.phone === r.phone),
      );
      if (existing) {
        existing.phone ??= r.phone;
        if (r.name.length > (existing.name?.length ?? 0) && isFullName(r.name)) existing.name = r.name;
        continue;
      }
      if (!r.email && !r.phone) continue;
      contacts.push({ name: r.name || null, email: r.email, phone: r.phone, role });
    }
    // Exactly one primary: the first non-billing contact.
    let primarySeen = false;
    for (const c of contacts) {
      if (c.role === "primary") {
        if (primarySeen) c.role = "other";
        primarySeen = true;
      }
    }

    customers.push({
      displayName,
      companyName,
      address,
      postcode,
      internalNotes: noteLines.length ? noteLines.join("; ") : null,
      paymentTerms: termsMatch ? `${termsMatch[1]} days` : null,
      billingEmail: contacts.find((c) => c.role === "billing")?.email ?? null,
      contacts,
      importNotes: reasons.get(root) ?? [],
      sourceRows: group.map((r) => r.sheetRow),
    });
  }
  return customers;
}
