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

import { encodeAbiParameters, decodeAbiParameters, parseAbiParameters, keccak256, toBytes } from "viem";

// ─── Config shape ─────────────────────────────────────────────────────────────
// Declared to match config.json co-located with this file.
// All values sourced from config.json — no hardcoding.
type Config = {
  schedule: string;           // cron expression, e.g. "0 * * * *"
  riskEngineUrl: string;      // e.g. "http://your-risk-engine:3001"
  riskConsumerAddress: string;// deployed RiskConsumerWithACE address on Sepolia
  stablecoinAddress: string;  // deployed ConvergeStablecoin address on Sepolia
  simulationId: string;       // e.g. "StableCoin-MaturityLadder-30d"
  scenarioId: string;         // e.g. "sc_depeg_stress_scn01"
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
// Converts Uint8Array to 0x-prefixed hex string — pure arithmetic, works in WASM runtime
function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let hex = '0x';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex as `0x${string}`;
}

// base64 encoder — btoa is not available in the CRE WASM runtime
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function encodeBase64(str: string): string {
  const bytes = Array.from(str).map(c => c.charCodeAt(0));
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    result += BASE64_CHARS[b0 >> 2];
    result += BASE64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    result += i + 1 < bytes.length ? BASE64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    result += i + 2 < bytes.length ? BASE64_CHARS[b2 & 63] : '=';
  }
  return result;
}

const fetchRiskReport = (nodeRuntime: NodeRuntime<Config>): RiskReport => {
  const httpClient = new HTTPClient();
  const targetUrl = `${nodeRuntime.config.riskEngineUrl}/api/v1/cre-report`;

  // Gap 1: log the exact URL being called so a connection failure is immediately obvious
  nodeRuntime.log(`[fetchRiskReport] POST ${targetUrl}`);

  const response = httpClient
    .sendRequest(nodeRuntime, {
      url: targetUrl,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: encodeBase64(JSON.stringify({
        simulationId: nodeRuntime.config.simulationId,
        scenarioId: nodeRuntime.config.scenarioId,
      })),
    })
    .result();

  if (!ok(response)) {
    // Gap 1: include URL and status so you know which server rejected the request
    throw new Error(
      `Risk engine POST failed — url=${targetUrl} status=${response.statusCode}`
    );
  }

  // Gap 1: confirm the response arrived before parsing
  nodeRuntime.log(`[fetchRiskReport] Response OK (status ${response.statusCode}), parsing body`);

  const body = json(response) as { report: RiskReport };

  if (!body.report) {
    throw new Error(`Risk engine response missing 'report' field — url=${targetUrl}`);
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

  // Gap 5: confirm encoding succeeded and show byte count
  runtime.log(`ABI encoded: ${(encoded.length - 2) / 2} bytes`);

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

  // Gap 5: confirm network resolved correctly — wrong chainName silently returns null above
  runtime.log(`Network resolved: ${runtime.config.chainName} selector=${network.chainSelector.selector}`);

  // EVMClient constructor takes the numeric chain selector (bigint).
  // Source: dist/generated-sdk/capabilities/blockchain/evm/v1alpha/client_sdk_gen.d.ts
  const evmClient = new EVMClient(network.chainSelector.selector);

  // Gap 5: log the exact receiver and gasLimit before the on-chain write
  runtime.log(`Submitting on-chain: receiver=${runtime.config.riskConsumerAddress} gasLimit=${runtime.config.gasLimit}`);

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

  // ── Step 5: Read getMintStatus() from ConvergeStablecoin ──────────────────
  // getMintStatus() selector = first 4 bytes of keccak256("getMintStatus()")
  const getMintStatusSelector = keccak256(toBytes("getMintStatus()")).slice(0, 10) as `0x${string}`;

  const mintStatusReply = evmClient
    .callContract(runtime, {
      call: {
        from: hexToBase64("0x0000000000000000000000000000000000000000"),
        to:   hexToBase64(runtime.config.stablecoinAddress as `0x${string}`),
        data: hexToBase64(getMintStatusSelector),
      },
    })
    .result();

  // Decode: getMintStatus() returns (bool, string, uint16, uint16, uint8, uint256)
  const [mintAllowed, reason, backingBps, liquidityBps, riskScore, staleAge] =
    decodeAbiParameters(
      parseAbiParameters("bool mintAllowed, string reason, uint16 backingBps, uint16 liquidityBps, uint8 riskScore, uint256 staleAge"),
      bytesToHex(mintStatusReply.data)
    );

  runtime.log(
    `getMintStatus(): mintAllowed=${mintAllowed} reason="${reason}" ` +
    `backingBps=${backingBps} liquidityBps=${liquidityBps} riskScore=${riskScore} staleAge=${staleAge}s`
  );

  if (mintAllowed) {
    runtime.log("✅ Mint is ALLOWED — all policies healthy");
  } else {
    runtime.log(`🚫 Mint is BLOCKED — ${reason}`);
  }

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
