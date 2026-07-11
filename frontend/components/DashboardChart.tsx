"use client";

import * as React from "react";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

type DashboardChartProps = {
  data: Array<{ day: string; accuracy: number }>;
};

export default function DashboardChart({ data }: DashboardChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 8, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="accuracy-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.45} />
            <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="hsl(var(--foreground) / 0.04)" vertical={false} />
        <XAxis dataKey="day" stroke="hsl(var(--muted-foreground))" fontSize={10} fontWeight={600} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 100]} stroke="hsl(var(--muted-foreground))" fontSize={10} fontWeight={600} tickLine={false} axisLine={false} />
        <Tooltip
          formatter={(value: any) => [`${value}%`, "Validation accuracy"]}
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
        <Area type="monotone" dataKey="accuracy" stroke="hsl(var(--primary))" strokeWidth={2.5} fill="url(#accuracy-grad)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
