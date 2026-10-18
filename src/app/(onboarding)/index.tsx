import { Redirect, type Href } from 'expo-router';

export default function OnboardingIndex() {
  return <Redirect href={'/(onboarding)/welcome' as Href} />;
}
