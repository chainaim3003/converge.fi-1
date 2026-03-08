/**
 * Shared demo helpers — used by both demo.ts (browser GET) and cre-report.ts (CRE POST).
 *
 * V4 changes:
 *   - Integer % (×100) instead of bps (×10000)
 *   - 8 metrics: backingPct, liquidityPct, riskScore, wamDays, assetEligibilityPct, custodianDiversityScore
 *   - 6-factor risk score with regulatory-grounded thresholds
 *   - WAM (weighted average maturity) replaces "nearest maturity"
 *   - Asset eligibility check per GENIUS Act §4(a)(1)(A)
 *   - Custodian diversity via Herfindahl-Hirschman Index (SVB lesson)
 *
 * Merge order (critical for correctness):
 *   1. portfolioAdjustments — modify existing base contracts (e.g. drain cash)
 *   2. contracts — add new contracts (e.g. corp bond that was purchased, emergency injection)
 *   3. earlyLiquidations — sell/convert contracts added in step 2 (e.g. sell the corp bond)
 *   This order allows Phase C to add the corp bond from Phase B AND then liquidate it,
 *   all starting independently from base_portfolio.json.
 *
 * Regulatory sources:
 *   GENIUS Act §4(a)(1): https://www.congress.gov/bill/119th-congress/senate-bill/1582/text
 *   MiCA Art.54: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32023R1114
 *   OCC Proposed Rule (Feb 2026): https://blog.freshfields.us/post/102mln8/occ-proposes-framework-for-stablecoins
 */

import * as fs from "fs";

// ─── GENIUS Act permitted reserve categories ───
// GENIUS Act §4(a)(1)(A): "reserves may only consist of"
const PERMITTED_CATEGORIES = new Set([
  "cash",       // (i) US currency, Federal Reserve notes; (ii) demand deposits at FDIC-insured institutions
  "tbill",      // (iii) Treasury bills/notes/bonds with remaining maturity ≤93 days
  "repo",       // (iv) Repurchase agreements (overnight, Treasury-backed)
  "reverse-repo", // (v) Reverse repurchase agreements
  "mmf",        // (vi) Government money market funds invested in above
]);

// ─── Thresholds (GENIUS Act / MiCA) ───

export const THRESHOLDS = {
  backingPct: 100,        // GENIUS Act §4(a)(1): 1:1 reserve backing
  liquidityPct: 30,       // MiCA Art.54: at least 30% in bank deposits
  riskScore: 70,          // Composite ceiling
  assetEligibilityPct: 100, // GENIUS Act: "may only consist of" = zero tolerance
};

// ─── File reader ───

export function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// ─── Merge overrides into portfolio ───
//
// Order matters:
//   1. portfolioAdjustments — modify existing base contracts
//   2. contracts — add new contracts to the portfolio
//   3. earlyLiquidations — sell/convert contracts (including ones just added in step 2)
//
// This allows Phase C to add a corp bond (representing what Phase B bought)
// AND then liquidate it in the same override — each phase is self-contained
// and independently runnable from base_portfolio.json.

export function mergePortfolio(portfolio: any, overrides: any): any {
  const merged = JSON.parse(JSON.stringify(portfolio));

  if (!overrides.overrideActive) return merged;

  // Override tokenSupply if specified
  if (overrides.tokenSupplyOverride !== undefined) {
    merged.metadata.tokenSupply = overrides.tokenSupplyOverride;
    console.log(`[demo-helpers] tokenSupply overridden to ${overrides.tokenSupplyOverride}`);
  }

  // Step 1: Portfolio adjustments (modify existing base contracts)
  for (const adj of overrides.portfolioAdjustments || []) {
    const idx = merged.contracts.findIndex((c: any) => c.contractID === adj.contractID);
    if (idx === -1) {
      console.warn(`[demo-helpers] portfolioAdjustment: contractID ${adj.contractID} not found in base — skipping`);
      continue;
    }
    merged.contracts[idx].notionalPrincipal = adj.newNotionalPrincipal;
    merged.contracts[idx].description += ` [ADJUSTED: ${adj.reason}]`;
  }

  // Step 2: Additional contracts (add new contracts — before earlyLiquidations)
  for (const contract of overrides.contracts || []) {
    merged.contracts.push(contract);
  }

  // Step 3: Early liquidations (sell/convert — can target contracts added in step 2)
  for (const liq of overrides.earlyLiquidations || []) {
    const idx = merged.contracts.findIndex((c: any) => c.contractID === liq.contractID);
    if (idx === -1) {
      console.warn(`[demo-helpers] earlyLiquidation: contractID ${liq.contractID} not found — skipping`);
      continue;
    }
    const penaltyFactor = 1 - liq.penaltyPercent / 100;
    const originalPrincipal = merged.contracts[idx].notionalPrincipal;
    const recoveredCash = Math.round(originalPrincipal * penaltyFactor * 100) / 100;

    console.log(`[demo-helpers] earlyLiquidation: ${liq.contractID} $${originalPrincipal} → $${recoveredCash} (${liq.penaltyPercent}% penalty)`);

    merged.contracts[idx].maturityDate = liq.liquidationDate;
    merged.contracts[idx].notionalPrincipal = recoveredCash;
    merged.contracts[idx].reserveCategory = "cash";
    merged.contracts[idx].custodian = liq.custodian || merged.contracts[idx].custodian || "liquidation-proceeds";
    delete merged.contracts[idx].premiumDiscountAtIED;
  }

  return merged;
}

// ─── 6-Factor Risk Score ───

function computeRiskScore(
  backingPct: number,
  liquidityPct: number,
  tbillPct: number,
  wamDays: number,
  assetEligibilityPct: number,
  custodianDiversityScore: number
): number {
  // Factor 1: Backing risk (15%) — 0 at ≥200%, 100 at ≤80%
  const backingRisk = backingPct >= 200 ? 0
    : backingPct <= 80 ? 100
    : Math.round((200 - backingPct) / 120 * 100);

  // Factor 2: Liquidity risk (25%) — 0 at ≥50%, 100 at 0%
  const liquidityRisk = liquidityPct >= 50 ? 0
    : Math.round((50 - liquidityPct) / 50 * 100);

  // Factor 3: Concentration risk (15%) — 0 at ≤31%, 100 at 100%
  const concentrationRisk = tbillPct <= 31 ? 0
    : Math.round((tbillPct - 31) / 69 * 100);

  // Factor 4: Maturity risk (15%) — 0 at ≤30d, 100 at ≥180d
  const maturityRisk = wamDays <= 30 ? 0
    : wamDays >= 180 ? 100
    : Math.round((wamDays - 30) / 150 * 100);

  // Factor 5: Asset eligibility risk (15%) — 0 at 100%, 100 at ≤70%
  const eligibilityRisk = assetEligibilityPct >= 100 ? 0
    : assetEligibilityPct <= 70 ? 100
    : Math.round((100 - assetEligibilityPct) / 30 * 100);

  // Factor 6: Custodial concentration risk (15%) — 0 at score≥80, 100 at 0
  const custodialRisk = custodianDiversityScore >= 80 ? 0
    : Math.round((80 - custodianDiversityScore) / 80 * 100);

  return Math.min(100, Math.round(
    backingRisk       * 0.15 +
    liquidityRisk     * 0.25 +
    concentrationRisk * 0.15 +
    maturityRisk      * 0.15 +
    eligibilityRisk   * 0.15 +
    custodialRisk     * 0.15
  ));
}

// ─── Compute health metrics from merged portfolio + ACTUS result ───

export function computeHealthFromPortfolio(portfolio: any, actusResult: any[]) {
  const tokenSupply = portfolio.metadata.tokenSupply;
  const statusDate = new Date(portfolio.metadata.statusDate);

  let totalReserves = 0;
  let cashReserves = 0;
  let tbillReserves = 0;
  let eligibleReserves = 0;
  let ineligibleReserves = 0;

  // For WAM computation
  let lockedPrincipalDays = 0;
  let lockedPrincipalTotal = 0;

  // For custodian diversity
  const custodianBalances: Record<string, number> = {};

  const maturityLadder: any[] = [];

  for (const c of portfolio.contracts) {
    const principal = c.notionalPrincipal;
    if (principal <= 0) continue; // skip zeroed-out contracts

    const category = c.reserveCategory || "unknown";
    const matDate = new Date(c.maturityDate);
    const daysToMaturity = Math.max(0, Math.round((matDate.getTime() - statusDate.getTime()) / 86400000));
    const isCash = category === "cash" || daysToMaturity <= 1;

    // Reserve categorization
    // Only actual T-bills/repos/mmf count as tbillReserves for concentration metric.
    // Corp bonds and other non-permitted categories count in totalReserves but NOT tbillReserves.
    if (isCash) {
      cashReserves += principal;
      const custodian = c.custodian || c.contractID;
      custodianBalances[custodian] = (custodianBalances[custodian] || 0) + principal;
    } else if (category === "tbill" || category === "repo" || category === "reverse-repo" || category === "mmf") {
      tbillReserves += principal;
    }

    totalReserves += principal;

    // WAM: ALL locked (non-cash) assets contribute
    if (!isCash) {
      lockedPrincipalDays += principal * daysToMaturity;
      lockedPrincipalTotal += principal;
    }

    // Asset eligibility check per GENIUS Act
    let isEligible = false;
    if (PERMITTED_CATEGORIES.has(category)) {
      if (category === "tbill") {
        isEligible = daysToMaturity <= 93;
      } else {
        isEligible = true;
      }
    }

    if (isEligible) {
      eligibleReserves += principal;
    } else {
      ineligibleReserves += principal;
    }

    const actusContract = actusResult.find(
      (r: any) => (r.contractId || r.contractID) === c.contractID
    );

    maturityLadder.push({
      contractID: c.contractID,
      category,
      principal,
      maturityDate: c.maturityDate,
      daysToMaturity: isCash ? 0 : daysToMaturity,
      availableNow: isCash,
      isGeniusEligible: isEligible,
      custodian: c.custodian || null,
      actusEvents: actusContract ? (actusContract.events || []).length : 0,
      actusStatus: actusContract ? actusContract.status : "not found",
    });
  }

  // ─── Compute metrics ───

  const backingPct = totalReserves > 0 ? Math.round(totalReserves / tokenSupply * 100) : 0;
  const liquidityPct = totalReserves > 0 ? Math.round(cashReserves / totalReserves * 100) : 0;
  const tbillPct = totalReserves > 0 ? Math.round(tbillReserves / totalReserves * 100) : 0;

  const wamDays = lockedPrincipalTotal > 0
    ? Math.round(lockedPrincipalDays / lockedPrincipalTotal)
    : 0;

  const assetEligibilityPct = totalReserves > 0
    ? Math.round(eligibleReserves / totalReserves * 100)
    : 0;

  const custodians = Object.keys(custodianBalances);
  let custodianHHI = 0;
  if (cashReserves > 0 && custodians.length > 0) {
    for (const cust of custodians) {
      const share = custodianBalances[cust] / cashReserves;
      custodianHHI += share * share;
    }
  } else {
    custodianHHI = 1.0;
  }
  const custodianDiversityScore = Math.round((1 - custodianHHI) * 100);

  const riskScore = computeRiskScore(
    backingPct, liquidityPct, tbillPct, wamDays,
    assetEligibilityPct, custodianDiversityScore
  );

  const backingPass = backingPct >= THRESHOLDS.backingPct;
  const liquidityPass = liquidityPct >= THRESHOLDS.liquidityPct;
  const riskPass = riskScore <= THRESHOLDS.riskScore;
  const eligibilityPass = assetEligibilityPct >= THRESHOLDS.assetEligibilityPct;
  const healthy = backingPass && liquidityPass && riskPass && eligibilityPass;

  return {
    tokenSupply,
    totalReserves,
    cashReserves,
    tbillReserves,
    ineligibleReserves,
    backingPct,
    liquidityPct,
    riskScore,
    wamDays,
    tbillPct,
    assetEligibilityPct,
    custodianDiversityScore,
    backingPass,
    liquidityPass,
    riskPass,
    eligibilityPass,
    healthy,
    mintGate: healthy ? "OPEN" : "CLOSED",
    maturityLadder,
  };
}
