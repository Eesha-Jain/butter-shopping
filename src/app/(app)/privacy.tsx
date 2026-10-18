import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export default function PrivacyScreen() {
  const theme = useTheme();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button">
          <ThemedText type="linkPrimary">Back</ThemedText>
        </Pressable>
        <ThemedText type="subtitle">Privacy</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          What Butter keeps, and what it sends on so a request can be understood.
        </ThemedText>

        <ThemedText type="smallBold">The assistant and your location</ThemedText>
        <ThemedText>
          The assistant is given your saved address, or the place your phone is when you talk and
          location is already allowed. It uses that only to talk about nearby stores. It cannot
          browse the web or look up arbitrary sites. It has no open internet tool.
        </ThemedText>

        <ThemedText type="smallBold">Voice</ThemedText>
        <ThemedText>
          A push-to-talk clip is sent once to be transcribed, then read only to name grocery items.
          The recording is not saved, and there is no voice profile. On this device, only the text
          of the last three voice requests is kept, so a clarification can refer to them. Older
          texts are dropped. The grocery items that get added stay on your shopping list. Typed
          messages follow the same path without a recording.
        </ThemedText>

        <ThemedText type="smallBold">Recipes</ThemedText>
        <ThemedText>
          Pasted text, a link, or a photo is read to pull out ingredients. We save the recipe and
          those ingredients. The photo is not stored.
        </ThemedText>

        <ThemedText type="smallBold">Payments</ThemedText>
        <ThemedText>
          We never ask for or store a credit card number. Grocery cash back is a percent you
          choose. Visa lines are sample store offers, not your card.
        </ThemedText>

        <ThemedText type="smallBold">Your account</ThemedText>
        <ThemedText>
          Email and sign-in are stored with your account. A signed-in shopper can also have a
          display name, profile photo, food preferences, demographics (student, veteran, senior,
          SNAP, college), a saved address, and list items. A guest keeps preferences on this device
          until they create an account.
        </ThemedText>

        <ThemedText type="smallBold">Who receives it</ThemedText>
        <ThemedText>
          Your account and lists are stored in Supabase. ElevenLabs hears a voice clip and speaks
          the reply. xAI reads the transcript or recipe so we can turn it into grocery items.
          Neither is given a way to browse the web for you.
        </ThemedText>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  content: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: BottomTabInset + Spacing.four,
  },
});
