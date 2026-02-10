// ═══════════════════════════════════════════════════════════════════════
//  Pacific Properties Revenue Engine — Configuration
//  Reference: Pacific Properties Manual v4.1 + Bell Curve Spec v4.2
//  Ported from: Config.gs (pacific-revenue-engine)
// ═══════════════════════════════════════════════════════════════════════

import type { OperatingMode, DiscountBracket } from './types';

// ── APS Constraints ─────────────────────────────────────────────────

export const APS_MIN = 0.80;
export const APS_MAX = 1.60;

// ── PID Weighting ───────────────────────────────────────────────────

export const PID_HISTORY = 0.70;
export const PID_INDEX   = 0.30;

// ── Promotion Thresholds ────────────────────────────────────────────

export const VELOCITY_GAP_THRESHOLD = 0.15;
export const PEAK_ADR_MULTIPLIER    = 1.25;

// ── Time Windows ────────────────────────────────────────────────────

export const FUTURE_PACING_DAYS = 60;
export const HISTORY_MONTHS     = 1;
export const HISTORICAL_WINDOW  = 30;
export const FORWARD_WINDOW     = 60;

// ── Monthly Review (Error Forecasting) ──────────────────────────────

export const MONTHLY = {
  MIN_REVPAR_THRESHOLD:    1.0,
  MIN_OCCUPANCY_THRESHOLD: 0.01,
  MIN_ADR_THRESHOLD:       1.0,

  // Underpricing: high occ (>=1.5x) + low RevPAR (<=0.8x)
  UNDERPRICING_OCC_MULTIPLIER:    1.5,
  UNDERPRICING_REVPAR_MULTIPLIER: 0.8,

  // Overpricing: low occ (<=0.7x) + low RevPAR (<=0.8x)
  OVERPRICING_OCC_MULTIPLIER:    0.7,
  OVERPRICING_REVPAR_MULTIPLIER: 0.8,

  OVERPRICING_CORRECTION_FACTOR: 0.90,
  CORRECTION_SMOOTHING_DIVISOR:  2,

  // Safety caps
  MAX_UPWARD_CORRECTION:   1.50,  // never increase >50% in one month
  MAX_DOWNWARD_CORRECTION: 0.80,  // never decrease >20% in one month
} as const;

// ── Weekly Review (Bell Curve) ──────────────────────────────────────

export const WEEKLY = {
  AUDIT_LOOKAHEAD_DAYS:    14,
  FORWARD_BOOKING_WINDOW:  90,
  DECAY_WINDOW_PERCENTAGE: 0.30,  // 30% of 90 = 27 days transition
  MIN_DECAY_MULTIPLIER:    0.70,

  APS_JUSTIFIED_PRICE_THRESHOLD: 0.10,  // 10% over APS-price = overpriced

  // Back Half — Early Demand
  EARLY_DEMAND_OCC_MULTIPLIER:    2.5,
  EARLY_DEMAND_RATE_INCREASE_MIN: 0.20,
  EARLY_DEMAND_RATE_INCREASE_MAX: 0.25,

  // Front Half — Lagging Occupancy
  FRONT_HALF_LAGGING_THRESHOLD: 0.20,
  LAGGING_OCCUPANCY_THRESHOLD:  0.15,
} as const;

// ── Market State Thresholds ─────────────────────────────────────────

export const MARKET_STATE = {
  HOT_OCCUPANCY_THRESHOLD:  0.75,
  COLD_OCCUPANCY_THRESHOLD: 0.45,
  HOT_PACE_THRESHOLD:       1.10,
  COLD_PACE_THRESHOLD:      0.90,
} as const;

// ── Operating Modes ─────────────────────────────────────────────────

export const OPERATING_MODES: Record<string, OperatingMode> = {
  AGGRESSIVE: {
    name: 'Aggressive',
    baseDiscount: 0.05,
    maxDiscount: 0.15,
    occupancyThreshold: 0.10,
  },
  STANDARD: {
    name: 'Standard',
    baseDiscount: 0.10,
    maxDiscount: 0.20,
    occupancyThreshold: 0.15,
  },
  DEFENSIVE: {
    name: 'Defensive',
    baseDiscount: 0.15,
    maxDiscount: 0.30,
    occupancyThreshold: 0.15,
  },
};

// ── Sliding Scale Discount Brackets ─────────────────────────────────

export const SLIDING_SCALE_BRACKETS: DiscountBracket[] = [
  { minDays: 0,  maxDays: 3,        multiplier: 2.0,  label: '0-3d (2x)'    },
  { minDays: 4,  maxDays: 7,        multiplier: 1.5,  label: '4-7d (1.5x)'  },
  { minDays: 8,  maxDays: 14,       multiplier: 1.25, label: '8-14d (1.25x)' },
  { minDays: 15, maxDays: 30,       multiplier: 1.0,  label: '15-30d (1x)'   },
  { minDays: 31, maxDays: Infinity,  multiplier: 0.75, label: '31+d (0.75x)'  },
];

// ── Last Minute Deal ────────────────────────────────────────────────

export const LAST_MINUTE = {
  MAX_DAYS_OUT:         7,
  OCC_THRESHOLD:        0.50,
  DISCOUNT_PERCENTAGE:  0.20,
} as const;

// ── Extended Stay Incentive ─────────────────────────────────────────

export const EXTENDED_STAY = {
  PROPERTY_MAX_AVG_STAY: 3,
  MARKET_MIN_AVG_STAY:   4,
  DISCOUNT_LABEL:        '10% for 5+ nights',
  DISCOUNT_PERCENTAGE:   0.10,
} as const;
