// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MultiAttributeRiskPolicy} from "./MultiAttributeRiskPolicy.sol";

/**
 * @title ConvergeStablecoin
 * @notice ERC20 stablecoin with automated risk-based mint control.
 *
 * V4 Architecture:
 *   1. CRE workflow runs on CRON → calls risk-engine → ACTUS simulation → computes 8 metrics
 *   2. CRE writes signed report to MultiAttributeConvergeRiskConsumer (via ReceiverTemplate)
 *   3. Consumer pushes 8 metrics to MultiAttributeRiskPolicy
 *   4. Policy state sits on-chain, pre-computed, WAITING
 *   5. Minter calls mint() → mint() reads isHealthy() from the single policy
 *   6. 4 hard gates: backing≥100, liquidity≥30, riskScore≤70, eligibility=100
 *
 * Regulatory basis:
 *   GENIUS Act §4(a)(1): 1:1 reserve backing, permitted assets only
 *   MiCA Art.54: 30% liquidity in bank deposits
 *
 * Source: OpenZeppelin ERC20 v5
 *   https://docs.openzeppelin.com/contracts/5.x/erc20
 */
contract ConvergeStablecoin is ERC20, Ownable {
    // ─── Policy contract (single, replaces 3 separate V1 policies) ───
    MultiAttributeRiskPolicy public riskPolicy;

    // ─── Deposit tracking ───
    uint256 public totalDeposited;
    mapping(address => uint256) public deposits;

    // ─── Operator access ───
    mapping(address => bool) public operators;

    // ─── Events ───
    event DepositReceived(address indexed depositor, uint256 amount, uint256 totalDeposited);

    event MintExecuted(
        address indexed to,
        uint256 amount,
        uint16 backingPct,
        uint16 liquidityPct,
        uint16 riskScore
    );

    event MintBlocked(address indexed requester, uint256 amount, string reason);
    event OperatorUpdated(address indexed operator, bool authorized);
    event RiskPolicyUpdated(address indexed previousPolicy, address indexed newPolicy);

    // ─── Errors ───
    error MintBlockedError(string reason);
    error OnlyOperator(address caller);
    error PolicyNotSet();
    error ZeroAmount();

    modifier onlyOperator() {
        if (!operators[msg.sender] && msg.sender != owner()) {
            revert OnlyOperator(msg.sender);
        }
        _;
    }

    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _maxStaleAge
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        // maxStaleAge is now managed by MultiAttributeRiskPolicy
        // _maxStaleAge parameter kept for backward compatibility but not stored here
        (_maxStaleAge); // silence unused warning
        operators[msg.sender] = true;
    }

    // ─── Setup ───

    function setRiskPolicy(address _riskPolicy) external onlyOwner {
        address prev = address(riskPolicy);
        riskPolicy = MultiAttributeRiskPolicy(_riskPolicy);
        emit RiskPolicyUpdated(prev, _riskPolicy);
    }

    // ─── Deposit ───

    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();
        deposits[msg.sender] += msg.value;
        totalDeposited += msg.value;
        emit DepositReceived(msg.sender, msg.value, totalDeposited);
    }

    // ─── Mint: the circuit breaker ───

    function mint(address to, uint256 amount) external onlyOperator {
        if (address(riskPolicy) == address(0)) revert PolicyNotSet();
        if (amount == 0) revert ZeroAmount();

        (
            bool allowed,
            string memory reason,
            uint16 bk,
            uint16 lq,
            uint16 rs,
            /* staleAge */
        ) = riskPolicy.getMintStatus();

        if (!allowed) {
            emit MintBlocked(msg.sender, amount, reason);
            revert MintBlockedError(reason);
        }

        _mint(to, amount);
        emit MintExecuted(to, amount, bk, lq, rs);
    }

    // ─── Read helpers ───

    function getMintStatus() external view returns (
        bool mintAllowed,
        string memory reason,
        uint16 backingPct,
        uint16 liquidityPct,
        uint16 riskScore,
        uint256 staleAge
    ) {
        if (address(riskPolicy) == address(0)) {
            return (false, "Policy not configured", 0, 0, 0, 0);
        }
        return riskPolicy.getMintStatus();
    }

    // ─── Admin ───

    function setOperator(address _operator, bool _authorized) external onlyOwner {
        operators[_operator] = _authorized;
        emit OperatorUpdated(_operator, _authorized);
    }

    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
