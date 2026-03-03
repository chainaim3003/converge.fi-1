/**
 * Converge.fi — Smart Contract Test Suite
 *
 * Tests the circuit breaker pattern:
 *  - Policy gates (backing, liquidity, risk score)
 *  - RiskConsumerWithACE report processing + fan-out
 *  - ConvergeStablecoin deposit, mint allowed/blocked, staleness
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

// Helper: encode a risk report matching RiskReportExtractor layout
function encodeReport(
  backingRatioBps: number,
  liquidityRatioBps: number,
  riskScore: number,
  maturityGapDays: number,
  timestamp: number,
  scenarioId: string
): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint16", "uint16", "uint8", "uint8", "uint40", "bytes32"],
    [backingRatioBps, liquidityRatioBps, riskScore, maturityGapDays, timestamp, scenarioId]
  );
}

describe("Converge.fi — Circuit Breaker Tests", function () {
  let owner: any;
  let operator: any;
  let user: any;
  let creForwarder: any;
  let outsider: any;

  let backingPolicy: any;
  let liquidityPolicy: any;
  let riskScorePolicy: any;
  let riskConsumer: any;
  let stablecoin: any;

  const scenarioId = ethers.keccak256(ethers.toUtf8Bytes("sc_depeg_stress_scn01"));

  // Full deployment following section 6.4 order
  async function deployAll() {
    [owner, operator, user, creForwarder, outsider] = await ethers.getSigners();

    // Step 1-3: Deploy policies with temp riskConsumer = address(0)
    const BackingRatioPolicy = await ethers.getContractFactory("BackingRatioPolicy");
    backingPolicy = await BackingRatioPolicy.deploy(10000, ethers.ZeroAddress);
    await backingPolicy.waitForDeployment();

    const LiquidityRatioPolicy = await ethers.getContractFactory("LiquidityRatioPolicy");
    liquidityPolicy = await LiquidityRatioPolicy.deploy(1000, ethers.ZeroAddress);
    await liquidityPolicy.waitForDeployment();

    const RiskScorePolicy = await ethers.getContractFactory("RiskScorePolicy");
    riskScorePolicy = await RiskScorePolicy.deploy(70, ethers.ZeroAddress);
    await riskScorePolicy.waitForDeployment();

    // Step 4: Deploy RiskConsumerWithACE
    const RiskConsumerWithACE = await ethers.getContractFactory("RiskConsumerWithACE");
    riskConsumer = await RiskConsumerWithACE.deploy(creForwarder.address);
    await riskConsumer.waitForDeployment();

    const riskConsumerAddr = await riskConsumer.getAddress();

    // Step 5-7: Wire policies to riskConsumer
    await backingPolicy.setRiskConsumer(riskConsumerAddr);
    await liquidityPolicy.setRiskConsumer(riskConsumerAddr);
    await riskScorePolicy.setRiskConsumer(riskConsumerAddr);

    // Step 8: Register policies in RiskConsumer
    await riskConsumer.setPolicies(
      await backingPolicy.getAddress(),
      await liquidityPolicy.getAddress(),
      await riskScorePolicy.getAddress()
    );

    // Step 9: Deploy ConvergeStablecoin
    const ConvergeStablecoin = await ethers.getContractFactory("ConvergeStablecoin");
    stablecoin = await ConvergeStablecoin.deploy("Converge USD", "cvUSD", 3600);
    await stablecoin.waitForDeployment();

    // Step 10: Wire stablecoin to policies
    await stablecoin.setPolicies(
      await backingPolicy.getAddress(),
      await liquidityPolicy.getAddress(),
      await riskScorePolicy.getAddress(),
      riskConsumerAddr
    );

    // Grant operator role
    await stablecoin.setOperator(operator.address, true);
  }

  // Helper: submit a healthy CRE report via the forwarder
  async function submitHealthyReport() {
    const ts = await time.latest();
    const reportData = encodeReport(10200, 1500, 30, 0, ts, scenarioId);
    await riskConsumer.connect(creForwarder).onReport(reportData);
  }

  // Helper: submit a report with specific values
  async function submitReport(backingBps: number, liqBps: number, score: number, gap: number) {
    const ts = await time.latest();
    const reportData = encodeReport(backingBps, liqBps, score, gap, ts, scenarioId);
    await riskConsumer.connect(creForwarder).onReport(reportData);
  }

  // ════════════════════════════════════════════════════════
  // BackingRatioPolicy Tests
  // ════════════════════════════════════════════════════════
  describe("BackingRatioPolicy", function () {
    beforeEach(deployAll);

    it("should initialize with threshold and be healthy at threshold", async function () {
      expect(await backingPolicy.thresholdBps()).to.equal(10000);
      expect(await backingPolicy.isHealthy()).to.be.true;
    });

    it("should report unhealthy when backing drops below threshold", async function () {
      await submitReport(8800, 1500, 30, 0); // 88% backing
      expect(await backingPolicy.currentBps()).to.equal(8800);
      expect(await backingPolicy.isHealthy()).to.be.false;
    });

    it("should report healthy when backing is at threshold", async function () {
      await submitReport(10000, 1500, 30, 0); // 100% exactly
      expect(await backingPolicy.isHealthy()).to.be.true;
    });

    it("should report healthy when backing is above threshold", async function () {
      await submitReport(10200, 1500, 30, 0); // 102%
      expect(await backingPolicy.isHealthy()).to.be.true;
    });

    it("should allow owner to change threshold", async function () {
      await backingPolicy.setThreshold(9500);
      expect(await backingPolicy.thresholdBps()).to.equal(9500);
    });

    it("should reject invalid thresholds", async function () {
      await expect(backingPolicy.setThreshold(0)).to.be.reverted;
      await expect(backingPolicy.setThreshold(20001)).to.be.reverted;
    });

    it("should reject updates from non-riskConsumer", async function () {
      const ts = await time.latest();
      await expect(
        backingPolicy.connect(outsider).update(10200, ts)
      ).to.be.reverted;
    });
  });

  // ════════════════════════════════════════════════════════
  // LiquidityRatioPolicy Tests
  // ════════════════════════════════════════════════════════
  describe("LiquidityRatioPolicy", function () {
    beforeEach(deployAll);

    it("should initialize with threshold 1000 bps (10%)", async function () {
      expect(await liquidityPolicy.thresholdBps()).to.equal(1000);
      expect(await liquidityPolicy.isHealthy()).to.be.true;
    });

    it("should report unhealthy when liquidity drops below threshold", async function () {
      await submitReport(10200, 500, 30, 0); // 5% liquidity
      expect(await liquidityPolicy.currentBps()).to.equal(500);
      expect(await liquidityPolicy.isHealthy()).to.be.false;
    });

    it("should report healthy at threshold", async function () {
      await submitReport(10200, 1000, 30, 0); // 10% exactly
      expect(await liquidityPolicy.isHealthy()).to.be.true;
    });
  });

  // ════════════════════════════════════════════════════════
  // RiskScorePolicy Tests
  // ════════════════════════════════════════════════════════
  describe("RiskScorePolicy", function () {
    beforeEach(deployAll);

    it("should initialize with threshold 70 and score 0 (safe)", async function () {
      expect(await riskScorePolicy.threshold()).to.equal(70);
      expect(await riskScorePolicy.currentScore()).to.equal(0);
      expect(await riskScorePolicy.isHealthy()).to.be.true;
    });

    it("should report unhealthy when score exceeds threshold", async function () {
      await submitReport(10200, 1500, 85, 0); // score 85 > 70
      expect(await riskScorePolicy.currentScore()).to.equal(85);
      expect(await riskScorePolicy.isHealthy()).to.be.false;
    });

    it("should report healthy when score equals threshold", async function () {
      await submitReport(10200, 1500, 70, 0); // score = 70 = threshold
      expect(await riskScorePolicy.isHealthy()).to.be.true;
    });

    it("should report healthy when score is below threshold", async function () {
      await submitReport(10200, 1500, 30, 0); // score 30 < 70
      expect(await riskScorePolicy.isHealthy()).to.be.true;
    });
  });

  // ════════════════════════════════════════════════════════
  // RiskConsumerWithACE Tests
  // ════════════════════════════════════════════════════════
  describe("RiskConsumerWithACE", function () {
    beforeEach(deployAll);

    it("should accept reports from CRE forwarder and fan out to policies", async function () {
      await submitHealthyReport();

      expect(await riskConsumer.reportCount()).to.equal(1);
      expect(await backingPolicy.currentBps()).to.equal(10200);
      expect(await liquidityPolicy.currentBps()).to.equal(1500);
      expect(await riskScorePolicy.currentScore()).to.equal(30);
    });

    it("should reject reports from non-forwarder", async function () {
      const ts = await time.latest();
      const reportData = encodeReport(10200, 1500, 30, 0, ts, scenarioId);
      await expect(
        riskConsumer.connect(outsider).onReport(reportData)
      ).to.be.reverted;
    });

    it("should emit ReportReceived event with correct data", async function () {
      const ts = await time.latest();
      const reportData = encodeReport(10200, 1500, 30, 5, ts, scenarioId);
      await expect(riskConsumer.connect(creForwarder).onReport(reportData))
        .to.emit(riskConsumer, "ReportReceived")
        .withArgs(0, 10200, 1500, 30, 5, ts, scenarioId);
    });

    it("should store report history", async function () {
      await submitHealthyReport();
      await submitReport(8800, 500, 85, 3); // unhealthy report

      expect(await riskConsumer.reportCount()).to.equal(2);
      const report1 = await riskConsumer.getReport(1);
      expect(report1.backingRatioBps).to.equal(8800);
      expect(report1.riskScore).to.equal(85);
    });

    it("should return full system health via getSystemHealth", async function () {
      await submitHealthyReport();
      const health = await riskConsumer.getSystemHealth();

      expect(health.backingRatioBps).to.equal(10200);
      expect(health.liquidityRatioBps).to.equal(1500);
      expect(health.riskScore).to.equal(30);
      expect(health.backingHealthy).to.be.true;
      expect(health.liquidityHealthy).to.be.true;
      expect(health.riskScoreHealthy).to.be.true;
    });
  });

  // ════════════════════════════════════════════════════════
  // ConvergeStablecoin Tests — The Circuit Breaker
  // ════════════════════════════════════════════════════════
  describe("ConvergeStablecoin", function () {
    beforeEach(deployAll);

    // ─── Deposit ───
    describe("deposit()", function () {
      it("should accept deposits and emit DepositReceived", async function () {
        const depositAmount = ethers.parseEther("1.0");
        await expect(stablecoin.connect(user).deposit({ value: depositAmount }))
          .to.emit(stablecoin, "DepositReceived")
          .withArgs(user.address, depositAmount, depositAmount);

        expect(await stablecoin.deposits(user.address)).to.equal(depositAmount);
        expect(await stablecoin.totalDeposited()).to.equal(depositAmount);
      });

      it("should reject zero deposits", async function () {
        await expect(
          stablecoin.connect(user).deposit({ value: 0 })
        ).to.be.revertedWithCustomError(stablecoin, "ZeroAmount");
      });

      it("should accumulate deposits from same user", async function () {
        const amount = ethers.parseEther("0.5");
        await stablecoin.connect(user).deposit({ value: amount });
        await stablecoin.connect(user).deposit({ value: amount });
        expect(await stablecoin.deposits(user.address)).to.equal(ethers.parseEther("1.0"));
      });
    });

    // ─── Mint — All Gates Pass ───
    describe("mint() — all gates pass", function () {
      it("should mint when all policies are healthy and state is fresh", async function () {
        await submitHealthyReport();
        const mintAmount = ethers.parseEther("1000");
        await stablecoin.connect(operator).mint(user.address, mintAmount);
        expect(await stablecoin.balanceOf(user.address)).to.equal(mintAmount);
      });

      it("should emit MintExecuted with correct metrics", async function () {
        await submitHealthyReport();
        const mintAmount = ethers.parseEther("1000");
        await expect(stablecoin.connect(operator).mint(user.address, mintAmount))
          .to.emit(stablecoin, "MintExecuted")
          .withArgs(user.address, mintAmount, 10200, 1500, 30);
      });

      it("should allow owner to mint without operator role", async function () {
        await submitHealthyReport();
        const mintAmount = ethers.parseEther("500");
        await stablecoin.connect(owner).mint(user.address, mintAmount);
        expect(await stablecoin.balanceOf(user.address)).to.equal(mintAmount);
      });
    });

    // ─── Mint — Gate 1 Blocked (Backing) ───
    describe("mint() — blocked by backing ratio", function () {
      it("should revert when backing is below threshold", async function () {
        await submitReport(8800, 1500, 30, 0); // 88% backing < 100%
        const mintAmount = ethers.parseEther("1000");
        await expect(
          stablecoin.connect(operator).mint(user.address, mintAmount)
        ).to.be.revertedWithCustomError(stablecoin, "MintBlockedBacking")
          .withArgs(8800, 10000);
      });

      // NOTE: EVM reverts discard all events emitted in the same transaction.
      // The emit MintBlocked() before revert MintBlockedBacking() is rolled back,
      // so we cannot observe the event. The revert itself is tested above.
    });

    // ─── Mint — Gate 2 Blocked (Liquidity) ───
    describe("mint() — blocked by liquidity ratio", function () {
      it("should revert when liquidity is below threshold", async function () {
        await submitReport(10200, 500, 30, 0); // 5% liquidity < 10%
        const mintAmount = ethers.parseEther("1000");
        await expect(
          stablecoin.connect(operator).mint(user.address, mintAmount)
        ).to.be.revertedWithCustomError(stablecoin, "MintBlockedLiquidity")
          .withArgs(500, 1000);
      });
    });

    // ─── Mint — Gate 3 Blocked (Risk Score) ───
    describe("mint() — blocked by risk score", function () {
      it("should revert when risk score exceeds threshold", async function () {
        await submitReport(10200, 1500, 85, 0); // score 85 > 70
        const mintAmount = ethers.parseEther("1000");
        await expect(
          stablecoin.connect(operator).mint(user.address, mintAmount)
        ).to.be.revertedWithCustomError(stablecoin, "MintBlockedRiskScore")
          .withArgs(85, 70);
      });
    });

    // ─── Mint — Staleness Guard ───
    describe("mint() — staleness guard", function () {
      it("should revert when risk state is stale (> maxStaleAge)", async function () {
        await submitHealthyReport();

        // Advance time past maxStaleAge (3600 seconds = 1 hour)
        await time.increase(3601);

        const mintAmount = ethers.parseEther("1000");
        await expect(
          stablecoin.connect(operator).mint(user.address, mintAmount)
        ).to.be.revertedWithCustomError(stablecoin, "MintBlockedStale");
      });

      it("should allow mint just before staleness threshold", async function () {
        await submitHealthyReport();
        await time.increase(3500); // 100 seconds before stale
        const mintAmount = ethers.parseEther("1000");
        await stablecoin.connect(operator).mint(user.address, mintAmount);
        expect(await stablecoin.balanceOf(user.address)).to.equal(mintAmount);
      });
    });

    // ─── Mint — Access Control ───
    describe("mint() — access control", function () {
      it("should reject mint from non-operator", async function () {
        await submitHealthyReport();
        const mintAmount = ethers.parseEther("1000");
        await expect(
          stablecoin.connect(outsider).mint(user.address, mintAmount)
        ).to.be.revertedWithCustomError(stablecoin, "OnlyOperator");
      });

      it("should reject mint of zero amount", async function () {
        await submitHealthyReport();
        await expect(
          stablecoin.connect(operator).mint(user.address, 0)
        ).to.be.revertedWithCustomError(stablecoin, "ZeroAmount");
      });

      it("should reject mint when policies not set", async function () {
        // Deploy fresh stablecoin without setPolicies
        const ConvergeStablecoin = await ethers.getContractFactory("ConvergeStablecoin");
        const freshCoin = await ConvergeStablecoin.deploy("Test", "TST", 3600);
        await freshCoin.waitForDeployment();

        await expect(
          freshCoin.mint(user.address, ethers.parseEther("100"))
        ).to.be.revertedWithCustomError(freshCoin, "PoliciesNotSet");
      });
    });

    // ─── getMintStatus ───
    describe("getMintStatus()", function () {
      it("should return allowed when all healthy", async function () {
        await submitHealthyReport();
        const status = await stablecoin.getMintStatus();
        expect(status.mintAllowed).to.be.true;
        expect(status.reason).to.equal("All policies healthy");
        expect(status.backingBps).to.equal(10200);
        expect(status.liquidityBps).to.equal(1500);
        expect(status.riskScore).to.equal(30);
      });

      it("should return blocked with reason when backing fails", async function () {
        await submitReport(8800, 1500, 30, 0);
        const status = await stablecoin.getMintStatus();
        expect(status.mintAllowed).to.be.false;
        expect(status.reason).to.equal("Backing ratio below threshold");
      });

      it("should return blocked with stale reason", async function () {
        await submitHealthyReport();
        await time.increase(3601);
        const status = await stablecoin.getMintStatus();
        expect(status.mintAllowed).to.be.false;
        expect(status.reason).to.equal("Risk state too stale");
      });
    });

    // ─── Burn ───
    describe("burn()", function () {
      it("should allow token holders to burn their own tokens", async function () {
        await submitHealthyReport();
        await stablecoin.connect(operator).mint(user.address, ethers.parseEther("1000"));
        await stablecoin.connect(user).burn(ethers.parseEther("500"));
        expect(await stablecoin.balanceOf(user.address)).to.equal(ethers.parseEther("500"));
      });
    });

    // ─── Recovery Scenario ───
    describe("recovery scenario", function () {
      it("should allow minting again after policies recover to healthy", async function () {
        // 1. Start unhealthy
        await submitReport(8800, 500, 85, 3);
        await expect(
          stablecoin.connect(operator).mint(user.address, ethers.parseEther("100"))
        ).to.be.reverted;

        // 2. New CRE report shows recovery
        await submitReport(10200, 1500, 30, 0);

        // 3. Minting works again
        await stablecoin.connect(operator).mint(user.address, ethers.parseEther("100"));
        expect(await stablecoin.balanceOf(user.address)).to.equal(ethers.parseEther("100"));
      });
    });
  });
});
