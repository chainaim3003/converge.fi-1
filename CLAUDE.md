# CLAUDE.md — Converge.fi: Automated Stablecoin Risk Monitoring via Chainlink CRE + ACTUS

> **Read this file FIRST at every session start. Read `tasks/lessons.md` SECOND.**

---

## 🎯 PROJECT IDENTITY

**Project**: Converge.fi
**What it is**: Automated stablecoin reserve risk monitoring system using Chainlink CRE (Compute Runtime Environment), ACTUS financial contract simulations, and on-chain ACE (Autonomous Capability Enforcement) policies.
**Hackathon**: Chainlink Converge.fi (https://chain.link/hackathon) — Deadline: **March 8, 2026**
**Prize Target**: $33,750–$42,750 across 6-7 tracks
**Chain**: Ethereum Sepolia ONLY (Chain ID: 11155111). Single chain. No CCIP.

---

## 🏗️ HIGH-LEVEL ARCHITECTURE

```
┌────────────────────────────────────────────────────────────────────────┐
│                         CONVERGE.FI SYSTEM                             │
│                                                                        │
│  ┌──────────────┐   ┌──────────────────┐   ┌────────────────────────┐ │
│  │  Dashboard    │   │  Claude Desktop  │   │  CRE Workflows (4)    │ │
│  │  (React/Vite) │   │  (MCP Server)    │   │  (Chainlink Runtime)  │ │
│  └──────┬───────┘   └──────┬───────────┘   └──────────┬─────────────┘ │
│         │                  │                           │               │
│         │   HTTP           │   MCP tool calls          │  HTTP         │
│         ▼                  ▼                           ▼               │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │              actus-service/ (Express API — port 3001)           │   │
│  │              Wraps ACTUS Docker, computes metrics,              │   │
│  │              formats CRE-compatible reports                     │   │
│  │                                                                 │   │
│  │  REUSED from StableRisk2.0:                                    │   │
│  │    ACTUSClient.ts → talks to ACTUS Docker (8083)               │   │
│  │    StableCoinVerifier.ts → 6-step verification pipeline        │   │
│  │    metrics.ts → backingRatio, liquidityRatio, riskScore        │   │
│  │    ACTUSDataProcessor.ts → transforms raw ACTUS events         │   │
│  │    validation.ts → data integrity                              │   │
│  │                                                                 │   │
│  │  NEW routes:                                                    │   │
│  │    /api/v1/cre-report → CRE-formatted risk output              │   │
│  │    /api/v1/simulate → run simulation from JSON definitions     │   │
│  │    /api/v1/portfolios → list/select portfolio configs          │   │
│  └──────────────────────────┬──────────────────────────────────────┘   │
│                             │                                          │
│                    HTTP calls to Docker containers                     │
│                             │                                          │
│              ┌──────────────┼──────────────┐                          │
│              ▼              ▼              ▼                           │
│  ┌────────────────┐ ┌──────────────┐ ┌──────────────┐                │
│  │ ACTUS Risk Srv │ │ ACTUS Core   │ │  MongoDB     │                │
│  │ port 8082      │ │ port 8083    │ │  port 27018  │                │
│  │ Risk models,   │ │ Contract     │ │  Stores risk │                │
│  │ scenarios,     │ │ simulation   │ │  factors,    │                │
│  │ ref indexes    │ │ engine       │ │  scenarios   │                │
│  └────────────────┘ └──────────────┘ └──────────────┘                │
│         ▲                                                             │
│         │ Existing: actus-risk-service-extension1 (DO NOT MODIFY)     │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │           Smart Contracts on Sepolia (6 Solidity files)         │   │
│  │                                                                 │   │
│  │  ConvergeStablecoin.sol → ERC20 cUSD (MINTER_ROLE, BURNER_ROLE)│   │
│  │  RiskConsumerWithACE.sol → receives CRE reports via onReport() │   │
│  │  BackingRatioPolicy.sol → reverts if backing < 100%            │   │
│  │  RiskScorePolicy.sol → reverts if riskScore > threshold        │   │
│  │  LiquidityRatioPolicy.sol → reverts if liquidity < threshold   │   │
│  │  RiskReportExtractor.sol → abi.encode/decode library           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 📁 PROJECT STRUCTURE (95 files — from research session)

```
converge-fi/
├── CLAUDE.md                           ← THIS FILE
├── hardhat.config.ts                   ← Sepolia + Tenderly networks
├── package.json
├── tsconfig.json
├── .env / .env.example
├── project.yaml                        ← CRE project config
├── secrets.yaml                        ← CRE secrets (gitignored)
├── deployed-addresses.json             ← Auto-generated after deploy
│
├── tasks/                              ← PROJECT TRACKING
│   ├── lessons.md                      ← Mistakes + rules (ALWAYS UPDATE)
│   ├── progress.md                     ← Status tracking
│   └── todo.md                         ← Ordered task list
│
├── contracts/src/                      ← 6 SOLIDITY FILES
│   ├── ConvergeStablecoin.sol          ← ERC20 "Converge USD" (cUSD)
│   ├── RiskConsumerWithACE.sol         ← CRE consumer, onReport(bytes,bytes)
│   ├── policies/
│   │   ├── BackingRatioPolicy.sol      ← Reverts if < 10000 basis points (100%)
│   │   ├── RiskScorePolicy.sol         ← Reverts if > maxRiskScore (default 75)
│   │   └── LiquidityRatioPolicy.sol    ← Reverts if < threshold
│   └── extractors/
│       └── RiskReportExtractor.sol     ← abi.encode(beneficiary, amount, backingRatio, liquidityRatio, riskScore, timestamp)
│
├── test/                               ← 7 HARDHAT TEST FILES
│   ├── BackingRatioPolicy.test.ts
│   ├── RiskScorePolicy.test.ts
│   ├── LiquidityRatioPolicy.test.ts
│   ├── RiskConsumerWithACE.test.ts
│   ├── ConvergeStablecoin.test.ts
│   ├── Integration.test.ts
│   └── helpers/testUtils.ts
│
├── scripts/                            ← 6 DEPLOYMENT SCRIPTS
│   ├── deploy-sepolia.ts
│   ├── deploy-tenderly.ts
│   ├── configure-ace.ts
│   ├── simulate-healthy.ts
│   ├── simulate-breach.ts
│   └── verify-contracts.ts
│
├── workflows/                          ← 4 CRE WORKFLOWS
│   ├── risk-monitoring/                ← WF1: Cron → ACTUS → on-chain (Track: Risk & Compliance)
│   │   ├── workflow.ts
│   │   ├── config.json
│   │   └── package.json
│   ├── reserve-health-check/           ← WF2: HTTP trigger → ACE-gated mint (Track: DeFi & Tokenization)
│   │   ├── workflow.ts
│   │   ├── config.json
│   │   └── package.json
│   ├── privacy-reserve-check/          ← WF3: Confidential HTTP (Track: Privacy)
│   │   ├── workflow.ts
│   │   ├── config.json
│   │   └── package.json
│   └── vlei-ai-risk-agent/             ← WF4: vLEI + LLM (Track: CRE & AI — EXTENSION)
│       ├── workflow.ts
│       ├── config.json
│       └── package.json
│
├── actus-service/                      ← EXPRESS API WRAPPER (port 3001)
│   ├── src/
│   │   ├── index.ts                    ← Express server entry
│   │   ├── api/
│   │   │   └── ACTUSClient.ts          ← REUSED — communicates with ACTUS Docker
│   │   ├── verifier/
│   │   │   └── StableCoinVerifier.ts   ← REUSED — 6-step verification pipeline
│   │   ├── utils/
│   │   │   ├── ACTUSDataProcessor.ts   ← REUSED — transforms raw ACTUS events
│   │   │   ├── metrics.ts              ← REUSED — computes backingRatio, liquidityRatio, etc.
│   │   │   └── validation.ts           ← REUSED — data integrity checks
│   │   ├── types/
│   │   │   └── index.ts                ← REUSED + new CRE types
│   │   ├── routes/
│   │   │   ├── health.ts
│   │   │   ├── verify.ts
│   │   │   ├── cre-report.ts           ← NEW: CRE-formatted output for workflows
│   │   │   ├── portfolios.ts
│   │   │   ├── scenarios.ts
│   │   │   └── simulate.ts            ← NEW: Run ACTUS-LOCAL simulations
│   │   └── mcp/                        ← NEW: MCP SERVER FOR CLAUDE DESKTOP
│   │       ├── server.ts
│   │       └── tools/
│   │           ├── listSimulations.ts
│   │           ├── runSimulation.ts
│   │           ├── describeSimulation.ts
│   │           └── getMetrics.ts
│   ├── config/                         ← 21 JSON FILES (ALL REUSED from StableRisk2.0)
│   │   ├── portfolio-conservative-10M.json
│   │   ├── portfolio-aggressive-50M.json
│   │   ├── portfolio-moderate-25M.json
│   │   ├── portfolio-minimal-1M.json
│   │   └── scenarios/
│   ├── test/
│   └── package.json
│
├── dashboard/                          ← REACT FRONTEND
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── components/
│   │   │   ├── ReserveHealthPanel.tsx  ← Backing ratio gauge + status
│   │   │   ├── MintBlockStatus.tsx     ← ACE policies block/allow indicator
│   │   │   ├── AlertHistory.tsx        ← On-chain risk alert events
│   │   │   ├── OnChainVerifier.tsx     ← Read contract state from Sepolia
│   │   │   ├── RiskMetricsTable.tsx    ← Tabular risk metrics
│   │   │   ├── SimulationPanel.tsx     ← NEW: Run simulations + visualize
│   │   │   ├── CashflowChart.tsx       ← NEW: ACTUS event cashflows chart
│   │   │   ├── RiskTimelineChart.tsx   ← NEW: MRD events over time
│   │   │   └── Header.tsx
│   │   ├── hooks/
│   │   │   ├── useRiskReport.ts        ← Read on-chain risk report
│   │   │   ├── useAlertHistory.ts      ← Query RiskThresholdBreached events
│   │   │   ├── useSimulation.ts        ← NEW: Trigger simulation via actus-service
│   │   │   └── useSimulationResults.ts ← NEW: Parse ACTUS events → chart data
│   │   └── config/
│   │       └── contracts.ts            ← ABI + deployed addresses
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
│
├── docker/
│   └── docker-compose.yml
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   ├── TENDERLY_SETUP.md
│   ├── CRE_WORKFLOWS.md
│   ├── ACE_POLICIES.md
│   └── DEMO_SCRIPT.md
│
└── reference/
    ├── REUSE_MANIFEST.md
    ├── STABLERISK_LINEAGE.md
    ├── ZKPRET_REFERENCE.md
    └── ALGOTITAN_VLEI_REFERENCE.md
```

---

## 🏆 TRACK STRATEGY (6-7 TRACKS)

| # | Track | Prize Target | CRE Workflow | Build When |
|---|-------|-------------|--------------|------------|
| 1 | **Risk & Compliance** (PRIMARY) | $10,000 | WF1: Cron → ACTUS → on-chain | Days 1-3 |
| 2 | **DeFi & Tokenization** | $8,000 | WF2: HTTP → ACE-gated mint | Day 4 |
| 3 | **Privacy** | $6,000 | WF3: Confidential HTTP | Day 4 evening |
| 4 | **Tenderly VTN** | $1,750 | Same contracts redeployed to VTN | Day 4 afternoon |
| 5 | **Top 10** | $1,500 | Automatic (judges select) | — |
| 6 | **CRE & AI** (EXTENSION) | $6,500–$10,500 | WF4: vLEI agent + LLM API | Day 5 (~5hrs) |
| 7 | **World ID with CRE** (EXTENSION) | $3,000–$5,000 | World ID verification in CRE | Day 5 (~6hrs) |

**Core = Tracks 1-5 (build Days 1-4). Extensions = Tracks 6-7 (add Day 5+ if time permits).**
**Architecture is extensible by design: each track = one new CRE workflow → same RiskConsumerWithACE.sol contract.**

---

## 🔗 DEPENDENCY: ACTUS-LOCAL (EXISTING — DO NOT MODIFY)

**Location**: `C:\CHAINAIM3003\mcp-servers\ACTUS-LOCAL\actus-risk-service-extension1`
**What**: Extended ACTUS financial contract simulation engine with 50+ behavioral risk models across 5 domains (StableCoin, HybridTreasury, DeFi, SupplyChain, DynamicDiscounting).

### Docker Services:
| Service | Port | Role |
|---------|------|------|
| actus-riskservice (Spring Boot) | 8082 | Risk data management: add/query reference indexes, behavioral models, scenarios |
| actus-service (Spring Boot) | 8083 | Contract simulation engine: runs ACTUS contracts against scenarios |
| MongoDB | 27018 | Stores risk factors, scenarios, behavioral model configs |

### Start Commands:
```bash
cd actus-riskservice && docker build -t actus-risksrv3-custom:latest .
cd ../actus-docker-networks && docker compose -f quickstart-docker-actus-rf20.yml up -d
```

### Key Endpoints (8082 — risk data management):
- `POST /addReferenceIndex` — add time-series market data
- `POST /addBackingRatioModel` — add stablecoin backing ratio model
- `POST /addRedemptionPressureModel` — add redemption pressure model
- `POST /addScenario` — create scenario linking risk factors + models
- `GET /findScenario/{id}`, `GET /findBackingRatioModel/{id}`, etc. — verify storage
- *(50+ model-type-specific endpoints)*

### Main Simulation Endpoint (8083 — engine):
- **`POST /rf2/scenarioSimulation`** — runs contracts against scenarios, returns event stream

### Simulation Response Shape:
```json
[{
  "status": "Success",
  "contractId": "StableCoinA-Liability-01",
  "contractType": "PAM",
  "events": [
    { "type": "IED", "time": "2026-03-01T00:00:00", "payoff": -100000000.0, "currency": "USD", "nominalValue": 100000000.0, "nominalRate": 0.0, "nominalAccrued": 0.0 },
    { "type": "MRD", "time": "2026-03-10T00:00:00", "payoff": -500000.0, "nominalValue": 99500000.0 },
    { "type": "MD", "time": "2026-03-31T00:00:00", "payoff": 100000000.0, "nominalValue": 0.0 }
  ]
}]
```

### ACTUS Event Types:
| Code | Name | Significance |
|------|------|-------------|
| IED | Initial Exchange Date | Contract inception |
| IP | Interest Payment | Periodic interest cashflow |
| MD | Maturity Date | Contract end |
| **MRD** | **Monitoring/Risk Date** | **Behavioral model output — RISK METRICS LIVE HERE** |
| PP | Prepayment | Early repayment triggered by behavioral model |
| AD | Analysis Date | Mark-to-market snapshot |

### Existing Simulations (Postman Collection v2.1.0 format):
Located at: `actus-riskservice/simulations/` — 25+ files across 5 categories.
Each file = ordered multi-step HTTP sequence:
1. Add reference indexes → POST to 8082
2. Add behavioral models → POST to 8082
3. Add scenario → POST to 8082
4. Verify stored → GET from 8082
5. **Run simulation** → POST to 8083 `/rf2/scenarioSimulation`

---

## 🔄 SIMULATION FLOW — 3 ENTRY POINTS, 1 PIPELINE

### Entry Point 1: Claude Desktop (MCP)
```
User → "Run stablecoin backing ratio simulation"
  → Claude calls MCP tool: run_simulation({ filename: "StableCoin-BackingRatio-..." })
  → actus-service/mcp/server.ts parses Postman JSON
  → Executes steps sequentially against 8082, then 8083
  → Returns { status, events[], metrics: { backingRatio, liquidityRatio, riskScore } }
  → Claude interprets and explains results
```

### Entry Point 2: React Dashboard (UI)
```
User clicks "Run Simulation" in SimulationPanel
  → POST http://localhost:3001/api/v1/simulate { simulation: "filename.json" }
  → actus-service/ runs same pipeline
  → Returns JSON to frontend
  → Frontend renders:
      CashflowChart (events over time)
      RiskTimelineChart (MRD events → metrics over time)
      ReserveHealthPanel (gauges)
      EventTable (sortable)
```

### Entry Point 3: CRE Workflow (Chainlink — the hackathon deliverable)
```
CRE Workflow trigger (cron/HTTP)
  → HTTP step: call http://actus-service:3001/api/v1/cre-report { portfolio: "conservative-10M" }
  → actus-service/ runs ACTUS simulation
  → Returns CRE-formatted: { backingRatio, liquidityRatio, riskScore, timestamp }
  → CRE compute: abi.encode the report
  → CRE evm-write: RiskConsumerWithACE.onReport() on Sepolia
  → Contract stores metrics, runs ACE policies
  → Dashboard reads on-chain state via viem
```

### Postman JSON Parsing (core logic for ALL entry points):
```typescript
interface PostmanCollection {
  info: { name: string; description: string };
  item: Array<{
    name: string;
    request: { method: string; url: { raw: string }; body?: { raw: string } };
  }>;
}

async function executeSimulation(collection: PostmanCollection) {
  const stepResults = [];
  let simulationResult = null;

  for (const step of collection.item) {
    const url = step.request.url.raw;
    const method = step.request.method;
    const body = step.request.body?.raw ? JSON.parse(step.request.body.raw) : undefined;

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    stepResults.push({ name: step.name, status: res.status, data });

    // Last POST to 8083 = THE simulation result
    if (url.includes(":8083")) simulationResult = data;
  }

  return { steps: stepResults, result: simulationResult };
}
```

---

## ⚙️ SMART CONTRACTS — 6 SOLIDITY FILES

**Compiler**: Solidity 0.8.24, optimizer 200 runs | **Framework**: Hardhat TypeScript | **Network**: Sepolia

| # | File | Purpose |
|---|------|---------|
| 1 | `ConvergeStablecoin.sol` | ERC20 "Converge USD" (cUSD), AccessControl with MINTER_ROLE/BURNER_ROLE |
| 2 | `RiskConsumerWithACE.sol` | CRE consumer: `onReport(bytes,bytes)`, stores metrics, runs ACE, emits events |
| 3 | `BackingRatioPolicy.sol` | Reverts if backingRatio < 10000 (100.00% in basis points) |
| 4 | `RiskScorePolicy.sol` | Reverts if riskScore > maxRiskScore (default 75) |
| 5 | `LiquidityRatioPolicy.sol` | Reverts if liquidityRatio < threshold |
| 6 | `RiskReportExtractor.sol` | Library: `abi.encode(beneficiary, amount, backingRatio, liquidityRatio, riskScore, timestamp)` |

```bash
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox typescript
npm install @chainlink/contracts @openzeppelin/contracts
```

---

## 📊 VISUALIZATION — WHAT THE DASHBOARD SHOWS

### Two Modes:
1. **On-chain Monitoring**: Reads Sepolia contract state (live risk reports, ACE policy status, mint/block history)
2. **Simulation Runner**: Triggers ACTUS simulations via actus-service, visualizes event results BEFORE they go on-chain

### Simulation Visualization Components:
- **CashflowChart** (Recharts): X=time, Y=payoff. Color by event type. Area fill for cumulative position.
- **RiskTimelineChart**: MRD events extracted → backing ratio / liquidity ratio over time. Threshold overlay lines.
- **ReserveHealthPanel**: Gauges for backing %, liquidity %, risk score. Color: green/yellow/red.
- **MintBlockStatus**: Shows if ACE policies would block/allow mint given current metrics.
- **EventTable**: Sortable/filterable table of all events. Export to CSV.
- **SimulationPanel**: Dropdown to select simulation, run button with step progress, description panel.

---

## 🔌 CLAUDE DESKTOP MCP CONFIG

```json
{
  "mcpServers": {
    "converge-fi-actus": {
      "command": "node",
      "args": ["C:/path/to/converge-fi/actus-service/dist/mcp/server.js"],
      "env": {
        "ACTUS_RISK_URL": "http://localhost:8082",
        "ACTUS_CORE_URL": "http://localhost:8083",
        "SIMULATIONS_DIR": "C:\\CHAINAIM3003\\mcp-servers\\ACTUS-LOCAL\\actus-risk-service-extension1\\actus-riskservice\\simulations"
      }
    }
  }
}
```

### MCP Tools:
| Tool | Input | Returns |
|------|-------|---------|
| `list_simulations` | none | Array of { filename, name, description, category } |
| `run_simulation` | `{ filename }` | `{ status, steps[], events[], metrics }` |
| `describe_simulation` | `{ filename }` | `{ name, description, stepCount, models[], contractType }` |
| `get_metrics` | `{ runId? }` | `{ backingRatio, liquidityRatio, riskScore, timestamp }` |

---

## 📅 6-DAY BUILD PLAN

| Day | Focus | Deliverables |
|-----|-------|-------------|
| **1** | actus-service + contracts | Express on 3001 talking to ACTUS Docker. 6 Solidity files compiling. Tests passing. |
| **2** | Deploy + CRE CLI | Contracts on Sepolia. CRE CLI installed. project.yaml configured. |
| **3** | WF1 Risk Monitoring | CRE workflow: cron → ACTUS → on-chain. `cre simulate` passing. |
| **4** | WF2 + WF3 + Tenderly + Dashboard | DeFi mint gate, Privacy confidential-http, Tenderly redeploy, Dashboard live. |
| **5** | Extensions + Demo | WF4 vLEI+AI, World ID, MCP integration, demo video script. |
| **6** | Submit | 3-5 min video, README, public GitHub, Airtable submission. |

**Day 1 reduced from 8 → 3-4 hours** (StableRisk2.0 reuse).

---

## 🔗 ALL OFFICIAL LINKS

**Hackathon**: https://chain.link/hackathon/prizes | Submit: https://airtable.com/appgJctAaKPFkMKrW/pagPPG1kBRC0C54w6/form
**CRE**: https://docs.chain.link/cre | CLI: https://docs.chain.link/cre/getting-started/cli-installation | Templates: https://github.com/smartcontractkit/cre-templates
**Hardhat**: https://github.com/smartcontractkit/hardhat-starter-kit | @chainlink/contracts: https://www.npmjs.com/package/@chainlink/contracts
**Faucets**: https://faucets.chain.link | **Sepolia**: https://sepolia.etherscan.io
**Tenderly**: https://docs.tenderly.co/virtual-testnets | **World ID**: https://docs.world.org/world-id/concepts
**AlgoTITAN V6** (Track 6): `C:\CHAINAIM3003\mcp-servers\algoTITANV6`
**ACTUS-LOCAL**: `C:\CHAINAIM3003\mcp-servers\ACTUS-LOCAL\actus-risk-service-extension1`

---

## ⚠️ CRITICAL CONSTRAINTS

1. **ACTUS Docker MUST be running** before actus-service/ works. Ports 8082, 8083, 27018.
2. **Simulation steps execute IN ORDER** — each step stores data the next depends on.
3. **Port 8082 ≠ 8083**: 8082 = risk data, 8083 = simulation engine. Different services.
4. **Postman JSON `body.raw` is a STRING** — `JSON.parse()` before sending.
5. **MRD events = behavioral model outputs** — extract these for risk visualization.
6. **`stablecoinModels` array** in contract payload links models to contracts (ACTUS extension).
7. **RiskConsumerWithACE.sol accepts ANY CRE workflow** — zero contract changes per track.
8. **Single chain (Sepolia)** — no CCIP.
9. **Hardhat TypeScript** (not Foundry).

---

## 🔧 DEVELOPMENT RULES — MANDATORY

---

### Workflow Orchestration

#### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, **STOP and re-plan immediately** — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

#### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

#### 3. Self-Improvement Loop
- After ANY correction from user: update `tasks/lessons.md` with the pattern:
```markdown
## Lesson [DATE] — [TOPIC]
**Mistake**: [What went wrong]
**Root Cause**: [Why]
**Fix**: [What changed]
**Rule**: [New rule to prevent recurrence]
**Verified**: [Evidence of correctness]
```
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops to zero
- If same class of mistake appears twice → add automated check or lint rule
- Review `tasks/lessons.md` at session start for relevant project context

#### 4. Verification Before Done
- Never mark a task complete without proving it works
- Run code. Check logs. Show output. Evidence, not just written code.
- Diff behavior between main and your changes when relevant
- Ask yourself: **"Would a staff engineer approve this?"** — only "yes" counts
- Run tests, check logs, demonstrate correctness — every change verified

#### 5. Demand Elegance (Balanced)
- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

#### 6. Autonomous Bug Fixing
- When given a bug report: just fix it. Don't ask for hand-holding.
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

---

### Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

---

### Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code. If 3 lines work, don't write 30.
- **No Laziness**: Find root causes. No temporary fixes. No `// TODO: fix later`. No `any` types in TypeScript. Senior developer standards at all times.
- **Minimal Impact**: Changes should only touch what's necessary. Don't break file B when changing file A. Avoid introducing bugs.
- **No Guessing**: Unsure about API shape? Read Java source or test request. Don't assume.
- **Read Before Write**: Understand existing patterns before adding code.
- **One Thing at a Time**: Each commit/change does ONE thing. Don't mix feature work with refactoring.

---

## 🧪 VERIFICATION CHECKLIST

### ACTUS Docker:
- [ ] `docker compose up -d` succeeds
- [ ] `curl localhost:8082` → responds
- [ ] `curl localhost:8083` → responds

### actus-service/:
- [ ] `npm run dev` → port 3001
- [ ] `GET /health` → 200
- [ ] `POST /api/v1/simulate` with real filename → returns events
- [ ] CRE-report output matches abi.encode shape

### Contracts:
- [ ] `npx hardhat compile` → 0 errors
- [ ] `npx hardhat test` → all passing
- [ ] Deployed to Sepolia → addresses saved

### CRE:
- [ ] `cre simulate` passes for WF1
- [ ] On-chain report stored after workflow

### Dashboard:
- [ ] Simulation list loads
- [ ] Running simulation shows progress
- [ ] Charts render from ACTUS events
- [ ] On-chain reads work from Sepolia

### MCP:
- [ ] `list_simulations` works from Claude Desktop
- [ ] `run_simulation` returns structured results

---

*Single source of truth. Read at every session start.*
