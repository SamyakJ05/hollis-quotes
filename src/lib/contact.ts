export function normaliseEmail(raw: string): string | null {
  const e = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(e) ? e : null;
}

/** UK phone to national digits: "+44 7700 900412" -> "07700900412". */
export function normalisePhone(raw: string): string | null {
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("44")) d = "0" + d.slice(2);
  return d.length >= 10 ? d : null;
}
