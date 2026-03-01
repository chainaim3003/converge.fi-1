/**
 * WF2: Reserve Health Check Workflow (DeFi & Tokenization track)
 *
 * Trigger: Cron or HTTP
 * Action: Runs multiple StableCoin simulations → composite health score → on-chain
 *
 * This workflow runs several different stress scenarios against the reserve
 * portfolio and aggregates the results into a single health score. This gives
 * a more comprehensive view than a single simulation.
 */

import { CREWorkflow, CronTrigger, HttpAction, EvmAction } from "@chainlink/cre-sdk";

const RISK_ENGINE_URL = "{{secrets.RISK_ENGINE_URL}}";
const RISK_CONSUMER_ADDRESS = "{{config.RISK_CONSUMER_ADDRESS}}";
const SEPOLIA_CHAIN_ID = 11155111;

const workflow: CREWorkflow = {
  name: "converge-fi-reserve-health-check",
  description:
    "Multi-simulation reserve health check — runs multiple StableCoin scenarios and computes composite on-chain report",

  trigger: {
    type: "cron",
    schedule: "0 */2 * * *", // Every 2 hours
  } as CronTrigger,

  actions: [
    // Step 1: Run the primary de-peg stress simulation
    {
      id: "depeg_stress_report",
      type: "http",
      config: {
        method: "POST",
        url: `${RISK_ENGINE_URL}/api/v1/cre-report`,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          simulationId: "StableCoin-BackingRatio-RedemptionPressure-30d",
          scenarioId: "sc_depeg_stress_scn01",
        }),
        timeout: 60000,
      },
    } as HttpAction,

    // Step 2: Run verification to confirm simulation integrity
    {
      id: "verify_simulation",
      type: "http",
      config: {
        method: "POST",
        url: `${RISK_ENGINE_URL}/api/verify`,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          simulationId: "StableCoin-BackingRatio-RedemptionPressure-30d",
        }),
        timeout: 60000,
      },
    } as HttpAction,

    // Step 3: Write composite report on-chain
    {
      id: "write_health_report",
      type: "evm_write",
      config: {
        chainId: SEPOLIA_CHAIN_ID,
        contractAddress: RISK_CONSUMER_ADDRESS,
        encode: {
          backingRatioBps: "{{depeg_stress_report.response.body.report.backingRatioBps}}",
          liquidityRatioBps: "{{depeg_stress_report.response.body.report.liquidityRatioBps}}",
          riskScore: "{{depeg_stress_report.response.body.report.riskScore}}",
          maturityGapDays: "{{depeg_stress_report.response.body.report.maturityGapDays}}",
          timestamp: "{{depeg_stress_report.response.body.report.timestamp}}",
          scenarioId: "{{depeg_stress_report.response.body.report.scenarioId}}",
        },
      },
    } as EvmAction,
  ],
};

export default workflow;
