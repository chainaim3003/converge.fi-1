# CRE Workflow Guide

## Overview

Converge.fi uses 4 Chainlink CRE workflows targeting different hackathon tracks.

## CRE Submission Requirement

From chain.link/hackathon/prizes:
> "Your workflow should: Integrate at least one blockchain with an external API, system, data source, LLM, or AI agent and demonstrate a successful simulation (via the CRE CLI) or a live deployment on the CRE network."

## WF1: Risk Monitoring (PRIMARY)

**Track:** Risk & Compliance ($10K / $6K)
**Trigger:** Cron schedule (every 1 hour)

### Steps:
1. `httpClient.sendRequest()` → POST risk-engine/api/v1/cre-report
2. Process response (extract backingRatioBps, liquidityRatioBps, riskScore)
3. `runtime.report()` → sign the metrics
4. `evmClient.writeReport()` → RiskConsumerWithACE on Sepolia

## WF2: Reserve Health Check

**Track:** DeFi & Tokenization ($12K / $8K)
**Trigger:** Cron or HTTP

Runs multiple StableCoin simulations → composite health score → on-chain.

## WF3: Privacy Reserve Check

**Track:** Privacy ($10K / $6K)
**Trigger:** HTTP (confidential)

Uses Confidential HTTP to call risk-engine → API credentials protected.

## WF4: AI Risk Agent

**Track:** CRE & AI ($10.5K / $6.5K)
**Trigger:** Log trigger or cron

Calls risk-engine for ACTUS data → calls LLM for interpretation → on-chain.

## Running Workflows

```bash
# Install CRE CLI
# See: https://docs.chain.link/cre/getting-started/cli-installation

# Simulate WF1
cd workflows/risk-monitoring
cre simulate

# Simulate WF2
cd workflows/reserve-health-check
cre simulate
```

## References

- CRE Docs: https://docs.chain.link/cre
- CRE Getting Started: https://docs.chain.link/cre/getting-started/overview
- CRE Templates: https://github.com/smartcontractkit/cre-templates
