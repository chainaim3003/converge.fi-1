// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MultiAttributeRiskPolicy
 * @notice Single policy storing all 8 risk attributes from CRE reports.
 *         Replaces the 3 separate policy contracts (BackingRatioPolicy,
 *         LiquidityRatioPolicy, RiskScorePolicy) from V1.
 *
 * Hard gates (4):
 *   backingPct ≥ backingThreshold          GENIUS Act §4(a)(1)
 *   liquidityPct ≥ liquidityThreshold      MiCA Art.54
 *   riskScore ≤ riskScoreThreshold         Converge.fi composite
 *   assetEligibilityPct ≥ eligibilityThreshold  GENIUS Act §4(a)(1)(A)
 *
 * Soft metrics (stored, affect riskScore off-chain, not gated individually):
 *   maturityGapDays, custodianDiversityScore
 */
contract MultiAttributeRiskPolicy is Ownable {

    // ─── State: latest report values (all uint16 for consistency) ───
    uint16 public backingPct;
    uint16 public liquidityPct;
    uint16 public riskScore;
    uint16 public maturityGapDays;
    uint40 public lastUpdated;
    bytes32 public scenarioId;
    uint16 public assetEligibilityPct;
    uint16 public custodianDiversityScore;

    // ─── Thresholds (owner-configurable) ───
    uint16 public backingThreshold;       // default 100 (100%)
    uint16 public liquidityThreshold;     // default 30  (30%, MiCA Art.54)
    uint16 public riskScoreThreshold;     // default 70
    uint16 public eligibilityThreshold;   // default 100 (GENIUS: "may only consist of")
    uint256 public maxStaleAge;           // default 86400 (24 hours)

    // ─── Access control ───
    address public authorizedConsumer;

    // ─── Events ───
    event ReportUpdated(
        uint16 backingPct,
        uint16 liquidityPct,
        uint16 riskScore,
        uint16 maturityGapDays,
        uint40 timestamp,
        bytes32 scenarioId,
        uint16 assetEligibilityPct,
        uint16 custodianDiversityScore
    );

    event ThresholdsUpdated(
        uint16 backingThreshold,
        uint16 liquidityThreshold,
        uint16 riskScoreThreshold,
        uint16 eligibilityThreshold,
        uint256 maxStaleAge
    );

    // ─── Errors ───
    error OnlyAuthorizedConsumer(address caller, address expected);

    modifier onlyAuthorizedConsumer() {
        if (msg.sender != authorizedConsumer && msg.sender != owner()) {
            revert OnlyAuthorizedConsumer(msg.sender, authorizedConsumer);
        }
        _;
    }

    constructor(
        uint16 _backingThreshold,
        uint16 _liquidityThreshold,
        uint16 _riskScoreThreshold,
        uint16 _eligibilityThreshold,
        uint256 _maxStaleAge
    ) Ownable(msg.sender) {
        backingThreshold = _backingThreshold;
        liquidityThreshold = _liquidityThreshold;
        riskScoreThreshold = _riskScoreThreshold;
        eligibilityThreshold = _eligibilityThreshold;
        maxStaleAge = _maxStaleAge;
    }

    // ─── Report update (called by MultiAttributeConvergeRiskConsumer) ───

    function updateReport(
        uint16 _backingPct,
        uint16 _liquidityPct,
        uint16 _riskScore,
        uint16 _maturityGapDays,
        uint40 _timestamp,
        bytes32 _scenarioId,
        uint16 _assetEligibilityPct,
        uint16 _custodianDiversityScore
    ) external onlyAuthorizedConsumer {
        backingPct = _backingPct;
        liquidityPct = _liquidityPct;
        riskScore = _riskScore;
        maturityGapDays = _maturityGapDays;
        lastUpdated = _timestamp;
        scenarioId = _scenarioId;
        assetEligibilityPct = _assetEligibilityPct;
        custodianDiversityScore = _custodianDiversityScore;

        emit ReportUpdated(
            _backingPct, _liquidityPct, _riskScore, _maturityGapDays,
            _timestamp, _scenarioId, _assetEligibilityPct, _custodianDiversityScore
        );
    }

    // ─── Health check (4 hard gates) ───

    function isHealthy() external view returns (bool) {
        return backingPct >= backingThreshold
            && liquidityPct >= liquidityThreshold
            && riskScore <= riskScoreThreshold
            && assetEligibilityPct >= eligibilityThreshold;
    }

    // ─── Mint status (one-call for ConvergeStablecoin.mint) ───

    function getMintStatus() external view returns (
        bool mintAllowed,
        string memory reason,
        uint16 _backingPct,
        uint16 _liquidityPct,
        uint16 _riskScore,
        uint256 staleAge
    ) {
        uint256 age = block.timestamp - uint256(lastUpdated);
        _backingPct = backingPct;
        _liquidityPct = liquidityPct;
        _riskScore = riskScore;
        staleAge = age;

        if (lastUpdated == 0) {
            return (false, "No report received yet", _backingPct, _liquidityPct, _riskScore, age);
        }
        if (age > maxStaleAge) {
            return (false, "Risk state too stale", _backingPct, _liquidityPct, _riskScore, age);
        }
        if (backingPct < backingThreshold) {
            return (false, "Backing below threshold", _backingPct, _liquidityPct, _riskScore, age);
        }
        if (liquidityPct < liquidityThreshold) {
            return (false, "Liquidity below threshold", _backingPct, _liquidityPct, _riskScore, age);
        }
        if (riskScore > riskScoreThreshold) {
            return (false, "Risk score above threshold", _backingPct, _liquidityPct, _riskScore, age);
        }
        if (assetEligibilityPct < eligibilityThreshold) {
            return (false, "Ineligible reserve assets", _backingPct, _liquidityPct, _riskScore, age);
        }

        return (true, "All policies healthy", _backingPct, _liquidityPct, _riskScore, age);
    }

    // ─── Admin ───

    function setAuthorizedConsumer(address _consumer) external onlyOwner {
        authorizedConsumer = _consumer;
    }

    function setThresholds(
        uint16 _backingThreshold,
        uint16 _liquidityThreshold,
        uint16 _riskScoreThreshold,
        uint16 _eligibilityThreshold,
        uint256 _maxStaleAge
    ) external onlyOwner {
        backingThreshold = _backingThreshold;
        liquidityThreshold = _liquidityThreshold;
        riskScoreThreshold = _riskScoreThreshold;
        eligibilityThreshold = _eligibilityThreshold;
        maxStaleAge = _maxStaleAge;

        emit ThresholdsUpdated(
            _backingThreshold, _liquidityThreshold, _riskScoreThreshold,
            _eligibilityThreshold, _maxStaleAge
        );
    }

    function setMaxStaleAge(uint256 _maxStaleAge) external onlyOwner {
        maxStaleAge = _maxStaleAge;
    }
}
