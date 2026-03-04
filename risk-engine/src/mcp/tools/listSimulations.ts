/**
 * MCP Tool: listSimulations
 * Lists all available ACTUS simulation JSON files with metadata.
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
  if (lower.includes("supply") || lower.includes("tariff")) return "SupplyChain";
  if (lower.includes("dynamic") || lower.includes("discount")) return "DynamicDiscounting";
  return "Other";
}

export function listSimulationsTool() {
  if (!fs.existsSync(config.simulationsDir)) {
    return { count: 0, simulations: [] };
  }

  const files = fs.readdirSync(config.simulationsDir).filter((f) => f.endsWith(".json"));
  const simulations = files.map((filename) => {
    const filePath = path.join(config.simulationsDir, filename);
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8")) as PostmanCollection;
    return {
      id: path.basename(filename, ".json"),
      name: content.info?.name || filename,
      domain: inferDomain(filename),
      stepCount: content.item?.length || 0,
      description: content.info?.description?.substring(0, 200),
    };
  });

  return { count: simulations.length, simulations };
}
