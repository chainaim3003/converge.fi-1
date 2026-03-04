/**
 * MCP Tool: describeSimulation
 * Get metadata and step listing for a simulation without executing it.
 */

import * as fs from "fs";
import * as path from "path";
import { config } from "../../config";
import type { PostmanCollection } from "../../types";

function inferDomain(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes("stablecoin") || lower.includes("stable")) return "StableCoin";
  if (lower.includes("hybrid") || lower.includes("treasury")) return "HybridTreasury";
  if (lower.includes("defi") || lower.includes("liquidation")) return "DeFi";
  return "Other";
}

export function describeSimulationTool(simulationId: string) {
  if (!simulationId) {
    throw new Error("simulationId is required");
  }

  const filePath = path.join(config.simulationsDir, `${simulationId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Simulation not found: ${simulationId}`);
  }

  const collection = JSON.parse(fs.readFileSync(filePath, "utf-8")) as PostmanCollection;

  const steps = collection.item.map((item, i) => ({
    index: i,
    name: item.name,
    method: item.request.method,
    port: item.request.url.port || "unknown",
  }));

  return {
    id: simulationId,
    name: collection.info?.name || simulationId,
    domain: inferDomain(simulationId),
    stepCount: steps.length,
    description: collection.info?.description?.substring(0, 500),
    steps,
  };
}
