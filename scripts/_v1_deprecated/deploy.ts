/**
 * Deploy all Converge.fi contracts in dependency order.
 *
 * Deployment order (from CLAUDE.md section 6.4):
 *  1. Deploy BackingRatioPolicy(10000, address(0))     ← temp riskConsumer
 *  2. Deploy LiquidityRatioPolicy(1000, address(0))
 *  3. Deploy RiskScorePolicy(70, address(0))
 *  4. Deploy RiskConsumerWithACE(creForwarderAddress)
 *  5. Call backingPolicy.setRiskConsumer(riskConsumerAddress)
 *  6. Call liquidityPolicy.setRiskConsumer(riskConsumerAddress)
 *  7. Call riskScorePolicy.setRiskConsumer(riskConsumerAddress)
 *  8. Call riskConsumer.setPolicies(backing, liquidity, riskScore)
 *  9. Deploy ConvergeStablecoin("Converge USD", "cvUSD", 3600)
 * 10. Call stablecoin.setPolicies(backing, liquidity, riskScore, riskConsumer)
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Account balance:", (await deployer.provider.getBalance(deployer.address)).toString());

  // CRE Forwarder address — MUST be set via CRE_FORWARDER_ADDRESS env var.
  //
  // For `cre workflow simulate` (local simulation):
  //   The CRE CLI uses a MockForwarder — set CRE_FORWARDER_ADDRESS to your
  //   deployer wallet address so it can call onReport() directly during testing.
  //
  // For production Sepolia (real DON):
  //   Get the address from: https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory
  //   Look under: Testnets → Ethereum Sepolia
  //
  // We fall back to deployer.address ONLY for local hardhat node runs.
  // On sepolia: never deploy without CRE_FORWARDER_ADDRESS set.
  const network = await ethers.provider.getNetwork();
  const isSepolia = Number(network.chainId) === 11155111;
  if (isSepolia && !process.env.CRE_FORWARDER_ADDRESS) {
    throw new Error(
      "CRE_FORWARDER_ADDRESS must be set in .env when deploying to Sepolia.\n" +
      "Get the address from: https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory"
    );
  }
  const creForwarderAddress = process.env.CRE_FORWARDER_ADDRESS || deployer.address;
  console.log("CRE Forwarder address:", creForwarderAddress);

  // ─── Step 1: Deploy BackingRatioPolicy ───
  console.log("\n1. Deploying BackingRatioPolicy (threshold=10000 bps = 100%)...");
  const BackingRatioPolicy = await ethers.getContractFactory("BackingRatioPolicy");
  const backingPolicy = await BackingRatioPolicy.deploy(10000, ethers.ZeroAddress);
  await backingPolicy.waitForDeployment();
  const backingAddr = await backingPolicy.getAddress();
  console.log("   BackingRatioPolicy deployed to:", backingAddr);

  // ─── Step 2: Deploy LiquidityRatioPolicy ───
  console.log("\n2. Deploying LiquidityRatioPolicy (threshold=1000 bps = 10%)...");
  const LiquidityRatioPolicy = await ethers.getContractFactory("LiquidityRatioPolicy");
  const liquidityPolicy = await LiquidityRatioPolicy.deploy(1000, ethers.ZeroAddress);
  await liquidityPolicy.waitForDeployment();
  const liquidityAddr = await liquidityPolicy.getAddress();
  console.log("   LiquidityRatioPolicy deployed to:", liquidityAddr);

  // ─── Step 3: Deploy RiskScorePolicy ───
  console.log("\n3. Deploying RiskScorePolicy (threshold=70)...");
  const RiskScorePolicy = await ethers.getContractFactory("RiskScorePolicy");
  const riskScorePolicy = await RiskScorePolicy.deploy(70, ethers.ZeroAddress);
  await riskScorePolicy.waitForDeployment();
  const riskScoreAddr = await riskScorePolicy.getAddress();
  console.log("   RiskScorePolicy deployed to:", riskScoreAddr);

  // ─── Step 4: Deploy RiskConsumerWithACE ───
  console.log("\n4. Deploying RiskConsumerWithACE (forwarder=%s)...", creForwarderAddress);
  const RiskConsumerWithACE = await ethers.getContractFactory("RiskConsumerWithACE");
  const riskConsumer = await RiskConsumerWithACE.deploy(creForwarderAddress);
  await riskConsumer.waitForDeployment();
  const riskConsumerAddr = await riskConsumer.getAddress();
  console.log("   RiskConsumerWithACE deployed to:", riskConsumerAddr);

  // ─── Step 5: Wire BackingRatioPolicy → RiskConsumer ───
  console.log("\n5. Setting BackingRatioPolicy.riskConsumer...");
  await (await backingPolicy.setRiskConsumer(riskConsumerAddr)).wait();
  console.log("   Done.");

  // ─── Step 6: Wire LiquidityRatioPolicy → RiskConsumer ───
  console.log("\n6. Setting LiquidityRatioPolicy.riskConsumer...");
  await (await liquidityPolicy.setRiskConsumer(riskConsumerAddr)).wait();
  console.log("   Done.");

  // ─── Step 7: Wire RiskScorePolicy → RiskConsumer ───
  console.log("\n7. Setting RiskScorePolicy.riskConsumer...");
  await (await riskScorePolicy.setRiskConsumer(riskConsumerAddr)).wait();
  console.log("   Done.");

  // ─── Step 8: Register policies in RiskConsumer ───
  console.log("\n8. Calling riskConsumer.setPolicies...");
  await (await riskConsumer.setPolicies(backingAddr, liquidityAddr, riskScoreAddr)).wait();
  console.log("   Done.");

  // ─── Step 9: Deploy ConvergeStablecoin ───
  console.log('\n9. Deploying ConvergeStablecoin ("Converge USD", "cvUSD", maxStaleAge=3600)...');
  const ConvergeStablecoin = await ethers.getContractFactory("ConvergeStablecoin");
  const stablecoin = await ConvergeStablecoin.deploy("Converge USD", "cvUSD", 3600);
  await stablecoin.waitForDeployment();
  const stablecoinAddr = await stablecoin.getAddress();
  console.log("   ConvergeStablecoin deployed to:", stablecoinAddr);

  // ─── Step 10: Wire stablecoin to policies ───
  console.log("\n10. Calling stablecoin.setPolicies...");
  await (await stablecoin.setPolicies(backingAddr, liquidityAddr, riskScoreAddr, riskConsumerAddr)).wait();
  console.log("   Done.");

  // ─── Save deployed addresses ───
  const addresses = {
    network: network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    contracts: {
      BackingRatioPolicy: backingAddr,
      LiquidityRatioPolicy: liquidityAddr,
      RiskScorePolicy: riskScoreAddr,
      RiskConsumerWithACE: riskConsumerAddr,
      ConvergeStablecoin: stablecoinAddr,
    },
    constructorArgs: {
      BackingRatioPolicy: { thresholdBps: 10000, riskConsumer: riskConsumerAddr },
      LiquidityRatioPolicy: { thresholdBps: 1000, riskConsumer: riskConsumerAddr },
      RiskScorePolicy: { threshold: 70, riskConsumer: riskConsumerAddr },
      RiskConsumerWithACE: { creForwarder: creForwarderAddress },
      ConvergeStablecoin: { name: "Converge USD", symbol: "cvUSD", maxStaleAge: 3600 },
    },
  };

  const outPath = path.join(__dirname, "..", "deployed-addresses.json");
  fs.writeFileSync(outPath, JSON.stringify(addresses, null, 2));
  console.log("\n✅ All contracts deployed. Addresses saved to deployed-addresses.json");
  console.log("\nSummary:");
  console.log("  BackingRatioPolicy:   ", backingAddr);
  console.log("  LiquidityRatioPolicy: ", liquidityAddr);
  console.log("  RiskScorePolicy:      ", riskScoreAddr);
  console.log("  RiskConsumerWithACE:  ", riskConsumerAddr);
  console.log("  ConvergeStablecoin:   ", stablecoinAddr);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
