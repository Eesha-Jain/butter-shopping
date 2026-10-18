import * as Location from 'expo-location';

import { CAMPUS_DEFAULT_ZIP } from '../../api/config';
import type { NearbyStore } from '../types';
import { nearbyShops } from './catalog';
import { listMyLocations } from './profiles';

const NEARBY_RADIUS_KM = 10;

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

async function fallbackCoords(): Promise<{ latitude: number; longitude: number } | null> {
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

/** Shops within 10 km of the device, or of the saved default address if GPS is denied. */
export async function fetchNearbyShops(): Promise<NearbyStore[]> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  let latitude: number;
  let longitude: number;

  if (status === 'granted') {
    const { coords } = await Location.getCurrentPositionAsync({});
    latitude = coords.latitude;
    longitude = coords.longitude;
  } else {
    const saved = await fallbackCoords();
    if (!saved) {
      return [];
    }
    latitude = saved.latitude;
    longitude = saved.longitude;
  }

  return nearbyShops({ latitude, longitude, radiusKm: NEARBY_RADIUS_KM });
}
