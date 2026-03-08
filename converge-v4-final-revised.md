# Converge.fi V3 — FINAL REVISED Design

## All uint16 · Eligibility = 100% · ReceiverTemplate · Option B demo-runner

**Date:** March 8, 2026 | **Status:** DESIGN ONLY — AWAITING EXPLICIT APPROVAL TO IMPLEMENT

---

## 1. ON-CHAIN STRUCT — 8 Fields, All uint16 for Numerics

```solidity
struct RiskReport {
    uint16 backingPct;              // Integer %. 490 = 490% backing.
    uint16 liquidityPct;            // Integer %. 69 = 69% cash/reserves.
    uint16 riskScore;               // 0-100 scale. 0 = safe, 100 = critical.
    uint16 maturityGapDays;         // WAM in days. 21 = 21 days average lock.
    uint40 timestamp;               // Unix seconds of off-chain computation.
    bytes32 scenarioId;             // keccak256 of scenario name.
    uint16 assetEligibilityPct;     // 0-100 scale. 100 = all GENIUS-eligible.
    uint16 custodianDiversityScore; // 0-100 scale. 80 = well diversified.
}
```

**ABI encoding: 8 fields × 32 bytes = 256 bytes**

Why all uint16: consistent, future-proof (maturityGapDays could exceed 255 with long corporate bonds in Phase B), zero additional ABI cost (every field pads to 32 bytes regardless).

---

## 2. HARD GATES — 4 Checks in isHealthy()

```solidity
function isHealthy() external view returns (bool) {
    return backingPct >= 100           // GENIUS Act §4(a)(1): 1:1 reserve backing
        && liquidityPct >= 30          // MiCA Art.54: 30% in bank deposits
        && riskScore <= 70             // Composite score ceiling
        && assetEligibilityPct >= 100; // GENIUS Act: "may only consist of" permitted assets
}
```

| Gate | Threshold | Regulatory basis |
|------|-----------|-----------------|
| backingPct ≥ 100 | 100% | GENIUS Act §4(a)(1): reserves on "at least 1 to 1 basis" |
| liquidityPct ≥ 30 | 30% | MiCA Art.54: "at least 30% of funds received in credit institution" |
| riskScore ≤ 70 | 70 | Composite — Converge.fi design |
| assetEligibilityPct ≥ 100 | 100% | GENIUS Act §4(a)(1)(A): "reserves may only consist of" permitted assets. Zero tolerance. |

Soft gates (affect riskScore only, not individual gates): maturityGapDays, custodianDiversityScore.

---

## 3. PHASE DATA — Complete Numbers

### Phase A — PERFECTLY SAFE ✅ (riskScore = 0)

```
PORTFOLIO:
  cash-bnym-001:      $68,000  (custodian: bny-mellon)
  cash-jpm-001:       $68,000  (custodian: jpmorgan-chase)
  cash-state-001:     $68,000  (custodian: state-street)
  cash-citi-001:      $68,000  (custodian: citibank)
  cash-operating-001: $68,000  (custodian: operating-bank)
  tbill-2wk-001:      $75,000  (14 days to maturity, GENIUS-eligible ≤93d)
  tbill-4wk-001:      $75,000  (28 days to maturity, GENIUS-eligible ≤93d)

COMPUTED:
  tokenSupply          = 100,000
  totalReserves        = 490,000
  cashReserves         = 340,000  (5 × $68K)
  tbillReserves        = 150,000  (2 × $75K)
  ineligibleReserves   = 0

  backingPct           = round(490000 / 100000 × 100) = 490
  liquidityPct         = round(340000 / 490000 × 100) = 69
  tbillPct             = round(150000 / 490000 × 100) = 31
  wamDays              = round((75000×14 + 75000×28) / 150000) = 21
  assetEligibilityPct  = round(490000 / 490000 × 100) = 100
  custodianDiversityScore:
    HHI = 5 × (68000/340000)² = 5 × 0.04 = 0.20
    score = round((1 - 0.20) × 100) = 80

RISK SCORE:
  backingRisk       = 0    (490 ≥ 200)
  liquidityRisk     = 0    (69 ≥ 50)
  concentrationRisk = 0    (31 ≤ 31)
  maturityRisk      = 0    (21 ≤ 30)
  eligibilityRisk   = 0    (100 ≥ 100)
  custodialRisk     = 0    (80 ≥ 80)
  riskScore = 0 ✅

GATES:
  490 ≥ 100  ✅   69 ≥ 30  ✅   0 ≤ 70  ✅   100 ≥ 100  ✅
  mintGate: OPEN
```

### Phase B — STRESSED 🔴 (riskScore = 71, THREE gates fail)

```
OVERRIDES APPLIED:
  cash-bnym-001:      $68K → $5,000   (drained)
  cash-jpm-001:       $68K → $5,000   (drained)
  cash-state-001:     $68K → $0       (emptied)
  cash-citi-001:      $68K → $0       (emptied)
  cash-operating-001: $68K → $0       (emptied)
  tokenSupplyOverride: 200,000
  ADDED: corp-bond-distressed-001: $120,000 (365d maturity, reserveCategory: "corp-bond")

COMPUTED:
  tokenSupply          = 200,000
  totalReserves        = 280,000  (10K cash + 150K tbills + 120K corp bond)
  cashReserves         = 10,000
  tbillReserves        = 150,000
  ineligibleReserves   = 120,000  (corp bond — NOT GENIUS-permitted)

  backingPct           = round(280000 / 200000 × 100) = 140
  liquidityPct         = round(10000 / 280000 × 100) = 4
  tbillPct             = round(150000 / 280000 × 100) = 54
  wamDays              = round((75K×14 + 75K×28 + 120K×365) / (150K+120K)) = 174
  assetEligibilityPct  = round(160000 / 280000 × 100) = 57
  custodianDiversityScore:
    2 custodians: shares 5/10=0.5 each
    HHI = 2 × 0.25 = 0.50
    score = round((1 - 0.50) × 100) = 50

RISK SCORE:
  backingRisk       = round((200-140)/120 × 100) = 50
  liquidityRisk     = round((50-4)/50 × 100) = 92
  concentrationRisk = round((54-31)/69 × 100) = 33
  maturityRisk      = round((174-30)/150 × 100) = 96
  eligibilityRisk   = min(100, round((100-57)/30 × 100)) = 100
  custodialRisk     = round((80-50)/80 × 100) = 38

  riskScore = round(50×0.15 + 92×0.25 + 33×0.15 + 96×0.15 + 100×0.15 + 38×0.15)
            = round(7.5 + 23.0 + 4.95 + 14.4 + 15.0 + 5.7)
            = round(70.55) = 71

GATES:
  140 ≥ 100  ✅   4 ≥ 30  ❌   71 ≤ 70  ❌   57 ≥ 100  ❌
  mintGate: CLOSED (3 gates fail)
```

### Phase C — RESTORED BUT SCARRED ✅ (riskScore = 9)

```
OVERRIDES APPLIED:
  Same cash drain as Phase B (5K + 5K + 0 + 0 + 0)
  tokenSupplyOverride: 200,000
  EARLY LIQUIDATION: corp-bond-distressed-001 sold at 5% penalty ($120K → $114K → becomes cash)
  ADDED: emergency-cash-inject-001: $90,000 (cash, custodian: bny-mellon-2)

COMPUTED:
  tokenSupply          = 200,000
  totalReserves        = 364,000  (214K cash + 150K tbills)
  cashReserves         = 214,000  (5K + 5K + 114K bond-sale + 90K injection)
  tbillReserves        = 150,000
  ineligibleReserves   = 0  (corp bond removed)

  backingPct           = round(364000 / 200000 × 100) = 182
  liquidityPct         = round(214000 / 364000 × 100) = 59
  tbillPct             = round(150000 / 364000 × 100) = 41
  wamDays              = round((75K×14 + 75K×28) / 150K) = 21
  assetEligibilityPct  = round(364000 / 364000 × 100) = 100
  custodianDiversityScore:
    4 custodians: 5/214, 5/214, 114/214, 90/214
    HHI = 0.0005 + 0.0005 + 0.284 + 0.177 = 0.462
    score = round((1 - 0.462) × 100) = 54

RISK SCORE:
  backingRisk       = round((200-182)/120 × 100) = 15
  liquidityRisk     = 0    (59 ≥ 50)
  concentrationRisk = round((41-31)/69 × 100) = 14
  maturityRisk      = 0    (21 ≤ 30)
  eligibilityRisk   = 0    (100 ≥ 100)
  custodialRisk     = round((80-54)/80 × 100) = 33

  riskScore = round(15×0.15 + 0×0.25 + 14×0.15 + 0×0.15 + 0×0.15 + 33×0.15)
            = round(2.25 + 0 + 2.1 + 0 + 0 + 4.95)
            = round(9.3) = 9

GATES:
  182 ≥ 100  ✅   59 ≥ 30  ✅   9 ≤ 70  ✅   100 ≥ 100  ✅
  mintGate: OPEN (residual risk from custodial concentration → score 9, not 0)
```

---

## 4. RISK SCORE FORMULA — 6 Factors

```javascript
function computeRiskScore(backingPct, liquidityPct, tbillPct, wamDays,
                          assetEligibilityPct, custodianDiversityScore) {

  // Factor 1: Backing risk (15%) — 0 at ≥200%, 100 at ≤80%
  const backingRisk = backingPct >= 200 ? 0
    : backingPct <= 80 ? 100
    : Math.round((200 - backingPct) / 120 * 100);

  // Factor 2: Liquidity risk (25%) — 0 at ≥50%, 100 at 0%
  const liquidityRisk = liquidityPct >= 50 ? 0
    : Math.round((50 - liquidityPct) / 50 * 100);

  // Factor 3: Concentration risk (15%) — 0 at ≤31%, 100 at 100%
  const concentrationRisk = tbillPct <= 31 ? 0
    : Math.round((tbillPct - 31) / 69 * 100);

  // Factor 4: Maturity risk (15%) — 0 at ≤30d, 100 at ≥180d
  const maturityRisk = wamDays <= 30 ? 0
    : wamDays >= 180 ? 100
    : Math.round((wamDays - 30) / 150 * 100);

  // Factor 5: Asset eligibility risk (15%) — 0 at 100%, 100 at ≤70%
  const eligibilityRisk = assetEligibilityPct >= 100 ? 0
    : assetEligibilityPct <= 70 ? 100
    : Math.round((100 - assetEligibilityPct) / 30 * 100);

  // Factor 6: Custodial concentration risk (15%) — 0 at score≥80, 100 at 0
  const custodialRisk = custodianDiversityScore >= 80 ? 0
    : Math.round((80 - custodianDiversityScore) / 80 * 100);

  return Math.min(100, Math.round(
    backingRisk       * 0.15 +
    liquidityRisk     * 0.25 +
    concentrationRisk * 0.15 +
    maturityRisk      * 0.15 +
    eligibilityRisk   * 0.15 +
    custodialRisk     * 0.15
  ));
}
```

---

## 5. ENCODING / DECODING CHAIN — Complete Trace

### Layer 1: ACTUS (port 8083)

**Input:** PAM contracts from merged portfolio JSON
**Output:** Events per contract (IED, MD, etc.)
**Encoding:** Standard ACTUS JSON. No change from current.
**Does NOT produce risk metrics** — just raw contract events and status.

### Layer 2: Express Server (port 3001)

**computeHealthFromPortfolio() produces 8 values:**

```javascript
// OUTPUT — matches Solidity struct field-for-field:
{
  backingPct: 490,              // uint16: round(totalReserves / tokenSupply × 100)
  liquidityPct: 69,             // uint16: round(cashReserves / totalReserves × 100)
  riskScore: 0,                 // uint16: computeRiskScore(6 inputs) → 0-100
  maturityGapDays: 21,          // uint16: WAM of locked assets in days
  timestamp: 1741382400,        // uint40: Math.floor(Date.now() / 1000)
  scenarioId: "demo_mint...",   // string → keccak256 in workflow.ts → bytes32
  assetEligibilityPct: 100,     // uint16: round(eligibleReserves / totalReserves × 100)
  custodianDiversityScore: 80   // uint16: round((1 - custodianHHI) × 100)
}
```

**Two endpoints return this:**

GET `/api/demo/health-check?phase=A` → returns full health JSON (browser/demo-runner.js)
POST `/api/v1/cre-report` → returns `{ report: {above 8 fields}, simulation: {...} }` (CRE workflow)

### Layer 3: CRE Workflow (workflow.ts)

**Receives** JSON from Express server POST response.

**Type definition:**
```typescript
type RiskReport = {
  backingPct: number;              // uint16
  liquidityPct: number;            // uint16
  riskScore: number;               // uint16
  maturityGapDays: number;         // uint16
  timestamp: number;               // uint40
  scenarioId: string;              // → keccak256 → bytes32
  assetEligibilityPct: number;     // uint16
  custodianDiversityScore: number; // uint16
};
```

**ABI encoding:**
```typescript
const encoded = encodeAbiParameters(
  parseAbiParameters(
    "uint16 backingPct, uint16 liquidityPct, uint16 riskScore, uint16 maturityGapDays, " +
    "uint40 timestamp, bytes32 scenarioId, uint16 assetEligibilityPct, uint16 custodianDiversityScore"
  ),
  [
    report.backingPct,
    report.liquidityPct,
    report.riskScore,
    report.maturityGapDays,
    BigInt(report.timestamp),
    keccak256(toBytes(report.scenarioId)),
    report.assetEligibilityPct,
    report.custodianDiversityScore
  ]
);
// Result: 256 bytes (8 × 32)
```

**Then:**
```typescript
runtime.report({ encodedPayload: hexToBase64(encoded), ... }).result()
evmClient.writeReport(runtime, { receiver: consumerAddress, ... }).result()
```

### Layer 4: MockKeystoneForwarder (Chainlink, on Sepolia)

**Receives** signed 256-byte payload.
**Wraps** in forwarder envelope with metadata (workflowId, workflowName, workflowOwner).
**Calls** `onReport(metadata, report)` on MultiAttributeConvergeRiskConsumer.

### Layer 5: ReceiverTemplate (Chainlink base contract)

**Source:** `cre-bootcamp-2026/prediction-market/contracts/src/interfaces/ReceiverTemplate.sol`
**Copied to:** `converge.fi-1/contracts/src/interfaces/ReceiverTemplate.sol` + `IReceiver.sol`

**What it does:**
1. Validates `msg.sender == forwarderAddress` ✅
2. Optionally validates workflowId, workflowName, workflowOwner
3. Calls `_processReport(report)` with the **clean 256-byte payload** (envelope stripped)

**This is the fix.** Current contract gets the envelope-wrapped bytes and fails to decode. ReceiverTemplate unwraps correctly.

### Layer 6: MultiAttributeConvergeRiskConsumer._processReport()

```solidity
function _processReport(bytes calldata report) internal override {
    // Decode 256 bytes → 8-field struct
    RiskReportExtractor.RiskReport memory decoded = report.decode();
    // Push to policy
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
    reportCount++;
    emit ReportReceived(...);
}
```

### Layer 7: RiskReportExtractor.decode()

```solidity
function decode(bytes calldata data) internal pure returns (RiskReport memory report) {
    if (data.length < 256) revert InvalidReportLength(256, data.length);
    (
        uint16 backingPct,
        uint16 liquidityPct,
        uint16 riskScore,
        uint16 maturityGapDays,
        uint40 timestamp,
        bytes32 scenarioId,
        uint16 assetEligibilityPct,
        uint16 custodianDiversityScore
    ) = abi.decode(data, (uint16, uint16, uint16, uint16, uint40, bytes32, uint16, uint16));
    // ... assign to struct
}
```

**Decode type string:** `(uint16, uint16, uint16, uint16, uint40, bytes32, uint16, uint16)`
**Must match exactly** the encodeAbiParameters in workflow.ts.

### Layer 8: MultiAttributeRiskPolicy

```solidity
// State — all uint16
uint16 public backingPct;
uint16 public liquidityPct;
uint16 public riskScore;
uint16 public maturityGapDays;
uint40 public lastUpdated;
bytes32 public scenarioId;
uint16 public assetEligibilityPct;
uint16 public custodianDiversityScore;

function isHealthy() external view returns (bool) {
    return backingPct >= 100
        && liquidityPct >= 30
        && riskScore <= 70
        && assetEligibilityPct >= 100;
}

function getMintStatus() external view returns (
    bool mintAllowed, string memory reason,
    uint16 _backingPct, uint16 _liquidityPct,
    uint16 _riskScore, uint256 staleAge
) {
    uint256 age = block.timestamp - uint256(lastUpdated);
    if (age > maxStaleAge) return (false, "Risk state too stale", backingPct, liquidityPct, riskScore, age);
    if (backingPct < 100) return (false, "Backing below 100%", backingPct, liquidityPct, riskScore, age);
    if (liquidityPct < 30) return (false, "Liquidity below 30%", backingPct, liquidityPct, riskScore, age);
    if (riskScore > 70) return (false, "Risk score above 70", backingPct, liquidityPct, riskScore, age);
    if (assetEligibilityPct < 100) return (false, "Ineligible reserve assets", backingPct, liquidityPct, riskScore, age);
    return (true, "All policies healthy", backingPct, liquidityPct, riskScore, age);
}
```

### Layer 9: ConvergeStablecoin.mint()

```solidity
function mint(address to, uint256 amount) external onlyOperator {
    (bool allowed, string memory reason, uint16 bk, uint16 lq, uint16 rs, uint256 stale) =
        riskPolicy.getMintStatus();
    if (!allowed) {
        emit MintBlocked(msg.sender, amount, reason);
        revert MintBlocked(reason);
    }
    _mint(to, amount);
    emit MintExecuted(to, amount, bk, lq, rs);
}
```

---

## 6. ENCODING/DECODING SYNC VERIFICATION

| Step | Types | Field count | Byte count | Location |
|------|-------|-------------|------------|----------|
| Express server JSON | JS numbers + string | 8 | N/A (JSON) | demo-helpers.ts, cre-report.ts |
| workflow.ts parseAbiParameters | `uint16,uint16,uint16,uint16,uint40,bytes32,uint16,uint16` | 8 | 256 | workflow.ts |
| RiskReportExtractor abi.decode | `(uint16,uint16,uint16,uint16,uint40,bytes32,uint16,uint16)` | 8 | 256 | RiskReportExtractor.sol |
| MultiAttributeRiskPolicy state | `uint16,uint16,uint16,uint16,uint40,bytes32,uint16,uint16` | 8 | N/A (storage) | MultiAttributeRiskPolicy.sol |

**All 4 layers use the same 8 types in the same order.** If any layer is out of sync, abi.decode will produce wrong values or revert.

---

## 7. EXPRESS SERVER URL OUTPUTS

### GET /api/demo/health-check (Phase A)

```json
{
  "phase": "A",
  "health": {
    "tokenSupply": 100000,
    "totalReserves": 490000,
    "cashReserves": 340000,
    "tbillReserves": 150000,
    "ineligibleReserves": 0,
    "backingPct": 490,
    "liquidityPct": 69,
    "riskScore": 0,
    "wamDays": 21,
    "tbillPct": 31,
    "assetEligibilityPct": 100,
    "custodianDiversityScore": 80,
    "backingPass": true,
    "liquidityPass": true,
    "riskPass": true,
    "eligibilityPass": true,
    "healthy": true,
    "mintGate": "OPEN",
    "maturityLadder": [...]
  },
  "thresholds": {
    "backingPct": 100,
    "liquidityPct": 30,
    "riskScore": 70,
    "assetEligibilityPct": 100
  }
}
```

### GET /api/demo/health-check?phase=B

```json
{
  "phase": "B",
  "health": {
    "tokenSupply": 200000,
    "totalReserves": 280000,
    "cashReserves": 10000,
    "tbillReserves": 150000,
    "ineligibleReserves": 120000,
    "backingPct": 140,
    "liquidityPct": 4,
    "riskScore": 71,
    "wamDays": 174,
    "tbillPct": 54,
    "assetEligibilityPct": 57,
    "custodianDiversityScore": 50,
    "backingPass": true,
    "liquidityPass": false,
    "riskPass": false,
    "eligibilityPass": false,
    "healthy": false,
    "mintGate": "CLOSED",
    "maturityLadder": [...]
  },
  "thresholds": {
    "backingPct": 100,
    "liquidityPct": 30,
    "riskScore": 70,
    "assetEligibilityPct": 100
  }
}
```

### GET /api/demo/health-check?phase=C

```json
{
  "phase": "C",
  "health": {
    "tokenSupply": 200000,
    "totalReserves": 364000,
    "cashReserves": 214000,
    "tbillReserves": 150000,
    "ineligibleReserves": 0,
    "backingPct": 182,
    "liquidityPct": 59,
    "riskScore": 9,
    "wamDays": 21,
    "tbillPct": 41,
    "assetEligibilityPct": 100,
    "custodianDiversityScore": 54,
    "backingPass": true,
    "liquidityPass": true,
    "riskPass": true,
    "eligibilityPass": true,
    "healthy": true,
    "mintGate": "OPEN",
    "maturityLadder": [...]
  },
  "thresholds": {
    "backingPct": 100,
    "liquidityPct": 30,
    "riskScore": 70,
    "assetEligibilityPct": 100
  }
}
```

### POST /api/v1/cre-report (what CRE workflow receives)

Phase B example:
```json
{
  "report": {
    "backingPct": 140,
    "liquidityPct": 4,
    "riskScore": 71,
    "maturityGapDays": 174,
    "timestamp": 1741382400,
    "scenarioId": "demo_mint_halt_restore",
    "assetEligibilityPct": 57,
    "custodianDiversityScore": 50
  },
  "simulation": {
    "id": "demo-phase-B",
    "name": "Demo Phase B",
    "totalEvents": 12,
    "contractCount": 6
  },
  "computedAt": "2026-03-08T..."
}
```

---

## 8. FUTURE TUNING — What Can Change Without Touching .sol or workflow.ts

| Change | Where | Touch .sol? | Touch workflow.ts? |
|--------|-------|-------------|-------------------|
| Risk score weights (e.g., liquidity 25%→30%) | Express server demo-helpers.ts | NO | NO |
| Risk factor safe floors (e.g., backing 200→180) | Express server | NO | NO |
| Portfolio composition (more/fewer contracts) | base_portfolio.json + overrides | NO | NO |
| New phases (D, E, etc.) | New override JSON + new config-demo-D.json | NO | NO |
| What counts as "eligible" (new asset category) | Express server eligibility logic | NO | NO |
| Number/balance of custodians | base_portfolio.json | NO | NO |
| T-bill maturities | base_portfolio.json | NO | NO |
| On-chain thresholds (100, 30, 70, 100) | Hardhat calling policy.setThresholds() | NO | NO |
| maxStaleAge | Hardhat calling policy.setMaxStaleAge() | NO | NO |

**What WOULD require .sol + workflow.ts changes:**
- Adding a 9th field to the struct
- Changing a field type (e.g., uint16 → uint32)
- Adding a 5th hard gate

---

## 9. SOLIDITY FILES — What Gets Created/Changed

### NEW: `contracts/src/interfaces/ReceiverTemplate.sol`
Copy from `cre-bootcamp-2026/prediction-market/contracts/src/interfaces/ReceiverTemplate.sol`. **Verbatim copy, no modifications.** Uses `pragma solidity ^0.8.0` and `@openzeppelin/contracts` (already installed).

### NEW: `contracts/src/interfaces/IReceiver.sol`
Copy from `cre-bootcamp-2026/prediction-market/contracts/src/interfaces/IReceiver.sol`. **Verbatim copy.**

### UPDATED: `contracts/src/extractors/RiskReportExtractor.sol`
- Struct: 6 fields → 8 fields, all uint16 for numerics
- abi.decode type string: `(uint16, uint16, uint16, uint16, uint40, bytes32, uint16, uint16)`
- Expected length: 192 → 256 bytes
- Field names: backingRatioBps → backingPct, liquidityRatioBps → liquidityPct

### NEW: `contracts/src/MultiAttributeRiskPolicy.sol`
- Stores all 8 fields (all uint16 for numerics)
- Thresholds: backing≥100, liquidity≥30, riskScore≤70, eligibility≥100
- `updateReport()`, `isHealthy()`, `getMintStatus()`
- Owner-configurable thresholds via setters

### NEW: `contracts/src/MultiAttributeConvergeRiskConsumer.sol`
- Inherits ReceiverTemplate
- Constructor: `(address _forwarder, address _riskPolicy) ReceiverTemplate(_forwarder)`
- `_processReport()`: decode → riskPolicy.updateReport()

### UPDATED: `contracts/src/ConvergeStablecoin.sol`
- Imports MultiAttributeRiskPolicy instead of 3 separate policies
- `mint()`: calls `riskPolicy.getMintStatus()`
- `getMintStatus()`: delegates to `riskPolicy.getMintStatus()`
- Same ERC20, same operator pattern, same burn

---

## 10. demo-runner.js — Option B (Thin Wrapper)

```javascript
// NEW demo-runner.js — calls Express server, display only
const RISK_ENGINE = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:3001';

const phase = process.argv.includes('--phase')
  ? process.argv[process.argv.indexOf('--phase') + 1].toUpperCase()
  : 'A';

async function main() {
  const url = `${RISK_ENGINE}/api/demo/health-check?phase=${phase}`;
  console.log(`Fetching: ${url}`);
  const res = await fetch(url);
  const data = await res.json();
  displayHealthReport(data);  // terminal formatting only
}

function displayHealthReport(data) {
  // ... format data.health, data.thresholds for terminal display
  // ZERO computation — just formatting
}
```

**Requires Express server running on port 3001.**
**Single source of truth** for all 3 consumers (browser URL, CLI, CRE workflow).

---

## 11. COMPLETE FILE LIST

### CODEBASE 1: `iter-fin-demo-2/` (Portfolio data)

| File | Action | Change |
|------|--------|--------|
| base_portfolio.json | **REWRITE** | 5 cash ($68K each, with custodian) + 2 T-bills ($75K each, 14d+28d). Total $490K. |
| override_phaseB_stress.json | **REWRITE** | 5 portfolioAdjustments (3→$0, 2→$5K) + corp bond $120K. tokenSupply→200K. |
| override_phaseC_restore.json | **REWRITE** | Same drain + earlyLiq corp bond (5% penalty) + $90K injection. tokenSupply→200K. |
| reserve_overrides.json | **NO CHANGE** | overrideActive: false |
| demo-runner.js | **REWRITE** | Option B: thin wrapper calling Express /api/demo/health-check |
| DEMO-SCRIPT.md | **REWRITE** | New numbers, new narrative, new fields |

### CODEBASE 2: `converge.fi-1/risk-engine/` (Express server)

| File | Action | Change |
|------|--------|--------|
| src/types/index.ts | **UPDATE** | CREReport + ComputedMetrics: add 4 new fields, rename bps→Pct, all number type |
| src/utils/demo-helpers.ts | **UPDATE** | THRESHOLDS (100,30,70,100), integer %, WAM, eligibility, custodian HHI, 6-factor riskScore |
| src/metrics/computeMetrics.ts | **UPDATE** | Same metric changes for non-demo path |
| src/routes/cre-report.ts | **UPDATE** | Use new health fields, 8-field report object, integer % |
| src/routes/demo.ts | **UPDATE** | Add eligibilityPass to response, update thresholds object |

### CODEBASE 3: `converge.fi-1/contracts/` (Solidity)

| File | Action | Change |
|------|--------|--------|
| src/interfaces/ReceiverTemplate.sol | **NEW** | Verbatim copy from bootcamp |
| src/interfaces/IReceiver.sol | **NEW** | Verbatim copy from bootcamp |
| src/extractors/RiskReportExtractor.sol | **UPDATE** | 8 fields, all uint16, 256 bytes |
| src/MultiAttributeRiskPolicy.sol | **NEW** | Thresholds: 100, 30, 70, 100. All uint16 state. |
| src/MultiAttributeConvergeRiskConsumer.sol | **NEW** | Inherits ReceiverTemplate. |
| src/ConvergeStablecoin.sol | **UPDATE** | Reads from MultiAttributeRiskPolicy |

### CODEBASE 3: `converge.fi-1/workflows/`

| File | Action | Change |
|------|--------|--------|
| risk-monitoring/workflow.ts | **UPDATE** | 8-field encode (all uint16), RiskReport type, logging |
| risk-monitoring/config-demo-A.json | **UPDATE** | New contract addresses |
| risk-monitoring/config-demo-B.json | **UPDATE** | New contract addresses |
| risk-monitoring/config-demo-C.json | **UPDATE** | New contract addresses |

### CODEBASE 3: `converge.fi-1/scripts/`

| File | Action | Change |
|------|--------|--------|
| scripts/push-report.ts | **UPDATE** | All presets: integer %, new fields, new values |
| scripts/demo-full-lifecycle.ts | **UPDATE** | PHASES with new values |
| scripts/diagnose.ts | **UPDATE** | Display new fields |
| scripts/deploy-v2.ts | **NEW** | Deploy all 3 new contracts, wire them up |
| .env | **UPDATE** | New addresses after deployment |

---

## 12. SUMMARY TABLE

| | Phase A | Phase B | Phase C |
|--|---------|---------|---------|
| Cash | $340K (5 custodians) | $10K (2 custodians) | $214K (4 custodians) |
| T-bills | $150K (14d+28d) | $150K | $150K |
| Corp bond | — | $120K (ineligible!) | — (sold at 5% loss) |
| Total | $490K | $280K | $364K |
| Supply | 100K | 200K | 200K |
| **backingPct** | **490** ✅ | **140** ✅ | **182** ✅ |
| **liquidityPct** | **69** ✅ | **4** ❌ | **59** ✅ |
| **riskScore** | **0** ✅ | **71** ❌ | **9** ✅ |
| **assetEligibilityPct** | **100** ✅ | **57** ❌ | **100** ✅ |
| **wamDays** | 21 | 174 | 21 |
| **custodianDiversity** | 80 | 50 | 54 |
| **Gates failed** | **0** | **3** | **0** |
| **mintGate** | **OPEN** | **CLOSED** | **OPEN** |

---

## 13. APPROVAL CHECKLIST

- [ ] All uint16 for 6 numeric fields (backingPct, liquidityPct, riskScore, maturityGapDays, assetEligibilityPct, custodianDiversityScore)
- [ ] assetEligibilityPct threshold = 100 (zero tolerance per GENIUS Act)
- [ ] liquidityPct threshold = 30 (MiCA Art.54)
- [ ] ReceiverTemplate: copy from cre-bootcamp-2026 repo (verbatim, no modifications)
- [ ] demo-runner.js: Option B (thin wrapper calling Express server)
- [ ] Phase A riskScore = 0, Phase B = 71 (>70), Phase C = 9 (<70 but >0)
- [ ] 8-field ABI, 256 bytes, all encoding/decoding layers in sync
- [ ] 4 hard gates: backing≥100, liquidity≥30, riskScore≤70, eligibility=100
- [ ] Future tuning via Express server + JSON only — no .sol or workflow.ts changes needed
- [ ] Deploy fresh: MultiAttributeRiskPolicy, MultiAttributeConvergeRiskConsumer, ConvergeStablecoin
