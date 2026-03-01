/**
 * StatusIndicator — Shows a colored dot + label for system status.
 * Used in Header for live/stale status and MintBlockStatus.
 */

import React from "react";

interface StatusIndicatorProps {
  status: "healthy" | "degraded" | "offline" | "allowed" | "blocked" | "stale";
  label?: string;
  size?: "sm" | "md";
}

const statusConfig = {
  healthy: { color: "bg-emerald-400", text: "text-emerald-400", label: "Live" },
  degraded: { color: "bg-amber-400", text: "text-amber-400", label: "Degraded" },
  offline: { color: "bg-red-400", text: "text-red-400", label: "Offline" },
  allowed: { color: "bg-emerald-400", text: "text-emerald-400", label: "Minting Allowed" },
  blocked: { color: "bg-red-400", text: "text-red-400", label: "Minting Blocked" },
  stale: { color: "bg-amber-400", text: "text-amber-400", label: "Stale Data" },
};

export function StatusIndicator({ status, label, size = "sm" }: StatusIndicatorProps) {
  const config = statusConfig[status];
  const dotSize = size === "sm" ? "w-2 h-2" : "w-3 h-3";

  return (
    <div className="flex items-center gap-2">
      <span className={`${dotSize} rounded-full ${config.color} animate-pulse`} />
      <span className={`text-sm ${config.text}`}>{label || config.label}</span>
    </div>
  );
}
