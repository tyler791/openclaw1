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
  id?: string;
  name?: string;
  listed?: boolean;
  currency?: string;
  bedrooms?: number;
  bathrooms?: number;
  person_capacity?: number;
  property_type?: string;
  type?: string;
}

// ── Property details (bedrooms, bathrooms, type) ─────────────────────

export interface PropertyDetails {
  id: string;
  name: string;
  bedrooms: number;
  bathrooms: number;
  propertyType: string;
  sleeps: number;
  amenities: string[];
  city: string;
  state: string;
}

export async function fetchPropertyDetails(
  config: HospitableConfig,
  propertyId: string,
): Promise<PropertyDetails> {
  const res = await hospGet<{ data?: HospitableProperty & {
    bedrooms?: number;
    bathrooms?: number | string;
    person_capacity?: number;
    property_type?: string;
    type?: string;
    summary?: string;
    amenities?: string[];
    capacity?: { guests?: number };
    address?: { city?: string; state?: string; country?: string };
  } }>(config, `/properties/${propertyId}`);

  const p = res?.data;

  // Parse bedrooms/bathrooms from API fields or fall back to summary text
  let bedrooms = Number(p?.bedrooms ?? 0);
  let bathrooms = Number(p?.bathrooms ?? 0);
  let sleeps = Number(p?.person_capacity ?? 0);

  // Some properties embed details in summary (e.g. "Sleeps 8 | 3 bedrooms | 2 baths")
  if ((!bedrooms || !bathrooms) && p?.summary) {
    const bedMatch = p.summary.match(/(\d+)\s*bed(?:room)?s?/i);
    const bathMatch = p.summary.match(/(\d+)\s*bath(?:room)?s?/i);
    const sleepMatch = p.summary.match(/sleeps?\s*(\d+)/i);
    if (bedMatch && !bedrooms) bedrooms = Number(bedMatch[1]);
    if (bathMatch && !bathrooms) bathrooms = Number(bathMatch[1]);
    if (sleepMatch && !sleeps) sleeps = Number(sleepMatch[1]);
  }

  // Amenities come as a flat string array from Hospitable (e.g. ["ac", "bbq_area", "pool"])
  const amenities = Array.isArray(p?.amenities)
    ? p.amenities.map(a => a.toLowerCase().replace(/\s+/g, '_'))
    : [];

  return {
    id: p?.id ?? propertyId,
    name: p?.name ?? 'Unknown',
    bedrooms,
    bathrooms,
    propertyType: (p?.property_type ?? p?.type ?? 'house').toLowerCase(),
    sleeps: sleeps || Number(p?.capacity?.guests ?? 0),
    amenities,
    city: p?.address?.city ?? '',
    state: p?.address?.state ?? '',
  };
}

export async function listProperties(
  config: HospitableConfig,
): Promise<Array<{ id: string; name: string }>> {
  const res = await hospGet<{ data?: HospitableProperty[] }>(
    config, '/properties', { per_page: '100' },
  );

  const properties = res?.data ?? [];
  return properties
    .filter(p => p.listed !== false)
    .map(p => ({
      id: p.id ?? '',
      name: p.name ?? 'Unnamed',
    }));
}

// ── Calendar stats (RevPAR, occupancy, ADR, lowest sold) ─────────────
//
// Actual Hospitable v2 calendar response structure:
//   { data: { listing_id, provider, start_date, end_date, days: [...] } }
// Each day entry:
//   { date, status: { reason, available }, price: { amount (cents), currency, formatted } }
// status.reason values: "AVAILABLE", "RESERVED", "BLOCKED", etc.

interface CalendarDayStatus {
  reason: string;
  available: boolean;
  source?: string;
}

interface CalendarDayPrice {
  amount: number;    // in cents (e.g. 22000 = $220.00)
  currency: string;
  formatted: string;
}

interface CalendarDay {
  date: string;
  status: CalendarDayStatus;
  price: CalendarDayPrice;
}

interface CalendarResponse {
  data?: {
    days?: CalendarDay[];
  };
}

interface CalendarStats {
  myRevPAR: number;
  myOccupancy: number;
  myADR: number;
  lowestSoldPrice: number;
  currentPrice: number;
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
  const res = await hospGet<CalendarResponse>(
    config,
    `/properties/${propertyId}/calendar`,
    { start_date: startDate, end_date: endDate },
  );

  const days = res?.data?.days;
  if (!Array.isArray(days) || days.length === 0) {
    return { myRevPAR: 0, myOccupancy: 0, myADR: 0, lowestSoldPrice: 0, currentPrice: 0, totalRevenue: 0, bookedNights: 0, availableNights: 0 };
  }

  let totalRevenue = 0;
  let bookedNights = 0;
  let blockedNights = 0;
  let totalNights = 0;
  let lowestSoldPrice = Infinity;
  let latestAvailablePrice = 0;

  for (const day of days) {
    totalNights++;
    const priceDollars = (day.price?.amount ?? 0) / 100;

    if (!day.status.available) {
      const reason = day.status.reason?.toUpperCase() ?? '';
      if (reason === 'RESERVED' || reason === 'BOOKED') {
        // Booked night — price is take-home (after platform fees)
        bookedNights++;
        totalRevenue += priceDollars;
        if (priceDollars > 0 && priceDollars < lowestSoldPrice) {
          lowestSoldPrice = priceDollars;
        }
      } else {
        // Owner-blocked — excluded from availability
        blockedNights++;
      }
    } else {
      // Track latest available price as "current price"
      if (priceDollars > 0) {
        latestAvailablePrice = priceDollars;
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
    currentPrice: latestAvailablePrice,
    totalRevenue,
    bookedNights,
    availableNights,
  };
}

// ── Current price from today's calendar ──────────────────────────────

export async function fetchCurrentPrice(
  config: HospitableConfig,
  propertyId: string,
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const stats = await fetchCalendarStats(config, propertyId, today, tomorrow);
  return stats.currentPrice;
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
    config, '/reservations', { per_page: '100', 'properties[]': propertyId },
  );

  const reservations = res?.data ?? [];
  let totalNights = 0;
  let count = 0;

  for (const r of reservations) {
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
    currentPrice: currentPrice || calStats.currentPrice || calStats.myADR,
    lastYearLowestSold: yearStats.lowestSoldPrice || calStats.lowestSoldPrice,
    avgBookingLength: avgBookingLength || undefined,
  };
}
