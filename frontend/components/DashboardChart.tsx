"use client";

import * as React from "react";
import {
  BarChart,
  Bar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

type DashboardChartProps = {
  data: Array<{ label: string; accuracy: number; scope: string }>;
};

export default function DashboardChart({ data }: DashboardChartProps) {
  return (
    <>
      <div className="sr-only">
        {data.map((run) => `${run.scope}: ${run.accuracy.toFixed(1)}% validation accuracy`).join(". ")}
      </div>
      <ResponsiveContainer width="100%" height="100%">
      <BarChart accessibilityLayer data={data} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid stroke="hsl(var(--foreground) / 0.04)" vertical={false} />
        <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={11} fontWeight={600} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={10} fontWeight={600} tickLine={false} axisLine={false} />
        <Tooltip
          formatter={(value: any, _name: any, item: any) => [`${Number(value).toFixed(1)}%`, item?.payload?.scope || "Validation run"]}
          contentStyle={{
            background: "hsl(var(--surface))",
            border: "1px solid hsl(var(--border-strong))",
            borderRadius: 14,
            fontSize: 11,
            fontWeight: 600,
            boxShadow: "var(--shadow-elevated)",
          }}
          cursor={{ stroke: "hsl(var(--primary))", strokeWidth: 1.5, strokeDasharray: "3 3" }}
        />
        <Bar dataKey="accuracy" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} maxBarSize={28} />
      </BarChart>
      </ResponsiveContainer>
    </>
  );
}
