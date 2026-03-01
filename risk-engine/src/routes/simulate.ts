/**
 * GET  /api/simulations     — Lists available simulation JSONs
 * POST /api/run-simulation  — Runs simulation → returns event stream
 */

import { Router, Request, Response } from "express";
import { ACTUSClient } from "../api/ACTUSClient";
import { isValidSimulationId } from "../utils/validation";

const router = Router();
const actusClient = new ACTUSClient();

/**
 * GET /api/simulations — Lists all available simulation files with metadata.
 */
router.get("/simulations", (_req: Request, res: Response) => {
  try {
    const simulations = actusClient.listSimulations();
    res.json({
      count: simulations.length,
      simulations,
    });
  } catch (error: any) {
    res.status(500).json({ error: "Failed to list simulations", details: error.message });
  }
});

/**
 * GET /api/simulations/:id — Describe a specific simulation (metadata + steps).
 */
router.get("/simulations/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  if (!isValidSimulationId(id)) {
    res.status(400).json({ error: "Invalid simulation ID" });
    return;
  }

  try {
    const description = actusClient.describeSimulation(id);
    res.json(description);
  } catch (error: any) {
    res.status(404).json({ error: "Simulation not found", details: error.message });
  }
});

/**
 * POST /api/run-simulation — Runs a simulation against ACTUS Docker.
 *
 * Body: { "simulationId": "StableCoin-BackingRatio-RedemptionPressure-30d" }
 */
router.post("/run-simulation", async (req: Request, res: Response) => {
  const { simulationId } = req.body;

  if (!simulationId || !isValidSimulationId(simulationId)) {
    res.status(400).json({ error: "Valid simulationId is required in request body" });
    return;
  }

  try {
    console.log(`[simulate] Running simulation: ${simulationId}`);
    const result = await actusClient.runSimulation(simulationId);
    console.log(
      `[simulate] Completed: ${result.totalEvents} events, status=${result.status}`
    );
    res.json(result);
  } catch (error: any) {
    console.error(`[simulate] Error running ${simulationId}:`, error.message);
    res.status(500).json({ error: "Simulation failed", details: error.message });
  }
});

export default router;
