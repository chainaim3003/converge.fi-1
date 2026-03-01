/**
 * AlertHistory — Timeline of risk state changes.
 *
 * Data source: CRE report metrics + simulation metadata
 * From CLAUDE.md section 9.2:
 *   "ReportReceived + MintBlocked events on-chain — Timeline of risk state changes"
 *
 * In this first cut, we generate alert entries from CRE report metrics.
 * In production, this would read ReportReceived and MintBlocked events on-chain.
 */

import React from "react";
import { Card } from "../shared/Card";
import { CREReport } from "../../lib/api";

interface AlertHistoryProps {
  report: CREReport | null;
  simulationMeta: {
    id: string;
    name: string;
    totalEvents: number;
    ppEvents: number;
    peakRedemption: number;
    finalNominalValue: number;
  } | null;
}

interface AlertEntry {
  timestamp: string;
  level: "info" | "warning" | "danger";
  message: string;
}

export function AlertHistory({ report, simulationMeta }: AlertHistoryProps) {
  // Generate alerts from current report state
  const alerts: AlertEntry[] = [];

  if (report) {
    const time = new Date(report.timestamp * 1000).toLocaleString();

    // Check each gate and generate alerts
    if (report.backingRatioBps < 10000) {
      alerts.push({
        timestamp: time,
        level: "danger",
        message: `Backing ratio dropped to ${(report.backingRatioBps / 100).toFixed(2)}% — below 100% threshold. Minting blocked.`,
      });
    }

    if (report.liquidityRatioBps < 1000) {
      alerts.push({
        timestamp: time,
        level: "danger",
        message: `Liquidity ratio at ${(report.liquidityRatioBps / 100).toFixed(2)}% — below 10% threshold. Insufficient cash for redemptions.`,
      });
    }

    if (report.riskScore > 70) {
      alerts.push({
        timestamp: time,
        level: "danger",
        message: `Risk score reached ${report.riskScore}/100 — above 70 threshold. Dangerous metric combination detected.`,
      });
    }

    if (report.maturityGapDays > 0) {
      alerts.push({
        timestamp: time,
        level: "warning",
        message: `Maturity gap: ${report.maturityGapDays} days until next T-bill covers projected redemptions.`,
      });
    }

    // If all healthy, add a positive entry
    if (report.backingRatioBps >= 10000 && report.liquidityRatioBps >= 1000 && report.riskScore <= 70) {
      alerts.push({
        timestamp: time,
        level: "info",
        message: `All policies healthy. Backing: ${(report.backingRatioBps / 100).toFixed(2)}%, Liquidity: ${(report.liquidityRatioBps / 100).toFixed(2)}%, Score: ${report.riskScore}/100.`,
      });
    }
  }

  if (simulationMeta) {
    alerts.push({
      timestamp: new Date().toLocaleString(),
      level: "info",
      message: `Simulation "${simulationMeta.name}" completed: ${simulationMeta.totalEvents} events, ${simulationMeta.ppEvents} redemptions, final supply $${(simulationMeta.finalNominalValue / 1e6).toFixed(1)}M.`,
    });
  }

  const levelStyles = {
    info: { icon: "ℹ", bg: "bg-blue-900/20", border: "border-blue-800/50", text: "text-blue-400" },
    warning: { icon: "⚠", bg: "bg-amber-900/20", border: "border-amber-800/50", text: "text-amber-400" },
    danger: { icon: "🔴", bg: "bg-red-900/20", border: "border-red-800/50", text: "text-red-400" },
  };

  return (
    <Card title="Alert History">
      {alerts.length === 0 ? (
        <p className="text-gray-500 text-sm py-4">
          No alerts yet. Run a simulation to generate risk alerts.
        </p>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {alerts.map((alert, i) => {
            const style = levelStyles[alert.level];
            return (
              <div
                key={i}
                className={`${style.bg} ${style.border} border rounded-md px-3 py-2 flex items-start gap-2`}
              >
                <span className="text-sm mt-0.5">{style.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs ${style.text}`}>{alert.message}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{alert.timestamp}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
