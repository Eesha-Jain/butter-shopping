
'use dom';

import { ConversationProvider, useConversation } from '@elevenlabs/react';

type Props = {
  agentId: string;
  dom: import('expo/dom').DOMProps;
};

export default function ElevenLabsVoice({ agentId, dom }: Props) {
  return (
    <ConversationProvider>
      <VoiceControls agentId={agentId} />
    </ConversationProvider>
  );
}

function VoiceControls({ agentId }: { agentId: string }) {
  const conversation = useConversation();

  async function toggleConversation() {
    try {
      if (conversation.status === 'connected') {
        await conversation.endSession();
      } else {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        await conversation.startSession({ agentId });
      }
    } catch (error) {
      console.error('ElevenLabs connection failed:', error);
      alert('Could not start voice chat. Check microphone permission and your Agent ID.');
    }
  }

  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      gap: 20,
      fontFamily: 'sans-serif',
      background: '#fff8f5',
      color: '#333',
      padding: 24,
    }}>
      <h1>Butter AI</h1>
      <p>
        {conversation.isSpeaking
          ? 'Butter is speaking...'
          : conversation.status === 'connected'
          ? 'Listening — tell Butter what you need.'
          : 'Ready to help with your grocery shopping.'}
      </p>
      <button
        onClick={toggleConversation}
        style={{
          background: '#A02C55',
          color: 'white',
          border: 'none',
          borderRadius: 14,
          padding: '16px 24px',
          fontSize: 16,
        }}
      >
        {conversation.status === 'connected'
          ? 'End conversation'
          : 'Start talking'}
      </button>
      <p>Status: {conversation.status}</p>
    </div>
  );
}
