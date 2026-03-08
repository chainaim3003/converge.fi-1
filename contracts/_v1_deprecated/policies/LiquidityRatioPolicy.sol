// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title LiquidityRatioPolicy
 * @notice Gate 2: Can the issuer pay redemptions in cash right now?
 *
 * This is the CRITICAL policy for treasury-backed stablecoins.
 * A stablecoin can be 103% BACKED (solvent) but still fail if all
 * reserves are locked in T-bills that mature next week while
 * redemptions are hitting NOW.
 *
 * From the ACTUS simulation data:
 *   - sc_depeg_stress_scn01: cash dropped from $40.8M (40%) to $13.2M (15%)
 *     → crossed 35% threshold at day 6
 *     → per 609-event data: <20% liquidity → only 23% recovery rate
 *   - sc_treasury_stress_01: cash dropped to $2M (1.1%) on March 14
 *     → T-bill-A matured March 15 saving the system with $25M injection
 *     → maturity ladder was the difference between survival and failure
 *
 * What "liquidity ratio" means:
 *   liquidityRatioBps = (cashReserves / totalSupply) * 10000
 *   This measures IMMEDIATE redemption capacity, not total solvency.
 *
 * Default threshold: 1000 bps (10%) — issuer must hold at least 10% in cash.
 */
contract LiquidityRatioPolicy is Ownable {
    /// @notice Threshold in basis points. Mint blocked if liquidity < threshold.
    uint16 public thresholdBps;

    /// @notice Latest liquidity ratio from CRE report (basis points).
    uint16 public currentBps;

    /// @notice Timestamp of last update from CRE.
    uint40 public lastUpdated;

    /// @notice Address authorized to update policy state (RiskConsumerWithACE).
    address public riskConsumer;

    event ThresholdUpdated(uint16 oldThreshold, uint16 newThreshold);
    event LiquidityRatioUpdated(uint16 newRatio, uint40 timestamp);

    error OnlyRiskConsumer(address caller, address expected);
    error InvalidThreshold(uint16 value);

    modifier onlyRiskConsumer() {
        if (msg.sender != riskConsumer) {
            revert OnlyRiskConsumer(msg.sender, riskConsumer);
        }
        _;
    }

    /**
     * @param _thresholdBps Initial threshold in bps. 1000 = 10% cash minimum.
     * @param _riskConsumer Address of RiskConsumerWithACE that pushes updates.
     */
    constructor(uint16 _thresholdBps, address _riskConsumer) Ownable(msg.sender) {
        if (_thresholdBps == 0 || _thresholdBps > 10000) revert InvalidThreshold(_thresholdBps);
        thresholdBps = _thresholdBps;
        riskConsumer = _riskConsumer;
        currentBps = _thresholdBps;
        lastUpdated = uint40(block.timestamp);
    }

    /**
     * @notice Called by RiskConsumerWithACE when a new CRE report arrives.
     * @param _liquidityRatioBps The new liquidity ratio in basis points.
     * @param _timestamp The off-chain computation timestamp.
     */
    function update(uint16 _liquidityRatioBps, uint40 _timestamp) external onlyRiskConsumer {
        currentBps = _liquidityRatioBps;
        lastUpdated = _timestamp;
        emit LiquidityRatioUpdated(_liquidityRatioBps, _timestamp);
    }

    /**
     * @notice Checked by ConvergeStablecoin.mint(). Pure state read.
     * @return True if liquidity ratio >= threshold (enough cash for redemptions).
     */
    function isHealthy() external view returns (bool) {
        return currentBps >= thresholdBps;
    }

    function setThreshold(uint16 _newThreshold) external onlyOwner {
        if (_newThreshold == 0 || _newThreshold > 10000) revert InvalidThreshold(_newThreshold);
        emit ThresholdUpdated(thresholdBps, _newThreshold);
        thresholdBps = _newThreshold;
    }

    function setRiskConsumer(address _riskConsumer) external onlyOwner {
        riskConsumer = _riskConsumer;
    }
}
