#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════════════════
//  Pacific Properties Revenue Engine v4.3 — Context Aware Comp Filtering
//  Monthly Strategic Review (Error Forecasting) + Weekly Bell Curve Scan
// ═══════════════════════════════════════════════════════════════════════

import { config as loadEnv } from 'dotenv';
loadEnv();

import { RevenueEngine } from './formulas';
import { evaluatePromotion, scanAllPromotions } from './promotion-logic';
import { runMonthlyErrorForecasting } from './error-forecasting';
import { runWeeklyBellCurveReview, determineMarketState, getOperatingMode } from './bell-curve';
import { fetchMarketDataSafe, fetchPropertyStatsSafe, findMarketForLocation, type KeyDataConfig, type HospitableConfig, type ComparableFilters } from './key-data-fetcher';
import { fetchPropertyDetails } from './hospitable-client';
import type { Recommendation } from './types';

// ── Configuration ───────────────────────────────────────────────────

const API_CONFIG: KeyDataConfig = {
  apiKey: process.env.KEYDATA_API_KEY ?? '3bc432a3b3314cbeb7a02fb233c4b2ac',
  baseUrl: process.env.KEYDATA_BASE_URL ?? 'https://api-beta.keydatadashboard.com',
};

const HOSPITABLE_CONFIG: HospitableConfig = {
  apiKey: process.env.HOSPITABLE_API_KEY ?? '',
  baseUrl: process.env.HOSPITABLE_BASE_URL ?? 'https://public.api.hospitable.com/v2',
};

const HOSPITABLE_PROPERTY_ID = process.env.HOSPITABLE_PROPERTY_ID ?? '';
const PREVIOUS_APS  = Number(process.env.PREVIOUS_APS ?? '1.00');
const CURRENT_TARGET_RENT = Number(process.env.CURRENT_TARGET_RENT ?? '65000');
const DAYS_OUT      = Number(process.env.DAYS_OUT ?? '21');

// ── Formatting ──────────────────────────────────────────────────────

const dollar = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct    = (n: number) => (n * 100).toFixed(1) + '%';
const fx     = (n: number, d = 3) => n.toFixed(d);
const div    = (c = '─', len = 72) => c.repeat(len);
function row(label: string, value: string, w = 44) {
  return `  ${label}${' '.repeat(Math.max(1, w - label.length))}${value}`;
}

// ── Report Generator (importable by extensions) ──────────────────

export interface RevenueReportOptions {
  apiKey?: string;
  baseUrl?: string;
  marketUuid?: string;
  hospitable?: { apiKey?: string; baseUrl?: string };
  hospitablePropertyId?: string;
  previousAPS?: number;
  currentTargetRent?: number;
  daysOut?: number;
}

export async function generateReport(opts: RevenueReportOptions = {}): Promise<string> {
  const config: KeyDataConfig = {
    apiKey: opts.apiKey ?? process.env.KEYDATA_API_KEY ?? '3bc432a3b3314cbeb7a02fb233c4b2ac',
    baseUrl: opts.baseUrl ?? process.env.KEYDATA_BASE_URL ?? 'https://api-beta.keydatadashboard.com',
  };
  const hospConfig: HospitableConfig = {
    apiKey: opts.hospitable?.apiKey ?? process.env.HOSPITABLE_API_KEY ?? '',
    baseUrl: opts.hospitable?.baseUrl ?? process.env.HOSPITABLE_BASE_URL ?? 'https://public.api.hospitable.com/v2',
  };
  const fallbackMarketUuid = opts.marketUuid ?? process.env.MARKET_UUID ?? '';
  const hospPropertyId = opts.hospitablePropertyId ?? process.env.HOSPITABLE_PROPERTY_ID ?? '';
  const previousAPS = opts.previousAPS ?? Number(process.env.PREVIOUS_APS ?? '1.00');
  const currentTargetRent = opts.currentTargetRent ?? Number(process.env.CURRENT_TARGET_RENT ?? '65000');
  const daysOut = opts.daysOut ?? Number(process.env.DAYS_OUT ?? '21');

  const lines: string[] = [];
  const L = (s = '') => lines.push(s);

  // 1. Fetch property details for comp filtering + dynamic market detection
  let compFilters: ComparableFilters | undefined;
  let filterLabel = 'Whole Market';
  let marketUuid = fallbackMarketUuid;
  let locationLabel = '';
  let marketName = '';

  if (hospConfig.apiKey && hospPropertyId) {
    try {
      const details = await fetchPropertyDetails(hospConfig, hospPropertyId);

      // Dynamic market detection from property location
      if (details.city) {
        locationLabel = details.state ? `${details.city}, ${details.state}` : details.city;
        try {
          const matched = await findMarketForLocation(config, details.city, details.state);
          if (matched && matched.id) {
            if (matched.subscribed) {
              marketUuid = matched.id;
              marketName = matched.name;
            } else {
              // Found in global list but user isn't subscribed — use fallback UUID
              marketName = matched.name + ' (not subscribed — using fallback market)';
            }
          }
        } catch { /* fall through to fallback UUID */ }
      }

      const KEY_DATA_AMENITIES = ['pool', 'hot_tub', 'water_view', 'pet_friendly', 'waterfront', 'bbq_area', 'beach_access'];
      const matchedAmenities = details.amenities.filter(a => KEY_DATA_AMENITIES.includes(a));
      compFilters = {
        bedrooms: details.bedrooms || undefined,
        property_type: details.propertyType || undefined,
        min_sleeps: details.sleeps || undefined,
        amenities: matchedAmenities.length > 0 ? matchedAmenities : undefined,
      };
      const parts: string[] = [];
      if (details.bedrooms) parts.push(`${details.bedrooms} Bed`);
      if (details.bathrooms) parts.push(`${details.bathrooms} Bath`);
      if (details.sleeps) parts.push(`Sleeps ${details.sleeps}`);
      if (details.propertyType) parts.push(details.propertyType);
      if (matchedAmenities.length > 0) parts.push(matchedAmenities.join(', '));
      if (parts.length > 0) filterLabel = parts.join(' / ');
    } catch { /* fall through to whole market */ }
  }

  if (!marketUuid) {
    return 'Error: No market UUID available. Set MARKET_UUID in .env or ensure property has a valid location.';
  }

  // 2. Fetch data with tiered comp fallback
  const MIN_COMPS = 10;
  let marketResult: Awaited<ReturnType<typeof fetchMarketDataSafe>>;
  let compTier = 'Broad';

  if (compFilters) {
    marketResult = await fetchMarketDataSafe(config, marketUuid, compFilters);
    compTier = 'Strict';
    if (marketResult.dataPoints < MIN_COMPS) {
      marketResult = await fetchMarketDataSafe(config, marketUuid, {
        bedrooms: compFilters.bedrooms, min_sleeps: compFilters.min_sleeps,
      });
      compTier = 'Standard';
      filterLabel = `${compFilters.bedrooms ?? '?'} Bed / Sleeps ${compFilters.min_sleeps ?? '?'}`;
      if (marketResult.dataPoints < MIN_COMPS) {
        marketResult = await fetchMarketDataSafe(config, marketUuid, {
          bedrooms: compFilters.bedrooms,
        });
        compTier = 'Broad';
        filterLabel = `${compFilters.bedrooms ?? '?'} Bed`;
      }
    }
  } else {
    marketResult = await fetchMarketDataSafe(config, marketUuid);
    compTier = 'Whole Market';
  }

  const market = marketResult.data;
  const propResult = await fetchPropertyStatsSafe(hospConfig, hospPropertyId);
  const prop = propResult.data;
  const marketSrc = marketResult.live ? 'LIVE API' : 'FALLBACK';
  const propSrc   = propResult.live   ? 'LIVE API' : 'FALLBACK';
  const src = `Market: ${marketSrc} | Property: ${propSrc}`;

  // 3. Core Engine
  const perfIndex    = RevenueEngine.calculatePerformanceIndex(prop.myRevPAR, market.marketRevPAR);
  const newAPS       = RevenueEngine.calculateNewAPS(previousAPS, perfIndex);
  const annualTarget = RevenueEngine.calculateAnnualTarget(market.totalMarketAnnualRevPAR, newAPS);
  const minPrice     = RevenueEngine.calculateMinPrice(market.market20thPctlADR, prop.lastYearLowestSold);
  const maxPrice     = RevenueEngine.calculateMaxPrice(market.peakFutureADR, newAPS);
  const centroid     = RevenueEngine.calculateDynamicCentroid(market.avgFutureMarketADR, newAPS);
  const basePrice    = RevenueEngine.calculateBasePrice(market.avgADR, newAPS);

  L('PACIFIC PROPERTIES REVENUE ENGINE v4.3 (Context Aware)');
  L(`Data source: ${src}`);
  if (locationLabel) L(`Location: ${locationLabel}`);
  if (marketName) L(`Market: ${marketName}`);
  L(`Comp Set Tier: ${compTier} (${marketResult.dataPoints} comps)`);
  L(`Comps Filter: ${filterLabel}`);
  L('');
  L('--- CORE ENGINE ---');
  L(`Performance Index: ${fx(perfIndex)}`);
  L(`New APS (PID 70/30): ${fx(newAPS)}`);
  L(`Annual Revenue Target: ${dollar(annualTarget)}`);
  L(`Min Nightly Price: ${dollar(minPrice)}`);
  L(`Max Nightly Price: ${dollar(maxPrice)}`);
  L(`Dynamic Centroid: ${dollar(centroid)}`);
  L(`Base Price (ADR x APS): ${dollar(basePrice)}`);

  // 3. Error Forecasting
  const monthly = runMonthlyErrorForecasting(
    prop.myOccupancy, prop.myRevPAR,
    market.marketOccupancy, market.marketRevPAR,
    currentTargetRent, previousAPS, market.totalMarketAnnualRevPAR,
  );

  L('');
  L('--- ERROR FORECASTING (Monthly) ---');
  L(`Occ Multiplier: ${fx(monthly.metrics.occupancy, 2)}x`);
  L(`RevPAR Multiplier: ${fx(monthly.metrics.revPAR, 2)}x`);
  L(`ADR Multiplier: ${fx(monthly.metrics.adr, 2)}x`);
  L(`Diagnosis: ${monthly.diagnosis.type}`);
  L(`Explanation: ${monthly.diagnosis.explanation}`);
  L(`Correction: ${monthly.correction.adjustmentType}`);
  L(`Previous Target Rent: ${dollar(monthly.correction.previousTargetRent)}`);
  L(`New Target Rent: ${dollar(monthly.correction.newTargetRent)}`);
  L(`Applied Multiplier: ${fx(monthly.correction.appliedMultiplier, 2)}x`);
  const adjSign = monthly.correction.adjustmentPercentage >= 0 ? '+' : '';
  L(`Adjustment: ${dollar(monthly.correction.adjustmentAmount)} (${adjSign}${(monthly.correction.adjustmentPercentage * 100).toFixed(1)}%)`);

  // 4. Bell Curve
  const weekly = runWeeklyBellCurveReview(
    prop.myOccupancy, prop.currentPrice, newAPS,
    market.marketOccupancy, market.marketOccupancy, market.avgADR,
  );

  L('');
  L('--- BELL CURVE (Weekly Tactical) ---');
  L(`Market State: ${weekly.marketState}`);
  L(`Operating Mode: ${weekly.operatingMode}`);
  L(`Transition Point: ${weekly.bellCurve.transitionPoint} days`);
  L(`Recommendations: ${weekly.counts.total} (${weekly.counts.rateIncreases} increases, ${weekly.counts.priceDrops} drops, ${weekly.counts.promotions} promos)`);

  if (weekly.recommendations.length > 0) {
    L('');
    for (const r of weekly.recommendations.slice(0, 10)) {
      L(`  ${r.date}  ${r.type.padEnd(18)} ${r.value.padEnd(10)} ${dollar(r.currentPrice)} -> ${dollar(r.suggestedPrice)}  ${r.phase}`);
    }
    if (weekly.recommendations.length > 10) {
      L(`  ... and ${weekly.recommendations.length - 10} more`);
    }
  }

  // 5. Promotions
  const legacyPromo = evaluatePromotion(daysOut, prop.myOccupancy, market.marketOccupancy, prop.currentPrice, centroid);
  const marketState = determineMarketState(market.marketOccupancy, market.marketOccupancy);
  const extended = scanAllPromotions(
    prop.myOccupancy, market.marketOccupancy, prop.currentPrice, centroid,
    newAPS, daysOut, marketState, prop.avgBookingLength, market.avgBookingLength,
  );

  L('');
  L('--- PROMOTIONS ---');
  L(`Legacy Velocity Check: ${legacyPromo}`);
  if (extended.length > 0) {
    for (const r of extended) {
      L(`  ${r.type.padEnd(26)} ${r.value.padEnd(18)} ${r.rationale}`);
    }
  } else {
    L('  No structured promotions triggered.');
  }

  // Summary
  L('');
  L('--- SUMMARY ---');
  L(`APS: ${fx(newAPS)} | Annual Target: ${dollar(annualTarget)}`);
  L(`Price Range: ${dollar(minPrice)} - ${dollar(maxPrice)}`);
  L(`Diagnosis: ${monthly.diagnosis.type} | Corrected Rent: ${dollar(monthly.correction.newTargetRent)}`);
  L(`Market: ${weekly.marketState} -> ${weekly.operatingMode} | Bell Curve Recs: ${weekly.counts.total}`);

  return lines.join('\n');
}

// ── Main (CLI) ───────────────────────────────────────────────────

async function main() {
  console.log();
  console.log(div('═'));
  console.log('  PACIFIC PROPERTIES REVENUE ENGINE  v4.3  (Context Aware)');
  console.log(div('═'));

  // ── 1. Fetch Data ─────────────────────────────────────────────────
  console.log();

  // Step 1: Learn what the property is so we can filter comps + detect market
  let compFilters: ComparableFilters | undefined;
  let filterLabel = 'Whole Market (no filter)';
  let marketUuid = process.env.MARKET_UUID ?? '';
  let locationLabel = '';
  let marketName = '';

  if (HOSPITABLE_CONFIG.apiKey && HOSPITABLE_PROPERTY_ID) {
    console.log('  [1/6]  Fetching property details (Hospitable) ...');
    try {
      const details = await fetchPropertyDetails(HOSPITABLE_CONFIG, HOSPITABLE_PROPERTY_ID);
      console.log(`  Property: ${details.name}`);

      // Dynamic market detection from property location
      if (details.city) {
        locationLabel = details.state ? `${details.city}, ${details.state}` : details.city;
        console.log(`  📍 Detected Location: ${locationLabel}`);
        try {
          const matched = await findMarketForLocation(API_CONFIG, details.city, details.state);
          if (matched && matched.id) {
            if (matched.subscribed) {
              marketUuid = matched.id;
              marketName = matched.name;
              console.log(`  🎯 Matched Market: ${matched.name} (${matched.id})`);
            } else {
              console.log(`  🎯 Found Market: ${matched.name} (not subscribed — using fallback market)`);
              marketName = matched.name + ' (not subscribed)';
            }
          } else {
            console.warn(`  ⚠  No Key Data market found for "${details.city}". Using fallback UUID.`);
          }
        } catch (err) {
          console.warn(`  ⚠  Market lookup failed: ${(err as Error).message}`);
        }
      }

      // Key Data recognizes specific amenity filters — pick the high-value ones from the property
      const KEY_DATA_AMENITIES = ['pool', 'hot_tub', 'water_view', 'pet_friendly', 'waterfront', 'bbq_area', 'beach_access'];
      const matchedAmenities = details.amenities.filter(a => KEY_DATA_AMENITIES.includes(a));
      compFilters = {
        bedrooms: details.bedrooms || undefined,
        property_type: details.propertyType || undefined,
        min_sleeps: details.sleeps || undefined,
        amenities: matchedAmenities.length > 0 ? matchedAmenities : undefined,
      };
      const parts: string[] = [];
      if (details.bedrooms) parts.push(`${details.bedrooms} Bed`);
      if (details.bathrooms) parts.push(`${details.bathrooms} Bath`);
      if (details.sleeps) parts.push(`Sleeps ${details.sleeps}`);
      if (details.propertyType) parts.push(details.propertyType);
      if (matchedAmenities.length > 0) parts.push(matchedAmenities.join(', '));
      filterLabel = parts.length > 0 ? parts.join(' / ') : filterLabel;
      console.log(`  Strict Filter: ${filterLabel}`);
    } catch (err) {
      console.warn(`  ⚠  Property details fetch failed: ${(err as Error).message}`);
    }
  }

  if (!marketUuid) {
    console.error('  ✖  No market UUID available. Set MARKET_UUID in .env or ensure property has a valid location.');
    process.exit(1);
  }

  // Step 2: Fetch market data with tiered comp fallback
  const MIN_COMPS = 10;
  let marketResult: Awaited<ReturnType<typeof fetchMarketDataSafe>>;
  let compTier = 'Broad';

  if (compFilters) {
    // Tier 1: Strict — all filters (bedrooms + property_type + sleeps + amenities)
    console.log('  [2/6]  Fetching market stats (Strict comps) ...');
    marketResult = await fetchMarketDataSafe(API_CONFIG, marketUuid, compFilters);
    compTier = 'Strict';

    if (marketResult.dataPoints < MIN_COMPS) {
      // Tier 2: Standard — bedrooms + sleeps only
      const standardFilters: typeof compFilters = {
        bedrooms: compFilters.bedrooms,
        min_sleeps: compFilters.min_sleeps,
      };
      console.log(`  ⚠  Only ${marketResult.dataPoints} comps (Strict). Retrying Standard ...`);
      marketResult = await fetchMarketDataSafe(API_CONFIG, marketUuid, standardFilters);
      compTier = 'Standard';
      filterLabel = `${compFilters.bedrooms ?? '?'} Bed / Sleeps ${compFilters.min_sleeps ?? '?'}`;

      if (marketResult.dataPoints < MIN_COMPS) {
        // Tier 3: Broad — bedrooms only
        const broadFilters: typeof compFilters = {
          bedrooms: compFilters.bedrooms,
        };
        console.log(`  ⚠  Only ${marketResult.dataPoints} comps (Standard). Retrying Broad ...`);
        marketResult = await fetchMarketDataSafe(API_CONFIG, marketUuid, broadFilters);
        compTier = 'Broad';
        filterLabel = `${compFilters.bedrooms ?? '?'} Bed`;
      }
    }
  } else {
    console.log('  [2/6]  Fetching Key Data market stats ...');
    marketResult = await fetchMarketDataSafe(API_CONFIG, marketUuid);
    compTier = 'Whole Market';
  }

  const market = marketResult.data;

  // Step 3: Fetch property performance
  console.log('  [3/6]  Fetching property stats (Hospitable) ...');
  const propResult = await fetchPropertyStatsSafe(HOSPITABLE_CONFIG, HOSPITABLE_PROPERTY_ID);
  const prop = propResult.data;

  const marketSrc = marketResult.live ? 'LIVE API' : 'FALLBACK';
  const propSrc   = propResult.live   ? 'LIVE API' : 'FALLBACK';
  console.log(`\n  Market data: ${marketSrc}  |  Property data: ${propSrc}`);
  if (locationLabel) console.log(`  📍 Location: ${locationLabel}`);
  if (marketName) console.log(`  🎯 Market: ${marketName}`);
  console.log(`  Comp Set Tier: ${compTier}  (${marketResult.dataPoints} comps)`);
  console.log(`  Comps Filter: ${filterLabel}`);

  // ── 2. Core Engine ────────────────────────────────────────────────
  console.log();
  console.log(div('═'));
  console.log('  SECTION A — CORE ENGINE (v4.1 Formulas)');
  console.log(div('═'));

  const perfIndex    = RevenueEngine.calculatePerformanceIndex(prop.myRevPAR, market.marketRevPAR);
  const newAPS       = RevenueEngine.calculateNewAPS(PREVIOUS_APS, perfIndex);
  const annualTarget = RevenueEngine.calculateAnnualTarget(market.totalMarketAnnualRevPAR, newAPS);
  const minPrice     = RevenueEngine.calculateMinPrice(market.market20thPctlADR, prop.lastYearLowestSold);
  const maxPrice     = RevenueEngine.calculateMaxPrice(market.peakFutureADR, newAPS);
  const centroid     = RevenueEngine.calculateDynamicCentroid(market.avgFutureMarketADR, newAPS);
  const basePrice    = RevenueEngine.calculateBasePrice(market.avgADR, newAPS);

  console.log();
  console.log(row('Performance Index',            fx(perfIndex)));
  console.log(row('New APS (PID 70/30)',           fx(newAPS)));
  console.log(row('Annual Revenue Target',         dollar(annualTarget)));
  console.log(row('Min Nightly Price',             dollar(minPrice)));
  console.log(row('Max Nightly Price',             dollar(maxPrice)));
  console.log(row('Dynamic Centroid',              dollar(centroid)));
  console.log(row('Base Price (ADR × APS)',        dollar(basePrice)));

  // ── 3. Error Forecasting (Monthly) ────────────────────────────────
  console.log();
  console.log(div('═'));
  console.log('  SECTION B — ERROR FORECASTING (Monthly Strategic Review)');
  console.log(div('═'));

  const monthly = runMonthlyErrorForecasting(
    prop.myOccupancy,
    prop.myRevPAR,
    market.marketOccupancy,
    market.marketRevPAR,
    CURRENT_TARGET_RENT,
    PREVIOUS_APS,
    market.totalMarketAnnualRevPAR,
  );

  console.log();
  console.log('  Performance Multipliers:');
  console.log(row('    Occupancy Multiplier',     fx(monthly.metrics.occupancy, 2) + 'x'));
  console.log(row('    RevPAR Multiplier',         fx(monthly.metrics.revPAR, 2) + 'x'));
  console.log(row('    ADR Multiplier',            fx(monthly.metrics.adr, 2) + 'x'));
  console.log();
  console.log(row('  Diagnosis',                   monthly.diagnosis.type));
  console.log(row('  Explanation',                 monthly.diagnosis.explanation));
  console.log();
  console.log(row('  Correction Action',           monthly.correction.adjustmentType));
  console.log(row('  Previous Target Rent',        dollar(monthly.correction.previousTargetRent)));
  console.log(row('  New Target Rent',             dollar(monthly.correction.newTargetRent)));
  console.log(row('  Applied Multiplier',          fx(monthly.correction.appliedMultiplier, 2) + 'x'));
  console.log(row('  Adjustment',                  dollar(monthly.correction.adjustmentAmount) +
    ` (${monthly.correction.adjustmentPercentage >= 0 ? '+' : ''}${(monthly.correction.adjustmentPercentage * 100).toFixed(1)}%)`));

  // ── 4. Bell Curve Decision Tree (Weekly) ──────────────────────────
  console.log();
  console.log(div('═'));
  console.log('  SECTION C — BELL CURVE DECISION TREE (Weekly Tactical Scan)');
  console.log(div('═'));

  const weekly = runWeeklyBellCurveReview(
    prop.myOccupancy,
    prop.currentPrice,
    newAPS,
    market.marketOccupancy,
    market.marketOccupancy,  // using same as historical for demo
    market.avgADR,
  );

  console.log();
  console.log(row('  Market State',                weekly.marketState));
  console.log(row('  Operating Mode',              weekly.operatingMode));
  console.log(row('  Transition Point',            weekly.bellCurve.transitionPoint + ' days'));
  console.log(row('  Back Half Days Analyzed',     String(weekly.bellCurve.backHalfDays)));
  console.log(row('  Front Half Days Analyzed',    String(weekly.bellCurve.frontHalfDays)));
  console.log();
  console.log(row('  Total Recommendations',       String(weekly.counts.total)));
  console.log(row('    Rate Increases',            String(weekly.counts.rateIncreases)));
  console.log(row('    Price Drops',               String(weekly.counts.priceDrops)));
  console.log(row('    Promotions',                String(weekly.counts.promotions)));

  if (weekly.recommendations.length > 0) {
    console.log();
    console.log('  ' + div('─', 70));
    console.log('  Day-by-Day Recommendations:');
    console.log('  ' + div('─', 70));

    const hdr = `  ${'Date'.padEnd(12)} ${'Type'.padEnd(20)} ${'Value'.padEnd(12)} ${'Current'.padEnd(10)} ${'Suggest'.padEnd(10)} Phase`;
    console.log(hdr);
    console.log('  ' + div('─', 70));

    for (const r of weekly.recommendations) {
      console.log(
        `  ${r.date.padEnd(12)} ${r.type.padEnd(20)} ${r.value.padEnd(12)} ` +
        `${dollar(r.currentPrice).padEnd(10)} ${dollar(r.suggestedPrice).padEnd(10)} ${r.phase}`,
      );
    }
  }

  // ── 5. Legacy + Extended Promotion Scan ───────────────────────────
  console.log();
  console.log(div('═'));
  console.log('  SECTION D — SUPPLEMENTAL PROMOTION SCAN');
  console.log(div('═'));

  const legacyPromo = evaluatePromotion(DAYS_OUT, prop.myOccupancy, market.marketOccupancy, prop.currentPrice, centroid);
  console.log();
  console.log(row('  Legacy Velocity Check',       legacyPromo));

  const marketState = determineMarketState(market.marketOccupancy, market.marketOccupancy);
  const extended = scanAllPromotions(
    prop.myOccupancy,
    market.marketOccupancy,
    prop.currentPrice,
    centroid,
    newAPS,
    DAYS_OUT,
    marketState,
    prop.avgBookingLength,
    market.avgBookingLength,
  );

  if (extended.length > 0) {
    console.log();
    console.log('  Structured Promotions Found:');
    console.log('  ' + div('─', 70));
    for (const r of extended) {
      console.log(`    ${r.type.padEnd(26)} ${r.value.padEnd(20)} ${r.rationale}`);
    }
  } else {
    console.log(row('  Structured Promotions',      'None triggered'));
  }

  // ── Summary ───────────────────────────────────────────────────────
  console.log();
  console.log(div('═'));
  console.log('  ENGINE SUMMARY');
  console.log(div('═'));
  console.log();
  console.log(row('  New APS',                     fx(newAPS)));
  console.log(row('  Annual Target',               dollar(annualTarget)));
  console.log(row('  Price Range',                 `${dollar(minPrice)} – ${dollar(maxPrice)}`));
  console.log(row('  Error Forecast Diagnosis',    monthly.diagnosis.type));
  console.log(row('  Corrected Target Rent',       dollar(monthly.correction.newTargetRent)));
  console.log(row('  Market State',                weekly.marketState + ' → ' + weekly.operatingMode));
  console.log(row('  Bell Curve Recommendations',  String(weekly.counts.total)));
  console.log();
  console.log(div('═'));
  console.log('  Run complete.');
  console.log(div('═'));
  console.log();
}

// Only run CLI when executed directly (not when imported as a module)
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const thisFile = fileURLToPath(import.meta.url);
const entryFile = resolve(process.argv[1] ?? '');
if (thisFile === entryFile) {
  main().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
