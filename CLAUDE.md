# CLAUDE.md — Converge.fi Build Plan

> **Generated:** March 1, 2026 (v4 — Treasury-Backed Model + Circuit Breaker Architecture)
> **Source of truth.** Every fact here comes from verified ACTUS simulation runs, actual contract interfaces, and CRE submission requirements.
> **Hackathon:** Chainlink Convergence — Deadline: March 8, 2026, 11:59 PM ET

---

## 1. Project Identity

- **Name:** Converge.fi
- **What:** Automated stablecoin risk monitoring via Chainlink CRE + ACTUS financial simulations
- **User:** Risk manager at a stablecoin issuer (compliance/treasury team)
- **User does NOT:** mint stablecoins, deposit collateral, or interact with the token contract
- **User DOES:** monitor system health, run what-if scenarios, understand why minting was blocked, take analysis to their treasury team
- **Chain:** Ethereum Sepolia only (no CCIP)

---

## 2. Core Architecture Decision: The Circuit Breaker

The off-chain risk engine is NOT triggered per-mint. It runs continuously on a schedule.
The on-chain policy state is always pre-computed and waiting.
When someone tries to mint, the contract reads the already-stored answer.

```
CONTINUOUS BACKGROUND (CRE cron — every 1 hour)
════════════════════════════════════════════════

CRE Workflow runs on schedule
    ↓
Calls risk-engine → ACTUS simulation → computes metrics
    ↓
Writes signed report ON-CHAIN to RiskConsumerWithACE
    ↓
RiskConsumerWithACE fans out to 3 policy contracts:
    → BackingRatioPolicy.update(backingBps, timestamp)
    → LiquidityRatioPolicy.update(liquidityBps, timestamp)
    → RiskScorePolicy.update(riskScore, timestamp)
    ↓
Policy state sits on-chain, WAITING

INDIVIDUAL MINT (whenever someone deposits + mints)
═══════════════════════════════════════════════════

Depositor calls ConvergeStablecoin.deposit{value: X}()
    ↓
Contract stores deposit, emits DepositReceived event
    ↓
Operator calls ConvergeStablecoin.mint(to, amount)
    ↓
Contract checks STORED state (no off-chain calls):
    1. STALENESS: block.timestamp - lastUpdate <= maxStaleAge?
    2. GATE 1: BackingRatioPolicy.isHealthy()?
    3. GATE 2: LiquidityRatioPolicy.isHealthy()?
    4. GATE 3: RiskScorePolicy.isHealthy()?
    ↓
ALL PASS → mint executes immediately
ANY FAIL → revert with specific reason
```

**Three levels (build Level 1, describe Level 2 in README):**
- **Level 1 (hackathon):** CRE cron only. Staleness guard as safety net.
- **Level 2 (production):** CRE cron + log trigger on DepositReceived for large deposits.
- **Level 3 (ideal):** Two-phase escrow. deposit → CRE check → executeMint or refund.

---

## 3. Two Users, Two Interfaces

### 3.1 Risk Manager (YOUR user — uses Converge.fi dashboard)

They monitor the stablecoin's health. They do NOT mint. They observe and analyze.

**Their day:**
- Morning: open dashboard, check if everything is green
- Crisis: see alert that backing dropped, understand WHY via AI chat, run what-if scenarios
- Action: take analysis to treasury team/board, decide whether to inject capital
- Ongoing: watch next CRE cycle confirm system returns to healthy

### 3.2 Minter (NOT your user — interacts with ConvergeStablecoin contract)

They deposit collateral and call mint(). Could use Etherscan, issuer's own DApp, or any frontend.
They NEVER see your dashboard. If mint is blocked, they see a reverted transaction.

---

## 4. Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  THIS REPO (converge-fi/) — ALL ORIGINAL CODE                   │
│                                                                  │
│  Dashboard (React + Vite)                                        │
│  ┌──────────────────────────┐  ┌──────────────────────────────┐ │
│  │ LEFT: Risk Panels        │  │ RIGHT: AI Risk Chat          │ │
│  │ • Reserve Health         │  │ • Ask about risk data        │ │
│  │ • Cashflow Chart         │  │ • Trigger simulations        │ │
│  │ • Risk Timeline          │  │ • "What if we inject $20M?"  │ │
│  │ • Mint/Block Status      │  │ • Stablecoin risk ONLY       │ │
│  │ • Alert History          │  │                              │ │
│  │ • Event Table            │  │ Uses Anthropic API via       │ │
│  │ • Maturity Ladder View   │  │ Express /api/chat endpoint   │ │
│  └──────────────────────────┘  └──────────────────────────────┘ │
│       ↓ reads on-chain              ↓                            │
│  risk-engine/ (Express port 3001) — YOUR wrapper                 │
│       ↓ HTTP calls                                               │
│  ┌──────────────────────────────────────────┐                    │
│  │ EXTERNAL: ACTUS Docker (NOT in repo)     │                    │
│  │  • 8082 — Risk Data Service              │                    │
│  │  • 8083 — Simulation Engine              │                    │
│  │  • 27018 — MongoDB                       │                    │
│  └──────────────────────────────────────────┘                    │
│       ↓ results                                                  │
│  risk-engine/ computes metrics → CRE Report                      │
│       ↓                                                          │
│  CRE Workflow (Go/TypeScript)                                    │
│       ↓ httpClient.sendRequest → risk-engine                     │
│       ↓ evmClient.writeReport → on-chain                         │
│  Smart Contracts on Sepolia (6 Solidity files)                   │
│                                                                  │
│  Claude Desktop (MCP) → risk-engine/mcp/                         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 5. ACTUS — External Service (NOT in repo)

### 5.1 What ACTUS Is

ACTUS (Algorithmic Contract Types Unified Standards) is a financial contract simulation engine running as Docker containers. We call its HTTP endpoints. Its source code is NEVER in this repo.

### 5.2 ACTUS Docker Services

| Service | Port | Purpose |
|---------|------|---------|
| mongodb | 27018 | Data storage |
| actus-riskserver-ce | 8082 | Risk data service — stores indexes, models, scenarios |
| actus-server-rf20 | 8083 | Simulation engine — runs contract simulations |

### 5.3 Verified Simulation: StableCoin-BackingRatio-RedemptionPressure-30d

This simulation was run and verified on Feb 28, 2026. All architecture decisions are grounded in this actual output.

**10-step pipeline (all verified, all returned 200):**

| Step | Method | Port | Endpoint | Payload ID |
|------|--------|------|----------|------------|
| 1 | POST | 8082 | /addReferenceIndex | SC_RESERVES_01 — $102M → $88M trough → $100.5M recovery |
| 2 | POST | 8082 | /addReferenceIndex | SC_CASH_01 — $40.8M → $13.2M → $38M recovery |
| 3 | POST | 8082 | /addReferenceIndex | SC_PEG_DEV_01 — 0% → 5% peak → 0% recovery |
| 4 | POST | 8082 | /addBackingRatioModel | br_sc01 — backingThreshold=1.0, liquidityThreshold=0.35 |
| 5 | POST | 8082 | /addRedemptionPressureModel | rp_sc01 — pegDeviationThreshold=0.005 |
| 6 | POST | 8082 | /addScenario | sc_depeg_stress_scn01 — bundles 3 indexes + 2 models |
| 7a | GET | 8082 | /findBackingRatioModel/br_sc01 | Confirmed stored |
| 7b | GET | 8082 | /findRedemptionPressureModel/rp_sc01 | Confirmed stored |
| 7c | GET | 8082 | /findScenario/sc_depeg_stress_scn01 | Confirmed stored |
| 8 | POST | 8083 | /rf2/scenarioSimulation | Returns 63 events |

**Verified simulation output:**
- Contract: StableCoinA-Liability-01 (PAM, $100M notional, 30-day, 0% interest)
- Status: Success
- Events: 63 total (60 PP + 1 IED + 1 IP + 1 MD)
- Key trajectory:
  - Days 1-6: zero redemptions (system healthy)
  - Day 7: BackingRatio triggers — $500K redeemed, nominalValue drops to $99.5M
  - Day 9: RedemptionPressure triggers at 0.5% peg deviation — $2.25M redeemed
  - Day 10: both models compound — $13.25M redeemed in one day
  - Day 15: peak stress — $10.7M redeemed, supply at $27M
  - Day 23: redemptions stop at $8.7M remaining (91.3% supply destroyed)
  - Day 31: MD event — final principal $8,738,241.41

### 5.4 Treasury-Backed Simulation (TO BUILD — NEW)

Models a stablecoin backed by a T-bill maturity ladder + cash buffer.

**Multi-contract simulation with 5 ACTUS contracts:**

| Contract ID | Type | Role | Notional | Maturity | Purpose |
|-------------|------|------|----------|----------|---------|
| TBill-A-30d | PAM | RPA | $25M | March 15 | First T-bill in ladder |
| TBill-B-30d | PAM | RPA | $25M | March 30 | Second T-bill in ladder |
| TBill-C-30d | PAM | RPA | $25M | April 15 | Third T-bill |
| TBill-D-30d | PAM | RPA | $25M | April 30 | Fourth T-bill |
| StableCoinA-Liability-01 | PAM | RPA | $100M | March 31 | Stablecoin supply liability |

**Additional reference indexes needed:**
- SC_TBILL_MV_01 — T-bill market value over time (drops on maturity, increases on new purchase)
- SC_DEPOSIT_01 — incoming deposit/mint demand curve (models the 10AM $10M deposit day + flood)

**Behavioral models:**
- br_treasury_01 — BackingRatio (reserves = T-bills + cash combined)
- ml_treasury_01 — MaturityLadder (checks if upcoming maturities cover projected redemptions)

**What this simulation proves:**
- System can be 103% BACKED (solvent) but 1.1% LIQUID (can't pay redemptions)
- Maturity ladder saves the system: T-bill-A matures March 15, injecting $25M cash
- This is the real risk for treasury-backed stablecoins: MATURITY MISMATCH, not insolvency

### 5.5 Simulation JSON Files in Repo (28 total)

All in `risk-engine/simulations/`. These are Postman Collection v2.1.0 format files — API call sequences, NOT ACTUS source code.

| Domain | Count | Primary for Converge.fi? |
|--------|-------|--------------------------|
| StableCoin | 6 | YES — these drive the demo |
| HybridTreasury | 9 | Reference |
| DeFi Liquidation | 4 | Reference |
| SupplyChain Tariff | 3 | Reference |
| Dynamic Discounting | 5 | Reference |

---

## 6. Smart Contracts (6 Solidity Files — ALREADY WRITTEN)

All 6 contracts are in `contracts/src/`. They implement the circuit breaker pattern.

### 6.1 Contract Architecture

```
CRE DON Forwarder (Chainlink infrastructure)
    ↓ calls onReport(bytes)
RiskConsumerWithACE.sol  ← "mailbox" — receives signed CRE reports
    ↓ decodes via RiskReportExtractor library
    ↓ fans out to 3 policy contracts:
    ├── BackingRatioPolicy.sol    ← Gate 1: backing >= 100%?
    ├── LiquidityRatioPolicy.sol  ← Gate 2: cash >= 10% of supply?
    └── RiskScorePolicy.sol       ← Gate 3: composite score <= 70?

ConvergeStablecoin.sol  ← ERC20 token
    ↓ on mint():
    ├── staleness check (block.timestamp - lastUpdate <= maxStaleAge)
    ├── backingPolicy.isHealthy()      ← reads STORED state, no off-chain call
    ├── liquidityPolicy.isHealthy()    ← reads STORED state
    └── riskScorePolicy.isHealthy()    ← reads STORED state
    ↓ all pass → _mint()
    ↓ any fail → revert with specific error
```

### 6.2 Contract Details

| Contract | File | Constructor Args | Key Functions |
|----------|------|------------------|---------------|
| RiskReportExtractor | extractors/RiskReportExtractor.sol | (library, no constructor) | decode(bytes) → RiskReport struct |
| BackingRatioPolicy | policies/BackingRatioPolicy.sol | (thresholdBps=10000, riskConsumer) | update(), isHealthy(), setThreshold() |
| LiquidityRatioPolicy | policies/LiquidityRatioPolicy.sol | (thresholdBps=1000, riskConsumer) | update(), isHealthy(), setThreshold() |
| RiskScorePolicy | policies/RiskScorePolicy.sol | (threshold=70, riskConsumer) | update(), isHealthy(), setThreshold() |
| RiskConsumerWithACE | RiskConsumerWithACE.sol | (creForwarder) | onReport(bytes), getSystemHealth(), setPolicies() |
| ConvergeStablecoin | ConvergeStablecoin.sol | (name, symbol, maxStaleAge=3600) | deposit(), mint(), getMintStatus(), burn() |

### 6.3 Report Encoding

CRE workflow encodes:
```
abi.encode(
    uint16 backingRatioBps,      // 10200 = 102.00%
    uint16 liquidityRatioBps,    // 1500  = 15.00%
    uint8  riskScore,            // 0-100
    uint8  maturityGapDays,      // days until next T-bill maturity covers need
    uint40 timestamp,            // unix timestamp of off-chain computation
    bytes32 scenarioId           // keccak256("sc_depeg_stress_scn01")
)
```

### 6.4 Deployment Order (dependencies matter)

```
1. Deploy BackingRatioPolicy(10000, address(0))     ← temp riskConsumer
2. Deploy LiquidityRatioPolicy(1000, address(0))
3. Deploy RiskScorePolicy(70, address(0))
4. Deploy RiskConsumerWithACE(creForwarderAddress)
5. Call backingPolicy.setRiskConsumer(riskConsumerAddress)
6. Call liquidityPolicy.setRiskConsumer(riskConsumerAddress)
7. Call riskScorePolicy.setRiskConsumer(riskConsumerAddress)
8. Call riskConsumer.setPolicies(backing, liquidity, riskScore)
9. Deploy ConvergeStablecoin("Converge USD", "cvUSD", 3600)
10. Call stablecoin.setPolicies(backing, liquidity, riskScore, riskConsumer)
```

### 6.5 What Triggers What (Exact Mapping)

| Trigger | What Happens | Who Calls | Frequency |
|---------|-------------|-----------|-----------|
| CRE cron schedule | Full ACTUS simulation → report on-chain | CRE DON | Every 1 hour |
| DepositReceived event (Level 2) | Immediate risk refresh for large deposits | CRE log trigger | Per large deposit |
| Someone calls mint() | Reads stored policy state, allows/reverts | Minter/operator | Anytime |
| Someone calls getMintStatus() | Returns current health status | Dashboard | On page load + polling |
| Someone calls getSystemHealth() | Returns all metrics in one call | Dashboard/AI chat | On demand |

---

## 7. risk-engine/ (Express Wrapper — Port 3001)

### 7.1 Folder Structure

```
risk-engine/
├── package.json
├── tsconfig.json
├── .env.example
├── simulations/                   ← 28 Postman JSON files (config data)
│   ├── StableCoin-*.json (6)
│   ├── HybridTreasury-*.json (9)
│   ├── DeFi-*.json (4)
│   ├── SupplyChain-*.json (3)
│   └── dynamic-discounting-1/*.json (5)
├── src/
│   ├── index.ts                   ← Express entry point (port 3001)
│   ├── config.ts                  ← Env vars: ACTUS hosts, Anthropic key
│   ├── api/
│   │   └── ACTUSClient.ts         ← Postman JSON parser + sequential HTTP executor
│   ├── chat/
│   │   ├── riskChatHandler.ts     ← AI Risk Chat logic (Anthropic API)
│   │   └── systemPrompt.ts        ← Stablecoin risk system prompt + context builder
│   ├── metrics/
│   │   └── computeMetrics.ts      ← Converts ACTUS events → CRE report metrics
│   ├── verifier/
│   │   └── StableCoinVerifier.ts  ← 6-step verification logic
│   ├── utils/
│   │   ├── ACTUSDataProcessor.ts  ← Event stream processing
│   │   └── validation.ts          ← Input validation
│   ├── types/
│   │   └── index.ts               ← TypeScript interfaces
│   ├── routes/
│   │   ├── health.ts              ← GET /api/health
│   │   ├── simulate.ts            ← GET /api/simulations, POST /api/run-simulation
│   │   ├── cre-report.ts          ← POST /api/v1/cre-report
│   │   ├── chat.ts                ← POST /api/chat (AI Risk Chat)
│   │   ├── verify.ts              ← POST /api/verify
│   │   ├── portfolios.ts          ← GET/POST /api/portfolios
│   │   └── scenarios.ts           ← GET /api/scenarios
│   └── mcp/
│       ├── server.ts              ← MCP server (stdio transport)
│       └── tools/
│           ├── listSimulations.ts
│           ├── runSimulation.ts
│           ├── describeSimulation.ts
│           └── getMetrics.ts
├── config/
│   └── portfolios/
└── test/
    └── simulation.test.ts
```

### 7.2 Endpoints

| Method | Endpoint | Purpose | Called By |
|--------|----------|---------|-----------|
| GET | /api/health | Pings ACTUS 8082/8083 | Dashboard, CRE |
| GET | /api/simulations | Lists available simulation JSONs | Dashboard SimulationPanel |
| POST | /api/run-simulation | Runs simulation → returns event stream | Dashboard panels, Chat |
| POST | /api/v1/cre-report | Runs + computes metrics + CRE format | CRE workflows |
| POST | /api/chat | AI Risk Chat (Anthropic API) | Dashboard RiskChat |
| POST | /api/verify | StableCoin verification (6-step) | Dashboard, CRE |
| GET | /api/portfolios | Lists configured portfolios | Dashboard |
| GET | /api/scenarios | Lists scenarios | Dashboard |

### 7.3 How /api/v1/cre-report Computes Metrics from ACTUS Events

This is where simulation output becomes on-chain data.

```
Input: ACTUS simulation returns 63 events (verified)
    ↓
Filter PP events with non-zero payoff (redemptions):
    Day 7:  $500K
    Day 8:  $500K
    Day 9:  $1M + $2.25M
    Day 10: $9.5M + $3.7M
    ... (cascade continues)
    ↓
Compute from events + reference indexes:
    backingRatioBps = (totalReserves / totalSupply) * 10000
      At day 15: reserves=$89.5M, supply=$27M → 33152 bps (331%)
      Wait — supply dropped faster than reserves.
      At day 7: reserves=$99.5M, supply=$99.5M → 10000 bps (100%) ← threshold
      At day 10: reserves=$97M, supply=$82.5M → 11758 bps (117%)
      
    liquidityRatioBps = (cashReserves / totalSupply) * 10000
      At day 7: cash=$33M, supply=$99.5M → 3316 bps (33.2%) ← below 35%
      At day 15: cash=$13.5M, supply=$27M → 5000 bps (50%)
      
    riskScore = weighted composite (0-100)
      Factors: backing trend, liquidity trend, peg deviation, redemption velocity
      
    maturityGapDays = days until next T-bill maturity (treasury sim only)
    
    ↓
Output: CRE-formatted JSON
{
    "backingRatioBps": 10000,
    "liquidityRatioBps": 3316,
    "riskScore": 72,
    "maturityGapDays": 0,
    "timestamp": 1709312400,
    "scenarioId": "sc_depeg_stress_scn01"
}
```

### 7.4 Environment Configuration

```env
# risk-engine/.env.example
ACTUS_RISK_HOST=http://localhost:8082
ACTUS_SIM_HOST=http://localhost:8083
PORT=3001
NODE_ENV=development
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-6
```

### 7.5 CRITICAL RULES for ACTUSClient.ts

- Steps MUST execute IN ORDER (each depends on previous MongoDB data)
- Port 8082 (risk data) ≠ 8083 (simulation engine) — different services
- Postman JSON `body.raw` is a STRING — must `JSON.parse()` before sending via code
- ACTUS URLs from env vars ONLY — never hardcode

---

## 8. CRE Workflows (4 total)

### 8.1 CRE Submission Requirement

From chain.link/hackathon/prizes:
> "Your workflow should: Integrate at least one blockchain with an external API, system, data source, LLM, or AI agent and demonstrate a successful simulation (via the CRE CLI) or a live deployment on the CRE network."

### 8.2 Workflow Specifications

#### WF1: Risk Monitoring (PRIMARY — Risk & Compliance track)
- **Trigger:** Cron schedule (every 1 hour)
- **Steps:**
  1. httpClient.sendRequest() → POST risk-engine/api/v1/cre-report
  2. Process response (extract backingRatioBps, liquidityRatioBps, riskScore)
  3. runtime.report() → sign the metrics
  4. evmClient.writeReport() → RiskConsumerWithACE on Sepolia
- **Track:** Risk & Compliance ($10K / $6K)

#### WF2: Reserve Health Check (DeFi & Tokenization track)
- **Trigger:** Cron or HTTP
- **Action:** Runs multiple StableCoin simulations → composite health score → on-chain
- **Track:** DeFi & Tokenization ($12K / $8K)

#### WF3: Privacy Reserve Check (Privacy track)
- **Trigger:** HTTP (confidential)
- **Action:** Uses Confidential HTTP to call risk-engine → API credentials protected
- **Track:** Privacy ($10K / $6K)

#### WF4: AI Risk Agent (CRE & AI track)
- **Trigger:** Log trigger or cron
- **Action:** Calls risk-engine for ACTUS data → calls LLM for interpretation → on-chain
- **Track:** CRE & AI ($10.5K / $6.5K)

---

## 9. Dashboard — Dual UI

### 9.1 Layout

```
┌───────────────────────────────────────────────────────────────────┐
│  Converge.fi — StableCoinA Risk Monitor   [Live] [Last: 2m ago]  │
├────────┬──────────────────────────────┬──────────────────────────┤
│        │                              │                          │
│ Side-  │  RESERVE HEALTH PANEL        │  AI RISK CHAT            │
│ bar    │  Backing: 88% 🔴             │                          │
│        │  Liquidity: 15% 🔴           │  "Your backing ratio     │
│ •Over  │  Risk Score: 78/100 🔴       │   dropped below 100%     │
│ •Risk  │                              │   at March 7..."         │
│ •Sims  │  MINTING STATUS: 🔴 BLOCKED  │                          │
│ •Alerts│  Reason: 3/3 policies failed │  User: "What if we       │
│ •Chain │  Since: March 7, 2026        │  inject $20M?"           │
│        │                              │                          │
│        │  CASHFLOW CHART              │  AI: "Running modified   │
│        │  [nominalValue over time]    │  scenario... backing     │
│        │  $100M → $8.7M              │  recovers to 108%..."    │
│        │                              │                          │
│        │  MATURITY LADDER VIEW (new)  │  [Run BackingRatio sim]  │
│        │  [T-bill maturities + cash]  │  [What-if scenario]      │
│        │                              │  [Current risk score]    │
│        │  ALERT HISTORY               │                          │
│        │  🔴 Mar 15 - Peak stress      │  [Type message...    📤] │
│        │  🔴 Mar 7 - Mint blocked      │                          │
└────────┴──────────────────────────────┴──────────────────────────┘
```

### 9.2 Dashboard Components

**Left Side — Risk Monitoring Panels (7 components):**

| Component | Data Source | What It Shows |
|-----------|------------|---------------|
| ReserveHealthPanel.tsx | riskConsumer.getSystemHealth() on-chain read | Backing %, Liquidity %, Risk Score as metric cards with 🟢🟡🔴 |
| CashflowChart.tsx | /api/run-simulation PP events | Line chart of nominalValue over time |
| RiskTimelineChart.tsx | /api/run-simulation MRD events | Risk score changes over simulation period |
| SimulationPanel.tsx | /api/simulations | Dropdown to select sim, Run button, last run timestamp |
| MintBlockStatus.tsx | stablecoin.getMintStatus() on-chain read | "MINTING ALLOWED 🟢" or "MINTING BLOCKED 🔴" with reason |
| AlertHistory.tsx | ReportReceived + MintBlocked events on-chain | Timeline of risk state changes |
| EventTable.tsx | /api/run-simulation raw events | Sortable table: type, time, payoff, nominalValue |

**Right Side — AI Risk Chat (4 components):**

| Component | Purpose |
|-----------|---------|
| RiskChat.tsx | Main container — message list, scroll, streaming |
| ChatMessage.tsx | Individual bubble — user (right, blue) vs AI (left, gray), markdown |
| ChatInput.tsx | Text input + send button, disabled while AI responding |
| ChatSuggestions.tsx | Quick-action chips: "Run BackingRatio simulation", "Current risk score?", etc. |

### 9.3 AI Risk Chat — Scope

The chat is a stablecoin risk analyst. NOT a general ACTUS chatbot.

**It knows about:**
- Current simulation results (fed as context from latest run)
- Current on-chain risk state (backing ratio, risk score, etc.)
- What event types mean (PP = redemption, MRD = risk metric, IED = initial exchange, MD = maturity)
- Treasury T-bill maturity ladder dynamics

**It does NOT know about:**
- General ACTUS theory (that's ACTUS-MENTOR-MCP, separate tool)
- Other financial topics
- Non-stablecoin domains

---

## 10. Project Structure

```
converge-fi/
├── CLAUDE.md                          ← THIS FILE
├── README.md                          ← Submission README
├── hardhat.config.ts
├── package.json / tsconfig.json
├── .env.example
├── .gitignore
├── deployed-addresses.json
│
├── contracts/                         ← 6 Solidity files (ALREADY WRITTEN)
│   └── src/
│       ├── ConvergeStablecoin.sol     ← ERC20 + deposit + 3 policy gates + staleness
│       ├── RiskConsumerWithACE.sol    ← Receives CRE reports, fans out to policies
│       ├── policies/
│       │   ├── BackingRatioPolicy.sol ← Gate 1: backing >= 100%
│       │   ├── LiquidityRatioPolicy.sol ← Gate 2: cash >= 10%
│       │   └── RiskScorePolicy.sol    ← Gate 3: composite <= 70
│       └── extractors/
│           └── RiskReportExtractor.sol ← Decodes abi.encoded reports
│
├── test/                              ← Hardhat test files
│
├── scripts/                           ← Deployment scripts (order matters, see 6.4)
│
├── workflows/                         ← CRE workflows
│   ├── risk-monitoring/               ← WF1: Cron → risk check → on-chain
│   ├── reserve-health-check/          ← WF2: Multi-sim → composite → on-chain
│   ├── privacy-reserve-check/         ← WF3: Confidential HTTP
│   └── vlei-ai-risk-agent/            ← WF4: AI interpretation → on-chain
│
├── risk-engine/                       ← Express wrapper (port 3001)
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   ├── simulations/                   ← 28 Postman JSONs
│   └── src/                           ← (see section 7.1 for full tree)
│
├── dashboard/                         ← React + Vite + Tailwind
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── src/
│       ├── App.tsx
│       ├── hooks/ (useSimulation, useRiskData, useChat)
│       ├── components/
│       │   ├── layout/ (AppShell, Sidebar, Header)
│       │   ├── panels/ (7 components)
│       │   ├── chat/ (4 components)
│       │   └── shared/ (Card, MetricBadge, StatusIndicator, LoadingSpinner)
│       ├── lib/ (api.ts, formatters.ts)
│       └── styles/
│
├── tasks/
│   ├── todo.md
│   ├── progress.md
│   └── lessons.md
│
└── docs/
    ├── architecture.md
    ├── actus-integration.md
    └── cre-workflow-guide.md
```

---

## 11. What EXISTS vs What Needs BUILDING

| Component | Status | Notes |
|-----------|--------|-------|
| ACTUS Docker (8082, 8083, 27018) | ✅ RUNNING EXTERNALLY | Not in repo |
| 28 simulation JSONs | ✅ COPY INTO REPO | From ACTUS-LOCAL into risk-engine/simulations/ |
| Verified sim output (63 events) | ✅ CAPTURED | BackingRatio+RedemptionPressure 30d |
| **6 Solidity contracts** | ✅ **WRITTEN** | contracts/src/ — circuit breaker pattern |
| Treasury simulation JSON | ❌ BUILD | Multi-contract: 4 T-bills + 1 stablecoin liability |
| Hardhat tests | ❌ BUILD | Test all 3 policy gates + staleness + mint flow |
| Deployment scripts | ❌ BUILD | Follow order in section 6.4 |
| risk-engine core | ❌ BUILD | ACTUSClient, config, routes |
| /api/v1/cre-report metrics | ❌ BUILD | Event → backingBps, liquidityBps, riskScore |
| /api/chat + AI handler | ❌ BUILD | Anthropic API with simulation context |
| MCP server | ❌ BUILD | Optional, for Claude Desktop |
| CRE WF1 (risk monitoring) | ❌ BUILD | Primary workflow |
| CRE WF2-WF4 | ❌ BUILD | Extension track workflows |
| Dashboard layout | ❌ BUILD | AppShell, Sidebar, Header |
| Risk panels (7) | ❌ BUILD | Left side components |
| AI chat components (4) | ❌ BUILD | Right side components |
| README.md | ❌ WRITE | Submission README |
| Demo video | ❌ RECORD | 3-5 minutes |

---

## 12. Build Order

### Phase 1: Foundation + risk-engine (Day 1-2)
1. Initialize project structure, package.json, hardhat.config.ts, .env.example
2. Copy 28 simulation JSONs into risk-engine/simulations/
3. Build risk-engine core: config.ts, ACTUSClient.ts
4. Build routes: health.ts, simulate.ts, cre-report.ts
5. Build metrics computation: events → backingBps, liquidityBps, riskScore
6. Test with curl against running ACTUS Docker
7. Build /api/chat endpoint with Anthropic integration
8. Build treasury simulation JSON (multi-contract: 4 T-bills + liability)

### Phase 2: Smart Contracts + CRE WF1 (Day 2-3)
9. ✅ Contracts already written — copy into project
10. Write Hardhat tests for all 6 contracts
11. Write deployment script (section 6.4 order)
12. Deploy to Sepolia
13. Build WF1 (risk-monitoring) — cron → risk-engine → on-chain
14. Run `cre simulate` → verify report arrives on-chain

### Phase 3: Dashboard (Day 3-4)
15. Scaffold React + Vite + Tailwind
16. Build layout: AppShell, Sidebar, Header
17. Build left panels (7 components) — connect to risk-engine + on-chain reads
18. Build right chat (4 components) — connect to /api/chat
19. Verify: simulation runs → panels update → chat explains results

### Phase 4: Extension Tracks + Polish (Day 4-5)
20. Build WF2 (reserve-health-check) for DeFi track
21. Build WF3 (privacy) for Privacy track
22. Build WF4 (AI risk agent) for CRE & AI track
23. MCP server for Claude Desktop (optional)
24. Polish: loading states, error handling, responsive layout
25. Record 3-5 minute demo video
26. Write README, submit

---

## 13. Verification Checklist

### Pre-requisites (External)
- [ ] ACTUS Docker running: `curl http://localhost:8082/findScenario/test`
- [ ] ACTUS Simulation engine: `curl http://localhost:8083/`

### Smart Contracts
- [ ] `npx hardhat compile` → 0 errors
- [ ] `npx hardhat test` → all pass
- [ ] Tests cover: mint allowed when healthy, mint blocked by each gate, staleness revert, deposit event emitted
- [ ] Deploy to Sepolia → addresses saved to deployed-addresses.json

### risk-engine
- [ ] `cd risk-engine && npm run dev` starts on port 3001
- [ ] `GET /api/health` → 200 + ACTUS connectivity confirmed
- [ ] `GET /api/simulations` → lists 28 JSONs
- [ ] `POST /api/run-simulation` → returns event stream (63 events for BackingRatio)
- [ ] `POST /api/v1/cre-report` → returns CRE-formatted metrics JSON
- [ ] `POST /api/chat` → returns AI response with risk context

### CRE Workflows
- [ ] WF1: `cre simulate` → report written to RiskConsumerWithACE on-chain
- [ ] Verify: after WF1 runs, stablecoin.getMintStatus() reflects new state
- [ ] WF2-WF4: `cre simulate` → each succeeds

### Dashboard
- [ ] `cd dashboard && npm run dev` → starts
- [ ] ReserveHealthPanel shows metrics from on-chain read
- [ ] MintBlockStatus shows ALLOWED/BLOCKED with reason
- [ ] CashflowChart renders from simulation events
- [ ] AI chat sends message and gets contextual response
- [ ] Chat "Run BackingRatio simulation" → triggers sim → panels update
- [ ] Chat stays focused on stablecoin risk (rejects off-topic)

### Submission
- [ ] GitHub repo is PUBLIC
- [ ] README links to ALL Chainlink files (workflows, contracts)
- [ ] README explains ACTUS as external dependency
- [ ] README describes Level 1 (built) vs Level 2 (production design)
- [ ] 3-5 minute video recorded and publicly viewable
- [ ] Video shows: CRE simulate → dashboard panels → AI chat interaction
- [ ] Submission form completed on Airtable

---

## 14. Critical Constraints

1. **ACTUS Docker MUST be running** (ports 8082, 8083, 27018) before anything
2. **ACTUS is NOT in this repo** — only called via HTTP from env-configured URLs
3. **ACTUS-MENTOR-MCP is NOT in this repo** — separate reference tool
4. **Simulation steps execute IN ORDER** (each depends on previous MongoDB data)
5. **Port 8082** (risk data) ≠ **8083** (simulation engine)
6. **Postman JSON `body.raw` is STRING** — must `JSON.parse()` before sending
7. **PP events** = behavioral model redemption outputs
8. **MRD events** = behavioral model risk metric outputs
9. **Single chain (Sepolia)** — no CCIP
10. **Hardhat TypeScript** (not Foundry), Solidity 0.8.24, optimizer 200 runs
11. **risk-engine must be env-configurable** — localhost AND AWS
12. **AI Risk Chat is stablecoin-focused ONLY** — not a general ACTUS chatbot
13. **Anthropic API key required** for AI chat feature
14. **Dashboard uses Tailwind + Recharts** — no heavy UI framework
15. **Contract deployment order matters** — see section 6.4
16. **The risk engine is a circuit breaker, not a per-mint evaluator**

---

## 15. Track Strategy

| Track | Prize | Key Requirement | What We Submit |
|-------|-------|-----------------|----------------|
| Risk & Compliance (PRIMARY) | $10K / $6K | WF1 + contracts | CRE cron → ACTUS → on-chain policy enforcement |
| DeFi & Tokenization | $12K / $8K | WF2 + stablecoin lifecycle | Multi-sim reserve health + treasury ladder |
| Privacy | $10K / $6K | WF3 + Confidential HTTP | Confidential API calls to risk-engine |
| CRE & AI | $10.5K / $6.5K | WF4 + LLM integration | AI chat IS the AI integration + WF4 on-chain |
| Top 10 | $1.5K each | Quality submission | Dual UI = polished product feel |
| Tenderly VTN | $2.5K / $1.75K | Deploy on Virtual TestNet | Optional bonus |

---

## 16. Key Narrative for Judges

**Simulation 1 (de-peg stress):** "A $100M stablecoin faces a 5% peg deviation. Our system detects reserve deterioration on Day 7 and blocks minting. Without intervention, 91.3% of supply is redeemed. The circuit breaker prevented minting into a collapsing system."

**Simulation 2 (treasury maturity mismatch):** "The stablecoin is 103% backed — fully solvent. But 80% of reserves are in T-bills that don't mature for weeks. When a redemption wave hits, cash drops to 1.1% of supply. The system is solvent but ILLIQUID. Our MaturityLadder model catches this. T-bill-A matures on March 15, injecting $25M cash and saving the system. This is the real risk for treasury-backed stablecoins."

**Combined:** "Converge.fi monitors BOTH sides of a stablecoin's balance sheet. Backing ratio catches insolvency. Liquidity ratio catches maturity mismatch. The composite risk score catches dangerous combinations. All enforced automatically on-chain via Chainlink CRE."

---

## 17. Official Links

- Hackathon: https://chain.link/hackathon
- Prizes: https://chain.link/hackathon/prizes
- Submit: https://airtable.com/appgJctAaKPFkMKrW/pagPPG1kBRC0C54w6/form
- CRE Docs: https://docs.chain.link/cre
- CRE Getting Started: https://docs.chain.link/cre/getting-started/overview
- CRE CLI: https://docs.chain.link/cre/getting-started/cli-installation
- CRE Templates: https://github.com/smartcontractkit/cre-templates
- Hardhat Starter: https://github.com/smartcontractkit/hardhat-starter-kit
- Faucets: https://faucets.chain.link
- ACTUS Foundation: https://www.actusfrf.org/
- UI Design Ref: https://better-chatbot-demo.vercel.app/
