import {
  ComicNeue_400Regular,
  ComicNeue_700Bold,
  useFonts,
} from '@expo-google-fonts/comic-neue';
import { requireOptionalNativeModule } from 'expo';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo } from 'react';
import { ImageBackground, StyleSheet, useColorScheme } from 'react-native';

import { SessionProvider, useSession } from '@/auth/session';
import { Colors } from '@/constants/theme';

SplashScreen.preventAutoHideAsync();

// Hide Expo's floating tools button (dev menu: reload, go home, etc.)
const DevMenuPreferences = requireOptionalNativeModule<{
  setPreferencesAsync: (settings: { showFloatingActionButton: boolean }) => Promise<void>;
}>('DevMenuPreferences');
void DevMenuPreferences?.setPreferencesAsync({ showFloatingActionButton: false });

const transparentNavigationTheme = {
  light: {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      background: 'transparent',
    },
  },
  dark: {
    ...DarkTheme,
    colors: {
      ...DarkTheme.colors,
      background: 'transparent',
    },
  },
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [fontsLoaded, fontError] = useFonts({
    ComicNeue_400Regular,
    ComicNeue_700Bold,
  });
  const scheme = colorScheme === 'dark' ? 'dark' : 'light';
  const navigationTheme = useMemo(() => transparentNavigationTheme[scheme], [scheme]);

  return (
    <SessionProvider>
      <ThemeProvider value={navigationTheme}>
        <ImageBackground
          source={require('@/assets/images/background.png')}
          style={[styles.background, { backgroundColor: Colors[scheme].background }]}
          imageStyle={styles.backgroundImage}
          resizeMode="cover">
          <SplashScreenController fontsReady={fontsLoaded || !!fontError} />
          {fontsLoaded || fontError ? <RootNavigator /> : null}
        </ImageBackground>
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
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: 'transparent' },
      }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
  },
  backgroundImage: {
    opacity: 0.15,
  },
});
