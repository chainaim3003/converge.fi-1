/**
 * scripts/diagnose.ts — V4
 *
 * Reads LIVE on-chain state from all V4 contracts and prints the exact
 * values that control whether _processReport() succeeds and mint() is allowed.
 *
 * Usage:
 *   npx hardhat run scripts/diagnose.ts --network sepolia
 */

import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

const MOCK_KEYSTONE_FORWARDER = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88";

const POLICY_ABI = [
  "function backingPct() view returns (uint16)",
  "function liquidityPct() view returns (uint16)",
  "function riskScore() view returns (uint16)",
  "function maturityGapDays() view returns (uint16)",
  "function assetEligibilityPct() view returns (uint16)",
  "function custodianDiversityScore() view returns (uint16)",
  "function lastUpdated() view returns (uint40)",
  "function isHealthy() view returns (bool)",
  "function authorizedConsumer() view returns (address)",
  "function owner() view returns (address)",
  "function backingThreshold() view returns (uint16)",
  "function liquidityThreshold() view returns (uint16)",
  "function riskScoreThreshold() view returns (uint16)",
  "function eligibilityThreshold() view returns (uint16)",
  "function maxStaleAge() view returns (uint256)",
];

const CONSUMER_ABI = [
  "function getForwarderAddress() view returns (address)",
  "function owner() view returns (address)",
  "function riskPolicy() view returns (address)",
  "function reportCount() view returns (uint256)",
];

const STABLECOIN_ABI = [
  "function riskPolicy() view returns (address)",
  "function getMintStatus() view returns (bool mintAllowed, string reason, uint16 backingPct, uint16 liquidityPct, uint16 riskScore, uint256 staleAge)",
  "function owner() view returns (address)",
];

function ts(unixSecs: bigint): string {
  if (unixSecs === 0n) return "0 (never set)";
  const now = BigInt(Math.floor(Date.now() / 1000));
  const age = now - unixSecs;
  return `${new Date(Number(unixSecs) * 1000).toISOString()} (${age}s ago)`;
}

async function main() {
  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  const policyAddr = process.env.RISK_POLICY_ADDRESS;
  const consumerAddr = process.env.RISK_CONSUMER_V2_ADDRESS;
  const stablecoinAddr = process.env.STABLECOIN_V2_ADDRESS;

  if (!policyAddr) throw new Error("RISK_POLICY_ADDRESS not set in .env");
  if (!consumerAddr) throw new Error("RISK_CONSUMER_V2_ADDRESS not set in .env");
  if (!stablecoinAddr) throw new Error("STABLECOIN_V2_ADDRESS not set in .env");

  const sep = "─".repeat(72);
  console.log(sep);
  console.log("diagnose.ts V4 — Live On-Chain State Audit");
  console.log(sep);
  console.log(`Network  : ${network.name} (chainId ${network.chainId})`);
  console.log(`Signer   : ${signer.address}`);
  console.log(`Block    : ${await ethers.provider.getBlockNumber()}`);
  console.log(sep);

  // 1. MultiAttributeConvergeRiskConsumer
  const consumer = new ethers.Contract(consumerAddr, CONSUMER_ABI, signer);
  const fwd = await consumer.getForwarderAddress();
  const cOwner = await consumer.owner();
  const cPolicy = await consumer.riskPolicy();
  const reportCount = await consumer.reportCount();
  const fwdOK = fwd.toLowerCase() === MOCK_KEYSTONE_FORWARDER.toLowerCase();

  console.log(`\n[1] MultiAttributeConvergeRiskConsumer → ${consumerAddr}`);
  console.log(`    owner           : ${cOwner}`);
  console.log(`    forwarderAddress: ${fwd} ${fwdOK ? "✅ MockKeystoneForwarder" : "❌ WRONG"}`);
  console.log(`    riskPolicy      : ${cPolicy} ${cPolicy.toLowerCase() === policyAddr.toLowerCase() ? "✅" : "❌ MISMATCH"}`);
  console.log(`    reportCount     : ${reportCount}`);

  // 2. MultiAttributeRiskPolicy
  const policy = new ethers.Contract(policyAddr, POLICY_ABI, signer);
  const pOwner = await policy.owner();
  const authConsumer = await policy.authorizedConsumer();
  const consumerOK = authConsumer.toLowerCase() === consumerAddr.toLowerCase();

  console.log(`\n[2] MultiAttributeRiskPolicy → ${policyAddr}`);
  console.log(`    owner              : ${pOwner}`);
  console.log(`    authorizedConsumer : ${authConsumer} ${consumerOK ? "✅" : "❌ WRONG — updateReport will revert"}`);
  console.log(`    thresholds:`);
  console.log(`      backing  ≥ ${await policy.backingThreshold()}%`);
  console.log(`      liquidity≥ ${await policy.liquidityThreshold()}%`);
  console.log(`      riskScore≤ ${await policy.riskScoreThreshold()}`);
  console.log(`      eligibility≥ ${await policy.eligibilityThreshold()}%`);
  console.log(`      maxStaleAge= ${await policy.maxStaleAge()}s`);
  console.log(`    current state:`);
  console.log(`      backingPct     : ${await policy.backingPct()}%`);
  console.log(`      liquidityPct   : ${await policy.liquidityPct()}%`);
  console.log(`      riskScore      : ${await policy.riskScore()}`);
  console.log(`      maturityGapDays: ${await policy.maturityGapDays()}`);
  console.log(`      eligibility    : ${await policy.assetEligibilityPct()}%`);
  console.log(`      custodian      : ${await policy.custodianDiversityScore()}`);
  console.log(`      lastUpdated    : ${ts(await policy.lastUpdated())}`);
  console.log(`      isHealthy      : ${await policy.isHealthy()}`);

  // 3. ConvergeStablecoin
  const coin = new ethers.Contract(stablecoinAddr, STABLECOIN_ABI, signer);
  const sPolicy = await coin.riskPolicy();
  const sOwner = await coin.owner();
  const [allowed, reason, bk, lq, rs, age] = await coin.getMintStatus();

  console.log(`\n[3] ConvergeStablecoin → ${stablecoinAddr}`);
  console.log(`    owner      : ${sOwner}`);
  console.log(`    riskPolicy : ${sPolicy} ${sPolicy.toLowerCase() === policyAddr.toLowerCase() ? "✅" : "❌ MISMATCH"}`);
  console.log(`    getMintStatus():`);
  console.log(`      mintAllowed : ${allowed}`);
  console.log(`      reason      : "${reason}"`);
  console.log(`      backingPct  : ${bk}%`);
  console.log(`      liquidityPct: ${lq}%`);
  console.log(`      riskScore   : ${rs}`);
  console.log(`      staleAge    : ${age}s`);

  // Summary
  console.log(`\n${sep}`);
  console.log("DIAGNOSIS SUMMARY");
  console.log(sep);

  const issues: string[] = [];
  if (!fwdOK) issues.push("❌ Consumer forwarder is not MockKeystoneForwarder");
  if (!consumerOK) issues.push("❌ Policy authorizedConsumer does not match consumer address");
  if (cPolicy.toLowerCase() !== policyAddr.toLowerCase()) issues.push("❌ Consumer riskPolicy mismatch");
  if (sPolicy.toLowerCase() !== policyAddr.toLowerCase()) issues.push("❌ Stablecoin riskPolicy mismatch");
  if (reportCount === 0n) issues.push("⚠  reportCount = 0 — no CRE reports received yet");

  if (issues.length === 0) {
    console.log("✅ All wiring correct. reportCount=" + reportCount);
    console.log(allowed ? "✅ Mint is ALLOWED" : `⚠  Mint is BLOCKED: "${reason}"`);
  } else {
    for (const i of issues) console.log(i);
  }
  console.log(sep);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
