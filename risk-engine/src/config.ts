/**
 * Environment configuration for risk-engine.
 * ACTUS URLs come from env vars ONLY — never hardcode (CLAUDE.md constraint #11).
 */

import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

export const config = {
  /** ACTUS Risk Data Service — port 8082 (stores indexes, models, scenarios) */
  actusRiskHost: process.env.ACTUS_RISK_HOST || "http://localhost:8082",

  /** ACTUS Simulation Engine — port 8083 (runs contract simulations) */
  actusSimHost: process.env.ACTUS_SIM_HOST || "http://localhost:8083",

  /** Express server port */
  port: parseInt(process.env.PORT || "3001", 10),

  /** Node environment */
  nodeEnv: process.env.NODE_ENV || "development",

  /** Path to simulation JSON files */
  simulationsDir: path.resolve(__dirname, "../simulations"),

  /** Path to portfolio configs */
  portfoliosDir: path.resolve(__dirname, "../config/portfolios"),
};
