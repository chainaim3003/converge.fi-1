# Converge.fi

**Autonomous stablecoin reserve risk monitoring via Chainlink CRE + ACTUS financial simulations.**

> Chainlink Convergence Hackathon 2026 · Ethereum Sepolia · Deployed March 8, 2026

---

## What Is Converge.fi?

Converge.fi is an on-chain **circuit breaker** for stablecoin minting. Treasury-backed stablecoins face two distinct failure modes that traditional monitoring cannot catch:

- **Insolvency** — reserves fall below 100% of supply *(Luna/UST: $40B erased, May 2022)*
- **Maturity mismatch** — stablecoin is 103% backed but only 1.1% liquid because reserves are locked in T-bills not maturing for weeks *(USDC/SVB: reserves disclosed as a monthly PDF, not a simulation)*

**How Converge.fi solves it:** A Chainlink CRE workflow runs on a cron schedule every hour. It calls the ACTUS simulation engine, computes 8 risk metrics, ABI-encodes a signed 256-byte report, and writes it on-chain. When `ConvergeStablecoin.mint()` is called, it reads **pre-computed stored state** — no off-chain call at mint time. If any of 4 hard gates fail, the transaction reverts in the same block. No committee. No delay. Automatic.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  CRE Workflow (cron: every 1 hour)                              │
│  workflow.ts → POST /api/v1/cre-report                          │
│      ↓                                                          │
│  Risk Engine (Express, port 3001)                               │
│  → ACTUS simulation engine (port 8083, AWS)                     │
│  → computeHealthFromPortfolio() → 8 metrics                     │
│      ↓                                                          │
│  CRE SDK: encodeAbiParameters → 256-byte signed report          │
│  evmClient.writeReport() → Sepolia                              │
│      ↓                                                          │
│  MockKeystoneForwarder (0x15fC6...88)                           │
│  → ReceiverTemplate validates forwarder, strips envelope         │
│      ↓                                                          │
│  MultiAttributeConvergeRiskConsumer._processReport()            │
│  → RiskReportExtractor.decode() → 8-field struct                │
│  → MultiAttributeRiskPolicy.updateReport()                      │
│      ↓                                                          │
│  Policy state sits on-chain — PRE-COMPUTED, WAITING             │
│                                                                  │
│  ConvergeStablecoin.mint()                                       │
│  → riskPolicy.getMintStatus() [reads stored state only]         │
│  → ALL 4 gates pass → _mint()                                   │
│  → ANY gate fails  → revert MintBlockedError(reason)            │
└─────────────────────────────────────────────────────────────────┘
```

**Key design principle:** Policy state is pre-computed and waiting. Mint reads stored state — zero off-chain latency at mint time. Forward-looking cashflow simulation, not backward-looking balance checks.

---

## Deployed Contracts — Ethereum Sepolia

> Deployed: March 8, 2026 · Deployer: `0x0c5e419D592d116bD9cE3DeE3D613F8b166e42EE` · Chain ID: 11155111

| Contract | Address | Purpose |
|----------|---------|---------|
| `MultiAttributeRiskPolicy` | [`0x61dc9d5904094829fFcBAf7f1970b9d387Dc1d71`](https://sepolia.etherscan.io/address/0x61dc9d5904094829fFcBAf7f1970b9d387Dc1d71) | Stores 8 risk metrics, enforces 4 hard gates |
| `MultiAttributeConvergeRiskConsumer` | [`0x904b5C81705918b4B00439468a7e1d97dF2b6934`](https://sepolia.etherscan.io/address/0x904b5C81705918b4B00439468a7e1d97dF2b6934) | Receives CRE signed reports, decodes 256-byte payload |
| `ConvergeStablecoin` (cvUSD) | [`0x19b6B9434D077DF9DFcE82be3568b4c0B39e6568`](https://sepolia.etherscan.io/address/0x19b6B9434D077DF9DFcE82be3568b4c0B39e6568) | ERC20 with circuit breaker mint gate |
| `MockKeystoneForwarder` | [`0x15fC6ae953E024d975e77382eEeC56A9101f9F88`](https://sepolia.etherscan.io/address/0x15fC6ae953E024d975e77382eEeC56A9101f9F88) | Chainlink CRE forwarder (simulation mode) |

---

## The 4 Hard Gates

```solidity
function isHealthy() external view returns (bool) {
    return backingPct >= 100           // GENIUS Act §4(a)(1): 1:1 reserve backing
        && liquidityPct >= 30          // MiCA Article 54: ≥30% in bank deposits
        && riskScore <= 70             // Converge.fi 6-factor composite
        && assetEligibilityPct >= 100; // GENIUS Act §4(a)(1)(A): permitted assets only
}
```

| Gate | Threshold | Regulatory Basis |
|------|-----------|-----------------|
| `backingPct` | ≥ 100% | GENIUS Act §4(a)(1) — signed July 2025 |
| `liquidityPct` | ≥ 30% | MiCA Article 54 |
| `riskScore` | ≤ 70 | 6-factor composite (backing · liquidity · T-bill concentration · maturity · eligibility · custodian HHI) |
| `assetEligibilityPct` | = 100% | GENIUS Act §4(a)(1)(A) — zero tolerance. One ineligible dollar = gate fails. |

---

## The 8 On-Chain Metrics

ABI encoding: `(uint16, uint16, uint16, uint16, uint40, bytes32, uint16, uint16)` = **256 bytes**

| Field | Type | Scale | Description |
|-------|------|-------|-------------|
| `backingPct` | `uint16` | Integer % | `totalReserves / tokenSupply × 100` |
| `liquidityPct` | `uint16` | Integer % | `cashReserves / totalReserves × 100` |
| `riskScore` | `uint16` | 0–100 | 6-factor weighted composite |
| `maturityGapDays` | `uint16` | Days | Weighted average maturity of locked assets |
| `timestamp` | `uint40` | Unix seconds | Off-chain computation time |
| `scenarioId` | `bytes32` | — | `keccak256` of ACTUS scenario name |
| `assetEligibilityPct` | `uint16` | Integer % | `eligibleReserves / totalReserves × 100` |
| `custodianDiversityScore` | `uint16` | 0–100 | `(1 − custodianHHI) × 100` |

---

## Project Structure

```
converge.fi-1-125/
├── contracts/src/                          ← Solidity contracts (Sepolia)
│   ├── ConvergeStablecoin.sol              ← ERC20 (cvUSD) + circuit breaker mint
│   ├── MultiAttributeRiskPolicy.sol        ← 8 metrics, 4 hard gates, thresholds
│   ├── MultiAttributeConvergeRiskConsumer.sol ← CRE report receiver
│   ├── extractors/RiskReportExtractor.sol  ← abi.decode 256 bytes → struct
│   └── interfaces/ReceiverTemplate.sol     ← Chainlink base (verbatim)
│
├── risk-engine/                            ← Express server (port 3001)
│   └── src/
│       ├── server.ts                       ← Entry point
│       ├── routes/
│       │   ├── cre-report.ts               ← POST /api/v1/cre-report (CRE entry)
│       │   ├── demo.ts                     ← GET /api/demo/health-check?phase=A/B/C
│       │   ├── health.ts                   ← GET /api/health
│       │   ├── simulate.ts                 ← POST /api/run-simulation
│       │   └── chain.ts                    ← On-chain reads
│       ├── utils/
│       │   ├── demo-helpers.ts             ← computeHealthFromPortfolio() + THRESHOLDS
│       │   └── metrics.ts                  ← ACTUS event processing
│       ├── metrics/computeMetrics.ts       ← HHI, asset quality, maturity gap
│       └── config/simulation/              ← 7 ACTUS simulation JSON files
│
├── dashboard/                              ← React + Vite + Tailwind (port 5173)
│   └── src/
│       ├── components/panels/              ← 8 monitoring panels
│       └── components/shared/             ← Shared UI components
│
├── workflows/
│   ├── risk-monitoring/                    ← WF1: primary CRE cron workflow
│   │   ├── workflow.ts                     ← CRE SDK — fetch → encode → writeReport
│   │   ├── workflow.yaml                   ← 11 named targets
│   │   ├── config-demo-A.json             ← Phase A config (healthy)
│   │   ├── config-demo-B.json             ← Phase B config (stressed)
│   │   └── config-demo-C.json             ← Phase C config (restored)
│   ├── reserve-health-check/               ← WF2: DeFi & Tokenization track
│   ├── privacy-reserve-check/              ← WF3: Privacy track (Confidential HTTP)
│   └── vlei-ai-risk-agent/                 ← WF4: CRE & AI track
│
├── scripts/
│   ├── deploy-v2.ts                        ← Deploy all 3 V4 contracts
│   ├── push-report.ts                      ← Manual on-chain report push
│   ├── diagnose.ts                         ← Verify contract wiring
│   ├── verifySetup.ts                      ← End-to-end health check
│   ├── demo-full-lifecycle.ts              ← MINT → BLOCK → RESTORE demo
│   └── simulate-cron.ps1                   ← Simulates hourly CRE cron locally
│
└── test/contracts.test.ts                  ← Hardhat tests (all 4 gates + staleness)
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- [Bun](https://bun.sh/) (required for CRE CLI)
- [CRE CLI](https://docs.chain.link/cre/getting-started/cli-installation) installed globally
- ACTUS Docker running on ports 8082, 8083, 27018 (see [ACTUS section](#actus-external-dependency))

### Step 1 — Install and compile

```bash
# Clone and install root dependencies
git clone https://github.com/YOUR_USERNAME/converge-fi
cd converge-fi

npm install

# Compile contracts
npx hardhat compile
```

### Step 2 — Environment setup

```bash
# Root .env (Hardhat + CRE)
cp .env.example .env
```

Edit `.env` — set your own values for:
```env
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY
PRIVATE_KEY=YOUR_PRIVATE_KEY_WITHOUT_0x_PREFIX
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_KEY
CRE_ETH_PRIVATE_KEY=YOUR_PRIVATE_KEY_WITHOUT_0x_PREFIX
```

```bash
# Risk engine .env
cp risk-engine/.env.example risk-engine/.env
```

Edit `risk-engine/.env` — set:
```env
ACTUS_RISK_HOST=http://localhost:8082
ACTUS_SIM_HOST=http://localhost:8083
DEMO_DIR=/path/to/your/iter-fin-demo-2
```

> `DEMO_DIR` must point to the directory containing `base_portfolio.json`, `override_phaseB_stress.json`, and `override_phaseC_restore.json`.

### Step 3 — One-time CRE setup

```bash
# Install CRE Javy plugin (required before any cre workflow simulate)
bun x cre-setup
```

Expected output: `✅ CRE TS SDK is ready to use.`

### Step 4 — Run contract tests

```bash
npx hardhat test
```

Tests cover: mint allowed when all gates pass, mint blocked by each of the 4 gates individually, staleness revert, deposit event emission.

### Step 5 — Start the risk engine

```bash
cd risk-engine
npm install
npm run dev
```

Risk engine is now running on `http://localhost:3001`.

Verify it works:
```bash
# Health check (pings ACTUS 8082 and 8083)
curl http://localhost:3001/api/health

# Phase A demo data
curl "http://localhost:3001/api/demo/health-check?phase=A"

# Phase B (stressed)
curl "http://localhost:3001/api/demo/health-check?phase=B"

# Phase C (restored)
curl "http://localhost:3001/api/demo/health-check?phase=C"

# CRE report endpoint (used by CRE workflow)
curl -X POST http://localhost:3001/api/v1/cre-report \
  -H "Content-Type: application/json" \
  -d '{"simulationId":"demo-phase-A","scenarioId":"demo_mint_halt_restore"}'
```

### Step 6 — Start the dashboard

```bash
cd dashboard
npm install
npm run dev
```

Dashboard is now running at `http://localhost:5173`.

### Step 7 — Run CRE workflows

With risk engine running, run the demo phases against the deployed contracts:

```bash
# From repo root

# Phase A — healthy reserve (all gates pass, risk score 0)
cre workflow simulate workflows/risk-monitoring --target demo-A --broadcast

# Phase B — stressed reserve (3 gates fail, minting blocked)
cre workflow simulate workflows/risk-monitoring --target demo-B --broadcast

# Phase C — restored reserve (all gates pass, risk score 9)
cre workflow simulate workflows/risk-monitoring --target demo-C --broadcast
```

Each command:
1. Calls `POST /api/v1/cre-report` on the risk engine
2. Receives 8-field JSON metrics
3. ABI-encodes as 256 bytes
4. Signs with DON via CRE SDK
5. Calls `evmClient.writeReport()` → `MultiAttributeConvergeRiskConsumer` on Sepolia
6. Reads back `getMintStatus()` and logs the result

---

## npm Scripts Reference

| Command | What It Does |
|---------|-------------|
| `npm run compile` | Compile all Solidity contracts |
| `npm run test` | Run Hardhat test suite |
| `npm run deploy:v4` | Deploy all 3 V4 contracts to Sepolia |
| `npm run diagnose` | Read all metrics from chain, display status |
| `npm run push-report` | Manually push a healthy report on-chain |
| `npm run demo-lifecycle` | Full MINT → BLOCK → RESTORE demo |
| `npm run verify:setup` | End-to-end contract wiring check |
| `npm run set-forwarder` | Set forwarder address on consumer contract |
| `npm run test:e2e` | Full end-to-end test on Sepolia |

---

## Demo: Three Phases Explained

The live demo shows three reserve states, each computed from a real ACTUS simulation via `computeHealthFromPortfolio()`.

### Phase A — Healthy ✅

Portfolio: 5 cash positions ($68K each across BNY Mellon, JPMorgan, State Street, Citibank, operating bank) + 2 T-bills ($75K at 14-day, $75K at 28-day maturity). Token supply: 100,000.

| Metric | Value | Gate |
|--------|-------|------|
| `backingPct` | 490% | ✅ ≥ 100 |
| `liquidityPct` | 69% | ✅ ≥ 30 |
| `riskScore` | 0 | ✅ ≤ 70 |
| `assetEligibilityPct` | 100% | ✅ = 100 |
| `maturityGapDays` | 21 | — |
| `custodianDiversityScore` | 80 | — |

**Mint gate: OPEN**

### Phase B — Stressed 🔴

Cash drained to $10K across 2 custodians. Distressed corporate bond ($120K, 365-day maturity) added — ineligible under GENIUS Act §4(a)(1)(A). Token supply doubled to 200,000.

| Metric | Value | Gate |
|--------|-------|------|
| `backingPct` | 140% | ✅ ≥ 100 |
| `liquidityPct` | 4% | ❌ < 30 |
| `riskScore` | 71 | ❌ > 70 |
| `assetEligibilityPct` | 57% | ❌ < 100 |
| `maturityGapDays` | 174 | — |
| `custodianDiversityScore` | 50 | — |

**Mint gate: CLOSED — 3 gates fail — `revert MintBlockedError("Liquidity below threshold")`**

This catches the USDC/SVB scenario before it happens. Note: the stablecoin is still 140% backed (solvent), but three gates catch the liquidity crisis, ineligible asset, and elevated risk score independently.

### Phase C — Restored ✅

Corporate bond sold at 5% penalty ($120K → $114K converted to cash). $90K emergency cash injected. Same token supply 200,000.

| Metric | Value | Gate |
|--------|-------|------|
| `backingPct` | 182% | ✅ ≥ 100 |
| `liquidityPct` | 59% | ✅ ≥ 30 |
| `riskScore` | 9 | ✅ ≤ 70 |
| `assetEligibilityPct` | 100% | ✅ = 100 |
| `maturityGapDays` | 21 | — |
| `custodianDiversityScore` | 54 | — |

**Mint gate: OPEN — but risk score is 9, not 0. Custodian concentration from the emergency rescue is still visible. The system recovered, but it remembers.**

---

## CRE Workflows

| Workflow | Track | Trigger | What It Does |
|----------|-------|---------|--------------|
| `risk-monitoring/` | Risk & Compliance (PRIMARY) | Cron `0 * * * *` | POST → risk engine → ACTUS → 8 metrics → 256-byte report → on-chain |
| `reserve-health-check/` | DeFi & Tokenization | Cron/HTTP | Multi-simulation composite reserve health → on-chain |
| `privacy-reserve-check/` | Privacy | HTTP (Confidential) | Confidential HTTP to risk engine — API credentials protected |
| `vlei-ai-risk-agent/` | CRE & AI | Cron | ACTUS data + LLM interpretation → on-chain |

### Workflow ABI Encoding (must match on-chain decoder exactly)

```typescript
// workflow.ts — encodeAbiParameters
encodeAbiParameters(
  parseAbiParameters(
    "uint16 backingPct, uint16 liquidityPct, uint16 riskScore, uint16 maturityGapDays, " +
    "uint40 timestamp, bytes32 scenarioId, uint16 assetEligibilityPct, uint16 custodianDiversityScore"
  ),
  [backingPct, liquidityPct, riskScore, maturityGapDays, BigInt(timestamp),
   keccak256(toBytes(scenarioId)), assetEligibilityPct, custodianDiversityScore]
)
```

```solidity
// RiskReportExtractor.sol — abi.decode (must match exactly)
abi.decode(data, (uint16, uint16, uint16, uint16, uint40, bytes32, uint16, uint16))
```

Output: **256 bytes** (8 fields × 32 bytes each). All 4 layers — Express JSON → CRE workflow → ReceiverTemplate → Solidity decode — use the same type order.

---

## Smart Contracts Detail

### `MultiAttributeRiskPolicy.sol`

Stores all 8 risk metrics as `uint16` state variables. Exposes:
- `isHealthy()` — 4 hard gates, used by `ConvergeStablecoin.mint()`
- `getMintStatus()` — returns `(bool allowed, string reason, uint16 backing, uint16 liquidity, uint16 score, uint256 staleAge)`
- `setThresholds()` — owner-configurable, no contract redeployment needed
- `maxStaleAge` — default 86400 seconds (24 hours). Mint reverts if report is stale.

### `MultiAttributeConvergeRiskConsumer.sol`

Inherits Chainlink `ReceiverTemplate`. Constructor takes `_forwarderAddress`:
- **Simulation mode:** `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` (MockKeystoneForwarder)
- **Production mode:** `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` (KeystoneForwarder, Sepolia)

Sources: [Chainlink forwarder directory](https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts)

`_processReport(bytes calldata report)` — called by ReceiverTemplate after envelope is stripped. Decodes 256 bytes via `RiskReportExtractor.decode()`, pushes to `MultiAttributeRiskPolicy.updateReport()`.

### `ConvergeStablecoin.sol` (cvUSD)

Standard OpenZeppelin ERC20. `mint(address to, uint256 amount)`:
1. Calls `riskPolicy.getMintStatus()` — reads stored state only, no off-chain call
2. Any gate fails → `emit MintBlocked(requester, amount, reason)` → `revert MintBlockedError(reason)`
3. All pass → `_mint(to, amount)` → `emit MintExecuted(to, amount, backingPct, liquidityPct, riskScore)`

---

## ACTUS External Dependency

ACTUS (Algorithmic Contract Types Unified Standards) is an open, royalty-free financial contract simulation standard. Built by former Chief Data Officers of the Federal Reserve Bank of New York, Citibank, and Bank of America. The FDIC awarded ACTUS a Rapid Phased Prototyping contract. Presented at the World Economic Forum in Davos.

ACTUS runs as external Docker containers — **not included in this repo**. We call its HTTP endpoints only.

| Service | Port | Purpose |
|---------|------|---------|
| `actus-server-rf20` | 8083 | Simulation engine — runs PAM contract simulations |
| `actus-riskserver-ce` | 8082 | Risk data service — stores reference indexes, models, scenarios |
| `mongodb` | 27018 | Data storage |

**To start ACTUS Docker:**
```bash
docker-compose up -d
```

**To verify ACTUS is reachable:**
```bash
curl http://localhost:8083/
curl http://localhost:8082/findScenario/test
```

For more: [actusfrf.org](https://www.actusfrf.org/)

---

## Risk Engine API Reference

Base URL: `http://localhost:3001`

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/health` | Pings ACTUS 8082 and 8083 |
| `GET` | `/api/simulations` | Lists available ACTUS simulation configs |
| `POST` | `/api/run-simulation` | Runs an ACTUS simulation, returns event stream |
| `POST` | `/api/v1/cre-report` | Primary CRE entry point — runs simulation → 8 metrics → CRE JSON |
| `GET` | `/api/demo/health-check` | Phase A data (real ACTUS run) |
| `GET` | `/api/demo/health-check?phase=B` | Phase B stressed data |
| `GET` | `/api/demo/health-check?phase=C` | Phase C restored data |
| `POST` | `/api/verify` | StableCoin portfolio verification (6-step) |
| `GET` | `/api/portfolios` | Lists configured portfolios |

### CRE report request body
```json
{
  "simulationId": "demo-phase-A",
  "scenarioId": "demo_mint_halt_restore"
}
```

### CRE report response (Phase A)
```json
{
  "report": {
    "backingPct": 490,
    "liquidityPct": 69,
    "riskScore": 0,
    "maturityGapDays": 21,
    "timestamp": 1741382400,
    "scenarioId": "demo_mint_halt_restore",
    "assetEligibilityPct": 100,
    "custodianDiversityScore": 80
  }
}
```

---

## Regulatory Grounding

| Requirement | Source | Implementation |
|------------|--------|----------------|
| 1:1 reserve backing minimum | GENIUS Act §4(a)(1) — signed July 2025 | `backingPct ≥ 100` hard gate |
| Permitted assets only | GENIUS Act §4(a)(1)(A) | `assetEligibilityPct = 100` — zero tolerance |
| ≥30% of reserves in bank deposits | MiCA Article 54 | `liquidityPct ≥ 30` hard gate |
| Forward-looking risk simulation | FDIC ACTUS contract | ACTUS PAM simulation every 1 hour |

---

## Hackathon Track Submissions

| Track | Prize | Chainlink Files | What Qualifies |
|-------|-------|----------------|----------------|
| **Risk & Compliance** (PRIMARY) | $10,000 / $6,000 | `workflows/risk-monitoring/` · all contracts | CRE cron → ACTUS → on-chain policy with GENIUS Act + MiCA thresholds |
| **DeFi & Tokenization** | $12,000 / $8,000 | `workflows/reserve-health-check/` | Multi-simulation composite health + T-bill maturity ladder modeling |
| **Privacy** | $10,000 / $6,000 | `workflows/privacy-reserve-check/` | Confidential HTTP — reserve composition never exposed on-chain |
| **CRE & AI** | $10,500 / $6,500 | `workflows/vlei-ai-risk-agent/` | AI risk interpretation → on-chain + AI Risk Chat in dashboard |

---

## Three Levels of Triggering

| Level | Trigger | Status |
|-------|---------|--------|
| **Level 1** | CRE cron only. Staleness guard as safety net. | ✅ Built and deployed |
| **Level 2** | CRE cron + log trigger on `DepositReceived` for large deposits | 📐 Designed |
| **Level 3** | Two-phase escrow: `deposit()` → CRE check → `executeMint()` or refund | 📐 Designed |

---

## Environment Variables Reference

### Root `.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `SEPOLIA_RPC_URL` | Yes | Sepolia RPC endpoint (Alchemy recommended) |
| `PRIVATE_KEY` | Yes | Wallet private key (with `0x` prefix) |
| `ETHERSCAN_API_KEY` | Optional | For contract verification |
| `CRE_ETH_PRIVATE_KEY` | Yes | Same key WITHOUT `0x` prefix (CRE CLI requirement) |
| `KEYSTONE_FORWARDER_ADDRESS` | Yes | Use `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` for simulation |

### `risk-engine/.env`

| Variable | Required | Description |
|----------|----------|-------------|
| `ACTUS_RISK_HOST` | Yes | ACTUS risk data service — default `http://localhost:8082` |
| `ACTUS_SIM_HOST` | Yes | ACTUS simulation engine — default `http://localhost:8083` |
| `PORT` | No | Express port — default `3001` |
| `DEMO_DIR` | Yes | Path to `iter-fin-demo-2/` directory |
| `SEPOLIA_RPC_URL` | Yes | For on-chain reads from risk engine |
| `PRIVATE_KEY` | Yes | Wallet private key |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart contracts | Solidity 0.8.24, OpenZeppelin v5, Hardhat 2.x |
| CRE workflows | Chainlink CRE SDK `@chainlink/cre-sdk ^1.1.3`, TypeScript |
| ABI encoding | `viem` — `encodeAbiParameters`, `keccak256`, `toBytes` |
| Risk engine | Express 4.x, TypeScript, `ts-node`, axios |
| Dashboard | React 18, Vite, Tailwind CSS, Recharts |
| Financial simulation | ACTUS (external Docker — `actus-server-rf20`, `actus-riskserver-ce`) |
| Blockchain | Ethereum Sepolia (chainId: 11155111) |
| Package manager | npm (root + risk-engine + dashboard), Bun (CRE workflows) |

---

## Verified Facts

| Claim | Source |
|-------|--------|
| ACTUS = Algorithmic Contract Types Unified Standards | [actusfrf.org](https://www.actusfrf.org/) |
| Founded by former CDOs of Fed NY, Citibank, BofA | [actusfrf.org/about](https://www.actusfrf.org/about) |
| FDIC Rapid Phased Prototyping contract | [actusfrf.org/blog](https://www.actusfrf.org/blog) |
| Presented at WEF Davos | [actusfrf.org/blog](https://www.actusfrf.org/blog) |
| Open, royalty-free, 501(c)(3) | [actusfrf.org/about](https://www.actusfrf.org/about) |
| Luna/UST ~$40B destroyed, May 2022 | Public record |
| USDC depeg March 2023 — SVB | Public record |
| GENIUS Act signed July 2025 | [congress.gov](https://www.congress.gov) |
| GENIUS Act §4(a)(1) — 1:1 backing | Bill text |
| GENIUS Act §4(a)(1)(A) — permitted assets only | Bill text |
| MiCA Article 54 — ≥30% deposits | [EUR-Lex](https://eur-lex.europa.eu) |
| Chainlink MockKeystoneForwarder Sepolia | [Chainlink forwarder directory](https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts) |

---

## Links

- [Chainlink CRE Documentation](https://docs.chain.link/cre)
- [Chainlink CRE SDK Reference](https://docs.chain.link/cre/reference/sdk/core-ts)
- [Chainlink CRE Getting Started](https://docs.chain.link/cre/getting-started/overview)
- [Chainlink CRE CLI Installation](https://docs.chain.link/cre/getting-started/cli-installation)
- [Chainlink Forwarder Directory (Sepolia)](https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts)
- [ACTUS Foundation](https://www.actusfrf.org/)
- [Chainlink Hackathon](https://chain.link/hackathon)

---

## License

MIT
