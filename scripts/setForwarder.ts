/**
 * scripts/setForwarder.ts — V4
 *
 * Updates the forwarder address on MultiAttributeConvergeRiskConsumer.
 * Uses ReceiverTemplate's setForwarderAddress() (inherited by the consumer).
 *
 * Source: https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
 *
 * Usage:
 *   npx hardhat run scripts/setForwarder.ts --network sepolia
 *   $env:FORWARDER_MODE="production"; npx hardhat run scripts/setForwarder.ts --network sepolia
 */

import { ethers } from "hardhat";
import * as dotenv from "dotenv";
dotenv.config();

const MOCK_KEYSTONE_FORWARDER = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88";
const KEYSTONE_FORWARDER = "0xF8344CFd5c43616a4366C34E3EEE75af79a74482";

const CONSUMER_ABI = [
  "function getForwarderAddress() view returns (address)",
  "function setForwarderAddress(address) external",
  "function owner() view returns (address)",
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const consumerAddr = process.env.RISK_CONSUMER_V2_ADDRESS;
  if (!consumerAddr) throw new Error("RISK_CONSUMER_V2_ADDRESS not set in .env");

  const mode = process.env.FORWARDER_MODE || "simulation";
  const newForwarder = mode === "production" ? KEYSTONE_FORWARDER : MOCK_KEYSTONE_FORWARDER;

  console.log("─".repeat(64));
  console.log("setForwarder.ts V4 — ReceiverTemplate Forwarder Update");
  console.log("─".repeat(64));
  console.log(`Mode:     ${mode === "production" ? "PRODUCTION" : "SIMULATION"}`);
  console.log(`Consumer: ${consumerAddr}`);
  console.log(`Target:   ${newForwarder}`);

  const consumer = new ethers.Contract(consumerAddr, CONSUMER_ABI, deployer);
  const current = await consumer.getForwarderAddress();
  console.log(`Current:  ${current}`);

  if (current.toLowerCase() === newForwarder.toLowerCase()) {
    console.log(`\n✅ Already set correctly. No transaction needed.`);
    return;
  }

  const owner = await consumer.owner();
  if (deployer.address.toLowerCase() !== owner.toLowerCase()) {
    throw new Error(`Deployer ${deployer.address} is not owner ${owner}`);
  }

  console.log(`\nUpdating...`);
  const tx = await consumer.setForwarderAddress(newForwarder);
  await tx.wait();
  console.log(`✅ Updated (tx: ${tx.hash})`);
  console.log("─".repeat(64));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
