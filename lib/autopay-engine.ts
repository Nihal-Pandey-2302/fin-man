import { advanceDateByCycle } from "@/lib/finance-config";
import type { SupabaseClient } from "@supabase/supabase-js";

type Subscription = {
  id: string;
  name: string;
  amount: number;
  category: string | null;
  account_id: string | null;
  billing_cycle: string;
  next_due_date?: string | null;
};

export async function runAutopayEngineForCurrentUser(supabase: SupabaseClient) {
  const today = new Date().toISOString().slice(0, 10);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { firedCount: 0, toastMessages: [] as string[] };
  }

  const { data: subscriptions, error } = await supabase
    .from("subscriptions")
    .select("id, name, amount, category, account_id, billing_cycle, next_due_date")
    .eq("user_id", user.id)
    .eq("auto_insert", true)
    .eq("is_active", true);

  if (error) {
    return { firedCount: 0, toastMessages: [] as string[] };
  }

  let firedCount = 0;
  const toastMessages: string[] = [];

  for (const sub of (subscriptions ?? []) as Subscription[]) {
    const currentDue = (sub.next_due_date ?? "").slice(0, 10);
    if (!currentDue || currentDue > today) continue;

    const { error: expenseError } = await supabase.from("expenses").insert({
      user_id: user.id,
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

  return { firedCount, toastMessages };
}
