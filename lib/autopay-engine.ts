import { advanceDateByCycle } from "@/lib/finance-config";
import type { SupabaseClient } from "@supabase/supabase-js";

function localDateParts() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const today = `${yyyy}-${mm}-${dd}`;
  const monthKey = `${yyyy}-${mm}`;
  const dayOfMonth = now.getDate();
  const lastDayOfMonth = new Date(yyyy, now.getMonth() + 1, 0).getDate();
  return { today, monthKey, dayOfMonth, lastDayOfMonth };
}

type SipInvestment = {
  id: string;
  name: string;
  is_sip: boolean;
  sip_amount: number | null;
  sip_date: number | null;
  account_id: string | null;
  sip_last_posted_month: string | null;
  amount_invested: number;
  current_value: number | null;
  note: string | null;
};

type Subscription = {
  id: string;
  name: string;
  amount: number;
  category: string | null;
  account_id: string | null;
  billing_cycle: string;
  next_due_date?: string | null;
};

// ─── Auth is handled by the CALLER, not here ───────────────────────────────
// Usage (in dashboard layout/page):
//
//   const supabase = await createSupabaseServerClient();
//   const { data: { user } } = await supabase.auth.getUser();
//   if (user) {
//     await runAutopayEngineForCurrentUser(supabase, user.id);
//   }
//
// Optional cookie guard to avoid running on every render:
//
//   const lastRun = cookies().get("autopay_last_run")?.value;
//   if (lastRun !== today) {
//     await runAutopayEngineForCurrentUser(supabase, user.id);
//     // then set cookie: cookies().set("autopay_last_run", today)
//   }
// ───────────────────────────────────────────────────────────────────────────

export async function runAutopayEngineForCurrentUser(
  supabase: SupabaseClient,
  userId: string            // ← passed in by caller, no auth fetch here
) {
  const today = new Date().toISOString().slice(0, 10);
  const { today: sipToday, monthKey, dayOfMonth, lastDayOfMonth } = localDateParts();

  let firedCount = 0;
  const toastMessages: string[] = [];

  // ── Subscriptions autopay ─────────────────────────────────────────────────

  const { data: subscriptions, error } = await supabase
    .from("subscriptions")
    .select("id, name, amount, category, account_id, billing_cycle, next_due_date")
    .eq("user_id", userId)
    .eq("auto_insert", true)
    .eq("is_active", true);

  if (error) {
    return { firedCount: 0, toastMessages: [] as string[] };
  }

  for (const sub of (subscriptions ?? []) as Subscription[]) {
    const currentDue = (sub.next_due_date ?? "").slice(0, 10);
    if (!currentDue || currentDue > today) continue;

    const { error: expenseError } = await supabase.from("expenses").insert({
      user_id: userId,
      amount: sub.amount,
      category: sub.category ?? "subscription",
      currency: "INR",
      subcategory: sub.name,
      note: `Auto: ${sub.name}`,
      date: today,
      account_id: sub.account_id,
      subscription_id: sub.id,
      is_autopay: true,
    });

    if (expenseError) continue;

    if (sub.account_id) {
      const { data: account } = await supabase
        .from("accounts")
        .select("balance")
        .eq("id", sub.account_id)
        .single();

      if (account) {
        await supabase
          .from("accounts")
          .update({ balance: Number(account.balance) - Number(sub.amount) })
          .eq("id", sub.account_id);
      }
    }

    const nextDate = advanceDateByCycle(currentDue, sub.billing_cycle);
    await supabase
      .from("subscriptions")
      .update({ next_due_date: nextDate, next_billing_date: nextDate })
      .eq("id", sub.id);

    firedCount += 1;
    toastMessages.push(`INR ${Number(sub.amount).toFixed(2)} auto-deducted for ${sub.name}`);
  }

  // ── SIP autopay ───────────────────────────────────────────────────────────

  const { data: sipInvestments, error: sipError } = await supabase
    .from("investments")
    .select(
      "id, name, is_sip, sip_amount, sip_date, account_id, sip_last_posted_month, amount_invested, current_value, note"
    )
    .eq("user_id", userId)
    .eq("is_sip", true);

  if (!sipError && sipInvestments?.length) {
    for (const inv of sipInvestments as SipInvestment[]) {
      const amount = Number(inv.sip_amount ?? 0);
      const sipDay = inv.sip_date;
      if (!amount || sipDay == null || sipDay < 1 || sipDay > 31) continue;
      if (!inv.account_id) continue;
      if (inv.sip_last_posted_month === monthKey) continue;   // duplicate guard ✓

      const effectiveSipDay = Math.min(sipDay, lastDayOfMonth);
      if (dayOfMonth < effectiveSipDay) continue;

      const { error: expenseError } = await supabase.from("expenses").insert({
        user_id: userId,
        amount,
        category: "investment",
        currency: "INR",
        subcategory: inv.name,
        note: `SIP auto: ${inv.name}`,
        date: sipToday,
        account_id: inv.account_id,
        investment_id: inv.id,
        is_autopay: true,
      });

      if (expenseError) continue;

      const { data: account } = await supabase
        .from("accounts")
        .select("balance")
        .eq("id", inv.account_id)
        .single();

      if (account) {
        await supabase
          .from("accounts")
          .update({ balance: Number(account.balance) - amount })
          .eq("id", inv.account_id);
      }

      const nextInvested = Number(inv.amount_invested) + amount;
      const baseCurrent = Number(inv.current_value ?? inv.amount_invested);
      const nextCurrent = baseCurrent + amount;
      const sipLine = `SIP: INR ${amount.toFixed(2)} on ${sipToday}`;
      const nextNote = inv.note ? `${inv.note}\n${sipLine}` : sipLine;

      await supabase
        .from("investments")
        .update({
          amount_invested: nextInvested,
          current_value: nextCurrent,
          note: nextNote,
          sip_last_posted_month: monthKey,
        })
        .eq("id", inv.id);

      firedCount += 1;
      toastMessages.push(`INR ${amount.toFixed(2)} SIP deducted for ${inv.name}`);
    }
  }

  return { firedCount, toastMessages };
}