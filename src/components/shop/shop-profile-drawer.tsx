import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  DevSettings,
  Easing,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  clearLocalData,
  getEffectiveGroceryCashbackBps,
  publicImageUrl,
  removeMyAvatar,
  setGroceryCashbackBps,
  showErrorToast,
  showSuccessToast,
  uploadMyAvatar,
} from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
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
  onSignIn: () => void;
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
  onSignIn,
  onAvatarChanged,
}: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const panelWidth = Math.min(320, Math.round(width * 0.82));
  const [uploading, setUploading] = useState(false);
  const [cashbackBps, setCashbackBps] = useState<number | null>(null);
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
      onSignIn();
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
      onSignIn();
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

  /** TEMP: clears guest prefs / cart / onboarding flag, signs out, reloads. */
  const handleResetLocalData = () => {
    Alert.alert(
      'Reset local data',
      'Clear guest cart, favorites, onboarding, and sign out? The app will reload.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            requestClose(() => {
              void (async () => {
                try {
                  clearLocalData();
                  await onSignOut();
                } catch {
                  // Still reload so a partial clear is usable.
                }
                if (Platform.OS === 'web' && typeof window !== 'undefined') {
                  window.location.reload();
                  return;
                }
                DevSettings.reload();
              })();
            });
          },
        },
      ],
    );
  };

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
              borderRightColor: theme.border,
              transform: [{ translateX }],
            },
          ]}>
          <View style={styles.header}>
            <ThemedText type="subtitle">Profile</ThemedText>
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
              disabled={uploading}
              style={[styles.avatarRing, { backgroundColor: theme.backgroundElement }]}
              accessibilityRole="button"
              accessibilityLabel="Change profile photo">
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
            <Pressable onPress={handleChangePhoto} disabled={uploading}>
              <ThemedText type="linkPrimary">
                {isGuest ? 'Sign in to add a photo' : 'Change photo'}
              </ThemedText>
            </Pressable>
            {!isGuest && avatarPath ? (
              <Pressable onPress={handleRemovePhoto} disabled={uploading}>
                <ThemedText type="small" themeColor="textSecondary">
                  Remove photo
                </ThemedText>
              </Pressable>
            ) : null}
          </View>

          <View style={[styles.card, { backgroundColor: theme.backgroundElement }]}>
            <ThemedText type="smallBold">
              {isGuest ? 'Guest' : displayName?.trim() || 'Butter shopper'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {isGuest ? 'Browsing without an account' : 'Signed in'}
            </ThemedText>
          </View>

          <View style={[styles.card, { backgroundColor: theme.backgroundElement, gap: Spacing.two }]}>
            <ThemedText type="smallBold">
              Grocery cash back
              {cashbackBps != null ? `: ${cashbackBps / 100}%` : ': off'}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Used with Visa offers when comparing stores. No card numbers stored.
            </ThemedText>
            <View style={styles.cashbackRow}>
              {[100, 200, 300].map((bps) => (
                <Pressable
                  key={bps}
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
                  style={[
                    styles.cashbackChip,
                    {
                      borderColor: theme.border,
                      backgroundColor:
                        cashbackBps === bps ? theme.backgroundSelected : theme.background,
                    },
                  ]}>
                  <ThemedText type="smallBold">{bps / 100}%</ThemedText>
                </Pressable>
              ))}
            </View>
          </View>

          {isGuest ? (
            <Pressable
              onPress={() => requestClose(onSignIn)}
              style={[styles.primaryBtn, { backgroundColor: theme.primary }]}>
              <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
                Sign in
              </ThemedText>
            </Pressable>
          ) : (
            <Pressable
              onPress={() => requestClose(onSignOut)}
              style={[styles.outlineBtn, { borderColor: theme.border }]}>
              <ThemedText type="smallBold">Sign out</ThemedText>
            </Pressable>
          )}

          {/* TEMP: testing only — remove before shipping */}
          <Pressable
            onPress={handleResetLocalData}
            style={[styles.outlineBtn, { borderColor: theme.border, marginTop: 'auto' }]}>
            <ThemedText type="smallBold" themeColor="textSecondary">
              Reset local data
            </ThemedText>
          </Pressable>
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
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  panel: {
    height: '100%',
    borderRightWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    gap: Spacing.three,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cashbackRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  cashbackChip: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
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
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.one,
  },
  primaryBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
  },
  outlineBtn: {
    alignItems: 'center',
    paddingVertical: Spacing.three,
    borderRadius: Spacing.three,
    borderWidth: 1,
  },
});
