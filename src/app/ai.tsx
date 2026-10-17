
import ElevenLabsVoice from '@/components/eleven-labs-voice';
import { StyleSheet, Text, View } from 'react-native';

export default function AIScreen() {
  const agentId = process.env.EXPO_PUBLIC_AGENT_ID;

  if (!agentId) {
    return (
      <View style={styles.container}>
        <Text>Missing EXPO_PUBLIC_AGENT_ID in .env</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ElevenLabsVoice
        agentId={agentId}
        dom={{ scrollEnabled: false }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
