import { AuthForm } from '@/components/auth/auth-form';
import { hasSignedInBefore } from '@/backend';

export default function AuthScreen() {
  const initialMode = hasSignedInBefore() ? 'logIn' : 'signUp';
  return <AuthForm initialMode={initialMode} />;
}
