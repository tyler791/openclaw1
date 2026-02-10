// ═══════════════════════════════════════════════════════════════════════
//  Pacific Properties Revenue Engine — Type Definitions
//  Reference: Pacific Properties Manual v4.1 + Bell Curve Spec v4.2
// ═══════════════════════════════════════════════════════════════════════

// ── Enums ───────────────────────────────────────────────────────────

export type MarketState = 'HOT' | 'COLD' | 'NEUTRAL';

export type BookingPhase = 'BACK_HALF' | 'FRONT_HALF';

export type RecommendationType =
  | 'RATE_INCREASE'
  | 'PRICE_DROP'
  | 'APPLY_PROMOTION'
  | 'LAST_MINUTE_DEAL'
  | 'EXTENDED_STAY_INCENTIVE'
  | 'NO_ACTION';

export type DiagnosisType =
  | 'CLASSIC_UNDERPRICING'
  | 'CLASSIC_OVERPRICING'
  | 'ACCEPTABLE_PERFORMANCE';

// ── Market Data ─────────────────────────────────────────────────────

export interface MarketData {
  marketRevPAR: number;
  marketOccupancy: number;
  market20thPctlADR: number;
  peakFutureADR: number;
  avgFutureMarketADR: number;
  totalMarketAnnualRevPAR: number;
  avgADR: number;
  avgBookingLength?: number;
}

// ── Property Data ───────────────────────────────────────────────────

export interface PropertyData {
  myRevPAR: number;
  myOccupancy: number;
  lastYearLowestSold: number;
  currentPrice: number;
  myADR?: number;
  avgBookingLength?: number;
}

// ── Performance Multipliers (Error Forecasting) ─────────────────────

export interface PerformanceMultipliers {
  occupancy: number;
  revPAR: number;
  adr: number;
}

// ── Error Forecasting Diagnosis ─────────────────────────────────────

export interface Diagnosis {
  type: DiagnosisType;
  priceErrorFactor: number;
  correctionFactor: number;
  explanation: string;
}

// ── Target Rent Adjustment ──────────────────────────────────────────

export interface CorrectionResult {
  previousTargetRent: number;
  newTargetRent: number;
  appliedMultiplier: number;
  adjustmentType: 'INCREASE' | 'DECREASE' | 'NO_CHANGE';
  adjustmentAmount: number;
  adjustmentPercentage: number;
}

// ── Monthly Strategic Review Result ─────────────────────────────────

export interface MonthlyReviewResult {
  metrics: PerformanceMultipliers;
  diagnosis: Diagnosis;
  correction: CorrectionResult;
  newAPS: number;
  previousAPS: number;
}

// ── Operating Mode ──────────────────────────────────────────────────

export interface OperatingMode {
  name: string;
  baseDiscount: number;
  maxDiscount: number;
  occupancyThreshold: number;
}

// ── Booking Phase Result ────────────────────────────────────────────

export interface BookingPhaseResult {
  phase: BookingPhase;
  goal: string;
  daysToArrival: number;
  transitionPoint: number;
}

// ── APS Decay Result ────────────────────────────────────────────────

export interface APSDecayResult {
  effectiveAPS: number;
  decayApplied: boolean;
  decayMultiplier: number;
  daysToArrival: number;
}

// ── Market Alignment Result ─────────────────────────────────────────

export interface MarketAlignmentResult {
  isOverpriced: boolean;
  ourPrice: number;
  fairMarketPrice: number;
  effectiveAPS: number;
  apsAdjustedPrice: number;
  maxJustifiablePrice: number;
  priceGapPercentage: number;
  decayApplied: boolean;
}

// ── Sliding Scale Discount Result ───────────────────────────────────

export interface SlidingScaleResult {
  baseDiscount: number;
  multiplier: number;
  calculatedDiscount: number;
  finalDiscount: number;
  bracketLabel: string;
  cappedByMax: boolean;
}

// ── Recommendation (structured output) ──────────────────────────────

export interface Recommendation {
  date: string;
  type: RecommendationType;
  value: string;
  currentPrice: number;
  suggestedPrice: number;
  rationale: string;
  phase: BookingPhase | 'N/A';
  marketState: MarketState;
  operatingMode: string;
}

// ── Weekly Tactical Review Result ───────────────────────────────────

export interface WeeklyReviewResult {
  marketState: MarketState;
  operatingMode: string;
  bellCurve: {
    backHalfDays: number;
    frontHalfDays: number;
    transitionPoint: number;
  };
  recommendations: Recommendation[];
  counts: {
    rateIncreases: number;
    priceDrops: number;
    promotions: number;
    total: number;
  };
}

// ── Sliding Scale Bracket ───────────────────────────────────────────

export interface DiscountBracket {
  minDays: number;
  maxDays: number;
  multiplier: number;
  label: string;
}
