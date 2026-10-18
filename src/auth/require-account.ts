import { Alert } from 'react-native';

import { useSession } from './session';

/**
 * Returns a function that allows the action when signed in, otherwise prompts
 * the guest to create an account (exits guest mode → auth screen).
 */
export function useRequireAccount() {
  const { session, requestSignIn } = useSession();

  return (message: string): boolean => {
    if (session) return true;

    Alert.alert('Create an account', message, [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Sign up',
        onPress: () => {
          requestSignIn();
        },
      },
    ]);
    return false;
  };
}
