import { Button, Column, Host, Row, Spacer, Text, TextInput } from '@expo/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { runAction, signIn, signInWithGoogle, signUp } from '@/backend';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type AuthMode = 'signUp' | 'logIn';

type AuthFormProps = {
  initialMode?: AuthMode;
};

export function AuthForm({ initialMode = 'signUp' }: AuthFormProps) {
  const theme = useTheme();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [emailError, setEmailError] = useState(false);
  const [passwordError, setPasswordError] = useState(false);
  const [busy, setBusy] = useState(false);

  const title = mode === 'signUp' ? 'Sign up' : 'Log in';
  const inputStyle = {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    backgroundColor: theme.background,
    width: '100%' as const,
  };
  const errorInputStyle = {
    ...inputStyle,
    borderColor: theme.borderError,
  };

  async function onContinue() {
    const nextEmail = email.trim();
    const missingEmail = !nextEmail;
    const missingPassword = !password;
    setEmailError(missingEmail);
    setPasswordError(missingPassword);
    if (missingEmail || missingPassword) return;

    setBusy(true);
    try {
      await runAction(async () => {
        if (mode === 'signUp') {
          await signUp({
            email: nextEmail,
            password,
            displayName: displayName.trim() || undefined,
          });
        } else {
          await signIn({ email: nextEmail, password });
        }
      });
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    setBusy(true);
    try {
      await runAction(() => signInWithGoogle());
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <View style={styles.frame}>
        <Host style={styles.host} matchContents={{ vertical: true }}>
          <Column spacing={Spacing.three}>
            <Text
              textStyle={{
                fontSize: 36,
                fontWeight: '700',
                color: theme.text,
              }}>
              {title}
            </Text>

            <Column spacing={Spacing.two}>
              {mode === 'signUp' ? (
                <Column spacing={Spacing.one}>
                  <Text textStyle={{ fontSize: 14, color: theme.textSecondary }}>Name</Text>
                  <TextInput
                    placeholder="Your name"
                    autoCapitalize="words"
                    defaultValue={displayName}
                    onChangeText={setDisplayName}
                    editable={!busy}
                    style={inputStyle}
                    textStyle={{ color: theme.text, fontSize: 16 }}
                    placeholderTextColor={theme.textSecondary}
                  />
                </Column>
              ) : null}

              <Column spacing={Spacing.one}>
                <Text textStyle={{ fontSize: 14, color: theme.textSecondary }}>Email</Text>
                <TextInput
                  placeholder="yourname@email.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  defaultValue={email}
                  onChangeText={(value) => {
                    setEmail(value);
                    if (emailError) setEmailError(false);
                  }}
                  editable={!busy}
                  style={emailError ? errorInputStyle : inputStyle}
                  textStyle={{ color: theme.text, fontSize: 16 }}
                  placeholderTextColor={theme.textSecondary}
                />
                {emailError ? (
                  <Text textStyle={{ fontSize: 13, color: theme.error }}>required</Text>
                ) : null}
              </Column>

              <Column spacing={Spacing.one}>
                <Text textStyle={{ fontSize: 14, color: theme.textSecondary }}>Password</Text>
                <TextInput
                  placeholder="Password"
                  secureTextEntry
                  defaultValue={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    if (passwordError) setPasswordError(false);
                  }}
                  editable={!busy}
                  style={passwordError ? errorInputStyle : inputStyle}
                  textStyle={{ color: theme.text, fontSize: 16 }}
                  placeholderTextColor={theme.textSecondary}
                />
                {passwordError ? (
                  <Text textStyle={{ fontSize: 13, color: theme.error }}>required</Text>
                ) : null}
              </Column>

              {mode === 'signUp' ? (
                <Text textStyle={{ fontSize: 13, color: theme.textSecondary }}>
                  By signing up, you agree to our terms of service.
                </Text>
              ) : null}

              <Button
                disabled={busy}
                onPress={onContinue}
                style={{
                  backgroundColor: theme.primary,
                  borderRadius: Radius.button,
                  paddingVertical: Spacing.three,
                }}>
                <Text textStyle={{ color: theme.primaryText, fontWeight: '700', fontSize: 16 }}>
                  {busy ? 'Working…' : 'Continue'}
                </Text>
              </Button>
            </Column>

            <Row spacing={Spacing.two} alignment="center">
              <Spacer />
              <Text textStyle={{ fontSize: 13, color: theme.textSecondary }}>OR</Text>
              <Spacer />
            </Row>

            <Button
              label="Continue with Google"
              variant="outlined"
              disabled={busy}
              onPress={onGoogle}
              style={{
                borderColor: theme.border,
                borderWidth: 1,
                borderRadius: Radius.button,
                paddingVertical: Spacing.three,
                backgroundColor: theme.background,
              }}
            />

            <Button
              label={
                mode === 'signUp' ? 'Already have an account? Log in' : 'Need an account? Sign up'
              }
              variant="text"
              disabled={busy}
              onPress={() => setMode(mode === 'signUp' ? 'logIn' : 'signUp')}
            />
          </Column>
        </Host>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  frame: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.five,
    justifyContent: 'center',
  },
  host: {
    width: '100%',
  },
});
