#!/usr/bin/env npx tsx
// ═══════════════════════════════════════════════════════════════════════
//  Pacific Properties Revenue Engine v4.3 — Context Aware Comp Filtering
//  Monthly Strategic Review (Error Forecasting) + Weekly Bell Curve Scan
// ═══════════════════════════════════════════════════════════════════════

import { config as loadEnv } from 'dotenv';
loadEnv();

import { writeFile, mkdir } from 'node:fs/promises';
import { hasFlag, getFlagValue, getVerboseFlag } from '../cli/argv';
import { RevenueEngine } from './formulas';
import { evaluatePromotion, scanAllPromotions } from './promotion-logic';
import { runMonthlyErrorForecasting } from './error-forecasting';
import { runWeeklyBellCurveReview, determineMarketState, getOperatingMode } from './bell-curve';
import { fetchMarketDataSafe, fetchPropertyStatsSafe, findMarketForLocation, type KeyDataConfig, type HospitableConfig, type ComparableFilters } from './key-data-fetcher';
import { fetchPropertyDetails, listProperties } from './hospitable-client';
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

// ── CLI Flags ───────────────────────────────────────────────────────

function parseCliArgs() {
  return {
    verbose: getVerboseFlag(process.argv),
    write: hasFlag(process.argv, '--write'),
    property: getFlagValue(process.argv, '--property') ?? undefined,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function resolvePropertyId(
  slug: string,
  config: HospitableConfig,
): Promise<{ id: string; slug: string }> {
  if (UUID_RE.test(slug)) {
    return { id: slug, slug };
  }

  const properties = await listProperties(config);
  const match = properties.find(p => slugify(p.name) === slug);

  if (match) {
    return { id: match.id, slug };
  }

  console.error(`\n  Property "${slug}" not found. Available properties:`);
  for (const p of properties) {
    console.error(`    --property ${slugify(p.name).padEnd(30)} (${p.name})`);
  }
  process.exit(1);
}

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
  const cliArgs = parseCliArgs();
  const { verbose, write } = cliArgs;

  // Output capture — log() prints to console AND collects for --write
  const lines: string[] = [];
  const log = (s = '') => { console.log(s); lines.push(s); };

  // ── Resolve --property flag ────────────────────────────────────────
  let propertyId = HOSPITABLE_PROPERTY_ID;
  let propertySlug = '';

  if (cliArgs.property) {
    const resolved = await resolvePropertyId(cliArgs.property, HOSPITABLE_CONFIG);
    propertyId = resolved.id;
    propertySlug = resolved.slug;
  }

  log();
  log(div('═'));
  log('  PACIFIC PROPERTIES REVENUE ENGINE  v4.3  (Context Aware)');
  log(div('═'));

  // ── 1. Fetch Data ─────────────────────────────────────────────────
  log();

  // Step 1: Learn what the property is so we can filter comps + detect market
  let compFilters: ComparableFilters | undefined;
  let filterLabel = 'Whole Market (no filter)';
  let marketUuid = process.env.MARKET_UUID ?? '';
  let locationLabel = '';
  let marketName = '';

  if (HOSPITABLE_CONFIG.apiKey && propertyId) {
    log('  [1/6]  Fetching property details (Hospitable) ...');
    try {
      const details = await fetchPropertyDetails(HOSPITABLE_CONFIG, propertyId);
      log(`  Property: ${details.name}`);

      // Set slug from property name if not already set from CLI
      if (!propertySlug) {
        propertySlug = slugify(details.name);
      }

      // Dynamic market detection from property location
      if (details.city) {
        locationLabel = details.state ? `${details.city}, ${details.state}` : details.city;
        log(`  Detected Location: ${locationLabel}`);
        try {
          const matched = await findMarketForLocation(API_CONFIG, details.city, details.state);
          if (matched && matched.id) {
            if (matched.subscribed) {
              marketUuid = matched.id;
              marketName = matched.name;
              log(`  Matched Market: ${matched.name} (${matched.id})`);
            } else {
              log(`  Found Market: ${matched.name} (not subscribed — using fallback market)`);
              marketName = matched.name + ' (not subscribed)';
            }
          } else {
            log(`  WARNING: No Key Data market found for "${details.city}". Using fallback UUID.`);
          }
        } catch (err) {
          log(`  WARNING: Market lookup failed: ${(err as Error).message}`);
        }
      }

      if (verbose) {
        log();
        log('  [VERBOSE] Property Details:');
        log(`    bedrooms: ${details.bedrooms}`);
        log(`    bathrooms: ${details.bathrooms}`);
        log(`    sleeps: ${details.sleeps}`);
        log(`    propertyType: ${details.propertyType}`);
        log(`    amenities: ${details.amenities.join(', ') || '(none)'}`);
        log(`    city: ${details.city}`);
        log(`    state: ${details.state}`);
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
      log(`  Strict Filter: ${filterLabel}`);
    } catch (err) {
      log(`  WARNING: Property details fetch failed: ${(err as Error).message}`);
    }
  }

  if (!marketUuid) {
    console.error('  No market UUID available. Set MARKET_UUID in .env or ensure property has a valid location.');
    process.exit(1);
  }

  // Step 2: Fetch market data with tiered comp fallback
  const MIN_COMPS = 10;
  let marketResult: Awaited<ReturnType<typeof fetchMarketDataSafe>>;
  let compTier = 'Broad';

  if (compFilters) {
    // Tier 1: Strict — all filters (bedrooms + property_type + sleeps + amenities)
    log('  [2/6]  Fetching market stats (Strict comps) ...');
    marketResult = await fetchMarketDataSafe(API_CONFIG, marketUuid, compFilters);
    compTier = 'Strict';

    if (marketResult.dataPoints < MIN_COMPS) {
      // Tier 2: Standard — bedrooms + sleeps only
      const standardFilters: typeof compFilters = {
        bedrooms: compFilters.bedrooms,
        min_sleeps: compFilters.min_sleeps,
      };
      log(`  Only ${marketResult.dataPoints} comps (Strict). Retrying Standard ...`);
      marketResult = await fetchMarketDataSafe(API_CONFIG, marketUuid, standardFilters);
      compTier = 'Standard';
      filterLabel = `${compFilters.bedrooms ?? '?'} Bed / Sleeps ${compFilters.min_sleeps ?? '?'}`;

      if (marketResult.dataPoints < MIN_COMPS) {
        // Tier 3: Broad — bedrooms only
        const broadFilters: typeof compFilters = {
          bedrooms: compFilters.bedrooms,
        };
        log(`  Only ${marketResult.dataPoints} comps (Standard). Retrying Broad ...`);
        marketResult = await fetchMarketDataSafe(API_CONFIG, marketUuid, broadFilters);
        compTier = 'Broad';
        filterLabel = `${compFilters.bedrooms ?? '?'} Bed`;
      }
    }
  } else {
    log('  [2/6]  Fetching Key Data market stats ...');
    marketResult = await fetchMarketDataSafe(API_CONFIG, marketUuid);
    compTier = 'Whole Market';
  }

  const market = marketResult.data;

  if (verbose) {
    log();
    log('  [VERBOSE] Market Data (raw):');
    log(`    marketRevPAR: ${market.marketRevPAR}`);
    log(`    marketOccupancy: ${market.marketOccupancy}`);
    log(`    market20thPctlADR: ${market.market20thPctlADR}`);
    log(`    peakFutureADR: ${market.peakFutureADR}`);
    log(`    avgFutureMarketADR: ${market.avgFutureMarketADR}`);
    log(`    totalMarketAnnualRevPAR: ${market.totalMarketAnnualRevPAR}`);
    log(`    avgADR: ${market.avgADR}`);
    log(`    avgBookingLength: ${market.avgBookingLength ?? 'N/A'}`);
  }

  // Step 3: Fetch property performance
  log('  [3/6]  Fetching property stats (Hospitable) ...');
  const propResult = await fetchPropertyStatsSafe(HOSPITABLE_CONFIG, propertyId);
  const prop = propResult.data;

  if (verbose) {
    log();
    log('  [VERBOSE] Property Stats (raw):');
    log(`    myRevPAR: ${prop.myRevPAR}`);
    log(`    myOccupancy: ${prop.myOccupancy}`);
    log(`    myADR: ${prop.myADR ?? 'N/A'}`);
    log(`    currentPrice: ${prop.currentPrice}`);
    log(`    lastYearLowestSold: ${prop.lastYearLowestSold}`);
    log(`    avgBookingLength: ${prop.avgBookingLength ?? 'N/A'}`);
  }

  const marketSrc = marketResult.live ? 'LIVE API' : 'FALLBACK';
  const propSrc   = propResult.live   ? 'LIVE API' : 'FALLBACK';
  log(`\n  Market data: ${marketSrc}  |  Property data: ${propSrc}`);
  if (locationLabel) log(`  Location: ${locationLabel}`);
  if (marketName) log(`  Market: ${marketName}`);
  log(`  Comp Set Tier: ${compTier}  (${marketResult.dataPoints} comps)`);
  log(`  Comps Filter: ${filterLabel}`);

  // ── 2. Core Engine ────────────────────────────────────────────────
  log();
  log(div('═'));
  log('  SECTION A — CORE ENGINE (v4.1 Formulas)');
  log(div('═'));

  const perfIndex    = RevenueEngine.calculatePerformanceIndex(prop.myRevPAR, market.marketRevPAR);
  const newAPS       = RevenueEngine.calculateNewAPS(PREVIOUS_APS, perfIndex);
  const annualTarget = RevenueEngine.calculateAnnualTarget(market.totalMarketAnnualRevPAR, newAPS);
  const minPrice     = RevenueEngine.calculateMinPrice(market.market20thPctlADR, prop.lastYearLowestSold);
  const maxPrice     = RevenueEngine.calculateMaxPrice(market.peakFutureADR, newAPS);
  const centroid     = RevenueEngine.calculateDynamicCentroid(market.avgFutureMarketADR, newAPS);
  const basePrice    = RevenueEngine.calculateBasePrice(market.avgADR, newAPS);

  log();
  log(row('Performance Index',            fx(perfIndex)));
  log(row('New APS (PID 70/30)',           fx(newAPS)));
  log(row('Annual Revenue Target',         dollar(annualTarget)));
  log(row('Min Nightly Price',             dollar(minPrice)));
  log(row('Max Nightly Price',             dollar(maxPrice)));
  log(row('Dynamic Centroid',              dollar(centroid)));
  log(row('Base Price (ADR × APS)',        dollar(basePrice)));

  if (verbose) {
    log();
    log('  [VERBOSE] Core Engine Inputs:');
    log(`    previousAPS: ${PREVIOUS_APS}`);
    log(`    market.avgADR: ${market.avgADR}`);
    log(`    market.totalMarketAnnualRevPAR: ${market.totalMarketAnnualRevPAR}`);
    log(`    market.marketRevPAR: ${market.marketRevPAR}`);
    log(`    market.market20thPctlADR: ${market.market20thPctlADR}`);
    log(`    market.peakFutureADR: ${market.peakFutureADR}`);
    log(`    market.avgFutureMarketADR: ${market.avgFutureMarketADR}`);
    log(`    prop.myRevPAR: ${prop.myRevPAR}`);
    log(`    prop.lastYearLowestSold: ${prop.lastYearLowestSold}`);
  }

  // ── 3. Error Forecasting (Monthly) ────────────────────────────────
  log();
  log(div('═'));
  log('  SECTION B — ERROR FORECASTING (Monthly Strategic Review)');
  log(div('═'));

  const monthly = runMonthlyErrorForecasting(
    prop.myOccupancy,
    prop.myRevPAR,
    market.marketOccupancy,
    market.marketRevPAR,
    CURRENT_TARGET_RENT,
    PREVIOUS_APS,
    market.totalMarketAnnualRevPAR,
  );

  log();
  log('  Performance Multipliers:');
  log(row('    Occupancy Multiplier',     fx(monthly.metrics.occupancy, 2) + 'x'));
  log(row('    RevPAR Multiplier',         fx(monthly.metrics.revPAR, 2) + 'x'));
  log(row('    ADR Multiplier',            fx(monthly.metrics.adr, 2) + 'x'));
  log();
  log(row('  Diagnosis',                   monthly.diagnosis.type));
  log(row('  Explanation',                 monthly.diagnosis.explanation));
  log();
  log(row('  Correction Action',           monthly.correction.adjustmentType));
  log(row('  Previous Target Rent',        dollar(monthly.correction.previousTargetRent)));
  log(row('  New Target Rent',             dollar(monthly.correction.newTargetRent)));
  log(row('  Applied Multiplier',          fx(monthly.correction.appliedMultiplier, 2) + 'x'));
  log(row('  Adjustment',                  dollar(monthly.correction.adjustmentAmount) +
    ` (${monthly.correction.adjustmentPercentage >= 0 ? '+' : ''}${(monthly.correction.adjustmentPercentage * 100).toFixed(1)}%)`));

  if (verbose) {
    log();
    log('  [VERBOSE] Error Forecasting Diagnosis:');
    log(`    priceErrorFactor: ${monthly.diagnosis.priceErrorFactor}`);
    log(`    correctionFactor: ${monthly.diagnosis.correctionFactor}`);
  }

  // ── 4. Bell Curve Decision Tree (Weekly) ──────────────────────────
  log();
  log(div('═'));
  log('  SECTION C — BELL CURVE DECISION TREE (Weekly Tactical Scan)');
  log(div('═'));

  const weekly = runWeeklyBellCurveReview(
    prop.myOccupancy,
    prop.currentPrice,
    newAPS,
    market.marketOccupancy,
    market.marketOccupancy,  // using same as historical for demo
    market.avgADR,
  );

  log();
  log(row('  Market State',                weekly.marketState));
  log(row('  Operating Mode',              weekly.operatingMode));
  log(row('  Transition Point',            weekly.bellCurve.transitionPoint + ' days'));
  log(row('  Back Half Days Analyzed',     String(weekly.bellCurve.backHalfDays)));
  log(row('  Front Half Days Analyzed',    String(weekly.bellCurve.frontHalfDays)));
  log();
  log(row('  Total Recommendations',       String(weekly.counts.total)));
  log(row('    Rate Increases',            String(weekly.counts.rateIncreases)));
  log(row('    Price Drops',               String(weekly.counts.priceDrops)));
  log(row('    Promotions',                String(weekly.counts.promotions)));

  if (verbose) {
    log();
    log('  [VERBOSE] Bell Curve Details:');
    log(`    transitionPoint: ${weekly.bellCurve.transitionPoint}`);
    log(`    backHalfDays: ${weekly.bellCurve.backHalfDays}`);
    log(`    frontHalfDays: ${weekly.bellCurve.frontHalfDays}`);
  }

  if (weekly.recommendations.length > 0) {
    log();
    log('  ' + div('─', 70));
    log('  Day-by-Day Recommendations:');
    log('  ' + div('─', 70));

    const hdr = `  ${'Date'.padEnd(12)} ${'Type'.padEnd(20)} ${'Value'.padEnd(12)} ${'Current'.padEnd(10)} ${'Suggest'.padEnd(10)} Phase`;
    log(hdr);
    log('  ' + div('─', 70));

    for (const r of weekly.recommendations) {
      log(
        `  ${r.date.padEnd(12)} ${r.type.padEnd(20)} ${r.value.padEnd(12)} ` +
        `${dollar(r.currentPrice).padEnd(10)} ${dollar(r.suggestedPrice).padEnd(10)} ${r.phase}`,
      );
    }
  }

  // ── 5. Legacy + Extended Promotion Scan ───────────────────────────
  log();
  log(div('═'));
  log('  SECTION D — SUPPLEMENTAL PROMOTION SCAN');
  log(div('═'));

  const legacyPromo = evaluatePromotion(DAYS_OUT, prop.myOccupancy, market.marketOccupancy, prop.currentPrice, centroid);
  log();
  log(row('  Legacy Velocity Check',       legacyPromo));

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
    log();
    log('  Structured Promotions Found:');
    log('  ' + div('─', 70));
    for (const r of extended) {
      log(`    ${r.type.padEnd(26)} ${r.value.padEnd(20)} ${r.rationale}`);
    }
  } else {
    log(row('  Structured Promotions',      'None triggered'));
  }

  // ── Summary ───────────────────────────────────────────────────────
  log();
  log(div('═'));
  log('  ENGINE SUMMARY');
  log(div('═'));
  log();
  log(row('  New APS',                     fx(newAPS)));
  log(row('  Annual Target',               dollar(annualTarget)));
  log(row('  Price Range',                 `${dollar(minPrice)} – ${dollar(maxPrice)}`));
  log(row('  Error Forecast Diagnosis',    monthly.diagnosis.type));
  log(row('  Corrected Target Rent',       dollar(monthly.correction.newTargetRent)));
  log(row('  Market State',                weekly.marketState + ' → ' + weekly.operatingMode));
  log(row('  Bell Curve Recommendations',  String(weekly.counts.total)));
  log();
  log(div('═'));
  log('  Run complete.');
  log(div('═'));
  log();

  // ── Write report to file ──────────────────────────────────────────
  if (write) {
    const dateStr = new Date().toISOString().slice(0, 10);
    const slug = propertySlug || 'report';
    const filename = `${slug}-${dateStr}.txt`;
    await mkdir('./reports', { recursive: true });
    await writeFile(`./reports/${filename}`, lines.join('\n'), 'utf-8');
    console.log(`  Report written to ./reports/${filename}`);
  }
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
