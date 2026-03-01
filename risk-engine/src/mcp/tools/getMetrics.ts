/**
 * MCP Tool: getMetrics
 * Run a simulation and compute CRE report metrics.
 */

import { ACTUSClient } from "../../api/ACTUSClient";
import { computeMetrics, formatCREReport } from "../../metrics/computeMetrics";

export async function getMetricsTool(
  client: ACTUSClient,
  simulationId: string,
  scenarioId?: string
) {
  if (!simulationId) {
    throw new Error("simulationId is required");
  }

  const effectiveScenarioId = scenarioId || "sc_depeg_stress_scn01";

  // Run the simulation
  const simResult = await client.runSimulation(simulationId);

  if (simResult.events.length === 0) {
    return {
      error: "Simulation returned no events",
      simulationId,
      status: simResult.status,
    };
  }

  // Compute metrics
  const metrics = computeMetrics(simResult.events);
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
      name: simResult.simulationName,
      totalEvents: simResult.totalEvents,
      status: simResult.status,
    },
  };
}
