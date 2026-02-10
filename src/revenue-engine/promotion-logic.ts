// ═══════════════════════════════════════════════════════════════════════
//  Pacific Properties Revenue Engine — Promotion Logic
//  Reference: Pacific Properties Manual v4.1 — Velocity Gap Triggers
//  Ported from: Logic_WeeklyScan.gs
// ═══════════════════════════════════════════════════════════════════════

import { VELOCITY_GAP_THRESHOLD, LAST_MINUTE, EXTENDED_STAY } from './config';
import type { Recommendation, MarketState } from './types';

// ── Legacy Velocity-Based Promotion ─────────────────────────────────

export function evaluatePromotion(
  daysOut: number,
  myOcc: number,
  marketOcc: number,
  currentPrice: number,
  dynamicCentroid: number,
): string {
  const velocityGap = marketOcc - myOcc;
  const isVelocityLagging = velocityGap > VELOCITY_GAP_THRESHOLD;
  const isPriceTooHigh = currentPrice > dynamicCentroid;

  if (isVelocityLagging && isPriceTooHigh) {
    if (daysOut < 14) return 'TRIGGERED: Last Minute Hero (20% Off)';
    if (daysOut <= 60) return 'TRIGGERED: Early Bird Velocity (15% Off)';
  }
  return 'NO_ACTION';
}

// ── Structured Promotion Scan ───────────────────────────────────────

export function scanAllPromotions(
  myOcc: number,
  marketOcc: number,
  currentPrice: number,
  dynamicCentroid: number,
  aps: number,
  daysOut: number,
  marketState: MarketState,
  avgBookingLength?: number,
  marketAvgBookingLength?: number,
): Recommendation[] {
  const recommendations: Recommendation[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // 1. Velocity-based promotion (Early Bird)
  const velocityGap = marketOcc - myOcc;
  if (velocityGap > VELOCITY_GAP_THRESHOLD && currentPrice > dynamicCentroid) {
    recommendations.push({
      date: today,
      type: 'APPLY_PROMOTION',
      value: '15% off',
      currentPrice,
      suggestedPrice: dynamicCentroid * 0.85,
      rationale:
        `Velocity gap ${(velocityGap * 100).toFixed(1)}% exceeds ${(VELOCITY_GAP_THRESHOLD * 100)}% ` +
        `threshold and price $${currentPrice.toFixed(2)} above centroid $${dynamicCentroid.toFixed(2)}.`,
      phase: 'N/A',
      marketState,
      operatingMode: 'N/A',
    });
  }

  // 2. Last Minute Deal
  if (daysOut <= LAST_MINUTE.MAX_DAYS_OUT && myOcc < LAST_MINUTE.OCC_THRESHOLD) {
    const suggestedPrice = dynamicCentroid * (1 - LAST_MINUTE.DISCOUNT_PERCENTAGE);
    recommendations.push({
      date: today,
      type: 'LAST_MINUTE_DEAL',
      value: `${(LAST_MINUTE.DISCOUNT_PERCENTAGE * 100).toFixed(0)}% off`,
      currentPrice,
      suggestedPrice,
      rationale:
        `Low occupancy (${(myOcc * 100).toFixed(1)}%) with only ${daysOut} days out.`,
      phase: 'FRONT_HALF',
      marketState,
      operatingMode: 'N/A',
    });
  }

  // 3. Extended Stay Incentive
  if (
    avgBookingLength !== undefined &&
    marketAvgBookingLength !== undefined &&
    avgBookingLength < EXTENDED_STAY.PROPERTY_MAX_AVG_STAY &&
    marketAvgBookingLength >= EXTENDED_STAY.MARKET_MIN_AVG_STAY
  ) {
    recommendations.push({
      date: today,
      type: 'EXTENDED_STAY_INCENTIVE',
      value: EXTENDED_STAY.DISCOUNT_LABEL,
      currentPrice,
      suggestedPrice: currentPrice * (1 - EXTENDED_STAY.DISCOUNT_PERCENTAGE),
      rationale:
        `Avg stay ${avgBookingLength.toFixed(1)} nights vs market ${marketAvgBookingLength.toFixed(1)} nights.`,
      phase: 'N/A',
      marketState,
      operatingMode: 'N/A',
    });
  }

  return recommendations;
}
