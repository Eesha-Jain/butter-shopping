import { Pressable, StyleSheet, Text, View } from 'react-native';

import ElevenLabsVoice from '@/components/eleven-labs-voice';
import { useRequireAccount } from '@/auth/require-account';
import { useSession } from '@/auth/session';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function AgentScreen() {
  const theme = useTheme();
  const { session } = useSession();
  const requireAccount = useRequireAccount();
  const agentId = process.env.EXPO_PUBLIC_AGENT_ID;

  if (!session) {
    return (
      <View style={styles.gate}>
        <Text style={[styles.gateTitle, { color: theme.text }]}>Butter AI</Text>
        <Text style={[styles.gateBody, { color: theme.textSecondary }]}>
          Create an account to chat with the shopping assistant.
        </Text>
        <Pressable
          onPress={() => {
            requireAccount('Sign up or log in to use Butter AI.');
          }}
          style={({ pressed }) => [
            styles.cta,
            { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
          ]}>
          <Text style={[styles.ctaLabel, { color: theme.primaryText }]}>Sign up</Text>
        </Pressable>
      </View>
    );
  }

  if (!agentId) {
    return <Text>Missing ElevenLabs Agent ID in .env</Text>;
  }

  return (
    <View style={{ flex: 1 }}>
      <ElevenLabsVoice agentId={agentId} dom={{ scrollEnabled: false }} />
    </View>
  );
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.two,
  },
  gateTitle: {
    fontFamily: Fonts.sansBold,
    fontSize: 24,
  },
  gateBody: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: Spacing.two,
  },
  cta: {
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.five,
    paddingVertical: Spacing.three,
  },
  ctaLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: 16,
  },
});
