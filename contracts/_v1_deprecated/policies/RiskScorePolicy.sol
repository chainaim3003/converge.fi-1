// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RiskScorePolicy
 * @notice Gate 3: Composite risk score — aggregates backing, liquidity, peg, maturity gap.
 *
 * The risk-engine computes this off-chain as a weighted composite:
 *   riskScore = w1 * backingRisk + w2 * liquidityRisk + w3 * pegRisk + w4 * maturityGapRisk
 *   Range: 0 (completely safe) to 100 (system failure imminent)
 *
 * Why a composite in addition to individual policies?
 *   Individual policies catch hard threshold breaches.
 *   The composite catches COMBINATIONS that are dangerous even when
 *   no single metric breaches its threshold.
 *
 *   Example from treasury simulation:
 *     backingRatio: 103% (above 100% threshold — Gate 1 says OK)
 *     liquidityRatio: 11% (above 10% threshold — Gate 2 says OK)
 *     BUT peg deviation at 2% AND maturity gap is 5 days
 *     → composite riskScore = 72 → Gate 3 blocks mint
 *     → the COMBINATION of slightly-off metrics signals real danger
 *
 * Default threshold: 70 — mint blocked when score > 70.
 */
contract RiskScorePolicy is Ownable {
    /// @notice Threshold 0-100. Mint blocked if riskScore > threshold.
    uint8 public threshold;

    /// @notice Latest risk score from CRE report (0-100).
    uint8 public currentScore;

    /// @notice Timestamp of last update from CRE.
    uint40 public lastUpdated;

    /// @notice Address authorized to update policy state (RiskConsumerWithACE).
    address public riskConsumer;

    event ThresholdUpdated(uint8 oldThreshold, uint8 newThreshold);
    event RiskScoreUpdated(uint8 newScore, uint40 timestamp);

    error OnlyRiskConsumer(address caller, address expected);
    error InvalidThreshold(uint8 value);

    modifier onlyRiskConsumer() {
        if (msg.sender != riskConsumer) {
            revert OnlyRiskConsumer(msg.sender, riskConsumer);
        }
        _;
    }

    /**
     * @param _threshold Maximum allowed risk score. 70 = block above 70/100.
     * @param _riskConsumer Address of RiskConsumerWithACE that pushes updates.
     */
    constructor(uint8 _threshold, address _riskConsumer) Ownable(msg.sender) {
        if (_threshold == 0 || _threshold > 100) revert InvalidThreshold(_threshold);
        threshold = _threshold;
        riskConsumer = _riskConsumer;
        currentScore = 0; // safe default
        lastUpdated = uint40(block.timestamp);
    }

    /**
     * @notice Called by RiskConsumerWithACE when a new CRE report arrives.
     * @param _riskScore The new composite risk score 0-100.
     * @param _timestamp The off-chain computation timestamp.
     */
    function update(uint8 _riskScore, uint40 _timestamp) external onlyRiskConsumer {
        currentScore = _riskScore;
        lastUpdated = _timestamp;
        emit RiskScoreUpdated(_riskScore, _timestamp);
    }

    /**
     * @notice Checked by ConvergeStablecoin.mint(). Pure state read.
     * @return True if risk score <= threshold (system not in danger).
     */
    function isHealthy() external view returns (bool) {
        return currentScore <= threshold;
    }

    function setThreshold(uint8 _newThreshold) external onlyOwner {
        if (_newThreshold == 0 || _newThreshold > 100) revert InvalidThreshold(_newThreshold);
        emit ThresholdUpdated(threshold, _newThreshold);
        threshold = _newThreshold;
    }

    function setRiskConsumer(address _riskConsumer) external onlyOwner {
        riskConsumer = _riskConsumer;
    }
}
