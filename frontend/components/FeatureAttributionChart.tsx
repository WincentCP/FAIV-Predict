"use client";

import * as React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";

type FeatureAttributionChartProps = {
  data: Array<{ name: string; importance: number; rawPct: number }>;
};

export default function FeatureAttributionChart({ data }: FeatureAttributionChartProps) {
  return (
    <>
      <ul className="sr-only" aria-label="Global model feature importance values">
        {data.map((feature) => <li key={feature.name}>{feature.name}: {feature.importance}%</li>)}
      </ul>
      <ResponsiveContainer width="100%" height={220} minHeight={220}>
        <BarChart
          accessibilityLayer
          layout="vertical"
          data={data}
          margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
        >
          <XAxis type="number" unit="%" stroke="currentColor" className="text-muted-foreground/60" fontSize={11} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" stroke="currentColor" className="text-foreground/90 font-semibold" fontSize={11} tickLine={false} axisLine={false} width={108} />
          <RechartsTooltip
            formatter={(value) => [`${value}%`, "Global importance"]}
            contentStyle={{
              background: "hsl(var(--surface))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 600,
              boxShadow: "var(--shadow-elevated)",
            }}
          />
          <Bar dataKey="importance" fill="hsl(var(--primary))" radius={[0, 5, 5, 0]} barSize={14} />
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

