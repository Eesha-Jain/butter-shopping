import type { AuthMode } from '@/auth/auth-mode';
import { useSession } from '@/auth/session';
import { hasSignedInBefore } from '@/backend';
import { AuthForm } from '@/components/auth/auth-form';

export default function AuthScreen() {
  const { preferredAuthMode } = useSession();
  const fallback: AuthMode = hasSignedInBefore() ? 'logIn' : 'signUp';
  const initialMode = preferredAuthMode ?? fallback;
  return <AuthForm key={initialMode} initialMode={initialMode} />;
}
