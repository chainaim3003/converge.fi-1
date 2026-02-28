// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RiskReportExtractor} from "./extractors/RiskReportExtractor.sol";
import {BackingRatioPolicy} from "./policies/BackingRatioPolicy.sol";
import {LiquidityRatioPolicy} from "./policies/LiquidityRatioPolicy.sol";
import {RiskScorePolicy} from "./policies/RiskScorePolicy.sol";

/**
 * @title RiskConsumerWithACE
 * @notice The "mailbox" contract. Receives signed risk reports from CRE workflows
 *         via Chainlink ACE (Autonomous Contract Execution), decodes them using
 *         RiskReportExtractor, and fans out the metrics to the 3 policy contracts.
 *
 * Data flow:
 *   CRE Workflow (off-chain)
 *     → runtime.report(abi.encode(backingBps, liqBps, score, gap, ts, scenarioId))
 *     → evmClient.writeReport(this address)
 *     → onReport() called by Chainlink DON
 *     → decode → update BackingRatioPolicy, LiquidityRatioPolicy, RiskScorePolicy
 *     → ConvergeStablecoin.mint() reads those policies (no further off-chain calls)
 *
 * The CRE workflow that produces these reports:
 *   1. httpClient.sendRequest() → POST risk-engine/api/v1/cre-report
 *   2. risk-engine runs ACTUS simulation (10-step pipeline on ports 8082/8083)
 *   3. Computes metrics from simulation events (PP/MRD/IED/MD events)
 *   4. Returns { backingRatioBps, liquidityRatioBps, riskScore, maturityGapDays }
 *   5. CRE signs and writes to this contract
 *
 * Report history is stored for audit trail (dashboard reads via events + getReport).
 */
contract RiskConsumerWithACE is Ownable {
    using RiskReportExtractor for bytes;

    // ─── Policy contracts ───
    BackingRatioPolicy public backingPolicy;
    LiquidityRatioPolicy public liquidityPolicy;
    RiskScorePolicy public riskScorePolicy;

    // ─── Report storage (audit trail) ───
    uint256 public reportCount;
    mapping(uint256 => RiskReportExtractor.RiskReport) public reports;

    // ─── Latest state (convenience reads for dashboard) ───
    RiskReportExtractor.RiskReport public latestReport;

    // ─── Access control ───
    /// @notice Address of the CRE DON forwarder that can write reports.
    address public creForwarder;

    // ─── Events (dashboard reads these) ───
    event ReportReceived(
        uint256 indexed reportIndex,
        uint16 backingRatioBps,
        uint16 liquidityRatioBps,
        uint8 riskScore,
        uint8 maturityGapDays,
        uint40 timestamp,
        bytes32 scenarioId
    );

    event PoliciesUpdated(
        bool backingHealthy,
        bool liquidityHealthy,
        bool riskScoreHealthy
    );

    error OnlyCreForwarder(address caller, address expected);
    error PoliciesNotSet();

    modifier onlyCreForwarder() {
        if (msg.sender != creForwarder) {
            revert OnlyCreForwarder(msg.sender, creForwarder);
        }
        _;
    }

    constructor(address _creForwarder) Ownable(msg.sender) {
        creForwarder = _creForwarder;
    }

    // ─── Policy registration (called once after deployment) ───

    function setPolicies(
        address _backingPolicy,
        address _liquidityPolicy,
        address _riskScorePolicy
    ) external onlyOwner {
        backingPolicy = BackingRatioPolicy(_backingPolicy);
        liquidityPolicy = LiquidityRatioPolicy(_liquidityPolicy);
        riskScorePolicy = RiskScorePolicy(_riskScorePolicy);
    }

    // ─── Core: receive CRE report ───

    /**
     * @notice Called by CRE DON forwarder when a new signed report arrives.
     *         Decodes the report, stores it, and updates all 3 policy contracts.
     * @param reportData The abi.encoded risk report payload from CRE workflow.
     */
    function onReport(bytes calldata reportData) external onlyCreForwarder {
        if (address(backingPolicy) == address(0)) revert PoliciesNotSet();

        // Decode using the library
        RiskReportExtractor.RiskReport memory report = reportData.decode();

        // Store for audit trail
        uint256 idx = reportCount;
        reports[idx] = report;
        latestReport = report;
        reportCount = idx + 1;

        // Fan out to policy contracts
        backingPolicy.update(report.backingRatioBps, report.timestamp);
        liquidityPolicy.update(report.liquidityRatioBps, report.timestamp);
        riskScorePolicy.update(report.riskScore, report.timestamp);

        emit ReportReceived(
            idx,
            report.backingRatioBps,
            report.liquidityRatioBps,
            report.riskScore,
            report.maturityGapDays,
            report.timestamp,
            report.scenarioId
        );

        emit PoliciesUpdated(
            backingPolicy.isHealthy(),
            liquidityPolicy.isHealthy(),
            riskScorePolicy.isHealthy()
        );
    }

    // ─── Read helpers (for dashboard + AI chat) ───

    /**
     * @notice Returns full health status in one call (saves RPC calls for dashboard).
     */
    function getSystemHealth() external view returns (
        uint16 backingRatioBps,
        uint16 liquidityRatioBps,
        uint8 riskScore,
        uint8 maturityGapDays,
        bool backingHealthy,
        bool liquidityHealthy,
        bool riskScoreHealthy,
        uint40 lastUpdated
    ) {
        RiskReportExtractor.RiskReport memory r = latestReport;
        return (
            r.backingRatioBps,
            r.liquidityRatioBps,
            r.riskScore,
            r.maturityGapDays,
            backingPolicy.isHealthy(),
            liquidityPolicy.isHealthy(),
            riskScorePolicy.isHealthy(),
            r.timestamp
        );
    }

    /**
     * @notice Get a specific historical report by index.
     */
    function getReport(uint256 index) external view returns (RiskReportExtractor.RiskReport memory) {
        return reports[index];
    }

    // ─── Admin ───

    function setCreForwarder(address _creForwarder) external onlyOwner {
        creForwarder = _creForwarder;
    }
}
