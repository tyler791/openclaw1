// ═══════════════════════════════════════════════════════════════════════
//  Pacific Properties Revenue Engine — Error Forecasting (Monthly)
//  Reference: Bell Curve Strategic Auditor Spec — Section II
//  Ported from: Logic_StrategicMonthlyReview.gs
// ═══════════════════════════════════════════════════════════════════════

import { MONTHLY } from './config';
import type {
  PerformanceMultipliers,
  Diagnosis,
  DiagnosisType,
  CorrectionResult,
} from './types';

// ── ADR Helper ──────────────────────────────────────────────────────

export function deriveADR(revPAR: number, occupancy: number): number {
  if (occupancy <= 0) return revPAR || 0;
  return revPAR / occupancy;
}

// ── Step 1: Performance Multipliers ─────────────────────────────────

export function calculatePerformanceMultipliers(
  ourOcc: number,
  ourRevPAR: number,
  ourADR: number,
  compOcc: number,
  compRevPAR: number,
  compADR: number,
): PerformanceMultipliers {
  const safeCompOcc    = Math.max(compOcc,    MONTHLY.MIN_OCCUPANCY_THRESHOLD);
  const safeCompRevPAR = Math.max(compRevPAR, MONTHLY.MIN_REVPAR_THRESHOLD);
  const safeCompADR    = Math.max(compADR,    MONTHLY.MIN_ADR_THRESHOLD);

  return {
    occupancy: ourOcc    / safeCompOcc,
    revPAR:    ourRevPAR / safeCompRevPAR,
    adr:       ourADR    / safeCompADR,
  };
}

// ── Step 2: Diagnose Error ──────────────────────────────────────────

export function diagnoseErrorForecasting(m: PerformanceMultipliers): Diagnosis {
  // Classic Underpricing: high occ (>=1.5x) + low RevPAR (<=0.8x)
  if (
    m.occupancy >= MONTHLY.UNDERPRICING_OCC_MULTIPLIER &&
    m.revPAR   <= MONTHLY.UNDERPRICING_REVPAR_MULTIPLIER
  ) {
    const priceErrorFactor = m.adr;
    const correctionFactor = priceErrorFactor > 0 ? 1 / priceErrorFactor : 2.0;

    return {
      type: 'CLASSIC_UNDERPRICING',
      priceErrorFactor,
      correctionFactor,
      explanation:
        `Bought occupancy (${(m.occupancy * 100).toFixed(0)}% of market) ` +
        `with prices at only ${(priceErrorFactor * 100).toFixed(0)}% of market ADR.`,
    };
  }

  // Classic Overpricing: low occ (<=0.7x) + low RevPAR (<=0.8x)
  if (
    m.occupancy <= MONTHLY.OVERPRICING_OCC_MULTIPLIER &&
    m.revPAR    <= MONTHLY.OVERPRICING_REVPAR_MULTIPLIER
  ) {
    return {
      type: 'CLASSIC_OVERPRICING',
      priceErrorFactor: m.adr,
      correctionFactor: MONTHLY.OVERPRICING_CORRECTION_FACTOR,
      explanation:
        `High prices deterred bookings. Only achieving ` +
        `${(m.occupancy * 100).toFixed(0)}% of market occupancy.`,
    };
  }

  return {
    type: 'ACCEPTABLE_PERFORMANCE',
    priceErrorFactor: 1.0,
    correctionFactor: 1.0,
    explanation: 'Performance within acceptable bounds. No adjustment needed.',
  };
}

// ── Step 3: Calculate Target Rent Correction ────────────────────────

export function calculateCorrectionAdjustment(
  currentTargetRent: number,
  diagnosis: Diagnosis,
): CorrectionResult {
  let appliedMultiplier = 1.0;
  let adjustmentType: CorrectionResult['adjustmentType'] = 'NO_CHANGE';

  if (diagnosis.type === 'CLASSIC_UNDERPRICING') {
    // Smoothed upward correction
    appliedMultiplier = 1 + (diagnosis.correctionFactor - 1) / MONTHLY.CORRECTION_SMOOTHING_DIVISOR;
    appliedMultiplier = Math.min(appliedMultiplier, MONTHLY.MAX_UPWARD_CORRECTION);
    adjustmentType = 'INCREASE';
  } else if (diagnosis.type === 'CLASSIC_OVERPRICING') {
    appliedMultiplier = diagnosis.correctionFactor;
    appliedMultiplier = Math.max(appliedMultiplier, MONTHLY.MAX_DOWNWARD_CORRECTION);
    adjustmentType = 'DECREASE';
  }

  const newTargetRent = currentTargetRent * appliedMultiplier;

  return {
    previousTargetRent: currentTargetRent,
    newTargetRent,
    appliedMultiplier,
    adjustmentType,
    adjustmentAmount: newTargetRent - currentTargetRent,
    adjustmentPercentage: appliedMultiplier - 1,
  };
}

// ── Convenience: full monthly review pipeline ───────────────────────

export function runMonthlyErrorForecasting(
  ourOcc: number,
  ourRevPAR: number,
  compOcc: number,
  compRevPAR: number,
  currentTargetRent: number,
  currentAPS: number,
  marketAnnualRevPAR: number,
): { metrics: PerformanceMultipliers; diagnosis: Diagnosis; correction: CorrectionResult } {
  const ourADR  = deriveADR(ourRevPAR, ourOcc);
  const compADR = deriveADR(compRevPAR, compOcc);

  const metrics    = calculatePerformanceMultipliers(ourOcc, ourRevPAR, ourADR, compOcc, compRevPAR, compADR);
  const diagnosis  = diagnoseErrorForecasting(metrics);

  // Bootstrap target rent if none exists
  const effectiveTarget = currentTargetRent > 0
    ? currentTargetRent
    : marketAnnualRevPAR * currentAPS;

  const correction = calculateCorrectionAdjustment(effectiveTarget, diagnosis);

  return { metrics, diagnosis, correction };
}
