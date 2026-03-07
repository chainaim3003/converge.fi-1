/**
 * scripts/push-report.ts
 *
 * Manually pushes risk state on-chain by directly calling update() on each
 * of the three policy contracts (BackingRatioPolicy, LiquidityRatioPolicy,
 * RiskScorePolicy).
 *
 * Why this approach instead of calling onReport():
 *   onReport() is designed to be called by the Chainlink KeystoneForwarder,
 *   which wraps the report in a signed envelope before delivery. Calling it
 *   directly with raw ABI-encoded bytes does not match the format the
 *   forwarder uses. The policy update() functions are what mint() actually
 *   reads — so updating them directly is both correct and sufficient.
 *
 * What this script does:
 *   1. Reads policy contract addresses from RiskConsumerWithACE on-chain
 *   2. Restores creForwarder to Chainlink address if a previous run left it wrong
 *   3. Temporarily sets riskConsumer on each policy to your wallet
 *   4. Calls update() on each policy with the chosen values
 *   5. Restores riskConsumer on each policy to RiskConsumerWithACE
 *   6. Reads getMintStatus() to confirm mint is allowed or blocked
 *
 * Usage:
 *   Healthy report (mint allowed):
 *     npx hardhat run scripts/push-report.ts --network sepolia
 *
 *   Unhealthy backing (mint blocked — backing 88% < 100% threshold):
 *     $env:REPORT_MODE="unhealthy-backing"; npx hardhat run scripts/push-report.ts --network sepolia
 *
 *   Unhealthy liquidity (mint blocked — liquidity 5% < 10% threshold):
 *     $env:REPORT_MODE="unhealthy-liquidity"; npx hardhat run scripts/push-report.ts --network sepolia
 *
 *   Unhealthy risk score (mint blocked — score 85 > 70 threshold):
 *     $env:REPORT_MODE="unhealthy-score"; npx hardhat run scripts/push-report.ts --network sepolia
 */

import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

// ─── Deployed addresses — must be set in .env ─────────────────────────────────
if (!process.env.RISK_CONSUMER_ADDRESS) {
  throw new Error("RISK_CONSUMER_ADDRESS not set in .env");
}
if (!process.env.STABLECOIN_ADDRESS) {
  throw new Error("STABLECOIN_ADDRESS not set in .env");
}

const RISK_CONSUMER_ADDRESS = process.env.RISK_CONSUMER_ADDRESS;
const STABLECOIN_ADDRESS    = process.env.STABLECOIN_ADDRESS;

// Official Chainlink MockKeystoneForwarder on Ethereum Sepolia.
// Source: https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
// Used with: cre workflow simulate --broadcast
const CHAINLINK_MOCK_KEYSTONE_FORWARDER_SEPOLIA = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88";

// ─── ABIs — only functions this script calls ──────────────────────────────────

const RISK_CONSUMER_ABI = [
  "function creForwarder() view returns (address)",
  "function setCreForwarder(address) external",
  "function backingPolicy() view returns (address)",
  "function liquidityPolicy() view returns (address)",
  "function riskScorePolicy() view returns (address)",
  "function owner() view returns (address)",
];

const POLICY_ABI = [
  "function riskConsumer() view returns (address)",
  "function setRiskConsumer(address) external",
  "function update(uint16, uint40) external",         // BackingRatioPolicy + LiquidityRatioPolicy
  "function currentBps() view returns (uint16)",
  "function lastUpdated() view returns (uint40)",
  "function isHealthy() view returns (bool)",
  "function thresholdBps() view returns (uint16)",
];

const RISK_SCORE_ABI = [
  "function riskConsumer() view returns (address)",
  "function setRiskConsumer(address) external",
  "function update(uint8, uint40) external",          // RiskScorePolicy takes uint8 score
  "function currentScore() view returns (uint8)",
  "function lastUpdated() view returns (uint40)",
  "function isHealthy() view returns (bool)",
  "function threshold() view returns (uint8)",
];

const STABLECOIN_ABI = [
  "function getMintStatus() view returns (bool mintAllowed, string reason, uint16 backingBps, uint16 liquidityBps, uint8 riskScore, uint256 staleAge)",
];

// ─── Report presets ───────────────────────────────────────────────────────────
// Thresholds come from the deployed contracts:
//   BackingRatioPolicy:   thresholdBps = 10000 (100%)  — backing must be >= 10000
//   LiquidityRatioPolicy: thresholdBps = 1000  (10%)   — liquidity must be >= 1000
//   RiskScorePolicy:      threshold    = 70            — score must be <= 70

const PRESETS: Record<string, {
  label:             string;
  backingRatioBps:   number;
  liquidityRatioBps: number;
  riskScore:         number;
  expectMint:        boolean;
}> = {
  healthy: {
    label:             "HEALTHY — all gates pass → mint ALLOWED",
    backingRatioBps:   10200,  // 102% — above 100% threshold
    liquidityRatioBps: 4080,   // 40.8% — above 10% threshold
    riskScore:         10,     // 10 — below 70 threshold
    expectMint:        true,
  },
  "unhealthy-backing": {
    label:             "UNHEALTHY BACKING — 88% < 100% threshold → mint BLOCKED",
    backingRatioBps:   8800,   // 88% — below 10000 threshold
    liquidityRatioBps: 4080,
    riskScore:         10,
    expectMint:        false,
  },
  "unhealthy-liquidity": {
    label:             "UNHEALTHY LIQUIDITY — 5% < 10% threshold → mint BLOCKED",
    backingRatioBps:   10200,
    liquidityRatioBps: 500,    // 5% — below 1000 threshold
    riskScore:         10,
    expectMint:        false,
  },
  "unhealthy-score": {
    label:             "UNHEALTHY RISK SCORE — 85 > 70 threshold → mint BLOCKED",
    backingRatioBps:   10200,
    liquidityRatioBps: 4080,
    riskScore:         85,     // 85 — above 70 threshold
    expectMint:        false,
  },

  // ─── Demo presets (from ACTUS simulation of $500K reserve portfolio) ──────
  // Values derived by demo-runner.js from real ACTUS eventsBatch processing
  // of 5 PAM contracts (2 cash + 3 T-bills) in base_portfolio.json.
  // See: iter-fin-demo-1/DEMO-SCRIPT.md for full numbers cross-check.

  "demo-healthy": {
    label:             "DEMO PHASE A — $515K reserves / $500K supply, 103% backed, 25.2% liquid → mint ALLOWED",
    backingRatioBps:   10300,  // 103% — $515K / $500K
    liquidityRatioBps: 2520,   // 25.2% — $130K cash / $515K reserves
    riskScore:         10,     // low risk — all metrics healthy
    expectMint:        true,
  },
  "demo-stressed": {
    label:             "DEMO PHASE B — $100K cash withdrawn, 83% backed, 7.2% liquid → mint BLOCKED",
    backingRatioBps:   8300,   // 83% — $415K / $500K (cash dropped from $120K to $20K)
    liquidityRatioBps: 720,    // 7.2% — $30K cash / $415K reserves
    riskScore:         81,     // high risk — backing + liquidity both breached
    expectMint:        false,
  },
  "demo-restored": {
    label:             "DEMO PHASE C — T-bill early liq (3% penalty=$3,750) + $90K injection → mint ALLOWED",
    backingRatioBps:   10030,  // 100.3% — $501,250 / $500K
    liquidityRatioBps: 4810,   // 48.1% — $241,250 cash / $501,250 reserves
    riskScore:         15,     // low risk — all metrics restored
    expectMint:        true,
  },

  // ─── Demo v2 presets (circulating + mint ask supply model) ────────────
  // Supply = circulatingSupply + mintAsk. Phase A: 0+100K=100K. Phase B/C: 100K+100K=200K.
  // Key insight: Phase B backing PASSES (207%) but liquidity FAILS (7.2%).

  "demo-healthy-v2": {
    label:             "DEMO v2 PHASE A — $515K reserves / 100K supply (0 circ + 100K ask), 515% backed → mint ALLOWED",
    backingRatioBps:   30000,  // 515% clamped to uint16-safe 300% (above 100% threshold)
    liquidityRatioBps: 2524,   // 25.2% — $130K cash / $515K reserves
    riskScore:         0,      // all metrics healthy
    expectMint:        true,
  },
  "demo-stressed-v2": {
    label:             "DEMO v2 PHASE B — $415K reserves / 200K supply, backing 207% PASSES but liquidity 7.2% FAILS → BLOCKED",
    backingRatioBps:   20750,  // 207.5% — $415K / $200K — PASSES 100% threshold!
    liquidityRatioBps: 723,    // 7.2% — $30K cash / $415K reserves — FAILS 10% threshold
    riskScore:         34,     // moderate (concentration penalty) but below 70 threshold
    expectMint:        false,
  },
  "demo-restored-v2": {
    label:             "DEMO v2 PHASE C — $501K reserves / 200K supply, early liq + injection restores liquidity → mint ALLOWED",
    backingRatioBps:   25063,  // 250.6% — $501,250 / $200K
    liquidityRatioBps: 4813,   // 48.1% — $241,250 cash / $501,250 reserves
    riskScore:         0,      // all metrics restored
    expectMint:        true,
  },
};

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [signer] = await ethers.getSigners();
  const network  = await ethers.provider.getNetwork();

  const mode   = process.env.REPORT_MODE || "healthy";
  const preset = PRESETS[mode];
  if (!preset) {
    throw new Error(
      `Unknown REPORT_MODE="${mode}". Valid: ${Object.keys(PRESETS).join(", ")}`
    );
  }

  console.log("─".repeat(64));
  console.log("push-report.ts — Direct Policy Update");
  console.log("─".repeat(64));
  console.log(`Network      : ${network.name} (chainId ${network.chainId})`);
  console.log(`Signer       : ${signer.address}`);
  console.log(`RiskConsumer : ${RISK_CONSUMER_ADDRESS}`);
  console.log(`Stablecoin   : ${STABLECOIN_ADDRESS}`);
  console.log(`Mode         : ${mode}`);
  console.log(`Report       : ${preset.label}`);
  console.log("");
  console.log(`  backingRatioBps   = ${preset.backingRatioBps} (${(preset.backingRatioBps / 100).toFixed(2)}%)`);
  console.log(`  liquidityRatioBps = ${preset.liquidityRatioBps} (${(preset.liquidityRatioBps / 100).toFixed(2)}%)`);
  console.log(`  riskScore         = ${preset.riskScore}`);
  console.log("─".repeat(64));
  console.log("");

  const riskConsumer = new ethers.Contract(RISK_CONSUMER_ADDRESS, RISK_CONSUMER_ABI, signer);
  const stablecoin   = new ethers.Contract(STABLECOIN_ADDRESS,    STABLECOIN_ABI,    signer);

  // ── Step 1: Read policy addresses from RiskConsumerWithACE ─────────────────
  const backingAddr   = await riskConsumer.backingPolicy();
  const liquidityAddr = await riskConsumer.liquidityPolicy();
  const riskScoreAddr = await riskConsumer.riskScorePolicy();

  console.log(`Step 1: Policy addresses read from RiskConsumerWithACE`);
  console.log(`        BackingRatioPolicy   : ${backingAddr}`);
  console.log(`        LiquidityRatioPolicy : ${liquidityAddr}`);
  console.log(`        RiskScorePolicy      : ${riskScoreAddr}`);
  console.log("");

  if (
    backingAddr   === ethers.ZeroAddress ||
    liquidityAddr === ethers.ZeroAddress ||
    riskScoreAddr === ethers.ZeroAddress
  ) {
    throw new Error("One or more policy addresses are address(0) — setPolicies was not called");
  }

  const backingPolicy   = new ethers.Contract(backingAddr,   POLICY_ABI,     signer);
  const liquidityPolicy = new ethers.Contract(liquidityAddr, POLICY_ABI,     signer);
  const riskScorePolicy = new ethers.Contract(riskScoreAddr, RISK_SCORE_ABI, signer);

  // ── Step 2: Restore creForwarder if a previous run left it as the wallet ───
  const currentForwarder = await riskConsumer.creForwarder();
  if (currentForwarder.toLowerCase() !== CHAINLINK_MOCK_KEYSTONE_FORWARDER_SEPOLIA.toLowerCase()) {
    console.log(`Step 2: creForwarder is ${currentForwarder} (not the Chainlink forwarder)`);
    console.log(`        Restoring to Chainlink MockKeystoneForwarder...`);
    const tx = await riskConsumer.setCreForwarder(CHAINLINK_MOCK_KEYSTONE_FORWARDER_SEPOLIA);
    await tx.wait();
    console.log(`        ✅ Restored (tx: ${tx.hash})`);
  } else {
    console.log(`Step 2: creForwarder is already Chainlink MockKeystoneForwarder ✅`);
  }
  console.log("");

  // ── Step 3: Temporarily set riskConsumer to signer on all 3 policies ───────
  // This allows our wallet to call update() on each policy directly.
  const timestamp = BigInt(Math.floor(Date.now() / 1000));

  console.log(`Step 3: Setting riskConsumer → signer on all 3 policies...`);

  const txB1 = await backingPolicy.setRiskConsumer(signer.address);
  await txB1.wait();
  console.log(`        BackingRatioPolicy   riskConsumer set ✅ (tx: ${txB1.hash})`);

  const txL1 = await liquidityPolicy.setRiskConsumer(signer.address);
  await txL1.wait();
  console.log(`        LiquidityRatioPolicy riskConsumer set ✅ (tx: ${txL1.hash})`);

  const txR1 = await riskScorePolicy.setRiskConsumer(signer.address);
  await txR1.wait();
  console.log(`        RiskScorePolicy      riskConsumer set ✅ (tx: ${txR1.hash})`);
  console.log("");

  // ── Step 4: Call update() on each policy ───────────────────────────────────
  console.log(`Step 4: Calling update() on each policy with timestamp=${timestamp}...`);

  const txB2 = await backingPolicy.update(preset.backingRatioBps, timestamp);
  await txB2.wait();
  console.log(`        BackingRatioPolicy   updated to ${preset.backingRatioBps}bps ✅ (tx: ${txB2.hash})`);

  const txL2 = await liquidityPolicy.update(preset.liquidityRatioBps, timestamp);
  await txL2.wait();
  console.log(`        LiquidityRatioPolicy updated to ${preset.liquidityRatioBps}bps ✅ (tx: ${txL2.hash})`);

  const txR2 = await riskScorePolicy.update(preset.riskScore, timestamp);
  await txR2.wait();
  console.log(`        RiskScorePolicy      updated to score=${preset.riskScore} ✅ (tx: ${txR2.hash})`);
  console.log("");

  // ── Step 5: Restore riskConsumer on all 3 policies to RiskConsumerWithACE ──
  console.log(`Step 5: Restoring riskConsumer → RiskConsumerWithACE on all 3 policies...`);

  const txB3 = await backingPolicy.setRiskConsumer(RISK_CONSUMER_ADDRESS);
  await txB3.wait();
  console.log(`        BackingRatioPolicy   restored ✅ (tx: ${txB3.hash})`);

  const txL3 = await liquidityPolicy.setRiskConsumer(RISK_CONSUMER_ADDRESS);
  await txL3.wait();
  console.log(`        LiquidityRatioPolicy restored ✅ (tx: ${txL3.hash})`);

  const txR3 = await riskScorePolicy.setRiskConsumer(RISK_CONSUMER_ADDRESS);
  await txR3.wait();
  console.log(`        RiskScorePolicy      restored ✅ (tx: ${txR3.hash})`);
  console.log("");

  // ── Step 6: Verify on-chain policy state ───────────────────────────────────
  const [backingHealthy, liquidityHealthy, scoreHealthy] = await Promise.all([
    backingPolicy.isHealthy(),
    liquidityPolicy.isHealthy(),
    riskScorePolicy.isHealthy(),
  ]);
  const [currentBacking, currentLiquidity, currentScore] = await Promise.all([
    backingPolicy.currentBps(),
    liquidityPolicy.currentBps(),
    riskScorePolicy.currentScore(),
  ]);

  console.log(`Step 6: On-chain policy state after update:`);
  console.log(`        BackingRatioPolicy   : ${currentBacking}bps (${(Number(currentBacking)/100).toFixed(2)}%) — healthy=${backingHealthy}`);
  console.log(`        LiquidityRatioPolicy : ${currentLiquidity}bps (${(Number(currentLiquidity)/100).toFixed(2)}%) — healthy=${liquidityHealthy}`);
  console.log(`        RiskScorePolicy      : score=${currentScore} — healthy=${scoreHealthy}`);
  console.log("");

  // ── Step 7: Check getMintStatus ────────────────────────────────────────────
  const [mintAllowed, reason, backingBps, liquidityBps, riskScore, staleAge] =
    await stablecoin.getMintStatus();

  console.log(`Step 7: getMintStatus():`);
  console.log(`        mintAllowed = ${mintAllowed}`);
  console.log(`        reason      = ${reason}`);
  console.log(`        backingBps  = ${backingBps} (${(Number(backingBps)/100).toFixed(2)}%)`);
  console.log(`        liquidityBps= ${liquidityBps} (${(Number(liquidityBps)/100).toFixed(2)}%)`);
  console.log(`        riskScore   = ${riskScore}`);
  console.log(`        staleAge    = ${staleAge}s`);
  console.log("");

  if (mintAllowed !== preset.expectMint) {
    console.log(`⚠️  Unexpected: expected mintAllowed=${preset.expectMint} but got ${mintAllowed}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("─".repeat(64));
  if (mintAllowed) {
    console.log("✅ Policies updated. Mint is NOW ALLOWED.");
    console.log("");
    console.log("Run a mint:");
    console.log("  npx hardhat console --network sepolia");
    console.log(`  > const s = await ethers.getContractAt("ConvergeStablecoin", "${STABLECOIN_ADDRESS}")`);
    console.log(`  > const [w] = await ethers.getSigners()`);
    console.log(`  > await s.mint(w.address, ethers.parseEther("750"))`);
  } else {
    console.log(`🚫 Policies updated. Mint is BLOCKED — reason: ${reason}`);
    console.log("   Circuit breaker is working correctly.");
    console.log("   Run without REPORT_MODE (or REPORT_MODE=healthy) to allow minting.");
  }
  console.log("─".repeat(64));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
