// src/api/config.js
import { Platform } from "react-native";

// Android emulators can't reach your computer via "localhost";
// they use the special address 10.0.2.2 instead.
const DEV_HOST = Platform.OS === "android" ? "10.0.2.2" : "localhost";

const PROD_BACKEND =
  process.env.EXPO_PUBLIC_BACKEND_URL || "https://your-deployed-backend.com";

export const BACKEND_URL = __DEV__ ? `http://${DEV_HOST}:3000` : PROD_BACKEND;

/** UW Seattle campus default when the shopper has no saved ZIP. */
export const CAMPUS_DEFAULT_ZIP = "98195";