// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {RiskReportExtractor} from "./extractors/RiskReportExtractor.sol";
import {BackingRatioPolicy} from "./policies/BackingRatioPolicy.sol";
import {LiquidityRatioPolicy} from "./policies/LiquidityRatioPolicy.sol";
import {RiskScorePolicy} from "./policies/RiskScorePolicy.sol";

// IReceiver interface requirement (Chainlink CRE):
//   The Chainlink KeystoneForwarder validates DON signatures then calls:
//     onReport(bytes calldata metadata, bytes calldata report)
//
//   - `metadata` carries workflow provenance: workflowName (bytes10),
//     workflowOwner (address), reportName (bytes2).
//     Source: https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/overview-go
//   - `report`   carries the ABI-encoded risk payload written by the CRE workflow.
//
// We declare the two-argument signature directly to stay compliant with the
// KeystoneForwarder IReceiver interface without adding extra package dependencies.
//
// Data flow:
//   CRE workflow (off-chain)
//     -> runtime.report(hexToBase64(encodeAbiParameters(...)))
//     -> evmClient.writeReport(this address)
//     -> KeystoneForwarder verifies DON signatures
//     -> onReport(metadata, report) called here
//     -> RiskReportExtractor.decode(report)
//     -> backingPolicy.update() / liquidityPolicy.update() / riskScorePolicy.update()
//     -> ConvergeStablecoin.mint() reads stored policy state (no off-chain calls)

/**
 * @title RiskConsumerWithACE
 * @notice Receives signed risk reports from CRE workflows via the Chainlink
 *         KeystoneForwarder, decodes them, and fans out metrics to the three
 *         policy contracts that gate ConvergeStablecoin.mint().
 */
contract RiskConsumerWithACE is Ownable {
    using RiskReportExtractor for bytes;

    // ─── Policy contracts ───
    BackingRatioPolicy  public backingPolicy;
    LiquidityRatioPolicy public liquidityPolicy;
    RiskScorePolicy     public riskScorePolicy;

    // ─── Report storage (audit trail) ───
    uint256 public reportCount;
    mapping(uint256 => RiskReportExtractor.RiskReport) public reports;

    // ─── Latest state (dashboard reads) ───
    RiskReportExtractor.RiskReport public latestReport;

    // ─── Access control ───
    /// @notice Address of the Chainlink KeystoneForwarder on this network.
    ///         Production Sepolia: see https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory
    ///         Simulation: set to msg.sender (deployer) for `cre workflow simulate`.
    address public creForwarder;

    // ─── Events ───
    event ReportReceived(
        uint256 indexed reportIndex,
        uint16  backingRatioBps,
        uint16  liquidityRatioBps,
        uint8   riskScore,
        uint8   maturityGapDays,
        uint40  timestamp,
        bytes32 scenarioId
    );

    event PoliciesUpdated(
        bool backingHealthy,
        bool liquidityHealthy,
        bool riskScoreHealthy
    );

    // ─── Errors ───
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

    // ─── Policy registration ───

    function setPolicies(
        address _backingPolicy,
        address _liquidityPolicy,
        address _riskScorePolicy
    ) external onlyOwner {
        backingPolicy  = BackingRatioPolicy(_backingPolicy);
        liquidityPolicy = LiquidityRatioPolicy(_liquidityPolicy);
        riskScorePolicy = RiskScorePolicy(_riskScorePolicy);
    }

    // ─── IReceiver: receive CRE report ───

    /**
     * @notice Called by the Chainlink KeystoneForwarder after it validates
     *         the DON's aggregate signature on the report.
     *
     * @param metadata  Workflow provenance bytes (workflowName, workflowOwner,
     *                  reportName). Not decoded here — kept for ABI compliance.
     * @param report    ABI-encoded risk payload: abi.encode(uint16, uint16,
     *                  uint8, uint8, uint40, bytes32). Matches the encoding
     *                  produced by the CRE workflow via encodeAbiParameters.
     *
     * Source: Chainlink CRE docs — IReceiver interface:
     *   https://docs.chain.link/cre/guides/workflow/using-evm-client/onchain-write/overview-go
     *   "onReport(bytes metadata, bytes report)"
     */
    function onReport(
        bytes calldata metadata,
        bytes calldata report
    ) external onlyCreForwarder {
        // silence unused-variable warning for metadata
        metadata;

        if (address(backingPolicy) == address(0)) revert PoliciesNotSet();

        // Decode risk metrics from the CRE-signed report payload
        RiskReportExtractor.RiskReport memory decoded = report.decode();

        // Store for audit trail
        uint256 idx = reportCount;
        reports[idx] = decoded;
        latestReport = decoded;
        reportCount = idx + 1;

        // Fan out to policy contracts
        backingPolicy.update(decoded.backingRatioBps, decoded.timestamp);
        liquidityPolicy.update(decoded.liquidityRatioBps, decoded.timestamp);
        riskScorePolicy.update(decoded.riskScore, decoded.timestamp);

        emit ReportReceived(
            idx,
            decoded.backingRatioBps,
            decoded.liquidityRatioBps,
            decoded.riskScore,
            decoded.maturityGapDays,
            decoded.timestamp,
            decoded.scenarioId
        );

        emit PoliciesUpdated(
            backingPolicy.isHealthy(),
            liquidityPolicy.isHealthy(),
            riskScorePolicy.isHealthy()
        );
    }

    // ─── Read helpers ───

    /**
     * @notice Returns full system health in one call (minimises dashboard RPC calls).
     */
    function getSystemHealth() external view returns (
        uint16 backingRatioBps,
        uint16 liquidityRatioBps,
        uint8  riskScore,
        uint8  maturityGapDays,
        bool   backingHealthy,
        bool   liquidityHealthy,
        bool   riskScoreHealthy,
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
     * @notice Retrieve a specific historical report by index.
     */
    function getReport(uint256 index)
        external view
        returns (RiskReportExtractor.RiskReport memory)
    {
        return reports[index];
    }

    // ─── Admin ───

    function setCreForwarder(address _creForwarder) external onlyOwner {
        creForwarder = _creForwarder;
    }
}
