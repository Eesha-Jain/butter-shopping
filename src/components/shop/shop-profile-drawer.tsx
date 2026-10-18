import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  // DevSettings,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  clearLocalData,
  getAiVoice,
  getEffectiveGroceryCashbackBps,
  isAiTextReplyAudioEnabled,
  publicImageUrl,
  removeMyAvatar,
  setAiTextReplyAudioEnabled,
  setAiVoice,
  type AiVoice,
  setGroceryCashbackBps,
  showErrorToast,
  showSuccessToast,
  uploadMyAvatar,
} from '@/backend';
import type { AuthMode } from '@/auth/auth-mode';
import { ThemedText } from '@/components/themed-text';
import { ButterButton } from '@/components/ui/butter-button';
import { ButterChip } from '@/components/ui/butter-chip';
import { Radius, SheetChrome, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const SLIDE_MS = 280;
const SLIDE_EASE = Easing.out(Easing.cubic);

type Props = {
  visible: boolean;
  displayName: string | null;
  avatarPath: string | null;
  avatarVersion: number;
  isGuest: boolean;
  onClose: () => void;
  onSignOut: () => void | Promise<void>;
  onRequestAuth: (mode: AuthMode) => void;
  onAvatarChanged: (path: string | null) => void;
};

export function ShopProfileDrawer({
  visible,
  displayName,
  avatarPath,
  avatarVersion,
  isGuest,
  onClose,
  onSignOut,
  onRequestAuth,
  onAvatarChanged,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(320, Math.round(width * 0.82));
  const [uploading, setUploading] = useState(false);
  const [cashbackBps, setCashbackBps] = useState<number | null>(null);
  const [aiTextAudio, setAiTextAudio] = useState(true);
  const [aiVoice, setAiVoiceChoice] = useState<AiVoice>('female');
  const [closing, setClosing] = useState(false);
  const [translateX] = useState(() => new Animated.Value(-panelWidth));
  const [backdropOpacity] = useState(() => new Animated.Value(0));

  const avatarBaseUrl = publicImageUrl('avatars', avatarPath);
  const avatarUrl = avatarBaseUrl ? `${avatarBaseUrl}?t=${avatarVersion}` : null;

  useEffect(() => {
    translateX.setValue(-panelWidth);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: 0,
        duration: SLIDE_MS,
        easing: SLIDE_EASE,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: SLIDE_MS,
        easing: SLIDE_EASE,
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, panelWidth, translateX]);

  useEffect(() => {
    if (!visible) return;
    void getEffectiveGroceryCashbackBps(isGuest).then(setCashbackBps).catch(() => setCashbackBps(null));
    setAiTextAudio(isAiTextReplyAudioEnabled());
    setAiVoiceChoice(getAiVoice());
  }, [visible, isGuest]);

  const requestClose = (afterClose?: () => void) => {
    if (closing) return;
    setClosing(true);
    const done = afterClose ?? onClose;
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: -panelWidth,
        duration: SLIDE_MS,
        easing: SLIDE_EASE,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: SLIDE_MS,
        easing: SLIDE_EASE,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) done();
    });
  };

  const pickAndUpload = async (source: 'library' | 'camera') => {
    if (isGuest) {
      onRequestAuth('signUp');
      return;
    }

    try {
      if (source === 'library') {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          showErrorToast(new Error('Photo library access is required to set a profile picture.'));
          return;
        }
      } else {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          showErrorToast(new Error('Camera access is required to take a profile picture.'));
          return;
        }
      }

      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      };

      const result =
        source === 'library'
          ? await ImagePicker.launchImageLibraryAsync(options)
          : await ImagePicker.launchCameraAsync(options);

      if (result.canceled || !result.assets?.[0]?.uri) return;

      const asset = result.assets[0];
      setUploading(true);
      const response = await fetch(asset.uri);
      const data = await response.arrayBuffer();
      const contentType = asset.mimeType ?? 'image/jpeg';
      const path = await uploadMyAvatar({ data, contentType });
      onAvatarChanged(path);
      showSuccessToast('Photo updated');
    } catch (err) {
      showErrorToast(err, 'Could not update your profile photo.');
    } finally {
      setUploading(false);
    }
  };

  const handleChangePhoto = () => {
    if (isGuest) {
      onRequestAuth('signUp');
      return;
    }

    const buttons: {
      text: string;
      style?: 'cancel' | 'destructive' | 'default';
      onPress?: () => void;
    }[] = [
      {
        text: 'Photo library',
        onPress: () => {
          void pickAndUpload('library');
        },
      },
    ];

    if (Platform.OS !== 'web') {
      buttons.push({
        text: 'Take photo',
        onPress: () => {
          void pickAndUpload('camera');
        },
      });
    }

    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert('Profile photo', 'Choose a source', buttons);
  };

  const handleRemovePhoto = () => {
    if (isGuest || !avatarPath) return;
    Alert.alert('Remove photo', 'Remove your profile picture?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              setUploading(true);
              await removeMyAvatar();
              onAvatarChanged(null);
              showSuccessToast('Photo removed');
            } catch (err) {
              showErrorToast(err, 'Could not remove your profile photo.');
            } finally {
              setUploading(false);
            }
          })();
        },
      },
    ]);
  };

  // /** TEMP: clears guest prefs / cart / onboarding flag, signs out, reloads. */
  // const handleResetLocalData = () => {
  //   Alert.alert(
  //     'Reset local data',
  //     'Clear guest cart, favorites, onboarding, and sign out? The app will reload.',
  //     [
  //       { text: 'Cancel', style: 'cancel' },
  //       {
  //         text: 'Reset',
  //         style: 'destructive',
  //         onPress: () => {
  //           requestClose(() => {
  //             void (async () => {
  //               try {
  //                 clearLocalData();
  //                 await onSignOut();
  //               } catch {
  //                 // Still reload so a partial clear is usable.
  //               }
  //               if (Platform.OS === 'web' && typeof window !== 'undefined') {
  //                 window.location.reload();
  //                 return;
  //               }
  //               DevSettings.reload();
  //             })();
  //           });
  //         },
  //       },
  //     ],
  //   );
  // };

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      onRequestClose={() => requestClose()}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => requestClose()} />
        </Animated.View>
        <Animated.View
          style={[
            styles.panel,
            {
              width: panelWidth,
              backgroundColor: theme.background,
              paddingTop: insets.top + Spacing.three,
              paddingBottom: insets.bottom + Spacing.three,
              borderRightColor: theme.borderInk,
              transform: [{ translateX }],
            },
          ]}>
          <View style={styles.header}>
            <ThemedText type="smallBold" style={styles.title}>
              Profile
            </ThemedText>
            <Pressable
              onPress={() => requestClose()}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close">
              <SymbolView
                name={{ ios: 'xmark', android: 'close', web: 'close' }}
                size={20}
                tintColor={theme.text}
              />
            </Pressable>
          </View>

          <View style={styles.avatarBlock}>
            <Pressable
              onPress={handleChangePhoto}
              disabled={uploading || isGuest}
              style={[
                styles.avatarRing,
                {
                  backgroundColor: theme.backgroundElement,
                  borderColor: theme.borderInk,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={isGuest ? 'Guest account' : 'Change profile photo'}>
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImage} contentFit="cover" />
              ) : (
                <SymbolView
                  name={{
                    ios: 'person.crop.circle.fill',
                    android: 'account_circle',
                    web: 'account_circle',
                  }}
                  size={72}
                  tintColor={theme.textSecondary}
                />
              )}
              {uploading ? (
                <View style={styles.avatarOverlay}>
                  <ActivityIndicator color={theme.primaryText} />
                </View>
              ) : null}
            </Pressable>
            {!isGuest ? (
              <Pressable onPress={handleChangePhoto} disabled={uploading}>
                <ThemedText type="linkPrimary">Change photo</ThemedText>
              </Pressable>
            ) : null}
            {!isGuest && avatarPath ? (
              <Pressable onPress={handleRemovePhoto} disabled={uploading}>
                <ThemedText type="small" themeColor="textSecondary">
                  Remove photo
                </ThemedText>
              </Pressable>
            ) : null}
          </View>

          <View
            style={[
              styles.card,
              { backgroundColor: theme.backgroundElement, borderColor: theme.borderInk },
            ]}>
            <ThemedText type="smallBold">
              {isGuest ? 'Guest account' : displayName?.trim() || 'Butter shopper'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {isGuest
                ? "You're browsing without an account. Sign up or log in to save your cart and preferences."
                : 'Signed in'}
            </ThemedText>
          </View>

          <View
            style={[
              styles.card,
              {
                backgroundColor: theme.backgroundElement,
                borderColor: theme.borderInk,
                gap: Spacing.two,
              },
            ]}>
            <ThemedText type="smallBold">
              Grocery cash back
              {cashbackBps != null ? `: ${cashbackBps / 100}%` : ': off'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Used with Visa offers when comparing stores. No card numbers stored.
            </ThemedText>
            <View style={styles.cashbackRow}>
              {[100, 200, 300].map((bps) => (
                <ButterChip
                  key={bps}
                  label={`${bps / 100}%`}
                  selected={cashbackBps === bps}
                  onPress={() => {
                    void (async () => {
                      const next = cashbackBps === bps ? null : bps;
                      setCashbackBps(next);
                      try {
                        await setGroceryCashbackBps(next, isGuest);
                      } catch (err) {
                        showErrorToast(err, 'Could not save cash back.');
                      }
                    })();
                  }}
                />
              ))}
            </View>
          </View>

          <View style={[styles.card, { backgroundColor: theme.backgroundElement, gap: Spacing.two }]}>
            <View style={styles.settingRow}>
              <View style={styles.settingCopy}>
                <ThemedText type="smallBold">AI text reply sounds</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  When you type to Butter AI, play a spoken reply. Push-to-talk always speaks.
                </ThemedText>
              </View>
              <Switch
                value={aiTextAudio}
                onValueChange={(next) => {
                  setAiTextAudio(next);
                  setAiTextReplyAudioEnabled(next);
                }}
                trackColor={{ false: theme.border, true: theme.primary }}
                thumbColor={theme.background}
                accessibilityLabel="AI text reply sounds"
              />
            </View>
            <ThemedText type="smallBold">AI voice</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Woman and man read the reply.
            </ThemedText>
            <View style={styles.cashbackRow}>
              {(
                [
                  ['female', 'Woman'],
                  ['male', 'Man'],
                  ['cow', 'Cow'],
                ] as const
              ).map(([id, label]) => (
                <ButterChip
                  key={id}
                  label={label}
                  selected={aiVoice === id}
                  onPress={() => {
                    setAiVoiceChoice(id);
                    setAiVoice(id);
                  }}
                />
              ))}
            </View>
          </View>

          <Pressable
            onPress={() =>
              requestClose(() => {
                onClose();
                router.push('/settings');
              })
            }
            style={[styles.outlineBtn, { borderColor: theme.border }]}
            accessibilityRole="button"
            accessibilityLabel="Settings">
            <ThemedText type="smallBold">Settings</ThemedText>
          </Pressable>

          {isGuest ? (
            <View style={styles.authActions}>
              <ButterButton
                label="Sign up"
                variant="ink"
                onPress={() => requestClose(() => onRequestAuth('signUp'))}
              />
              <ButterButton
                label="Log in"
                variant="ghost"
                onPress={() => requestClose(() => onRequestAuth('logIn'))}
              />
            </View>
          ) : (
            <Pressable
              onPress={() => requestClose(onSignOut)}
              style={[styles.outlineBtn, { borderColor: theme.border }]}>
              <ThemedText type="smallBold">Sign out</ThemedText>
            </Pressable>
          )}

          {/* TEMP: testing only — remove before shipping */}
          {/* <Pressable
            onPress={handleResetLocalData}
            style={[styles.outlineBtn, { borderColor: theme.border, marginTop: 'auto' }]}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Reset local data
            </ThemedText>
          </Pressable> */}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: SheetChrome.scrim,
  },
  panel: {
    height: '100%',
    borderRightWidth: 2,
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: Type.section,
  },
  cashbackRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  settingCopy: {
    flex: 1,
    gap: Spacing.one,
  },
  avatarBlock: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  avatarRing: {
    width: 112,
    height: 112,
    borderRadius: 56,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: SheetChrome.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: Radius.card,
    borderWidth: 2,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  authActions: {
    gap: Spacing.two,
  },
  outlineBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Radius.button,
    borderWidth: 2,
  },
});
