/**
 * Deploy Converge.fi V4 contracts in dependency order.
 *
 * Deployment order:
 *  1. Deploy MultiAttributeRiskPolicy(100, 30, 70, 100, 86400)
 *  2. Deploy MultiAttributeConvergeRiskConsumer(MockKeystoneForwarder)
 *  3. Call policy.setAuthorizedConsumer(consumer)
 *  4. Call consumer.setRiskPolicy(policy)
 *  5. Deploy ConvergeStablecoin("Converge USD", "cvUSD", 86400)
 *  6. Call stablecoin.setRiskPolicy(policy)
 *  7. Save addresses to deployed-addresses.json and .env
 *
 * Usage:
 *   npx hardhat run scripts/deploy-v2.ts --network sepolia
 *
 * Prerequisites:
 *   - KEYSTONE_FORWARDER_ADDRESS set in .env
 *   - Sufficient Sepolia ETH in deployer wallet
 *
 * Source: Chainlink CRE forwarder directory
 *   https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying V4 contracts with account:", deployer.address);
  console.log("Account balance:", (await deployer.provider.getBalance(deployer.address)).toString());

  const network = await ethers.provider.getNetwork();
  const isSepolia = Number(network.chainId) === 11155111;

  // MockKeystoneForwarder address (shared Sepolia infrastructure)
  // Source: https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
  const forwarderAddress = process.env.KEYSTONE_FORWARDER_ADDRESS
    || process.env.CRE_FORWARDER_ADDRESS
    || (isSepolia ? "0x15fC6ae953E024d975e77382eEeC56A9101f9F88" : deployer.address);

  if (isSepolia && forwarderAddress === deployer.address) {
    throw new Error(
      "KEYSTONE_FORWARDER_ADDRESS must be set in .env when deploying to Sepolia.\n" +
      "MockKeystoneForwarder: 0x15fC6ae953E024d975e77382eEeC56A9101f9F88\n" +
      "Source: https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts"
    );
  }
  console.log("Forwarder address:", forwarderAddress);

  // ─── Step 1: Deploy MultiAttributeRiskPolicy ───
  console.log("\n1. Deploying MultiAttributeRiskPolicy...");
  console.log("   Thresholds: backing>=100, liquidity>=30, riskScore<=70, eligibility>=100, maxStaleAge=86400");
  const RiskPolicy = await ethers.getContractFactory("MultiAttributeRiskPolicy");
  const riskPolicy = await RiskPolicy.deploy(100, 30, 70, 100, 86400);
  await riskPolicy.waitForDeployment();
  const policyAddr = await riskPolicy.getAddress();
  console.log("   MultiAttributeRiskPolicy deployed to:", policyAddr);

  // ─── Step 2: Deploy MultiAttributeConvergeRiskConsumer ───
  console.log("\n2. Deploying MultiAttributeConvergeRiskConsumer (forwarder=%s)...", forwarderAddress);
  const Consumer = await ethers.getContractFactory("MultiAttributeConvergeRiskConsumer");
  const consumer = await Consumer.deploy(forwarderAddress);
  await consumer.waitForDeployment();
  const consumerAddr = await consumer.getAddress();
  console.log("   MultiAttributeConvergeRiskConsumer deployed to:", consumerAddr);

  // ─── Step 3: Wire policy → consumer ───
  console.log("\n3. Setting policy.setAuthorizedConsumer...");
  await (await riskPolicy.setAuthorizedConsumer(consumerAddr)).wait();
  console.log("   Done. Only consumer can call updateReport().");

  // ─── Step 4: Wire consumer → policy ───
  console.log("\n4. Setting consumer.setRiskPolicy...");
  await (await consumer.setRiskPolicy(policyAddr)).wait();
  console.log("   Done. Consumer pushes reports to policy.");

  // ─── Step 5: Deploy ConvergeStablecoin ───
  console.log('\n5. Deploying ConvergeStablecoin ("Converge USD", "cvUSD")...');
  const Stablecoin = await ethers.getContractFactory("ConvergeStablecoin");
  const stablecoin = await Stablecoin.deploy("Converge USD", "cvUSD", 86400);
  await stablecoin.waitForDeployment();
  const stablecoinAddr = await stablecoin.getAddress();
  console.log("   ConvergeStablecoin deployed to:", stablecoinAddr);

  // ─── Step 6: Wire stablecoin → policy ───
  console.log("\n6. Setting stablecoin.setRiskPolicy...");
  await (await stablecoin.setRiskPolicy(policyAddr)).wait();
  console.log("   Done. mint() reads from MultiAttributeRiskPolicy.");

  // ─── Save deployed addresses ───
  const addresses = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    version: "v4",
    contracts: {
      MultiAttributeRiskPolicy: policyAddr,
      MultiAttributeConvergeRiskConsumer: consumerAddr,
      ConvergeStablecoin: stablecoinAddr,
    },
    sharedInfra: {
      MockKeystoneForwarder: forwarderAddress,
    },
    constructorArgs: {
      MultiAttributeRiskPolicy: {
        backingThreshold: 100,
        liquidityThreshold: 30,
        riskScoreThreshold: 70,
        eligibilityThreshold: 100,
        maxStaleAge: 86400,
      },
      MultiAttributeConvergeRiskConsumer: {
        forwarderAddress,
      },
      ConvergeStablecoin: {
        name: "Converge USD",
        symbol: "cvUSD",
        maxStaleAge: 86400,
      },
    },
    previousVersion: {
      backupFile: "deployed-addresses-v1-backup.json",
      note: "V1 contracts remain deployed on Sepolia but are no longer active",
    },
  };

  const outPath = path.join(__dirname, "..", "deployed-addresses.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));

  console.log("\n✅ All V4 contracts deployed. Addresses saved to deployed-addresses.json");
  console.log("\nSummary:");
  console.log("  MultiAttributeRiskPolicy:            ", policyAddr);
  console.log("  MultiAttributeConvergeRiskConsumer:   ", consumerAddr);
  console.log("  ConvergeStablecoin:                   ", stablecoinAddr);
  console.log("  MockKeystoneForwarder (shared):       ", forwarderAddress);
  console.log("\n⚠️  NEXT STEPS:");
  console.log("  1. Update .env with new addresses (RISK_POLICY_ADDRESS, RISK_CONSUMER_V2_ADDRESS, STABLECOIN_V2_ADDRESS)");
  console.log("  2. Update config-demo-A/B/C.json with riskConsumerAddress =", consumerAddr);
  console.log("  3. Update config-demo-A/B/C.json with stablecoinAddress =", stablecoinAddr);
  console.log("  4. Run: npx hardhat run scripts/diagnose.ts --network sepolia");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
