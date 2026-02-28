// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BackingRatioPolicy} from "./policies/BackingRatioPolicy.sol";
import {LiquidityRatioPolicy} from "./policies/LiquidityRatioPolicy.sol";
import {RiskScorePolicy} from "./policies/RiskScorePolicy.sol";
import {RiskConsumerWithACE} from "./RiskConsumerWithACE.sol";

/**
 * @title ConvergeStablecoin
 * @notice ERC20 stablecoin with automated risk-based mint control.
 *
 * How minting works (the circuit breaker pattern):
 *
 *   1. CRE workflow runs on CRON (e.g. hourly) or LOG TRIGGER (large deposit).
 *   2. CRE calls risk-engine → ACTUS simulation → computes system health.
 *   3. CRE writes signed report to RiskConsumerWithACE → updates 3 policies.
 *   4. Policy state sits on-chain, pre-computed, WAITING.
 *
 *   5. Depositor calls deposit(amount) → collateral escrowed, event emitted.
 *   6. Event can trigger CRE log trigger for immediate risk refresh (Level 2).
 *   7. Minter (operator/depositor) calls mint(to, amount).
 *   8. mint() checks:
 *      a. STALENESS: is the risk state fresh enough? (< maxStaleAge)
 *      b. GATE 1: BackingRatioPolicy.isHealthy() — fully backed?
 *      c. GATE 2: LiquidityRatioPolicy.isHealthy() — enough cash for redemptions?
 *      d. GATE 3: RiskScorePolicy.isHealthy() — composite risk acceptable?
 *   9. All pass → mint executes immediately. No off-chain call at mint time.
 *
 * Three levels of triggering (from architecture design):
 *   Level 1 (hackathon): CRE cron only. State can be up to N hours stale.
 *   Level 2 (production): CRE cron + log trigger on large deposits.
 *   Level 3 (ideal): Two-phase escrow. Deposit → CRE check → executeMint or refund.
 *
 * This contract implements Level 1 with the staleness guard as safety net,
 * and emits DepositReceived for Level 2 log trigger support.
 *
 * From the ACTUS simulations:
 *   - sc_depeg_stress_scn01: $100M → $8.7M (91.3% supply destroyed)
 *     → mint would have been blocked at Day 7 when backing < 100%
 *   - sc_treasury_stress_01: solvent (103%) but illiquid (1.1% cash)
 *     → mint would have been blocked by liquidity policy even though backing was fine
 */
contract ConvergeStablecoin is ERC20, Ownable {
    // ─── Policy contracts ───
    BackingRatioPolicy public backingPolicy;
    LiquidityRatioPolicy public liquidityPolicy;
    RiskScorePolicy public riskScorePolicy;
    RiskConsumerWithACE public riskConsumer;

    // ─── Staleness configuration ───
    /// @notice Maximum age (seconds) of risk state before mint is paused.
    uint256 public maxStaleAge;

    // ─── Deposit tracking ───
    /// @notice Total collateral deposited (for dashboard display).
    uint256 public totalDeposited;

    /// @notice Per-depositor balances (for potential refund in Level 3).
    mapping(address => uint256) public deposits;

    // ─── Operator access ───
    /// @notice Addresses authorized to call mint (operator pattern).
    mapping(address => bool) public operators;

    // ─── Events ───
    /// @notice Emitted on deposit. CRE log trigger listens for this.
    ///         In Level 2: large deposits (> depositAlertThreshold) trigger
    ///         immediate CRE risk refresh instead of waiting for cron.
    event DepositReceived(
        address indexed depositor,
        uint256 amount,
        uint256 totalDeposited
    );

    event MintExecuted(
        address indexed to,
        uint256 amount,
        uint16 backingAtMint,
        uint16 liquidityAtMint,
        uint8 riskScoreAtMint
    );

    event MintBlocked(
        address indexed requester,
        uint256 amount,
        string reason
    );

    event OperatorUpdated(address indexed operator, bool authorized);

    // ─── Errors ───
    error MintBlockedStale(uint256 age, uint256 maxAge);
    error MintBlockedBacking(uint16 current, uint16 threshold);
    error MintBlockedLiquidity(uint16 current, uint16 threshold);
    error MintBlockedRiskScore(uint8 current, uint8 threshold);
    error OnlyOperator(address caller);
    error PoliciesNotSet();
    error ZeroAmount();

    modifier onlyOperator() {
        if (!operators[msg.sender] && msg.sender != owner()) {
            revert OnlyOperator(msg.sender);
        }
        _;
    }

    /**
     * @param _name Token name, e.g. "Converge USD"
     * @param _symbol Token symbol, e.g. "cvUSD"
     * @param _maxStaleAge Max seconds before risk state is considered stale.
     *        3600 = 1 hour (recommended for hackathon demo).
     */
    constructor(
        string memory _name,
        string memory _symbol,
        uint256 _maxStaleAge
    ) ERC20(_name, _symbol) Ownable(msg.sender) {
        maxStaleAge = _maxStaleAge;
        operators[msg.sender] = true;
    }

    // ─── Setup (called once after deployment) ───

    function setPolicies(
        address _backingPolicy,
        address _liquidityPolicy,
        address _riskScorePolicy,
        address _riskConsumer
    ) external onlyOwner {
        backingPolicy = BackingRatioPolicy(_backingPolicy);
        liquidityPolicy = LiquidityRatioPolicy(_liquidityPolicy);
        riskScorePolicy = RiskScorePolicy(_riskScorePolicy);
        riskConsumer = RiskConsumerWithACE(_riskConsumer);
    }

    // ─── Deposit: accepts collateral, emits event for CRE log trigger ───

    /**
     * @notice Deposit collateral. Emits DepositReceived for CRE log trigger.
     *         In Level 1 (hackathon), this just records the deposit.
     *         In Level 2 (production), CRE listens for this event and runs
     *         an immediate risk check if the deposit is large enough.
     */
    function deposit() external payable {
        if (msg.value == 0) revert ZeroAmount();

        deposits[msg.sender] += msg.value;
        totalDeposited += msg.value;

        emit DepositReceived(msg.sender, msg.value, totalDeposited);
    }

    // ─── Mint: the circuit breaker ───

    /**
     * @notice Mint stablecoins. Checks staleness + 3 policy gates.
     *         This does NOT call off-chain. It reads STORED state only.
     *         The off-chain risk engine runs independently on CRE cron/trigger.
     * @param to Recipient of minted tokens.
     * @param amount Amount to mint (18 decimals default ERC20).
     */
    function mint(address to, uint256 amount) external onlyOperator {
        if (address(backingPolicy) == address(0)) revert PoliciesNotSet();
        if (amount == 0) revert ZeroAmount();

        // STALENESS CHECK — safety net for stale risk state
        uint40 lastUpdate = backingPolicy.lastUpdated();
        uint256 age = block.timestamp - uint256(lastUpdate);
        if (age > maxStaleAge) {
            emit MintBlocked(msg.sender, amount, "Risk state too stale");
            revert MintBlockedStale(age, maxStaleAge);
        }

        // GATE 1: Backing ratio
        if (!backingPolicy.isHealthy()) {
            emit MintBlocked(msg.sender, amount, "Backing ratio below threshold");
            revert MintBlockedBacking(
                backingPolicy.currentBps(),
                backingPolicy.thresholdBps()
            );
        }

        // GATE 2: Liquidity ratio
        if (!liquidityPolicy.isHealthy()) {
            emit MintBlocked(msg.sender, amount, "Liquidity ratio below threshold");
            revert MintBlockedLiquidity(
                liquidityPolicy.currentBps(),
                liquidityPolicy.thresholdBps()
            );
        }

        // GATE 3: Risk score
        if (!riskScorePolicy.isHealthy()) {
            emit MintBlocked(msg.sender, amount, "Risk score too high");
            revert MintBlockedRiskScore(
                riskScorePolicy.currentScore(),
                riskScorePolicy.threshold()
            );
        }

        // All gates passed — mint
        _mint(to, amount);

        emit MintExecuted(
            to,
            amount,
            backingPolicy.currentBps(),
            liquidityPolicy.currentBps(),
            riskScorePolicy.currentScore()
        );
    }

    // ─── Read helpers (for dashboard) ───

    /**
     * @notice One-call status check for dashboard MintBlockStatus panel.
     */
    function getMintStatus() external view returns (
        bool mintAllowed,
        string memory reason,
        uint16 backingBps,
        uint16 liquidityBps,
        uint8 riskScore,
        uint256 staleAge
    ) {
        if (address(backingPolicy) == address(0)) {
            return (false, "Policies not configured", 0, 0, 0, 0);
        }

        uint40 lastUpdate = backingPolicy.lastUpdated();
        uint256 age = block.timestamp - uint256(lastUpdate);

        backingBps = backingPolicy.currentBps();
        liquidityBps = liquidityPolicy.currentBps();
        riskScore = riskScorePolicy.currentScore();
        staleAge = age;

        if (age > maxStaleAge) {
            return (false, "Risk state too stale", backingBps, liquidityBps, riskScore, age);
        }
        if (!backingPolicy.isHealthy()) {
            return (false, "Backing ratio below threshold", backingBps, liquidityBps, riskScore, age);
        }
        if (!liquidityPolicy.isHealthy()) {
            return (false, "Liquidity ratio below threshold", backingBps, liquidityBps, riskScore, age);
        }
        if (!riskScorePolicy.isHealthy()) {
            return (false, "Risk score too high", backingBps, liquidityBps, riskScore, age);
        }

        return (true, "All policies healthy", backingBps, liquidityBps, riskScore, age);
    }

    // ─── Admin ───

    function setOperator(address _operator, bool _authorized) external onlyOwner {
        operators[_operator] = _authorized;
        emit OperatorUpdated(_operator, _authorized);
    }

    function setMaxStaleAge(uint256 _maxStaleAge) external onlyOwner {
        maxStaleAge = _maxStaleAge;
    }

    /**
     * @notice Burn tokens (for redemption flow). Any holder can burn their own.
     */
    function burn(uint256 amount) external {
        _burn(msg.sender, amount);
    }
}
