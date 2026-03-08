// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title RiskReportExtractor
 * @notice Decodes abi.encoded risk reports written by CRE workflows.
 *         Each report contains system-level health metrics computed
 *         off-chain by the risk-engine (ACTUS simulation + metric computation).
 *
 * Report layout (abi.encode, 8 fields × 32 bytes = 256 bytes):
 *   backingPct              uint16  — total reserves / supply as integer % (490 = 490%)
 *   liquidityPct            uint16  — cash reserves / total reserves as integer % (69 = 69%)
 *   riskScore               uint16  — composite risk score 0-100 (0 = safe, 100 = critical)
 *   maturityGapDays         uint16  — weighted average maturity of locked assets in days
 *   timestamp               uint40  — unix timestamp of the off-chain computation
 *   scenarioId              bytes32 — keccak256 of the ACTUS scenario name
 *   assetEligibilityPct     uint16  — % of reserves in GENIUS-Act-permitted asset types (100 = fully eligible)
 *   custodianDiversityScore uint16  — inverse HHI of cash custodian distribution 0-100 (80 = well diversified)
 *
 * Regulatory basis:
 *   backingPct ≥ 100        GENIUS Act §4(a)(1): reserves on "at least 1 to 1 basis"
 *   liquidityPct ≥ 30       MiCA Art.54: "at least 30% of funds in credit institution"
 *   riskScore ≤ 70          Converge.fi composite threshold
 *   assetEligibilityPct = 100  GENIUS Act §4(a)(1)(A): "reserves may only consist of" permitted assets
 */
library RiskReportExtractor {
    struct RiskReport {
        uint16 backingPct;              // 490 = 490% backing
        uint16 liquidityPct;            // 69 = 69% cash/reserves
        uint16 riskScore;               // 0-100 scale
        uint16 maturityGapDays;         // WAM in days
        uint40 timestamp;               // when the off-chain computation ran
        bytes32 scenarioId;             // e.g. keccak256("demo_mint_halt_restore")
        uint16 assetEligibilityPct;     // 100 = all GENIUS-eligible
        uint16 custodianDiversityScore; // 80 = well diversified across custodians
    }

    error InvalidReportLength(uint256 expected, uint256 actual);

    /**
     * @notice Decode a CRE-signed report payload into a RiskReport struct.
     * @param data The raw bytes from the CRE report payload.
     * @return report The decoded risk metrics.
     */
    function decode(bytes calldata data) internal pure returns (RiskReport memory report) {
        // abi.encode of 8 fields = 8 × 32 bytes = 256 bytes
        if (data.length < 256) {
            revert InvalidReportLength(256, data.length);
        }

        (
            uint16 backingPct,
            uint16 liquidityPct,
            uint16 riskScore,
            uint16 maturityGapDays,
            uint40 timestamp,
            bytes32 scenarioId,
            uint16 assetEligibilityPct,
            uint16 custodianDiversityScore
        ) = abi.decode(data, (uint16, uint16, uint16, uint16, uint40, bytes32, uint16, uint16));

        report = RiskReport({
            backingPct: backingPct,
            liquidityPct: liquidityPct,
            riskScore: riskScore,
            maturityGapDays: maturityGapDays,
            timestamp: timestamp,
            scenarioId: scenarioId,
            assetEligibilityPct: assetEligibilityPct,
            custodianDiversityScore: custodianDiversityScore
        });
    }
}
