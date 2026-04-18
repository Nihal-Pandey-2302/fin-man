import { createSupabaseServerClient } from "@/lib/supabase-server";
import { DashboardCharts } from "@/components/dashboard-charts";

function getPeriodStart(period: string, now: Date) {
  if (period === "weekly") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6))
      .toISOString()
      .slice(0, 10);
  }
  if (period === "quarterly") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1))
      .toISOString()
      .slice(0, 10);
  }
  if (period === "yearly") {
    return new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()))
      .toISOString()
      .slice(0, 10);
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
}

function addDays(dateIso: string, days: number) {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateIso: string, months: number) {
  const d = new Date(`${dateIso}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const resolvedParams = (await searchParams) ?? {};
  const periodCandidate = Array.isArray(resolvedParams.period) ? resolvedParams.period[0] : resolvedParams.period;
  const period = ["weekly", "monthly", "quarterly", "yearly"].includes(periodCandidate ?? "")
    ? (periodCandidate as "weekly" | "monthly" | "quarterly" | "yearly")
    : "monthly";
  const periodStart = getPeriodStart(period, now);
  const today = now.toISOString().slice(0, 10);
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
    budgetActualsRes,
    settingsRes,
    incomeMonthRes,
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, type, balance, currency")
      .order("created_at", { ascending: false }),
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
      .select("id, amount, category, note, date, account_id, account:accounts(name, type)")
      .order("date", { ascending: false })
      .gte("date", periodStart)
      .lte("date", today)
      .limit(20),
    supabase
      .from("budgets")
      .select("id, category, monthly_limit, period, period_start, month, year")
      .order("period_start", { ascending: false }),
    supabase.from("expenses").select("amount, date").gte("date", periodStart).lte("date", today),
    supabase.from("expenses").select("category, amount, date").gte("date", addDays(today, -370)).lte("date", today),
    supabase.from("user_settings").select("liquid_buffer").maybeSingle(),
    supabase.from("income_entries").select("amount").gte("date", monthStart).lt("date", nextMonthStart),
  ]);

  const accounts = accountsRes.data ?? [];
  const investments = investmentsRes.data ?? [];
  const loans = loansRes.data ?? [];
  const monthExpenses = monthExpensesRes.data ?? [];
  const monthInvested = monthInvestmentsRes.data ?? [];
  const upcomingAutopays = subscriptionsRes.data ?? [];
  const recentExpenses = ((recentExpensesRes.data ?? []) as Array<Record<string, unknown>>).map((expense) => {
    const accountRaw = expense.account as Record<string, unknown> | Record<string, unknown>[] | null | undefined;
    const account = Array.isArray(accountRaw) ? (accountRaw[0] ?? null) : (accountRaw ?? null);
    return {
      ...expense,
      account,
    };
  }) as Array<{
    id: string;
    amount: number;
    category: string;
    note: string | null;
    date: string;
    account_id: string | null;
    account: { name?: string; type?: string } | null;
  }>;
  const budgets = budgetsRes.data ?? [];
  const liquidBuffer = settingsRes.error ? 0 : Number(settingsRes.data?.liquid_buffer ?? 0);

  const cashInHand = accounts
    .filter((account) => account.type === "cash")
    .reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const accountMoney = accounts
    .filter((account) => account.type !== "cash" && account.type !== "ppf")
    .reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const liquidCash = cashInHand + accountMoney;
  const bufferFreeCash = liquidCash - liquidBuffer;
  const cashAvailable = accounts
    .filter((account) => account.type !== "ppf")
    .reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const lockedSavings = accounts
    .filter((account) => account.type === "ppf")
    .reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const totalInvested = investments.reduce((sum, item) => sum + Number(item.current_value ?? item.amount_invested ?? 0), 0);
  const loansOwed = loans
    .filter((loan) => loan.type === "you_owe" && loan.status !== "settled")
    .reduce((sum, loan) => sum + Math.max(0, Number(loan.amount) - Number(loan.amount_paid || 0)), 0);
  const loansToYou = loans
    .filter((loan) => loan.type === "they_owe" && loan.status !== "settled")
    .reduce((sum, loan) => sum + Math.max(0, Number(loan.amount) - Number(loan.amount_paid || 0)), 0);
  const netWorth = cashAvailable + lockedSavings + totalInvested - loansOwed;

  const thisMonthSpend = monthExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const thisMonthInvested = monthInvested.reduce((sum, inv) => sum + Number(inv.amount_invested || 0), 0);
  const thisMonthIncome = (incomeMonthRes.data ?? []).reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const thisMonthSaved = thisMonthIncome - thisMonthSpend;
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

  let trendTitle = "6-month spend trend";
  if (period === "weekly") {
    const spendByDay = new Map<string, number>();
    (allExpensesRes.data ?? []).forEach((row) => {
      const key = String(row.date).slice(5, 10);
      spendByDay.set(key, (spendByDay.get(key) ?? 0) + Number(row.amount || 0));
    });
    const next = Array.from({ length: 7 }).map((_, index) => {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - (6 - index)));
      const key = date.toISOString().slice(5, 10);
      return { month: key, value: spendByDay.get(key) ?? 0 };
    });
    trendData.splice(0, trendData.length, ...next);
    trendTitle = "7-day spend trend";
  } else if (period === "monthly") {
    const spendByDay = new Map<string, number>();
    (allExpensesRes.data ?? []).forEach((row) => {
      const key = String(row.date).slice(5, 10);
      spendByDay.set(key, (spendByDay.get(key) ?? 0) + Number(row.amount || 0));
    });
    const next = Array.from({ length: 10 }).map((_, index) => {
      const offset = Math.floor(((9 - index) * 30) / 9);
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - offset));
      const key = date.toISOString().slice(5, 10);
      return { month: key, value: spendByDay.get(key) ?? 0 };
    });
    trendData.splice(0, trendData.length, ...next);
    trendTitle = "Monthly spend trend";
  } else if (period === "quarterly") {
    const spendQuarter = new Map<string, number>();
    (allExpensesRes.data ?? []).forEach((row) => {
      const key = String(row.date).slice(0, 7);
      spendQuarter.set(key, (spendQuarter.get(key) ?? 0) + Number(row.amount || 0));
    });
    const next = Array.from({ length: 3 }).map((_, index) => {
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (2 - index), 1));
      const key = date.toISOString().slice(0, 7);
      return { month: key.slice(5), value: spendQuarter.get(key) ?? 0 };
    });
    trendData.splice(0, trendData.length, ...next);
    trendTitle = "Quarterly spend trend";
  } else {
    trendTitle = "Yearly spend trend";
  }

  const budgetRows = (budgets as Array<{
    id: string;
    category: string;
    monthly_limit: number;
    period?: "daily" | "weekly" | "monthly";
    period_start?: string;
    month?: number;
    year?: number;
  }>) ?? [];

  return (
    <section className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4 shadow-sm">
          <p className="text-xs text-zinc-400">Net Worth</p>
          <p className="mt-1 text-2xl font-semibold text-green-400">INR {netWorth.toFixed(2)}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4 shadow-sm">
          <p className="text-xs text-zinc-400">Liquid Cash</p>
          <p className="mt-1 text-2xl font-semibold text-blue-300">INR {liquidCash.toFixed(2)}</p>
          <p className="mt-1 text-xs text-zinc-500">
            Cash in hand: INR {cashInHand.toFixed(2)} • Accounts: INR {accountMoney.toFixed(2)}
          </p>
        </div>
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4 shadow-sm">
          <p className="text-xs text-zinc-400">Buffer Status</p>
          <p className="mt-1 text-2xl font-semibold text-cyan-300">INR {liquidBuffer.toFixed(2)}</p>
          <p className={`mt-1 text-xs ${bufferFreeCash >= 0 ? "text-green-300" : "text-red-300"}`}>
            Free after buffer: INR {bufferFreeCash.toFixed(2)}
          </p>
        </div>
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4 shadow-sm">
          <p className="text-xs text-zinc-400">This Month</p>
          <p className="mt-1 text-sm text-red-300">Spent: INR {thisMonthSpend.toFixed(2)}</p>
          <p className="text-sm text-green-300">Invested: INR {thisMonthInvested.toFixed(2)}</p>
          <p className="text-sm text-blue-300">Income: INR {thisMonthIncome.toFixed(2)}</p>
          <p className={`text-sm ${thisMonthSaved >= 0 ? "text-emerald-300" : "text-red-300"}`}>
            Saved: INR {thisMonthSaved.toFixed(2)}
          </p>
          <p className="text-sm text-blue-300">Savings Rate: {savingsRate.toFixed(2)}%</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4">
          <h2 className="text-sm font-semibold text-zinc-200">Upcoming autopays (7 days)</h2>
          <div className="mt-3 space-y-2 text-sm">
            {upcomingAutopays.length === 0 ? <p className="text-zinc-400">No upcoming autopays.</p> : null}
            {upcomingAutopays.map((item) => {
              const due = item.next_due_date ?? "";
              const tone =
                due < monthStart ? "text-red-400" : due === now.toISOString().slice(0, 10) ? "text-yellow-300" : "text-zinc-200";
              return (
                <div key={item.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2">
                  <span>{item.name}</span>
                  <span className={tone}>INR {Number(item.amount).toFixed(2)} • {due}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4">
          <h2 className="text-sm font-semibold text-zinc-200">Open loans summary</h2>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs text-zinc-400">You owe</p>
              <p className="text-lg font-semibold text-red-300">INR {loansOwed.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs text-zinc-400">Owed to you</p>
              <p className="text-lg font-semibold text-green-300">INR {loansToYou.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>

      <DashboardCharts
        categoryData={categoryData}
        trendData={trendData}
        trendTitle={trendTitle}
        period={period}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4">
          <h3 className="text-sm font-semibold text-zinc-200">Recent transactions</h3>
          <div className="mt-3 space-y-2">
            {recentExpenses.map((expense) => (
              <div key={expense.id} className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm">
                <span>{expense.category} • {expense.note ?? "No note"}</span>
                <span
                  className={
                    expense.account_id && expense.account?.type === "cash"
                      ? "text-amber-300"
                      : expense.account_id
                        ? "text-blue-300"
                        : "text-red-300"
                  }
                >
                  INR {Number(expense.amount).toFixed(2)} ({expense.date})
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4">
          <h3 className="text-sm font-semibold text-zinc-200">Budget vs actual</h3>
          <div className="mt-3 space-y-3">
            {budgets.length === 0 ? <p className="text-sm text-zinc-400">No budget limits configured.</p> : null}
            {budgetRows.map((budget) => {
              const period = budget.period ?? "monthly";
              let start = budget.period_start;
              if (!start && budget.year && budget.month) {
                start = `${String(budget.year).padStart(4, "0")}-${String(budget.month).padStart(2, "0")}-01`;
              }
              if (!start) return null;
              const end = period === "daily" ? addDays(start, 1) : period === "weekly" ? addDays(start, 7) : addMonths(start, 1);
              const actual = (budgetActualsRes.data ?? [])
                .filter((expense) => expense.category === budget.category && String(expense.date) >= start! && String(expense.date) < end)
                .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
              const limit = Number(budget.monthly_limit || 0);
              const percent = limit > 0 ? Math.min(100, (actual / limit) * 100) : 0;
              const over = actual > limit;
              return (
                <div key={budget.id}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-zinc-300">{budget.category} ({period})</span>
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
