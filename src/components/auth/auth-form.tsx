import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AuthMode } from '@/auth/auth-mode';
import { useSession } from '@/auth/session';
import { runAction, showSuccessToast, signIn, signInWithGoogle, signUp } from '@/backend';
import { ButterButton } from '@/components/ui/butter-button';
import { Fonts, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type { AuthMode } from '@/auth/auth-mode';

type AuthFormProps = {
  initialMode?: AuthMode;
  /** Drop outer safe area / cream chrome when nested in onboarding. */
  embedded?: boolean;
  /** After a session is established (email or Google). */
  onAuthSuccess?: () => void | Promise<void>;
  /** After continue-as-guest (replaces default session guest entry when set). */
  onGuestContinue?: () => void | Promise<void>;
};

export function AuthForm({
  initialMode = 'signUp',
  embedded = false,
  onAuthSuccess,
  onGuestContinue,
}: AuthFormProps) {
  const theme = useTheme();
  const { continueAsGuest } = useSession();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [emailError, setEmailError] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const title = mode === 'signUp' ? 'Sign Up' : 'Log In';
  const fieldBg = embedded ? '#ffffff' : theme.background;

  async function onContinue() {
    if (busyRef.current) return;

    const nextEmail = email.trim();
    const missingEmail = !nextEmail;
    const missingPassword = !password;
    setEmailError(missingEmail);
    setPasswordError(missingPassword);
    if (missingEmail || missingPassword) return;

    busyRef.current = true;
    setBusy(true);
    try {
      let authenticated = false;
      await runAction(async () => {
        if (mode === 'signUp') {
          const result = await signUp({
            email: nextEmail,
            password,
            displayName: displayName.trim() || undefined,
          });
          if (!result.session) {
            showSuccessToast(
              'Check your email',
              'Open the link we sent to confirm your account, then log in.',
            );
            setMode('logIn');
            return;
          }
          authenticated = true;
        } else {
          await signIn({ email: nextEmail, password });
          authenticated = true;
        }
      });
      if (authenticated) await onAuthSuccess?.();
    } catch {
      // runAction already toasts AppError; swallow so promises stay handled
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onGoogle() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await runAction(() => signInWithGoogle());
      await onAuthSuccess?.();
    } catch {
      // runAction already toasts
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function onGuest() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (onGuestContinue) {
        await onGuestContinue();
      } else {
        continueAsGuest();
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const form = (
    <ScrollView
      contentContainerStyle={[styles.scrollContent, embedded && styles.scrollEmbedded]}
      keyboardShouldPersistTaps="handled"
      bounces={false}>
      <View style={[styles.frame, embedded && styles.frameEmbedded]}>
        {embedded ? (
          <Text style={[styles.titleEmbedded, { color: theme.text }]}>{title}</Text>
        ) : (
          <View style={styles.header}>
            <Image
              source={require('@/assets/images/logo.png')}
              style={styles.logo}
              contentFit="contain"
            />
            <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
          </View>
        )}

        <View style={styles.fields}>
          {mode === 'signUp' ? (
            <View style={styles.field}>
              <Text style={[styles.label, { color: theme.textSecondary }]}>Name</Text>
              <TextInput
                placeholder="Your name"
                autoCapitalize="words"
                value={displayName}
                onChangeText={setDisplayName}
                editable={!busy}
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.input,
                  {
                    backgroundColor: fieldBg,
                    borderColor: theme.borderInk,
                    color: theme.text,
                  },
                ]}
              />
            </View>
          ) : null}

          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>Email</Text>
            <TextInput
              placeholder="yourname@email.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                if (emailError) setEmailError(false);
              }}
              editable={!busy}
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                {
                  backgroundColor: fieldBg,
                  borderColor: emailError ? theme.borderError : theme.borderInk,
                  color: theme.text,
                },
              ]}
            />
            {emailError ? (
              <Text style={[styles.error, { color: theme.error }]}>required</Text>
            ) : null}
          </View>

          <View style={styles.field}>
            <Text style={[styles.label, { color: theme.textSecondary }]}>Password</Text>
            <TextInput
              placeholder="Password"
              secureTextEntry
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                if (passwordError) setPasswordError(false);
              }}
              editable={!busy}
              placeholderTextColor={theme.textSecondary}
              style={[
                styles.input,
                {
                  backgroundColor: fieldBg,
                  borderColor: passwordError ? theme.borderError : theme.borderInk,
                  color: theme.text,
                },
              ]}
            />
            {passwordError ? (
              <Text style={[styles.error, { color: theme.error }]}>required</Text>
            ) : null}
          </View>

          {mode === 'signUp' ? (
            <Text style={[styles.terms, { color: theme.textSecondary }]}>
              By signing up, you agree to our terms of service.
            </Text>
          ) : null}

          <ButterButton
            label={busy ? 'Working…' : 'Continue'}
            variant="ink"
            disabled={busy}
            onPress={() => void onContinue()}
            style={styles.button}
          />
        </View>

        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
          <Text style={[styles.or, { color: theme.textSecondary }]}>OR</Text>
          <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
        </View>

        <Pressable
          disabled={busy}
          onPress={() => void onGoogle()}
          style={({ pressed }) => [
            styles.googleButton,
            {
              backgroundColor: fieldBg,
              borderColor: theme.borderInk,
              opacity: busy ? 0.6 : pressed ? 0.85 : 1,
            },
          ]}>
          <Image
            source={require('@/assets/images/google-g.png')}
            style={styles.googleLogo}
            contentFit="contain"
          />
          <Text style={[styles.googleLabel, { color: theme.text }]}>Continue with Google</Text>
        </Pressable>

        <Pressable
          disabled={busy}
          onPress={() => setMode(mode === 'signUp' ? 'logIn' : 'signUp')}
          hitSlop={8}
          style={styles.linkWrap}>
          <Text style={[styles.link, { color: theme.textSecondary }]}>
            {mode === 'signUp' ? 'Already have an account? Log in' : 'Need an account? Sign up'}
          </Text>
        </Pressable>

        <Pressable
          disabled={busy}
          onPress={() => void onGuest()}
          hitSlop={8}
          style={styles.linkWrap}>
          <Text style={[styles.guestLink, { color: theme.textSecondary }]}>
            Continue as guest
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );

  if (embedded) {
    return <View style={styles.flex}>{form}</View>;
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {form}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  scrollEmbedded: {
    justifyContent: 'flex-start',
    paddingBottom: Spacing.two,
  },
  frame: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.three,
  },
  frameEmbedded: {
    paddingHorizontal: 0,
    paddingVertical: Spacing.one,
  },
  header: {
    alignItems: 'center',
    gap: Spacing.three,
    marginBottom: Spacing.one,
  },
  logo: {
    width: 88,
    height: 88,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: 36,
    textAlign: 'center',
  },
  titleEmbedded: {
    fontFamily: Fonts.sansBold,
    fontSize: 28,
    textAlign: 'center',
  },
  fields: {
    gap: Spacing.two,
  },
  field: {
    gap: Spacing.one,
  },
  label: {
    fontFamily: Fonts.sans,
    fontSize: 14,
  },
  input: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    borderWidth: 2,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  error: {
    fontFamily: Fonts.sans,
    fontSize: 13,
  },
  terms: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    marginTop: Spacing.one,
  },
  button: {
    marginTop: Spacing.two,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  or: {
    fontFamily: Fonts.sans,
    fontSize: 13,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: 2,
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
  },
  googleLogo: {
    width: 20,
    height: 20,
  },
  googleLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: 16,
  },
  linkWrap: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  link: {
    fontFamily: Fonts.sans,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
  guestLink: {
    fontFamily: Fonts.sans,
    fontSize: 14,
  },
});
