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

  /** Path to simulation Postman collection JSON files */
  simulationsDir: path.resolve(__dirname, "../config/simulation"),

  /** Path to portfolio configs */
  portfoliosDir: path.resolve(__dirname, "../config/portfolios"),

  /** Path to demo directory (iter-fin-demo-2) containing base_portfolio.json + override files */
  demoDir: process.env.DEMO_DIR || "",

  /** Path to demo sequence config */
  demoSequencePath: path.resolve(__dirname, "../config/demo/demo-sequence.json"),

  // ─── Ethereum Sepolia ────────────────────────────────────────────────────────

  /** Sepolia JSON-RPC URL (Alchemy / Infura) */
  sepoliaRpcUrl: process.env.SEPOLIA_RPC_URL || "",

  /** Deployer private key (with 0x prefix) */
  privateKey: process.env.PRIVATE_KEY || "",

  /** Etherscan API key for transaction history */
  etherscanApiKey: process.env.ETHERSCAN_API_KEY || "",

  /** ConvergeStablecoin (cvUSD) contract address */
  stablecoinAddress: process.env.STABLECOIN_ADDRESS || "",

  /** MultiAttributeRiskPolicy contract address */
  policyAddress: process.env.POLICY_ADDRESS || "",

  /** MultiAttributeConvergeRiskConsumer contract address */
  consumerAddress: process.env.CONSUMER_ADDRESS || "",

  /** Deployer wallet address */
  deployerAddress: process.env.DEPLOYER_ADDRESS || "",

  // ─── CRE CLI ─────────────────────────────────────────────────────────────────

  /** Project root directory — cwd for spawning CRE CLI commands */
  projectRoot: process.env.PROJECT_ROOT || "",

  /** CRE ETH private key WITHOUT 0x prefix (required by CRE CLI) */
  creEthPrivateKey: process.env.CRE_ETH_PRIVATE_KEY || "",
};
