/**
 * MintBlockStatus — Shows "MINTING ALLOWED 🟢" or "MINTING BLOCKED 🔴" with reason.
 *
 * Data source: CRE report metrics (mirrors stablecoin.getMintStatus() on-chain read)
 * From CLAUDE.md section 9.2:
 *   "MINTING ALLOWED 🟢" or "MINTING BLOCKED 🔴" with reason
 *
 * In this first cut, we compute mint status from CRE report metrics.
 * In production, this would read directly from stablecoin.getMintStatus() on-chain.
 *
 * Gate logic (mirrors ConvergeStablecoin.sol):
 *   1. STALENESS: is the risk state fresh enough?
 *   2. GATE 1: BackingRatioPolicy — backing >= 10000 bps (100%)
 *   3. GATE 2: LiquidityRatioPolicy — liquidity >= 1000 bps (10%)
 *   4. GATE 3: RiskScorePolicy — riskScore <= 70
 */

import React from "react";
import { Card } from "../shared/Card";
import { StatusIndicator } from "../shared/StatusIndicator";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { CREReport } from "../../lib/api";
import { bpsToPercent } from "../../lib/formatters";

interface MintBlockStatusProps {
  report: CREReport | null;
  loading: boolean;
}

interface GateStatus {
  name: string;
  passed: boolean;
  detail: string;
}

export function MintBlockStatus({ report, loading }: MintBlockStatusProps) {
  if (loading) {
    return (
      <Card title="Minting Status">
        <div className="flex justify-center py-8">
          <LoadingSpinner label="Checking gates..." />
        </div>
      </Card>
    );
  }

  if (!report) {
    return (
      <Card title="Minting Status">
        <div className="flex items-center gap-3 py-4">
          <StatusIndicator status="stale" label="No data — run simulation first" size="md" />
        </div>
      </Card>
    );
  }

  // Evaluate gates (matching ConvergeStablecoin.sol logic)
  const gates: GateStatus[] = [
    {
      name: "Backing Ratio",
      passed: report.backingRatioBps >= 10000,
      detail: `${bpsToPercent(report.backingRatioBps)} (threshold: 100.00%)`,
    },
    {
      name: "Liquidity Ratio",
      passed: report.liquidityRatioBps >= 1000,
      detail: `${bpsToPercent(report.liquidityRatioBps)} (threshold: 10.00%)`,
    },
    {
      name: "Risk Score",
      passed: report.riskScore <= 70,
      detail: `${report.riskScore}/100 (threshold: ≤70)`,
    },
  ];

  const allPass = gates.every((g) => g.passed);
  const failedGates = gates.filter((g) => !g.passed);

  return (
    <Card title="Minting Status">
      {/* Main status */}
      <div className="flex items-center gap-3 mb-4">
        <StatusIndicator
          status={allPass ? "allowed" : "blocked"}
          size="md"
        />
      </div>

      {/* Reason for block */}
      {!allPass && (
        <div className="text-sm text-red-400 mb-3">
          Blocked by: {failedGates.map((g) => g.name).join(", ")}
        </div>
      )}

      {/* Gate details */}
      <div className="space-y-2">
        {gates.map((gate) => (
          <div
            key={gate.name}
            className={`flex items-center justify-between text-xs px-3 py-2 rounded ${
              gate.passed
                ? "bg-emerald-900/20 text-emerald-400"
                : "bg-red-900/20 text-red-400"
            }`}
          >
            <span className="flex items-center gap-2">
              <span>{gate.passed ? "✓" : "✗"}</span>
              <span>{gate.name}</span>
            </span>
            <span className="text-gray-400">{gate.detail}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
