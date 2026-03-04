/**
 * POST /api/v1/cre-report — Runs simulation + computes CRE-formatted metrics.
 *
 * This is the endpoint that CRE workflows call:
 *   CRE Workflow → httpClient.sendRequest() → POST /api/v1/cre-report
 *   → risk-engine loads Postman collection
 *   → StimulationRunner executes steps against ACTUS 8082/8083
 *   → computeMetrics extracts CRE metrics from events
 *   → returns CRE-formatted JSON for on-chain encoding
 */

import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import { runStimulation } from "../api/StimulationRunner";
import type { EnvironmentConfig } from "../api/StimulationRunner";
import { computeMetrics, formatCREReport } from "../metrics/computeMetrics";
import { isValidCREReportRequest } from "../utils/validation";
import type { ACTUSEvent, CREReportResponse } from "../types";

const router = Router();

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

    // 1. Load the Postman collection
    const filePath = path.join(config.simulationsDir, `${simulationId}.json`);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: `Simulation not found: ${simulationId}` });
      return;
    }
    const collection = JSON.parse(fs.readFileSync(filePath, "utf-8"));

    // 2. Execute via StimulationRunner
    const envConfig: EnvironmentConfig = {
      riskServiceBase: config.actusRiskHost,
      actusServerBase: config.actusSimHost,
    };
    const simResult = await runStimulation(collection, envConfig, "configured");

    // 3. Extract events from ACTUS response
    //    ACTUS /rf2/scenarioSimulation returns [{contractId, contractType, events: [...]}]
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

    if (events.length === 0) {
      res.status(500).json({
        error: "Simulation returned no events",
        simulationId,
        simulationSuccess: simResult.success,
        steps: simResult.steps.map((s) => ({ step: s.step, name: s.name, status: s.status })),
      });
      return;
    }

    // 4. Compute metrics from events
    const params = req.body.params || {};
    const metrics = computeMetrics(events, params);

    // 5. Format as CRE report
    const report = formatCREReport(metrics, scenarioId);

    // 6. Build response
    const ppEvents = events.filter((e) => e.type === "PP" && Math.abs(e.payoff) > 0);

    const response: CREReportResponse = {
      report,
      simulation: {
        id: simulationId,
        name: simResult.scenarioName,
        totalEvents: events.length,
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
