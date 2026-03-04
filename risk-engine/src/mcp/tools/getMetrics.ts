/**
 * MCP Tool: getMetrics
 * Run a simulation and compute CRE report metrics.
 */

import * as fs from "fs";
import * as path from "path";
import { config } from "../../config";
import { runStimulation } from "../../api/StimulationRunner";
import type { EnvironmentConfig } from "../../api/StimulationRunner";
import { computeMetrics, formatCREReport } from "../../metrics/computeMetrics";
import type { ACTUSEvent } from "../../types";

export async function getMetricsTool(
  simulationId: string,
  scenarioId?: string
) {
  if (!simulationId) {
    throw new Error("simulationId is required");
  }

  const effectiveScenarioId = scenarioId || "sc_depeg_stress_scn01";

  // Load and run the simulation
  const filePath = path.join(config.simulationsDir, `${simulationId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Simulation not found: ${simulationId}`);
  }

  const collection = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  const envConfig: EnvironmentConfig = {
    riskServiceBase: config.actusRiskHost,
    actusServerBase: config.actusSimHost,
  };

  const simResult = await runStimulation(collection, envConfig, "configured");

  // Extract events from ACTUS response
  const rawSim = simResult.simulation;
  let events: ACTUSEvent[] = [];

  if (Array.isArray(rawSim) && rawSim.length > 0 && rawSim[0].events) {
    events = rawSim[0].events;
  } else if (rawSim && rawSim.events) {
    events = rawSim.events;
  }

  if (events.length === 0) {
    return {
      error: "Simulation returned no events",
      simulationId,
      success: simResult.success,
    };
  }

  // Compute metrics
  const metrics = computeMetrics(events);
  const report = formatCREReport(metrics, effectiveScenarioId);

  return {
    report,
    details: {
      totalReserves: metrics.totalReserves,
      totalSupply: metrics.totalSupply,
      cashReserves: metrics.cashReserves,
      redemptionTotal: metrics.redemptionTotal,
      peakDayRedemption: metrics.peakDayRedemption,
      finalNominalValue: metrics.finalNominalValue,
      ppEventCount: metrics.ppEventCount,
    },
    simulation: {
      id: simulationId,
      name: simResult.scenarioName,
      totalEvents: events.length,
      success: simResult.success,
    },
  };
}
