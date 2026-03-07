/**
 * Converge.fi Risk Engine — Express Server (port 3001)
 *
 * Single entry point. All route logic lives in ./routes/*.
 * Wraps ACTUS Docker services (8082, 8083) with:
 *   - Simulation listing and execution (via StimulationRunner)
 *   - CRE report metric computation (via computeMetrics)
 *   - Portfolio-based verification (via StableCoinVerifier)
 *   - Environment management for ACTUS services
 */

import express from "express";
import cors from "cors";
import { config } from "./config";

import healthRouter from "./routes/health";
import simulateRouter from "./routes/simulate";
import creReportRouter from "./routes/cre-report";
import verifyRouter from "./routes/verify";
import portfoliosRouter from "./routes/portfolios";
import scenariosRouter from "./routes/scenarios";
import demoRouter from "./routes/demo";

const app = express();

// ─── Middleware ───
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Routes ───
app.use("/api", healthRouter);
app.use("/api", simulateRouter);
app.use("/api", creReportRouter);
app.use("/api", verifyRouter);
app.use("/api", portfoliosRouter);
app.use("/api", scenariosRouter);
app.use("/api", demoRouter);

// ─── Root ───
app.get("/", (_req, res) => {
  res.json({
    name: "Converge.fi Risk Engine",
    version: "1.0.0",
    endpoints: {
      health: "GET /api/health",
      healthFull: "GET /api/health/risk-service?environment=localhost",
      simulations: "GET /api/simulations",
      runSimulation: "POST /api/run-simulation",
      environments: "GET /api/environments",
      creReport: "POST /api/v1/cre-report",
      verify: "POST /api/verify",
      thresholds: "GET /api/thresholds/:jurisdiction",
      portfolios: "GET /api/portfolios",
      scenarios: "GET /api/scenarios",
    },
    actus: {
      riskHost: config.actusRiskHost,
      simHost: config.actusSimHost,
    },
  });
});

// ─── Start ───
app.listen(config.port, () => {
  console.log(`\n🚀 Converge.fi Risk Engine running on port ${config.port}`);
  console.log(`   ACTUS Risk Service: ${config.actusRiskHost}`);
  console.log(`   ACTUS Sim Engine:   ${config.actusSimHost}`);
  console.log(`   Simulations dir:    ${config.simulationsDir}`);
  console.log(`   Environment:        ${config.nodeEnv}\n`);
});

export default app;
