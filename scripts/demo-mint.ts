/**
 * scripts/demo-mint.ts — V4
 *
 * One-shot mint attempt. Reads on-chain V4 state, prints it, attempts mint.
 *
 * Usage:
 *   npx hardhat run scripts/demo-mint.ts --network sepolia
 *   $env:MINT_AMOUNT="500000"; npx hardhat run scripts/demo-mint.ts --network sepolia
 */

import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

const STABLECOIN_ABI = [
  "function getMintStatus() view returns (bool mintAllowed, string reason, uint16 backingPct, uint16 liquidityPct, uint16 riskScore, uint256 staleAge)",
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address account) view returns (uint256)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const stablecoinAddr = process.env.STABLECOIN_V2_ADDRESS;
  if (!stablecoinAddr) throw new Error("STABLECOIN_V2_ADDRESS not set in .env");

  const mintUsd = parseInt(process.env.MINT_AMOUNT || "100000");
  const mintAmount = ethers.parseEther(mintUsd.toString());
  const stablecoin = new ethers.Contract(stablecoinAddr, STABLECOIN_ABI, signer);

  const sep = "═".repeat(64);
  console.log(`\n${sep}`);
  console.log(`  Converge.fi V4 — Demo Mint Attempt`);
  console.log(sep);
  console.log(`  Stablecoin : ${stablecoinAddr}`);
  console.log(`  Mint ask   : $${mintUsd.toLocaleString()} cvUSD`);

  const [mintAllowed, reason, bk, lq, rs, staleAge] = await stablecoin.getMintStatus();
  console.log(`\n  On-chain risk state:`);
  console.log(`    Backing     : ${bk}%    (threshold ≥ 100%)`);
  console.log(`    Liquidity   : ${lq}%    (threshold ≥ 30%)`);
  console.log(`    Risk Score  : ${rs}     (threshold ≤ 70)`);
  console.log(`    Report age  : ${staleAge}s`);
  console.log(`\n  Gate: ${mintAllowed ? "✅ MINT ALLOWED" : `🔴 BLOCKED — "${reason}"`}`);

  const balBefore = await stablecoin.balanceOf(signer.address);
  console.log(`\n  Balance before: ${ethers.formatEther(balBefore)} cvUSD`);
  console.log(`  Calling mint()...`);

  try {
    const tx = await stablecoin.mint(signer.address, mintAmount);
    const receipt = await tx.wait();
    const balAfter = await stablecoin.balanceOf(signer.address);
    console.log(`\n${sep}`);
    console.log(`  ✅ MINT SUCCESS — $${mintUsd.toLocaleString()} cvUSD`);
    console.log(`  Balance now: ${ethers.formatEther(balAfter)} cvUSD`);
    console.log(`  Etherscan: https://sepolia.etherscan.io/tx/${tx.hash}`);
    console.log(sep);
  } catch (err: any) {
    const msg = err.message || "";
    let revert = "unknown";
    if (msg.includes("MintBlocked")) revert = "MintBlocked";
    else if (msg.includes("OnlyOperator")) revert = "OnlyOperator";
    else if (msg.includes("PolicyNotSet")) revert = "PolicyNotSet";
    else revert = msg.substring(0, 120);
    console.log(`\n${sep}`);
    console.log(`  🔴 MINT BLOCKED — ${revert}`);
    console.log(sep);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
