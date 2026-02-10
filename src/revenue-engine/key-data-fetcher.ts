// ═══════════════════════════════════════════════════════════════════════
//  Pacific Properties Revenue Engine — Key Data API Client
//  Reference: MarketDataClient.gs (pacific-revenue-engine)
//  Endpoints:  POST /api/v1/ota/market/kpis/week
//              POST /api/v1/ota/market/kpis/month
// ═══════════════════════════════════════════════════════════════════════

import type { MarketData, PropertyData } from './types';

const DEFAULT_BASE_URL = 'https://api-beta.keydatadashboard.com';

export interface KeyDataConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface ComparableFilters {
  bedrooms?: number;
  property_type?: string;
  min_sleeps?: number;
  amenities?: string[];
  ota?: string;
}

// ── Raw POST request ────────────────────────────────────────────────

async function postRequest<T>(
  config: KeyDataConfig,
  endpoint: string,
  body: Record<string, unknown>,
): Promise<T> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  const url = `${baseUrl}${endpoint}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': config.apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Key Data API [${res.status}] ${endpoint}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ── Build filters object ────────────────────────────────────────────

function buildApiFilters(filters?: ComparableFilters): Record<string, unknown> | null {
  if (!filters) return null;
  const f: Record<string, unknown> = {};
  if (filters.ota)           f.ota = filters.ota;
  if (filters.property_type) f.property_type = filters.property_type.toLowerCase();
  if (filters.bedrooms && filters.bedrooms > 0) f.bedrooms = filters.bedrooms;
  if (filters.min_sleeps && filters.min_sleeps > 0) f.min_sleeps = filters.min_sleeps;
  if (filters.amenities && filters.amenities.length > 0) {
    f.amenities = filters.amenities.map(a => a.toLowerCase().replace(/\s+/g, '_'));
  }
  return Object.keys(f).length > 0 ? f : null;
}

// ── Weekly KPIs (future pacing) ─────────────────────────────────────

interface WeeklyKPI {
  date: string;
  ota_source?: string;
  guest_occupancy: number | null;
  adr: number | null;
  revpar: number | null;
  avg_stay_length: number | null;
  listing_count: number | null;
}

// Aggregate per-OTA rows into per-date averages (API returns separate airbnb/vrbo rows).
function aggregateByDate<T extends { date: string }>(kpis: T[]): Map<string, T[]> {
  const byDate = new Map<string, T[]>();
  for (const k of kpis) {
    const arr = byDate.get(k.date) ?? [];
    arr.push(k);
    byDate.set(k.date, arr);
  }
  return byDate;
}

export async function fetchWeeklyKPIs(
  config: KeyDataConfig,
  marketUuid: string,
  startDate: string,
  endDate: string,
  filters?: ComparableFilters,
) {
  const body: Record<string, unknown> = {
    market_uuid: marketUuid,
    start_date: startDate,
    end_date: endDate,
    currency: 'USD',
  };
  const apiFilters = buildApiFilters(filters);
  if (apiFilters) body.filters = apiFilters;

  const res = await postRequest<{ data?: { kpis?: WeeklyKPI[] } }>(
    config, '/api/v1/ota/market/kpis/week', body,
  );

  let totalOcc = 0, totalADR = 0, totalRevPAR = 0, totalStayLen = 0, n = 0;
  const kpis = res?.data?.kpis;
  if (Array.isArray(kpis)) {
    // Aggregate airbnb + vrbo rows per date into a single average
    const byDate = aggregateByDate(kpis);
    for (const rows of byDate.values()) {
      let dateOcc = 0, dateADR = 0, dateRevPAR = 0, dateStay = 0, count = 0;
      for (const w of rows) {
        if (w.guest_occupancy != null && w.adr != null) {
          dateOcc    += Number(w.guest_occupancy);
          dateADR    += Number(w.adr);
          dateRevPAR += Number(w.revpar ?? 0);
          dateStay   += Number(w.avg_stay_length ?? 0);
          count++;
        }
      }
      if (count > 0) {
        totalOcc    += dateOcc / count;
        totalADR    += dateADR / count;
        totalRevPAR += dateRevPAR / count;
        totalStayLen += dateStay / count;
        n++;
      }
    }
  }

  return {
    occupancy:    n > 0 ? totalOcc / n : 0,
    futureAdr:    n > 0 ? totalADR / n : 0,
    futureRevPAR: n > 0 ? totalRevPAR / n : 0,
    avgStayLength: n > 0 ? totalStayLen / n : 0,
    dataPoints: n,
  };
}

// ── Monthly KPIs (historical) ───────────────────────────────────────

interface MonthlyKPI {
  date: string;
  ota_source?: string;
  guest_occupancy: number | null;
  adr: number | null;
  revpar: number | null;
  guest_nights: number | null;
  available_nights: number | null;
  avg_stay_length: number | null;
}

export async function fetchMonthlyKPIs(
  config: KeyDataConfig,
  marketUuid: string,
  startDate: string,
  endDate: string,
  filters?: ComparableFilters,
) {
  const body: Record<string, unknown> = {
    market_uuid: marketUuid,
    start_date: startDate,
    end_date: endDate,
    currency: 'USD',
  };
  const apiFilters = buildApiFilters(filters);
  if (apiFilters) body.filters = apiFilters;

  const res = await postRequest<{ data?: { kpis?: MonthlyKPI[] } }>(
    config, '/api/v1/ota/market/kpis/month', body,
  );

  let totalRevPAR = 0, totalOcc = 0, totalADR = 0, peakADR = 0, totalStayLen = 0, n = 0;
  const kpis = res?.data?.kpis;
  if (Array.isArray(kpis)) {
    // Aggregate airbnb + vrbo rows per date into a single average
    const byDate = aggregateByDate(kpis);
    for (const rows of byDate.values()) {
      let dateRevPAR = 0, dateOcc = 0, dateADR = 0, dateStay = 0, count = 0;
      for (const m of rows) {
        if (m.adr != null) {
          dateRevPAR += Number(m.revpar ?? 0);
          dateOcc    += Number(m.guest_occupancy ?? 0);
          dateADR    += Number(m.adr);
          dateStay   += Number(m.avg_stay_length ?? 0);
          count++;
        }
      }
      if (count > 0) {
        const avgDateADR = dateADR / count;
        totalRevPAR  += dateRevPAR / count;
        totalOcc     += dateOcc / count;
        totalADR     += avgDateADR;
        totalStayLen += dateStay / count;
        if (avgDateADR > peakADR) peakADR = avgDateADR;
        n++;
      }
    }
  }

  const marketRevPAR  = n > 0 ? totalRevPAR / n : 0;
  const avgOccupancy  = n > 0 ? totalOcc / n : 0;
  const avgADR        = n > 0 ? totalADR / n : 0;
  const annualRevPar  = marketRevPAR * 365;
  const avgStayLength = n > 0 ? totalStayLen / n : 0;

  return { marketRevPAR, annualRevPar, avgOccupancy, avgADR, peakADR, avgStayLength, dataPoints: n };
}

// ── Fetch full MarketData (with fallback) ───────────────────────────

export async function fetchMarketDataSafe(
  config: KeyDataConfig,
  marketUuid: string,
  filters?: ComparableFilters,
): Promise<{ data: MarketData; live: boolean }> {
  try {
    const today = new Date();

    // Historical: previous 6 months for a seasonally balanced average
    const histStart = new Date(today.getFullYear(), today.getMonth() - 6, 1);
    const histEnd   = new Date(today.getFullYear(), today.getMonth(), 0);
    const fmtHistStart = histStart.toISOString().slice(0, 10);
    const fmtHistEnd   = histEnd.toISOString().slice(0, 10);

    // Future pacing: next 60 days
    const futureEnd = new Date(today);
    futureEnd.setDate(today.getDate() + 60);
    const fmtToday     = today.toISOString().slice(0, 10);
    const fmtFutureEnd = futureEnd.toISOString().slice(0, 10);

    const [monthly, weekly] = await Promise.all([
      fetchMonthlyKPIs(config, marketUuid, fmtHistStart, fmtHistEnd, filters),
      fetchWeeklyKPIs(config, marketUuid, fmtToday, fmtFutureEnd, filters),
    ]);

    return {
      live: true,
      data: {
        marketRevPAR:            monthly.marketRevPAR,
        marketOccupancy:         monthly.avgOccupancy,
        market20thPctlADR:       monthly.avgADR * 0.65,   // approximate p20 from avg
        peakFutureADR:           monthly.peakADR || weekly.futureAdr * 1.4,
        avgFutureMarketADR:      weekly.futureAdr,
        totalMarketAnnualRevPAR: monthly.annualRevPar,
        avgADR:                  monthly.avgADR,
        avgBookingLength:        weekly.avgStayLength || monthly.avgStayLength || undefined,
      },
    };
  } catch (err) {
    console.warn(`  ⚠  Live market fetch failed: ${(err as Error).message}`);
    return { data: getFallbackMarketData(), live: false };
  }
}

export async function fetchPropertyStatsSafe(
  config: KeyDataConfig,
  _propertyId: string,
): Promise<{ data: PropertyData; live: boolean }> {
  // Property stats come from Hospitable API in production.
  // For now, use fallback data.
  return { data: getFallbackPropertyData(), live: false };
}

// ── Fallback Data (Maui comp set) ───────────────────────────────────

function getFallbackMarketData(): MarketData {
  return {
    marketRevPAR: 189.50,
    marketOccupancy: 0.72,
    market20thPctlADR: 155.00,
    peakFutureADR: 485.00,
    avgFutureMarketADR: 310.00,
    totalMarketAnnualRevPAR: 69_178,
    avgADR: 263.19,
    avgBookingLength: 4.8,
  };
}

function getFallbackPropertyData(): PropertyData {
  return {
    myRevPAR: 215.75,
    myOccupancy: 0.58,
    lastYearLowestSold: 139.00,
    currentPrice: 349.00,
    myADR: 371.98,
    avgBookingLength: 2.4,
  };
}
