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

import { runAction, showSuccessToast, signIn, signInWithGoogle, signUp } from '@/backend';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type AuthMode = 'signUp' | 'logIn';

type AuthFormProps = {
  initialMode?: AuthMode;
};

const FONT_REGULAR = 'ComicNeue_400Regular';
const FONT_BOLD = 'ComicNeue_700Bold';

export function AuthForm({ initialMode = 'signUp' }: AuthFormProps) {
  const theme = useTheme();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [emailError, setEmailError] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const title = mode === 'signUp' ? 'Sign Up' : 'Log In';

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
          }
        } else {
          await signIn({ email: nextEmail, password });
        }
      });
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
    } catch {
      // runAction already toasts
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          bounces={false}>
          <View style={styles.frame}>
            <View style={styles.header}>
              <Image
                source={require('@/assets/images/logo.png')}
                style={styles.logo}
                contentFit="contain"
              />
              <Text style={[styles.title, { color: theme.text }]}>{title}</Text>
            </View>

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
                        backgroundColor: theme.background,
                        borderColor: theme.primary,
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
                      backgroundColor: theme.background,
                      borderColor: emailError ? theme.borderError : theme.primary,
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
                      backgroundColor: theme.background,
                      borderColor: passwordError ? theme.borderError : theme.primary,
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

              <Pressable
                disabled={busy}
                onPress={onContinue}
                style={({ pressed }) => [
                  styles.button,
                  {
                    backgroundColor: theme.primary,
                    opacity: busy ? 0.6 : pressed ? 0.85 : 1,
                  },
                ]}>
                <Text style={[styles.buttonLabel, { color: theme.primaryText }]}>
                  {busy ? 'Working…' : 'Continue'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.dividerRow}>
              <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
              <Text style={[styles.or, { color: theme.textSecondary }]}>OR</Text>
              <View style={[styles.dividerLine, { backgroundColor: theme.border }]} />
            </View>

            <Pressable
              disabled={busy}
              onPress={onGoogle}
              style={({ pressed }) => [
                styles.googleButton,
                {
                  backgroundColor: theme.background,
                  borderColor: theme.text,
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
          </View>
        </ScrollView>
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
  frame: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.five,
    gap: Spacing.three,
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
    fontFamily: FONT_BOLD,
    fontSize: 36,
    textAlign: 'center',
  },
  fields: {
    gap: Spacing.two,
  },
  field: {
    gap: Spacing.one,
  },
  label: {
    fontFamily: FONT_REGULAR,
    fontSize: 14,
  },
  input: {
    fontFamily: FONT_REGULAR,
    fontSize: 16,
    borderWidth: 2,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  error: {
    fontFamily: FONT_REGULAR,
    fontSize: 13,
  },
  terms: {
    fontFamily: FONT_REGULAR,
    fontSize: 13,
    marginTop: Spacing.one,
  },
  button: {
    marginTop: Spacing.two,
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  buttonLabel: {
    fontFamily: FONT_BOLD,
    fontSize: 16,
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
    fontFamily: FONT_REGULAR,
    fontSize: 13,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    borderWidth: 1,
    borderRadius: Radius.button,
    paddingVertical: Spacing.three,
  },
  googleLogo: {
    width: 20,
    height: 20,
  },
  googleLabel: {
    fontFamily: FONT_BOLD,
    fontSize: 16,
  },
  linkWrap: {
    alignItems: 'center',
    paddingVertical: Spacing.one,
  },
  link: {
    fontFamily: FONT_REGULAR,
    fontSize: 13,
    textDecorationLine: 'underline',
  },
});
