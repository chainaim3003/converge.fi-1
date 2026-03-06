/**
 * scripts/simulate-mint.ts
 *
 * Simulates a continuous randomised minting process.
 *
 * Behaviour:
 *   - Waits a random interval between 1 and 5 minutes between cycles
 *   - Each cycle attempts 1 or 2 mints (random)
 *   - Each mint is for a random USD amount between 500 and 1000 USD
 *   - Before every mint attempt, reads getMintStatus() from on-chain
 *   - If healthy  → calls mint(), logs success
 *   - If unhealthy → logs the exact reason and halts that attempt (does not revert)
 *
 * Run:
 *   npx ts-node scripts/simulate-mint.ts
 *
 * Requirements:
 *   - .env must have SEPOLIA_RPC_URL and PRIVATE_KEY
 *   - Risk engine must be running (port 3001)
 *   - simulate-cron.ps1 must be running in another terminal
 */

import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

// ─── Contract addresses (from deployed-addresses / .env) ─────────────────────
const STABLECOIN_ADDRESS = process.env.STABLECOIN_ADDRESS
  || "0x8D8131547Ec5Cb2fF1bB941a28fA20e347A928F3";

// ─── Minimal ABIs — only what we need ────────────────────────────────────────
const STABLECOIN_ABI = [
  "function getMintStatus() view returns (bool mintAllowed, string reason, uint16 backingBps, uint16 liquidityBps, uint8 riskScore, uint256 staleAge)",
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address account) view returns (uint256)",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Random integer between min and max inclusive */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Current timestamp string for logs */
function ts(): string {
  return new Date().toISOString().replace("T", " ").substring(0, 19);
}

/** Sleep for ms milliseconds */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Format bps as percentage string */
function bpsToPercent(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}

// ─── Main loop ───────────────────────────────────────────────────────────────

async function main() {
  // Connect to Sepolia
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (!rpcUrl) throw new Error("SEPOLIA_RPC_URL not set in .env");

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY not set in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const stablecoin = new ethers.Contract(STABLECOIN_ADDRESS, STABLECOIN_ABI, wallet);

  const network = await provider.getNetwork();

  console.log("");
  console.log("============================================");
  console.log("  Converge.fi Mint Simulator");
  console.log("============================================");
  console.log(`  Network    : ${network.name} (chainId ${network.chainId})`);
  console.log(`  Wallet     : ${wallet.address}`);
  console.log(`  Stablecoin : ${STABLECOIN_ADDRESS}`);
  console.log(`  Arrival    : 1-2 mints per cycle, every 1-5 minutes`);
  console.log(`  Amount     : $500 - $1000 USD per mint`);
  console.log(`  Press Ctrl+C to stop.`);
  console.log("============================================");
  console.log("");

  let cycleCount = 0;
  let totalMinted = 0n;
  let totalAttempts = 0;
  let totalBlocked = 0;

  while (true) {
    cycleCount++;

    // Random wait between 1 and 5 minutes before this cycle
    const waitMinutes = randInt(1, 5);
    const waitMs = waitMinutes * 60 * 1000;
    console.log(`[${ts()}] Cycle #${cycleCount} — next arrival in ${waitMinutes} minute(s)...`);
    await sleep(waitMs);

    // Random number of mint attempts this cycle: 1 or 2
    const mintsThisCycle = randInt(1, 2);
    console.log(`[${ts()}] --- Cycle #${cycleCount} | ${mintsThisCycle} mint attempt(s) ---`);

    for (let i = 0; i < mintsThisCycle; i++) {
      totalAttempts++;

      // Random USD amount: 500 to 1000
      const usdAmount = randInt(500, 1000);
      const amountWei = ethers.parseEther(usdAmount.toString());

      console.log(`[${ts()}]   Attempt ${i + 1}/${mintsThisCycle} — $${usdAmount} USD`);

      // Step 1: Read on-chain health from last CRE report
      let mintAllowed: boolean;
      let reason: string;
      let backingBps: number;
      let liquidityBps: number;
      let riskScore: number;
      let staleAge: bigint;

      try {
        [mintAllowed, reason, backingBps, liquidityBps, riskScore, staleAge] =
          await stablecoin.getMintStatus();
      } catch (err: any) {
        console.log(`[${ts()}]   ❌ getMintStatus() failed: ${err.message}`);
        continue;
      }

      // Step 2: Log the on-chain report health
      console.log(`[${ts()}]   On-chain health:`);
      console.log(`[${ts()}]     backing  = ${bpsToPercent(backingBps)} | liquidity = ${bpsToPercent(liquidityBps)} | riskScore = ${riskScore} | staleAge = ${staleAge}s`);

      // Step 3: Decision — mint or halt
      if (!mintAllowed) {
        totalBlocked++;
        console.log(`[${ts()}]   🚫 HALTED — reason: ${reason}`);
        continue;
      }

      // Step 4: All gates healthy — execute mint
      console.log(`[${ts()}]   ✅ Health OK — executing mint($${usdAmount} USD)...`);

      try {
        const tx = await stablecoin.mint(wallet.address, amountWei);
        console.log(`[${ts()}]   📤 tx submitted: ${tx.hash}`);
        const receipt = await tx.wait();
        totalMinted += amountWei;
        console.log(`[${ts()}]   ✅ MINTED $${usdAmount} USD — block ${receipt.blockNumber}`);
      } catch (err: any) {
        totalBlocked++;
        // Parse revert reason from error message
        const msg = err.message || "";
        if (msg.includes("MintBlockedStale"))    console.log(`[${ts()}]   🚫 REVERTED — MintBlockedStale (report too old, wait for cron)`);
        else if (msg.includes("MintBlockedBacking"))  console.log(`[${ts()}]   🚫 REVERTED — MintBlockedBacking`);
        else if (msg.includes("MintBlockedLiquidity")) console.log(`[${ts()}]   🚫 REVERTED — MintBlockedLiquidity`);
        else if (msg.includes("MintBlockedRiskScore")) console.log(`[${ts()}]   🚫 REVERTED — MintBlockedRiskScore`);
        else console.log(`[${ts()}]   🚫 REVERTED — ${msg.substring(0, 120)}`);
      }

      // Small gap between multiple mints in same cycle
      if (i < mintsThisCycle - 1) {
        await sleep(3000);
      }
    }

    // Print running totals after each cycle
    const totalMintedUsd = Number(ethers.formatEther(totalMinted)).toFixed(2);
    console.log(`[${ts()}]   📊 Running totals: attempts=${totalAttempts} blocked=${totalBlocked} minted=$${totalMintedUsd} USD`);
    console.log("");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
