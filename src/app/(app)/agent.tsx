import { useCallback, useEffect, useRef, useState } from 'react';
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
  useColorScheme,
  View,
} from 'react-native';
// SDK 54 moved writeAsStringAsync/EncodingType to a "legacy" subpath; the
// new default export uses a different File/Directory class API. Using the
// legacy import keeps this simple file-write working without a rewrite.
import {
  AudioModule,
  RecordingPresets,
  useAudioPlayer,
  useAudioRecorder,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';

import { voiceOrder, voiceOrderFromText, type VoiceOrderResult } from '@/backend/supabase/voice';

/**
 * Push-to-talk AI tab.
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
 * A collapsible "Debug" panel shows the raw JSON the Edge Function returned
 * (transcript, parsed items, matched product/category/custom, push status)
 * so you can see exactly what happened in the backend without digging
 * through `supabase functions logs voice-order` — though that command shows
 * even more detail (the raw Grok response, Scribe errors, insert failures)
 * since the function also logs every stage with console.log/console.error.
 *
 * Uses expo-audio for recording (works in Expo Go, unlike the old ElevenLabs
 * WebRTC component or expo-speech-recognition, both of which need a secure
 * context / custom dev client). The clip is uploaded to the voice-order Edge
 * Function, which transcribes it (ElevenLabs Scribe) and asks Grok to
 * extract order items, writes them to the default list, and sends a push.
 */

type Phase = 'idle' | 'listening' | 'processing';

// Palette switches with the OS theme so text/inputs stay legible in both
// light and dark mode (previously hardcoded colors like black text were
// invisible on a dark background).
const PALETTE = {
  light: {
    bg: '#fff',
    text: '#111',
    hint: '#555',
    border: '#bbb',
    inputBg: '#f2f2f2',
    placeholder: '#888',
    debugBg: '#0000000d',
    debugText: '#111',
  },
  dark: {
    bg: '#000',
    text: '#f5f5f5',
    hint: '#aaa',
    border: '#555',
    inputBg: '#1c1c1e',
    placeholder: '#999',
    debugBg: '#ffffff14',
    debugText: '#f5f5f5',
  },
};

export default function AgentScreen() {
  const scheme = useColorScheme();
  const c = PALETTE[scheme === 'dark' ? 'dark' : 'light'];
  const [phase, setPhase] = useState<Phase>('idle');
  const [reply, setReply] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [permissionAsked, setPermissionAsked] = useState(false);
  const [typedText, setTypedText] = useState('');
  const [lastResult, setLastResult] = useState<VoiceOrderResult | { error: string } | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const replyPlayer = useAudioPlayer();

  // --- Wave animation (three rings pulsing outward while listening) ---
  const wave1 = useRef(new Animated.Value(0)).current;
  const wave2 = useRef(new Animated.Value(0)).current;
  const wave3 = useRef(new Animated.Value(0)).current;

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

  // --- Blob squish: a tap-feedback bounce plus a slow idle wobble so the
  // cow-spot shape feels alive instead of a static image. Built from three
  // overlapping circles whose scale/position are independently animated,
  // which reads as an amorphous blob without needing an SVG/path library. ---
  const squish = useRef(new Animated.Value(0)).current; // 0 = rest, 1 = pressed
  const wobbleA = useRef(new Animated.Value(0)).current;
  const wobbleB = useRef(new Animated.Value(0)).current;

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
    // iOS requires the audio session to be explicitly put into recording
    // mode before recorder.record() will succeed.
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
        // Write the returned mp3 to a temp file and play it with the
        // ElevenLabs voice instead of the OS's built-in TTS.
        const path = `${FileSystem.cacheDirectory}voice-reply-${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(path, result.replyAudioBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        replyPlayer.replace(path);
        replyPlayer.play();
      } else {
        // Server-side TTS failed — fall back to on-device TTS so there's
        // always some spoken confirmation.
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
    // ignore taps while processing
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
      contentContainerStyle={[styles.container, { backgroundColor: c.bg }]}
      style={{ backgroundColor: c.bg }}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: c.text }]}>Butter Voice Assistant</Text>
      <Text style={[styles.hint, { color: c.hint }]}>
        {phase === 'idle' ? 'Tap the spot, say what to add.' : ' '}
      </Text>

      <View style={styles.buttonWrap}>
        {phase === 'listening' && (
          <>
            <Animated.View style={[styles.ring, ringStyle(wave1)]} pointerEvents="none" />
            <Animated.View style={[styles.ring, ringStyle(wave2)]} pointerEvents="none" />
            <Animated.View style={[styles.ring, ringStyle(wave3)]} pointerEvents="none" />
          </>
        )}

        <Pressable onPress={onPressButton} disabled={phase === 'processing'} style={styles.talkButton}>
          {/* Animated blob: a base circle plus two overlapping "spot" circles
              that independently drift/scale (wobbleA/wobbleB), so the shape
              constantly deforms like a cow-print blob instead of sitting
              static. A quick squash-and-bounce (squish) plays on every tap. */}
          <Animated.View
            style={[
              styles.blobBase,
              phase === 'listening' && styles.blobBaseActive,
              { transform: [{ scaleX: blobSquashX }, { scaleY: blobSquashY }, { scale: blobScale }] },
            ]}>
            <Animated.View
              style={[
                styles.blobSpot,
                styles.blobSpotA,
                { transform: [...Object.values(spotTranslateA).map((v, i) => (i === 0 ? { translateX: v } : { translateY: v })), { scale: spotScaleA }] },
              ]}
            />
            <Animated.View
              style={[
                styles.blobSpot,
                styles.blobSpotB,
                { transform: [...Object.values(spotTranslateB).map((v, i) => (i === 0 ? { translateX: v } : { translateY: v })), { scale: spotScaleB }] },
              ]}
            />
          </Animated.View>

          {phase === 'processing' ? (
            <ActivityIndicator color="#fff" size="large" style={styles.spotOverlay} />
          ) : (
            <Text style={[styles.talkButtonLabel, styles.spotOverlay]}>{label}</Text>
          )}
        </Pressable>
      </View>

      {transcript && <Text style={[styles.transcript, { color: c.text }]}>“{transcript}”</Text>}
      {reply && <Text style={[styles.reply, { color: c.text }]}>{reply}</Text>}

      <View style={styles.typedRow}>
        <TextInput
          style={[styles.typedInput, { backgroundColor: c.inputBg, borderColor: c.border, color: c.text }]}
          placeholder="…or type what to add"
          placeholderTextColor={c.placeholder}
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
            (phase === 'processing' || !typedText.trim()) && styles.sendButtonDisabled,
            pressed && styles.talkButtonPressed,
          ]}>
          <Text style={styles.sendButtonLabel}>Send</Text>
        </Pressable>
      </View>

      <Pressable onPress={() => setDebugOpen((v) => !v)} style={styles.debugToggle}>
        <Text style={[styles.debugToggleLabel, { color: c.text }]}>
          {debugOpen ? '▼' : '▶'} Debug: what happened server-side
        </Text>
      </Pressable>
      {debugOpen && (
        <View style={[styles.debugBox, { backgroundColor: c.debugBg }]}>
          <Text style={[styles.debugText, { color: c.debugText }]}>
            {lastResult ? JSON.stringify(lastResult, null, 2) : 'No request sent yet.'}
          </Text>
          <Text style={[styles.debugHint, { color: c.hint }]}>
            More detail (Scribe/Grok/insert errors) is in `supabase functions logs voice-order`.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const RING_SIZE = 180;

const styles = StyleSheet.create({
  container: { flexGrow: 1, alignItems: 'center', padding: 24, gap: 16, paddingBottom: 48 },
  title: { fontSize: 20, fontWeight: '700' },
  hint: { textAlign: 'center', minHeight: 18 },
  buttonWrap: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  ring: {
    position: 'absolute',
    width: RING_SIZE,
    height: RING_SIZE,
    borderRadius: RING_SIZE / 2,
    borderWidth: 2,
    borderColor: '#c0392b',
  },
  talkButton: {
    width: RING_SIZE,
    height: RING_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blobBase: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RING_SIZE / 2,
    backgroundColor: '#fff8e7',
    overflow: 'hidden',
  },
  blobBaseActive: { backgroundColor: '#ffe0d6' },
  blobSpot: {
    position: 'absolute',
    width: RING_SIZE * 0.6,
    height: RING_SIZE * 0.6,
    borderRadius: RING_SIZE * 0.3,
    backgroundColor: '#1a1a1a',
  },
  blobSpotA: { top: RING_SIZE * 0.1, left: RING_SIZE * 0.08 },
  blobSpotB: { bottom: RING_SIZE * 0.05, right: RING_SIZE * 0.1, width: RING_SIZE * 0.45, height: RING_SIZE * 0.45, borderRadius: RING_SIZE * 0.225 },
  spotOverlay: { position: 'absolute' },
  talkButtonPressed: { opacity: 0.85 },
  talkButtonLabel: { color: '#fff', fontWeight: '700', textAlign: 'center', paddingHorizontal: 12 },
  transcript: { marginTop: 24, fontStyle: 'italic', textAlign: 'center' },
  reply: { marginTop: 8, textAlign: 'center', fontWeight: '500' },
  typedRow: { flexDirection: 'row', width: '100%', gap: 8, marginTop: 24 },
  typedInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendButton: {
    backgroundColor: '#c0392b',
    borderRadius: 12,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
  sendButtonLabel: { color: '#fff', fontWeight: '700' },
  debugToggle: { marginTop: 32, alignSelf: 'stretch' },
  debugToggleLabel: { fontWeight: '600', opacity: 0.7 },
  debugBox: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    width: '100%',
  },
  debugText: { fontFamily: 'monospace', fontSize: 12 },
  debugHint: { fontSize: 11, opacity: 0.6, marginTop: 8 },
});
