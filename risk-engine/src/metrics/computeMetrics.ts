/**
 * computeMetrics — Converts ACTUS simulation events → CRE report metrics.
 *
 * v2 additions:
 *   - computeConcentrationHHI: Herfindahl-Hirschman Index from multi-contract event groups
 *   - computeAssetQualityScore: weighted reserve quality from contractId patterns + IED notionals
 *   - computeMetrics now accepts ContractGroup[] for multi-contract simulations
 *
 * Event types:
 *   PP  = behavioral model redemption outputs
 *   MRD = behavioral model risk metric outputs
 *   IED = initial exchange date (carries initial notional)
 *   MD  = maturity date — contract end
 *   IP  = interest payment
 */

import { ACTUSEvent, ComputedMetrics, CREReport, ContractGroup } from "../types";

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
 *
 * @param events     Flattened events from all contracts (PP events drive redemption metrics)
 * @param params     Optional override for initial simulation parameters
 * @param contractGroups  Optional: full per-contract event groups for HHI + quality computation.
 *                        When provided (multi-contract simulation), concentrationHHI and
 *                        assetQualityScore are computed from actual contract notionals and IDs.
 *                        When absent (single-contract), safe defaults are used.
 */
export function computeMetrics(
  events: ACTUSEvent[],
  params: Partial<SimulationParams> = {},
  contractGroups: ContractGroup[] = []
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

  // Reserves decrease proportionally (simplified: reserves lose same amount as redemptions)
  const totalReserves = Math.max(0, p.initialReserves - redemptionTotal);

  // Cash decreases by redemptions first (cash is used for payouts)
  const cashReserves = Math.max(0, p.initialCash - redemptionTotal);

  // Compute basis points
  const backingRatioBps = Math.round((totalReserves / totalSupply) * 10000);
  const liquidityRatioBps = Math.round((cashReserves / totalSupply) * 10000);

  // Compute composite risk score (0-100)
  const riskScore = computeRiskScore(backingRatioBps, liquidityRatioBps, peakDayRedemption, p);

  // v2: Concentration HHI and Asset Quality from contractGroups
  const concentrationHHI = contractGroups.length > 0
    ? computeConcentrationHHI(contractGroups)
    : 0;

  const assetQualityScore = contractGroups.length > 0
    ? computeAssetQualityScore(contractGroups)
    : 75; // neutral default when no contract detail available

  return {
    backingRatioBps: clamp(backingRatioBps, 0, 30000),
    liquidityRatioBps: clamp(liquidityRatioBps, 0, 10000),
    riskScore: clamp(riskScore, 0, 100),
    maturityGapDays: computeMaturityGapDays(contractGroups),
    concentrationHHI: clamp(concentrationHHI, 0, 10000),
    assetQualityScore: clamp(assetQualityScore, 0, 100),

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
 * v2: includes concentrationHHI and assetQualityScore.
 */
export function formatCREReport(metrics: ComputedMetrics, scenarioId: string): CREReport {
  return {
    backingRatioBps: metrics.backingRatioBps,
    liquidityRatioBps: metrics.liquidityRatioBps,
    riskScore: metrics.riskScore,
    maturityGapDays: metrics.maturityGapDays,
    timestamp: Math.floor(Date.now() / 1000),
    scenarioId,
    concentrationHHI: metrics.concentrationHHI,
    assetQualityScore: metrics.assetQualityScore,
  };
}

// ═══════════════════════════════════════════════════════════════
// v2: CONCENTRATION HHI (Herfindahl-Hirschman Index)
// ═══════════════════════════════════════════════════════════════

/**
 * Compute Herfindahl-Hirschman Index from multi-contract simulation.
 *
 * HHI = sum of (share_i)^2, scaled to 0-10000.
 *   10000 = monopoly (single asset = 100% of reserves)
 *   ~2500 = moderate concentration (4 equal assets)
 *   1000  = low concentration (10 equal assets)
 *
 * Asset contracts are identified by positive IED nominalValue.
 * Liability contracts (negative IED) are excluded.
 */
export function computeConcentrationHHI(contractGroups: ContractGroup[]): number {
  // Get initial notional from IED event for each contract
  const notionals: number[] = [];

  for (const group of contractGroups) {
    const iedEvent = group.events.find((e) => e.type === "IED");
    if (!iedEvent) continue;

    const notional = iedEvent.nominalValue;

    // Skip liability contracts (negative notional in ACTUS PAM IED)
    // Also skip if contractId suggests it's a liability
    const id = group.contractId.toLowerCase();
    if (
      notional < 0 ||
      id.includes("liab") ||
      id.includes("stablecoin") ||
      id.includes("liability")
    ) {
      continue;
    }

    if (notional > 0) {
      notionals.push(Math.abs(notional));
    }
  }

  if (notionals.length === 0) return 0;

  const total = notionals.reduce((sum, n) => sum + n, 0);
  if (total === 0) return 0;

  // HHI = sum of (share_i)^2, scaled to 0-10000
  const hhi = notionals.reduce((sum, n) => {
    const share = n / total;
    return sum + share * share;
  }, 0) * 10000;

  return Math.round(hhi);
}

// ═══════════════════════════════════════════════════════════════
// v2: ASSET QUALITY SCORE
// ═══════════════════════════════════════════════════════════════

/**
 * Compute weighted asset quality score (0-100) from contractId patterns and IED notionals.
 *
 * Quality tiers (matching CLAUDE.md section 14 criteria):
 *   cash / usdc / usdt       → 100 (instantly liquid, risk-free)
 *   tbill / treasury / govt  → 95  (near-riskfree, highly liquid)
 *   bond / corp              → 70  (investment grade, less liquid)
 *   other / unknown assets   → 60  (unclassified)
 *   liab / stablecoin        → skip (not an asset)
 */
export function computeAssetQualityScore(contractGroups: ContractGroup[]): number {
  const scored: Array<{ notional: number; score: number }> = [];

  for (const group of contractGroups) {
    const iedEvent = group.events.find((e) => e.type === "IED");
    if (!iedEvent) continue;

    const notional = Math.abs(iedEvent.nominalValue);
    if (notional === 0) continue;

    const id = group.contractId.toLowerCase();

    // Skip liabilities
    if (
      iedEvent.nominalValue < 0 ||
      id.includes("liab") ||
      id.includes("stablecoin") ||
      id.includes("liability")
    ) {
      continue;
    }

    // Determine quality score from contractId pattern
    let score: number;
    if (id.includes("cash") || id.includes("usdc") || id.includes("usdt")) {
      score = 100;
    } else if (
      id.includes("tbill") ||
      id.includes("treasury") ||
      id.includes("govt") ||
      id.includes("treas")
    ) {
      score = 95;
    } else if (
      id.includes("corp") ||
      id.includes("bond") ||
      id.includes("note")
    ) {
      score = 70;
    } else {
      score = 60; // unclassified asset
    }

    scored.push({ notional, score });
  }

  if (scored.length === 0) return 75; // neutral default

  const totalNotional = scored.reduce((sum, c) => sum + c.notional, 0);
  if (totalNotional === 0) return 75;

  const weightedScore = scored.reduce(
    (sum, c) => sum + (c.score * c.notional) / totalNotional,
    0
  );

  return Math.round(weightedScore);
}

// ═══════════════════════════════════════════════════════════════
// MATURITY GAP (days until nearest T-bill maturity)
// ═══════════════════════════════════════════════════════════════

/**
 * Compute days until the nearest asset contract maturity (MD event).
 * For treasury-backed stablecoins, this is the maturity ladder metric.
 * Returns 0 if no maturity events found (non-treasury simulation).
 */
function computeMaturityGapDays(contractGroups: ContractGroup[]): number {
  if (contractGroups.length === 0) return 0;

  const now = Date.now();
  let nearestMaturityMs = Infinity;

  for (const group of contractGroups) {
    const id = group.contractId.toLowerCase();
    // Only look at asset contracts (skip liabilities)
    if (id.includes("liab") || id.includes("stablecoin") || id.includes("liability")) {
      continue;
    }

    for (const event of group.events) {
      if (event.type === "MD") {
        const maturityMs = new Date(event.time).getTime();
        if (maturityMs > now && maturityMs < nearestMaturityMs) {
          nearestMaturityMs = maturityMs;
        }
      }
    }
  }

  if (nearestMaturityMs === Infinity) return 0;

  const daysRemaining = Math.ceil((nearestMaturityMs - now) / (1000 * 60 * 60 * 24));
  return Math.max(0, daysRemaining);
}

// ═══════════════════════════════════════════════════════════════
// COMPOSITE RISK SCORE
// ═══════════════════════════════════════════════════════════════

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
  const backingRisk =
    backingBps >= 12000 ? 0 : Math.min(100, ((12000 - backingBps) / 4000) * 100);

  // Liquidity risk: 0 at 35%+, 100 at 0%
  const liquidityRisk =
    liquidityBps >= 3500 ? 0 : Math.min(100, ((3500 - liquidityBps) / 3500) * 100);

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

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

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
