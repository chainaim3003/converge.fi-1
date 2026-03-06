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
    // Gap 4: log what failed validation so a bad CRE request body is visible in the server terminal
    console.warn(`[cre-report] Validation failed: ${validation.error} — body: ${JSON.stringify(req.body)}`);
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

    // ── 3a. Scripted simulation (approach3-style): metrics already computed in JS ──
    if (rawSimulation && rawSimulation.type === 'scripted' && rawSimulation.epochHistory) {
      const epochHistory: any[] = rawSimulation.epochHistory;
      if (epochHistory.length === 0) {
        res.status(500).json({ error: 'Scripted simulation produced no epochs', simulationId });
        return;
      }
      const lastEpoch = epochHistory[epochHistory.length - 1];

      // All 11 metrics are pre-computed by the JS behavioral models in the collection scripts.
      // Extract directly — no ACTUS event parsing needed.
      const backingRatioBps  = Math.min(30000, Math.max(0, Math.round((lastEpoch.backingMtM  || 0) * 10000)));
      const liquidityRatioBps = Math.min(10000, Math.max(0, Math.round((lastEpoch.liquidity   || 0) * 10000)));
      const qualityScore     = Math.min(100,   Math.max(0, Math.round(lastEpoch.quality       || 75)));
      const ewSignals        = lastEpoch.ewSignals || 0;
      const hhiRaw           = Math.min(10000, Math.max(0, Math.round((lastEpoch.hhi          || 0) * 10000)));
      const wamDays          = Math.min(255,   Math.max(0, Math.round(lastEpoch.wam           || 0)));

      // Composite risk score from 4 approach3 factors (matching GENIUS/MiCA thresholds)
      const backingRisk   = backingRatioBps  >= 10000 ? 0 : Math.min(100, ((10000 - backingRatioBps)  / 10000) * 100);
      const liquidityRisk = liquidityRatioBps >= 2000  ? 0 : Math.min(100, ((2000  - liquidityRatioBps) / 2000)  * 100);
      const qualityRisk   = qualityScore      >= 70    ? 0 : Math.min(100, ((70    - qualityScore)      / 70)    * 100);
      const ewRisk        = Math.min(100, (ewSignals / 4) * 100);
      const riskScore     = Math.max(0, Math.min(100, Math.round(
        backingRisk   * 0.30 +
        liquidityRisk * 0.30 +
        ewRisk        * 0.25 +
        qualityRisk   * 0.15
      )));

      const report = {
        backingRatioBps,
        liquidityRatioBps,
        riskScore,
        maturityGapDays: wamDays,
        timestamp:       Math.floor(Date.now() / 1000),
        scenarioId,
        concentrationHHI:  hhiRaw,
        assetQualityScore: qualityScore,
      };

      console.log(`[cre-report] Scripted simulation: ${epochHistory.length} epochs | lastEpoch=h${lastEpoch.hour || 0} cadence=${lastEpoch.cadence} mintStatus=${lastEpoch.mintStatus}`);
      console.log(`[cre-report] Final report (goes on-chain): ${JSON.stringify(report)}`);
      console.log(`[cre-report] Metrics: backing=${report.backingRatioBps}bps, liquidity=${report.liquidityRatioBps}bps, score=${report.riskScore}`);

      const scriptedResponse: CREReportResponse = {
        report,
        simulation: {
          id:                simulationId,
          name:              simResult.scenarioName,
          totalEvents:       epochHistory.length,
          ppEvents:          epochHistory.filter((e: any) => e.mintStatus === 'HALTED').length,
          peakRedemption:    0,
          finalNominalValue: lastEpoch.totalFace  || 0,
          contractCount:     lastEpoch.contracts  || 0,
        },
        computedAt: new Date().toISOString(),
      };

      res.json(scriptedResponse);
      return;
    }

    // Gap 2: log what was extracted so you can see contract identity and event count
    console.log(`[cre-report] Events extracted: ${events.length} total | contract=${contractId || 'unknown'} type=${contractType || 'unknown'}`);

    if (events.length === 0) {
      // Gap 6: log the raw shape of the simulation response so you know if it's a parse issue or an ACTUS issue
      console.error(`[cre-report] Zero events — rawSimulation type=${typeof rawSimulation} isArray=${Array.isArray(rawSimulation)} keys=${rawSimulation ? Object.keys(rawSimulation).join(',') : 'null'}`);
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
    // Gap 3: log the complete report object — this is the exact data going on-chain
    console.log(`[cre-report] Final report (goes on-chain): ${JSON.stringify(report)}`);

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
        contractCount: Array.isArray(rawSimulation) ? rawSimulation.length : 1,
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
