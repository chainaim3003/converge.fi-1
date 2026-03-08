/**
 * scripts/demo-full-lifecycle.ts — V4
 *
 * Single-command orchestrator: HEALTHY → STRESSED → RESTORED
 * Uses MultiAttributeRiskPolicy.updateReport(8 fields) directly.
 *
 * Usage:
 *   npx hardhat run scripts/demo-full-lifecycle.ts --network sepolia
 */

import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

const POLICY_ADDRESS = process.env.RISK_POLICY_ADDRESS!;
const CONSUMER_ADDRESS = process.env.RISK_CONSUMER_V2_ADDRESS!;
const STABLECOIN_ADDRESS = process.env.STABLECOIN_V2_ADDRESS!;

if (!POLICY_ADDRESS || !STABLECOIN_ADDRESS) {
  throw new Error("RISK_POLICY_ADDRESS and STABLECOIN_V2_ADDRESS must be set in .env");
}

const POLICY_ABI = [
  "function updateReport(uint16,uint16,uint16,uint16,uint40,bytes32,uint16,uint16) external",
  "function setAuthorizedConsumer(address) external",
  "function authorizedConsumer() view returns (address)",
];

const STABLECOIN_ABI = [
  "function getMintStatus() view returns (bool mintAllowed, string reason, uint16 backingPct, uint16 liquidityPct, uint16 riskScore, uint256 staleAge)",
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address account) view returns (uint256)",
];

interface Phase {
  name: string;
  backingPct: number; liquidityPct: number; riskScore: number;
  maturityGapDays: number; assetEligibilityPct: number; custodianDiversityScore: number;
  expectMint: boolean; pauseSeconds: number;
}

const PHASES: Phase[] = [
  { name: "PHASE A — HEALTHY (riskScore=0, all gates pass)",
    backingPct: 490, liquidityPct: 69, riskScore: 0,
    maturityGapDays: 21, assetEligibilityPct: 100, custodianDiversityScore: 80,
    expectMint: true, pauseSeconds: 10 },
  { name: "PHASE B — STRESSED (riskScore=71, 3 gates fail)",
    backingPct: 140, liquidityPct: 4, riskScore: 71,
    maturityGapDays: 174, assetEligibilityPct: 57, custodianDiversityScore: 50,
    expectMint: false, pauseSeconds: 10 },
  { name: "PHASE C — RESTORED (riskScore=9, all gates pass)",
    backingPct: 182, liquidityPct: 59, riskScore: 9,
    maturityGapDays: 21, assetEligibilityPct: 100, custodianDiversityScore: 54,
    expectMint: true, pauseSeconds: 5 },
];

const MINT_AMOUNT = ethers.parseEther("100000");
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("════════════════════════════════════════════════════════════════");
  console.log("  CONVERGE.FI V4 — FULL LIFECYCLE DEMO");
  console.log("  MINT ✅ → HALT 🔴 → RESTORE ✅");
  console.log("════════════════════════════════════════════════════════════════");
  console.log(`  Network    : ${network.name}`);
  console.log(`  Policy     : ${POLICY_ADDRESS}`);
  console.log(`  Stablecoin : ${STABLECOIN_ADDRESS}`);
  console.log("════════════════════════════════════════════════════════════════");

  const policy = new ethers.Contract(POLICY_ADDRESS, POLICY_ABI, signer);
  const stablecoin = new ethers.Contract(STABLECOIN_ADDRESS, STABLECOIN_ABI, signer);

  // Save and temporarily override authorizedConsumer
  const originalConsumer = await policy.authorizedConsumer();

  for (let i = 0; i < PHASES.length; i++) {
    const p = PHASES[i];
    console.log(`\n${"═".repeat(64)}`);
    console.log(`  ${p.name}`);
    console.log(`${"═".repeat(64)}`);

    // Push report
    console.log(`\n  Step 1: Push risk report on-chain`);
    await (await policy.setAuthorizedConsumer(signer.address)).wait();
    const ts = BigInt(Math.floor(Date.now() / 1000));
    const hash = ethers.keccak256(ethers.toUtf8Bytes("demo-phase-" + i));
    await (await policy.updateReport(
      p.backingPct, p.liquidityPct, p.riskScore, p.maturityGapDays,
      ts, hash, p.assetEligibilityPct, p.custodianDiversityScore
    )).wait();
    await (await policy.setAuthorizedConsumer(originalConsumer)).wait();
    console.log(`     ✅ Policies updated`);

    // Read gate
    console.log(`\n  Step 2: Read mint gate`);
    const [allowed, reason, bk, lq, rs, age] = await stablecoin.getMintStatus();
    console.log(`     mintAllowed=${allowed} reason="${reason}"`);
    console.log(`     backing=${bk}% liquidity=${lq}% riskScore=${rs}`);

    // Attempt mint
    console.log(`\n  Step 3: Attempt mint $100,000 cvUSD`);
    if (p.expectMint) {
      try {
        const tx = await stablecoin.mint(signer.address, MINT_AMOUNT);
        await tx.wait();
        const bal = await stablecoin.balanceOf(signer.address);
        console.log(`     ✅ MINT SUCCESS — balance: ${ethers.formatEther(bal)} cvUSD`);
      } catch (err: any) { console.log(`     ❌ UNEXPECTED REVERT: ${err.message.substring(0, 100)}`); }
    } else {
      try {
        await stablecoin.mint(signer.address, MINT_AMOUNT);
        console.log(`     ⚠  UNEXPECTED SUCCESS`);
      } catch { console.log(`     🔴 MINT BLOCKED — circuit breaker working correctly`); }
    }

    if (i < PHASES.length - 1) {
      console.log(`\n  ─── Waiting ${p.pauseSeconds}s ───`);
      await sleep(p.pauseSeconds * 1000);
    }
  }

  const finalBal = await stablecoin.balanceOf(signer.address);
  console.log(`\n${"═".repeat(64)}`);
  console.log(`  DEMO COMPLETE — Final cvUSD balance: ${ethers.formatEther(finalBal)}`);
  console.log(`${"═".repeat(64)}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
