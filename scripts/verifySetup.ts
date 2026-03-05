/**
 * scripts/verifySetup.ts
 *
 * Pre-flight check before running `cre workflow simulate --broadcast`.
 * Reads live on-chain state from deployed contracts and validates every
 * prerequisite needed for CRE to deliver reports on-chain.
 *
 * Usage:
 *   npx hardhat run scripts/verifySetup.ts --network sepolia
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";
dotenv.config();

// Official Chainlink Keystone Forwarder addresses on Ethereum Sepolia
// Source: https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
const MOCK_KEYSTONE_FORWARDER = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88";
const KEYSTONE_FORWARDER      = "0xF8344CFd5c43616a4366C34E3EEE75af79a74482";

const RISK_CONSUMER_ABI = [
  "function creForwarder() view returns (address)",
  "function owner() view returns (address)",
  "function backingPolicy() view returns (address)",
  "function liquidityPolicy() view returns (address)",
  "function riskScorePolicy() view returns (address)",
  "function reportCount() view returns (uint256)",
];

type CheckResult = { label: string; pass: boolean; detail: string };

function check(label: string, pass: boolean, detail: string): CheckResult {
  return { label, pass, detail };
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const results: CheckResult[] = [];

  console.log("─".repeat(72));
  console.log("verifySetup.ts — Converge.fi CRE Pre-flight Check");
  console.log("─".repeat(72));
  console.log(`Network:  ${network.name} (chainId ${network.chainId})`);
  console.log(`Account:  ${deployer.address}`);
  console.log("");

  // 1. Correct network
  results.push(check(
    "Network is Ethereum Sepolia (chainId 11155111)",
    Number(network.chainId) === 11155111,
    `chainId = ${network.chainId}`
  ));

  // 2. RISK_CONSUMER_ADDRESS in .env
  const riskConsumerAddress = process.env.RISK_CONSUMER_ADDRESS || "";
  results.push(check(
    "RISK_CONSUMER_ADDRESS set in .env",
    !!riskConsumerAddress,
    riskConsumerAddress || "NOT SET — add RISK_CONSUMER_ADDRESS=0x3dC77FE8f9A29036306561800d05bcD2375a2F58 to .env"
  ));

  // 3. deployed-addresses.json populated
  const deployedPath = path.join(__dirname, "..", "deployed-addresses.json");
  let deployedJson: any = {};
  try { deployedJson = JSON.parse(fs.readFileSync(deployedPath, "utf-8")); } catch { /* not found */ }
  const deployedPopulated = !!deployedJson?.contracts?.RiskConsumerWithACE;
  results.push(check(
    "deployed-addresses.json populated",
    deployedPopulated,
    deployedPopulated
      ? `RiskConsumerWithACE = ${deployedJson.contracts.RiskConsumerWithACE}`
      : "contracts empty — run deploy:sepolia or fill manually"
  ));

  // 4. workflows/risk-monitoring/config.json has riskConsumerAddress
  const configPath = path.join(__dirname, "..", "workflows", "risk-monitoring", "config.json");
  let workflowConfig: any = {};
  try { workflowConfig = JSON.parse(fs.readFileSync(configPath, "utf-8")); } catch { /* not found */ }
  const configHasAddress = !!workflowConfig?.riskConsumerAddress;
  results.push(check(
    "workflows/risk-monitoring/config.json has riskConsumerAddress",
    configHasAddress,
    configHasAddress
      ? workflowConfig.riskConsumerAddress
      : `NOT SET — add: "riskConsumerAddress": "${riskConsumerAddress || "<address>"}"`
  ));

  // 5. On-chain: creForwarder is official Chainlink address
  if (riskConsumerAddress) {
    const riskConsumer = new ethers.Contract(riskConsumerAddress, RISK_CONSUMER_ABI, deployer);
    let onChainForwarder = "";
    let policiesSet = false;
    let reportCount = 0;

    try {
      onChainForwarder  = await riskConsumer.creForwarder();
      const backing     = await riskConsumer.backingPolicy();
      const liquidity   = await riskConsumer.liquidityPolicy();
      const riskScore   = await riskConsumer.riskScorePolicy();
      policiesSet       = backing  !== ethers.ZeroAddress &&
                          liquidity !== ethers.ZeroAddress &&
                          riskScore !== ethers.ZeroAddress;
      reportCount       = Number(await riskConsumer.reportCount());
    } catch (e: any) {
      results.push(check("RiskConsumerWithACE on-chain read", false, `Call failed: ${e.message}`));
    }

    if (onChainForwarder) {
      const isMock  = onChainForwarder.toLowerCase() === MOCK_KEYSTONE_FORWARDER.toLowerCase();
      const isProd  = onChainForwarder.toLowerCase() === KEYSTONE_FORWARDER.toLowerCase();
      results.push(check(
        "RiskConsumerWithACE.creForwarder is official Chainlink forwarder",
        isMock || isProd,
        (isMock || isProd)
          ? `${onChainForwarder} (${isMock ? "MockKeystoneForwarder — ready for simulation" : "KeystoneForwarder — production DON"})`
          : `${onChainForwarder} is a wallet, not the forwarder contract.\n` +
            `     FIX: npx hardhat run scripts/setForwarder.ts --network sepolia`
      ));

      results.push(check(
        "RiskConsumerWithACE.policies set (setPolicies called)",
        policiesSet,
        policiesSet
          ? "backingPolicy, liquidityPolicy, riskScorePolicy all non-zero"
          : "policies are address(0) — call riskConsumer.setPolicies(...)"
      ));

      results.push(check(
        "CRE reports received (reportCount > 0)",
        reportCount > 0,
        reportCount > 0
          ? `${reportCount} report(s) received`
          : "0 reports — run: cre workflow simulate risk-monitoring --target staging-settings --broadcast"
      ));
    }
  }

  // 6. CRE_ETH_PRIVATE_KEY in .env (no 0x prefix per CRE CLI docs)
  const creKey = process.env.CRE_ETH_PRIVATE_KEY || "";
  results.push(check(
    "CRE_ETH_PRIVATE_KEY set in .env (no 0x prefix)",
    !!creKey && !creKey.startsWith("0x"),
    creKey
      ? (creKey.startsWith("0x") ? "SET but has 0x prefix — remove it" : "SET ✅")
      : "NOT SET — add PRIVATE_KEY value without 0x prefix"
  ));

  // 7. project.yaml exists with staging-settings
  const projectYaml = path.join(__dirname, "..", "project.yaml");
  let hasStaging = false;
  if (fs.existsSync(projectYaml)) {
    hasStaging = fs.readFileSync(projectYaml, "utf-8").includes("staging-settings:");
  }
  results.push(check(
    "project.yaml exists with staging-settings target",
    hasStaging,
    hasStaging ? "found" : "MISSING or missing staging-settings block"
  ));

  // 8. workflow.yaml exists
  const wfYaml = path.join(__dirname, "..", "workflows", "risk-monitoring", "workflow.yaml");
  results.push(check(
    "workflows/risk-monitoring/workflow.yaml exists",
    fs.existsSync(wfYaml),
    fs.existsSync(wfYaml) ? "found" : "MISSING"
  ));

  // ── Print results ──────────────────────────────────────────────────────────
  console.log("Results:\n");
  let allPass = true;
  for (const r of results) {
    const icon = r.pass ? "✅" : "❌";
    console.log(`  ${icon} ${r.label}`);
    if (!r.pass || r.detail.length > 50) {
      console.log(`     ${r.detail}`);
    }
    if (!r.pass) allPass = false;
  }

  console.log("\n" + "─".repeat(72));
  if (allPass) {
    console.log("✅ ALL CHECKS PASSED — ready for CRE simulation.");
    console.log("\nRun:");
    console.log("  1. cd risk-engine && npm run dev");
    console.log("  2. cre workflow simulate risk-monitoring --target staging-settings --broadcast");
  } else {
    console.log("❌ Fix the issues above then re-run this script.");
  }
  console.log("─".repeat(72));

  if (!allPass) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
