import { Stack } from 'expo-router';

import { AppProfileProvider } from '@/auth/app-profile';

// Shared native header for screens opened from the Plan tab's toolbar.
const panelHeader = { headerShown: true, headerBackTitle: 'Plan' } as const;

// Tabs live in (tabs); screens pushed from a tab (staples, recipe import) stack on top.
export default function AppLayout() {
  return (
    <AppProfileProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: 'transparent' },
        }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="staples" options={{ ...panelHeader, title: 'Staples' }} />
        <Stack.Screen name="recipe-import" options={{ ...panelHeader, title: 'Import recipe' }} />
        <Stack.Screen name="groups" options={{ ...panelHeader, title: 'Groups' }} />
      </Stack>
    </AppProfileProvider>
  );
}