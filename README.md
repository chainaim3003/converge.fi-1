# Converge.fi — Automated Stablecoin Risk Monitoring

> **Chainlink Convergence Hackathon 2026**
> Automated stablecoin risk monitoring via Chainlink CRE + ACTUS financial simulations

## What Is Converge.fi?

Converge.fi is an on-chain **circuit breaker** for stablecoin minting. It uses Chainlink CRE (Compute Runtime Environment) to run ACTUS financial simulations on a schedule, compute risk metrics, and write them on-chain. When someone tries to mint stablecoins, the contract reads pre-computed policy state — no off-chain call at mint time.

**The problem:** Treasury-backed stablecoins can be 103% backed (solvent) but only 1.1% liquid (can't pay redemptions). Traditional monitoring catches insolvency but misses maturity mismatch.

**Our solution:** Three on-chain policy gates enforced automatically:
- **Gate 1 — Backing Ratio:** Is the stablecoin fully backed? (≥100%)
- **Gate 2 — Liquidity Ratio:** Can the issuer pay redemptions now? (≥10% cash)
- **Gate 3 — Risk Score:** Are dangerous metric combinations present? (≤70/100)

## Architecture

```
CRE Cron (hourly) → risk-engine → ACTUS simulation → compute metrics
    → write signed report ON-CHAIN → RiskConsumerWithACE
    → fan out to 3 policy contracts (BackingRatio, Liquidity, RiskScore)

Minter calls mint() → reads STORED policy state → allow or revert
```

### Three Levels of Triggering

| Level | Trigger | Built? |
|-------|---------|--------|
| **Level 1** (hackathon) | CRE cron only. Staleness guard as safety net. | ✅ Built |
| **Level 2** (production) | CRE cron + log trigger on DepositReceived for large deposits | 📐 Designed |
| **Level 3** (ideal) | Two-phase escrow: deposit → CRE check → executeMint or refund | 📐 Designed |

## Key Simulations

### Simulation 1: De-Peg Stress
A $100M stablecoin faces a 5% peg deviation. The system detects reserve deterioration on Day 7 and blocks minting. Without intervention, 91.3% of supply is redeemed. The circuit breaker prevented minting into a collapsing system.

### Simulation 2: Treasury Maturity Mismatch
The stablecoin is 103% backed — fully solvent. But 80% of reserves are in T-bills maturing weeks out. When a redemption wave hits, cash drops to 1.1% of supply. The MaturityLadder model catches this. T-bill-A matures March 15, injecting $25M cash and saving the system.

## Project Structure

```
converge-fi/
├── contracts/src/          ← 6 Solidity files (circuit breaker pattern)
├── risk-engine/            ← Express wrapper (port 3001) for ACTUS
├── dashboard/              ← React + Vite + Tailwind risk monitoring UI
├── workflows/              ← 4 CRE workflow definitions
├── scripts/deploy.ts       ← Deployment in dependency order
├── test/contracts.test.ts  ← Hardhat test suite
└── docs/                   ← Architecture documentation
```

## Smart Contracts (Sepolia)

| Contract | Purpose |
|----------|---------|
| `RiskReportExtractor.sol` | Library — decodes abi.encoded CRE reports |
| `BackingRatioPolicy.sol` | Gate 1: backing ≥ 100% |
| `LiquidityRatioPolicy.sol` | Gate 2: cash ≥ 10% of supply |
| `RiskScorePolicy.sol` | Gate 3: composite score ≤ 70 |
| `RiskConsumerWithACE.sol` | Receives CRE reports, fans out to policies |
| `ConvergeStablecoin.sol` | ERC20 with deposit + 3 policy gates + staleness |

## CRE Workflows

| Workflow | Track | Trigger | Action |
|----------|-------|---------|--------|
| WF1: Risk Monitoring | Risk & Compliance | Cron (1hr) | ACTUS sim → metrics → on-chain |
| WF2: Reserve Health | DeFi & Tokenization | Cron/HTTP | Multi-sim → composite → on-chain |
| WF3: Privacy Reserve | Privacy | HTTP (confidential) | Confidential HTTP to risk-engine |
| WF4: AI Risk Agent | CRE & AI | Log/Cron | ACTUS + LLM interpretation → on-chain |

## External Dependencies

### ACTUS Docker (NOT in this repo)
ACTUS (Algorithmic Contract Types Unified Standards) runs as Docker containers. We call HTTP endpoints only.

| Service | Port | Purpose |
|---------|------|---------|
| actus-riskserver-ce | 8082 | Risk data service |
| actus-server-rf20 | 8083 | Simulation engine |
| mongodb | 27018 | Data storage |

## Quick Start

```bash
# 1. Install root dependencies
npm install

# 2. Compile contracts
npx hardhat compile

# 3. Run tests
npx hardhat test

# 4. Start risk-engine (requires ACTUS Docker running)
cd risk-engine && npm install && npm run dev

# 5. Start dashboard
cd dashboard && npm install && npm run dev

# 6. Deploy to Sepolia
npx hardhat run scripts/deploy.ts --network sepolia
```

## Environment Setup

Copy `.env.example` to `.env` and configure:

```env
SEPOLIA_RPC_URL=https://rpc.sepolia.org
PRIVATE_KEY=0xYOUR_PRIVATE_KEY
ETHERSCAN_API_KEY=your_key
CRE_FORWARDER_ADDRESS=0x...
```

## Track Submissions

| Track | Prize | Submission |
|-------|-------|------------|
| Risk & Compliance (PRIMARY) | $10K / $6K | WF1 + contracts |
| DeFi & Tokenization | $12K / $8K | WF2 + treasury ladder |
| Privacy | $10K / $6K | WF3 + Confidential HTTP |
| CRE & AI | $10.5K / $6.5K | WF4 + AI chat |

## Links

- [Chainlink CRE Docs](https://docs.chain.link/cre)
- [ACTUS Foundation](https://www.actusfrf.org/)
- [Hackathon Info](https://chain.link/hackathon)

## License

MIT
