// SMS-forwarding health: the stale-SMS alert and the dashboard's lastSmsAt.
import { beforeEach, describe, expect, it } from "vitest";
import type { Dashboard } from "../shared/api";
import { addDays, istDate, istToUtc } from "../shared/time";
import { buildAlerts } from "../worker/ledger/alerts";
import { api, db, fixture, postSms, resetLedger, seedAccounts } from "./helpers";

const at = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return istToUtc(y, m, d, 10, 0).getTime();
};
const stale = async (today: string) => (await buildAlerts(db, today)).filter((a) => a.key.startsWith("sms_stale:"));
beforeEach(resetLedger);

describe("SMS forwarding health", () => {
  it("stays quiet before the first SMS ever arrives", async () => {
    expect(await stale(istDate())).toHaveLength(0);
    const d = (await (await api("/dashboard")).json()) as Dashboard;
    expect(d.lastSmsAt).toBeNull();
  });

  it("warns after 3 quiet days and clears when an SMS arrives", async () => {
    await seedAccounts();
    const today = istDate();
    await postSms("JD-IDFCFB-S", fixture("idfc/credit.txt"), at(addDays(today, -3)));
    const alerts = await stale(today);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toBe("No bank SMS for 3 days");
    expect(await stale(addDays(today, -1))).toHaveLength(0);

    // Any SMS proves forwarding works, even one that's ignored (an OTP is stored only as a blank marker).
    await postSms("JD-IDFCFB-S", "123456 is your OTP for login. Do not share it with anyone.", Date.now());
    expect(await stale(today)).toHaveLength(0);
    const d = (await (await api("/dashboard")).json()) as Dashboard;
    expect(d.lastSmsAt).not.toBeNull();
    expect(d.alerts.some((a) => a.key.startsWith("sms_stale:"))).toBe(false);
  });
});
