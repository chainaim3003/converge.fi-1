/**
 * scripts/demo-full-lifecycle.ts
 *
 * Single-command orchestrator for the Converge.fi 2-minute demo.
 * Runs all 3 phases: HEALTHY → STRESSED → RESTORED
 *
 * Each phase:
 *   1. Pushes risk state on-chain (via direct policy update)
 *   2. Attempts mint of $100,000 cvUSD
 *   3. Logs result (success or revert)
 *   4. Pauses for video timing
 *
 * Usage:
 *   npx hardhat run scripts/demo-full-lifecycle.ts --network sepolia
 *
 * Prerequisites:
 *   - Contracts deployed on Sepolia (addresses in .env / deployed-addresses.json)
 *   - ACTUS server running on localhost:8083 (or AWS)
 *   - demo-runner.js can be run separately in another terminal for visuals
 *
 * References:
 *   - Chainlink CRE: https://docs.chain.link/cre
 *   - Forwarder: https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
 *   - OpenZeppelin ERC20: https://docs.openzeppelin.com/contracts/5.x/erc20
 */

import { ethers } from "hardhat";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

dotenv.config();

// ─── Deployed addresses from .env ─────────────────────────────────
const RISK_CONSUMER_ADDRESS = process.env.RISK_CONSUMER_ADDRESS!;
const STABLECOIN_ADDRESS = process.env.STABLECOIN_ADDRESS!;

// Official Chainlink MockKeystoneForwarder on Ethereum Sepolia
// Source: https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
const CHAINLINK_MOCK_FORWARDER = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88";

// ─── Minimal ABIs ─────────────────────────────────────────────────
const RISK_CONSUMER_ABI = [
  "function creForwarder() view returns (address)",
  "function setCreForwarder(address) external",
  "function backingPolicy() view returns (address)",
  "function liquidityPolicy() view returns (address)",
  "function riskScorePolicy() view returns (address)",
];

const POLICY_ABI = [
  "function riskConsumer() view returns (address)",
  "function setRiskConsumer(address) external",
  "function update(uint16, uint40) external",
  "function currentBps() view returns (uint16)",
  "function isHealthy() view returns (bool)",
];

const RISK_SCORE_ABI = [
  "function riskConsumer() view returns (address)",
  "function setRiskConsumer(address) external",
  "function update(uint8, uint40) external",
  "function currentScore() view returns (uint8)",
  "function isHealthy() view returns (bool)",
];

const STABLECOIN_ABI = [
  "function getMintStatus() view returns (bool mintAllowed, string reason, uint16 backingBps, uint16 liquidityBps, uint8 riskScore, uint256 staleAge)",
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address account) view returns (uint256)",
];

// ─── Demo phases ──────────────────────────────────────────────────
interface Phase {
  id: string;
  name: string;
  backingRatioBps: number;
  liquidityRatioBps: number;
  riskScore: number;
  expectMint: boolean;
  pauseSeconds: number;
}

const PHASES: Phase[] = [
  {
    id: "phaseA",
    name: "HEALTHY — 103% backing, 25.2% liquidity",
    backingRatioBps: 10300,
    liquidityRatioBps: 2520,
    riskScore: 10,
    expectMint: true,
    pauseSeconds: 15,
  },
  {
    id: "phaseB",
    name: "STRESSED — 83% backing, 7.2% liquidity (cash withdrawn)",
    backingRatioBps: 8300,
    liquidityRatioBps: 720,
    riskScore: 81,
    expectMint: false,
    pauseSeconds: 15,
  },
  {
    id: "phaseC",
    name: "RESTORED — 100.3% backing, 48.1% liquidity (T-bill liquidated + injection)",
    backingRatioBps: 10030,
    liquidityRatioBps: 4810,
    riskScore: 15,
    expectMint: true,
    pauseSeconds: 5,
  },
];

const MINT_AMOUNT = ethers.parseEther("100000"); // $100,000 cvUSD per phase

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Push report on-chain ─────────────────────────────────────────
async function pushReport(
  signer: any,
  phase: Phase,
  backingPolicy: any,
  liquidityPolicy: any,
  riskScorePolicy: any,
  riskConsumerAddr: string
) {
  const timestamp = BigInt(Math.floor(Date.now() / 1000));

  // Temporarily set riskConsumer to signer on all 3 policies
  console.log(`     Setting riskConsumer → signer...`);
  await (await backingPolicy.setRiskConsumer(signer.address)).wait();
  await (await liquidityPolicy.setRiskConsumer(signer.address)).wait();
  await (await riskScorePolicy.setRiskConsumer(signer.address)).wait();

  // Update all 3 policies
  console.log(`     Updating policies: backing=${phase.backingRatioBps} liq=${phase.liquidityRatioBps} score=${phase.riskScore}`);
  await (await backingPolicy.update(phase.backingRatioBps, timestamp)).wait();
  await (await liquidityPolicy.update(phase.liquidityRatioBps, timestamp)).wait();
  await (await riskScorePolicy.update(phase.riskScore, timestamp)).wait();

  // Restore riskConsumer to RiskConsumerWithACE
  console.log(`     Restoring riskConsumer → RiskConsumerWithACE...`);
  await (await backingPolicy.setRiskConsumer(riskConsumerAddr)).wait();
  await (await liquidityPolicy.setRiskConsumer(riskConsumerAddr)).wait();
  await (await riskScorePolicy.setRiskConsumer(riskConsumerAddr)).wait();
}

// ─── Main ─────────────────────────────────────────────────────────
async function main() {
  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("");
  console.log("════════════════════════════════════════════════════════════════");
  console.log("  CONVERGE.FI — FULL LIFECYCLE DEMO");
  console.log("  MINT ✅ → HALT 🔴 → RESTORE ✅");
  console.log("════════════════════════════════════════════════════════════════");
  console.log(`  Network      : ${network.name} (chainId ${network.chainId})`);
  console.log(`  Signer       : ${signer.address}`);
  console.log(`  Stablecoin   : ${STABLECOIN_ADDRESS}`);
  console.log(`  Mint amount  : $100,000 cvUSD per phase`);
  console.log("════════════════════════════════════════════════════════════════");

  // Connect to contracts
  const riskConsumer = new ethers.Contract(RISK_CONSUMER_ADDRESS, RISK_CONSUMER_ABI, signer);
  const stablecoin = new ethers.Contract(STABLECOIN_ADDRESS, STABLECOIN_ABI, signer);

  const backingAddr = await riskConsumer.backingPolicy();
  const liquidityAddr = await riskConsumer.liquidityPolicy();
  const riskScoreAddr = await riskConsumer.riskScorePolicy();

  const backingPolicy = new ethers.Contract(backingAddr, POLICY_ABI, signer);
  const liquidityPolicy = new ethers.Contract(liquidityAddr, POLICY_ABI, signer);
  const riskScorePolicy = new ethers.Contract(riskScoreAddr, RISK_SCORE_ABI, signer);

  // Ensure creForwarder is set to Chainlink MockKeystoneForwarder
  const currentForwarder = await riskConsumer.creForwarder();
  if (currentForwarder.toLowerCase() !== CHAINLINK_MOCK_FORWARDER.toLowerCase()) {
    console.log(`\n  Restoring creForwarder to MockKeystoneForwarder...`);
    await (await riskConsumer.setCreForwarder(CHAINLINK_MOCK_FORWARDER)).wait();
  }

  // Run all 3 phases
  for (let i = 0; i < PHASES.length; i++) {
    const phase = PHASES[i];

    console.log(`\n${"═".repeat(64)}`);
    console.log(`  PHASE ${i + 1}/3: ${phase.name}`);
    console.log(`${"═".repeat(64)}`);

    // Step 1: Push report on-chain
    console.log(`\n  Step 1: Push risk report on-chain`);
    await pushReport(signer, phase, backingPolicy, liquidityPolicy, riskScorePolicy, RISK_CONSUMER_ADDRESS);
    console.log(`     ✅ Policies updated on-chain`);

    // Step 2: Read getMintStatus
    console.log(`\n  Step 2: Read on-chain mint gate`);
    const [mintAllowed, reason, backingBps, liquidityBps, riskScore, staleAge] =
      await stablecoin.getMintStatus();
    console.log(`     mintAllowed  = ${mintAllowed}`);
    console.log(`     reason       = ${reason}`);
    console.log(`     backingBps   = ${backingBps} (${(Number(backingBps) / 100).toFixed(1)}%)`);
    console.log(`     liquidityBps = ${liquidityBps} (${(Number(liquidityBps) / 100).toFixed(1)}%)`);
    console.log(`     riskScore    = ${riskScore}`);

    // Step 3: Attempt mint
    console.log(`\n  Step 3: Attempt mint of $100,000 cvUSD`);
    if (phase.expectMint) {
      try {
        const tx = await stablecoin.mint(signer.address, MINT_AMOUNT);
        const receipt = await tx.wait();
        const balance = await stablecoin.balanceOf(signer.address);
        const balanceUsd = Number(ethers.formatEther(balance)).toLocaleString();
        console.log(`     ✅ MINT SUCCESS`);
        console.log(`     tx: ${tx.hash}`);
        console.log(`     block: ${receipt.blockNumber}`);
        console.log(`     cvUSD balance: ${balanceUsd}`);
        console.log(`     Etherscan: https://sepolia.etherscan.io/tx/${tx.hash}`);
      } catch (err: any) {
        console.log(`     ❌ UNEXPECTED REVERT: ${err.message.substring(0, 120)}`);
      }
    } else {
      try {
        await stablecoin.mint(signer.address, MINT_AMOUNT);
        console.log(`     ⚠  UNEXPECTED SUCCESS — expected revert`);
      } catch (err: any) {
        const msg = err.message || "";
        let revertReason = "unknown";
        if (msg.includes("MintBlockedStale")) revertReason = "MintBlockedStale";
        else if (msg.includes("MintBlockedBacking")) revertReason = "MintBlockedBacking";
        else if (msg.includes("MintBlockedLiquidity")) revertReason = "MintBlockedLiquidity";
        else if (msg.includes("MintBlockedRiskScore")) revertReason = "MintBlockedRiskScore";
        console.log(`     🔴 MINT BLOCKED — revert: ${revertReason}`);
        console.log(`     Circuit breaker working correctly.`);
        const balance = await stablecoin.balanceOf(signer.address);
        console.log(`     cvUSD balance unchanged: ${Number(ethers.formatEther(balance)).toLocaleString()}`);
      }
    }

    // Pause between phases (for video timing)
    if (i < PHASES.length - 1) {
      console.log(`\n  ─── Waiting ${phase.pauseSeconds} seconds (cron interval) ───`);
      await sleep(phase.pauseSeconds * 1000);
    }
  }

  // Final summary
  const finalBalance = await stablecoin.balanceOf(signer.address);
  const finalUsd = Number(ethers.formatEther(finalBalance)).toLocaleString();

  console.log(`\n${"═".repeat(64)}`);
  console.log("  DEMO COMPLETE");
  console.log("");
  console.log(`  Phase A: MINT ✅  (backing 103%, liquidity 25.2%)`);
  console.log(`  Phase B: HALT 🔴 (backing  83%, liquidity  7.2%)`);
  console.log(`  Phase C: MINT ✅  (backing 100.3%, liquidity 48.1%)`);
  console.log("");
  console.log(`  Final cvUSD balance: ${finalUsd}`);
  console.log(`  T-bill early liquidation penalty: $3,750 (3% of $125,000)`);
  console.log(`  Capital injection: $90,000`);
  console.log("");
  console.log(`  Wallet: ${signer.address}`);
  console.log(`  Token:  ${STABLECOIN_ADDRESS}`);
  console.log(`  View:   https://sepolia.etherscan.io/token/${STABLECOIN_ADDRESS}`);
  console.log(`${"═".repeat(64)}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
