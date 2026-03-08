/**
 * Converge.fi V4 — Smart Contract Test Suite
 *
 * Tests the V4 circuit breaker pattern:
 *  - MultiAttributeRiskPolicy (8 fields, 4 hard gates)
 *  - MultiAttributeConvergeRiskConsumer (_processReport)
 *  - ConvergeStablecoin mint allowed/blocked
 */

import { expect } from "chai";
import { ethers } from "hardhat";

// V4: 8-field ABI encoding (all uint16 + uint40 + bytes32)
function encodeReportV4(
  backingPct: number, liquidityPct: number, riskScore: number,
  maturityGapDays: number, timestamp: number, scenarioId: string,
  assetEligibilityPct: number, custodianDiversityScore: number
): string {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  const scenarioHash = ethers.keccak256(ethers.toUtf8Bytes(scenarioId));
  return abiCoder.encode(
    ["uint16", "uint16", "uint16", "uint16", "uint40", "bytes32", "uint16", "uint16"],
    [backingPct, liquidityPct, riskScore, maturityGapDays, timestamp, scenarioHash, assetEligibilityPct, custodianDiversityScore]
  );
}

describe("Converge.fi V4 Contracts", function () {
  let policy: any, consumer: any, stablecoin: any;
  let owner: any, user: any;
  const FORWARDER = "0x15fC6ae953E024d975e77382eEeC56A9101f9F88"; // placeholder for tests

  beforeEach(async function () {
    [owner, user] = await ethers.getSigners();

    // Deploy policy: backing≥100, liquidity≥30, riskScore≤70, eligibility≥100, stale≤86400
    const Policy = await ethers.getContractFactory("MultiAttributeRiskPolicy");
    policy = await Policy.deploy(100, 30, 70, 100, 86400);

    // Deploy consumer with owner as forwarder (for testing)
    const Consumer = await ethers.getContractFactory("MultiAttributeConvergeRiskConsumer");
    consumer = await Consumer.deploy(owner.address);

    // Wire
    await policy.setAuthorizedConsumer(await consumer.getAddress());
    await consumer.setRiskPolicy(await policy.getAddress());

    // Deploy stablecoin
    const Coin = await ethers.getContractFactory("ConvergeStablecoin");
    stablecoin = await Coin.deploy("Converge USD", "cvUSD", 86400);
    await stablecoin.setRiskPolicy(await policy.getAddress());
  });

  describe("MultiAttributeRiskPolicy", function () {
    it("should store all 8 fields from updateReport", async function () {
      const ts = Math.floor(Date.now() / 1000);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      await policy.setAuthorizedConsumer(owner.address);
      await policy.updateReport(490, 69, 0, 21, ts, hash, 100, 80);

      expect(await policy.backingPct()).to.equal(490);
      expect(await policy.liquidityPct()).to.equal(69);
      expect(await policy.riskScore()).to.equal(0);
      expect(await policy.maturityGapDays()).to.equal(21);
      expect(await policy.assetEligibilityPct()).to.equal(100);
      expect(await policy.custodianDiversityScore()).to.equal(80);
    });

    it("should return healthy when all gates pass", async function () {
      const ts = Math.floor(Date.now() / 1000);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      await policy.setAuthorizedConsumer(owner.address);
      await policy.updateReport(490, 69, 0, 21, ts, hash, 100, 80);
      expect(await policy.isHealthy()).to.be.true;
    });

    it("should return unhealthy when eligibility < 100", async function () {
      const ts = Math.floor(Date.now() / 1000);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      await policy.setAuthorizedConsumer(owner.address);
      await policy.updateReport(140, 4, 71, 174, ts, hash, 57, 50);
      expect(await policy.isHealthy()).to.be.false;
    });

    it("should reject unauthorized caller", async function () {
      const ts = Math.floor(Date.now() / 1000);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      await expect(
        policy.connect(user).updateReport(490, 69, 0, 21, ts, hash, 100, 80)
      ).to.be.reverted;
    });
  });

  describe("ConvergeStablecoin", function () {
    it("should allow mint when all gates pass (Phase A)", async function () {
      const ts = Math.floor(Date.now() / 1000);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("phaseA"));
      await policy.setAuthorizedConsumer(owner.address);
      await policy.updateReport(490, 69, 0, 21, ts, hash, 100, 80);
      await policy.setAuthorizedConsumer(await consumer.getAddress());

      await stablecoin.mint(owner.address, ethers.parseEther("100000"));
      expect(await stablecoin.balanceOf(owner.address)).to.equal(ethers.parseEther("100000"));
    });

    it("should block mint when liquidity fails (Phase B)", async function () {
      const ts = Math.floor(Date.now() / 1000);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("phaseB"));
      await policy.setAuthorizedConsumer(owner.address);
      await policy.updateReport(140, 4, 71, 174, ts, hash, 57, 50);
      await policy.setAuthorizedConsumer(await consumer.getAddress());

      await expect(
        stablecoin.mint(owner.address, ethers.parseEther("100000"))
      ).to.be.reverted;
    });

    it("should allow mint after recovery (Phase C)", async function () {
      const ts = Math.floor(Date.now() / 1000);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("phaseC"));
      await policy.setAuthorizedConsumer(owner.address);
      await policy.updateReport(182, 59, 9, 21, ts, hash, 100, 54);
      await policy.setAuthorizedConsumer(await consumer.getAddress());

      await stablecoin.mint(owner.address, ethers.parseEther("100000"));
      expect(await stablecoin.balanceOf(owner.address)).to.equal(ethers.parseEther("100000"));
    });

    it("should report correct getMintStatus", async function () {
      const ts = Math.floor(Date.now() / 1000);
      const hash = ethers.keccak256(ethers.toUtf8Bytes("test"));
      await policy.setAuthorizedConsumer(owner.address);
      await policy.updateReport(490, 69, 0, 21, ts, hash, 100, 80);

      const [allowed, reason] = await stablecoin.getMintStatus();
      expect(allowed).to.be.true;
      expect(reason).to.equal("All policies healthy");
    });
  });

  describe("MultiAttributeConvergeRiskConsumer", function () {
    it("should process report via _processReport and update policy", async function () {
      const ts = Math.floor(Date.now() / 1000);
      const encoded = encodeReportV4(490, 69, 0, 21, ts, "test_scenario", 100, 80);
      const metadata = new Uint8Array(62); // minimal metadata

      // Consumer's forwarder is owner (set in beforeEach)
      await consumer.onReport(metadata, encoded);

      expect(await policy.backingPct()).to.equal(490);
      expect(await policy.riskScore()).to.equal(0);
      expect(await consumer.reportCount()).to.equal(1);
    });
  });
});
