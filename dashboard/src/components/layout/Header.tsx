/**
 * Header — Top bar showing project name, live status, and last update time.
 */

import React from "react";
import { StatusIndicator } from "../shared/StatusIndicator";
import { timeAgo } from "../../lib/formatters";

interface HeaderProps {
  healthStatus: "healthy" | "degraded" | "offline";
  lastUpdateTimestamp: number | null;
}

export function Header({ healthStatus, lastUpdateTimestamp }: HeaderProps) {
  return (
    <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-converge-600 rounded-lg flex items-center justify-center">
          <span className="text-white font-bold text-sm">C</span>
        </div>
        <h1 className="text-lg font-semibold text-gray-100">
          Converge.fi
          <span className="text-gray-500 font-normal ml-2 text-sm">StableCoinA Risk Monitor</span>
        </h1>
      </div>
      <div className="flex items-center gap-4">
        <StatusIndicator status={healthStatus} />
        {lastUpdateTimestamp && (
          <span className="text-xs text-gray-500">
            Last: {timeAgo(lastUpdateTimestamp)}
          </span>
        )}
      </div>
    </header>
  );
}
