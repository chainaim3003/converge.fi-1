/**
 * MaturityLadderView — T-bill maturities + cash visualization.
 *
 * From CLAUDE.md section 9.1: "MATURITY LADDER VIEW (new) — [T-bill maturities + cash]"
 * From CLAUDE.md section 5.4 (Treasury-Backed Simulation):
 *   4 T-bills in ladder ($25M each, staggered maturities)
 *   + cash buffer
 *   Demonstrates: system can be 103% BACKED but 1.1% LIQUID (maturity mismatch)
 *
 * In this first cut, we display the maturity ladder from known configuration.
 * In production, this would read from treasury simulation results.
 */

import React from "react";
import { Card } from "../shared/Card";
import { CREReport } from "../../lib/api";
import { formatUSDShort } from "../../lib/formatters";

interface MaturityLadderViewProps {
  report: CREReport | null;
}

/** T-bill maturity ladder from CLAUDE.md section 5.4 */
const TREASURY_LADDER = [
  { id: "TBill-A-30d", notional: 25_000_000, maturity: "2026-03-15", label: "Mar 15" },
  { id: "TBill-B-30d", notional: 25_000_000, maturity: "2026-03-30", label: "Mar 30" },
  { id: "TBill-C-30d", notional: 25_000_000, maturity: "2026-04-15", label: "Apr 15" },
  { id: "TBill-D-30d", notional: 25_000_000, maturity: "2026-04-30", label: "Apr 30" },
];

const TOTAL_TBILLS = TREASURY_LADDER.reduce((sum, t) => sum + t.notional, 0);

export function MaturityLadderView({ report }: MaturityLadderViewProps) {
  // Estimate cash from liquidity ratio if we have a report
  const estimatedCash = report
    ? (report.liquidityRatioBps / 10000) * 100_000_000 // liquidity% of $100M supply
    : null;

  const totalReserves = estimatedCash !== null ? TOTAL_TBILLS + estimatedCash : null;

  return (
    <Card title="Maturity Ladder — Treasury Reserve Structure">
      <div className="space-y-4">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="text-xs text-gray-400">T-Bill Holdings</div>
            <div className="text-lg font-bold text-converge-400">{formatUSDShort(TOTAL_TBILLS)}</div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="text-xs text-gray-400">Cash Buffer</div>
            <div className="text-lg font-bold text-emerald-400">
              {estimatedCash !== null ? formatUSDShort(estimatedCash) : "—"}
            </div>
          </div>
          <div className="bg-gray-800/50 rounded-lg p-3">
            <div className="text-xs text-gray-400">Total Reserves</div>
            <div className="text-lg font-bold text-gray-200">
              {totalReserves !== null ? formatUSDShort(totalReserves) : "—"}
            </div>
          </div>
        </div>

        {/* Maturity ladder bars */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
            <span>T-Bill Maturity Schedule</span>
            <span>$25M each</span>
          </div>
          {TREASURY_LADDER.map((tbill) => {
            const matDate = new Date(tbill.maturity);
            const now = new Date();
            const daysUntil = Math.max(0, Math.ceil((matDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
            const isMatured = daysUntil === 0;

            return (
              <div key={tbill.id} className="flex items-center gap-3">
                <div className="w-16 text-xs text-gray-400 text-right">{tbill.label}</div>
                <div className="flex-1 bg-gray-800 rounded-full h-6 relative overflow-hidden">
                  <div
                    className={`h-full rounded-full flex items-center px-2 text-xs font-medium ${
                      isMatured
                        ? "bg-emerald-600/60 text-emerald-200"
                        : daysUntil <= 7
                        ? "bg-amber-600/60 text-amber-200"
                        : "bg-converge-600/60 text-converge-200"
                    }`}
                    style={{ width: `${Math.max(30, (1 - daysUntil / 60) * 100)}%` }}
                  >
                    {formatUSDShort(tbill.notional)}
                  </div>
                </div>
                <div className="w-20 text-xs text-gray-500 text-right">
                  {isMatured ? (
                    <span className="text-emerald-400">Matured</span>
                  ) : (
                    `${daysUntil}d left`
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Maturity gap warning */}
        {report && report.maturityGapDays > 0 && (
          <div className="bg-amber-900/20 border border-amber-800/50 rounded-md px-3 py-2 text-xs text-amber-400">
            ⚠ Maturity gap: {report.maturityGapDays} days until next T-bill covers projected
            redemptions. System may be solvent but illiquid.
          </div>
        )}

        {/* Educational note */}
        <p className="text-[10px] text-gray-600">
          Treasury-backed stablecoins face maturity mismatch risk: reserves may be 103% backed
          (solvent) while only 1.1% liquid (unable to pay immediate redemptions). The maturity
          ladder staggering mitigates this by ensuring regular cash injections.
        </p>
      </div>
    </Card>
  );
}
