import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from './client';
import { fail } from '../errors';
import { unwrapVoid } from './query';

/**
 * Registers this device's Expo push token. The token is only an address.
 * The database does not store notification history. Call this after the user
 * grants notification permission and again on later launches because tokens rotate.
 */
export async function registerPushToken(): Promise<string | null> {
  if (!Device.isDevice) return null;
  const permission = await Notifications.getPermissionsAsync();
  const granted =
    permission.granted ||
    (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) return null;

  const expoToken = await Notifications.getExpoPushTokenAsync();
  const user = await supabase.auth.getUser();
  if (!user.data.user) fail('Sign in before registering for notifications.');

  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
  unwrapVoid(
    await supabase
      .from('push_tokens')
      .delete()
      .eq('user_id', user.data.user.id)
      .eq('platform', platform),
  );
  unwrapVoid(
    await supabase.from('push_tokens').insert({
      user_id: user.data.user.id,
      token: expoToken.data,
      platform,
    }),
  );
  return expoToken.data;
}

/** Removes one device token so a signed-out device stops receiving pushes. */
export async function removePushToken(token: string): Promise<void> {
  const user = await supabase.auth.getUser();
  if (!user.data.user) fail('Sign in before removing a notification token.');
  unwrapVoid(
    await supabase.from('push_tokens').delete().eq('user_id', user.data.user.id).eq('token', token),
  );
}

/**
 * Asks the reminder function to push the group that a draft order is ready for
 * the payer to confirm. Delivery is best-effort and no notification row is stored.
 */
export async function sendOrderConfirmationPush(orderId: string): Promise<void> {
  const result = await supabase.functions.invoke('send-due-reminders', {
    body: { kind: 'confirm-order', orderId },
  });
  if (result.error) fail(result.error, 'Could not send the confirmation notification.');
}
