import { Redirect } from 'expo-router';

/** Cart merged into Plan — keep route for old links / guest CTAs. */
export default function CartScreen() {
  return <Redirect href="/list" />;
}
