import { createSupabaseServerClient } from "@/lib/supabase-server";
import { DashboardCharts } from "@/components/dashboard-charts";

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
  const next7days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 7))
    .toISOString()
    .slice(0, 10);

  const [
    accountsRes,
    investmentsRes,
    loansRes,
    monthExpensesRes,
    monthInvestmentsRes,
    subscriptionsRes,
    topCategoryRes,
    recentExpensesRes,
    budgetsRes,
    allExpensesRes,
  ] = await Promise.all([
    supabase.from("accounts").select("id, name, balance, currency").order("created_at", { ascending: false }),
    supabase.from("investments").select("id, amount_invested, current_value"),
    supabase.from("loans").select("id, amount, amount_paid, type, status"),
    supabase.from("expenses").select("id, amount, category").gte("date", monthStart).lt("date", nextMonthStart),
    supabase.from("investments").select("id, amount_invested").gte("date", monthStart).lt("date", nextMonthStart),
    supabase
      .from("subscriptions")
      .select("id, name, amount, next_due_date")
      .eq("is_active", true)
      .gte("next_due_date", monthStart)
      .lte("next_due_date", next7days)
      .order("next_due_date", { ascending: true }),
    supabase
      .from("expenses")
      .select("category, amount")
      .gte("date", monthStart)
      .lt("date", nextMonthStart),
    supabase
      .from("expenses")
      .select("id, amount, category, note, date")
      .order("date", { ascending: false })
      .limit(10),
    supabase.from("budgets").select("category, monthly_limit, month, year").eq("month", now.getUTCMonth() + 1).eq("year", now.getUTCFullYear()),
    supabase.from("expenses").select("amount, date"),
  ]);

  const accounts = accountsRes.data ?? [];
  const investments = investmentsRes.data ?? [];
  const loans = loansRes.data ?? [];
  const monthExpenses = monthExpensesRes.data ?? [];
  const monthInvested = monthInvestmentsRes.data ?? [];
  const upcomingAutopays = subscriptionsRes.data ?? [];
  const recentExpenses = recentExpensesRes.data ?? [];
  const budgets = budgetsRes.data ?? [];

  const cashAvailable = accounts.reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const totalInvested = investments.reduce((sum, item) => sum + Number(item.current_value ?? item.amount_invested ?? 0), 0);
  const loansOwed = loans
    .filter((loan) => loan.type === "you_owe" && loan.status !== "settled")
    .reduce((sum, loan) => sum + Math.max(0, Number(loan.amount) - Number(loan.amount_paid || 0)), 0);
  const loansToYou = loans
    .filter((loan) => loan.type === "they_owe" && loan.status !== "settled")
    .reduce((sum, loan) => sum + Math.max(0, Number(loan.amount) - Number(loan.amount_paid || 0)), 0);
  const netWorth = cashAvailable + totalInvested - loansOwed;

  const thisMonthSpend = monthExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const thisMonthInvested = monthInvested.reduce((sum, inv) => sum + Number(inv.amount_invested || 0), 0);
  const denominator = thisMonthSpend + thisMonthInvested;
  const savingsRate = denominator > 0 ? (thisMonthInvested / denominator) * 100 : 0;

  const categoryMap = new Map<string, number>();
  (topCategoryRes.data ?? []).forEach((row) => {
    categoryMap.set(row.category ?? "misc", (categoryMap.get(row.category ?? "misc") ?? 0) + Number(row.amount || 0));
  });
  const categoryData = [...categoryMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const spendByMonth = new Map<string, number>();
  (allExpensesRes.data ?? []).forEach((row) => {
    const key = String(row.date).slice(0, 7);
    spendByMonth.set(key, (spendByMonth.get(key) ?? 0) + Number(row.amount || 0));
  });
  const trendData = Array.from({ length: 6 }).map((_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (5 - index), 1));
    const key = date.toISOString().slice(0, 7);
    return { month: key.slice(5), value: spendByMonth.get(key) ?? 0 };
  });

  const actualByCategory = new Map<string, number>();
  monthExpenses.forEach((expense) => {
    actualByCategory.set(
      expense.category ?? "misc",
      (actualByCategory.get(expense.category ?? "misc") ?? 0) + Number(expense.amount || 0)
    );
  });

  return (
    <section className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs text-zinc-400">Net Worth</p>
          <p className="mt-1 text-2xl font-semibold text-green-400">INR {netWorth.toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs text-zinc-400">Cash Available</p>
          <p className="mt-1 text-2xl font-semibold text-blue-300">INR {cashAvailable.toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs text-zinc-400">Total Invested (Current)</p>
          <p className="mt-1 text-2xl font-semibold text-green-300">INR {totalInvested.toFixed(2)}</p>
        </div>
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <p className="text-xs text-zinc-400">This Month</p>
          <p className="mt-1 text-sm text-red-300">Spent: INR {thisMonthSpend.toFixed(2)}</p>
          <p className="text-sm text-green-300">Invested: INR {thisMonthInvested.toFixed(2)}</p>
          <p className="text-sm text-blue-300">Savings Rate: {savingsRate.toFixed(2)}%</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-sm font-semibold text-zinc-200">Upcoming autopays (7 days)</h2>
          <div className="mt-3 space-y-2 text-sm">
            {upcomingAutopays.length === 0 ? <p className="text-zinc-400">No upcoming autopays.</p> : null}
            {upcomingAutopays.map((item) => {
              const due = item.next_due_date ?? "";
              const tone =
                due < monthStart ? "text-red-400" : due === now.toISOString().slice(0, 10) ? "text-yellow-300" : "text-zinc-200";
              return (
                <div key={item.id} className="flex items-center justify-between rounded-md border border-zinc-800 px-3 py-2">
                  <span>{item.name}</span>
                  <span className={tone}>INR {Number(item.amount).toFixed(2)} • {due}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-sm font-semibold text-zinc-200">Open loans summary</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
              <p className="text-xs text-zinc-400">You owe</p>
              <p className="text-lg font-semibold text-red-300">INR {loansOwed.toFixed(2)}</p>
            </div>
            <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
              <p className="text-xs text-zinc-400">Owed to you</p>
              <p className="text-lg font-semibold text-green-300">INR {loansToYou.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>

      <DashboardCharts categoryData={categoryData} trendData={trendData} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-sm font-semibold text-zinc-200">Recent transactions</h3>
          <div className="mt-3 space-y-2">
            {recentExpenses.map((expense) => (
              <div key={expense.id} className="flex items-center justify-between rounded-md border border-zinc-800 px-3 py-2 text-sm">
                <span>{expense.category} • {expense.note ?? "No note"}</span>
                <span className="text-red-300">INR {Number(expense.amount).toFixed(2)} ({expense.date})</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-sm font-semibold text-zinc-200">Budget vs actual</h3>
          <div className="mt-3 space-y-3">
            {budgets.length === 0 ? <p className="text-sm text-zinc-400">No budget limits configured.</p> : null}
            {budgets.map((budget) => {
              const actual = actualByCategory.get(budget.category) ?? 0;
              const limit = Number(budget.monthly_limit || 0);
              const percent = limit > 0 ? Math.min(100, (actual / limit) * 100) : 0;
              const over = actual > limit;
              return (
                <div key={`${budget.category}-${budget.month}-${budget.year}`}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-zinc-300">{budget.category}</span>
                    <span className={over ? "text-red-300" : "text-zinc-400"}>
                      INR {actual.toFixed(2)} / {limit.toFixed(2)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-zinc-800">
                    <div className={`h-full ${over ? "bg-red-500" : "bg-blue-500"}`} style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
