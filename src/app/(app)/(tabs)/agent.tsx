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
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import {
  AudioModule,
  RecordingPresets,
  useAudioPlayer,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as Speech from 'expo-speech';

import {
  addListItem,
  getAiVoice,
  getMyDefaultList,
  isAiTextReplyAudioEnabled,
  openProductOnList,
  removeListItem,
  searchProducts,
  speakAssistant,
  updateListItem,
  voiceOrder,
  voiceOrderFromText,
  type VoiceOrderPhrases,
  type VoiceOrderResult,
  type VoiceOrderSplit,
} from '@/backend';
import { useRequireAccount } from '@/auth/require-account';
import { useSession } from '@/auth/session';
import { BottomTabInset, Fonts, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Phase = 'idle' | 'listening' | 'processing';

type ItemCard = {
  key: string;
  label: string;
  quantity: number;
  productId: string;
  listItemId?: string;
  onList: boolean;
  /** When set, confirming adds this many onto the open list line. */
  addMore?: number;
  savedLabel: string;
  savedQuantity: number;
  savedProductId: string;
};

type SwapHit = { id: string; name: string };

/** Mono, wide sample rate, no speech-band filter, so high and low voices still reach transcription. */
const LISTEN_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  numberOfChannels: 1,
  sampleRate: 48000,
  bitRate: 192000,
  android: {
    ...RecordingPresets.HIGH_QUALITY.android,
    audioSource: 'unprocessed' as const,
  },
};

const SILENCE_MS = 5000;
const SPEECH_DB = -50;
const COW_MOO_SHORT = require('@/assets/audio/cow-moo-short.mp3');
const COW_MOO_LONG = require('@/assets/audio/cow-moo-long.mp3');

/** ElevenLabs writes non-speech as tags such as "[outro jingle]". */
function stripAudioTags(value: string): string {
  return value.replace(/\s*\[[^\]\n]{1,80}\]\s*/g, ' ').replace(/\s+/g, ' ').trim();
}

const FILLER_WORD =
  /^(u+m+|u+h+|h+m+|e+r+|a+h+|e+h+|m+|mhm|huh|like|wait|hold|on|sec|second|moment|minute|let|me|think|see|one|just|give|hang|okay|ok|so|well|yeah|yep|actually|basically|right|alright|sorry|please)$/;

/** A pause such as "umm", "wait", "hold on", or "let me think", with no item in it. */
function isOnlyFiller(text: string): boolean {
  const words = stripAudioTags(text)
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0 || words.length > 8) return false;
  return words.every((word) => FILLER_WORD.test(word));
}

function itemTokens(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function sameItemWord(word: string, labelTokens: string[]): boolean {
  const bare = word.replace(/s$/, '');
  return labelTokens.some((token) => {
    const labelBare = token.replace(/s$/, '');
    return labelBare.startsWith(bare) || bare.startsWith(labelBare);
  });
}

/** "2", "make it 2", or "3 eggs to 2" while a card is already showing. */
function asCard(
  input: Omit<ItemCard, 'savedLabel' | 'savedQuantity' | 'savedProductId'> &
    Partial<Pick<ItemCard, 'savedLabel' | 'savedQuantity' | 'savedProductId'>>,
): ItemCard {
  return {
    savedLabel: input.label,
    savedQuantity: input.quantity,
    savedProductId: input.productId,
    ...input,
  };
}

const YES_WORDS = new Set([
  'yes', 'yeah', 'yep', 'yup', 'ok', 'okay', 'confirm', 'confirmed', 'approve', 'approved',
  'sure', 'correct', 'add', 'do', 'go', 'ahead', 'sounds', 'good', 'right',
]);
const NO_WORDS = new Set(['no', 'nope', 'nah', 'reject', 'rejected', 'skip', 'cancel', 'dont', 'don']);
const VERBAL_FILLER = new Set([
  'please', 'them', 'all', 'it', 'to', 'the', 'those', 'these', 'ones', 'one', 'that',
  'say', 'says', 'saying', 'just', 'i', 'want', 'would', 'like', 'so', 'you', 'can',
  'and', 'or', 'um', 'uh', 'a', 'an', 'this', 'if', 'we', 'butter',
]);

type VerbalDecision = { kind: 'yes' | 'no'; keys: string[] };

function verbalWords(text: string): string[] {
  return stripAudioTags(text)
    .toLowerCase()
    .replace(/[^a-z\s']/g, ' ')
    .replace(/'/g, '')
    .split(/\s+/)
    .filter(Boolean);
}

function cardMentioned(words: string[], card: ItemCard): boolean {
  const tokens = itemTokens(card.label);
  return words.some((word) => word.length > 2 && !VERBAL_FILLER.has(word) && sameItemWord(word, tokens));
}

/** "yes", "confirm bananas", "add them", or "no potatoes" while cards are waiting. */
function verbalDecision(text: string, cards: ItemCard[]): VerbalDecision | null {
  if (cards.length === 0) return null;
  const words = verbalWords(text);
  if (words.length === 0 || words.length > 8) return null;
  const content = words.filter((word) => !VERBAL_FILLER.has(word));
  if (content.length === 0) return null;
  const named = cards.filter((card) => cardMentioned(words, card));
  const saysYes = content.some((word) => YES_WORDS.has(word));
  const saysNo = content.some((word) => NO_WORDS.has(word));
  if (saysYes && saysNo) return null;
  if (named.length > 0 && saysYes) return { kind: 'yes', keys: named.map((card) => card.key) };
  if (named.length > 0 && saysNo) return { kind: 'no', keys: named.map((card) => card.key) };
  if (!saysYes && !saysNo) return null;
  if (content.some((word) => !YES_WORDS.has(word) && !NO_WORDS.has(word))) return null;
  if (saysYes) {
    const pending = cards.filter((card) => !card.onList || card.addMore);
    const targets = pending.length > 0 ? pending : cards;
    return { kind: 'yes', keys: targets.map((card) => card.key) };
  }
  return { kind: 'no', keys: cards.map((card) => card.key) };
}

function splitVerdict(
  text: string,
  splits: VoiceOrderSplit[],
): { phrase: string; side: 'one' | 'two' } | null {
  if (splits.length === 0) return null;
  const words = verbalWords(text);
  if (words.length === 0 || words.length > 8) return null;
  const saysTwo = words.some((word) => word === 'both' || word === 'two' || word === 'separate');
  const saysOne = words.some((word) => word === 'one' || word === 'single' || word === 'together');
  const named = splits.find((split) => verbalWords(split.phrase).some((word) => word.length > 2 && words.includes(word)));
  const target = named ?? (splits.length === 1 ? splits[0] : undefined);
  if (!target) return null;
  if (saysTwo && !saysOne) return { phrase: target.phrase, side: 'two' };
  if (saysOne) return { phrase: target.phrase, side: 'one' };
  const phraseWords = verbalWords(target.phrase);
  if (phraseWords.length > 0 && phraseWords.every((word) => words.includes(word))) {
    return { phrase: target.phrase, side: words.includes('and') ? 'two' : 'one' };
  }
  if (words.includes('and')) return { phrase: target.phrase, side: 'two' };
  return null;
}

function resultIsConfused(result: VoiceOrderResult): boolean {
  if (result.confused) return true;
  if ((result.splits ?? []).length > 0) return true;
  const reply = `${result.reply ?? ''} ${result.englishReply ?? ''}`;
  return /didn'?t hear a grocery|unable to find|could be one item|couldn'?t add/i.test(reply);
}

function matchingQuantity(text: string, cards: ItemCard[]): { card: ItemCard; quantity: number } | null {
  const matches = cards
    .map((card) => ({ card, quantity: clarificationQuantity(text, card.label) }))
    .filter((row): row is { card: ItemCard; quantity: number } => row.quantity != null);
  return matches.length === 1 ? matches[0] : null;
}

function cardsFromResult(result: VoiceOrderResult): ItemCard[] {
  const next: ItemCard[] = [];
  const seen = new Set<string>();
  for (const row of result.added ?? []) {
    if (!row.productId || seen.has(row.productId)) continue;
    seen.add(row.productId);
    next.push(asCard({
      key: `added-${row.listItemId ?? row.productId}`,
      label: row.name,
      quantity: row.quantity,
      productId: row.productId,
      listItemId: row.listItemId,
      onList: Boolean(row.listItemId),
    }));
  }
  for (const row of result.suggestions ?? []) {
    if (!row.productId || seen.has(row.productId)) continue;
    seen.add(row.productId);
    next.push(asCard({
      key: `suggest-${row.productId}`,
      label: row.label,
      quantity: row.quantity,
      productId: row.productId,
      onList: false,
    }));
  }
  for (const row of result.already ?? []) {
    if (seen.has(row.productId)) continue;
    seen.add(row.productId);
    next.push(asCard({
      key: `already-${row.listItemId}`,
      label: row.name,
      quantity: row.existingQuantity,
      productId: row.productId,
      listItemId: row.listItemId,
      onList: true,
      addMore: row.addQuantity,
    }));
  }
  return next;
}

function cardWasEdited(card: ItemCard): boolean {
  return (
    card.quantity !== card.savedQuantity ||
    card.productId !== card.savedProductId ||
    card.label !== card.savedLabel
  );
}

const LANGUAGE_LABEL: Record<string, string> = {
  es: 'Spanish',
  fr: 'French',
  de: 'German',
  pt: 'Portuguese',
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  vi: 'Vietnamese',
  ru: 'Russian',
  ar: 'Arabic',
  hi: 'Hindi',
  th: 'Thai',
};

function confirmReplyLanguage(code: string): Promise<boolean> {
  const name = LANGUAGE_LABEL[code] ?? code;
  return new Promise((resolve) => {
    Alert.alert(`Answer in ${name}?`, 'I can keep English instead.', [
      { text: 'English', style: 'cancel', onPress: () => resolve(false) },
      { text: name, onPress: () => resolve(true) },
    ]);
  });
}

function askToAddMore(name: string, existingQuantity: number, addQuantity: number): Promise<boolean> {
  const next = existingQuantity + addQuantity;
  return new Promise((resolve) => {
    Alert.alert(
      'Already on your list',
      `${name} is already there. Add ${addQuantity} more, so it's ${next}?`,
      [
        { text: 'No', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Yes', onPress: () => resolve(true) },
      ],
    );
  });
}

function clarificationQuantity(text: string, label: string): number | null {
  const cleaned = stripAudioTags(text).toLowerCase().replace(/[.!?]/g, '').trim();
  if (!cleaned || cleaned.length > 80) return null;
  const labelTokens = itemTokens(label);
  const filler = new Set([
    'the', 'to', 'from', 'and', 'make', 'change', 'just', 'only', 'want', 'need',
    'going', 'instead', 'please', 'that', 'this', 'into', 'for', 'item', 'quantity',
  ]);
  const namesSomethingElse = cleaned.split(/\s+/).some((word) => {
    if (/^\d+$/.test(word) || word.length < 3 || filler.has(word)) return false;
    return !sameItemWord(word, labelTokens);
  });
  if (namesSomethingElse) return null;
  const to = cleaned.match(/\bto\s+(\d{1,3})\b/);
  if (to) return Number(to[1]) > 0 ? Number(to[1]) : null;
  if (/^\d{1,3}$/.test(cleaned)) return Number(cleaned);
  const lead = cleaned.match(/^(?:make it|change it to|change to|only|just)\s+(\d{1,3})\b/);
  if (lead) return Number(lead[1]);
  const named = cleaned.match(/^(\d{1,3})\s+(.+)$/);
  if (named && itemTokens(named[2]).some((word) => sameItemWord(word, labelTokens))) {
    return Number(named[1]);
  }
  return null;
}

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
  const [typedText, setTypedText] = useState('');
  const [cards, setCardsState] = useState<ItemCard[]>([]);
  const [splits, setSplitsState] = useState<VoiceOrderSplit[]>([]);
  const [phrases, setPhrases] = useState<VoiceOrderPhrases | null>(null);
  const [replyLanguage, setReplyLanguage] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [confused, setConfused] = useState(false);
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [clarifyText, setClarifyText] = useState('');
  const [clarifyListening, setClarifyListening] = useState(false);
  const [swapKey, setSwapKey] = useState<string | null>(null);
  const [swapQuery, setSwapQuery] = useState('');
  const [swapHits, setSwapHits] = useState<SwapHit[]>([]);
  const recorder = useAudioRecorder(LISTEN_OPTIONS);
  const recorderState = useAudioRecorderState(recorder, 250);
  const replyPlayer = useAudioPlayer();
  const cardsRef = useRef<ItemCard[]>([]);
  const splitsRef = useRef<VoiceOrderSplit[]>([]);
  const playToken = useRef(0);
  const quietSince = useRef<number | null>(null);
  const heardVoice = useRef(false);
  const autoStopLock = useRef(false);
  const promptRef = useRef<string | null>(null);
  const clarifyMode = useRef(false);
  const setCards = useCallback((next: ItemCard[]) => {
    cardsRef.current = next;
    setCardsState(next);
  }, []);
  const setSplits = useCallback((next: VoiceOrderSplit[]) => {
    splitsRef.current = next;
    setSplitsState(next);
  }, []);

  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (phase !== 'listening') {
      pulse.stopAnimation();
      Animated.timing(pulse, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  const spotScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });

  const phaseRef = useRef<Phase>('idle');
  const listenEpoch = useRef(0);
  const sessionReady = useRef(false);
  const pressStartedListen = useRef(false);

  const ensureSession = useCallback(async () => {
    if (sessionReady.current) return true;
    try {
      const existing = await AudioModule.getRecordingPermissionsAsync();
      if (!existing.granted) {
        const result = await AudioModule.requestRecordingPermissionsAsync();
        if (!result.granted) {
          Alert.alert('Microphone needed', 'Allow microphone access to use push to talk.');
          return false;
        }
      }
      await AudioModule.setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: 'duckOthers',
        shouldRouteThroughEarpiece: false,
      });
      sessionReady.current = true;
      return true;
    } catch {
      sessionReady.current = false;
      return false;
    }
  }, []);

  useEffect(() => {
    void ensureSession();
  }, [ensureSession]);

  /** Prepare and start in one step. A recorder left prepared earlier records silence after playback. */
  const beginRecording = useCallback(async () => {
    const start = async () => {
      await recorder.prepareToRecordAsync(LISTEN_OPTIONS);
      recorder.record();
      return recorder.getStatus().isRecording;
    };
    try {
      if (!(await ensureSession())) return false;
      if (await start()) return true;
      sessionReady.current = false;
      if (!(await ensureSession())) return false;
      return await start();
    } catch {
      return false;
    }
  }, [ensureSession, recorder]);

  /** Keep the recording session up so playback does not make the next tap wait on the mic. */
  const routePlaybackToHeadphones = useCallback(async () => {
    await AudioModule.setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      interruptionMode: 'duckOthers',
      shouldRouteThroughEarpiece: false,
    });
  }, []);

  const startListening = useCallback(async () => {
    if (phaseRef.current === 'processing' || phaseRef.current === 'listening') return;
    const epoch = ++listenEpoch.current;
    phaseRef.current = 'listening';
    setPhase('listening');
    playToken.current += 1;
    if (replyPlayer.playing) replyPlayer.pause();
    Speech.stop();
    clarifyMode.current = false;
    setClarifyListening(false);
    setClarifyOpen(false);
    setConfused(false);
    setReply(null);
    setTranscript(null);
    quietSince.current = null;
    heardVoice.current = false;
    const started = await beginRecording();
    if (epoch !== listenEpoch.current) {
      if (recorder.getStatus().isRecording) await recorder.stop();
      return;
    }
    if (!started) {
      phaseRef.current = 'idle';
      setPhase('idle');
      setReply("I can't hear anything.");
    }
  }, [beginRecording, recorder, replyPlayer]);

  const speakLine = useCallback(
    async (message: string, language: string | undefined) => {
      const token = ++playToken.current;
      replyPlayer.pause();
      Speech.stop();
      await routePlaybackToHeadphones();
      if (token !== playToken.current) return;
      if (getAiVoice() === 'cow') {
        const clips =
          message.trim().length > 90
            ? [COW_MOO_LONG, COW_MOO_SHORT]
            : [COW_MOO_SHORT];
        for (const clip of clips) {
          if (token !== playToken.current) return;
          replyPlayer.replace(clip);
          await new Promise<void>((resolve) => {
            if (replyPlayer.currentStatus.isLoaded) {
              resolve();
              return;
            }
            const timeout = setTimeout(finish, 2000);
            const subscription = replyPlayer.addListener('playbackStatusUpdate', (status) => {
              if (status.isLoaded) finish();
            });
            function finish() {
              clearTimeout(timeout);
              subscription.remove();
              resolve();
            }
          });
          if (token !== playToken.current) return;
          replyPlayer.play();
          await new Promise<void>((resolve) => {
            let started = replyPlayer.playing;
            const timeout = setTimeout(finish, 8000);
            const subscription = replyPlayer.addListener('playbackStatusUpdate', (status) => {
              if (status.playing) started = true;
              if (started && status.didJustFinish) finish();
            });
            function finish() {
              clearTimeout(timeout);
              subscription.remove();
              resolve();
            }
          });
        }
        return;
      }
      try {
        const audio = await speakAssistant(message);
        if (token !== playToken.current) return;
        if (audio) {
          const path = `${FileSystem.cacheDirectory}voice-reply-${Date.now()}.mp3`;
          await FileSystem.writeAsStringAsync(path, audio, {
            encoding: FileSystem.EncodingType.Base64,
          });
          if (token !== playToken.current) return;
          replyPlayer.replace(path);
          replyPlayer.play();
          return;
        }
      } catch {
        // Device speech only if ElevenLabs is unreachable.
      }
      if (token !== playToken.current) return;
      Speech.speak(message, { rate: 1, pitch: 1, language: speechLocale(language) });
    },
    [replyPlayer, routePlaybackToHeadphones],
  );

  const playReplyFile = useCallback(
    async (path: string) => {
      const token = ++playToken.current;
      Speech.stop();
      replyPlayer.pause();
      await routePlaybackToHeadphones();
      if (token !== playToken.current) return;
      replyPlayer.replace(path);
      await new Promise<void>((resolve) => {
        if (replyPlayer.currentStatus.isLoaded) {
          resolve();
          return;
        }
        const timeout = setTimeout(finish, 2000);
        const subscription = replyPlayer.addListener('playbackStatusUpdate', (status) => {
          if (status.isLoaded) finish();
        });
        function finish() {
          clearTimeout(timeout);
          subscription.remove();
          resolve();
        }
      });
      if (token !== playToken.current || replyPlayer.playing) return;
      replyPlayer.play();
    },
    [replyPlayer, routePlaybackToHeadphones],
  );

  const chooseSplit = useCallback(
    async (phrase: string, side: 'one' | 'two', playAudio: boolean) => {
      const split = splitsRef.current.find((row) => row.phrase === phrase);
      if (!split) return;
      const picked = side === 'one' ? (split.one ? [split.one] : []) : split.two;
      const ready = picked.filter((row) => row.productId);
      setSplits(splitsRef.current.filter((row) => row.phrase !== phrase));
      setConfused(true);
      if (ready.length === 0) {
        const message =
          side === 'one'
            ? `I don't have ${split.phrase} as one item.`
            : "I don't see those separately.";
        setReply(message);
        if (playAudio) await speakLine(message, replyLanguage);
        return;
      }
      setCards(
        ready.map((row) =>
          asCard({
            key: `split-${row.productId}`,
            label: row.label,
            quantity: row.quantity,
            productId: row.productId!,
            onList: false,
          }),
        ),
      );
      setSwapKey(null);
      const names = side === 'one' ? split.phrase : ready.map((row) => row.label).join(' and ');
      const message = `Do you want ${names}? Press confirm, clarify, or press and say yes.`;
      setReply(message);
      if (playAudio) await speakLine(message, replyLanguage);
    },
    [replyLanguage, setCards, setSplits, speakLine],
  );

  const applyQuantity = useCallback(
    async (current: ItemCard, quantity: number) => {
      if (current.listItemId) {
        await updateListItem(current.listItemId, { quantity });
      }
      setCards(
        cardsRef.current.map((row) =>
          row.key === current.key ? { ...row, quantity, savedQuantity: quantity } : row,
        ),
      );
      setSwapKey(null);
    },
    [setCards],
  );

  const applyVerbal = useCallback(
    async (decision: VerbalDecision, playAudio: boolean) => {
      let next = [...cardsRef.current];
      const lines: string[] = [];
      setConfirming(true);
      try {
        for (const key of decision.keys) {
          const card = next.find((row) => row.key === key);
          if (!card) continue;
          if (decision.kind === 'no') {
            if (card.listItemId && !card.addMore) await removeListItem(card.listItemId);
            next = next.filter((row) => row.key !== key);
            lines.push(card.addMore ? `Left ${card.label} on your list.` : `Rejected ${card.label}.`);
            continue;
          }
          if (card.onList && card.listItemId && cardWasEdited(card)) {
            await updateListItem(card.listItemId, { quantity: card.quantity });
            const saved = asCard({
              key: card.key,
              label: card.label,
              quantity: card.quantity,
              productId: card.productId,
              listItemId: card.listItemId,
              onList: true,
            });
            next = next.map((row) => (row.key === key ? saved : row));
            lines.push(`Approved ${card.label}.`);
            continue;
          }
          if (card.addMore && card.listItemId) {
            const quantity = card.quantity + card.addMore;
            await updateListItem(card.listItemId, { quantity });
            const saved = asCard({
              key: card.key,
              label: card.label,
              quantity,
              productId: card.productId,
              listItemId: card.listItemId,
              onList: true,
            });
            next = next.map((row) => (row.key === key ? saved : row));
            lines.push(`Okay, ${card.label} is now ${quantity}.`);
            continue;
          }
          if (card.onList) {
            lines.push(`${card.label} is on your list.`);
            continue;
          }
          const { list } = await getMyDefaultList();
          const existing = await openProductOnList(list.id, card.productId);
          if (existing) {
            const quantity = existing.quantity + card.quantity;
            await updateListItem(existing.id, { quantity });
            const saved = asCard({
              key: card.key,
              label: card.label,
              quantity,
              productId: card.productId,
              listItemId: existing.id,
              onList: true,
            });
            next = next.map((row) => (row.key === key ? saved : row));
            lines.push(`Okay, ${card.label} is now ${quantity}.`);
            continue;
          }
          const row = await addListItem({
            listId: list.id,
            productId: card.productId,
            quantity: card.quantity,
          });
          const saved = asCard({
            key: card.key,
            label: card.label,
            quantity: card.quantity,
            productId: card.productId,
            listItemId: row.id,
            onList: true,
          });
          next = next.map((item) => (item.key === key ? saved : item));
          lines.push(
            (phrases?.added ?? 'Added {quantity} {label}.')
              .replaceAll('{quantity}', String(card.quantity))
              .replaceAll('{label}', card.label),
          );
        }
        setCards(next);
        setSwapKey(null);
        if (next.length > 0) setConfused(true);
        const message = lines.join(' ') || 'Okay.';
        setReply(message);
        if (playAudio) await speakLine(message, replyLanguage);
      } catch (err) {
        setCards(next);
        setReply(err instanceof Error ? err.message : 'Could not update those items.');
      } finally {
        setConfirming(false);
      }
    },
    [phrases, replyLanguage, setCards, speakLine],
  );

  const applyResult = useCallback(
    async (incoming: VoiceOrderResult, options?: { playAudio?: boolean; keepPrompt?: boolean }) => {
      let result = incoming;
      if (incoming.language && incoming.language !== 'en') {
        const useHeard = await confirmReplyLanguage(incoming.language);
        if (!useHeard) {
          result = {
            ...incoming,
            language: 'en',
            reply: incoming.englishReply?.trim() || incoming.reply,
            replyAudioBase64: null,
            phrases: undefined,
          };
        }
      }
      const cleanTranscript = stripAudioTags(result.transcript ?? '');
      const cleanReply = stripAudioTags(result.reply ?? '');
      const hadAudioTag = /\[[^\]]+\]/.test(`${result.transcript ?? ''} ${result.reply ?? ''}`);
      const waiting = cardsRef.current;
      if (options?.keepPrompt) {
        setPhrases(result.phrases ?? null);
        setReplyLanguage(result.language);
        setTranscript(promptRef.current);
        const listed = cardsFromResult(result);
        setSplits(result.splits ?? []);
        if (listed.length > 0) {
          setCards(listed);
          setSwapKey(null);
        }
        const stillConfused =
          resultIsConfused(result) || listed.length > 0 || (result.splits ?? []).length > 0;
        setConfused(stillConfused);
        setClarifyOpen(false);
        setClarifyText('');
        const message =
          cleanReply ||
          (waiting.length > 0
            ? "I didn't catch that. You can change the quantity on a card."
            : "I didn't catch that. Try again?");
        setReply(message);
        const playAudio = options?.playAudio !== false;
        if (!playAudio) return;
        if (getAiVoice() === 'cow' || hadAudioTag || !result.replyAudioBase64) {
          await speakLine(message, result.language);
          return;
        }
        const path = `${FileSystem.cacheDirectory}voice-reply-${Date.now()}.mp3`;
        await FileSystem.writeAsStringAsync(path, result.replyAudioBase64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await playReplyFile(path);
        return;
      }
      const splitPick = splitVerdict(cleanTranscript, splitsRef.current);
      if (splitPick) {
        setTranscript(cleanTranscript || null);
        await chooseSplit(splitPick.phrase, splitPick.side, options?.playAudio !== false);
        return;
      }
      const spokenYes = verbalDecision(cleanTranscript, waiting);
      if (spokenYes) {
        setTranscript(cleanTranscript || null);
        await applyVerbal(spokenYes, options?.playAudio !== false);
        return;
      }
      const revised = matchingQuantity(cleanTranscript, waiting);

      setPhrases(result.phrases ?? null);
      setReplyLanguage(result.language);
      setTranscript(cleanTranscript || null);
      if (cleanTranscript) promptRef.current = cleanTranscript;
      const listed = cardsFromResult(result);
      const stillConfused =
        resultIsConfused(result) || listed.length > 0 || (result.splits ?? []).length > 0;
      setConfused(stillConfused);
      setClarifyOpen(false);
      setClarifyText('');

      if (revised) {
        for (const row of result.added ?? []) {
          if (row.listItemId && row.listItemId !== revised.card.listItemId) {
            await removeListItem(row.listItemId).catch(() => undefined);
          }
        }
        await applyQuantity(revised.card, revised.quantity);
        const message = `Okay, ${revised.quantity}.`;
        setReply(message);
        if (options?.playAudio !== false) await speakLine(message, result.language);
        return;
      }

      setSplits(result.splits ?? []);
      if (listed.length > 0) {
        setCards(listed);
        setSwapKey(null);
      }

      const message =
        cleanReply ||
        (waiting.length > 0
          ? "I didn't catch that. You can change the quantity on a card."
          : "I didn't catch that. Try again?");
      setReply(message);

      const playAudio = options?.playAudio !== false;
      if (!playAudio) return;
      if (getAiVoice() === 'cow' || hadAudioTag || !result.replyAudioBase64) {
        await speakLine(message, result.language);
        return;
      }
      const path = `${FileSystem.cacheDirectory}voice-reply-${Date.now()}.mp3`;
      await FileSystem.writeAsStringAsync(path, result.replyAudioBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      await playReplyFile(path);
    },
    [applyQuantity, applyVerbal, chooseSplit, playReplyFile, setCards, setSplits, speakLine],
  );

  const confirmCard = useCallback(
    async (key: string) => {
      if (confirming) return;
      await applyVerbal({ kind: 'yes', keys: [key] }, isAiTextReplyAudioEnabled());
    },
    [applyVerbal, confirming],
  );

  const changeQuantity = useCallback(
    (key: string, quantity: number) => {
      if (quantity < 1) return;
      setCards(cardsRef.current.map((row) => (row.key === key ? { ...row, quantity } : row)));
    },
    [setCards],
  );

  const approveCard = useCallback(
    async (key: string) => {
      const current = cardsRef.current.find((row) => row.key === key);
      if (!current || confirming || !cardWasEdited(current)) return;
      if (!current.onList || !current.listItemId) {
        await confirmCard(key);
        return;
      }
      setConfirming(true);
      try {
        const { list } = await getMyDefaultList();
        let listItemId = current.listItemId;
        let quantity = current.quantity;
        if (current.productId !== current.savedProductId) {
          const existing = await openProductOnList(list.id, current.productId);
          if (existing && existing.id !== listItemId) {
            const yes = await askToAddMore(current.label, existing.quantity, current.quantity);
            if (!yes) {
              setReply('Okay, left it on your list.');
              return;
            }
            await removeListItem(listItemId);
            quantity = existing.quantity + current.quantity;
            await updateListItem(existing.id, { quantity });
            listItemId = existing.id;
          } else {
            await removeListItem(listItemId);
            const row = await addListItem({
              listId: list.id,
              productId: current.productId,
              quantity: current.quantity,
            });
            listItemId = row.id;
          }
        } else {
          await updateListItem(listItemId, { quantity: current.quantity });
        }
        setCards(
          cardsRef.current.map((row) =>
            row.key === key
              ? asCard({
                  key,
                  label: current.label,
                  quantity,
                  productId: current.productId,
                  listItemId,
                  onList: true,
                })
              : row,
          ),
        );
        setReply('Approved.');
      } catch (err) {
        setReply(err instanceof Error ? err.message : 'Could not save that edit.');
      } finally {
        setConfirming(false);
      }
    },
    [confirmCard, confirming, setCards],
  );

  const rejectCard = useCallback(
    async (key: string) => {
      if (confirming) return;
      await applyVerbal({ kind: 'no', keys: [key] }, isAiTextReplyAudioEnabled());
    },
    [applyVerbal, confirming],
  );

  const onSwapQuery = useCallback((value: string) => {
    setSwapQuery(value);
    const term = value.trim();
    if (term.length < 2) {
      setSwapHits([]);
      return;
    }
    void searchProducts(term, { limit: 5 })
      .then((rows) => setSwapHits(rows.map((row) => ({ id: row.id, name: row.name }))))
      .catch(() => setSwapHits([]));
  }, []);

  const swapProduct = useCallback(
    (key: string, hit: SwapHit) => {
      setCards(
        cardsRef.current.map((row) =>
          row.key === key ? { ...row, label: hit.name, productId: hit.id } : row,
        ),
      );
      setSwapKey(null);
      setSwapQuery('');
      setSwapHits([]);
    },
    [setCards],
  );

  const stopAndSend = useCallback(async (reason: 'tap' | 'quiet' = 'tap') => {
    if (autoStopLock.current) return;
    listenEpoch.current += 1;
    if (!recorder.getStatus().isRecording) {
      phaseRef.current = 'idle';
      setPhase('idle');
      return;
    }
    autoStopLock.current = true;
    phaseRef.current = 'processing';
    setPhase('processing');
    await recorder.stop();
    const uri = recorder.uri;
    heardVoice.current = false;
    quietSince.current = null;

    const clarifying = clarifyMode.current;
    clarifyMode.current = false;
    setClarifyListening(false);

    if (!uri) {
      const line = clarifying
        ? "I can't hear the clarification. Type it, or tap the mic again."
        : "I can't hear anything.";
      setReply(line);
      if (clarifying) {
        setConfused(true);
        setClarifyOpen(true);
      }
      await speakLine(line, 'en');
      phaseRef.current = 'idle';
      setPhase('idle');
      autoStopLock.current = false;
      return;
    }
    try {
      const result = await voiceOrder(uri, clarifying ? promptRef.current ?? undefined : undefined);
      if (clarifying) {
        const heard =
          result.heard != null
            ? stripAudioTags(result.heard)
            : stripAudioTags(result.transcript ?? '');
        if (!heard) {
          const line = "I can't hear the clarification. Type it, or tap the mic again.";
          setReply(line);
          setConfused(true);
          setClarifyOpen(true);
          await speakLine(line, 'en');
          return;
        }
        setClarifyText('');
        const prompt = promptRef.current?.trim();
        if (result.heard == null && prompt && (result.added ?? []).length === 0) {
          const resolved = await voiceOrderFromText(prompt, heard);
          await applyResult(resolved, { playAudio: true, keepPrompt: true });
          return;
        }
        await applyResult(result, { playAudio: true, keepPrompt: true });
        return;
      }
      const spoken = stripAudioTags(result.transcript ?? '');
      if (!spoken) {
        const line = "I can't hear anything.";
        setReply(line);
        await speakLine(line, 'en');
        return;
      }
      const splitPick = splitVerdict(spoken, splitsRef.current);
      if (splitPick) {
        setTranscript(spoken);
        await chooseSplit(splitPick.phrase, splitPick.side, true);
        return;
      }
      const decision = verbalDecision(spoken, cardsRef.current);
      if (decision) {
        setTranscript(spoken);
        await applyVerbal(decision, true);
        return;
      }
      if (reason === 'quiet' && isOnlyFiller(spoken)) {
        phaseRef.current = 'idle';
        setPhase('idle');
        autoStopLock.current = false;
        await startListening();
        return;
      }
      await applyResult(result, { playAudio: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setReply(message);
    } finally {
      if (!autoStopLock.current) return;
      phaseRef.current = 'idle';
      setPhase('idle');
      autoStopLock.current = false;
    }
  }, [recorder, applyResult, applyVerbal, chooseSplit, setCards, speakLine, startListening]);

  useEffect(() => {
    if (phase !== 'listening' || !recorderState.isRecording) return;
    const level = recorderState.metering;
    if (level == null) return;
    if (level > SPEECH_DB) {
      heardVoice.current = true;
      quietSince.current = null;
      return;
    }
    const now = Date.now();
    if (quietSince.current == null) quietSince.current = now;
    if (now - quietSince.current >= SILENCE_MS) {
      void stopAndSend('quiet');
    }
  }, [phase, recorderState.isRecording, recorderState.metering, stopAndSend]);

  const startClarifyListen = useCallback(async () => {
    if (phaseRef.current === 'processing') return;
    if (phaseRef.current === 'listening') {
      if (clarifyMode.current) void stopAndSend();
      return;
    }
    const epoch = ++listenEpoch.current;
    clarifyMode.current = true;
    setClarifyListening(true);
    phaseRef.current = 'listening';
    setPhase('listening');
    playToken.current += 1;
    if (replyPlayer.playing) replyPlayer.pause();
    Speech.stop();
    quietSince.current = null;
    heardVoice.current = false;
    const started = await beginRecording();
    if (epoch !== listenEpoch.current) {
      if (recorder.getStatus().isRecording) await recorder.stop();
      return;
    }
    if (!started) {
      clarifyMode.current = false;
      setClarifyListening(false);
      phaseRef.current = 'idle';
      setPhase('idle');
    }
  }, [beginRecording, recorder, replyPlayer, stopAndSend]);

  const sendClarify = useCallback(async () => {
    const note = clarifyText.trim();
    const prompt = (promptRef.current || transcript || '').trim();
    if (phase === 'processing') return;
    if (!note) {
      setReply('Type what you meant, then send it again.');
      return;
    }
    if (!prompt) {
      setReply('Say the item again, then clarify it.');
      return;
    }
    promptRef.current = prompt;
    playToken.current += 1;
    Speech.stop();
    replyPlayer.pause();
    if (clarifyMode.current) {
      clarifyMode.current = false;
      setClarifyListening(false);
      await recorder.stop();
    }
    setPhase('processing');
    setReply('Checking that…');
    try {
      const result = await voiceOrderFromText(prompt, note);
      setClarifyText('');
      await applyResult(result, { playAudio: isAiTextReplyAudioEnabled(), keepPrompt: true });
    } catch (err) {
      setReply(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setPhase('idle');
    }
  }, [applyResult, clarifyText, phase, recorder, replyPlayer, transcript]);

  const onPressInTalk = useCallback(() => {
    if (phaseRef.current !== 'idle') return;
    pressStartedListen.current = true;
    void startListening();
  }, [startListening]);

  const onPressTalk = useCallback(() => {
    if (pressStartedListen.current) {
      pressStartedListen.current = false;
      return;
    }
    if (phaseRef.current === 'listening') void stopAndSend();
    else if (phaseRef.current === 'idle') void startListening();
  }, [startListening, stopAndSend]);

  const sendTyped = useCallback(async () => {
    const text = typedText.trim();
    if (!text || phase === 'processing') return;
    playToken.current += 1;
    Speech.stop();
    replyPlayer.pause();
    const waiting = cardsRef.current;
    const splitPick = splitVerdict(text, splitsRef.current);
    if (splitPick) {
      setTranscript(text);
      setTypedText('');
      await chooseSplit(splitPick.phrase, splitPick.side, isAiTextReplyAudioEnabled());
      return;
    }
    const decision = verbalDecision(text, waiting);
    if (decision) {
      setTranscript(text);
      setTypedText('');
      await applyVerbal(decision, isAiTextReplyAudioEnabled());
      return;
    }
    const revised = matchingQuantity(text, waiting);
    if (revised) {
      setPhase('processing');
      try {
        await applyQuantity(revised.card, revised.quantity);
        const message = `Okay, ${revised.quantity}.`;
        setTranscript(text);
        setReply(message);
        setTypedText('');
        if (isAiTextReplyAudioEnabled()) await speakLine(message, replyLanguage);
      } catch (err) {
        setReply(err instanceof Error ? err.message : 'Could not change the quantity.');
      } finally {
        setPhase('idle');
      }
      return;
    }
    setPhase('processing');
    setReply(null);
    setTranscript(null);
    try {
      const result = await voiceOrderFromText(text);
      await applyResult(result, { playAudio: isAiTextReplyAudioEnabled() });
      setTypedText('');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      setReply(message);
    } finally {
      setPhase('idle');
    }
  }, [typedText, phase, applyQuantity, applyResult, applyVerbal, chooseSplit, replyLanguage, replyPlayer, speakLine]);

  const label =
    phase === 'processing' ? 'Thinking…' : phase === 'listening' ? 'Listening… tap to stop' : 'Tap to talk';

  const butter = theme.primary;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.frame}
        keyboardShouldPersistTaps="handled"
        style={{ backgroundColor: theme.background }}>
        <Text style={[styles.title, { color: theme.text }]}>Butter AI</Text>
        <Text style={[styles.hint, { color: theme.textSecondary }]}>
          {phase === 'idle' ? 'Tap the spot, say what to add.' : label}
        </Text>

        <Pressable
          onPressIn={onPressInTalk}
          onPress={onPressTalk}
          disabled={phase === 'processing'}
          style={styles.talkButton}
          accessibilityRole="button"
          accessibilityLabel={label}>
          <Animated.View style={{ transform: [{ scale: spotScale }] }}>
            <Svg width={210} height={148} viewBox="0 0 200 140">
              <Path
                d="M38 74C20 52 42 30 74 32C98 18 124 34 148 28C174 22 192 46 184 68C196 88 174 112 146 106C118 118 88 104 64 108C38 112 12 96 38 74Z"
                fill={butter}
              />
              <Path
                d="M72 56C94 44 132 48 146 60C128 70 92 72 72 56Z"
                fill="#FFF6C2"
                opacity={0.85}
              />
            </Svg>
          </Animated.View>
          {phase === 'processing' ? (
            <ActivityIndicator color={theme.text} style={styles.spotOverlay} />
          ) : null}
        </Pressable>

        {transcript ? (
          <Text style={[styles.transcript, { color: theme.text }]}>“{transcript}”</Text>
        ) : null}
        {reply ? <Text style={[styles.reply, { color: theme.text }]}>{reply}</Text> : null}
        {(confused || cards.length > 0 || splits.length > 0) && transcript ? (
          <View style={styles.clarifyBox}>
            <Pressable
              onPress={() => setClarifyOpen((open) => !open)}
              style={({ pressed }) => [
                styles.confirmButton,
                { backgroundColor: theme.primary },
                pressed && styles.sendButtonDisabled,
              ]}>
              <Text style={[styles.sendButtonLabel, { color: theme.primaryText }]}>Clarify</Text>
            </Pressable>
            {clarifyOpen ? (
              <View style={styles.clarifyPanel}>
                <Text style={[styles.cardNote, { color: theme.textSecondary }]}>
                  This note is only for this request. It is forgotten after.
                </Text>
                <TextInput
                  style={[
                    styles.typedInput,
                    styles.clarifyInput,
                    {
                      backgroundColor: theme.backgroundElement,
                      borderColor: theme.border,
                      color: theme.text,
                    },
                  ]}
                  placeholder="What did you mean?"
                  placeholderTextColor={theme.textSecondary}
                  value={clarifyText}
                  onChangeText={setClarifyText}
                  onSubmitEditing={() => void sendClarify()}
                  editable={phase !== 'processing'}
                  returnKeyType="send"
                />
                <View style={styles.suggestionActions}>
                  <Pressable
                    onPress={() => void startClarifyListen()}
                    disabled={phase === 'processing'}
                    style={({ pressed }) => [
                      styles.confirmButton,
                      { backgroundColor: theme.backgroundElement, borderWidth: 1, borderColor: theme.border },
                      (phase === 'processing' || pressed) && styles.sendButtonDisabled,
                    ]}
                    accessibilityLabel={clarifyListening ? 'Stop clarification' : 'Speak a clarification'}>
                    <Text style={[styles.sendButtonLabel, { color: theme.text }]}>
                      {clarifyListening ? 'Stop' : 'Mic'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void sendClarify()}
                    disabled={phase === 'processing' || !clarifyText.trim()}
                    style={({ pressed }) => [
                      styles.confirmButton,
                      { backgroundColor: theme.primary },
                      (phase === 'processing' || !clarifyText.trim() || pressed) && styles.sendButtonDisabled,
                    ]}>
                    <Text style={[styles.sendButtonLabel, { color: theme.primaryText }]}>Send again</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        ) : null}

        {splits.map((split) => (
          <View
            key={split.phrase}
            style={[
              styles.suggestionCard,
              { borderColor: theme.border, backgroundColor: theme.background },
            ]}>
            <Text style={[styles.suggestionLabel, { color: theme.text }]}>{split.phrase}</Text>
            <Text style={[styles.cardNote, { color: theme.textSecondary }]}>
              One dish, or {split.two.map((item) => item.label).join(' and ') || 'two items'}? Say one or both.
            </Text>
            <View style={styles.suggestionActions}>
              <Pressable
                onPress={() => void chooseSplit(split.phrase, 'one', isAiTextReplyAudioEnabled())}
                disabled={!split.one}
                style={({ pressed }) => [
                  styles.confirmButton,
                  { backgroundColor: theme.primary },
                  (!split.one || pressed) && styles.sendButtonDisabled,
                ]}>
                <Text style={[styles.sendButtonLabel, { color: theme.primaryText }]}>One item</Text>
              </Pressable>
              <Pressable
                onPress={() => void chooseSplit(split.phrase, 'two', isAiTextReplyAudioEnabled())}
                disabled={split.two.length === 0}
                style={styles.skipButton}>
                <Text style={[styles.skipLabel, { color: theme.text }]}>Both</Text>
              </Pressable>
            </View>
          </View>
        ))}

        {cards.length > 0 ? (
          <View style={styles.suggestions}>
            {cards.some((row) => !row.onList || row.addMore) ? (
              <Text style={[styles.cardNote, { color: theme.textSecondary }]}>
                Press confirm, clarify, or press and say yes.
              </Text>
            ) : null}
            {cards.map((row) => (
              <View
                key={row.key}
                style={[
                  styles.suggestionCard,
                  { borderColor: theme.border, backgroundColor: theme.background },
                ]}>
                <Text style={[styles.suggestionLabel, { color: theme.text }]}>{row.label}</Text>
                {row.addMore ? (
                  <Text style={[styles.cardNote, { color: theme.textSecondary }]}>
                    Add {row.addMore} more?
                  </Text>
                ) : row.onList ? (
                  <Text style={[styles.cardNote, { color: theme.textSecondary }]}>On your list</Text>
                ) : null}
                <View style={styles.suggestionActions}>
                  <Pressable
                    onPress={() => changeQuantity(row.key, row.quantity - 1)}
                    hitSlop={8}
                    style={styles.qtyBtn}>
                    <Text style={{ color: theme.text, fontFamily: Fonts.sansBold }}>−</Text>
                  </Pressable>
                  <Text style={[styles.qtyValue, { color: theme.text }]}>{row.quantity}</Text>
                  <Pressable
                    onPress={() => changeQuantity(row.key, row.quantity + 1)}
                    hitSlop={8}
                    style={styles.qtyBtn}>
                    <Text style={{ color: theme.text, fontFamily: Fonts.sansBold }}>+</Text>
                  </Pressable>
                </View>
                <View style={styles.suggestionActions}>
                  {cardWasEdited(row) ? (
                    <Pressable
                      onPress={() => void approveCard(row.key)}
                      disabled={confirming}
                      style={({ pressed }) => [
                        styles.confirmButton,
                        { backgroundColor: theme.primary },
                        (confirming || pressed) && styles.sendButtonDisabled,
                      ]}>
                      <Text style={[styles.sendButtonLabel, { color: theme.primaryText }]}>
                        {confirming ? 'Saving…' : 'Approve'}
                      </Text>
                    </Pressable>
                  ) : row.onList && !row.addMore ? null : (
                    <Pressable
                      onPress={() => void confirmCard(row.key)}
                      disabled={confirming}
                      style={({ pressed }) => [
                        styles.confirmButton,
                        { backgroundColor: theme.primary },
                        (confirming || pressed) && styles.sendButtonDisabled,
                      ]}>
                      <Text style={[styles.sendButtonLabel, { color: theme.primaryText }]}>
                        {confirming ? 'Adding…' : row.addMore ? 'Add more' : 'Confirm'}
                      </Text>
                    </Pressable>
                  )}
                  <Pressable
                    onPress={() => setSwapKey((open) => (open === row.key ? null : row.key))}
                    style={styles.skipButton}>
                    <Text style={[styles.skipLabel, { color: theme.text }]}>Different item</Text>
                  </Pressable>
                  <Pressable onPress={() => void rejectCard(row.key)} style={styles.skipButton}>
                    <Text style={[styles.skipLabel, { color: theme.textSecondary }]}>Reject</Text>
                  </Pressable>
                </View>
                {swapKey === row.key ? (
                  <View style={styles.swapBox}>
                    <TextInput
                      style={[
                        styles.typedInput,
                        {
                          backgroundColor: theme.backgroundElement,
                          borderColor: theme.border,
                          color: theme.text,
                        },
                      ]}
                      placeholder="Search for a different item"
                      placeholderTextColor={theme.textSecondary}
                      value={swapQuery}
                      onChangeText={onSwapQuery}
                      autoFocus
                    />
                    {swapHits.map((hit) => (
                      <Pressable key={hit.id} onPress={() => swapProduct(row.key, hit)} style={styles.swapHit}>
                        <Text style={[styles.swapHitLabel, { color: theme.text }]}>{hit.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.typedRow}>
          <TextInput
            style={[
              styles.typedInput,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.border,
                color: theme.text,
              },
            ]}
            placeholder="Or type what to add"
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
              { backgroundColor: theme.primary },
              (phase === 'processing' || !typedText.trim() || pressed) && styles.sendButtonDisabled,
            ]}>
            <Text style={[styles.sendButtonLabel, { color: theme.primaryText }]}>Send</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function speechLocale(language: string | undefined): string | undefined {
  if (!language || language === 'en') return undefined;
  if (language === 'zh') return 'zh-CN';
  if (language === 'ja') return 'ja-JP';
  if (language === 'ko') return 'ko-KR';
  return language;
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  frame: {
    flexGrow: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
    alignItems: 'center',
  },
  title: { fontFamily: Fonts.sansBold, fontSize: 28, alignSelf: 'flex-start' },
  hint: { fontFamily: Fonts.sans, fontSize: 15, lineHeight: 22, alignSelf: 'flex-start' },
  talkButton: { width: 220, height: 168, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.three },
  spotOverlay: { position: 'absolute' },
  transcript: { fontFamily: Fonts.sans, fontSize: 16, fontStyle: 'italic', textAlign: 'center' },
  reply: { fontFamily: Fonts.sansBold, fontSize: 16, textAlign: 'center', lineHeight: 22 },
  clarifyBox: { width: '100%', gap: Spacing.two, alignItems: 'flex-start' },
  clarifyPanel: { width: '100%', gap: Spacing.two },
  clarifyInput: { width: '100%', flex: 0 },
  suggestions: { width: '100%', gap: Spacing.two },
  suggestionCard: {
    width: '100%',
    borderWidth: 1,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  suggestionLabel: { fontFamily: Fonts.sansBold, fontSize: 16 },
  cardNote: { fontFamily: Fonts.sans, fontSize: 13 },
  swapBox: { width: '100%', gap: Spacing.two },
  swapHit: { paddingVertical: Spacing.two },
  swapHitLabel: { fontFamily: Fonts.sans, fontSize: 15 },
  suggestionActions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.three },
  qtyBtn: { minWidth: 28, alignItems: 'center' },
  qtyValue: { fontFamily: Fonts.sansBold, fontSize: 16, minWidth: 20, textAlign: 'center' },
  confirmButton: {
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  skipButton: { paddingVertical: Spacing.two, paddingHorizontal: Spacing.one },
  skipLabel: { fontFamily: Fonts.sansBold, fontSize: 14 },
  typedRow: { flexDirection: 'row', width: '100%', gap: Spacing.two },
  typedInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontFamily: Fonts.sans,
    fontSize: 16,
  },
  sendButton: {
    borderRadius: Radius.button,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.45 },
  sendButtonLabel: { fontFamily: Fonts.sansBold, fontSize: 16 },
  gate: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: Spacing.four, gap: Spacing.two },
  gateTitle: { fontFamily: Fonts.sansBold, fontSize: 28 },
  gateBody: { fontFamily: Fonts.sans, fontSize: 15, textAlign: 'center', lineHeight: 22, marginBottom: Spacing.two },
  cta: { borderRadius: Radius.button, paddingHorizontal: Spacing.five, paddingVertical: Spacing.three },
  ctaLabel: { fontFamily: Fonts.sansBold, fontSize: 16 },
});