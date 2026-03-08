// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReceiverTemplate} from "./interfaces/ReceiverTemplate.sol";
import {RiskReportExtractor} from "./extractors/RiskReportExtractor.sol";
import {MultiAttributeRiskPolicy} from "./MultiAttributeRiskPolicy.sol";

/**
 * @title MultiAttributeConvergeRiskConsumer
 * @notice Receives signed risk reports from CRE workflows via the Chainlink
 *         KeystoneForwarder (through ReceiverTemplate), decodes them using
 *         RiskReportExtractor, and pushes all 8 metrics to the single
 *         MultiAttributeRiskPolicy that gates ConvergeStablecoin.mint().
 *
 * Data flow:
 *   CRE workflow (off-chain)
 *     → runtime.report(hexToBase64(encodeAbiParameters(8 fields)))
 *     → evmClient.writeReport(this address)
 *     → MockKeystoneForwarder verifies DON signatures
 *     → ReceiverTemplate.onReport(metadata, report) validates sender
 *     → ReceiverTemplate strips envelope, extracts clean 256-byte payload
 *     → _processReport(report) called here
 *     → RiskReportExtractor.decode(report) → 8-field struct
 *     → riskPolicy.updateReport(8 fields)
 *     → ConvergeStablecoin.mint() reads stored policy state
 *
 * Source: Chainlink CRE ReceiverTemplate pattern
 *   https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/overview-go
 */
contract MultiAttributeConvergeRiskConsumer is ReceiverTemplate {
    using RiskReportExtractor for bytes;

    // ─── Policy contract ───
    MultiAttributeRiskPolicy public riskPolicy;

    // ─── Report audit trail ───
    uint256 public reportCount;
    RiskReportExtractor.RiskReport public latestReport;

    // ─── Events ───
    event ReportReceived(
        uint256 indexed reportIndex,
        uint16 backingPct,
        uint16 liquidityPct,
        uint16 riskScore,
        uint16 maturityGapDays,
        uint40 timestamp,
        bytes32 scenarioId,
        uint16 assetEligibilityPct,
        uint16 custodianDiversityScore
    );

    event PolicyUpdated(bool healthy);

    // ─── Errors ───
    error PolicyNotSet();

    /**
     * @param _forwarderAddress The Chainlink KeystoneForwarder address on this network.
     *        Sepolia MockKeystoneForwarder: 0x15fC6ae953E024d975e77382eEeC56A9101f9F88
     *        Source: https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts
     */
    constructor(address _forwarderAddress) ReceiverTemplate(_forwarderAddress) {}

    // ─── Policy registration ───

    function setRiskPolicy(address _riskPolicy) external onlyOwner {
        riskPolicy = MultiAttributeRiskPolicy(_riskPolicy);
    }

    // ─── CRE Entry Point: process decoded report ───

    /**
     * @notice Called by ReceiverTemplate after it validates the forwarder
     *         and strips the envelope. `report` is the clean 256-byte payload.
     * @param report ABI-encoded 8 fields:
     *        (uint16, uint16, uint16, uint16, uint40, bytes32, uint16, uint16)
     */
    function _processReport(bytes calldata report) internal override {
        if (address(riskPolicy) == address(0)) revert PolicyNotSet();

        // Decode 256 bytes → 8-field struct
        RiskReportExtractor.RiskReport memory decoded = report.decode();

        // Store latest for dashboard reads
        latestReport = decoded;
        uint256 idx = reportCount;
        reportCount = idx + 1;

        // Push all 8 fields to the single policy contract
        riskPolicy.updateReport(
            decoded.backingPct,
            decoded.liquidityPct,
            decoded.riskScore,
            decoded.maturityGapDays,
            decoded.timestamp,
            decoded.scenarioId,
            decoded.assetEligibilityPct,
            decoded.custodianDiversityScore
        );

        emit ReportReceived(
            idx,
            decoded.backingPct,
            decoded.liquidityPct,
            decoded.riskScore,
            decoded.maturityGapDays,
            decoded.timestamp,
            decoded.scenarioId,
            decoded.assetEligibilityPct,
            decoded.custodianDiversityScore
        );

        emit PolicyUpdated(riskPolicy.isHealthy());
    }

    // ─── Read helpers (dashboard) ───

    function getSystemHealth() external view returns (
        uint16 _backingPct,
        uint16 _liquidityPct,
        uint16 _riskScore,
        uint16 _maturityGapDays,
        uint16 _assetEligibilityPct,
        uint16 _custodianDiversityScore,
        bool healthy,
        uint40 _lastUpdated
    ) {
        RiskReportExtractor.RiskReport memory r = latestReport;
        return (
            r.backingPct,
            r.liquidityPct,
            r.riskScore,
            r.maturityGapDays,
            r.assetEligibilityPct,
            r.custodianDiversityScore,
            riskPolicy.isHealthy(),
            r.timestamp
        );
    }
}
