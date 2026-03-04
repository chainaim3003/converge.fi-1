/**
 * GET /api/scenarios — Lists simulations grouped by domain.
 */

import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import { config } from "../config";
import type { PostmanCollection } from "../types";

const router = Router();

function inferDomain(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes("stablecoin") || lower.includes("stable")) return "StableCoin";
  if (lower.includes("hybrid") || lower.includes("treasury")) return "HybridTreasury";
  if (lower.includes("defi") || lower.includes("liquidation")) return "DeFi";
  if (lower.includes("supply") || lower.includes("tariff")) return "SupplyChain";
  if (lower.includes("dynamic") || lower.includes("discount")) return "DynamicDiscounting";
  return "Other";
}

router.get("/scenarios", (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(config.simulationsDir)) {
      res.json({ count: 0, byDomain: {}, scenarios: [] });
      return;
    }

    const files = fs.readdirSync(config.simulationsDir).filter((f) => f.endsWith(".json"));
    const scenarios = files.map((filename) => {
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

    const byDomain: Record<string, typeof scenarios> = {};
    for (const s of scenarios) {
      if (!byDomain[s.domain]) byDomain[s.domain] = [];
      byDomain[s.domain].push(s);
    }

    res.json({ count: scenarios.length, byDomain, scenarios });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to list scenarios", details: error.message });
  }
});

export default router;
