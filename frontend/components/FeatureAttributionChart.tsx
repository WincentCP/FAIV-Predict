"use client";

import * as React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
  Tooltip as RechartsTooltip,
} from "recharts";

type FeatureAttributionChartProps = {
  data: Array<{ name: string; importance: number; rawPct: number }>;
};

export default function FeatureAttributionChart({ data }: FeatureAttributionChartProps) {
  return (
    <ResponsiveContainer width="100%" height={220} minHeight={220}>
      <BarChart
        layout="vertical"
        data={data}
        margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
      >
        <defs>
          {/* Custom gradient fill for bars */}
          <linearGradient id="bar-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.8} />
            <stop offset="100%" stopColor="hsl(var(--primary-glow, 270 91% 65%))" stopOpacity={1} />
          </linearGradient>
        </defs>
        <XAxis type="number" unit="%" stroke="currentColor" className="text-muted-foreground/60" fontSize={10} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" stroke="currentColor" className="text-foreground/90 font-bold" fontSize={10} tickLine={false} axisLine={false} width={100} />
        <RechartsTooltip 
          formatter={(value) => [`${value}%`, "Feature Weight"]}
          contentStyle={{
            background: "hsl(var(--surface))",
            border: "1px solid hsl(var(--border-strong))",
            borderRadius: 12,
            fontSize: 10,
            fontWeight: 600,
          }}
        />
        <Bar dataKey="importance" fill="url(#bar-gradient)" radius={[0, 6, 6, 0]} barSize={16}>
          {data.map((entry, idx) => (
            <Cell key={`cell-${idx}`} className="transition-all hover:opacity-80 cursor-pointer" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
