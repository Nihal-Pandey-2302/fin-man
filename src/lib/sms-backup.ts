// Reads an "SMS Backup & Restore" XML export in the browser. Only received bank messages are kept,
// and OTPs are dropped here so they never leave the device.

export type BackupSms = { sender: string; body: string; receivedAt: number };

const BANK = /HDFC ?Bank|IDFC FIRST|Indian ?Bank|HDFCBK|IDFCFB|INDBNK/i;
const OTP = /\b(?:OTP|one[\s-]?time[\s-]?password|verification code|security code)\b/i;

export function parseSmsBackup(xml: string): { messages: BackupSms[]; total: number; otps: number } {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Not a valid SMS Backup & Restore XML file");
  const nodes = [...doc.getElementsByTagName("sms")];
  let otps = 0;
  const messages: BackupSms[] = [];
  for (const n of nodes) {
    if (n.getAttribute("type") !== "1") continue; // 1 = received
    const sender = n.getAttribute("address") ?? "";
    const body = n.getAttribute("body") ?? "";
    const receivedAt = Number(n.getAttribute("date"));
    if (!body || !Number.isFinite(receivedAt) || !(BANK.test(sender) || BANK.test(body))) continue;
    if (OTP.test(body)) {
      otps++;
      continue;
    }
    messages.push({ sender: sender.slice(0, 64), body: body.slice(0, 4000), receivedAt });
  }
  // Oldest first, so balances, pairing and salary cycles build up in order.
  messages.sort((a, b) => a.receivedAt - b.receivedAt);
  return { messages, total: nodes.length, otps };
}
