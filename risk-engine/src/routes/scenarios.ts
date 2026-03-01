/**
 * GET /api/scenarios — Lists available scenarios from simulation files.
 *
 * Scenarios are extracted from simulation metadata. Each simulation
 * may represent one or more ACTUS scenarios.
 */

import { Router, Request, Response } from "express";
import { ACTUSClient } from "../api/ACTUSClient";

const router = Router();
const actusClient = new ACTUSClient();

router.get("/scenarios", (_req: Request, res: Response) => {
  try {
    const simulations = actusClient.listSimulations();

    // Group by domain and extract scenario info
    const scenarios = simulations.map((sim) => ({
      id: sim.id,
      name: sim.name,
      domain: sim.domain,
      stepCount: sim.stepCount,
      description: sim.description,
    }));

    // Group by domain
    const byDomain: Record<string, typeof scenarios> = {};
    for (const s of scenarios) {
      if (!byDomain[s.domain]) byDomain[s.domain] = [];
      byDomain[s.domain].push(s);
    }

    res.json({
      count: scenarios.length,
      byDomain,
      scenarios,
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to list scenarios", details: error.message });
  }
});

export default router;
