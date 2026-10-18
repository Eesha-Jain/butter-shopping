import { Redirect } from 'expo-router';

/** Days merged into Plan — keep route for old links. */
export default function DaysScreen() {
  return <Redirect href="/list" />;
}
