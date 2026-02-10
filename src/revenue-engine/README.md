# Pacific Properties Revenue Engine v4.3

**Context-Aware Comp Filtering | Weighted Comp Methodology | Automated Scheduling**

A production revenue optimization engine for short-term vacation rental properties. Integrates live market data from [Key Data Dashboard](https://keydatadashboard.com) and property performance from [Hospitable](https://hospitable.com) to generate actionable pricing recommendations through four independent analysis engines.

---

## Table of Contents

- [Architecture](#architecture)
- [Data Flow](#data-flow)
- [Setup](#setup)
- [Usage](#usage)
- [Engine Modules](#engine-modules)
  - [Core Formulas (v4.1)](#1-core-formulas-v41)
  - [Error Forecasting (Monthly)](#2-error-forecasting-monthly-strategic-review)
  - [Bell Curve Decision Tree (Weekly)](#3-bell-curve-decision-tree-weekly-tactical-scan)
  - [Promotion Logic](#4-promotion-logic-supplemental-scan)
- [API Integrations](#api-integrations)
  - [Hospitable API v2](#hospitable-api-v2)
  - [Key Data Dashboard API](#key-data-dashboard-api)
- [Dynamic Market Detection](#dynamic-market-detection)
- [Context-Aware Comp Filtering](#context-aware-comp-filtering)
- [Weighted Comp Methodology](#weighted-comp-methodology)
- [Revenue Scheduler](#revenue-scheduler)
- [OpenClaw Extension](#openclaw-extension)
- [Configuration Reference](#configuration-reference)
- [File Reference](#file-reference)

---

## Architecture

```
                        ┌──────────────────────────────────┐
                        │   OpenClaw Extension             │
                        │   /revenue [audit|summary|help]  │
                        │   Cron: Mon 9am + 1st 8am        │
                        └──────────────┬───────────────────┘
                                       │
                                       ▼
                             generateReport()
                                  main.ts
                                       │
              ┌────────────────────────┼─────────────────────────┐
              │                        │                         │
              ▼                        ▼                         ▼
     Hospitable API v2         Key Data API              Market Discovery
     (Property Data)          (Market Data)            (City → UUID Lookup)
              │                        │                         │
              │   ┌────────────────────┘                         │
              │   │   Tiered Comp Filtering (Strict→Standard→Broad)
              │   │                                              │
              └───┼──────────────────────────────────────────────┘
                  │
     ┌────────────┴────────────────────────────────────────┐
     │                  4 Analysis Engines                  │
     ├─────────────────┬──────────────────┬────────────────┤
     │  Core Formulas  │ Error Forecasting│  Bell Curve    │
     │  (v4.1 Math)    │ (Monthly Review) │  (Weekly Scan) │
     │                 │                  │                │
     │  → New APS      │  → Diagnosis     │  → 14-Day Recs │
     │  → Price Range  │  → Correction    │  → Market State│
     │  → Annual Target│  → New Target $  │  → Price Drops │
     ├─────────────────┴──────────────────┴────────────────┤
     │                 Promotion Logic                      │
     │  → Velocity Gap / Last Minute / Extended Stay        │
     └─────────────────────────────────────────────────────┘
                  │
                  ▼
        Formatted Report → Google Chat Webhook
```

---

## Data Flow

1. **Property Details** — Hospitable API returns bedrooms, bathrooms, sleeps, property type, amenities, city, and state for the configured property.

2. **Dynamic Market Detection** — The property's city is matched against Key Data's market list. Subscribed markets are checked first, then the global list. If the market isn't subscribed, it falls back to the `MARKET_UUID` from `.env`.

3. **Comp Filtering** — Property attributes become API filters so market KPIs reflect comparable listings, not the entire market.

4. **Tiered Fallback** — If the filtered comp set has fewer than 10 listings, filters are relaxed through three tiers until a statistically significant set is found.

5. **Parallel Fetch** — Market data (weekly + monthly KPIs) and property data (calendar stats + reservations) are fetched concurrently.

6. **Four Engines** — Core formulas, error forecasting, bell curve, and promotions each run independently on the fetched data.

7. **Report Output** — Results are formatted as a structured text report, returned as a string for the extension to display or POST to Google Chat.

---

## Setup

### Prerequisites

- Node.js 18+
- pnpm (project uses pnpm workspace)
- API keys for Hospitable and Key Data Dashboard

### Environment Variables

Create a `.env` file in the project root:

```env
# Key Data Dashboard — market-level KPIs
KEYDATA_API_KEY=your_key_data_api_key
MARKET_UUID=your_fallback_market_uuid

# Hospitable — property performance data
HOSPITABLE_API_KEY=your_hospitable_personal_access_token
HOSPITABLE_PROPERTY_ID=your_property_uuid

# Google Chat — scheduled report delivery
GOOGLE_CHAT_WEBHOOK_URL=https://chat.googleapis.com/v1/spaces/...

# Engine tuning (optional)
PREVIOUS_APS=1.00
CURRENT_TARGET_RENT=65000
DAYS_OUT=21
```

| Variable | Required | Description |
|----------|----------|-------------|
| `KEYDATA_API_KEY` | Yes | Key Data Dashboard API key |
| `MARKET_UUID` | Fallback | Default market UUID (used when dynamic detection can't find a subscribed market) |
| `HOSPITABLE_API_KEY` | Yes | Hospitable Personal Access Token (JWT) |
| `HOSPITABLE_PROPERTY_ID` | Yes | Property UUID from Hospitable (discoverable via `listProperties()`) |
| `GOOGLE_CHAT_WEBHOOK_URL` | For scheduler | Google Chat incoming webhook URL |
| `PREVIOUS_APS` | No | Starting APS value (default: 1.00) |
| `CURRENT_TARGET_RENT` | No | Current annual target rent (default: $65,000) |
| `DAYS_OUT` | No | Days-out parameter for promotion evaluation (default: 21) |

### Discovering Your Property ID

If you don't know your Hospitable property UUID, the `listProperties()` function returns all listed properties:

```ts
import { listProperties, type HospitableConfig } from './src/revenue-engine/hospitable-client';

const config: HospitableConfig = { apiKey: process.env.HOSPITABLE_API_KEY! };
const properties = await listProperties(config);
// Returns: [{ id: "ec79781e-...", name: "The Blue Mermaid" }, ...]
```

---

## Usage

### CLI (Direct Execution)

```bash
npx tsx src/revenue-engine/main.ts
```

Produces a full formatted console report with section dividers, data source indicators (LIVE API vs FALLBACK), and all four engine outputs.

### Programmatic (Import)

```ts
import { generateReport } from './src/revenue-engine/main.js';

const report = await generateReport();
// Returns: formatted string with all engine results

// With custom options:
const report = await generateReport({
  apiKey: 'custom-key',
  marketUuid: 'custom-uuid',
  previousAPS: 1.15,
  currentTargetRent: 80000,
});
```

### OpenClaw Bot Command

```
/revenue audit    — Full engine analysis (default)
/revenue summary  — Quick summary section only
/revenue help     — Show available commands
```

---

## Engine Modules

### 1. Core Formulas (v4.1)

**File:** `formulas.ts` (38 lines)
**Purpose:** The mathematical foundation derived from the Pacific Properties Revenue Manual v4.1.

| Calculation | Formula | Description |
|-------------|---------|-------------|
| Performance Index | `myRevPAR / marketRevPAR` | How the property performs vs the market |
| New APS | `(0.70 × previousAPS) + (0.30 × perfIndex)` | Blended score (PID 70/30 weighting) |
| Annual Target | `marketAnnualRevPAR × newAPS` | Revenue target based on market potential |
| Min Price | `max(market20thPctlADR, lastYearLowestSold)` | Floor — never price below this |
| Max Price | `peakFutureADR × newAPS × 1.25` | Ceiling — peak demand pricing |
| Dynamic Centroid | `avgFutureMarketADR × newAPS` | Mid-point anchor for promotions |
| Base Price | `avgADR × newAPS` | Default nightly rate |

**APS (Adaptive Performance Score)** is the engine's central concept — a rolling score between 0.80 and 1.60 that represents how aggressively or conservatively a property should be priced relative to the market.

---

### 2. Error Forecasting (Monthly Strategic Review)

**File:** `error-forecasting.ts` (144 lines)
**Purpose:** Diagnose systematic pricing errors and correct the annual target rent.

**Three-Factor Diagnosis:**

The engine computes multipliers comparing your property to the market:

| Multiplier | Formula | What it means |
|------------|---------|---------------|
| Occupancy | `myOcc / marketOcc` | >1.0 = filling more than market |
| RevPAR | `myRevPAR / marketRevPAR` | >1.0 = earning more per available night |
| ADR | `myADR / marketADR` | >1.0 = charging more per booked night |

**Diagnosis Types:**

| Diagnosis | Trigger | Explanation |
|-----------|---------|-------------|
| `CLASSIC_UNDERPRICING` | Occ ≥ 1.5x AND RevPAR ≤ 0.8x | Filling rooms but leaving money on the table |
| `CLASSIC_OVERPRICING` | Occ ≤ 0.7x AND RevPAR ≤ 0.8x | Prices too high, deterring bookings |
| `ACCEPTABLE_PERFORMANCE` | Neither condition met | Balanced — no correction needed |

**Correction:** A smoothed multiplier (capped at ±50%) is applied to the current target rent. The smoothing divisor of 2 prevents overreaction to a single month's data.

---

### 3. Bell Curve Decision Tree (Weekly Tactical Scan)

**File:** `bell-curve.ts` (292 lines)
**Purpose:** Generate 14 day-by-day pricing recommendations based on booking phase and market state.

**Booking Phase (The "Bell Curve"):**

The transition point is day 27 before arrival. This divides the booking window into two phases:

| Phase | Days Out | Strategy | Goal |
|-------|----------|----------|------|
| BACK_HALF | 28+ days | Maximize ADR | Capture early high-value bookings |
| FRONT_HALF | 0-27 days | Maximize Occupancy | Fill remaining inventory |

**Market State Detection:**

| State | Condition | Operating Mode |
|-------|-----------|---------------|
| HOT | Forward occupancy ≥ 75% or pace ≥ 1.1x historical | Aggressive (5% base, 15% max discount) |
| NEUTRAL | Between hot and cold | Standard (10% base, 20% max discount) |
| COLD | Forward occupancy ≤ 45% or pace ≤ 0.9x historical | Defensive (15% base, 30% max discount) |

**APS Decay (Front Half):**

As arrival approaches, the APS influence decays linearly from 1.0x to 0.7x over 27 days. This means closer-in dates accept lower prices to fill gaps.

**Day-by-Day Logic:**

- **Back Half + Early Demand** (occupancy > 2.5x market): Suggest RATE_INCREASE (20-25%)
- **Front Half + Overpriced** (above APS-adjusted market price): Suggest PRICE_DROP to APS-adjusted fair market
- **Front Half + Lagging**: Suggest APPLY_PROMOTION with sliding scale discount:

| Days Out | Discount Multiplier |
|----------|-------------------|
| 0-3 | 2.0x base |
| 4-7 | 1.5x base |
| 8-14 | 1.25x base |
| 15-30 | 1.0x base |
| 31+ | 0.75x base |

---

### 4. Promotion Logic (Supplemental Scan)

**File:** `promotion-logic.ts` (103 lines)
**Purpose:** Catch promotion opportunities the bell curve doesn't cover.

| Promotion | Trigger | Discount | Rationale |
|-----------|---------|----------|-----------|
| **Velocity Gap** | Market outpacing property by >15% AND price above centroid | 15% off | Early Bird — align with market booking pace |
| **Last Minute Deal** | <7 days out AND <50% occupancy | 20% off | Fill last-minute gaps aggressively |
| **Extended Stay Incentive** | Property avg stay <3 nights BUT market avg >4 nights | 10% off 5+ night stays | Capture longer bookings you're currently missing |

---

## API Integrations

### Hospitable API v2

**File:** `hospitable-client.ts` (348 lines)
**Base URL:** `https://public.api.hospitable.com/v2`
**Auth:** `Authorization: Bearer {PAT}`

| Function | Endpoint | Returns |
|----------|----------|---------|
| `listProperties()` | `GET /properties` | Array of `{ id, name }` for all listed properties |
| `fetchPropertyDetails()` | `GET /properties/{id}` | Bedrooms, bathrooms, type, sleeps, amenities, city, state |
| `fetchCalendarStats()` | `GET /properties/{id}/calendar` | RevPAR, occupancy, ADR, lowest sold price, revenue |
| `fetchCurrentPrice()` | `GET /properties/{id}/calendar` (today) | Today's listed price |
| `fetchAvgBookingLength()` | `GET /reservations` | Average stay duration from booking history |
| `fetchPropertyDataLive()` | Orchestrator | Full `PropertyData` from all of the above |

**Calendar Response Structure:**
```json
{
  "data": {
    "days": [
      {
        "date": "2026-02-10",
        "status": { "reason": "RESERVED", "available": false },
        "price": { "amount": 22000, "currency": "USD" }
      }
    ]
  }
}
```

- Prices are in **cents** (22000 = $220.00)
- `status.reason`: `RESERVED` or `BOOKED` = revenue night, `BLOCKED` = owner-blocked (excluded from availability), `AVAILABLE` = open
- Reservations endpoint requires `properties[]` query parameter

### Key Data Dashboard API

**File:** `key-data-fetcher.ts` (368 lines)
**Base URL:** `https://api-beta.keydatadashboard.com`
**Auth:** `x-api-key` header

| Function | Endpoint | Returns |
|----------|----------|---------|
| `findMarketForLocation()` | `GET /v1/markets/my` then `GET /v1/markets` | Market UUID matching a city name |
| `fetchWeeklyKPIs()` | `POST /api/v1/ota/market/kpis/week` | Future pacing — next 60 days of occupancy, ADR, RevPAR |
| `fetchMonthlyKPIs()` | `POST /api/v1/ota/market/kpis/month` | Historical — previous 6 months of the same metrics |
| `fetchMarketDataSafe()` | Orchestrator | Full `MarketData` combining weekly + monthly |

**OTA Aggregation:** The API returns separate rows per OTA source (Airbnb, VRBO). The engine averages them per date to produce unified market metrics.

**Comp Filters:** Passed in the POST body as a `filters` object:
```json
{
  "market_uuid": "...",
  "start_date": "2025-08-01",
  "end_date": "2026-02-01",
  "currency": "USD",
  "filters": {
    "bedrooms": 3,
    "property_type": "vacation_home",
    "min_sleeps": 8,
    "amenities": ["bbq_area", "beach_access"]
  }
}
```

---

## Dynamic Market Detection

The engine no longer requires a hardcoded `MARKET_UUID`. Instead, it:

1. Fetches property details from Hospitable, which includes `address.city` and `address.state`
2. Searches the user's subscribed Key Data markets (`/v1/markets/my`) for a title matching the city
3. If not found in subscriptions, searches the global market list (`/v1/markets`)
4. If found in subscriptions → uses that market UUID directly
5. If found globally but not subscribed → logs a warning and falls back to `MARKET_UUID` from `.env`
6. If not found at all → falls back to `MARKET_UUID` from `.env`

**Matching Priority:**
1. Exact title match (e.g., "Galveston" = "Galveston")
2. City-level match (e.g., "Galveston (City)")
3. Title starts with city (e.g., "Galveston - TX")
4. Title contains city (e.g., "Galveston Island")

**Example Output:**
```
📍 Detected Location: Galveston, TX
🎯 Matched Market: Galveston - TX (42db4399-...)
```

---

## Context-Aware Comp Filtering

When property details are available from Hospitable, the engine builds a `ComparableFilters` object:

| Filter | Source | Example |
|--------|--------|---------|
| `bedrooms` | `PropertyDetails.bedrooms` | `3` |
| `property_type` | `PropertyDetails.propertyType` | `vacation_home` |
| `min_sleeps` | `PropertyDetails.sleeps` | `8` |
| `amenities` | Intersection of property amenities with Key Data's recognized list | `["bbq_area", "beach_access"]` |

**Recognized Amenities** (matched against property's Hospitable amenity list):
- `pool`, `hot_tub`, `water_view`, `pet_friendly`, `waterfront`, `bbq_area`, `beach_access`

This ensures market KPIs reflect properties that actually compete with yours, not the entire market.

---

## Weighted Comp Methodology

The engine uses a three-tier fallback to ensure a statistically significant comp set (minimum 10 listings):

| Tier | Filters Applied | Trigger |
|------|----------------|---------|
| **Strict** | bedrooms + property_type + sleeps + amenities | Default — all filters applied |
| **Standard** | bedrooms + sleeps only | Strict set < 10 comps |
| **Broad** | bedrooms only | Standard set < 10 comps |
| **Whole Market** | No filters | No property details available |

The report header shows which tier was used and how many comps were found:

```
Comp Set Tier: Strict (260 comps)
Comps Filter: 3 Bed / 2 Bath / Sleeps 8 / vacation_home / bbq_area, beach_access
```

---

## Revenue Scheduler

**File:** `extensions/revenue-reporter/index.ts`
**Dependency:** `node-cron`

Two automated reports are sent to Google Chat via webhook:

| Schedule | Cron | Report |
|----------|------|--------|
| **Weekly Promotion Scan** | Monday at 9:00 AM | Full `generateReport()` output |
| **Monthly Stabilization Audit** | 1st of month at 8:00 AM | Full `generateReport()` output |

Reports are posted as plain text messages to the configured Google Chat space. The webhook URL is read from `GOOGLE_CHAT_WEBHOOK_URL` in `.env`.

If the webhook URL is not set, scheduled runs log a warning and skip the send.

---

## OpenClaw Extension

The revenue engine is exposed as an OpenClaw plugin at `extensions/revenue-reporter/`.

**Plugin ID:** `revenue-reporter`

**Registered Command:** `/revenue`

| Subcommand | Behavior |
|------------|----------|
| `/revenue` or `/revenue audit` | Runs the full engine and returns the complete report |
| `/revenue summary` | Extracts only the `--- SUMMARY ---` section |
| `/revenue help` | Lists available commands |

The extension also starts the cron scheduler on plugin registration, so scheduled reports run as long as the OpenClaw gateway is active.

---

## Configuration Reference

All engine thresholds are defined in `config.ts` (131 lines). Key values:

### APS (Adaptive Performance Score)

| Constant | Value | Purpose |
|----------|-------|---------|
| `APS_MIN` | 0.80 | Floor — never price below 80% of market |
| `APS_MAX` | 1.60 | Ceiling — never price above 160% of market |
| `PID_HISTORY` | 0.70 | Weight given to previous APS |
| `PID_INDEX` | 0.30 | Weight given to current performance index |

### Monthly Error Forecasting

| Constant | Value | Purpose |
|----------|-------|---------|
| `UNDERPRICING_OCC_MULTIPLIER` | 1.5 | Occupancy must be 1.5x market to trigger underpricing |
| `UNDERPRICING_REVPAR_MULTIPLIER` | 0.8 | RevPAR must be below 0.8x market to trigger |
| `OVERPRICING_OCC_MULTIPLIER` | 0.7 | Occupancy must be below 0.7x market to trigger overpricing |
| `MAX_UPWARD_CORRECTION` | 1.50 | Cap on how much target rent can increase |
| `MAX_DOWNWARD_CORRECTION` | 0.80 | Cap on how much target rent can decrease |
| `CORRECTION_SMOOTHING_DIVISOR` | 2 | Halves the raw correction to prevent overreaction |

### Weekly Bell Curve

| Constant | Value | Purpose |
|----------|-------|---------|
| `AUDIT_LOOKAHEAD_DAYS` | 14 | Days ahead to generate recommendations |
| `FORWARD_BOOKING_WINDOW` | 90 | Days ahead for market state analysis |
| `DECAY_WINDOW_PERCENTAGE` | 0.30 | Front half = 30% of 90 days = 27 days |
| `EARLY_DEMAND_OCC_MULTIPLIER` | 2.5 | Back-half demand threshold for rate increases |
| `EARLY_DEMAND_RATE_INCREASE_MIN` | 0.20 | Minimum rate increase (20%) |
| `EARLY_DEMAND_RATE_INCREASE_MAX` | 0.25 | Maximum rate increase (25%) |

### Market State Thresholds

| Constant | Value | Purpose |
|----------|-------|---------|
| `HOT_MARKET_OCC` | 0.75 | ≥75% forward occupancy = HOT |
| `COLD_MARKET_OCC` | 0.45 | ≤45% forward occupancy = COLD |
| `HOT_PACE_MULTIPLIER` | 1.10 | Pace ≥110% of historical = HOT |
| `COLD_PACE_MULTIPLIER` | 0.90 | Pace ≤90% of historical = COLD |

### Operating Modes

| Mode | Base Discount | Max Discount | Price Threshold |
|------|-------------|-------------|----------------|
| Aggressive (HOT) | 5% | 15% | 10% above market |
| Standard (NEUTRAL) | 10% | 20% | 15% above market |
| Defensive (COLD) | 15% | 30% | 15% above market |

### Promotions

| Promotion | Key Threshold | Discount |
|-----------|--------------|----------|
| Velocity Gap | >15% gap between market and property pace | 15% |
| Last Minute | <7 days out, <50% occupancy | 20% |
| Extended Stay | Property avg <3 nights, market avg >4 nights | 10% for 5+ nights |

---

## File Reference

```
src/revenue-engine/
├── main.ts                 552 lines   CLI entry point + generateReport() export
├── key-data-fetcher.ts     368 lines   Key Data API client + market discovery
├── hospitable-client.ts    348 lines   Hospitable API v2 client
├── bell-curve.ts           292 lines   Weekly tactical decision tree
├── types.ts                178 lines   TypeScript interfaces
├── error-forecasting.ts    144 lines   Monthly strategic diagnosis
├── config.ts               131 lines   Constants and thresholds
├── promotion-logic.ts      103 lines   Supplemental promotion scan
├── formulas.ts              38 lines   Core v4.1 calculations
└── simulation.ts            22 lines   Test scenario runner

extensions/revenue-reporter/
├── index.ts                102 lines   OpenClaw plugin + cron scheduler
└── openclaw.plugin.json      9 lines   Plugin manifest

Root:
├── .env                                API keys and configuration
├── test-chat.ts             32 lines   Google Chat webhook test
└── test-markets.ts          34 lines   Key Data market discovery test
```

**Total:** ~2,280 lines across 12 source files.

---

## Sample Output

```
PACIFIC PROPERTIES REVENUE ENGINE v4.3 (Context Aware)
Data source: Market: LIVE API | Property: LIVE API
Location: Galveston, TX
Market: Galveston - TX
Comp Set Tier: Strict (260 comps)
Comps Filter: 3 Bed / 2 Bath / Sleeps 8 / vacation_home / bbq_area, beach_access

--- CORE ENGINE ---
Performance Index: 2.429
New APS (PID 70/30): 1.429
Annual Revenue Target: $18,495.57
Min Nightly Price: $206.59
Max Nightly Price: $652.05
Dynamic Centroid: $540.26
Base Price (ADR x APS): $454.12

--- ERROR FORECASTING (Monthly) ---
Diagnosis: ACCEPTABLE_PERFORMANCE
Correction: NO_CHANGE
New Target Rent: $65,000.00

--- BELL CURVE (Weekly Tactical) ---
Market State: COLD
Operating Mode: Defensive
Recommendations: 0

--- SUMMARY ---
APS: 1.429 | Annual Target: $18,495.57
Price Range: $206.59 - $652.05
Diagnosis: ACCEPTABLE_PERFORMANCE | Corrected Rent: $65,000.00
Market: COLD -> Defensive | Bell Curve Recs: 0
```

---

## Fallback Behavior

The engine is designed to degrade gracefully when API connections fail:

| Component | Live Source | Fallback | Fallback Values |
|-----------|-----------|----------|-----------------|
| Market Data | Key Data API | Maui comp set | RevPAR $189.50, Occ 72%, ADR $263.19 |
| Property Data | Hospitable Calendar | Demo property | RevPAR $215.75, Occ 58%, Price $349 |
| Market UUID | Dynamic city lookup | `MARKET_UUID` env var | User-configured fallback |
| Comp Filters | Property details | Whole Market | No filtering applied |

The report header always indicates which data sources are live vs fallback:
```
Market data: LIVE API  |  Property data: FALLBACK
```
