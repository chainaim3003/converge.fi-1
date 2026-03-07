/**
 * GET  /api/demo/health-check          — Run demo portfolio against ACTUS, return health JSON
 * GET  /api/demo/health-check?phase=B  — Run with Phase B stress override
 * GET  /api/demo/health-check?phase=C  — Run with Phase C restore override
 *
 * This is READ-ONLY. No on-chain interaction. Just:
 *   1. Read base_portfolio.json + reserve_overrides.json from DEMO_DIR
 *   2. Merge overrides
 *   3. POST to ACTUS 8083/eventsBatch
 *   4. Compute health metrics
 *   5. Return JSON
 */

import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { config } from "../config";

const router = Router();

const THRESHOLDS = {
  backingRatioBps: 10000,  // 100%
  liquidityRatioBps: 1000, // 10%
  riskScore: 70,
};

// ─── Helpers ───

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function mergePortfolio(portfolio: any, overrides: any): any {
  const merged = JSON.parse(JSON.stringify(portfolio));

  if (!overrides.overrideActive) return merged;

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

function computeHealth(portfolio: any, actusResult: any[]) {
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

// ─── GET /api/demo/health-check ───

router.get("/demo/health-check", async (req: Request, res: Response) => {
  const demoDir = config.demoDir;

  if (!demoDir || !fs.existsSync(demoDir)) {
    res.status(400).json({
      error: "DEMO_DIR not configured or directory not found",
      hint: "Set DEMO_DIR in risk-engine/.env to the iter-fin-demo-1 directory path",
      currentValue: demoDir || "(empty)",
    });
    return;
  }

  const phase = (req.query.phase as string || "").toUpperCase();

  try {
    // 1. Read base portfolio
    const portfolio = readJson(path.join(demoDir, "base_portfolio.json"));

    // 2. Determine which override to use
    let overrides: any;
    if (phase === "B") {
      overrides = readJson(path.join(demoDir, "override_phaseB_stress.json"));
    } else if (phase === "C") {
      overrides = readJson(path.join(demoDir, "override_phaseC_restore.json"));
    } else {
      // Phase A or default — read the live reserve_overrides.json
      overrides = readJson(path.join(demoDir, "reserve_overrides.json"));
    }

    // 3. Merge
    const merged = mergePortfolio(portfolio, overrides);

    // 4. Build ACTUS eventsBatch request
    const actusContracts = merged.contracts.map((c: any) => ({
      contractType: c.contractType,
      contractID: c.contractID,
      contractRole: c.contractRole,
      contractDealDate: c.contractDealDate,
      initialExchangeDate: c.initialExchangeDate,
      statusDate: c.statusDate,
      maturityDate: c.maturityDate,
      notionalPrincipal: String(c.notionalPrincipal),
      nominalInterestRate: String(c.nominalInterestRate),
      currency: c.currency,
      dayCountConvention: c.dayCountConvention,
      description: c.description,
    }));

    // 5. POST to ACTUS 8083
    const actusUrl = `${config.actusSimHost}/eventsBatch`;
    const actusResponse = await axios.post(
      actusUrl,
      { contracts: actusContracts, riskFactors: [] },
      { headers: { "Content-Type": "application/json" }, timeout: 15000 }
    );

    const actusResult = actusResponse.data;
    const totalEvents = actusResult.reduce(
      (sum: number, r: any) => sum + (r.events || []).length, 0
    );

    // 6. Compute health
    const health = computeHealth(merged, actusResult);

    // 7. Build forward simulation summary
    const forwardSimulation = actusResult.map((r: any) => {
      const id = r.contractId || r.contractID;
      const events = r.events || [];
      const ied = events.find((e: any) => e.type === "IED");
      const md = events.find((e: any) => e.type === "MD");
      return {
        contractID: id,
        status: r.status,
        eventCount: events.length,
        ied: ied ? { time: ied.time, payoff: ied.payoff } : null,
        md: md ? { time: md.time, payoff: md.payoff } : null,
      };
    });

    // 8. Return
    res.json({
      phase: phase || "A",
      overrideActive: overrides.overrideActive,
      overrideDescription: overrides.description || null,
      actusServer: config.actusSimHost,
      contractCount: merged.contracts.length,
      totalACTUSEvents: totalEvents,
      health,
      forwardSimulation,
      thresholds: THRESHOLDS,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({
      error: "Demo health check failed",
      details: error.message,
      actusServer: config.actusSimHost,
    });
  }
});

export default router;
