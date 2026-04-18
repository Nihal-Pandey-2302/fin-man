import { ExpensesManager, type Expense } from "@/components/expenses-manager";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function ExpensesPage() {
  const supabase = await createSupabaseServerClient();
  const monthFilter = new Date().toISOString().slice(0, 7);
  const monthStart = `${monthFilter}-01`;
  const monthEndDate = new Date(`${monthStart}T00:00:00.000Z`);
  monthEndDate.setUTCMonth(monthEndDate.getUTCMonth() + 1);
  const monthEnd = monthEndDate.toISOString().slice(0, 10);

  const { data: accounts } = await supabase
    .from("accounts")
    .select("id, name, balance, currency")
    .order("created_at", { ascending: false });

  const { data: initialExpensesRaw, count } = await supabase
    .from("expenses")
    .select("id, amount, category, subcategory, note, date, account_id, is_autopay, account:accounts(name, currency)", {
      count: "exact",
    })
    .gte("date", monthStart)
    .lt("date", monthEnd)
    .order("date", { ascending: false })
    .range(0, 19);

  const initialExpenses: Expense[] = (initialExpensesRaw ?? []).map((item) => ({
    ...item,
    account: Array.isArray(item.account) ? item.account[0] ?? null : item.account,
  })) as Expense[];

  return (
    <ExpensesManager
      accounts={accounts ?? []}
      initialExpenses={initialExpenses}
      initialCount={count ?? 0}
      initialMonthFilter={monthFilter}
    />
  );
}
