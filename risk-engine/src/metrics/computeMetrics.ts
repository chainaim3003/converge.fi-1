/**
 * computeMetrics — Converts ACTUS simulation events → CRE report metrics.
 *
 * From CLAUDE.md section 7.3:
 *   Input: ACTUS simulation returns events (verified 63 for BackingRatio sim)
 *   Filter PP events with non-zero payoff (redemptions)
 *   Compute:
 *     backingRatioBps = (totalReserves / totalSupply) * 10000
 *     liquidityRatioBps = (cashReserves / totalSupply) * 10000
 *     riskScore = weighted composite (0-100)
 *     maturityGapDays = days until next T-bill maturity (treasury sim only)
 *
 * Event types:
 *   PP  = behavioral model redemption outputs
 *   MRD = behavioral model risk metric outputs
 *   IED = initial exchange date
 *   MD  = maturity date
 *   IP  = interest payment
 */

import { ACTUSEvent, ComputedMetrics, CREReport } from "../types";

/** Initial parameters for a stablecoin simulation */
interface SimulationParams {
  initialNotional: number;       // e.g. 100_000_000 ($100M)
  initialReserves: number;       // e.g. 102_000_000 ($102M)
  initialCash: number;           // e.g. 40_800_000 ($40.8M)
  scenarioId: string;            // e.g. "sc_depeg_stress_scn01"
}

/** Default params based on the verified simulation (CLAUDE.md section 5.3) */
const DEFAULT_PARAMS: SimulationParams = {
  initialNotional: 100_000_000,
  initialReserves: 102_000_000,
  initialCash: 40_800_000,
  scenarioId: "sc_depeg_stress_scn01",
};

/**
 * Compute all risk metrics from an ACTUS event stream.
 */
export function computeMetrics(
  events: ACTUSEvent[],
  params: Partial<SimulationParams> = {}
): ComputedMetrics {
  const p = { ...DEFAULT_PARAMS, ...params };

  // Extract PP events with non-zero payoff (these are redemptions)
  const ppEvents = events.filter((e) => e.type === "PP" && Math.abs(e.payoff) > 0);

  // Total redemption volume
  const redemptionTotal = ppEvents.reduce((sum, e) => sum + Math.abs(e.payoff), 0);

  // Peak single-day redemption
  const dailyRedemptions = groupByDay(ppEvents);
  const peakDayRedemption = Math.max(
    0,
    ...Object.values(dailyRedemptions).map((dayEvents) =>
      dayEvents.reduce((sum, e) => sum + Math.abs(e.payoff), 0)
    )
  );

  // Final nominal value from the last event (MD or last PP)
  const lastEvent = events[events.length - 1];
  const finalNominalValue = lastEvent?.nominalValue ?? p.initialNotional;

  // Current supply = initial - total redeemed
  const totalSupply = Math.max(1, p.initialNotional - redemptionTotal);

  // Reserves decrease proportionally but less (reserves > supply for backed coins)
  // Simplified model: reserves lose the same amount as redemptions
  const totalReserves = Math.max(0, p.initialReserves - redemptionTotal);

  // Cash decreases by redemptions first (cash is used for payouts)
  const cashReserves = Math.max(0, p.initialCash - redemptionTotal);

  // Compute basis points
  const backingRatioBps = Math.round((totalReserves / totalSupply) * 10000);
  const liquidityRatioBps = Math.round((cashReserves / totalSupply) * 10000);

  // Compute composite risk score (0-100)
  const riskScore = computeRiskScore(backingRatioBps, liquidityRatioBps, peakDayRedemption, p);

  return {
    backingRatioBps: clamp(backingRatioBps, 0, 30000),
    liquidityRatioBps: clamp(liquidityRatioBps, 0, 10000),
    riskScore: clamp(riskScore, 0, 100),
    maturityGapDays: 0, // Only set for treasury simulations

    totalReserves,
    totalSupply,
    cashReserves,
    redemptionTotal,
    peakDayRedemption,
    finalNominalValue,
    ppEventCount: ppEvents.length,
  };
}

/**
 * Format computed metrics as a CRE report ready for on-chain encoding.
 */
export function formatCREReport(metrics: ComputedMetrics, scenarioId: string): CREReport {
  return {
    backingRatioBps: metrics.backingRatioBps,
    liquidityRatioBps: metrics.liquidityRatioBps,
    riskScore: metrics.riskScore,
    maturityGapDays: metrics.maturityGapDays,
    timestamp: Math.floor(Date.now() / 1000),
    scenarioId,
  };
}

/**
 * Compute weighted composite risk score (0-100).
 *
 * Factors:
 *   - Backing risk: how far below 100% (weight: 30%)
 *   - Liquidity risk: how far below 35% cash threshold (weight: 30%)
 *   - Redemption velocity: peak day as % of total supply (weight: 25%)
 *   - Concentration: total redeemed as % of initial supply (weight: 15%)
 */
function computeRiskScore(
  backingBps: number,
  liquidityBps: number,
  peakDayRedemption: number,
  params: SimulationParams
): number {
  // Backing risk: 0 at 120%+, 100 at 80% or below
  const backingRisk = backingBps >= 12000 ? 0 : Math.min(100, ((12000 - backingBps) / 4000) * 100);

  // Liquidity risk: 0 at 35%+, 100 at 0%
  const liquidityRisk = liquidityBps >= 3500 ? 0 : Math.min(100, ((3500 - liquidityBps) / 3500) * 100);

  // Redemption velocity risk: peak day as % of supply
  const velocityRatio = peakDayRedemption / params.initialNotional;
  const velocityRisk = Math.min(100, velocityRatio * 1000); // 10% of supply in a day = score 100

  // Concentration risk: total redeemed as % of initial
  const totalRedeemed = params.initialNotional - (params.initialNotional * backingBps) / 12000;
  const concentrationRisk = Math.min(100, (totalRedeemed / params.initialNotional) * 200);

  // Weighted composite
  const score =
    backingRisk * 0.3 +
    liquidityRisk * 0.3 +
    velocityRisk * 0.25 +
    concentrationRisk * 0.15;

  return Math.round(score);
}

/**
 * Group events by calendar day for daily aggregation.
 */
function groupByDay(events: ACTUSEvent[]): Record<string, ACTUSEvent[]> {
  const groups: Record<string, ACTUSEvent[]> = {};
  for (const event of events) {
    const day = event.time.substring(0, 10); // "YYYY-MM-DD"
    if (!groups[day]) groups[day] = [];
    groups[day].push(event);
  }
  return groups;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
