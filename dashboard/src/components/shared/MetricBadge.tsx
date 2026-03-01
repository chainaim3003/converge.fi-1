/**
 * MetricBadge — Displays a metric value with label and color indicator.
 * Used in ReserveHealthPanel for backing %, liquidity %, risk score.
 */

import React from "react";

interface MetricBadgeProps {
  label: string;
  value: string;
  level: "safe" | "warning" | "danger";
  subtitle?: string;
}

const levelColors = {
  safe: {
    bg: "bg-emerald-900/30",
    border: "border-emerald-700/50",
    text: "text-emerald-400",
    dot: "bg-emerald-400",
  },
  warning: {
    bg: "bg-amber-900/30",
    border: "border-amber-700/50",
    text: "text-amber-400",
    dot: "bg-amber-400",
  },
  danger: {
    bg: "bg-red-900/30",
    border: "border-red-700/50",
    text: "text-red-400",
    dot: "bg-red-400",
  },
};

export function MetricBadge({ label, value, level, subtitle }: MetricBadgeProps) {
  const colors = levelColors[level];
  return (
    <div className={`${colors.bg} ${colors.border} border rounded-lg p-3`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
        <span className="text-xs text-gray-400 uppercase tracking-wide">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${colors.text}`}>{value}</div>
      {subtitle && <div className="text-xs text-gray-500 mt-1">{subtitle}</div>}
    </div>
  );
}
