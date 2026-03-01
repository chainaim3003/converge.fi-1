/**
 * MCP Tool: runSimulation
 * Execute an ACTUS simulation by ID and return events.
 */

import { ACTUSClient } from "../../api/ACTUSClient";

export async function runSimulationTool(client: ACTUSClient, simulationId: string) {
  if (!simulationId) {
    throw new Error("simulationId is required");
  }

  const result = await client.runSimulation(simulationId);
  return {
    simulationId: result.simulationId,
    simulationName: result.simulationName,
    status: result.status,
    totalEvents: result.totalEvents,
    contractId: result.contractId,
    contractType: result.contractType,
    eventSummary: {
      total: result.events.length,
      byType: countByType(result.events),
    },
    steps: result.steps.map((s) => ({
      index: s.stepIndex,
      name: s.name,
      status: s.status,
      success: s.success,
    })),
    executedAt: result.executedAt,
  };
}

function countByType(events: Array<{ type: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.type] = (counts[e.type] || 0) + 1;
  }
  return counts;
}
