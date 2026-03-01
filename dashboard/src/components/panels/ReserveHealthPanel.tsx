/**
 * ReserveHealthPanel — Shows Backing %, Liquidity %, Risk Score as metric cards.
 *
 * Data source: CRE report metrics from /api/v1/cre-report
 * From CLAUDE.md section 9.2: "Backing %, Liquidity %, Risk Score as metric cards with 🟢🟡🔴"
 */

import React from "react";
import { Card } from "../shared/Card";
import { MetricBadge } from "../shared/MetricBadge";
import { LoadingSpinner } from "../shared/LoadingSpinner";
import { CREReport } from "../../lib/api";
import { bpsToPercent, backingLevel, liquidityLevel, riskLevel } from "../../lib/formatters";

interface ReserveHealthPanelProps {
  report: CREReport | null;
  loading: boolean;
}

export function ReserveHealthPanel({ report, loading }: ReserveHealthPanelProps) {
  if (loading) {
    return (
      <Card title="Reserve Health">
        <div className="flex justify-center py-8">
          <LoadingSpinner label="Computing metrics..." />
        </div>
      </Card>
    );
  }

  if (!report) {
    return (
      <Card title="Reserve Health">
        <p className="text-gray-500 text-sm py-4">
          No risk data available. Run a simulation to compute metrics.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Reserve Health">
      <div className="grid grid-cols-3 gap-3">
        <MetricBadge
          label="Backing Ratio"
          value={bpsToPercent(report.backingRatioBps)}
          level={backingLevel(report.backingRatioBps)}
          subtitle={`${report.backingRatioBps} bps`}
        />
        <MetricBadge
          label="Liquidity Ratio"
          value={bpsToPercent(report.liquidityRatioBps)}
          level={liquidityLevel(report.liquidityRatioBps)}
          subtitle={`${report.liquidityRatioBps} bps`}
        />
        <MetricBadge
          label="Risk Score"
          value={`${report.riskScore}/100`}
          level={riskLevel(report.riskScore)}
          subtitle={report.riskScore <= 70 ? "Within threshold" : "Above threshold (70)"}
        />
      </div>
      {report.maturityGapDays > 0 && (
        <div className="mt-3 text-xs text-amber-400">
          Maturity gap: {report.maturityGapDays} days until next T-bill covers projected redemptions
        </div>
      )}
    </Card>
  );
}
