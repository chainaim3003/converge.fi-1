/**
 * Converge.fi Risk Engine — Express entry point (port 3001).
 *
 * Wraps ACTUS Docker services (8082, 8083) with:
 *  - Simulation listing and execution
 *  - CRE report metric computation
 *  - StableCoin verification
 *  - Portfolio and scenario management
 */

import express from "express";
import cors from "cors";
import { config } from "./config";

// Routes
import healthRouter from "./routes/health";
import simulateRouter from "./routes/simulate";
import creReportRouter from "./routes/cre-report";
import verifyRouter from "./routes/verify";
import portfoliosRouter from "./routes/portfolios";
import scenariosRouter from "./routes/scenarios";

const app = express();

// ─── Middleware ───
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Request logging
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ─── Routes ───
app.use("/api", healthRouter);       // GET  /api/health
app.use("/api", simulateRouter);     // GET  /api/simulations, POST /api/run-simulation
app.use("/api", creReportRouter);    // POST /api/v1/cre-report
app.use("/api", verifyRouter);       // POST /api/verify
app.use("/api", portfoliosRouter);   // GET  /api/portfolios
app.use("/api", scenariosRouter);    // GET  /api/scenarios

// ─── Root ───
app.get("/", (_req, res) => {
  res.json({
    name: "Converge.fi Risk Engine",
    version: "1.0.0",
    endpoints: {
      health: "GET /api/health",
      simulations: "GET /api/simulations",
      runSimulation: "POST /api/run-simulation",
      creReport: "POST /api/v1/cre-report",
      verify: "POST /api/verify",
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
