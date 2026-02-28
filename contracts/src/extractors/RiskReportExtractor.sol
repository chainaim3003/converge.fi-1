// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title RiskReportExtractor
 * @notice Decodes abi.encoded risk reports written by CRE workflows.
 *         Each report contains system-level health metrics computed
 *         off-chain by the risk-engine (ACTUS simulation → metric computation).
 *
 * Report layout (abi.encode):
 *   backingRatioBps   uint16  — total reserves / total supply in basis points (10000 = 100%)
 *   liquidityRatioBps uint16  — cash reserves / total supply in basis points
 *   riskScore         uint8   — composite risk score 0-100 (0 = safe, 100 = critical)
 *   maturityGapDays   uint8   — days until next T-bill maturity that covers projected redemptions
 *   timestamp         uint40  — unix timestamp of the off-chain computation
 *   scenarioId        bytes32 — identifier of the ACTUS scenario that produced this report
 */
library RiskReportExtractor {
    struct RiskReport {
        uint16 backingRatioBps;     // 10200 = 102.00%
        uint16 liquidityRatioBps;   // 1500  = 15.00%
        uint8  riskScore;           // 0-100
        uint8  maturityGapDays;     // days until next T-bill maturity covers redemption need
        uint40 timestamp;           // when the off-chain computation ran
        bytes32 scenarioId;         // e.g. keccak256("sc_treasury_stress_01")
    }

    error InvalidReportLength(uint256 expected, uint256 actual);

    /**
     * @notice Decode a CRE-signed report payload into a RiskReport struct.
     * @param data The raw bytes from the CRE report payload.
     * @return report The decoded risk metrics.
     */
    function decode(bytes calldata data) internal pure returns (RiskReport memory report) {
        // abi.encode of the struct = 6 * 32 bytes = 192 bytes
        if (data.length < 192) {
            revert InvalidReportLength(192, data.length);
        }

        (
            uint16 backingRatioBps,
            uint16 liquidityRatioBps,
            uint8 riskScore,
            uint8 maturityGapDays,
            uint40 timestamp,
            bytes32 scenarioId
        ) = abi.decode(data, (uint16, uint16, uint8, uint8, uint40, bytes32));

        report = RiskReport({
            backingRatioBps: backingRatioBps,
            liquidityRatioBps: liquidityRatioBps,
            riskScore: riskScore,
            maturityGapDays: maturityGapDays,
            timestamp: timestamp,
            scenarioId: scenarioId
        });
    }
}
