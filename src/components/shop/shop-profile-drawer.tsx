import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  publicImageUrl,
  removeMyAvatar,
  showErrorToast,
  showSuccessToast,
  uploadMyAvatar,
} from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Props = {
  visible: boolean;
  displayName: string | null;
  avatarPath: string | null;
  avatarVersion: number;
  isGuest: boolean;
  onClose: () => void;
  onSignOut: () => void;
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

  const avatarBaseUrl = publicImageUrl('avatars', avatarPath);
  const avatarUrl = avatarBaseUrl ? `${avatarBaseUrl}?t=${avatarVersion}` : null;

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

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View
          style={[
            styles.panel,
            {
              width: panelWidth,
              backgroundColor: theme.background,
              paddingTop: insets.top + Spacing.three,
              paddingBottom: insets.bottom + Spacing.three,
              borderRightColor: theme.border,
            },
          ]}>
          <View style={styles.header}>
            <ThemedText type="subtitle">Profile</ThemedText>
            <Pressable onPress={onClose}>
              <ThemedText type="linkPrimary">Close</ThemedText>
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

          {isGuest ? (
            <Pressable
              onPress={onSignIn}
              style={[styles.primaryBtn, { backgroundColor: theme.primary }]}>
              <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
                Sign in
              </ThemedText>
            </Pressable>
          ) : (
            <Pressable
              onPress={onSignOut}
              style={[styles.outlineBtn, { borderColor: theme.border }]}>
              <ThemedText type="smallBold">Sign out</ThemedText>
            </Pressable>
          )}
        </View>
        <Pressable style={styles.backdrop} onPress={onClose} />
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
    flex: 1,
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
