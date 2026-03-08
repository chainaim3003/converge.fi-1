/**
 * GET  /api/demo/health-check          — Run demo portfolio against ACTUS, return health JSON
 * GET  /api/demo/health-check?phase=B  — Run with Phase B stress override
 * GET  /api/demo/health-check?phase=C  — Run with Phase C restore override
 *
 * V4: Returns 8-field health metrics (all uint16 scale) + GENIUS Act compliance.
 * Uses shared helpers from utils/demo-helpers.ts (same logic as cre-report.ts demo branch).
 */

import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { config } from "../config";
import { readJson, mergePortfolio, computeHealthFromPortfolio, THRESHOLDS } from "../utils/demo-helpers";

const router = Router();

router.get("/demo/health-check", async (req: Request, res: Response) => {
  const demoDir = config.demoDir;

  if (!demoDir || !fs.existsSync(demoDir)) {
    res.status(400).json({
      error: "DEMO_DIR not configured or directory not found",
      hint: "Set DEMO_DIR in risk-engine/.env to the iter-fin-demo-2 directory path",
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
      overrides = { overrideActive: false, portfolioAdjustments: [], contracts: [], earlyLiquidations: [] };
    }

    // 3. Merge
    const merged = mergePortfolio(portfolio, overrides);

    // 4. Build ACTUS eventsBatch request (skip zeroed-out contracts)
    const actusContracts = merged.contracts
      .filter((c: any) => c.notionalPrincipal > 0)
      .map((c: any) => ({
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

    // 6. Compute all 8 health metrics
    const health = computeHealthFromPortfolio(merged, actusResult);

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
      overrideActive: overrides.overrideActive || false,
      overrideDescription: overrides.description || null,
      actusServer: config.actusSimHost,
      contractCount: actusContracts.length,
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
