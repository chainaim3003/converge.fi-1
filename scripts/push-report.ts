/**
 * scripts/push-report.ts — V4
 *
 * Manually pushes risk state on-chain by calling updateReport() on the
 * single MultiAttributeRiskPolicy contract (8 fields, all uint16).
 *
 * Usage:
 *   npx hardhat run scripts/push-report.ts --network sepolia
 *   $env:REPORT_MODE="stressed"; npx hardhat run scripts/push-report.ts --network sepolia
 *   $env:REPORT_MODE="restored"; npx hardhat run scripts/push-report.ts --network sepolia
 */

import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

const POLICY_ADDRESS = process.env.RISK_POLICY_ADDRESS;
const CONSUMER_ADDRESS = process.env.RISK_CONSUMER_V2_ADDRESS;
const STABLECOIN_ADDRESS = process.env.STABLECOIN_V2_ADDRESS;

if (!POLICY_ADDRESS) throw new Error("RISK_POLICY_ADDRESS not set in .env");
if (!STABLECOIN_ADDRESS) throw new Error("STABLECOIN_V2_ADDRESS not set in .env");

const POLICY_ABI = [
  "function updateReport(uint16,uint16,uint16,uint16,uint40,bytes32,uint16,uint16) external",
  "function setAuthorizedConsumer(address) external",
  "function authorizedConsumer() view returns (address)",
  "function backingPct() view returns (uint16)",
  "function liquidityPct() view returns (uint16)",
  "function riskScore() view returns (uint16)",
  "function maturityGapDays() view returns (uint16)",
  "function assetEligibilityPct() view returns (uint16)",
  "function custodianDiversityScore() view returns (uint16)",
  "function lastUpdated() view returns (uint40)",
  "function isHealthy() view returns (bool)",
];

const STABLECOIN_ABI = [
  "function getMintStatus() view returns (bool mintAllowed, string reason, uint16 backingPct, uint16 liquidityPct, uint16 riskScore, uint256 staleAge)",
];

// V4 presets (integer %, 8 fields)
const PRESETS: Record<string, {
  label: string; backingPct: number; liquidityPct: number; riskScore: number;
  maturityGapDays: number; assetEligibilityPct: number; custodianDiversityScore: number;
  expectMint: boolean;
}> = {
  healthy: {
    label: "PHASE A — riskScore=0, all gates pass → MINT ALLOWED",
    backingPct: 490, liquidityPct: 69, riskScore: 0,
    maturityGapDays: 21, assetEligibilityPct: 100, custodianDiversityScore: 80,
    expectMint: true,
  },
  stressed: {
    label: "PHASE B — riskScore=71, 3 gates fail → MINT BLOCKED",
    backingPct: 140, liquidityPct: 4, riskScore: 71,
    maturityGapDays: 174, assetEligibilityPct: 57, custodianDiversityScore: 50,
    expectMint: false,
  },
  restored: {
    label: "PHASE C — riskScore=9, all gates pass → MINT ALLOWED",
    backingPct: 182, liquidityPct: 59, riskScore: 9,
    maturityGapDays: 21, assetEligibilityPct: 100, custodianDiversityScore: 54,
    expectMint: true,
  },
};

async function main() {
  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const mode = process.env.REPORT_MODE || "healthy";
  const preset = PRESETS[mode];
  if (!preset) throw new Error(`Unknown REPORT_MODE="${mode}". Valid: ${Object.keys(PRESETS).join(", ")}`);

  const sep = "─".repeat(64);
  console.log(sep);
  console.log("push-report.ts V4 — Direct Policy Update (8 fields, all uint16)");
  console.log(sep);
  console.log(`Network    : ${network.name} (chainId ${network.chainId})`);
  console.log(`Signer     : ${signer.address}`);
  console.log(`Policy     : ${POLICY_ADDRESS}`);
  console.log(`Stablecoin : ${STABLECOIN_ADDRESS}`);
  console.log(`Mode       : ${mode} — ${preset.label}`);
  console.log(`  backingPct=${preset.backingPct}% liquidityPct=${preset.liquidityPct}% riskScore=${preset.riskScore}`);
  console.log(`  wamDays=${preset.maturityGapDays} eligibility=${preset.assetEligibilityPct}% custodian=${preset.custodianDiversityScore}`);
  console.log(sep);

  const policy = new ethers.Contract(POLICY_ADDRESS!, POLICY_ABI, signer);
  const stablecoin = new ethers.Contract(STABLECOIN_ADDRESS!, STABLECOIN_ABI, signer);

  // Temporarily set authorizedConsumer to signer
  const currentConsumer = await policy.authorizedConsumer();
  console.log(`\nStep 1: Current authorizedConsumer = ${currentConsumer}`);
  console.log(`        Setting to signer...`);
  await (await policy.setAuthorizedConsumer(signer.address)).wait();
  console.log(`        ✅ Done`);

  // Push 8-field report
  const timestamp = BigInt(Math.floor(Date.now() / 1000));
  const scenarioHash = ethers.keccak256(ethers.toUtf8Bytes("push-report-" + mode));
  console.log(`\nStep 2: Calling updateReport()...`);
  const tx = await policy.updateReport(
    preset.backingPct, preset.liquidityPct, preset.riskScore, preset.maturityGapDays,
    timestamp, scenarioHash, preset.assetEligibilityPct, preset.custodianDiversityScore
  );
  await tx.wait();
  console.log(`        ✅ Updated (tx: ${tx.hash})`);

  // Restore authorizedConsumer
  console.log(`\nStep 3: Restoring authorizedConsumer → ${currentConsumer}`);
  await (await policy.setAuthorizedConsumer(currentConsumer)).wait();
  console.log(`        ✅ Restored`);

  // Verify
  console.log(`\nStep 4: On-chain state:`);
  console.log(`  backingPct:     ${await policy.backingPct()}%`);
  console.log(`  liquidityPct:   ${await policy.liquidityPct()}%`);
  console.log(`  riskScore:      ${await policy.riskScore()}`);
  console.log(`  eligibility:    ${await policy.assetEligibilityPct()}%`);
  console.log(`  custodian:      ${await policy.custodianDiversityScore()}`);
  console.log(`  isHealthy:      ${await policy.isHealthy()}`);

  // getMintStatus
  const [allowed, reason, bk, lq, rs, age] = await stablecoin.getMintStatus();
  console.log(`\nStep 5: getMintStatus():`);
  console.log(`  mintAllowed = ${allowed}  reason = "${reason}"`);
  console.log(`  backing=${bk}% liquidity=${lq}% riskScore=${rs} staleAge=${age}s`);

  console.log(`\n${sep}`);
  console.log(allowed ? "✅ Mint is ALLOWED" : `🚫 Mint is BLOCKED — ${reason}`);
  console.log(sep);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
