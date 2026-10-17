import {
  ComicNeue_400Regular,
  ComicNeue_700Bold,
  useFonts,
} from '@expo-google-fonts/comic-neue';
import { requireOptionalNativeModule } from 'expo';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { SessionProvider, useSession } from '@/auth/session';

SplashScreen.preventAutoHideAsync();

// Hide Expo's floating tools button (dev menu: reload, go home, etc.)
const DevMenuPreferences = requireOptionalNativeModule<{
  setPreferencesAsync: (settings: { showFloatingActionButton: boolean }) => Promise<void>;
}>('DevMenuPreferences');
void DevMenuPreferences?.setPreferencesAsync({ showFloatingActionButton: false });

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded, fontError] = useFonts({
    ComicNeue_400Regular,
    ComicNeue_700Bold,
  });

  return (
    <SessionProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <SplashScreenController fontsReady={fontsLoaded || !!fontError} />
        {fontsLoaded || fontError ? <RootNavigator /> : null}
      </ThemeProvider>
    </SessionProvider>
  );
}

function SplashScreenController({ fontsReady }: { fontsReady: boolean }) {
  const { isLoading } = useSession();

  useEffect(() => {
    if (!isLoading && fontsReady) {
      void SplashScreen.hideAsync();
    }
  }, [isLoading, fontsReady]);

  return null;
}

function RootNavigator() {
  const { session, isLoading } = useSession();

  if (isLoading) {
    return null;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}
