"use client";

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
}: {
  categoryData: { name: string; value: number }[];
  trendData: { month: string; value: number }[];
}) {
  const colors = ["#f97316", "#3b82f6", "#a855f7", "#06b6d4", "#ef4444", "#22c55e", "#eab308", "#94a3b8"];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="text-sm font-semibold text-zinc-200">Top spending categories</h3>
        <div className="mt-3 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={categoryData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95}>
                {categoryData.map((entry, index) => (
                  <Cell key={entry.name} fill={colors[index % colors.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `INR ${Number(value ?? 0).toFixed(2)}`} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="text-sm font-semibold text-zinc-200">6-month spend trend</h3>
        <div className="mt-3 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="month" stroke="#a1a1aa" />
              <YAxis stroke="#a1a1aa" />
              <Tooltip formatter={(value) => `INR ${Number(value ?? 0).toFixed(2)}`} />
              <Bar dataKey="value" fill="#3b82f6" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
