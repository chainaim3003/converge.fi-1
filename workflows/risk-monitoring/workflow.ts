/**
 * WF1: Risk Monitoring Workflow — PRIMARY (Risk & Compliance track)
 *
 * Trigger: Cron schedule (every 1 hour)
 * Steps:
 *   1. httpClient.sendRequest() → POST risk-engine/api/v1/cre-report
 *   2. Process response (extract backingRatioBps, liquidityRatioBps, riskScore)
 *   3. runtime.report() → sign the metrics
 *   4. evmClient.writeReport() → RiskConsumerWithACE on Sepolia
 *
 * This is the core workflow that keeps on-chain policy state fresh.
 * The circuit breaker pattern depends on this running reliably.
 */

import { CREWorkflow, CronTrigger, HttpAction, EvmAction } from "@chainlink/cre-sdk";

// Configuration — sourced from workflow secrets/config
const RISK_ENGINE_URL = "{{secrets.RISK_ENGINE_URL}}"; // e.g. http://risk-engine:3001
const RISK_CONSUMER_ADDRESS = "{{config.RISK_CONSUMER_ADDRESS}}";
const SEPOLIA_CHAIN_ID = 11155111;

/**
 * Risk Monitoring Workflow Definition
 */
const workflow: CREWorkflow = {
  name: "converge-fi-risk-monitoring",
  description:
    "Hourly ACTUS simulation → CRE risk report → on-chain policy update for stablecoin circuit breaker",

  // Trigger: run every hour
  trigger: {
    type: "cron",
    schedule: "0 * * * *", // Every hour at minute 0
  } as CronTrigger,

  // Step 1: Call risk-engine to run ACTUS simulation and compute metrics
  actions: [
    {
      id: "fetch_risk_report",
      type: "http",
      config: {
        method: "POST",
        url: `${RISK_ENGINE_URL}/api/v1/cre-report`,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          simulationId: "StableCoin-BackingRatio-RedemptionPressure-30d",
          scenarioId: "sc_depeg_stress_scn01",
        }),
        timeout: 60000, // 60s — ACTUS sim can take time
      },
    } as HttpAction,

    // Step 2 + 3: Process response and sign report
    // The CRE runtime handles signing via runtime.report()
    {
      id: "write_report",
      type: "evm_write",
      config: {
        chainId: SEPOLIA_CHAIN_ID,
        contractAddress: RISK_CONSUMER_ADDRESS,
        // ABI-encode the report data from step 1 response
        // The CRE runtime encodes: (uint16, uint16, uint8, uint8, uint40, bytes32)
        encode: {
          backingRatioBps: "{{fetch_risk_report.response.body.report.backingRatioBps}}",
          liquidityRatioBps: "{{fetch_risk_report.response.body.report.liquidityRatioBps}}",
          riskScore: "{{fetch_risk_report.response.body.report.riskScore}}",
          maturityGapDays: "{{fetch_risk_report.response.body.report.maturityGapDays}}",
          timestamp: "{{fetch_risk_report.response.body.report.timestamp}}",
          scenarioId: "{{fetch_risk_report.response.body.report.scenarioId}}",
        },
      },
    } as EvmAction,
  ],
};

export default workflow;
