# Converge.fi — Architecture

## Overview

Converge.fi implements a **circuit breaker pattern** for stablecoin minting. The off-chain risk engine runs continuously on a CRE cron schedule, computes risk metrics from ACTUS financial simulations, and writes them on-chain. When someone tries to mint, the contract reads the already-stored policy state — no off-chain call at mint time.

## Data Flow

```
CONTINUOUS BACKGROUND (CRE cron — every 1 hour)
════════════════════════════════════════════════

CRE Workflow runs on schedule
    ↓
httpClient.sendRequest() → POST risk-engine/api/v1/cre-report
    ↓
risk-engine runs ACTUS simulation (10-step pipeline on ports 8082/8083)
    ↓
Computes metrics from simulation events (PP/MRD/IED/MD)
    ↓
Returns { backingRatioBps, liquidityRatioBps, riskScore, maturityGapDays }
    ↓
CRE signs report → evmClient.writeReport() → RiskConsumerWithACE on Sepolia
    ↓
RiskConsumerWithACE fans out to 3 policy contracts:
    → BackingRatioPolicy.update(backingBps, timestamp)
    → LiquidityRatioPolicy.update(liquidityBps, timestamp)
    → RiskScorePolicy.update(riskScore, timestamp)
    ↓
Policy state sits on-chain, WAITING

INDIVIDUAL MINT (whenever someone deposits + mints)
═══════════════════════════════════════════════════

ConvergeStablecoin.mint(to, amount):
    1. STALENESS: block.timestamp - lastUpdate <= maxStaleAge?
    2. GATE 1: BackingRatioPolicy.isHealthy()?
    3. GATE 2: LiquidityRatioPolicy.isHealthy()?
    4. GATE 3: RiskScorePolicy.isHealthy()?
    → ALL PASS → _mint()
    → ANY FAIL → revert with specific error
```

## Contract Architecture

```
CRE DON Forwarder (Chainlink infrastructure)
    ↓ calls onReport(bytes)
RiskConsumerWithACE.sol  ← "mailbox" — receives signed CRE reports
    ↓ decodes via RiskReportExtractor library
    ↓ fans out to 3 policy contracts:
    ├── BackingRatioPolicy.sol    ← Gate 1: backing >= 100%?
    ├── LiquidityRatioPolicy.sol  ← Gate 2: cash >= 10% of supply?
    └── RiskScorePolicy.sol       ← Gate 3: composite score <= 70?

ConvergeStablecoin.sol  ← ERC20 token with policy gates
```

## Report Encoding

```solidity
abi.encode(
    uint16 backingRatioBps,      // 10200 = 102.00%
    uint16 liquidityRatioBps,    // 1500  = 15.00%
    uint8  riskScore,            // 0-100
    uint8  maturityGapDays,      // days until next T-bill maturity
    uint40 timestamp,            // unix timestamp of computation
    bytes32 scenarioId           // keccak256("sc_depeg_stress_scn01")
)
```

## Two Users, Two Interfaces

### Risk Manager (dashboard user)
Monitors stablecoin health, runs what-if scenarios, takes analysis to treasury team. Does NOT mint.

### Minter (contract user)
Deposits collateral and calls mint(). Interacts with ConvergeStablecoin directly. Never sees the dashboard.
