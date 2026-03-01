/**
 * MCP Tool: describeSimulation
 * Get metadata and step listing for a simulation without executing it.
 */

import { ACTUSClient } from "../../api/ACTUSClient";

export function describeSimulationTool(client: ACTUSClient, simulationId: string) {
  if (!simulationId) {
    throw new Error("simulationId is required");
  }

  const description = client.describeSimulation(simulationId);
  return {
    id: description.info.id,
    name: description.info.name,
    domain: description.info.domain,
    stepCount: description.info.stepCount,
    description: description.info.description,
    steps: description.steps.map((s) => ({
      index: s.index,
      name: s.name,
      method: s.method,
      port: s.port,
    })),
  };
}
