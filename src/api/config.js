// src/api/config.js
import { Platform } from "react-native";

// Android emulators can't reach your computer via "localhost";
// they use the special address 10.0.2.2 instead.
const DEV_HOST = Platform.OS === "android" ? "10.0.2.2" : "localhost";

const PROD_BACKEND =
  process.env.EXPO_PUBLIC_BACKEND_URL || "https://your-deployed-backend.com";

// EXPO_PUBLIC_APP_ENV = "dev" (local server) or "prod" (deployed backend).
// If unset, falls back to __DEV__.
const APP_ENV = (process.env.EXPO_PUBLIC_APP_ENV || "").trim().toLowerCase();
const USE_PROD = APP_ENV ? APP_ENV === "prod" : !__DEV__;

export const BACKEND_URL = USE_PROD ? PROD_BACKEND : `http://${DEV_HOST}:3000`;

/** UW Seattle campus default when the shopper has no saved ZIP. */
export const CAMPUS_DEFAULT_ZIP = "98195";