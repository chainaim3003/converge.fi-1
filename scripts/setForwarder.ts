/**
 * scripts/setForwarder.ts
 *
 * Updates creForwarder on the deployed RiskConsumerWithACE to the official
 * Chainlink Keystone Forwarder address for Ethereum Sepolia.
 *
 * Official forwarder addresses — source:
 *   https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
 *
 *   MockKeystoneForwarder  (use with: cre workflow simulate --broadcast)
 *     0x15fC6ae953E024d975e77382eEeC56A9101f9F88
 *
 *   KeystoneForwarder  (use after: cre workflow deploy, real DON)
 *     0xF8344CFd5c43616a4366C34E3EEE75af79a74482
 *
 * Usage:
 *   Simulation mode (sets MockKeystoneForwarder):
 *     npx hardhat run scripts/setForwarder.ts --network sepolia
 *
 *   Production DON mode (sets real KeystoneForwarder):
 *     Set FORWARDER_MODE=production in your .env, then:
 *     npx hardhat run scripts/setForwarder.ts --network sepolia
 *     (or: npm run set-forwarder:production)
 */

import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

// Official Chainlink Keystone Forwarder addresses on Ethereum Sepolia
// Source: https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
const MOCK_KEYSTONE_FORWARDER_SEPOLIA = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88";
const KEYSTONE_FORWARDER_SEPOLIA      = "0xF8344CFd5c43616a4366C34E3EEE75af79a74482";

const RISK_CONSUMER_ABI = [
  "function creForwarder() view returns (address)",
  "function setCreForwarder(address _creForwarder) external",
  "function owner() view returns (address)",
];

async function main() {
  const [deployer] = await ethers.getSigners();

  const riskConsumerAddress = process.env.RISK_CONSUMER_ADDRESS;
  if (!riskConsumerAddress) {
    throw new Error(
      "RISK_CONSUMER_ADDRESS not set in .env\n" +
      "  Deployed contract: 0x3dC77FE8f9A29036306561800d05bcD2375a2F58"
    );
  }

  const mode = process.env.FORWARDER_MODE || "simulation";
  const newForwarder =
    mode === "production" ? KEYSTONE_FORWARDER_SEPOLIA : MOCK_KEYSTONE_FORWARDER_SEPOLIA;

  console.log("─".repeat(64));
  console.log("setForwarder.ts — Converge.fi CRE Forwarder Update");
  console.log("─".repeat(64));
  console.log(`Mode:          ${mode === "production" ? "PRODUCTION (KeystoneForwarder)" : "SIMULATION (MockKeystoneForwarder)"}`);
  console.log(`Deployer:      ${deployer.address}`);
  console.log(`RiskConsumer:  ${riskConsumerAddress}`);
  console.log(`New forwarder: ${newForwarder}`);
  console.log("");

  const riskConsumer = new ethers.Contract(riskConsumerAddress, RISK_CONSUMER_ABI, deployer);

  const currentForwarder = await riskConsumer.creForwarder();
  const owner            = await riskConsumer.owner();

  console.log(`Current forwarder: ${currentForwarder}`);
  console.log(`Contract owner:    ${owner}`);
  console.log("");

  if (deployer.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(
      `Deployer ${deployer.address} is not the contract owner ${owner}.\n` +
      "Only the owner can call setCreForwarder()."
    );
  }

  if (currentForwarder.toLowerCase() === newForwarder.toLowerCase()) {
    console.log(`✅ creForwarder is already correctly set for ${mode} mode. No transaction needed.`);
    return;
  }

  console.log(`Updating creForwarder to ${newForwarder} ...`);
  const tx = await riskConsumer.setCreForwarder(newForwarder);
  console.log(`Transaction submitted: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`✅ Confirmed in block ${receipt.blockNumber}`);

  const updated = await riskConsumer.creForwarder();
  if (updated.toLowerCase() !== newForwarder.toLowerCase()) {
    throw new Error(`Update failed. On-chain value: ${updated}`);
  }

  console.log("");
  console.log("─".repeat(64));
  console.log("✅ creForwarder updated successfully.");
  if (mode !== "production") {
    console.log("\nNext steps:");
    console.log("  1. cd risk-engine && npm run dev");
    console.log("  2. cre workflow simulate risk-monitoring --target staging-settings --broadcast");
    console.log("  3. npx hardhat run scripts/verifySetup.ts --network sepolia");
  } else {
    console.log("\nNext steps:");
    console.log("  1. cre workflow deploy risk-monitoring --target staging-settings");
  }
  console.log("─".repeat(64));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
