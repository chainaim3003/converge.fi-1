/**
 * POST /api/v1/cre-report — Runs simulation + computes CRE-formatted metrics.
 *
 * V4: 8-field report with all uint16 numerics + GENIUS Act compliance checks.
 *
 * CRE Workflow → httpClient.sendRequest() → POST /api/v1/cre-report
 *   → risk-engine loads portfolio + overrides
 *   → Calls ACTUS 8083/eventsBatch for contract simulation
 *   → computeHealthFromPortfolio() produces 8 metrics
 *   → returns CRE-formatted JSON for on-chain encoding
 */

import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { config } from "../config";
import { runStimulation } from "../api/StimulationRunner";
import type { EnvironmentConfig } from "../api/StimulationRunner";
import { computeMetrics, formatCREReport } from "../metrics/computeMetrics";
import { isValidCREReportRequest } from "../utils/validation";
import { readJson, mergePortfolio, computeHealthFromPortfolio } from "../utils/demo-helpers";
import type { ACTUSEvent } from "../types";

const router = Router();

const DEFAULT_SIMULATION = "StableCoin-BackingRatio-RedemptionPressure-30d";

router.post("/v1/cre-report", async (req: Request, res: Response) => {
  const validation = isValidCREReportRequest(req.body);
  if (!validation.valid) {
    console.warn(`[cre-report] Validation failed: ${validation.error} — body: ${JSON.stringify(req.body)}`);
    res.status(400).json({ error: validation.error });
    return;
  }

  const simulationId = req.body.simulationId || DEFAULT_SIMULATION;
  const scenarioId = req.body.scenarioId || "sc_depeg_stress_scn01";

  // ── DEMO MODE: simulationId starts with "demo-" ──────────────────────
  if (simulationId.startsWith("demo-")) {
    try {
      await handleDemoReport(simulationId, scenarioId, res);
    } catch (error: any) {
      console.error(`[cre-report] Demo error:`, error.message);
      res.status(500).json({ error: "Demo report failed", details: error.message });
    }
    return;
  }

  // ── NON-DEMO: Postman collection simulation path ─────────────────────
  try {
    console.log(`[cre-report] Running simulation: ${simulationId}`);

    const filePath = path.join(config.simulationsDir, `${simulationId}.json`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: `Simulation not found: ${simulationId}` });
      return;
    }
    const collection = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    const envConfig: EnvironmentConfig = {
      riskServiceBase: config.actusRiskHost,
      actusServerBase: config.actusSimHost,
    };
    const simResult = await runStimulation(collection, envConfig, "configured");

    const rawSimulation = simResult.simulation;
    let events: ACTUSEvent[] = [];
    let contractId: string | undefined;
    let contractType: string | undefined;

    if (Array.isArray(rawSimulation) && rawSimulation.length > 0 && rawSimulation[0].events) {
      events = rawSimulation[0].events;
      contractId = rawSimulation[0].contractId;
      contractType = rawSimulation[0].contractType;
    } else if (rawSimulation && rawSimulation.events) {
      events = rawSimulation.events;
      contractId = rawSimulation.contractId;
      contractType = rawSimulation.contractType;
    }

    console.log(`[cre-report] Events extracted: ${events.length} total | contract=${contractId || 'unknown'}`);

    if (events.length === 0) {
      res.status(500).json({ error: "Simulation returned no events", simulationId });
      return;
    }

    const params = req.body.params || {};
    const metrics = computeMetrics(events, params);
    const report = formatCREReport(metrics, scenarioId);

    console.log(`[cre-report] Final report: ${JSON.stringify(report)}`);

    const ppEvents = events.filter((e) => e.type === "PP" && Math.abs(e.payoff) > 0);

    res.json({
      report,
      simulation: {
        id: simulationId,
        name: simResult.scenarioName,
        totalEvents: events.length,
        ppEvents: ppEvents.length,
        peakRedemption: metrics.peakDayRedemption,
        finalNominalValue: metrics.finalNominalValue,
        contractCount: Array.isArray(rawSimulation) ? rawSimulation.length : 1,
      },
      computedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error(`[cre-report] Error:`, error.message);
    res.status(500).json({ error: "CRE report generation failed", details: error.message });
  }
});

// ══════════════════════════════════════════════════════════════════════
// DEMO MODE HANDLER — V4 (8-field report, all uint16)
// Called when simulationId starts with "demo-" (e.g. "demo-phase-A")
// Uses base_portfolio.json + phase overrides from DEMO_DIR
// Returns the 8-field report shape that workflow.ts encodes on-chain.
// ══════════════════════════════════════════════════════════════════════

async function handleDemoReport(simulationId: string, scenarioId: string, res: Response) {
  const demoDir = config.demoDir;
  if (!demoDir || !fs.existsSync(demoDir)) {
    res.status(400).json({
      error: "DEMO_DIR not configured",
      hint: "Set DEMO_DIR in risk-engine/.env to the iter-fin-demo-2 directory path",
    });
    return;
  }

  // Extract phase from simulationId: "demo-phase-A" → "A"
  const phase = simulationId.replace("demo-phase-", "").toUpperCase();
  console.log(`[cre-report] Demo mode: simulationId=${simulationId} phase=${phase}`);

  // 1. Read base portfolio
  const portfolio = readJson(path.join(demoDir, "base_portfolio.json"));

  // 2. Select override file based on phase
  let overrides: any;
  if (phase === "B") {
    overrides = readJson(path.join(demoDir, "override_phaseB_stress.json"));
  } else if (phase === "C") {
    overrides = readJson(path.join(demoDir, "override_phaseC_restore.json"));
  } else {
    overrides = { overrideActive: false, portfolioAdjustments: [], contracts: [], earlyLiquidations: [] };
  }

  // 3. Merge (handles tokenSupplyOverride, adjustments, liquidations, new contracts)
  const merged = mergePortfolio(portfolio, overrides);

  // 4. Build ACTUS eventsBatch request
  const actusContracts = merged.contracts
    .filter((c: any) => c.notionalPrincipal > 0) // skip zeroed-out contracts
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

  // 5. POST to ACTUS 8083/eventsBatch
  const actusUrl = `${config.actusSimHost}/eventsBatch`;
  console.log(`[cre-report] Demo: POST ${actusUrl} | ${actusContracts.length} contracts`);

  const actusResponse = await axios.post(
    actusUrl,
    { contracts: actusContracts, riskFactors: [] },
    { headers: { "Content-Type": "application/json" }, timeout: 15000 }
  );
  const actusResult = actusResponse.data;
  const totalEvents = actusResult.reduce(
    (sum: number, r: any) => sum + (r.events || []).length, 0
  );

  // 6. Compute all 8 health metrics from merged portfolio
  const health = computeHealthFromPortfolio(merged, actusResult);

  // 7. Build 8-field CRE report — exact shape workflow.ts expects
  const report = {
    backingPct: Math.min(9999, health.backingPct),
    liquidityPct: health.liquidityPct,
    riskScore: health.riskScore,
    maturityGapDays: health.wamDays,
    timestamp: Math.floor(Date.now() / 1000),
    scenarioId,
    assetEligibilityPct: health.assetEligibilityPct,
    custodianDiversityScore: health.custodianDiversityScore,
  };

  console.log(`[cre-report] Demo report: ${JSON.stringify(report)}`);
  console.log(
    `[cre-report] Demo health: backing=${report.backingPct}% liquidity=${report.liquidityPct}% ` +
    `score=${report.riskScore} eligibility=${report.assetEligibilityPct}% ` +
    `custodian=${report.custodianDiversityScore} mintGate=${health.mintGate}`
  );

  const response = {
    report,
    simulation: {
      id: simulationId,
      name: `Demo Phase ${phase}`,
      totalEvents,
      ppEvents: 0,
      peakRedemption: 0,
      finalNominalValue: health.totalReserves,
      contractCount: merged.contracts.filter((c: any) => c.notionalPrincipal > 0).length,
    },
    computedAt: new Date().toISOString(),
  };

  res.json(response);
}

export default router;
