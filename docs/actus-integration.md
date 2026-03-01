# ACTUS Integration Guide

## What is ACTUS?

ACTUS (Algorithmic Contract Types Unified Standards) is a financial contract simulation engine. It runs as Docker containers — we call its HTTP endpoints. Its source code is NOT in this repo.

## Docker Services

| Service | Port | Purpose |
|---------|------|---------|
| mongodb | 27018 | Data storage for indexes, models, scenarios |
| actus-riskserver-ce | 8082 | Risk data service — stores indexes, models, scenarios |
| actus-server-rf20 | 8083 | Simulation engine — runs contract simulations |

## How We Use ACTUS

### 10-Step Simulation Pipeline

Steps execute IN ORDER — each depends on previous MongoDB data.

| Step | Method | Port | Endpoint | Purpose |
|------|--------|------|----------|---------|
| 1 | POST | 8082 | /addReferenceIndex | Store reserve trajectory |
| 2 | POST | 8082 | /addReferenceIndex | Store cash trajectory |
| 3 | POST | 8082 | /addReferenceIndex | Store peg deviation trajectory |
| 4 | POST | 8082 | /addBackingRatioModel | Store backing ratio model |
| 5 | POST | 8082 | /addRedemptionPressureModel | Store redemption pressure model |
| 6 | POST | 8082 | /addScenario | Bundle indexes + models |
| 7a-c | GET | 8082 | /find* | Verify data was stored |
| 8 | POST | 8083 | /rf2/scenarioSimulation | Run the simulation |

### Event Types

| Type | Meaning |
|------|---------|
| IED | Initial Exchange Date — contract creation |
| PP | Principal Prepayment — behavioral model redemptions |
| IP | Interest Payment |
| MD | Maturity Date — contract end |
| MRD | Model Risk Data — behavioral model risk metric output |

### Simulation Files

Simulations are stored as Postman Collection v2.1.0 JSON files in `risk-engine/simulations/`. These are API call sequences, NOT ACTUS source code.

**Critical rule:** Postman JSON `body.raw` is a STRING — must `JSON.parse()` before sending via code.

## Verified Output

The BackingRatio + RedemptionPressure 30-day simulation returns 63 events:
- 60 PP events (behavioral model redemptions)
- 1 IED event (contract creation)
- 1 IP event (interest payment)
- 1 MD event (maturity)

Key trajectory: $100M → $8.7M (91.3% supply destroyed over 30 days).
