/**
 * GET /api/health — Pings ACTUS 8082/8083, returns connectivity status.
 */

import { Router, Request, Response } from "express";
import axios from "axios";
import { config } from "../config";

const router = Router();

router.get("/health", async (_req: Request, res: Response) => {
  const results: Record<string, { status: string; latencyMs: number }> = {};

  // Check ACTUS Risk Data Service (port 8082)
  const riskStart = Date.now();
  try {
    await axios.get(`${config.actusRiskHost}/`, { timeout: 5000 });
    results["actus-risk-service"] = {
      status: "healthy",
      latencyMs: Date.now() - riskStart,
    };
  } catch {
    results["actus-risk-service"] = {
      status: "unreachable",
      latencyMs: Date.now() - riskStart,
    };
  }

  // Check ACTUS Simulation Engine (port 8083)
  const simStart = Date.now();
  try {
    await axios.get(`${config.actusSimHost}/`, { timeout: 5000 });
    results["actus-sim-engine"] = {
      status: "healthy",
      latencyMs: Date.now() - simStart,
    };
  } catch {
    results["actus-sim-engine"] = {
      status: "unreachable",
      latencyMs: Date.now() - simStart,
    };
  }

  const allHealthy = Object.values(results).every((r) => r.status === "healthy");

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? "healthy" : "degraded",
    services: results,
    config: {
      actusRiskHost: config.actusRiskHost,
      actusSimHost: config.actusSimHost,
    },
    timestamp: new Date().toISOString(),
  });
});

export default router;
