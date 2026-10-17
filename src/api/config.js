// src/api/config.js
import { Platform } from "react-native";

// Android emulators can't reach your computer via "localhost";
// they use the special address 10.0.2.2 instead.
const DEV_HOST = Platform.OS === "android" ? "10.0.2.2" : "localhost";

export const BACKEND_URL = __DEV__
  ? `http://${DEV_HOST}:3000`
  : "https://your-deployed-backend.com";