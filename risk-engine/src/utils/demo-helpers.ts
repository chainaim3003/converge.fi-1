/**
 * Shared demo helpers — used by both demo.ts (browser GET) and cre-report.ts (CRE POST).
 *
 * Extracted to avoid code duplication. Both routes need:
 *   - readJson: read a JSON file from DEMO_DIR
 *   - mergePortfolio: apply overrides (adjustments, early liquidations, new contracts, tokenSupplyOverride)
 *   - computeHealthFromPortfolio: compute backing, liquidity, risk score from merged portfolio
 */

import * as fs from "fs";

// ─── Thresholds (GENIUS Act / MiCA) ───

export const THRESHOLDS = {
  backingRatioBps: 10000,  // 100%
  liquidityRatioBps: 1000, // 10%
  riskScore: 70,
};

// ─── File reader ───

export function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

// ─── Merge overrides into portfolio ───

export function mergePortfolio(portfolio: any, overrides: any): any {
  const merged = JSON.parse(JSON.stringify(portfolio));

  if (!overrides.overrideActive) return merged;

  // Override tokenSupply if specified (models circulating + new mint ask)
  if (overrides.tokenSupplyOverride !== undefined) {
    merged.metadata.tokenSupply = overrides.tokenSupplyOverride;
    console.log(`[demo-helpers] tokenSupply overridden to ${overrides.tokenSupplyOverride}`);
  }

  // Portfolio adjustments
  for (const adj of overrides.portfolioAdjustments || []) {
    const idx = merged.contracts.findIndex((c: any) => c.contractID === adj.contractID);
    if (idx === -1) continue;
    merged.contracts[idx].notionalPrincipal = adj.newNotionalPrincipal;
    merged.contracts[idx].description += ` [ADJUSTED: ${adj.reason}]`;
  }

  // Early liquidations
  for (const liq of overrides.earlyLiquidations || []) {
    const idx = merged.contracts.findIndex((c: any) => c.contractID === liq.contractID);
    if (idx === -1) continue;
    const penaltyFactor = 1 - liq.penaltyPercent / 100;
    merged.contracts[idx].maturityDate = liq.liquidationDate;
    merged.contracts[idx].notionalPrincipal =
      Math.round(merged.contracts[idx].notionalPrincipal * penaltyFactor * 100) / 100;
    merged.contracts[idx].reserveCategory = "cash";
    delete merged.contracts[idx].premiumDiscountAtIED;
  }

  // Additional contracts
  for (const contract of overrides.contracts || []) {
    merged.contracts.push(contract);
  }

  return merged;
}

// ─── Compute health metrics from merged portfolio + ACTUS result ───

export function computeHealthFromPortfolio(portfolio: any, actusResult: any[]) {
  const tokenSupply = portfolio.metadata.tokenSupply;
  let totalReserves = 0;
  let cashReserves = 0;
  let tbillReserves = 0;

  const maturityLadder: any[] = [];
  const statusDate = new Date(portfolio.metadata.statusDate);

  for (const c of portfolio.contracts) {
    const principal = c.notionalPrincipal;
    const category = c.reserveCategory || "unknown";
    const matDate = new Date(c.maturityDate);
    const daysLocked = Math.max(0, Math.round((matDate.getTime() - statusDate.getTime()) / 86400000));
    const isCash = category === "cash" || daysLocked <= 1;

    if (isCash) cashReserves += principal;
    else tbillReserves += principal;
    totalReserves += principal;

    const actusContract = actusResult.find(
      (r: any) => (r.contractId || r.contractID) === c.contractID
    );

    maturityLadder.push({
      contractID: c.contractID,
      category,
      principal,
      maturityDate: c.maturityDate,
      daysLocked: isCash ? 0 : daysLocked,
      availableNow: isCash,
      actusEvents: actusContract ? (actusContract.events || []).length : 0,
      actusStatus: actusContract ? actusContract.status : "not found",
    });
  }

  const backingRatio = totalReserves / tokenSupply;
  const liquidityRatio = totalReserves > 0 ? cashReserves / totalReserves : 0;

  const backingGap = Math.max(0, 1 - backingRatio) * 100;
  const liquidityGap = Math.max(0, 0.1 - liquidityRatio) * 100;
  const concentrationPenalty =
    tbillReserves > 0 && totalReserves > 0 && tbillReserves / totalReserves > 0.8 ? 20 : 0;
  const riskScore = Math.min(100, Math.round(backingGap * 3 + liquidityGap * 5 + concentrationPenalty));

  const backingRatioBps = Math.round(backingRatio * 10000);
  const liquidityRatioBps = Math.round(liquidityRatio * 10000);

  const backingPass = backingRatioBps >= THRESHOLDS.backingRatioBps;
  const liquidityPass = liquidityRatioBps >= THRESHOLDS.liquidityRatioBps;
  const riskPass = riskScore <= THRESHOLDS.riskScore;
  const healthy = backingPass && liquidityPass && riskPass;

  return {
    tokenSupply,
    totalReserves,
    cashReserves,
    tbillReserves,
    backingRatio: +(backingRatio * 100).toFixed(1),
    liquidityRatio: +(liquidityRatio * 100).toFixed(1),
    backingRatioBps,
    liquidityRatioBps,
    riskScore,
    backingPass,
    liquidityPass,
    riskPass,
    healthy,
    mintGate: healthy ? "OPEN" : "CLOSED",
    maturityLadder,
  };
}
