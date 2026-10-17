import { Image } from 'expo-image';
import { Tabs } from 'expo-router';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: { backgroundColor: colors.background },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <Image
              source={require('@/assets/images/tabIcons/home.png')}
              style={{ width: 24, height: 24, tintColor: color }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="schedule"
        options={{
          title: 'schedule',
          tabBarIcon: ({ color }) => (
            <Image
              source={require('@/assets/images/tabIcons/explore.png')}
              style={{ width: 24, height: 24, tintColor: color }}
            />
          ),
        }}
      />
       <Tabs.Screen
        name="agent"
        options={{
          title: 'AI',
          tabBarIcon: ({ color }) => (
            <Image
              source={require('@/assets/images/tabIcons/agent.png')}
              style={{ width: 24, height: 24, tintColor: color }}
            />
          ),
        }}
      />
       <Tabs.Screen
        name="cart"
        options={{
          title: 'cart',
          tabBarIcon: ({ color }) => (
            <Image
              source={require('@/assets/images/tabIcons/cart.png')}
              style={{ width: 24, height: 24, tintColor: color }}
            />
          ),
        }}
      />
      
    </Tabs>
  );
}
