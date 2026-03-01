/**
 * POST /api/v1/cre-report — Runs simulation + computes CRE-formatted metrics.
 *
 * This is the endpoint that CRE workflows call:
 *   CRE Workflow → httpClient.sendRequest() → POST /api/v1/cre-report
 *   → risk-engine runs ACTUS simulation
 *   → computes metrics from events (PP, MRD, IED, MD)
 *   → returns CRE-formatted JSON for on-chain encoding
 */

import { Router, Request, Response } from "express";
import { ACTUSClient } from "../api/ACTUSClient";
import { computeMetrics, formatCREReport } from "../metrics/computeMetrics";
import { isValidCREReportRequest } from "../utils/validation";
import { CREReportResponse } from "../types";

const router = Router();
const actusClient = new ACTUSClient();

// Default simulation for CRE workflow if none specified
const DEFAULT_SIMULATION = "StableCoin-BackingRatio-RedemptionPressure-30d";

router.post("/v1/cre-report", async (req: Request, res: Response) => {
  const validation = isValidCREReportRequest(req.body);
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }

  const simulationId = req.body.simulationId || DEFAULT_SIMULATION;
  const scenarioId = req.body.scenarioId || "sc_depeg_stress_scn01";

  try {
    console.log(`[cre-report] Running simulation: ${simulationId}`);

    // 1. Run the ACTUS simulation
    const simResult = await actusClient.runSimulation(simulationId);

    if (simResult.events.length === 0) {
      res.status(500).json({
        error: "Simulation returned no events",
        simulationId,
        steps: simResult.steps,
      });
      return;
    }

    // 2. Compute metrics from events
    const params = req.body.params || {};
    const metrics = computeMetrics(simResult.events, params);

    // 3. Format as CRE report
    const report = formatCREReport(metrics, scenarioId);

    // 4. Build response
    const ppEvents = simResult.events.filter(
      (e) => e.type === "PP" && Math.abs(e.payoff) > 0
    );

    const response: CREReportResponse = {
      report,
      simulation: {
        id: simulationId,
        name: simResult.simulationName,
        totalEvents: simResult.totalEvents,
        ppEvents: ppEvents.length,
        peakRedemption: metrics.peakDayRedemption,
        finalNominalValue: metrics.finalNominalValue,
      },
      computedAt: new Date().toISOString(),
    };

    console.log(
      `[cre-report] Metrics: backing=${report.backingRatioBps}bps, ` +
        `liquidity=${report.liquidityRatioBps}bps, score=${report.riskScore}`
    );

    res.json(response);
  } catch (error: any) {
    console.error(`[cre-report] Error:`, error.message);
    res.status(500).json({
      error: "CRE report generation failed",
      details: error.message,
    });
  }
});

export default router;
