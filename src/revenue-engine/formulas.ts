// ═══════════════════════════════════════════════════════════════════════
//  Pacific Properties Revenue Engine — Core Formulas
//  Reference: Pacific Properties Manual v4.1 — APS & Quibble Derivations
// ═══════════════════════════════════════════════════════════════════════

import { APS_MIN, APS_MAX, PID_HISTORY, PID_INDEX, PEAK_ADR_MULTIPLIER } from './config';

export const RevenueEngine = {
  calculatePerformanceIndex(myRevPAR: number, marketRevPAR: number): number {
    if (marketRevPAR <= 0) return 1.0;
    return myRevPAR / marketRevPAR;
  },

  calculateNewAPS(previousAPS: number, index: number): number {
    const newAPS = previousAPS * PID_HISTORY + index * PID_INDEX;
    return Math.max(APS_MIN, Math.min(newAPS, APS_MAX));
  },

  calculateAnnualTarget(marketAnnualRevPAR: number, aps: number): number {
    return marketAnnualRevPAR * aps;
  },

  calculateMinPrice(market20thPctl: number, lastYearLowest: number): number {
    return Math.max(market20thPctl, lastYearLowest);
  },

  calculateMaxPrice(peakFutureADR: number, aps: number): number {
    return peakFutureADR * aps * PEAK_ADR_MULTIPLIER;
  },

  calculateDynamicCentroid(avgFutureMarketADR: number, aps: number): number {
    return avgFutureMarketADR * aps;
  },

  calculateBasePrice(avgADR: number, aps: number): number {
    return avgADR * aps;
  },
};
