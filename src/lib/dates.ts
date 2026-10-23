/**
 * The company works in UK time, but the server runs in UTC (Vercel), so every
 * date shown to a person is formatted explicitly in Europe/London.
 */
const TIME_ZONE = "Europe/London";

const dateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const dateOnly = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** e.g. "24/10/2026, 21:43" */
export function formatDateTime(d: Date): string {
  return dateTime.format(d);
}

/** e.g. "24/10/2026" */
export function formatDate(d: Date): string {
  return dateOnly.format(d);
}
