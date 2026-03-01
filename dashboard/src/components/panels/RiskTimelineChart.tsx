/**
 * RiskTimelineChart — Risk score changes over simulation period.
 *
 * Data source: /api/run-simulation events
 * From CLAUDE.md section 9.2: "Risk score changes over simulation period"
 *
 * Displays daily redemption amounts as bars to visualize risk progression.
 */

import React, { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card } from "../shared/Card";
import { ACTUSEvent } from "../../lib/api";
import { formatUSDShort } from "../../lib/formatters";

interface RiskTimelineChartProps {
  events: ACTUSEvent[];
}

interface DayData {
  day: number;
  date: string;
  redemption: number;
}

export function RiskTimelineChart({ events }: RiskTimelineChartProps) {
  const data = useMemo(() => {
    if (events.length === 0) return [];

    const startTime = new Date(events[0].time).getTime();
    const msPerDay = 24 * 60 * 60 * 1000;

    // Aggregate PP events by day
    const dayMap = new Map<number, DayData>();

    for (const event of events) {
      if (event.type !== "PP" || Math.abs(event.payoff) === 0) continue;

      const t = new Date(event.time).getTime();
      const day = Math.floor((t - startTime) / msPerDay);
      const existing = dayMap.get(day) || { day, date: event.time.substring(0, 10), redemption: 0 };
      existing.redemption += Math.abs(event.payoff);
      dayMap.set(day, existing);
    }

    return Array.from(dayMap.values()).sort((a, b) => a.day - b.day);
  }, [events]);

  if (data.length === 0) {
    return (
      <Card title="Risk Timeline — Daily Redemptions">
        <p className="text-gray-500 text-sm py-8 text-center">
          Run a simulation to see the risk timeline.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Risk Timeline — Daily Redemptions">
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis
              dataKey="day"
              label={{ value: "Day", position: "insideBottom", offset: -5, fill: "#9ca3af" }}
              tick={{ fill: "#9ca3af", fontSize: 12 }}
            />
            <YAxis
              tickFormatter={(v: number) => formatUSDShort(v)}
              tick={{ fill: "#9ca3af", fontSize: 12 }}
            />
            <Tooltip
              contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
              labelStyle={{ color: "#9ca3af" }}
              formatter={(value: number) => [`$${value.toLocaleString()}`, "Redemptions"]}
              labelFormatter={(day: number) => `Day ${day}`}
            />
            <Bar dataKey="redemption" fill="#ef4444" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
