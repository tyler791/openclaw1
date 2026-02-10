// ═══════════════════════════════════════════════════════════════════════
//  Pacific Properties Revenue Engine — Hospitable API Client
//  Reference: HospitableClient.gs (pacific-revenue-engine)
//  API Docs:  https://developer.hospitable.com
//  Base URL:  https://public.api.hospitable.com/v2
// ═══════════════════════════════════════════════════════════════════════

import type { PropertyData } from './types';

const DEFAULT_BASE_URL = 'https://public.api.hospitable.com/v2';

export interface HospitableConfig {
  apiKey: string;
  baseUrl?: string;
}

// ── Authenticated GET request ────────────────────────────────────────

async function hospGet<T>(
  config: HospitableConfig,
  endpoint: string,
  params?: Record<string, string>,
): Promise<T> {
  const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
  let url = `${baseUrl}${endpoint}`;

  if (params && Object.keys(params).length > 0) {
    const qs = new URLSearchParams(params).toString();
    url += `?${qs}`;
  }

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Hospitable API [${res.status}] ${endpoint}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ── List properties ──────────────────────────────────────────────────

interface HospitableProperty {
  uuid?: string;
  id?: string;
  name?: string;
  base_price?: number;
  price?: number;
  status?: string;
}

export async function listProperties(
  config: HospitableConfig,
): Promise<Array<{ id: string; name: string; basePrice: number }>> {
  const res = await hospGet<{ data?: HospitableProperty[] }>(
    config, '/properties', { per_page: '100' },
  );

  const properties = res?.data ?? [];
  return properties
    .filter(p => !p.status || p.status === 'active')
    .map(p => ({
      id: p.uuid ?? p.id ?? '',
      name: p.name ?? 'Unnamed',
      basePrice: Number(p.base_price ?? p.price ?? 0),
    }));
}

// ── Calendar stats (RevPAR, occupancy, ADR, lowest sold) ─────────────

interface CalendarDay {
  date: string;
  available: boolean;
  price?: number;
  nightly_price?: number;
  reservation?: unknown;
  reservation_id?: string;
}

interface CalendarStats {
  myRevPAR: number;
  myOccupancy: number;
  myADR: number;
  lowestSoldPrice: number;
  totalRevenue: number;
  bookedNights: number;
  availableNights: number;
}

export async function fetchCalendarStats(
  config: HospitableConfig,
  propertyId: string,
  startDate: string,
  endDate: string,
): Promise<CalendarStats> {
  const res = await hospGet<{ data?: CalendarDay[] }>(
    config,
    `/properties/${propertyId}/calendar`,
    { start_date: startDate, end_date: endDate },
  );

  const days = res?.data;
  if (!Array.isArray(days) || days.length === 0) {
    return { myRevPAR: 0, myOccupancy: 0, myADR: 0, lowestSoldPrice: 0, totalRevenue: 0, bookedNights: 0, availableNights: 0 };
  }

  let totalRevenue = 0;
  let bookedNights = 0;
  let blockedNights = 0;
  let totalNights = 0;
  let lowestSoldPrice = Infinity;

  for (const day of days) {
    totalNights++;

    if (day.available === false) {
      if (day.reservation || day.reservation_id) {
        // Booked night — price is take-home (after platform fees)
        bookedNights++;
        const nightlyPrice = Number(day.price ?? day.nightly_price ?? 0);
        totalRevenue += nightlyPrice;
        if (nightlyPrice > 0 && nightlyPrice < lowestSoldPrice) {
          lowestSoldPrice = nightlyPrice;
        }
      } else {
        // Owner-blocked — excluded from availability
        blockedNights++;
      }
    }
  }

  const availableNights = totalNights - blockedNights;
  const myRevPAR = availableNights > 0 ? totalRevenue / availableNights : 0;
  const myOccupancy = availableNights > 0 ? bookedNights / availableNights : 0;
  const myADR = bookedNights > 0 ? totalRevenue / bookedNights : 0;

  return {
    myRevPAR,
    myOccupancy,
    myADR,
    lowestSoldPrice: lowestSoldPrice === Infinity ? 0 : lowestSoldPrice,
    totalRevenue,
    bookedNights,
    availableNights,
  };
}

// ── Current base price from property details ─────────────────────────

export async function fetchCurrentPrice(
  config: HospitableConfig,
  propertyId: string,
): Promise<number> {
  const res = await hospGet<{ data?: HospitableProperty }>(
    config, `/properties/${propertyId}`,
  );
  return Number(res?.data?.base_price ?? res?.data?.price ?? 0);
}

// ── Average booking length from reservations ─────────────────────────

interface HospitableReservation {
  property_id?: string;
  property_uuid?: string;
  check_in?: string;
  checkin?: string;
  check_out?: string;
  checkout?: string;
  status?: string;
  nights?: number;
}

export async function fetchAvgBookingLength(
  config: HospitableConfig,
  propertyId: string,
): Promise<number> {
  const res = await hospGet<{ data?: HospitableReservation[] }>(
    config, '/reservations', { per_page: '100' },
  );

  const reservations = res?.data ?? [];
  let totalNights = 0;
  let count = 0;

  for (const r of reservations) {
    // Filter to this property
    if (r.property_id !== propertyId && r.property_uuid !== propertyId) continue;
    // Skip cancelled
    if (r.status === 'cancelled' || r.status === 'declined') continue;

    if (r.nights && r.nights > 0) {
      totalNights += r.nights;
      count++;
    } else {
      const checkIn = r.check_in ?? r.checkin;
      const checkOut = r.check_out ?? r.checkout;
      if (checkIn && checkOut) {
        const nights = Math.round(
          (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24),
        );
        if (nights > 0) {
          totalNights += nights;
          count++;
        }
      }
    }
  }

  return count > 0 ? totalNights / count : 0;
}

// ── Full property data fetch (orchestrator) ──────────────────────────

export async function fetchPropertyDataLive(
  config: HospitableConfig,
  propertyId: string,
): Promise<PropertyData> {
  const today = new Date();

  // Historical performance: last 6 months
  const histStart = new Date(today.getFullYear(), today.getMonth() - 6, 1);
  const histEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const fmtHistStart = histStart.toISOString().slice(0, 10);
  const fmtHistEnd = histEnd.toISOString().slice(0, 10);

  // Last year range for lowest-sold-price
  const yearStart = new Date(today.getFullYear() - 1, today.getMonth(), 1);
  const fmtYearStart = yearStart.toISOString().slice(0, 10);

  const [calStats, yearStats, currentPrice, avgBookingLength] = await Promise.all([
    fetchCalendarStats(config, propertyId, fmtHistStart, fmtHistEnd),
    fetchCalendarStats(config, propertyId, fmtYearStart, fmtHistEnd),
    fetchCurrentPrice(config, propertyId),
    fetchAvgBookingLength(config, propertyId),
  ]);

  return {
    myRevPAR: calStats.myRevPAR,
    myOccupancy: calStats.myOccupancy,
    myADR: calStats.myADR,
    currentPrice: currentPrice || calStats.myADR,
    lastYearLowestSold: yearStats.lowestSoldPrice || calStats.lowestSoldPrice,
    avgBookingLength: avgBookingLength || undefined,
  };
}
