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
  LabelList,
} from "recharts";

export function AnalyticsCharts({
  trend,
  topSubcategories,
}: {
  trend: { month: string; spend: number; invested: number; savingsRate: number }[];
  topSubcategories: { name: string; value: number }[];
}) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="text-sm font-semibold text-zinc-200">Monthly spend vs invested</h3>
        <div className="mt-2 flex items-center gap-4 text-xs">
          <span className="inline-flex items-center gap-1 text-zinc-400">
            <span className="h-2 w-2 rounded-full bg-red-500" /> Spend
          </span>
          <span className="inline-flex items-center gap-1 text-zinc-400">
            <span className="h-2 w-2 rounded-full bg-green-500" /> Invested
          </span>
        </div>
        <div className="mt-3 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="month" stroke="#a1a1aa" />
              <YAxis stroke="#a1a1aa" />
              <Tooltip formatter={(value) => `₹${Number(value ?? 0).toFixed(2)}`} />
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
              <Tooltip formatter={(value) => `₹${Number(value ?? 0).toFixed(2)}`} />
              <Bar dataKey="value" fill="#3b82f6">
                <LabelList dataKey="value" position="top" formatter={(value: unknown) => `₹${Number(value ?? 0).toFixed(0)}`} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 lg:col-span-2">
        <h3 className="text-sm font-semibold text-zinc-200">Savings rate over time</h3>
        <div className="mt-3 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
              <XAxis dataKey="month" stroke="#a1a1aa" />
              <YAxis stroke="#a1a1aa" domain={[-100, 100]} />
              <Tooltip formatter={(value) => `${Number(value ?? 0).toFixed(2)}%`} />
              <Line type="monotone" dataKey="savingsRate" stroke="#38bdf8" strokeWidth={2} name="Savings rate %" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
