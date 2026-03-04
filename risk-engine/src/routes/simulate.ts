/**
 * Simulation routes — rewired to use StimulationRunner
 *
 * GET  /api/simulations         — List simulation files
 * GET  /api/simulations/:id     — Describe a simulation
 * POST /api/run-simulation      — Run simulation via StimulationRunner
 * GET  /api/environments        — List ACTUS environments
 * POST /api/stimulation/run     — Run with environment selection
 * GET  /api/health/risk-service — Detailed ACTUS health check
 */

import { Router, Request, Response } from "express";
import * as fs from "fs";
import * as path from "path";
import axios from "axios";
import { config } from "../config";
import { isValidSimulationId } from "../utils/validation";
import { runStimulation, ENVIRONMENTS } from "../api/StimulationRunner";
import type { EnvironmentConfig } from "../api/StimulationRunner";
import type { SimulationInfo, PostmanCollection } from "../types";

const router = Router();

// ─── Helpers ───

function getEnvConfig(): EnvironmentConfig {
  return {
    riskServiceBase: config.actusRiskHost,
    actusServerBase: config.actusSimHost,
  };
}

function inferDomain(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.includes("stablecoin") || lower.includes("stable")) return "StableCoin";
  if (lower.includes("hybrid") || lower.includes("treasury")) return "HybridTreasury";
  if (lower.includes("defi") || lower.includes("liquidation")) return "DeFi";
  if (lower.includes("supply") || lower.includes("tariff")) return "SupplyChain";
  if (lower.includes("dynamic") || lower.includes("discount")) return "DynamicDiscounting";
  return "Other";
}

function listSimulationFiles(): SimulationInfo[] {
  if (!fs.existsSync(config.simulationsDir)) return [];

  const files = fs.readdirSync(config.simulationsDir).filter((f) => f.endsWith(".json"));
  return files.map((filename) => {
    const filePath = path.join(config.simulationsDir, filename);
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8")) as PostmanCollection;
    return {
      id: path.basename(filename, ".json"),
      name: content.info?.name || filename,
      filename,
      domain: inferDomain(filename),
      stepCount: content.item?.length || 0,
      description: content.info?.description?.substring(0, 200),
    };
  });
}

function loadSimulationCollection(simulationId: string): PostmanCollection {
  const filePath = path.join(config.simulationsDir, `${simulationId}.json`);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Simulation not found: ${simulationId}`);
  }
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as PostmanCollection;
}

// ─── GET /api/simulations ───

router.get("/simulations", (_req: Request, res: Response) => {
  try {
    const simulations = listSimulationFiles();
    res.json({ count: simulations.length, simulations });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to list simulations", details: error.message });
  }
});

// ─── GET /api/simulations/:id ───

router.get("/simulations/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidSimulationId(id)) {
    res.status(400).json({ error: "Invalid simulation ID" });
    return;
  }

  try {
    const collection = loadSimulationCollection(id);
    const info = listSimulationFiles().find((s) => s.id === id);
    const steps = collection.item.map((item, i) => ({
      index: i,
      name: item.name,
      method: item.request.method,
      port: item.request.url.port || "unknown",
    }));

    res.json({ info, steps });
  } catch (error: any) {
    res.status(404).json({ error: "Simulation not found", details: error.message });
  }
});

// ─── POST /api/run-simulation ───

router.post("/run-simulation", async (req: Request, res: Response) => {
  const { simulationId } = req.body;

  if (!simulationId || !isValidSimulationId(simulationId)) {
    res.status(400).json({ error: "Valid simulationId is required in request body" });
    return;
  }

  try {
    console.log(`[simulate] Running simulation: ${simulationId}`);
    const collection = loadSimulationCollection(simulationId);
    const envConfig = getEnvConfig();
    const result = await runStimulation(collection, envConfig, "configured");

    console.log(`[simulate] Completed: success=${result.success}, steps=${result.steps.length}`);
    res.json(result);
  } catch (error: any) {
    console.error(`[simulate] Error running ${simulationId}:`, error.message);
    res.status(500).json({ error: "Simulation failed", details: error.message });
  }
});

// ─── GET /api/environments ───

router.get("/environments", (_req: Request, res: Response) => {
  const envList = Object.entries(ENVIRONMENTS).map(([name, cfg]) => ({
    name,
    riskServiceUrl: cfg.riskServiceBase,
    actusServerUrl: cfg.actusServerBase,
  }));
  res.json(envList);
});

// ─── POST /api/stimulation/run (with environment selection) ───

router.post("/stimulation/run", async (req: Request, res: Response) => {
  try {
    const { stimulationId, environment, customUrls, collectionJson: rawCollection } = req.body;

    if (!stimulationId && !rawCollection) {
      res.status(400).json({
        success: false,
        error: 'Provide either stimulationId or collectionJson',
      });
      return;
    }

    // Resolve environment
    let envConfig: EnvironmentConfig;
    let envName: string;

    if (customUrls && customUrls.riskServiceBase && customUrls.actusServerBase) {
      envConfig = { riskServiceBase: customUrls.riskServiceBase, actusServerBase: customUrls.actusServerBase };
      envName = "custom";
    } else {
      envName = environment || "localhost";
      envConfig = ENVIRONMENTS[envName];
      if (!envConfig) {
        res.status(400).json({
          success: false,
          error: `Unknown environment: "${envName}". Available: ${Object.keys(ENVIRONMENTS).join(", ")}`,
        });
        return;
      }
    }

    // Resolve collection JSON
    let collectionJson: any;

    if (rawCollection && rawCollection.item && Array.isArray(rawCollection.item)) {
      collectionJson = rawCollection;
    } else if (stimulationId) {
      const filePath = path.join(config.simulationsDir, `${stimulationId}.json`);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ success: false, error: `Simulation not found: ${stimulationId}` });
        return;
      }
      collectionJson = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } else {
      res.status(400).json({ success: false, error: "Invalid collectionJson" });
      return;
    }

    const result = await runStimulation(collectionJson, envConfig, envName);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message, timestamp: new Date().toISOString() });
  }
});

// ─── GET /api/health/risk-service ───

router.get("/health/risk-service", async (req: Request, res: Response) => {
  const envName = (req.query.environment as string) || "localhost";
  const envConfig = ENVIRONMENTS[envName];

  if (!envConfig) {
    res.status(400).json({ error: `Unknown environment: ${envName}` });
    return;
  }

  const checks: Record<string, any> = { environment: envName, timestamp: new Date().toISOString() };

  try {
    const response = await axios.get(`${envConfig.riskServiceBase}/findAllScenarios`, { timeout: 5000 });
    checks.riskService = { url: envConfig.riskServiceBase, connected: true, status: response.status };
  } catch (error: any) {
    checks.riskService = { url: envConfig.riskServiceBase, connected: false, error: error.message };
  }

  try {
    const testPayload = {
      contracts: [{ contractType: "PAM", contractID: "health_check", contractRole: "RPA", contractDealDate: "2024-01-01T00:00:00", initialExchangeDate: "2024-01-01T00:00:00", statusDate: "2024-01-01T00:00:00", notionalPrincipal: 1000, maturityDate: "2024-01-02T00:00:00", nominalInterestRate: 0.0, currency: "USD", dayCountConvention: "A365" }],
      riskFactors: [],
    };
    const response = await axios.post(`${envConfig.actusServerBase}/eventsBatch`, testPayload, {
      headers: { "Content-Type": "application/json" },
      timeout: 5000,
    });
    checks.actusServer = { url: envConfig.actusServerBase, connected: response.status === 200 && !!response.data, status: response.status };
  } catch (error: any) {
    checks.actusServer = { url: envConfig.actusServerBase, connected: false, error: error.message };
  }

  const allHealthy = checks.riskService?.connected && checks.actusServer?.connected;
  res.json({ status: allHealthy ? "healthy" : "degraded", ...checks });
});

export default router;
