import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {
  addRecipeToListWithCaution,
  formatLocalDateTime,
  importRecipeFromImage,
  importRecipeFromText,
  importRecipeFromUrl,
  previewRecipeForList,
  runAction,
  showErrorToast,
  showSuccessToast,
  type RecipeListPreview,
} from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Mode = 'text' | 'url' | 'photo';

export default function RecipeImportScreen() {
  const theme = useTheme();
  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [clipboardUrl, setClipboardUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RecipeListPreview | null>(null);
  const [forcedIds, setForcedIds] = useState<string[]>([]);

  const resetPreview = () => {
    setPreview(null);
    setForcedIds([]);
  };

  const afterImport = async (recipeId: string) => {
    const next = await previewRecipeForList(recipeId);
    setPreview(next);
    setForcedIds([]);
  };

  const onImportText = async () => {
    if (busy) return;
    const trimmed = text.trim();
    if (!trimmed) {
      showErrorToast(new Error('Paste a recipe first.'));
      return;
    }
    setBusy(true);
    try {
      const imported = await runAction(
        () => importRecipeFromText({ text: trimmed }),
        'Could not import that recipe.',
      );
      showSuccessToast('Recipe imported', imported.title);
      await afterImport(imported.recipeId);
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  };

  const onImportUrl = async () => {
    if (busy) return;
    const trimmed = url.trim();
    if (!/^https?:\/\//i.test(trimmed)) {
      showErrorToast(new Error('Enter a full recipe URL (https://…).'));
      return;
    }
    setBusy(true);
    try {
      const imported = await runAction(
        () => importRecipeFromUrl(trimmed),
        'Could not import that recipe URL.',
      );
      showSuccessToast('Recipe imported', imported.title);
      await afterImport(imported.recipeId);
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  };

  const onPreviewClipboard = async () => {
    if (busy) return;
    try {
      const clipboardText = (await Clipboard.getStringAsync()).trim();
      if (!clipboardText) {
        setClipboardUrl(null);
        showErrorToast(new Error('No text found in the clipboard.'));
        return;
      }
      setClipboardUrl(clipboardText);
    } catch (err) {
      showErrorToast(err, 'Could not read the clipboard.');
    }
  };

  const pickAndImportImage = async (source: 'camera' | 'library' | 'document') => {
    if (busy) return;
    try {
      let uri: string | null = null;
      let contentType = 'image/jpeg';

      if (source === 'document') {
        const picked = await DocumentPicker.getDocumentAsync({
          type: ['image/*'],
          copyToCacheDirectory: true,
          multiple: false,
        });
        if (picked.canceled || !picked.assets?.[0]?.uri) return;
        uri = picked.assets[0].uri;
        contentType = picked.assets[0].mimeType ?? 'image/jpeg';
        if (!contentType.startsWith('image/')) {
          showErrorToast(new Error('Pick a photo of the recipe (PDF OCR comes later).'));
          return;
        }
      } else if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          showErrorToast(new Error('Camera access is required for recipe photos.'));
          return;
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ['images'],
          quality: 0.75,
        });
        if (result.canceled || !result.assets?.[0]?.uri) return;
        uri = result.assets[0].uri;
        contentType = result.assets[0].mimeType ?? 'image/jpeg';
      } else {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          showErrorToast(new Error('Photo library access is required for recipe photos.'));
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.75,
        });
        if (result.canceled || !result.assets?.[0]?.uri) return;
        uri = result.assets[0].uri;
        contentType = result.assets[0].mimeType ?? 'image/jpeg';
      }

      if (!uri) return;
      setBusy(true);
      const imageBase64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const imported = await runAction(
        () => importRecipeFromImage({ imageBase64, contentType }),
        'Could not read that recipe photo.',
      );
      showSuccessToast('Recipe imported', imported.title);
      await afterImport(imported.recipeId);
    } catch (err) {
      showErrorToast(err, 'Could not import that photo.');
    } finally {
      setBusy(false);
    }
  };

  const toggleForce = (ingredientId: string) => {
    setForcedIds((current) =>
      current.includes(ingredientId)
        ? current.filter((id) => id !== ingredientId)
        : [...current, ingredientId],
    );
  };

  const onAddToList = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      const result = await runAction(
        () =>
          addRecipeToListWithCaution({
            recipeId: preview.recipeId,
            forceIngredientIds: forcedIds,
          }),
        'Could not add recipe items to your list.',
      );
      showSuccessToast(
        'List updated',
        result.added === 0
          ? 'Nothing new was added.'
          : `Added ${result.added} item${result.added === 1 ? '' : 's'}.`,
      );
      router.replace('/list');
    } catch {
      // toasted
    } finally {
      setBusy(false);
    }
  };

  const willAddCount = preview
    ? preview.willAdd.length +
      preview.skipped.filter(
        (row) => row.reason === 'still_have' && forcedIds.includes(row.ingredientId),
      ).length
    : 0;

  return (
    <ScrollView
      style={styles.safe}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <ThemedText type="small" themeColor="textSecondary">
        Paste text, drop a link, or photograph a recipe. Items you may still have are left off until
        you add them.
      </ThemedText>

      <View style={styles.modeRow}>
        {(['text', 'url', 'photo'] as const).map((key) => (
          <Pressable
            key={key}
            onPress={() => {
              setMode(key);
              setClipboardUrl(null);
              resetPreview();
            }}
            style={[
              styles.modeChip,
              {
                borderColor: theme.border,
                backgroundColor: mode === key ? theme.backgroundSelected : theme.backgroundElement,
              },
            ]}>
            <ThemedText type="smallBold">
              {key === 'text' ? 'Paste text' : key === 'url' ? 'URL' : 'Photo'}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      {!preview ? (
        <>
          {mode === 'text' ? (
            <>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Paste ingredients or a full recipe…"
                placeholderTextColor={theme.textSecondary}
                multiline
                textAlignVertical="top"
                style={[
                  styles.input,
                  styles.textArea,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundElement,
                  },
                ]}
                editable={!busy}
              />
              <Pressable
                onPress={() => void onImportText()}
                disabled={busy}
                style={[
                  styles.primaryBtn,
                  { backgroundColor: theme.primary, opacity: busy ? 0.7 : 1 },
                ]}>
                {busy ? (
                  <ActivityIndicator color={theme.primaryText} />
                ) : (
                  <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
                    Parse recipe
                  </ThemedText>
                )}
              </Pressable>
            </>
          ) : null}

          {mode === 'url' ? (
            <>
              <TextInput
                value={url}
                onChangeText={(value) => {
                  setUrl(value);
                  setClipboardUrl(null);
                }}
                placeholder="https://…"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                style={[
                  styles.input,
                  {
                    color: theme.text,
                    borderColor: theme.border,
                    backgroundColor: theme.backgroundElement,
                  },
                ]}
                editable={!busy}
              />
              <Pressable
                onPress={() => void onPreviewClipboard()}
                disabled={busy}
                accessibilityRole="button"
                style={[styles.secondaryBtn, { borderColor: theme.border }]}>
                <ThemedText type="smallBold">Preview clipboard</ThemedText>
              </Pressable>
              {clipboardUrl ? (
                <View
                  style={[
                    styles.clipboardPreview,
                    { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                  ]}>
                  <ThemedText type="smallBold">Clipboard contents</ThemedText>
                  <ThemedText
                    type="small"
                    themeColor="textSecondary"
                    numberOfLines={3}
                    ellipsizeMode="tail">
                    {clipboardUrl}
                  </ThemedText>
                  <Pressable
                    onPress={() => {
                      setUrl(clipboardUrl);
                      setClipboardUrl(null);
                    }}
                    accessibilityRole="button"
                    style={[styles.secondaryBtn, { borderColor: theme.border }]}>
                    <ThemedText type="smallBold">Use this URL</ThemedText>
                  </Pressable>
                </View>
              ) : null}
              <Pressable
                onPress={() => void onImportUrl()}
                disabled={busy}
                style={[
                  styles.primaryBtn,
                  { backgroundColor: theme.primary, opacity: busy ? 0.7 : 1 },
                ]}>
                {busy ? (
                  <ActivityIndicator color={theme.primaryText} />
                ) : (
                  <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
                    Import from URL
                  </ThemedText>
                )}
              </Pressable>
            </>
          ) : null}

          {mode === 'photo' ? (
            <View style={styles.photoActions}>
              <Pressable
                onPress={() => void pickAndImportImage('camera')}
                disabled={busy}
                style={[styles.secondaryBtn, { borderColor: theme.border }]}>
                <ThemedText type="smallBold">Take photo</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => void pickAndImportImage('library')}
                disabled={busy}
                style={[styles.secondaryBtn, { borderColor: theme.border }]}>
                <ThemedText type="smallBold">Photo library</ThemedText>
              </Pressable>
              <Pressable
                onPress={() => void pickAndImportImage('document')}
                disabled={busy}
                style={[styles.secondaryBtn, { borderColor: theme.border }]}>
                <ThemedText type="smallBold">Choose image file</ThemedText>
              </Pressable>
              {busy ? <ActivityIndicator color={theme.primary} /> : null}
            </View>
          ) : null}
        </>
      ) : (
        <View style={styles.preview}>
          <ThemedText type="smallBold">{preview.title}</ThemedText>

          <ThemedText type="smallBold" style={styles.sectionTitle}>
            Adding to list ({preview.willAdd.length})
          </ThemedText>
          {preview.willAdd.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Nothing new to add automatically.
            </ThemedText>
          ) : (
            preview.willAdd.map((line) => (
              <View
                key={line.ingredientId}
                style={[styles.lineRow, { backgroundColor: theme.backgroundElement }]}>
                <ThemedText type="small">{line.label}</ThemedText>
              </View>
            ))
          )}

          {preview.skipped.some((line) => line.reason !== 'not_in_catalog') ? (
            <View style={[styles.caution, { borderColor: theme.border }]}>
              <ThemedText type="smallBold">Not added — you may still have these</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Tap Add anyway if you already used them up.
              </ThemedText>
              {preview.skipped
                .filter((line) => line.reason !== 'not_in_catalog')
                .map((line) => {
                  const forced = forcedIds.includes(line.ingredientId);
                  return (
                    <View
                      key={line.ingredientId}
                      style={[styles.lineRow, { backgroundColor: theme.backgroundElement }]}>
                      <View style={styles.lineMeta}>
                        <ThemedText type="small">{line.label}</ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {line.reason === 'already_on_list'
                            ? 'Already on your open list'
                            : [
                                line.lastPurchasedAt
                                  ? `Bought ${formatLocalDateTime(line.lastPurchasedAt)}`
                                  : 'In recent purchases',
                                line.expiresOn ? `· good until ${line.expiresOn}` : null,
                              ]
                                .filter(Boolean)
                                .join(' ')}
                        </ThemedText>
                      </View>
                      <Pressable onPress={() => toggleForce(line.ingredientId)} hitSlop={6}>
                        <ThemedText type="small" themeColor="textSecondary">
                          {forced ? 'Will add' : 'Add anyway'}
                        </ThemedText>
                      </Pressable>
                    </View>
                  );
                })}
            </View>
          ) : null}

          {preview.skipped.some((line) => line.reason === 'not_in_catalog') ? (
            <View style={styles.preview}>
              <ThemedText type="smallBold">Item not found</ThemedText>
              {preview.skipped
                .filter((line) => line.reason === 'not_in_catalog')
                .map((line) => (
                  <View
                    key={line.ingredientId}
                    style={[styles.lineRow, { backgroundColor: theme.backgroundElement }]}>
                    <View style={styles.lineMeta}>
                      <ThemedText type="small">{line.label}</ThemedText>
                      <ThemedText type="small" themeColor="textSecondary">
                        Item not found
                      </ThemedText>
                    </View>
                  </View>
                ))}
            </View>
          ) : null}

          <Pressable
            onPress={() => void onAddToList()}
            disabled={busy || willAddCount === 0}
            style={[
              styles.primaryBtn,
              {
                backgroundColor: theme.primary,
                opacity: busy || willAddCount === 0 ? 0.6 : 1,
              },
            ]}>
            {busy ? (
              <ActivityIndicator color={theme.primaryText} />
            ) : (
              <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
                Add {willAddCount} item{willAddCount === 1 ? '' : 's'}
              </ThemedText>
            )}
          </Pressable>
          <Pressable onPress={resetPreview} disabled={busy}>
            <ThemedText type="small" themeColor="textSecondary">
              Import another recipe
            </ThemedText>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    gap: Spacing.three,
    paddingBottom: Spacing.six,
  },
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  modeChip: {
    borderWidth: 1,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  input: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    minHeight: 44,
  },
  textArea: {
    minHeight: 180,
  },
  primaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    borderRadius: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  clipboardPreview: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  photoActions: {
    gap: Spacing.two,
  },
  preview: {
    gap: Spacing.three,
  },
  sectionTitle: {
    marginTop: Spacing.two,
  },
  lineRow: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    gap: Spacing.one,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  lineMeta: {
    flex: 1,
    gap: 2,
    paddingRight: Spacing.two,
  },
  caution: {
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.three,
    gap: Spacing.two,
  },
});
