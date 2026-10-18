import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';

export default function AppTabs() {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'dark' ? 'dark' : 'light'];

  return (
    <NativeTabs
      backgroundColor={colors.background}
      indicatorColor={colors.primaryDark}
      tintColor={colors.primaryDark}
      iconColor={{ default: colors.textSecondary, selected: colors.primaryDark }}
      labelStyle={{
        color: colors.textSecondary,
        selected: { color: colors.primaryDark },
      }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Shop</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/home.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="nearby">
        <NativeTabs.Trigger.Label>Nearby</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="mappin.and.ellipse" md="location_on" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="list">
        <NativeTabs.Trigger.Label>List</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="checklist" md="format_list_bulleted" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="days">
        <NativeTabs.Trigger.Label>Days</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="calendar" md="calendar_month" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="agent">
        <NativeTabs.Trigger.Label>AI</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/agent.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="cart">
        <NativeTabs.Trigger.Label>Cart</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          src={require('@/assets/images/tabIcons/cart.png')}
          renderingMode="template"
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}