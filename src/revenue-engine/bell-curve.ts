// ═══════════════════════════════════════════════════════════════════════
//  Pacific Properties Revenue Engine — Bell Curve Decision Tree (Weekly)
//  Reference: Bell Curve Strategic Auditor Spec — Section III
//  Ported from: Logic_TacticalWeeklyReview.gs
// ═══════════════════════════════════════════════════════════════════════

import {
  WEEKLY,
  MARKET_STATE as MS_THRESHOLDS,
  OPERATING_MODES,
  SLIDING_SCALE_BRACKETS,
} from './config';
import type {
  MarketState,
  BookingPhase,
  BookingPhaseResult,
  OperatingMode,
  APSDecayResult,
  MarketAlignmentResult,
  SlidingScaleResult,
  Recommendation,
  WeeklyReviewResult,
} from './types';

// ── Booking Phase ───────────────────────────────────────────────────

export function determineBookingPhase(daysToArrival: number): BookingPhaseResult {
  const transitionPoint = WEEKLY.FORWARD_BOOKING_WINDOW * WEEKLY.DECAY_WINDOW_PERCENTAGE;
  const phase: BookingPhase = daysToArrival > transitionPoint ? 'BACK_HALF' : 'FRONT_HALF';

  return {
    phase,
    goal: phase === 'BACK_HALF' ? 'MAXIMIZE_ADR' : 'MAXIMIZE_OCCUPANCY',
    daysToArrival,
    transitionPoint,
  };
}

// ── Market State Detection ──────────────────────────────────────────

export function determineMarketState(
  forwardOccupancy: number,
  historicalOccupancyPace: number,
): MarketState {
  const paceRatio = historicalOccupancyPace > 0
    ? forwardOccupancy / historicalOccupancyPace
    : 1.0;

  if (forwardOccupancy >= MS_THRESHOLDS.HOT_OCCUPANCY_THRESHOLD || paceRatio >= MS_THRESHOLDS.HOT_PACE_THRESHOLD) {
    return 'HOT';
  }
  if (forwardOccupancy <= MS_THRESHOLDS.COLD_OCCUPANCY_THRESHOLD || paceRatio <= MS_THRESHOLDS.COLD_PACE_THRESHOLD) {
    return 'COLD';
  }
  return 'NEUTRAL';
}

// ── Operating Mode ──────────────────────────────────────────────────

export function getOperatingMode(state: MarketState): OperatingMode {
  switch (state) {
    case 'HOT':  return OPERATING_MODES.AGGRESSIVE;
    case 'COLD': return OPERATING_MODES.DEFENSIVE;
    default:     return OPERATING_MODES.STANDARD;
  }
}

// ── APS Decay (Front Half) ──────────────────────────────────────────

export function calculateAPSDecay(fullAPS: number, daysToArrival: number): APSDecayResult {
  const decayWindow = WEEKLY.FORWARD_BOOKING_WINDOW * WEEKLY.DECAY_WINDOW_PERCENTAGE;

  if (daysToArrival >= decayWindow) {
    return { effectiveAPS: fullAPS, decayApplied: false, decayMultiplier: 1.0, daysToArrival };
  }

  const decayProgress = (decayWindow - daysToArrival) / decayWindow;
  const decayMultiplier = 1.0 - decayProgress * (1.0 - WEEKLY.MIN_DECAY_MULTIPLIER);
  return {
    effectiveAPS: fullAPS * decayMultiplier,
    decayApplied: true,
    decayMultiplier,
    daysToArrival,
  };
}

// ── Market Alignment Check ──────────────────────────────────────────

export function checkMarketAlignment(
  ourPrice: number,
  fairMarketPrice: number,
  fullAPS: number,
  daysToArrival: number,
): MarketAlignmentResult {
  const decay = calculateAPSDecay(fullAPS, daysToArrival);
  const apsAdjustedPrice = fairMarketPrice * decay.effectiveAPS;
  const maxJustifiablePrice = apsAdjustedPrice * (1 + WEEKLY.APS_JUSTIFIED_PRICE_THRESHOLD);
  const isOverpriced = ourPrice > maxJustifiablePrice;

  return {
    isOverpriced,
    ourPrice,
    fairMarketPrice,
    effectiveAPS: decay.effectiveAPS,
    apsAdjustedPrice,
    maxJustifiablePrice,
    priceGapPercentage: apsAdjustedPrice > 0 ? (ourPrice - apsAdjustedPrice) / apsAdjustedPrice : 0,
    decayApplied: decay.decayApplied,
  };
}

// ── Sliding Scale Discount ──────────────────────────────────────────

export function calculateSlidingScaleDiscount(
  baseDiscount: number,
  maxDiscount: number,
  daysToArrival: number,
): SlidingScaleResult {
  let bracket = SLIDING_SCALE_BRACKETS[SLIDING_SCALE_BRACKETS.length - 1];
  for (const b of SLIDING_SCALE_BRACKETS) {
    if (daysToArrival >= b.minDays && daysToArrival <= b.maxDays) {
      bracket = b;
      break;
    }
  }

  const calculated = baseDiscount * bracket.multiplier;
  const final = Math.min(calculated, maxDiscount);

  return {
    baseDiscount,
    multiplier: bracket.multiplier,
    calculatedDiscount: calculated,
    finalDiscount: final,
    bracketLabel: bracket.label,
    cappedByMax: calculated > maxDiscount,
  };
}

// ── Early Demand Check (Back Half) ──────────────────────────────────

function checkEarlyDemand(ourOcc: number, marketOcc: number): { hasEarlyDemand: boolean; multiplier: number } {
  const multiplier = ourOcc / Math.max(marketOcc, 0.01);
  return { hasEarlyDemand: multiplier > WEEKLY.EARLY_DEMAND_OCC_MULTIPLIER, multiplier };
}

// ── Lagging Occupancy Check (Front Half) ────────────────────────────

function checkFrontHalfLagging(ourOcc: number, marketOcc: number): { isLagging: boolean; gap: number; target: number } {
  const target = marketOcc * (1 - WEEKLY.FRONT_HALF_LAGGING_THRESHOLD);
  const isLagging = ourOcc < target;
  return { isLagging, gap: target - ourOcc, target };
}

// ── Audit a Single Day ──────────────────────────────────────────────

interface DayData {
  ourOcc: number;
  ourPrice: number;
  marketOcc: number;
  fairMarketPrice: number;
}

function auditDay(
  dateStr: string,
  day: DayData,
  daysToArrival: number,
  fullAPS: number,
  mode: OperatingMode,
  marketState: MarketState,
): Recommendation | null {
  const phaseResult = determineBookingPhase(daysToArrival);

  // ── BACK HALF: Maximize ADR ─────────────────────────────────────
  if (phaseResult.phase === 'BACK_HALF') {
    const demand = checkEarlyDemand(day.ourOcc, day.marketOcc);
    if (!demand.hasEarlyDemand) return null;

    // Scale increase: 2.5x → min (20%), 5.0x → max (25%)
    const strength = Math.min((demand.multiplier - 2.5) / 2.5, 1);
    const pct = WEEKLY.EARLY_DEMAND_RATE_INCREASE_MIN +
                strength * (WEEKLY.EARLY_DEMAND_RATE_INCREASE_MAX - WEEKLY.EARLY_DEMAND_RATE_INCREASE_MIN);
    const suggestedPrice = day.ourPrice * (1 + pct);

    return {
      date: dateStr,
      type: 'RATE_INCREASE',
      value: `+${(pct * 100).toFixed(0)}%`,
      currentPrice: day.ourPrice,
      suggestedPrice,
      rationale: `Early demand: our occ ${(day.ourOcc * 100).toFixed(1)}% is ${demand.multiplier.toFixed(1)}x market pace.`,
      phase: 'BACK_HALF',
      marketState,
      operatingMode: mode.name,
    };
  }

  // ── FRONT HALF: Maximize Occupancy ──────────────────────────────
  const lag = checkFrontHalfLagging(day.ourOcc, day.marketOcc);
  if (!lag.isLagging) return null;

  // Check if overpriced vs APS-justified price
  const alignment = checkMarketAlignment(day.ourPrice, day.fairMarketPrice, fullAPS, daysToArrival);

  if (alignment.isOverpriced) {
    return {
      date: dateStr,
      type: 'PRICE_DROP',
      value: `$${alignment.apsAdjustedPrice.toFixed(2)}`,
      currentPrice: day.ourPrice,
      suggestedPrice: alignment.apsAdjustedPrice,
      rationale:
        `Price $${day.ourPrice.toFixed(2)} exceeds APS-justified $${alignment.apsAdjustedPrice.toFixed(2)} ` +
        `by ${(alignment.priceGapPercentage * 100).toFixed(0)}%.`,
      phase: 'FRONT_HALF',
      marketState,
      operatingMode: mode.name,
    };
  }

  // Price aligned but still lagging → sliding scale promotion
  const discount = calculateSlidingScaleDiscount(mode.baseDiscount, mode.maxDiscount, daysToArrival);
  const promoPrice = day.ourPrice * (1 - discount.finalDiscount);

  return {
    date: dateStr,
    type: 'APPLY_PROMOTION',
    value: `${(discount.finalDiscount * 100).toFixed(0)}% off`,
    currentPrice: day.ourPrice,
    suggestedPrice: promoPrice,
    rationale:
      `Pacing slow (our ${(day.ourOcc * 100).toFixed(1)}% vs market ${(day.marketOcc * 100).toFixed(1)}%). ` +
      `Bracket ${discount.bracketLabel}.`,
    phase: 'FRONT_HALF',
    marketState,
    operatingMode: mode.name,
  };
}

// ── Main Weekly Review ──────────────────────────────────────────────

export function runWeeklyBellCurveReview(
  propertyOcc: number,
  currentPrice: number,
  fullAPS: number,
  marketForwardOcc: number,
  marketHistoricalOcc: number,
  marketAvgADR: number,
): WeeklyReviewResult {
  const marketState = determineMarketState(marketForwardOcc, marketHistoricalOcc);
  const mode = getOperatingMode(marketState);
  const transitionPoint = WEEKLY.FORWARD_BOOKING_WINDOW * WEEKLY.DECAY_WINDOW_PERCENTAGE;

  const recommendations: Recommendation[] = [];
  let backHalfDays = 0;
  let frontHalfDays = 0;

  const today = new Date();

  for (let i = 0; i < WEEKLY.AUDIT_LOOKAHEAD_DAYS; i++) {
    const subject = new Date(today);
    subject.setDate(today.getDate() + i);
    const dateStr = subject.toISOString().slice(0, 10);

    const phase = determineBookingPhase(i);
    if (phase.phase === 'BACK_HALF') backHalfDays++;
    else frontHalfDays++;

    const dayData: DayData = {
      ourOcc: propertyOcc,
      ourPrice: currentPrice,
      marketOcc: marketForwardOcc,
      fairMarketPrice: marketAvgADR,
    };

    const rec = auditDay(dateStr, dayData, i, fullAPS, mode, marketState);
    if (rec) recommendations.push(rec);
  }

  return {
    marketState,
    operatingMode: mode.name,
    bellCurve: { backHalfDays, frontHalfDays, transitionPoint },
    recommendations,
    counts: {
      rateIncreases: recommendations.filter(r => r.type === 'RATE_INCREASE').length,
      priceDrops:    recommendations.filter(r => r.type === 'PRICE_DROP').length,
      promotions:    recommendations.filter(r => r.type === 'APPLY_PROMOTION').length,
      total:         recommendations.length,
    },
  };
}
