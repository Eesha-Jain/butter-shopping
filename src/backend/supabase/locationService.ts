import * as Location from 'expo-location';

import { CAMPUS_DEFAULT_ZIP } from '../../api/config';
import type { NearbyStore } from '../types';
import { supabase } from './client';
import { listMyLocations } from './profiles';
import { unwrap } from './query';

const NEARBY_RADIUS_KM = 10;
const KM_PER_DEGREE = 111.32;

export type SearchCoords = { latitude: number; longitude: number };

function fiveDigitZip(value: string | null | undefined): string | null {
  const match = String(value ?? '').match(/\b(\d{5})\b/);
  return match?.[1] ?? null;
}

/**
 * ZIP for retailer price ingest. Prefers a saved location postal code, then
 * reverse-geocodes GPS when permission allows, else campus default 98195.
 */
export async function resolveShopZip(): Promise<string> {
  try {
    const locations = await listMyLocations();
    const preferred = locations.find((row) => row.is_default);
    const ordered = preferred
      ? [preferred, ...locations.filter((row) => row.id !== preferred.id)]
      : locations;
    for (const row of ordered) {
      const zip = fiveDigitZip(row.postal_code);
      if (zip) return zip;
    }
  } catch {
    // Guests or signed-out callers may not have locations.
  }

  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const { coords } = await Location.getCurrentPositionAsync({});
      const places = await Location.reverseGeocodeAsync({
        latitude: coords.latitude,
        longitude: coords.longitude,
      });
      for (const place of places) {
        const zip = fiveDigitZip(place.postalCode);
        if (zip) return zip;
      }
    }
  } catch {
    // Fall through to campus default.
  }

  return CAMPUS_DEFAULT_ZIP;
}

export async function getUserCoords() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location permission not granted');
  }

  const location = await Location.getCurrentPositionAsync({});
  return location.coords;
}

async function fallbackCoords(): Promise<SearchCoords | null> {
  try {
    const locations = await listMyLocations();
    const home = locations.find((row) => row.is_default) ?? locations[0];
    if (home?.latitude == null || home?.longitude == null) {
      return null;
    }
    return { latitude: home.latitude, longitude: home.longitude };
  } catch {
    return null;
  }
}

async function gpsCoords(): Promise<SearchCoords | null> {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      return null;
    }
    const { coords } = await Location.getCurrentPositionAsync({});
    return { latitude: coords.latitude, longitude: coords.longitude };
  } catch {
    return null;
  }
}

/**
 * Saved default map pin when present, otherwise device GPS.
 * Pass followGps to ignore the saved pin for this call (Use GPS on Nearby).
 */
export async function resolveSearchCoords(options?: {
  followGps?: boolean;
}): Promise<SearchCoords | null> {
  if (!options?.followGps) {
    const saved = await fallbackCoords();
    if (saved) return saved;
  }
  const gps = await gpsCoords();
  if (gps) return gps;
  return options?.followGps ? fallbackCoords() : null;
}

function distanceKm(from: SearchCoords, latitude: number, longitude: number): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(latitude - from.latitude);
  const dLng = toRad(longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.latitude)) * Math.cos(toRad(latitude)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Shops within 10 km of the given origin, or of resolveSearchCoords() when omitted.
 * Map pins use store coordinates even when the store has no priced products yet.
 */
export async function fetchNearbyShops(origin?: SearchCoords | null): Promise<NearbyStore[]> {
  const coords = origin === undefined ? await resolveSearchCoords() : origin;
  if (!coords) {
    return [];
  }

  const latDelta = NEARBY_RADIUS_KM / KM_PER_DEGREE;
  const cosLat = Math.max(Math.cos((coords.latitude * Math.PI) / 180), 0.01);
  const lngDelta = NEARBY_RADIUS_KM / (KM_PER_DEGREE * cosLat);

  const rows = unwrap(
    await supabase
      .from('stores')
      .select(
        'id, name, chain_id, college_id, address_line1, city, region, postal_code, latitude, longitude, accepts_snap',
      )
      .not('latitude', 'is', null)
      .not('longitude', 'is', null)
      .gte('latitude', coords.latitude - latDelta)
      .lte('latitude', coords.latitude + latDelta)
      .gte('longitude', coords.longitude - lngDelta)
      .lte('longitude', coords.longitude + lngDelta),
  );

  return rows
    .flatMap((row) => {
      if (row.latitude == null || row.longitude == null) {
        return [];
      }
      const km = distanceKm(coords, row.latitude, row.longitude);
      if (km > NEARBY_RADIUS_KM) {
        return [];
      }
      return [{ ...row, distance_km: km }];
    })
    .sort((a, b) => Number(a.distance_km) - Number(b.distance_km));
}
