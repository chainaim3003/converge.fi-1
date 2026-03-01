/**
 * CashflowChart — Line chart of nominalValue over time.
 *
 * Data source: /api/run-simulation PP events
 * From CLAUDE.md section 9.2: "Line chart of nominalValue over time"
 * Uses Recharts (listed in dashboard/package.json dependencies).
 */

import React, { useMemo } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card } from "../shared/Card";
import { ACTUSEvent } from "../../lib/api";
import { formatUSDShort } from "../../lib/formatters";

interface CashflowChartProps {
  events: ACTUSEvent[];
}

interface ChartPoint {
  day: number;
  date: string;
  nominalValue: number;
}

export function CashflowChart({ events }: CashflowChartProps) {
  const data = useMemo(() => {
    if (events.length === 0) return [];

    const startTime = new Date(events[0].time).getTime();
    const msPerDay = 24 * 60 * 60 * 1000;

    // Deduplicate by day — take last event per day
    const dayMap = new Map<number, ChartPoint>();

    for (const event of events) {
      const t = new Date(event.time).getTime();
      const day = Math.floor((t - startTime) / msPerDay);
      dayMap.set(day, {
        day,
        date: event.time.substring(0, 10),
        nominalValue: event.nominalValue,
      });
    }

    return Array.from(dayMap.values()).sort((a, b) => a.day - b.day);
  }, [events]);

  if (data.length === 0) {
    return (
      <Card title="Cashflow — Nominal Value Over Time">
        <p className="text-gray-500 text-sm py-8 text-center">
          Run a simulation to see the cashflow chart.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Cashflow — Nominal Value Over Time">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
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
              formatter={(value: number) => [`$${value.toLocaleString()}`, "Nominal Value"]}
              labelFormatter={(day: number) => `Day ${day}`}
            />
            <Line
              type="monotone"
              dataKey="nominalValue"
              stroke="#4c6ef5"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#4c6ef5" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
