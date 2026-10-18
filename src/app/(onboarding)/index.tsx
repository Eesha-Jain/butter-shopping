import { Redirect, type Href } from 'expo-router';

import { useSession } from '@/auth/session';
import { hasSeenWelcome } from '@/backend';

import WelcomeScreen from './welcome';

/**
 * Entry into onboarding:
 * - Signed in / guest already → prefs (eat)
 * - First install → welcome (rendered here so it doesn't slide in from a redirect)
 * - Welcome already seen → auth
 */
export default function OnboardingIndex() {
  const { session, isGuest } = useSession();

  if (session || isGuest) {
    return <Redirect href={'/(onboarding)/eat' as Href} />;
  }
  if (!hasSeenWelcome()) {
    return <WelcomeScreen />;
  }
  return <Redirect href={'/(onboarding)/account' as Href} />;
}
