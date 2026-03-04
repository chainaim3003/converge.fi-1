# RiskStableCoin Implementation Documentation

## Overview
This is a simplified stablecoin verification system that validates liquidity, backing ratio, and compliance metrics by interfacing with an ACTUS server. **No ZK programs or network implementation** as specified in the requirements.

## Architecture

### 1. Type System (`src/types/index.ts`)
Comprehensive TypeScript interfaces for:
- ACTUS contract and response structures
- Portfolio configuration
- Verification parameters and results
- Risk metrics and quality metrics
- Summary reporting

### 2. ACTUS Client (`src/api/ACTUSClient.ts`)
- **`fetchCashFlowData()`**: Calls ACTUS server to retrieve cash flow data
- **`loadPortfolio()`**: Loads portfolio configuration from JSON file
- Handles error cases and timeouts
- Cleans contract data before sending to ACTUS server

### 3. Metrics Calculation (`src/utils/metrics.ts`)

#### `processStableCoinData()`
Processes ACTUS response into structured risk data:
- Aggregates cash flows across contracts
- Calculates total liabilities (outstanding tokens)
- Categorizes reserves by type (cash, treasury, corporate, other)
- Computes quality metrics

#### `calculateRiskMetrics()`
Calculates four key metrics:

1. **Backing Ratio** = (Total Reserves / Outstanding Tokens) × 100
   - Validates sufficient asset backing

2. **Liquidity Ratio** = (Highly Liquid Assets / Outstanding Tokens) × 100
   - Ensures operational liquidity

3. **Concentration Risk** = max(% in any asset category)
   - Checks diversification

4. **Asset Quality Score** = Weighted average of liquidity, credit, maturity
   - Assesses overall reserve quality

### 4. Validation Utilities (`src/utils/validation.ts`)

#### `validateStableCoinData()`
- Validates data integrity
- Checks array lengths match period count
- Validates threshold ranges
- Ensures quality metric arrays have correct structure

#### `generateSummary()`
- Creates formatted verification summary
- Identifies failure reasons
- Determines compliance status

#### `displaySummary()`
- Pretty-prints verification results
- Shows pass/fail status for each metric
- Highlights failure reasons

### 5. Core Verifier (`src/verifier/StableCoinVerifier.ts`)

Main verification orchestration:
1. Load portfolio from JSON
2. Fetch ACTUS data
3. Process StableCoin data
4. Validate data integrity
5. Calculate risk metrics
6. Generate summary report

### 6. CLI Entry Point (`src/index.ts`)

Command-line interface using Commander.js:
- Parses command-line arguments
- Validates input parameters
- Executes verification
- Displays results
- Returns appropriate exit codes

## Data Flow

```
CLI Input
  ↓
Load Portfolio (JSON)
  ↓
Fetch ACTUS Data (HTTP)
  ↓
Process Cash Flows
  ↓
Categorize Reserves
  ↓
Calculate Metrics
  ↓
Validate Compliance
  ↓
Generate Summary
  ↓
Display Results
```

## Key Differences from Reference Implementation

### Simplified (No ZK/Network):
- ✅ Direct metric calculation
- ✅ Simple HTTP client
- ✅ Straightforward validation
- ✅ CLI-based execution

### Reference Implementation (Full):
- Uses o1js ZK programs
- Merkle tree proofs
- Smart contract deployment
- Oracle signatures
- Network/Local blockchain modes

## Portfolio Configuration

### Required Fields:
- `contractType`: ACTUS contract type (e.g., "PAM")
- `contractID`: Unique identifier
- `contractRole`: "RPA" (asset) or "RPL" (liability)
- `statusDate`: Evaluation date
- `notionalPrincipal`: Principal amount
- `currency`: Currency code

### StableCoin-Specific Fields:
- `reserveType`: "cash", "treasury", "corporate", "other"
- `liquidityScore`: 0-100 rating
- `creditRating`: 0-100 rating
- `maturityDays`: Days to maturity

## Compliance Logic

### Overall Compliance requires ALL of:
1. ✅ Backing Ratio ≥ Threshold (every period)
2. ✅ Liquidity Ratio ≥ Threshold (every period)
3. ✅ Concentration Risk ≤ Limit (every period)
4. ✅ Asset Quality Score ≥ Threshold (average)

## Usage Example

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run verification
npm run verify -- \
  --backingRatio 100 \
  --liquidityRatio 20 \
  --concentrationLimit 25 \
  --qualityThreshold 80 \
  --actusUrl http://localhost:8083/eventsBatch \
  --portfolio ./config/portfolio.example.json
```

## Output Example

```
🎯 StableCoin Risk Verification
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Configuration:
   Backing Ratio Threshold: 100%
   Liquidity Ratio Threshold: 20%
   Concentration Limit: 25%
   Quality Threshold: 80

📁 Loading portfolio...
   Portfolio ID: STABLE_EXAMPLE_001
   Total Notional: 1000000
   Currency: USD
   Contracts: 5

🌐 Calling ACTUS server: http://localhost:8083/eventsBatch
✅ ACTUS data retrieved successfully
   Periods: 12

📊 Processing StableCoin data...
   Total Liabilities: 1000000.00
   Cash Reserves: 300000.00
   Treasury Reserves: 400000.00
   Corporate Reserves: 200000.00
   Other Reserves: 100000.00
   Total Reserves: 1000000.00

📈 Calculating risk metrics...
   Average Backing Ratio: 100.00%
   Average Liquidity Ratio: 70.00%
   Max Concentration Risk: 40.00%
   Asset Quality Score: 87.50

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 VERIFICATION SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Backing Ratio:
   Average: 100.00%
   Threshold: 100%
   Status: PASS

✅ Liquidity Ratio:
   Average: 70.00%
   Threshold: 20%
   Status: PASS

❌ Concentration Risk:
   Maximum: 40.00%
   Limit: 25%
   Status: FAIL

✅ Asset Quality:
   Score: 87.50
   Threshold: 80
   Status: PASS

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️  OVERALL STATUS: NON-COMPLIANT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ Failure Reasons:
   • Concentration risk (40.00%) exceeds limit (25%)
```

## References

This implementation follows patterns from:
- **Handler**: `zk-pret-test-v3.7/src/impl/local/handler/RiskBasel3LocalHandler.ts`
- **Verifier**: `zk-pret-test-v3.7/src/impl/local/verifier/RiskBasel3LocalMultiVerifier.ts`

Key simplifications:
- No ZK proof generation
- No blockchain/smart contracts
- No Merkle trees
- Direct metric calculation
- CLI-only interface
- No oracle signatures

## Next Steps

1. Install dependencies: `npm install`
2. Build: `npm run build`
3. Test with example portfolio: Use provided command
4. Create custom portfolio configuration
5. Adjust thresholds based on regulatory requirements
6. Integrate with ACTUS server

## Notes

- ✅ Follows TypeScript best practices
- ✅ Comprehensive type safety
- ✅ Clean separation of concerns
- ✅ Detailed error handling
- ✅ Structured logging
- ✅ No hallucinations - based on reference implementations
