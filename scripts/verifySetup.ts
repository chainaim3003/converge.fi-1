/**
 * scripts/verifySetup.ts — V4
 *
 * Pre-flight check before running CRE workflow simulate --broadcast.
 * Validates all V4 contract wiring on Sepolia.
 *
 * Usage:
 *   npx hardhat run scripts/verifySetup.ts --network sepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();

const MOCK_KEYSTONE_FORWARDER = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88";

type Check = { label: string; pass: boolean; detail: string };

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const results: Check[] = [];

  console.log("─".repeat(72));
  console.log("verifySetup.ts V4 — CRE Pre-flight Check");
  console.log("─".repeat(72));
  console.log(`Network: ${network.name} (chainId ${network.chainId})`);
  console.log(`Account: ${deployer.address}\n`);

  // 1. Correct network
  results.push({ label: "Network is Sepolia", pass: Number(network.chainId) === 11155111, detail: `chainId=${network.chainId}` });

  // 2. Env vars
  const policyAddr = process.env.RISK_POLICY_ADDRESS || "";
  const consumerAddr = process.env.RISK_CONSUMER_V2_ADDRESS || "";
  const stablecoinAddr = process.env.STABLECOIN_V2_ADDRESS || "";
  results.push({ label: "RISK_POLICY_ADDRESS set", pass: !!policyAddr, detail: policyAddr || "NOT SET" });
  results.push({ label: "RISK_CONSUMER_V2_ADDRESS set", pass: !!consumerAddr, detail: consumerAddr || "NOT SET" });
  results.push({ label: "STABLECOIN_V2_ADDRESS set", pass: !!stablecoinAddr, detail: stablecoinAddr || "NOT SET" });

  // 3. CRE key
  const creKey = process.env.CRE_ETH_PRIVATE_KEY || "";
  results.push({ label: "CRE_ETH_PRIVATE_KEY set (no 0x)", pass: !!creKey && !creKey.startsWith("0x"), detail: creKey ? "SET ✅" : "NOT SET" });

  // 4. On-chain checks
  if (consumerAddr && policyAddr && stablecoinAddr) {
    const CONSUMER_ABI = [
      "function getForwarderAddress() view returns (address)",
      "function riskPolicy() view returns (address)",
      "function reportCount() view returns (uint256)",
    ];
    const POLICY_ABI = [
      "function authorizedConsumer() view returns (address)",
      "function isHealthy() view returns (bool)",
    ];
    const COIN_ABI = [
      "function riskPolicy() view returns (address)",
    ];

    try {
      const consumer = new ethers.Contract(consumerAddr, CONSUMER_ABI, deployer);
      const fwd = await consumer.getForwarderAddress();
      const cPolicy = await consumer.riskPolicy();
      const count = await consumer.reportCount();

      results.push({ label: "Consumer forwarder = MockKeystoneForwarder", pass: fwd.toLowerCase() === MOCK_KEYSTONE_FORWARDER.toLowerCase(), detail: fwd });
      results.push({ label: "Consumer → Policy wiring", pass: cPolicy.toLowerCase() === policyAddr.toLowerCase(), detail: cPolicy });
      results.push({ label: "Reports received (reportCount > 0)", pass: Number(count) > 0, detail: `${count} reports` });

      const policy = new ethers.Contract(policyAddr, POLICY_ABI, deployer);
      const authConsumer = await policy.authorizedConsumer();
      results.push({ label: "Policy → Consumer wiring", pass: authConsumer.toLowerCase() === consumerAddr.toLowerCase(), detail: authConsumer });

      const coin = new ethers.Contract(stablecoinAddr, COIN_ABI, deployer);
      const sPolicy = await coin.riskPolicy();
      results.push({ label: "Stablecoin → Policy wiring", pass: sPolicy.toLowerCase() === policyAddr.toLowerCase(), detail: sPolicy });
    } catch (e: any) {
      results.push({ label: "On-chain read", pass: false, detail: e.message });
    }
  }

  // 5. Config files
  const wfYaml = path.join(__dirname, "..", "workflows", "risk-monitoring", "workflow.yaml");
  results.push({ label: "workflow.yaml exists", pass: fs.existsSync(wfYaml), detail: fs.existsSync(wfYaml) ? "found" : "MISSING" });

  // Print
  console.log("Results:\n");
  let allPass = true;
  for (const r of results) {
    const icon = r.pass ? "✅" : "❌";
    console.log(`  ${icon} ${r.label}`);
    if (!r.pass) { console.log(`     ${r.detail}`); allPass = false; }
  }

  console.log("\n" + "─".repeat(72));
  console.log(allPass ? "✅ ALL CHECKS PASSED" : "❌ Fix issues above");
  console.log("─".repeat(72));
  if (!allPass) process.exit(1);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
