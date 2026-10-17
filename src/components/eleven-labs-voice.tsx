
'use dom';

import { ConversationProvider, useConversation } from '@elevenlabs/react';
import { useState } from 'react';

type Props = {
  agentId: string;
  dom?: import('expo/dom').DOMProps;
};

export default function ElevenLabsVoice({ agentId }: Props) {
  return (
    <ConversationProvider>
      <VoiceControls agentId={agentId} />
    </ConversationProvider>
  );
}

function VoiceControls({ agentId }: { agentId: string }) {
  const [error, setError] = useState('');

  const conversation = useConversation({
    onError: (err) => {
      console.error('ElevenLabs SDK error:', err);
      setError(String(err));
    },
  });

  async function toggleConversation() {
    setError('');

    try {
      if (conversation.status === 'connected') {
        await conversation.endSession();
        return;
      }

      if (!agentId || !agentId.startsWith('agent_')) {
        throw new Error('Agent ID is missing or invalid.');
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
            `Microphone API unavailable. Secure context: ${window.isSecureContext}; URL: ${window.location.href}`
        );
    }

      await navigator.mediaDevices.getUserMedia({ audio: true });
      await conversation.startSession({ agentId });
    } catch (err) {
      console.error('Failed to start ElevenLabs conversation:', err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: 'sans-serif' }}>
      <h2>Butter Voice Assistant</h2>
      <p>Status: {conversation.status}</p>

      <button onClick={toggleConversation}>
        {conversation.status === 'connected'
          ? 'End conversation'
          : 'Start conversation'}
      </button>

      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  );
}
