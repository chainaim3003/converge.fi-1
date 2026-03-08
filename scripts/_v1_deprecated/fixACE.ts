/**
 * scripts/fixACE.ts
 *
 * Fixes every on-chain misconfiguration that causes onReport() to revert.
 *
 * What it repairs (in order):
 *   1. RiskConsumerWithACE.creForwarder  → MockKeystoneForwarder
 *   2. BackingRatioPolicy.riskConsumer   → RiskConsumerWithACE
 *   3. LiquidityRatioPolicy.riskConsumer → RiskConsumerWithACE
 *   4. RiskScorePolicy.riskConsumer      → RiskConsumerWithACE
 *
 * After each write it reads back the on-chain value and fails hard if
 * the value is still wrong.  No silent successes.
 *
 * Usage:
 *   npx hardhat run scripts/fixACE.ts --network sepolia
 *
 * Re-running is safe: any value already correct is skipped (no tx, no gas).
 */

import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

// ── Official Chainlink Keystone Forwarder on Ethereum Sepolia ─────────────────
// Source: https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
const MOCK_KEYSTONE_FORWARDER = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88";

// ── ABIs — only the functions this script calls ───────────────────────────────
const ACE_ABI = [
  "function creForwarder() view returns (address)",
  "function owner() view returns (address)",
  "function setCreForwarder(address) external",
  "function backingPolicy() view returns (address)",
  "function liquidityPolicy() view returns (address)",
  "function riskScorePolicy() view returns (address)",
];

const POLICY_ABI = [
  "function riskConsumer() view returns (address)",
  "function owner() view returns (address)",
  "function setRiskConsumer(address) external",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fix a single address field on a contract.
 * Reads current value → skips if already correct → writes and verifies if not.
 */
async function fixAddress(
  contract: ethers.Contract,
  readFn: string,
  writeFn: string,
  expected: string,
  label: string,
  signer: ethers.Signer
): Promise<void> {
  const current: string = await contract[readFn]();

  if (current.toLowerCase() === expected.toLowerCase()) {
    console.log(`  ✅ ${label} already correct → ${current}`);
    return;
  }

  console.log(`  ⚠  ${label} is wrong`);
  console.log(`     current  : ${current}`);
  console.log(`     expected : ${expected}`);
  console.log(`     sending tx...`);

  const tx = await (contract.connect(signer) as any)[writeFn](expected);
  console.log(`     tx hash  : ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`     confirmed: block ${receipt.blockNumber}`);

  // Read back and verify
  const updated: string = await contract[readFn]();
  if (updated.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(
      `${label} write did not take effect.\n` +
      `  on-chain: ${updated}\n` +
      `  expected: ${expected}`
    );
  }
  console.log(`  ✅ ${label} fixed → ${updated}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const [signer] = await ethers.getSigners();
  const network  = await ethers.provider.getNetwork();

  const riskConsumerAddr = process.env.RISK_CONSUMER_ADDRESS;
  if (!riskConsumerAddr) throw new Error("RISK_CONSUMER_ADDRESS not set in .env");

  const sep = "─".repeat(72);
  console.log(sep);
  console.log("fixACE.ts — Repair On-Chain ACE Configuration");
  console.log(sep);
  console.log(`Network      : ${network.name} (chainId ${network.chainId})`);
  console.log(`Signer       : ${signer.address}`);
  console.log(`RiskConsumer : ${riskConsumerAddr}`);
  console.log(sep);

  // ── 1. Fix RiskConsumerWithACE.creForwarder ────────────────────────────────
  console.log("\n[Step 1] Fix RiskConsumerWithACE.creForwarder");
  console.log(`  Target: ${MOCK_KEYSTONE_FORWARDER}  (MockKeystoneForwarder)`);

  const ace = new ethers.Contract(riskConsumerAddr, ACE_ABI, signer);

  // Guard: signer must be owner
  const aceOwner: string = await ace.owner();
  if (signer.address.toLowerCase() !== aceOwner.toLowerCase()) {
    throw new Error(
      `Signer ${signer.address} is not the RiskConsumerWithACE owner (${aceOwner}).\n` +
      `Use the deployer private key in .env.`
    );
  }

  await fixAddress(
    ace,
    "creForwarder",
    "setCreForwarder",
    MOCK_KEYSTONE_FORWARDER,
    "creForwarder",
    signer
  );

  // ── 2. Read policy addresses from ACE ─────────────────────────────────────
  const backingAddr   = await ace.backingPolicy();
  const liquidityAddr = await ace.liquidityPolicy();
  const riskScoreAddr = await ace.riskScorePolicy();

  if (backingAddr === ethers.ZeroAddress) {
    throw new Error(
      "RiskConsumerWithACE.backingPolicy() is address(0).\n" +
      "setPolicies() was never called. Run scripts/deploy.ts or call setPolicies manually."
    );
  }

  console.log("\n[Step 2] Fix BackingRatioPolicy.riskConsumer");
  console.log(`  Contract : ${backingAddr}`);
  console.log(`  Target   : ${riskConsumerAddr}  (RiskConsumerWithACE)`);

  const backingPolicy = new ethers.Contract(backingAddr, POLICY_ABI, signer);
  const bOwner: string = await backingPolicy.owner();
  if (signer.address.toLowerCase() !== bOwner.toLowerCase()) {
    throw new Error(`Signer is not BackingRatioPolicy owner (${bOwner})`);
  }
  await fixAddress(
    backingPolicy,
    "riskConsumer",
    "setRiskConsumer",
    riskConsumerAddr,
    "BackingRatioPolicy.riskConsumer",
    signer
  );

  console.log("\n[Step 3] Fix LiquidityRatioPolicy.riskConsumer");
  console.log(`  Contract : ${liquidityAddr}`);
  console.log(`  Target   : ${riskConsumerAddr}  (RiskConsumerWithACE)`);

  const liquidityPolicy = new ethers.Contract(liquidityAddr, POLICY_ABI, signer);
  const lOwner: string = await liquidityPolicy.owner();
  if (signer.address.toLowerCase() !== lOwner.toLowerCase()) {
    throw new Error(`Signer is not LiquidityRatioPolicy owner (${lOwner})`);
  }
  await fixAddress(
    liquidityPolicy,
    "riskConsumer",
    "setRiskConsumer",
    riskConsumerAddr,
    "LiquidityRatioPolicy.riskConsumer",
    signer
  );

  console.log("\n[Step 4] Fix RiskScorePolicy.riskConsumer");
  console.log(`  Contract : ${riskScoreAddr}`);
  console.log(`  Target   : ${riskConsumerAddr}  (RiskConsumerWithACE)`);

  const riskScorePolicy = new ethers.Contract(riskScoreAddr, POLICY_ABI, signer);
  const rOwner: string = await riskScorePolicy.owner();
  if (signer.address.toLowerCase() !== rOwner.toLowerCase()) {
    throw new Error(`Signer is not RiskScorePolicy owner (${rOwner})`);
  }
  await fixAddress(
    riskScorePolicy,
    "riskConsumer",
    "setRiskConsumer",
    riskConsumerAddr,
    "RiskScorePolicy.riskConsumer",
    signer
  );

  // ── Final read-back ────────────────────────────────────────────────────────
  console.log("\n" + sep);
  console.log("FINAL VERIFICATION (live on-chain reads)");
  console.log(sep);

  const cf  = await ace.creForwarder();
  const bRC = await backingPolicy.riskConsumer();
  const lRC = await liquidityPolicy.riskConsumer();
  const rRC = await riskScorePolicy.riskConsumer();

  const fwdOK = cf.toLowerCase()  === MOCK_KEYSTONE_FORWARDER.toLowerCase();
  const bOK   = bRC.toLowerCase() === riskConsumerAddr.toLowerCase();
  const lOK   = lRC.toLowerCase() === riskConsumerAddr.toLowerCase();
  const rOK   = rRC.toLowerCase() === riskConsumerAddr.toLowerCase();

  console.log(`creForwarder              : ${cf}  ${fwdOK ? "✅" : "❌"}`);
  console.log(`BackingRatioPolicy.rc     : ${bRC}  ${bOK ? "✅" : "❌"}`);
  console.log(`LiquidityRatioPolicy.rc   : ${lRC}  ${lOK ? "✅" : "❌"}`);
  console.log(`RiskScorePolicy.rc        : ${rRC}  ${rOK ? "✅" : "❌"}`);

  const allOK = fwdOK && bOK && lOK && rOK;
  console.log("\n" + sep);
  if (allOK) {
    console.log("✅ All values correct.  onReport() will no longer revert.");
    console.log("\nRun next:");
    console.log("  npx hardhat run scripts/testE2E.ts --network sepolia");
  } else {
    console.log("❌ One or more values are still wrong — check errors above.");
    process.exit(1);
  }
  console.log(sep);
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("\n❌ fixACE.ts failed:\n", e.message); process.exit(1); });
