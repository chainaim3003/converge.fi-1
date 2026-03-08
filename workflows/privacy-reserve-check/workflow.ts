/**
 * WF3: Converge.fi Privacy Reserve Check Workflow — V4
 *
 * Privacy track submission for Chainlink Convergence Hackathon.
 *
 * Trigger  : CronCapability — configurable schedule (default: every 2 hours)
 * Step 1a  : runtime.getSecret() — retrieves API URL + auth token from Vault DON
 * Step 1b  : ConfidentialHTTPClient.sendRequest(runtime, ...) → POST risk-engine /api/v1/cre-report
 *            Request/response processed inside TEE enclave — DON nodes never see plaintext
 * Step 2   : runtime.report() — DON signs the ABI-encoded 8-field payload (256 bytes)
 * Step 3   : EVMClient.writeReport() — ReceiverTemplate delivers to MultiAttributeConvergeRiskConsumer
 *
 * Key differences from WF1 (risk-monitoring):
 *   - Uses ConfidentialHTTPClient instead of HTTPClient
 *   - API URL and auth token come from Vault DON secrets via runtime.getSecret()
 *   - ConfidentialHTTPClient.sendRequest takes Runtime (not NodeRuntime) — no runInNodeMode
 *   - Raw HTTP request/response are enclave-internal — never visible to DON nodes
 *   - On-chain output is IDENTICAL to WF1 (same 8 fields, same ABI, same contracts)
 *
 * SDK type constraints (verified from @chainlink/cre-sdk source):
 *   - Runtime<C> extends SecretsProvider (has getSecret)
 *   - NodeRuntime<C> extends BaseRuntime only (NO getSecret)
 *   - ConfidentialHTTPClient.sendRequest takes Runtime<unknown>, not NodeRuntime
 *   - ConfidentialHTTPRequestJson shape: { vaultDonSecrets?, request?: HTTPRequestJson }
 *   - ok() and json() helpers support ConfidentialHTTPResponse
 *
 * CRE Confidential HTTP docs:
 *   https://docs.chain.link/cre/reference/sdk/confidential-http-client-ts
 *   https://docs.chain.link/cre/capabilities/confidential-http-ts
 *
 * Secrets management docs:
 *   https://docs.chain.link/cre/guides/workflow/secrets/using-secrets-deployed
 *   https://docs.chain.link/cre/reference/sdk/core-ts
 *
 * ABI encoding must match RiskReportExtractor.decode() on-chain:
 *   abi.decode(data, (uint16, uint16, uint16, uint16, uint40, bytes32, uint16, uint16))
 *
 * NOTE: ConfidentialHTTPClient is marked as "(Experimental)" in the CRE SDK as of March 2026.
 *       See: https://docs.chain.link/cre/reference/sdk/overview-ts
 */

import {
  Runner,
  CronCapability,
  ConfidentialHTTPClient,
  EVMClient,
  handler,
  getNetwork,
  hexToBase64,
  ok,
  json,
  type Runtime,
  type CronPayload,
} from "@chainlink/cre-sdk";

import { encodeAbiParameters, decodeAbiParameters, parseAbiParameters, keccak256, toBytes } from "viem";

// ─── Config shape ─────────────────────────────────────────────────────────────
// Note: riskEngineUrl and API credentials are NOT in config — they are in
// Vault DON secrets (see secrets.yaml). Only public parameters are in config.
type Config = {
  schedule: string;
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

// ─── Main handler ────────────────────────────────────────────────────────────
const onCronTrigger = (
  runtime: Runtime<Config>,
  _payload: CronPayload
): string => {
  runtime.log("Converge.fi V4 PRIVACY reserve check triggered (TEE-protected)");

  // ── Step 1a: Retrieve secrets from Vault DON ────────────────────────────
  // runtime.getSecret() is available on Runtime (via SecretsProvider interface).
  // NOT available on NodeRuntime — that's why we call it here, not in runInNodeMode.
  // In simulation: values come from .env file via secrets.yaml mapping
  // In production: values come from Vault DON (threshold-encrypted)
  // Source: https://docs.chain.link/cre/guides/workflow/secrets/using-secrets-deployed
  // Source: https://docs.chain.link/cre/reference/sdk/core-ts
  const riskEngineUrl = runtime.getSecret({ id: "RISK_ENGINE_URL" }).result().value;
  const apiSecret = runtime.getSecret({ id: "API_SECRET" }).result().value;

  const targetUrl = `${riskEngineUrl}/api/v1/cre-report`;
  runtime.log(`[confidential] POST ${targetUrl} (TEE enclave)`);

  // ── Step 1b: Confidential HTTP call ─────────────────────────────────────
  // ConfidentialHTTPClient.sendRequest takes Runtime<unknown> (not NodeRuntime).
  // It operates at the DON level — the TEE enclave handles the HTTP request.
  // No runInNodeMode needed — the capability manages enclave execution internally.
  //
  // ConfidentialHTTPRequestJson shape (from SDK protobuf):
  //   { vaultDonSecrets?: SecretIdentifierJson[], request?: HTTPRequestJson }
  //
  // HTTPRequestJson uses multiHeaders (map<string, HeaderValues>)
  // and bodyString (not the flat {url, method, headers, body} of HTTPClient).
  //
  // Source: https://docs.chain.link/cre/reference/sdk/confidential-http-client-ts
  // Source: https://docs.chain.link/cre/capabilities/confidential-http-ts
  const confidentialHttpClient = new ConfidentialHTTPClient();
  const response = confidentialHttpClient
    .sendRequest(runtime, {
      request: {
        url: targetUrl,
        method: "POST",
        multiHeaders: {
          "Content-Type": { values: ["application/json"] },
          "Authorization": { values: [`Bearer ${apiSecret}`] },
        },
        bodyString: JSON.stringify({
          simulationId: runtime.config.simulationId,
          scenarioId: runtime.config.scenarioId,
        }),
      },
    })
    .result();

  // ok() and json() support ConfidentialHTTPResponse (verified in http-helpers.d.ts)
  if (!ok(response)) {
    throw new Error(`Risk engine POST failed — status=${response.statusCode}`);
  }

  runtime.log(`[confidential] Response OK (status ${response.statusCode})`);

  const body = json(response) as { report: RiskReport };

  if (!body.report) {
    throw new Error(`Risk engine response missing 'report' field`);
  }

  const report = body.report;

  runtime.log(
    `Risk report (from TEE): backing=${report.backingPct}% liquidity=${report.liquidityPct}% ` +
    `score=${report.riskScore} wam=${report.maturityGapDays}d ` +
    `eligibility=${report.assetEligibilityPct}% custodian=${report.custodianDiversityScore}`
  );

  // ── Step 2: ABI-encode 8 fields (256 bytes) — IDENTICAL to WF1 ────────
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
  // The signed report includes cryptographic attestation that the data was
  // produced inside a verified TEE enclave.
  // Source: https://docs.chain.link/cre/concepts/typescript-wasm-runtime
  const signedReport = runtime
    .report({
      encodedPayload: hexToBase64(encoded),
      encoderName: "evm",
      signingAlgo: "ecdsa",
      hashingAlgo: "keccak256",
    })
    .result();

  runtime.log("Report signed by DON (TEE-attested)");

  // ── Step 4: Write to MultiAttributeConvergeRiskConsumer ────────────────
  // On-chain delivery is IDENTICAL to WF1. The contract receives the same
  // 8-field ABI payload regardless of whether it came from WF1 or WF3.
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
  if (writeReply.txStatus !== undefined && writeReply.txStatus >= 4) {
    throw new Error(
      `writeReport tx failed: tx_status=${writeReply.txStatus}` +
      ` error=${writeReply.errorMessage ?? ""}`
    );
  }

  runtime.log(`Report delivered to ${runtime.config.riskConsumerAddress} (tx_status=${writeReply.txStatus})`);

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
    runtime.log("Mint is ALLOWED — all policies healthy");
  } else {
    runtime.log(`Mint is BLOCKED — ${reason}`);
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
