/**
 * scripts/simulate-mint.ts — V4
 *
 * Continuous randomized minting simulator. Reads V4 getMintStatus() (uint16 fields).
 *
 * Usage:
 *   npx ts-node scripts/simulate-mint.ts
 */

import { ethers } from "ethers";
import * as dotenv from "dotenv";
import * as path from "path";
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const STABLECOIN_ADDRESS = process.env.STABLECOIN_V2_ADDRESS
  || "0x19b6B9434D077DF9DFcE82be3568b4c0B39e6568";

const STABLECOIN_ABI = [
  "function getMintStatus() view returns (bool mintAllowed, string reason, uint16 backingPct, uint16 liquidityPct, uint16 riskScore, uint256 staleAge)",
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address account) view returns (uint256)",
];

function randInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
function ts(): string { return new Date().toISOString().replace("T", " ").substring(0, 19); }
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  const privateKey = process.env.PRIVATE_KEY;
  if (!rpcUrl || !privateKey) throw new Error("SEPOLIA_RPC_URL and PRIVATE_KEY must be set");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const stablecoin = new ethers.Contract(STABLECOIN_ADDRESS, STABLECOIN_ABI, wallet);

  console.log("============================================");
  console.log("  Converge.fi V4 Mint Simulator");
  console.log("============================================");
  console.log(`  Stablecoin : ${STABLECOIN_ADDRESS}`);
  console.log(`  Press Ctrl+C to stop.`);
  console.log("============================================\n");

  let cycleCount = 0;
  let totalMinted = 0n;

  while (true) {
    cycleCount++;
    const waitMin = randInt(1, 5);
    console.log(`[${ts()}] Cycle #${cycleCount} — waiting ${waitMin} min...`);
    await sleep(waitMin * 60 * 1000);

    const mints = randInt(1, 2);
    for (let i = 0; i < mints; i++) {
      const usd = randInt(500, 1000);
      const amount = ethers.parseEther(usd.toString());

      try {
        const [allowed, reason, bk, lq, rs, age] = await stablecoin.getMintStatus();
        console.log(`[${ts()}]   backing=${bk}% liquidity=${lq}% riskScore=${rs} stale=${age}s`);

        if (!allowed) { console.log(`[${ts()}]   🚫 HALTED — ${reason}`); continue; }

        const tx = await stablecoin.mint(wallet.address, amount);
        await tx.wait();
        totalMinted += amount;
        console.log(`[${ts()}]   ✅ MINTED $${usd} | total=$${Number(ethers.formatEther(totalMinted)).toFixed(0)}`);
      } catch (err: any) {
        console.log(`[${ts()}]   🚫 ${err.message.substring(0, 100)}`);
      }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
