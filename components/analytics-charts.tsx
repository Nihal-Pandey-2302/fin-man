"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";

export function AnalyticsCharts({
  trend,
  topSubcategories,
}: {
  trend: { month: string; spend: number; invested: number }[];
  topSubcategories: { name: string; value: number }[];
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="text-sm font-semibold text-zinc-200">Monthly spend vs invested</h3>
        <div className="mt-3 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="month" stroke="#a1a1aa" />
              <YAxis stroke="#a1a1aa" />
              <Tooltip formatter={(value) => `INR ${Number(value ?? 0).toFixed(2)}`} />
              <Line type="monotone" dataKey="spend" stroke="#ef4444" strokeWidth={2} />
              <Line type="monotone" dataKey="invested" stroke="#22c55e" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="text-sm font-semibold text-zinc-200">Top subcategories</h3>
        <div className="mt-3 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topSubcategories}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="name" stroke="#a1a1aa" />
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
