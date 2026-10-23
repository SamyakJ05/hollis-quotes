import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime } from "@/lib/dates";

// The server runs in UTC; people read UK time.
describe("UK dates on a UTC server", () => {
  it("shows British Summer Time (UTC+1) in summer", () => {
    const d = new Date("2026-07-14T19:43:00Z");
    expect(formatDateTime(d)).toBe("14/07/2026, 20:43");
    expect(formatDate(d)).toBe("14/07/2026");
  });

  it("shows GMT (UTC+0) in winter", () => {
    expect(formatDateTime(new Date("2026-01-14T19:43:00Z"))).toBe("14/01/2026, 19:43");
  });

  it("follows the clock change: clocks go back on 25 Oct 2026 at 01:00 UTC", () => {
    expect(formatDateTime(new Date("2026-10-25T00:30:00Z"))).toBe("25/10/2026, 01:30"); // still BST
    expect(formatDateTime(new Date("2026-10-25T01:30:00Z"))).toBe("25/10/2026, 01:30"); // GMT, same wall time again
  });

  it("moves to the next UK day when it's already past midnight there", () => {
    expect(formatDateTime(new Date("2026-10-23T23:28:00Z"))).toBe("24/10/2026, 00:28"); // BST
    expect(formatDate(new Date("2026-06-30T23:30:00Z"))).toBe("01/07/2026");
  });

  it("never shows 24:xx at midnight", () => {
    expect(formatDateTime(new Date("2026-01-14T00:05:00Z"))).toBe("14/01/2026, 00:05");
  });
});
