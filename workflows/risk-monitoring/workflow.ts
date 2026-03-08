/**
 * WF1: Converge.fi Risk Monitoring Workflow — V4
 *
 * Trigger  : CronCapability — every hour ("0 * * * *")
 * Step 1   : HTTPClient.sendRequest → POST risk-engine /api/v1/cre-report
 * Step 2   : runtime.report() — DON signs the ABI-encoded 8-field payload (256 bytes)
 * Step 3   : EVMClient.writeReport() — ReceiverTemplate delivers to MultiAttributeConvergeRiskConsumer
 *
 * V4 changes:
 *   - 8 fields (was 6): + assetEligibilityPct, custodianDiversityScore
 *   - All uint16 for numerics (was mix of uint8/uint16)
 *   - Integer % scale (was bps)
 *   - Field renames: backingRatioBps → backingPct, liquidityRatioBps → liquidityPct
 *
 * ABI encoding must match RiskReportExtractor.decode() on-chain:
 *   abi.decode(data, (uint16, uint16, uint16, uint16, uint40, bytes32, uint16, uint16))
 *
 * SDK docs: https://docs.chain.link/cre/reference/sdk/core-ts
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
type Config = {
  schedule: string;
  riskEngineUrl: string;
  riskConsumerAddress: string;
  stablecoinAddress: string;
  simulationId: string;
  scenarioId: string;
  chainName: string;
  gasLimit: string;
};

// ─── V4 Risk report shape (8 fields, all uint16 numerics) ────────────────────
type RiskReport = {
  backingPct: number;              // uint16 — integer % (490 = 490%)
  liquidityPct: number;            // uint16 — integer % (69 = 69%)
  riskScore: number;               // uint16 — 0-100 scale
  maturityGapDays: number;         // uint16 — WAM in days
  timestamp: number;               // uint40 — unix seconds
  scenarioId: string;              // → keccak256 → bytes32
  assetEligibilityPct: number;     // uint16 — 0-100 (100 = all GENIUS-eligible)
  custodianDiversityScore: number; // uint16 — 0-100 (80 = well diversified)
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
function bytesToHex(bytes: Uint8Array): `0x${string}` {
  let hex = '0x';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex as `0x${string}`;
}

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

// ─── Step 1: Fetch risk report from Express server ───────────────────────────
const fetchRiskReport = (nodeRuntime: NodeRuntime<Config>): RiskReport => {
  const httpClient = new HTTPClient();
  const targetUrl = `${nodeRuntime.config.riskEngineUrl}/api/v1/cre-report`;

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
    throw new Error(`Risk engine POST failed — url=${targetUrl} status=${response.statusCode}`);
  }

  nodeRuntime.log(`[fetchRiskReport] Response OK (status ${response.statusCode})`);

  const body = json(response) as { report: RiskReport };

  if (!body.report) {
    throw new Error(`Risk engine response missing 'report' field — url=${targetUrl}`);
  }

  return body.report;
};

// ─── Main handler ────────────────────────────────────────────────────────────
const onCronTrigger = (
  runtime: Runtime<Config>,
  _payload: CronPayload
): string => {
  runtime.log("Converge.fi V4 risk monitoring workflow triggered");

  // ── Step 1: Fetch 8-field risk report ───────────────────────────────────
  const report: RiskReport = runtime
    .runInNodeMode(fetchRiskReport, consensusIdenticalAggregation<RiskReport>())()
    .result();

  runtime.log(
    `Risk report: backing=${report.backingPct}% liquidity=${report.liquidityPct}% ` +
    `score=${report.riskScore} wam=${report.maturityGapDays}d ` +
    `eligibility=${report.assetEligibilityPct}% custodian=${report.custodianDiversityScore}`
  );

  // ── Step 2: ABI-encode 8 fields (256 bytes) ───────────────────────────
  // Must match RiskReportExtractor.decode() on-chain:
  //   abi.decode(data, (uint16, uint16, uint16, uint16, uint40, bytes32, uint16, uint16))
  const encoded = encodeAbiParameters(
    parseAbiParameters(
      "uint16 backingPct, uint16 liquidityPct, uint16 riskScore, uint16 maturityGapDays, " +
      "uint40 timestamp, bytes32 scenarioId, uint16 assetEligibilityPct, uint16 custodianDiversityScore"
    ),
    [
      report.backingPct,
      report.liquidityPct,
      report.riskScore,
      report.maturityGapDays,
      BigInt(report.timestamp),
      keccak256(toBytes(report.scenarioId)),
      report.assetEligibilityPct,
      report.custodianDiversityScore,
    ]
  );

  runtime.log(`ABI encoded: ${(encoded.length - 2) / 2} bytes`);

  // ── Step 3: DON-signed report ──────────────────────────────────────────
  const signedReport = runtime
    .report({
      encodedPayload: hexToBase64(encoded),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  runtime.log("Report signed by DON");

  // ── Step 4: Write to MultiAttributeConvergeRiskConsumer ────────────────
  const network = getNetwork({
    chainFamily: "evm",
    chainSelectorName: runtime.config.chainName,
    isTestnet: true,
  });

  if (!network) throw new Error(`Network not found: ${runtime.config.chainName}`);

  runtime.log(`Network resolved: ${runtime.config.chainName}`);

  const evmClient = new EVMClient(network.chainSelector.selector);

  runtime.log(`Submitting on-chain: receiver=${runtime.config.riskConsumerAddress} gasLimit=${runtime.config.gasLimit}`);

  const writeReply = evmClient
    .writeReport(runtime, {
      receiver: runtime.config.riskConsumerAddress,
      report: signedReport,
      gasConfig: { gasLimit: runtime.config.gasLimit },
    })
    .result();

  runtime.log(
    `writeReport reply: tx_status=${writeReply.txStatus}` +
    ` receiver_status=${writeReply.receiverContractExecutionStatus}` +
    ` tx_hash=${writeReply.txHash ?? "(none)"}` +
    ` error=${writeReply.errorMessage ?? "(none)"}`
  );

  // ── Evaluate delivery result ──────────────────────────────────────────
  // CRE SDK proto enum for tx_status (CRE CLI v1.3.0):
  //   0 = TX_STATUS_UNSPECIFIED
  //   1 = TX_STATUS_BROADCASTED
  //   2 = TX_STATUS_CONFIRMED
  //   3 = TX_STATUS_FINALIZED
  //   4 = TX_STATUS_FAILED
  //
  // receiver_contract_execution_status:
  //   0 = SUCCESS (contract executed without revert)
  //   1 = REVERTED (onReport() or _processReport() reverted)
  //
  // The authoritative signal for report delivery is receiver_status.
  // tx_status=2 (CONFIRMED) is success, not failure.
  // Only treat receiver_status !== 0 or explicit tx failure as errors.

  // Check receiver execution first — this is the definitive signal
  if (writeReply.receiverContractExecutionStatus !== undefined &&
      writeReply.receiverContractExecutionStatus !== 0) {
    throw new Error(
      `onReport() reverted inside forwarder: receiver_status=${writeReply.receiverContractExecutionStatus}` +
      ` tx_status=${writeReply.txStatus}` +
      ` error=${writeReply.errorMessage ?? ""}` +
      ` — check ReceiverTemplate forwarder and policy wiring (run scripts/diagnose.ts)`
    );
  }

  // Check for explicit tx failure (status 4 = FAILED in proto enum)
  // Do NOT fail on status 2 (CONFIRMED) or 3 (FINALIZED) — these are success states
  if (writeReply.txStatus !== undefined && writeReply.txStatus >= 4) {
    throw new Error(
      `writeReport tx failed: tx_status=${writeReply.txStatus}` +
      ` error=${writeReply.errorMessage ?? ""}`
    );
  }

  runtime.log(`✅ Report delivered to ${runtime.config.riskConsumerAddress} (tx_status=${writeReply.txStatus})`);

  // ── Step 5: Read getMintStatus() from ConvergeStablecoin ──────────────
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

  // V4: riskScore is now uint16 (was uint8)
  const [mintAllowed, reason, backingPct, liquidityPct, riskScore, staleAge] =
    decodeAbiParameters(
      parseAbiParameters("bool mintAllowed, string reason, uint16 backingPct, uint16 liquidityPct, uint16 riskScore, uint256 staleAge"),
      bytesToHex(mintStatusReply.data)
    );

  runtime.log(
    `getMintStatus(): mintAllowed=${mintAllowed} reason="${reason}" ` +
    `backing=${backingPct}% liquidity=${liquidityPct}% riskScore=${riskScore} staleAge=${staleAge}s`
  );

  if (mintAllowed) {
    runtime.log("✅ Mint is ALLOWED — all policies healthy");
  } else {
    runtime.log(`🚫 Mint is BLOCKED — ${reason}`);
  }

  return "done";
};

// ─── Workflow registration ────────────────────────────────────────────────────
const initWorkflow = (config: Config) => {
  const cron = new CronCapability();
  return [handler(cron.trigger({ schedule: config.schedule }), onCronTrigger)];
};

export async function main() {
  const runner = await Runner.newRunner<Config>();
  await runner.run(initWorkflow);
}
