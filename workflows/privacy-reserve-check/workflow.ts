/**
 * WF3: Privacy Reserve Check Workflow (Privacy track)
 *
 * Trigger: HTTP (confidential)
 * Action: Uses Confidential HTTP to call risk-engine → API credentials protected
 *
 * Key differentiator: The httpClient.sendRequest uses confidential: true,
 * which means API credentials (Authorization header) are protected by
 * CRE confidential compute and never exposed to node operators.
 *
 * From CLAUDE.md Section 8.2:
 *   "Uses Confidential HTTP to call risk-engine → API credentials protected"
 */

import { CREWorkflow, HttpTrigger, HttpAction, EvmAction } from "@chainlink/cre-sdk";

const RISK_ENGINE_URL = "{{secrets.RISK_ENGINE_URL}}";
const API_SECRET = "{{secrets.API_SECRET}}";
const RISK_CONSUMER_ADDRESS = "{{config.RISK_CONSUMER_ADDRESS}}";
const SEPOLIA_CHAIN_ID = 11155111;

const workflow: CREWorkflow = {
  name: "converge-fi-privacy-reserve-check",
  description:
    "Confidential reserve health check with protected API credentials via CRE confidential compute",

  // Trigger: HTTP endpoint (confidential)
  trigger: {
    type: "http",
    config: {
      method: "POST",
      path: "/privacy-check",
    },
  } as HttpTrigger,

  actions: [
    // Step 1: Confidential HTTP call to risk-engine
    // API credentials are protected by CRE confidential compute
    {
      id: "fetch_risk_report_confidential",
      type: "http",
      config: {
        method: "POST",
        url: `${RISK_ENGINE_URL}/api/v1/cre-report`,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${API_SECRET}`,
        },
        body: JSON.stringify({
          simulationId: "StableCoin-BackingRatio-RedemptionPressure-30d",
          scenarioId: "sc_depeg_stress_scn01",
        }),
        timeout: 60000,
        confidential: true, // CRE Confidential HTTP — credentials not exposed
      },
    } as HttpAction,

    // Step 2: Write report on-chain (same encoding as WF1)
    {
      id: "write_report",
      type: "evm_write",
      config: {
        chainId: SEPOLIA_CHAIN_ID,
        contractAddress: RISK_CONSUMER_ADDRESS,
        encode: {
          backingRatioBps: "{{fetch_risk_report_confidential.response.body.report.backingRatioBps}}",
          liquidityRatioBps: "{{fetch_risk_report_confidential.response.body.report.liquidityRatioBps}}",
          riskScore: "{{fetch_risk_report_confidential.response.body.report.riskScore}}",
          maturityGapDays: "{{fetch_risk_report_confidential.response.body.report.maturityGapDays}}",
          timestamp: "{{fetch_risk_report_confidential.response.body.report.timestamp}}",
          scenarioId: "{{fetch_risk_report_confidential.response.body.report.scenarioId}}",
        },
      },
    } as EvmAction,
  ],
};

export default workflow;
