import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  AudioModule,
  RecordingPresets,
  useAudioPlayer,
  useAudioRecorder,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';

import { voiceOrder, voiceOrderFromText, type VoiceOrderResult } from '@/backend/supabase/voice';
import { useRequireAccount } from '@/auth/require-account';
import { useSession } from '@/auth/session';
import { ButterButton } from '@/components/ui/butter-button';
import { Fonts, Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Phase = 'idle' | 'listening' | 'processing';

export default function AgentScreen() {
  const { session } = useSession();
  const requireAccount = useRequireAccount();
  const theme = useTheme();

  // Gate the whole screen behind an account, same as main — the backend
  // edge function requires an authenticated user anyway (it writes to the
  // caller's list and reads their push tokens), so show a clean sign-up
  // prompt instead of letting an unauthenticated user hit a confusing error.
  if (!session) {
    return (
      <View style={[styles.gate, { backgroundColor: theme.background }]}>
        <Text style={[styles.gateTitle, { color: theme.text }]}>Butter AI</Text>
        <Text style={[styles.gateBody, { color: theme.textSecondary }]}>
          Create an account to chat with the shopping assistant.
        </Text>
        <ButterButton
          label="Sign up"
          variant="ink"
          onPress={() => requireAccount('Sign up or log in to use Butter AI.')}
        />
      </View>
    );
  }

  return <VoiceAgent />;
}

/**
 * Push-to-talk AI tab (shown once the user is signed in).
 *
 * Interaction: TAP once to start listening (it keeps recording on its own,
 * no need to hold) -> animated wave rings pulse while listening -> TAP again
 * to stop and send -> spinner shows while the server transcribes/parses ->
 * a short "Got it" voice confirmation plays and the reply text appears.
 *
 * A text box below the button sends typed text through the exact same
 * pipeline (skipping transcription) — useful on the simulator, when the mic
 * is inconvenient, or to test the Grok-parsing/Supabase/push steps directly.
 *
 * A collapsible "Debug" panel shows the raw JSON the Edge Function returned.
 *
 * Uses expo-audio for recording (works in Expo Go, unlike the old ElevenLabs
 * WebRTC component or expo-speech-recognition, both of which need a secure
 * context / custom dev client). The clip is uploaded to the voice-order Edge
 * Function, which transcribes it (ElevenLabs Scribe) and asks Grok to
 * extract order items, writes them to the default list, and sends a push.
 */
function VoiceAgent() {
  const theme = useTheme();
  const [phase, setPhase] = useState<Phase>('idle');
  const [reply, setReply] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [permissionAsked, setPermissionAsked] = useState(false);
  const [typedText, setTypedText] = useState('');
  const [lastResult, setLastResult] = useState<VoiceOrderResult | { error: string } | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const replyPlayer = useAudioPlayer();

  const [wave1] = useState(() => new Animated.Value(0));
  const [wave2] = useState(() => new Animated.Value(0));
  const [wave3] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (phase !== 'listening') {
      wave1.setValue(0);
      wave2.setValue(0);
      wave3.setValue(0);
      return;
    }
    const makeLoop = (val: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(val, {
            toValue: 1,
            duration: 1400,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(val, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      );
    const loops = [makeLoop(wave1, 0), makeLoop(wave2, 450), makeLoop(wave3, 900)];
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [phase, wave1, wave2, wave3]);

  const ringStyle = (val: Animated.Value) => ({
    opacity: val.interpolate({ inputRange: [0, 0.8, 1], outputRange: [0.55, 0.15, 0] }),
    transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [1, 2.1] }) }],
  });

  const [squish] = useState(() => new Animated.Value(0));
  const [wobbleA] = useState(() => new Animated.Value(0));
  const [wobbleB] = useState(() => new Animated.Value(0));

  useEffect(() => {
    const loopA = Animated.loop(
      Animated.sequence([
        Animated.timing(wobbleA, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(wobbleA, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    const loopB = Animated.loop(
      Animated.sequence([
        Animated.delay(700),
        Animated.timing(wobbleB, { toValue: 1, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(wobbleB, { toValue: 0, duration: 1900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loopA.start();
    loopB.start();
    return () => {
      loopA.stop();
      loopB.stop();
    };
  }, [wobbleA, wobbleB]);

  const popSquish = useCallback(() => {
    Animated.sequence([
      Animated.timing(squish, { toValue: 1, duration: 90, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.spring(squish, { toValue: 0, friction: 3.5, tension: 120, useNativeDriver: true }),
    ]).start();
  }, [squish]);

  const blobScale = squish.interpolate({ inputRange: [0, 1], outputRange: [1, 0.86] });
  const blobSquashX = squish.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const blobSquashY = squish.interpolate({ inputRange: [0, 1], outputRange: [1, 0.88] });
  const spotTranslateA = {
    translateX: wobbleA.interpolate({ inputRange: [0, 1], outputRange: [-6, 8] }),
    translateY: wobbleA.interpolate({ inputRange: [0, 1], outputRange: [6, -7] }),
  };
  const spotScaleA = wobbleA.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] });
  const spotTranslateB = {
    translateX: wobbleB.interpolate({ inputRange: [0, 1], outputRange: [10, -9] }),
    translateY: wobbleB.interpolate({ inputRange: [0, 1], outputRange: [-8, 5] }),
  };
  const spotScaleB = wobbleB.interpolate({ inputRange: [0, 1], outputRange: [1.05, 0.9] });

  const ensurePermission = useCallback(async () => {
    if (permissionAsked) {
      await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      return true;
    }
    const result = await AudioModule.requestRecordingPermissionsAsync();
    setPermissionAsked(true);
    if (!result.granted) {
      Alert.alert('Microphone needed', 'Allow microphone access to use push to talk.');
      return false;
    }
    await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    return true;
  }, [permissionAsked]);

  const startListening = useCallback(async () => {
    const ok = await ensurePermission();
    if (!ok) return;
    setReply(null);
    setTranscript(null);
    await recorder.prepareToRecordAsync();
    recorder.record();
    setPhase('listening');
  }, [ensurePermission, recorder]);

  const applyResult = useCallback(
    async (result: VoiceOrderResult) => {
      setTranscript(result.transcript);
      setReply(result.reply);
      setLastResult(result);

      if (result.replyAudioBase64) {
        const path = `${FileSystem.cacheDirectory}voice-reply-${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(path, result.replyAudioBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        replyPlayer.replace(path);
        replyPlayer.play();
      } else {
        Speech.speak(result.reply || 'Got it', { rate: 1.05, pitch: 1.05 });
      }
    },
    [replyPlayer],
  );

  const stopAndSend = useCallback(async () => {
    setPhase('processing');
    await recorder.stop();
    const uri = recorder.uri;

    if (!uri) {
      setReply("I didn't catch anything. Try again?");
      setPhase('idle');
      return;
    }

    try {
      const result = await voiceOrder(uri);
      await applyResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setReply(message);
      setLastResult({ error: message });
    } finally {
      setPhase('idle');
    }
  }, [recorder, applyResult]);

  const onPressButton = useCallback(() => {
    popSquish();
    if (phase === 'idle') startListening();
    else if (phase === 'listening') stopAndSend();
  }, [phase, startListening, stopAndSend, popSquish]);

  const sendTyped = useCallback(async () => {
    const text = typedText.trim();
    if (!text || phase === 'processing') return;
    setPhase('processing');
    setReply(null);
    setTranscript(null);
    try {
      const result = await voiceOrderFromText(text);
      await applyResult(result);
      setTypedText('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setReply(message);
      setLastResult({ error: message });
    } finally {
      setPhase('idle');
    }
  }, [typedText, phase, applyResult]);

  const label =
    phase === 'processing' ? 'Thinking…' : phase === 'listening' ? 'Listening… tap to stop' : 'Tap to talk';

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { backgroundColor: theme.background }]}
      style={{ backgroundColor: theme.background }}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: theme.text }]}>Butter AI</Text>
      <Text style={[styles.hint, { color: theme.textSecondary }]}>
        {phase === 'idle' ? 'Tap the spot, say what to add.' : ' '}
      </Text>

      <View style={styles.buttonWrap}>
        {phase === 'listening' && (
          <>
            <Animated.View
              style={[styles.ring, { borderColor: theme.primary }, ringStyle(wave1)]}
              pointerEvents="none"
            />
            <Animated.View
              style={[styles.ring, { borderColor: theme.primary }, ringStyle(wave2)]}
              pointerEvents="none"
            />
            <Animated.View
              style={[styles.ring, { borderColor: theme.primary }, ringStyle(wave3)]}
              pointerEvents="none"
            />
          </>
        )}

        <Pressable onPress={onPressButton} disabled={phase === 'processing'} style={styles.talkButton}>
          <Animated.View
            style={[
              styles.blobBase,
              {
                backgroundColor:
                  phase === 'listening' ? theme.backgroundSelected : theme.backgroundElement,
                borderColor: theme.borderInk,
              },
              { transform: [{ scaleX: blobSquashX }, { scaleY: blobSquashY }, { scale: blobScale }] },
            ]}>
            <Animated.View
              style={[
                styles.blobSpot,
                styles.blobSpotA,
                { backgroundColor: theme.secondary },
                {
                  transform: [
                    ...Object.values(spotTranslateA).map((v, i) =>
                      i === 0 ? { translateX: v } : { translateY: v },
                    ),
                    { scale: spotScaleA },
                  ],
                },
              ]}
            />
            <Animated.View
              style={[
                styles.blobSpot,
                styles.blobSpotB,
                { backgroundColor: theme.secondary },
                {
                  transform: [
                    ...Object.values(spotTranslateB).map((v, i) =>
                      i === 0 ? { translateX: v } : { translateY: v },
                    ),
                    { scale: spotScaleB },
                  ],
                },
              ]}
            />
          </Animated.View>

          {phase === 'processing' ? (
            <ActivityIndicator color={theme.primary} size="large" style={styles.spotOverlay} />
          ) : (
            <Text style={[styles.talkButtonLabel, styles.spotOverlay, { color: theme.primary }]}>
              {label}
            </Text>
          )}
        </Pressable>
      </View>

      {transcript ? (
        <Text style={[styles.transcript, { color: theme.text }]}>“{transcript}”</Text>
      ) : null}
      {reply ? <Text style={[styles.reply, { color: theme.text }]}>{reply}</Text> : null}

      <View style={styles.typedRow}>
        <TextInput
          style={[
            styles.typedInput,
            {
              backgroundColor: theme.backgroundElement,
              borderColor: theme.borderInk,
              color: theme.text,
            },
          ]}
          placeholder="…or type what to add"
          placeholderTextColor={theme.textSecondary}
          value={typedText}
          onChangeText={setTypedText}
          onSubmitEditing={sendTyped}
          editable={phase !== 'processing'}
          returnKeyType="send"
        />
        <Pressable
          onPress={sendTyped}
          disabled={phase === 'processing' || !typedText.trim()}
          style={({ pressed }) => [
            styles.sendButton,
            { backgroundColor: theme.secondary },
            (phase === 'processing' || !typedText.trim()) && styles.sendButtonDisabled,
            pressed && styles.talkButtonPressed,
          ]}>
          <Text style={[styles.sendButtonLabel, { color: theme.primary }]}>Send</Text>
        </Pressable>
      </View>

      <Pressable onPress={() => setDebugOpen((v) => !v)} style={styles.debugToggle}>
        <Text style={[styles.debugToggleLabel, { color: theme.text }]}>
          {debugOpen ? '▼' : '▶'} Debug: what happened server-side
        </Text>
      </Pressable>
      {debugOpen ? (
        <View style={[styles.debugBox, { backgroundColor: theme.backgroundElement }]}>
          <Text style={[styles.debugText, { color: theme.text }]}>
            {lastResult ? JSON.stringify(lastResult, null, 2) : 'No request sent yet.'}
          </Text>
          <Text style={[styles.debugHint, { color: theme.textSecondary }]}>
            More detail (Scribe/Grok/insert errors) is in `supabase functions logs voice-order`.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const RING_SIZE = 180;

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    padding: Spacing.four,
    gap: Spacing.three,
    paddingBottom: Spacing.five,
  },
  title: {
    fontFamily: Fonts.sansBold,
    fontSize: Type.pageTitle,
  },
  hint: {
    fontFamily: Fonts.sans,
    textAlign: 'center',
    minHeight: 18,
  },
  buttonWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.four,
  },
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 2,
  },
  talkButton: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blobBase: {
    ...StyleSheet.absoluteFill,
    borderRadius: RING_SIZE / 2,
    overflow: 'hidden',
    borderWidth: 2,
  },
  blobSpot: {
    position: 'absolute',
    width: RING_SIZE * 0.6,
    height: RING_SIZE * 0.6,
    borderRadius: RING_SIZE * 0.3,
  },
  blobSpotA: { top: RING_SIZE * 0.1, left: RING_SIZE * 0.08 },
  blobSpotB: {
    bottom: RING_SIZE * 0.05,
    right: RING_SIZE * 0.1,
    width: RING_SIZE * 0.45,
    height: RING_SIZE * 0.45,
    borderRadius: RING_SIZE * 0.225,
  },
  spotOverlay: { position: 'absolute' },
  talkButtonPressed: { opacity: 0.85 },
  talkButtonLabel: {
    fontFamily: Fonts.sansBold,
    textAlign: 'center',
    paddingHorizontal: Spacing.three,
  },
  transcript: {
    marginTop: Spacing.four,
    fontFamily: Fonts.sans,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  reply: {
    marginTop: Spacing.two,
    fontFamily: Fonts.sansBold,
    textAlign: 'center',
  },
  typedRow: {
    flexDirection: 'row',
    width: '100%',
    gap: Spacing.two,
    marginTop: Spacing.four,
  },
  typedInput: {
    flex: 1,
    borderWidth: 2,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontFamily: Fonts.sans,
    fontSize: 16,
  },
  sendButton: {
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.four,
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonLabel: { fontFamily: Fonts.sansBold },
  debugToggle: { marginTop: Spacing.five, alignSelf: 'stretch' },
  debugToggleLabel: { fontFamily: Fonts.sansBold, opacity: 0.7 },
  debugBox: {
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Radius.card,
    width: '100%',
  },
  debugText: { fontFamily: Fonts.mono, fontSize: 12 },
  debugHint: { fontFamily: Fonts.sans, fontSize: 11, opacity: 0.6, marginTop: Spacing.two },
  gate: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
  },
  gateTitle: { fontFamily: Fonts.sansBold, fontSize: Type.pageTitle },
  gateBody: {
    fontFamily: Fonts.sans,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
});