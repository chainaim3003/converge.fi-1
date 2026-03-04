/**
 * MCP Tool: runSimulation
 * Execute an ACTUS simulation by ID via StimulationRunner and return results.
 */

import * as fs from "fs";
import * as path from "path";
import { config } from "../../config";
import { runStimulation } from "../../api/StimulationRunner";
import type { EnvironmentConfig } from "../../api/StimulationRunner";
import type { ACTUSEvent } from "../../types";

export async function runSimulationTool(simulationId: string) {
  if (!simulationId) {
    throw new Error("simulationId is required");
  }

  const filePath = path.join(config.simulationsDir, `${simulationId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Simulation not found: ${simulationId}`);
  }

  const collection = JSON.parse(fs.readFileSync(filePath, "utf-8"));

  const envConfig: EnvironmentConfig = {
    riskServiceBase: config.actusRiskHost,
    actusServerBase: config.actusSimHost,
  };

  const result = await runStimulation(collection, envConfig, "configured");

  // Extract events from ACTUS response
  const rawSim = result.simulation;
  let events: ACTUSEvent[] = [];
  let contractId: string | undefined;
  let contractType: string | undefined;

  if (Array.isArray(rawSim) && rawSim.length > 0 && rawSim[0].events) {
    events = rawSim[0].events;
    contractId = rawSim[0].contractId;
    contractType = rawSim[0].contractType;
  } else if (rawSim && rawSim.events) {
    events = rawSim.events;
    contractId = rawSim.contractId;
    contractType = rawSim.contractType;
  }

  return {
    simulationId,
    simulationName: result.scenarioName,
    status: result.success ? "success" : "error",
    totalEvents: events.length,
    contractId,
    contractType,
    eventSummary: {
      total: events.length,
      byType: countByType(events),
    },
    steps: result.steps.map((s) => ({
      index: s.step,
      name: s.name,
      status: s.status,
      httpStatus: s.httpStatus,
    })),
    totalDurationMs: result.totalDurationMs,
    executedAt: result.timestamp,
  };
}

function countByType(events: Array<{ type: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.type] = (counts[e.type] || 0) + 1;
  }
  return counts;
}
