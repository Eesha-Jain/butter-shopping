import * as Location from 'expo-location';

import type { NearbyStore } from '../types';
import { nearbyShops } from './catalog';
import { listMyLocations } from './profiles';

const NEARBY_RADIUS_KM = 10;

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
