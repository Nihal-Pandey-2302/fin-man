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

function daysUntil(dateIso: string, now: Date) {
  const due = new Date(`${dateIso}T00:00:00.000Z`);
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const diff = due.getTime() - todayStart.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
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
  const recentTransactions = recentExpenses.slice(0, 5);

  return (
    <section className="space-y-8 pb-24">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-green-700/40 bg-gradient-to-br from-green-900/35 via-zinc-900/85 to-zinc-900/70 p-4 shadow-sm">
          <p className="text-xs text-zinc-400">Net Worth</p>
          <p className="metric-value mt-1 flex items-center gap-2 text-green-400">
            <span className="rupee-sign">₹</span> {netWorth.toFixed(2)}
            <span className="text-sm">{netWorth >= 0 ? "↑" : "↓"}</span>
          </p>
        </div>
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4 shadow-sm">
          <p className="text-xs text-zinc-400">Liquid Cash</p>
          <p className="metric-value mt-1 flex items-center gap-2 text-zinc-100">
            <span className="rupee-sign">₹</span> {liquidCash.toFixed(2)}
            <span className={`text-sm ${liquidCash >= 0 ? "text-green-400" : "text-red-400"}`}>{liquidCash >= 0 ? "↑" : "↓"}</span>
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            Cash in hand: <span className="rupee-sign">₹</span> {cashInHand.toFixed(2)} • Accounts: <span className="rupee-sign">₹</span> {accountMoney.toFixed(2)}
          </p>
        </div>
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4 shadow-sm">
          <p className="text-xs text-zinc-400">Buffer Status</p>
          <p className="metric-value mt-1 flex items-center gap-2 text-zinc-100">
            <span className="rupee-sign">₹</span> {liquidBuffer.toFixed(2)}
            <span className={`text-sm ${bufferFreeCash >= 0 ? "text-green-400" : "text-red-400"}`}>{bufferFreeCash >= 0 ? "↑" : "↓"}</span>
          </p>
          <p className={`mt-1 text-xs ${bufferFreeCash >= 0 ? "text-green-300" : "text-red-300"}`}>
            Free after buffer: <span className="rupee-sign">₹</span> {bufferFreeCash.toFixed(2)}
          </p>
        </div>
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4 shadow-sm">
          <p className="text-xs text-zinc-400">This Month</p>
          <p className="text-sm text-red-300">Spent: <span className="rupee-sign">₹</span> {thisMonthSpend.toFixed(2)}</p>
          <p className="text-sm text-green-300">Invested: <span className="rupee-sign">₹</span> {thisMonthInvested.toFixed(2)}</p>
          <p className="text-sm text-zinc-100">Income: <span className="rupee-sign">₹</span> {thisMonthIncome.toFixed(2)}</p>
          <p className={`text-sm ${thisMonthSaved >= 0 ? "text-emerald-300" : "text-red-300"}`}>
            Saved: <span className="rupee-sign">₹</span> {thisMonthSaved.toFixed(2)}
            <span className="ml-1">{thisMonthSaved >= 0 ? "↑" : "↓"}</span>
          </p>
          <p className="text-sm text-blue-300">Savings Rate: {savingsRate.toFixed(2)}%</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4">
          <h2 className="text-sm font-semibold text-zinc-200">Upcoming autopays (7 days)</h2>
          <div className="mt-4 flex flex-wrap gap-2 text-sm">
            {upcomingAutopays.length === 0 ? <p className="empty-state text-sm">◌ No upcoming autopays.</p> : null}
            {upcomingAutopays.map((item) => {
              const due = item.next_due_date ?? "";
              const remainingDays = due ? daysUntil(due, now) : 0;
              const badgeTone =
                remainingDays < 0 ? "bg-red-500/20 text-red-300 border-red-500/40" : remainingDays <= 1 ? "bg-yellow-500/20 text-yellow-200 border-yellow-500/40" : "bg-blue-500/15 text-blue-200 border-blue-500/30";
              return (
                <div key={item.id} className="flex items-center gap-2 rounded-full border border-zinc-700/70 bg-zinc-950/70 px-3 py-1.5">
                  <span className="text-zinc-100">{item.name}</span>
                  <span className="text-zinc-300"><span className="rupee-sign">₹</span> {Number(item.amount).toFixed(2)}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${badgeTone}`}>
                    {remainingDays < 0 ? `${Math.abs(remainingDays)}d overdue` : `${remainingDays}d left`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4">
          <h3 className="text-sm font-semibold text-zinc-200">Recent transactions</h3>
          <div className="mt-4 space-y-2">
            {recentTransactions.length === 0 ? <p className="empty-state text-sm">◌ No recent transactions.</p> : null}
            {recentTransactions.map((expense) => (
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
                  <span className="rupee-sign">₹</span> {Number(expense.amount).toFixed(2)} ({expense.date})
                </span>
              </div>
            ))}
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
          <h3 className="text-sm font-semibold text-zinc-200">Budget vs actual</h3>
          <div className="mt-4 space-y-4">
            {budgets.length === 0 ? <p className="empty-state text-sm">◌ No budget limits configured.</p> : null}
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
              const nearOrOver = percent >= 80;
              return (
                <div key={budget.id}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-zinc-300">{budget.category} ({period})</span>
                    <span className={nearOrOver ? "text-red-300" : "text-zinc-400"}>
                      <span className="rupee-sign">₹</span> {actual.toFixed(2)} / <span className="rupee-sign">₹</span> {limit.toFixed(2)}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-zinc-800/80">
                    <div
                      className={`h-full rounded-full ${nearOrOver ? "bg-red-500" : "bg-blue-500"}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4">
          <h2 className="text-sm font-semibold text-zinc-200">Open loans summary</h2>
          <div className="mt-4 grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs text-zinc-400">You owe</p>
              <p className="metric-value text-red-300"><span className="rupee-sign">₹</span> {loansOwed.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3">
              <p className="text-xs text-zinc-400">Owed to you</p>
              <p className="metric-value text-green-300"><span className="rupee-sign">₹</span> {loansToYou.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
