import { RevenueEngine } from './formulas';
import { evaluatePromotion } from './promotion-logic';

// --- TEST SCENARIO ---
const PREVIOUS_APS = 1.0;
const market = { marketRevPAR: 100, marketOccupancy: 0.60, market20thPctlADR: 120, peakFutureADR: 300, avgFutureMarketADR: 200, totalMarketAnnualRevPAR: 50000 };
const myProp = { myRevPAR: 115, myOccupancy: 0.40, lastYearLowestSold: 110, currentPrice: 250 };
const DAYS_OUT = 10; 

// --- RUN ENGINE ---
console.log('--- PACIFIC PROPERTIES REVENUE ENGINE v4.1 ---');
const index = RevenueEngine.calculatePerformanceIndex(myProp.myRevPAR, market.marketRevPAR);
const newAPS = RevenueEngine.calculateNewAPS(PREVIOUS_APS, index);

console.log('Performance Index:', index.toFixed(2));
console.log('NEW APS:', newAPS.toFixed(3));
console.log('New Min Price:', '$' + RevenueEngine.calculateMinPrice(market.market20thPctlADR, myProp.lastYearLowestSold));
console.log('New Max Price:', '$' + RevenueEngine.calculateMaxPrice(market.peakFutureADR, newAPS).toFixed(2));

const centroid = RevenueEngine.calculateDynamicCentroid(market.avgFutureMarketADR, newAPS);
console.log('Dynamic Centroid:', '$' + centroid.toFixed(2));
console.log('Promotion Scan:', evaluatePromotion(DAYS_OUT, myProp.myOccupancy, market.marketOccupancy, myProp.currentPrice, centroid));
