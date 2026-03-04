/**
 * WF1: Converge.fi Risk Monitoring Workflow
 *
 * Trigger  : CronCapability — every hour ("0 * * * *")
 * Step 1   : HTTPClient.sendRequest (NodeRuntime) → POST risk-engine /api/v1/cre-report
 *            Consensus: consensusIdenticalAggregation — all DON nodes call the same
 *            public risk-engine endpoint; results must be identical.
 * Step 2   : runtime.report() — DON signs the ABI-encoded risk payload
 * Step 3   : EVMClient.writeReport() — KeystoneForwarder delivers to RiskConsumerWithACE
 *
 * SDK source of truth: node_modules/@chainlink/cre-sdk/dist/sdk/index.d.ts
 * Docs: https://docs.chain.link/cre/reference/sdk/core-ts
 *       https://docs.chain.link/cre/reference/sdk/evm-client-ts
 *       https://docs.chain.link/cre/reference/sdk/http-client-ts
 */

import {
  Runner,
  CronCapability,
  HTTPClient,
  EVMClient,
  handler,
  getNetwork,
  hexToBase64,
  ok,
  json,
  consensusIdenticalAggregation,
  type Runtime,
  type NodeRuntime,
  type CronPayload,
} from "@chainlink/cre-sdk";

import { encodeAbiParameters, parseAbiParameters, keccak256, toBytes } from "viem";

// ─── Config shape ─────────────────────────────────────────────────────────────
// Declared to match config.json co-located with this file.
// All values sourced from config.json — no hardcoding.
type Config = {
  schedule: string;           // cron expression, e.g. "0 * * * *"
  riskEngineUrl: string;      // e.g. "http://your-risk-engine:3001"
  riskConsumerAddress: string;// deployed RiskConsumerWithACE address on Sepolia
  chainName: string;          // "ethereum-testnet-sepolia"
  gasLimit: string;           // e.g. "500000"
};

// ─── Risk report shape (mirrors CRE report route response) ───────────────────
type RiskReport = {
  backingRatioBps: number;   // uint16 — total reserves / supply in bps (10000 = 100%)
  liquidityRatioBps: number; // uint16 — cash reserves / supply in bps
  riskScore: number;         // uint8  — composite risk score 0-100
  maturityGapDays: number;   // uint8  — days until next T-bill maturity
  timestamp: number;         // uint40 — unix timestamp of computation
  scenarioId: string;        // bytes32 hex string — e.g. keccak256("sc_depeg_stress_scn01")
};

// ─── Step 1 helper: fetch risk report on each node ───────────────────────────
/**
 * Runs inside runtime.runInNodeMode — receives NodeRuntime.
 * Each DON node independently POSTs to the risk-engine and returns the report.
 * consensusIdenticalAggregation then requires all nodes agree on the result.
 *
 * Source: SDK README — HTTP Operations section
 *   https://github.com/smartcontractkit/cre-sdk-typescript
 */
const fetchRiskReport = (nodeRuntime: NodeRuntime<Config>): RiskReport => {
  const httpClient = new HTTPClient();

  const response = httpClient
    .sendRequest(nodeRuntime, {
      url: `${nodeRuntime.config.riskEngineUrl}/api/v1/cre-report`,
      method: "POST",
      headers: [{ key: "Content-Type", value: "application/json" }],
      body: JSON.stringify({
        simulationId: "StableCoin-BackingRatio-RedemptionPressure-30d",
        scenarioId: "sc_depeg_stress_scn01",
      }),
    })
    .result();

  if (!ok(response)) {
    throw new Error(
      `Risk engine POST failed with status ${response.statusCode}`
    );
  }

  const body = json(response) as { report: RiskReport };

  if (!body.report) {
    throw new Error("Risk engine response missing 'report' field");
  }

  return body.report;
};

// ─── Main handler: runs in DON context ───────────────────────────────────────
/**
 * onCronTrigger executes on every cron tick.
 * Callback signature: (runtime: Runtime<Config>, payload: CronPayload) => string
 * Source: https://docs.chain.link/cre/reference/sdk/triggers/cron-trigger-ts
 */
const onCronTrigger = (
  runtime: Runtime<Config>,
  _payload: CronPayload
): string => {
  runtime.log("Converge.fi risk monitoring workflow triggered");

  // ── Step 1: Fetch risk metrics from risk-engine ──────────────────────────
  // runInNodeMode: each node calls fetchRiskReport independently.
  // consensusIdenticalAggregation: all nodes must return the same report object.
  // Source: https://docs.chain.link/cre/reference/sdk/core-ts#runtimeruninnodemode
  const report: RiskReport = runtime
    .runInNodeMode(fetchRiskReport, consensusIdenticalAggregation<RiskReport>())()
    .result();

  runtime.log(
    `Risk report: backing=${report.backingRatioBps}bps ` +
    `liquidity=${report.liquidityRatioBps}bps ` +
    `score=${report.riskScore} ` +
    `maturityGap=${report.maturityGapDays}d`
  );

  // ── Step 2: ABI-encode the payload ──────────────────────────────────────
  // Encoding must match RiskReportExtractor.decode() on-chain:
  //   abi.decode(data, (uint16, uint16, uint8, uint8, uint40, bytes32))
  // Source: contracts/src/extractors/RiskReportExtractor.sol
  //
  // encodeAbiParameters is from viem — used exactly as in the Chainlink blog
  // example: https://blog.chain.link/5-ways-to-build-with-cre/
  const encoded = encodeAbiParameters(
    parseAbiParameters(
      "uint16 backingRatioBps, uint16 liquidityRatioBps, uint8 riskScore, uint8 maturityGapDays, uint40 timestamp, bytes32 scenarioId"
    ),
    [
      report.backingRatioBps,
      report.liquidityRatioBps,
      report.riskScore,
      report.maturityGapDays,
      BigInt(report.timestamp),
      // keccak256-hash the string scenarioId → bytes32, matching
      // RiskReportExtractor.sol: "e.g. keccak256('sc_depeg_stress_scn01')"
      // keccak256 and toBytes are from viem (already a root dep via @chainlink/cre-sdk)
      keccak256(toBytes(report.scenarioId)),
    ]
  );

  // ── Step 3: Generate DON-signed report ──────────────────────────────────
  // hexToBase64 converts the viem hex string to the base64 format runtime.report expects.
  // Source: SDK dist/sdk/utils/hex-utils.d.ts
  // Encoder defaults (evm / ecdsa / keccak256) from:
  //   https://docs.chain.link/cre/reference/sdk/evm-client-ts
  const signedReport = runtime
    .report({
      encodedPayload: hexToBase64(encoded),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  runtime.log("Report signed by DON");

  // ── Step 4: Submit to RiskConsumerWithACE via KeystoneForwarder ─────────
  // getNetwork looks up the chain selector by string name from the SDK's
  // built-in chain-selectors list.
  // Source: dist/sdk/utils/chain-selectors/get-network.d.ts
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainName,
    isTestnet: true,
  });

  if (!network) {
    throw new Error(`Network not found: ${runtime.config.chainName}`);
  }

  // EVMClient constructor takes the numeric chain selector (bigint).
  // Source: dist/generated-sdk/capabilities/blockchain/evm/v1alpha/client_sdk_gen.d.ts
  const evmClient = new EVMClient(network.chainSelector.selector);

  // writeReport sends the DON-signed report to the KeystoneForwarder.
  // The Forwarder verifies signatures then calls onReport(metadata, report)
  // on RiskConsumerWithACE.
  // WriteCreReportRequestJson: receiver is the contract address string.
  // Source: dist/generated-sdk/capabilities/blockchain/evm/v1alpha/client_sdk_gen.d.ts
  evmClient
    .writeReport(runtime, {
      receiver: runtime.config.riskConsumerAddress,
      report: signedReport,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result();

  runtime.log(
    `Report written to ${runtime.config.riskConsumerAddress} on ${runtime.config.chainName}`
  );

  return "done";
};

// ─── Workflow registration ────────────────────────────────────────────────────
/**
 * initWorkflow creates the handler array.
 * The CRE runtime calls this with the parsed config.json.
 * Source: https://docs.chain.link/cre/reference/sdk/core-ts#initworkflow
 */
const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [
    handler(
      cron.trigger({ schedule: config.schedule }),
      onCronTrigger
    ),
  ];
};

// ─── Entry point ─────────────────────────────────────────────────────────────
/**
 * main() is required by the CRE runtime as the WASM entry point.
 * Source: https://docs.chain.link/cre/reference/sdk/core-ts#main
 */
export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
