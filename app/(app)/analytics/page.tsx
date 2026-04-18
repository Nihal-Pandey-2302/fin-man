import { AnalyticsCharts } from "@/components/analytics-charts";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function AnalyticsPage() {
  const supabase = await createSupabaseServerClient();
  const now = new Date();
  const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10);

  const [accountsRes, expensesRes, investmentsRes] = await Promise.all([
    supabase.from("accounts").select("balance"),
    supabase.from("expenses").select("amount, date, subcategory").gte("date", startOfYear),
    supabase.from("investments").select("amount_invested, date").gte("date", startOfYear),
  ]);

  const cash = (accountsRes.data ?? []).reduce((sum, account) => sum + Number(account.balance || 0), 0);
  const expenses = expensesRes.data ?? [];
  const investments = investmentsRes.data ?? [];

  const spendYtd = expenses.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const investedYtd = investments.reduce((sum, row) => sum + Number(row.amount_invested || 0), 0);

  const spendByMonth = new Map<string, number>();
  const investedByMonth = new Map<string, number>();
  expenses.forEach((row) => {
    const key = String(row.date).slice(0, 7);
    spendByMonth.set(key, (spendByMonth.get(key) ?? 0) + Number(row.amount || 0));
  });
  investments.forEach((row) => {
    const key = String(row.date).slice(0, 7);
    investedByMonth.set(key, (investedByMonth.get(key) ?? 0) + Number(row.amount_invested || 0));
  });

  const trend = Array.from({ length: 12 }).map((_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), index, 1));
    const key = date.toISOString().slice(0, 7);
    return {
      month: key.slice(5),
      spend: spendByMonth.get(key) ?? 0,
      invested: investedByMonth.get(key) ?? 0,
    };
  });

  const nonZeroMonths = trend.filter((row) => row.spend > 0);
  const monthlyAvgSpend =
    nonZeroMonths.length > 0
      ? nonZeroMonths.reduce((sum, row) => sum + row.spend, 0) / nonZeroMonths.length
      : 0;
  const burnRateMonths = monthlyAvgSpend > 0 ? cash / monthlyAvgSpend : 0;

  const subcategoryMap = new Map<string, number>();
  expenses.forEach((row) => {
    const key = row.subcategory?.trim() || "general";
    subcategoryMap.set(key, (subcategoryMap.get(key) ?? 0) + Number(row.amount || 0));
  });
  const topSubcategories = [...subcategoryMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  return (
    <section className="space-y-4">
      <header className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h1 className="text-lg font-semibold">Analytics</h1>
        <p className="mt-1 text-sm text-zinc-400">Spend/invest trend, burn rate, YTD, and top subcategories.</p>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <p className="text-xs text-zinc-400">YTD Spent</p>
            <p className="text-lg font-semibold text-red-300">INR {spendYtd.toFixed(2)}</p>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <p className="text-xs text-zinc-400">YTD Invested</p>
            <p className="text-lg font-semibold text-green-300">INR {investedYtd.toFixed(2)}</p>
          </div>
          <div className="rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <p className="text-xs text-zinc-400">Burn Rate</p>
            <p className="text-lg font-semibold text-yellow-300">{burnRateMonths.toFixed(2)} months</p>
          </div>
        </div>
      </header>
      <AnalyticsCharts trend={trend} topSubcategories={topSubcategories} />
    </section>
  );
}
