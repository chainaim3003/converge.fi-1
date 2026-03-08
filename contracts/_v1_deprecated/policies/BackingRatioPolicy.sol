// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BackingRatioPolicy
 * @notice Gate 1: Is the stablecoin fully backed?
 *
 * Architecture context:
 *   - CRE workflow runs on cron (e.g. hourly) or on log trigger (large deposit).
 *   - CRE calls risk-engine → ACTUS simulation → computes backingRatio.
 *   - CRE writes signed report to RiskConsumerWithACE → updates this policy.
 *   - When anyone calls ConvergeStablecoin.mint(), this policy is checked.
 *   - NO off-chain call happens at mint time. This reads STORED state only.
 *
 * What "backing ratio" means:
 *   backingRatioBps = (totalReserves / totalSupply) * 10000
 *   Where totalReserves = T-bill market value + cash reserves
 *   10000 = 100%, 10200 = 102%, 8800 = 88%
 *
 * From the ACTUS simulation data:
 *   - sc_depeg_stress_scn01: backing dropped to ~88% (8800 bps) at trough
 *   - sc_treasury_stress_01: backing stayed ~103% but liquidity was the issue
 *   - Threshold default: 10000 (100%) per STABLE Act / MiCA requirements
 */
contract BackingRatioPolicy is Ownable {
    /// @notice Threshold in basis points. Mint blocked if backing < threshold.
    uint16 public thresholdBps;

    /// @notice Latest backing ratio from CRE report (basis points).
    uint16 public currentBps;

    /// @notice Timestamp of last update from CRE.
    uint40 public lastUpdated;

    /// @notice Address authorized to update policy state (RiskConsumerWithACE).
    address public riskConsumer;

    event ThresholdUpdated(uint16 oldThreshold, uint16 newThreshold);
    event BackingRatioUpdated(uint16 newRatio, uint40 timestamp);

    error OnlyRiskConsumer(address caller, address expected);
    error InvalidThreshold(uint16 value);

    modifier onlyRiskConsumer() {
        if (msg.sender != riskConsumer) {
            revert OnlyRiskConsumer(msg.sender, riskConsumer);
        }
        _;
    }

    /**
     * @param _thresholdBps Initial threshold in bps. 10000 = 100% = fully backed.
     * @param _riskConsumer Address of RiskConsumerWithACE that pushes updates.
     */
    constructor(uint16 _thresholdBps, address _riskConsumer) Ownable(msg.sender) {
        if (_thresholdBps == 0 || _thresholdBps > 20000) revert InvalidThreshold(_thresholdBps);
        thresholdBps = _thresholdBps;
        riskConsumer = _riskConsumer;
        // Start with a safe default so mint isn't blocked before first CRE run
        currentBps = _thresholdBps;
        lastUpdated = uint40(block.timestamp);
    }

    /**
     * @notice Called by RiskConsumerWithACE when a new CRE report arrives.
     * @param _backingRatioBps The new backing ratio in basis points.
     * @param _timestamp The off-chain computation timestamp.
     */
    function update(uint16 _backingRatioBps, uint40 _timestamp) external onlyRiskConsumer {
        currentBps = _backingRatioBps;
        lastUpdated = _timestamp;
        emit BackingRatioUpdated(_backingRatioBps, _timestamp);
    }

    /**
     * @notice Checked by ConvergeStablecoin.mint(). Pure state read, no external calls.
     * @return True if backing ratio >= threshold (system is healthy).
     */
    function isHealthy() external view returns (bool) {
        return currentBps >= thresholdBps;
    }

    /**
     * @notice Owner can adjust threshold. E.g. regulator changes requirement.
     */
    function setThreshold(uint16 _newThreshold) external onlyOwner {
        if (_newThreshold == 0 || _newThreshold > 20000) revert InvalidThreshold(_newThreshold);
        emit ThresholdUpdated(thresholdBps, _newThreshold);
        thresholdBps = _newThreshold;
    }

    /**
     * @notice Owner can update risk consumer address if redeployed.
     */
    function setRiskConsumer(address _riskConsumer) external onlyOwner {
        riskConsumer = _riskConsumer;
    }
}
