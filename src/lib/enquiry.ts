/** Pulls From / Subject out of a pasted email, if present. Pasted website-form text works too. */
export function parseEnquiryHeaders(raw: string): { fromEmail: string | null; fromName: string | null; subject: string | null } {
  const head = raw.split(/\r?\n\r?\n/)[0] ?? "";
  const from = head.match(/^from:\s*(.*)$/im)?.[1]?.trim() ?? null;
  const subject = head.match(/^subject:\s*(.*)$/im)?.[1]?.trim() ?? null;
  let fromEmail: string | null = null;
  let fromName: string | null = null;
  if (from) {
    const angled = from.match(/^(.*?)\s*<([^>]+)>/);
    if (angled) {
      fromName = angled[1].replace(/"/g, "").trim() || null;
      fromEmail = angled[2].trim().toLowerCase();
    } else if (/@/.test(from)) {
      fromEmail = from.toLowerCase();
    }
  }
  if (!fromEmail) {
    fromEmail = raw.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0]?.toLowerCase() ?? null;
  }
  return { fromEmail, fromName, subject };
}
