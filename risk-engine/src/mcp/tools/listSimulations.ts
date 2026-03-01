/**
 * MCP Tool: listSimulations
 * Lists all available ACTUS simulation JSON files with metadata.
 */

import { ACTUSClient } from "../../api/ACTUSClient";

export function listSimulationsTool(client: ACTUSClient) {
  const simulations = client.listSimulations();
  return {
    count: simulations.length,
    simulations: simulations.map((s) => ({
      id: s.id,
      name: s.name,
      domain: s.domain,
      stepCount: s.stepCount,
      description: s.description,
    })),
  };
}
