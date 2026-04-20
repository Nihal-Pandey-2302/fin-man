"use client";

import { useRouter } from "next/navigation";
import {
  PieChart,
  Pie,
  Tooltip,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

export function DashboardCharts({
  categoryData,
  trendData,
  trendTitle,
  period,
}: {
  categoryData: { name: string; value: number }[];
  trendData: { month: string; value: number }[];
  trendTitle: string;
  period: "weekly" | "monthly" | "quarterly" | "yearly";
}) {
  const router = useRouter();
  const colors = ["#f97316", "#3b82f6", "#a855f7", "#06b6d4", "#ef4444", "#22c55e", "#eab308", "#94a3b8"];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4">
        <h3 className="text-sm font-semibold text-zinc-200">Top spending categories</h3>
        <div className="mt-3 h-72">
          <ResponsiveContainer width="99%" height={288}>
            <PieChart>
              <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95}>
                {categoryData.map((entry, index) => (
                  <Cell key={entry.name} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `₹${Number(value ?? 0).toFixed(2)}`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/90 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-zinc-200">{trendTitle}</h3>
          <div className="flex flex-wrap gap-1.5">
            {(["weekly", "monthly", "quarterly", "yearly"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => router.push(`/dashboard?period=${item}`)}
                className={`rounded-md px-2.5 py-1 text-[11px] capitalize transition ${
                  period === item
                    ? "bg-blue-600 text-white shadow-sm"
                    : "border border-zinc-700 bg-zinc-950/60 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 h-72">
          <ResponsiveContainer width="99%" height={288}>
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="month" stroke="#a1a1aa" />
              <YAxis stroke="#a1a1aa" />
              <Tooltip formatter={(value) => `₹${Number(value ?? 0).toFixed(2)}`} />
              <Bar dataKey="value" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}