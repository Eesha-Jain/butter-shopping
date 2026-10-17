
import ElevenLabsVoice from '@/components/eleven-labs-voice';
import { Text, View } from 'react-native';

export default function AIScreen() {
  const agentId = process.env.EXPO_PUBLIC_AGENT_ID;

  if (!agentId) {
    return <Text>Missing ElevenLabs Agent ID in .env</Text>;
  }

  return (
    <View style={{ flex: 1 }}>
      <ElevenLabsVoice
        agentId={agentId}
        dom={{ scrollEnabled: false }}
      />
    </View>
  );
}
