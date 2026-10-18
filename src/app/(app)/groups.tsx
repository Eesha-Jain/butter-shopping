import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useActiveList } from '@/auth/active-list';
import { useSession } from '@/auth/session';
import {
  createGroup,
  getGroup,
  joinGroup,
  leaveGroup,
  showErrorToast,
  showSuccessToast,
  type Group,
} from '@/backend';
import { MemberAvatar } from '@/components/groups/member-avatar';
import {
  loadShopperRotation,
  upNextOrder,
  type RotationMember,
  type ShopperRotation,
} from '@/components/groups/shopper-rotation';
import { ThemedText } from '@/components/themed-text';
import { ButterButton } from '@/components/ui/butter-button';
import { ButterChip } from '@/components/ui/butter-chip';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Tab = 'groups' | 'create' | 'join';

// Share.share opens the system sheet (UIActivityViewController on iOS, the
// chooser on Android), which lists Messages, Slack, Mail, Copy, etc.
async function shareInvite(group: Pick<Group, 'name' | 'invite_code'>) {
  if (!group.invite_code) return;
  try {
    await Share.share(
      {
        title: `Join ${group.name} on Butter`,
        message: `Join "${group.name}" on Butter! Open the app, go to Plan → Groups → Join, and enter invite code: ${group.invite_code}`,
      },
      { dialogTitle: 'Share invite', subject: `Join ${group.name} on Butter` },
    );
  } catch {
    showErrorToast('Could not open share options.');
  }
}

function InviteCodeCard({ group }: { group: Group }) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!group.invite_code) return null;
  const code = group.invite_code;

  const copy = async () => {
    await Clipboard.setStringAsync(code);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
  };

  return (
    <View style={[styles.inviteBox, { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText type="small" themeColor="textSecondary">
        Invite code
      </ThemedText>
      <Pressable
        onPress={() => void copy()}
        accessibilityRole="button"
        accessibilityLabel={`Copy invite code ${code}`}
        accessibilityHint="Copies the code to your clipboard"
        style={({ pressed }) => [
          styles.codeChip,
          {
            backgroundColor: theme.background,
            borderColor: copied ? theme.primary : theme.borderInk,
            opacity: pressed ? 0.75 : 1,
          },
        ]}>
        <ThemedText style={styles.inviteCode}>{code}</ThemedText>
        <SymbolView
          name={{
            ios: copied ? 'checkmark' : 'doc.on.doc',
            android: copied ? 'check' : 'content_copy',
            web: copied ? 'check' : 'content_copy',
          }}
          size={16}
          tintColor={copied ? theme.primary : theme.textSecondary}
        />
      </Pressable>
      <ThemedText type="small" themeColor="textSecondary">
        {copied ? 'Copied to clipboard' : 'Tap the code to copy'}
      </ThemedText>
      <Pressable
        onPress={() => void shareInvite(group)}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.linkBtn,
          styles.shareBtn,
          { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
        ]}>
        <SymbolView
          name={{ ios: 'square.and.arrow.up', android: 'share', web: 'share' }}
          size={18}
          tintColor={theme.primaryText}
        />
        <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
          Share invite
        </ThemedText>
      </Pressable>
    </View>
  );
}

export default function GroupsScreen() {
  const theme = useTheme();
  const { session } = useSession();
  const myUserId = session?.user.id ?? null;
  const { targets, refreshTargets, selectGroupId } = useActiveList();
  const [tab, setTab] = useState<Tab>('groups');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [rotationByGroup, setRotationByGroup] = useState<Record<string, ShopperRotation | null>>(
    {},
  );

  const [createName, setCreateName] = useState('');
  const [created, setCreated] = useState<Group | null>(null);

  const [joinCode, setJoinCode] = useState('');

  // A group can own several lists; show each group once.
  const groups = useMemo(() => {
    const seen = new Map<string, Group>();
    for (const target of targets) {
      if (!seen.has(target.group.id)) seen.set(target.group.id, target.group);
    }
    return [...seen.values()];
  }, [targets]);

  const sharedIdsKey = groups
    .filter((group) => group.kind !== 'personal')
    .map((group) => group.id)
    .join(',');

  // Load every shared group's roster up front so collapsed cards show avatars.
  useEffect(() => {
    let cancelled = false;
    const ids = sharedIdsKey ? sharedIdsKey.split(',') : [];
    void Promise.all(
      ids.map(async (id) => [id, await loadShopperRotation(id).catch(() => null)] as const),
    ).then((entries) => {
      if (!cancelled) setRotationByGroup(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [sharedIdsKey]);

  const toggleGroup = (group: Group) => {
    setExpandedId((current) => (current === group.id ? null : group.id));
  };

  const onCreate = async () => {
    const name = createName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const groupId = await createGroup({ name, kind: 'household' });
      const group = await getGroup(groupId);
      setCreated(group);
      setCreateName('');
      await selectGroupId(groupId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create that group.');
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async () => {
    const code = joinCode.trim();
    if (!code || busy) return;
    setBusy(true);
    setError(null);
    try {
      const groupId = await joinGroup(code);
      showSuccessToast('Joined group', 'You can shop on their list now.');
      setJoinCode('');
      await selectGroupId(groupId);
      setExpandedId(groupId);
      setTab('groups');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join with that code.');
    } finally {
      setBusy(false);
    }
  };

  const onPasteInviteCode = async () => {
    try {
      const code = (await Clipboard.getStringAsync()).trim();
      if (!code) {
        showErrorToast(new Error('No text found in the clipboard.'));
        return;
      }
      setJoinCode(code.toUpperCase());
    } catch (err) {
      showErrorToast(err, 'Could not read the clipboard.');
    }
  };

  const onLeave = async (group: Group) => {
    if (group.kind === 'personal' || busy) return;
    setBusy(true);
    setError(null);
    try {
      await leaveGroup(group.id);
      showSuccessToast('Left group', group.name);
      setExpandedId(null);
      await refreshTargets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not leave that group.');
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = [
    styles.input,
    {
      backgroundColor: theme.background,
      borderColor: theme.borderInk,
      color: theme.text,
    },
  ];
  const labelStyle = [styles.label, { color: theme.textSecondary }];

  const inviteBlock = (group: Group) => <InviteCodeCard group={group} />;

  return (
    <ScrollView
      style={styles.screen}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.body}>
      <View style={styles.tabs}>
        <ButterChip label="My groups" selected={tab === 'groups'} onPress={() => setTab('groups')} />
        <ButterChip label="Create" selected={tab === 'create'} onPress={() => setTab('create')} />
        <ButterChip label="Join" selected={tab === 'join'} onPress={() => setTab('join')} />
      </View>

      {error ? (
        <ThemedText type="small" style={{ color: theme.error }}>
          {error}
        </ThemedText>
      ) : null}

      {tab === 'groups' ? (
        <View style={styles.section}>
          {groups.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No groups yet.
            </ThemedText>
          ) : null}
          {groups.map((group) => {
            const open = expandedId === group.id;
            const isPersonal = group.kind === 'personal';
            const rotation = rotationByGroup[group.id];
            const turnOrder = rotation ? upNextOrder(rotation) : [];
            const lastShopper = rotation?.members.find(
              (member) => member.userId === rotation.lastShopperId,
            );
            const displayName = (member: RotationMember) =>
              member.userId === myUserId ? 'You' : member.name;
            return (
              <View
                key={group.id}
                style={[
                  styles.groupCard,
                  { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                ]}>
                <Pressable
                  onPress={() => toggleGroup(group)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  style={styles.groupHeader}>
                  <View style={styles.groupTitle}>
                    <ThemedText type="smallBold">{group.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {isPersonal
                        ? 'Just you'
                        : turnOrder[0]
                          ? `${displayName(turnOrder[0])} ${turnOrder[0].userId === myUserId ? 'are' : 'is'} up next`
                          : rotation === undefined
                            ? 'Loading…'
                            : 'Shared group'}
                    </ThemedText>
                  </View>
                  {!isPersonal && turnOrder.length > 0 ? (
                    <View style={styles.avatarStack}>
                      {turnOrder.slice(0, 4).map((member, index) => (
                        <MemberAvatar
                          key={member.userId}
                          userId={member.userId}
                          name={member.name}
                          avatarUrl={member.avatarUrl}
                          size={28}
                          ringColor={index === 0 ? theme.primary : theme.backgroundElement}
                          style={[styles.stacked, { zIndex: 10 - index }]}
                        />
                      ))}
                      {turnOrder.length > 4 ? (
                        <ThemedText type="small" themeColor="textSecondary" style={styles.more}>
                          +{turnOrder.length - 4}
                        </ThemedText>
                      ) : null}
                    </View>
                  ) : null}
                  <SymbolView
                    name={{
                      ios: open ? 'chevron.up' : 'chevron.down',
                      android: open ? 'expand_less' : 'expand_more',
                      web: open ? 'expand_less' : 'expand_more',
                    }}
                    size={16}
                    tintColor={theme.textSecondary}
                  />
                </Pressable>

                {open ? (
                  <View style={styles.groupBody}>
                    {isPersonal ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        Your personal list isn&apos;t shared. Create a group to shop with others.
                      </ThemedText>
                    ) : group.invite_code ? (
                      inviteBlock(group)
                    ) : null}

                    {!isPersonal ? (
                      rotation === undefined ? (
                        <ActivityIndicator color={theme.secondary} />
                      ) : turnOrder.length > 0 ? (
                        <View style={styles.section}>
                          <View>
                            <ThemedText type="smallBold">Shopping rotation</ThemedText>
                            <ThemedText type="small" themeColor="textSecondary">
                              Each grocery run goes to the next person. It moves on once
                              someone places an order.
                            </ThemedText>
                          </View>
                          {turnOrder.map((member, index) => {
                            const isNext = index === 0;
                            const isLast = member.userId === lastShopper?.userId;
                            return (
                              <View
                                key={member.userId}
                                style={[
                                  styles.turnRow,
                                  isNext && {
                                    backgroundColor: theme.backgroundSelected,
                                    borderColor: theme.borderInk,
                                  },
                                  !isNext && { borderColor: 'transparent' },
                                ]}>
                                <ThemedText
                                  type="smallBold"
                                  themeColor={isNext ? 'text' : 'textSecondary'}
                                  style={styles.turnNum}>
                                  {index + 1}
                                </ThemedText>
                                <MemberAvatar
                                  userId={member.userId}
                                  name={member.name}
                                  avatarUrl={member.avatarUrl}
                                  size={36}
                                  ringColor={isNext ? theme.borderInk : theme.border}
                                />
                                <ThemedText type={isNext ? 'smallBold' : 'small'} style={styles.turnName}>
                                  {displayName(member)}
                                </ThemedText>
                                {isNext ? (
                                  <View style={[styles.tag, { backgroundColor: theme.secondary }]}>
                                    <ThemedText type="smallBold" style={[styles.tagText, { color: theme.primary }]}>
                                      Up next
                                    </ThemedText>
                                  </View>
                                ) : isLast ? (
                                  <ThemedText type="small" themeColor="textSecondary">
                                    Shopped last
                                  </ThemedText>
                                ) : null}
                              </View>
                            );
                          })}
                        </View>
                      ) : (
                        <ThemedText type="small" themeColor="textSecondary">
                          Couldn&apos;t load members.
                        </ThemedText>
                      )
                    ) : null}

                    {!isPersonal ? (
                      <Pressable
                        onPress={() => void onLeave(group)}
                        disabled={busy}
                        accessibilityRole="button"
                        hitSlop={8}>
                        <ThemedText type="small" style={{ color: theme.error }}>
                          {busy ? 'Leaving…' : 'Leave group'}
                        </ThemedText>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {tab === 'create' ? (
        <View style={styles.section}>
          <ThemedText type="small" themeColor="textSecondary">
            Name your group, then send the invite code to anyone you want to shop with.
          </ThemedText>
          <View style={styles.field}>
            <Text style={labelStyle}>Group name</Text>
            <TextInput
              value={createName}
              onChangeText={(value) => {
                setCreateName(value);
                if (created) setCreated(null);
              }}
              placeholder="e.g. Roommates"
              autoCapitalize="words"
              placeholderTextColor={theme.textSecondary}
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={() => void onCreate()}
              style={inputStyle}
            />
          </View>
          <Pressable
            onPress={() => void onCreate()}
            disabled={busy || !createName.trim()}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.linkBtn,
              styles.fullBtn,
              {
                backgroundColor: theme.primary,
                opacity: busy || !createName.trim() ? 0.55 : pressed ? 0.88 : 1,
              },
            ]}>
            {busy ? (
              <ActivityIndicator color={theme.primaryText} />
            ) : (
              <SymbolView
                name={{ ios: 'link', android: 'link', web: 'link' }}
                size={18}
                tintColor={theme.primaryText}
              />
            )}
            <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
              Generate invite code
            </ThemedText>
          </Pressable>

          {created?.invite_code ? (
            <View style={styles.section}>
              <ThemedText type="smallBold">{created.name} is ready</ThemedText>
              {inviteBlock(created)}
            </View>
          ) : null}
        </View>
      ) : null}

      {tab === 'join' ? (
        <View style={styles.section}>
          <ThemedText type="small" themeColor="textSecondary">
            Enter the invite code someone shared with you.
          </ThemedText>
          <View style={styles.field}>
            <View style={styles.fieldHeader}>
              <Text style={labelStyle}>Invite code</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Paste invite code from clipboard"
                accessibilityState={{ disabled: busy }}
                disabled={busy}
                onPress={() => void onPasteInviteCode()}
                style={({ pressed }) => [
                  styles.pasteButton,
                  { opacity: pressed || busy ? 0.65 : 1 },
                ]}>
                <Text style={[styles.pasteLabel, { color: theme.primaryText }]}>
                  Paste from clipboard
                </Text>
              </Pressable>
            </View>
            <TextInput
              value={joinCode}
              onChangeText={setJoinCode}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="ABCD1234"
              placeholderTextColor={theme.textSecondary}
              editable={!busy}
              returnKeyType="go"
              onSubmitEditing={() => void onJoin()}
              style={inputStyle}
            />
          </View>
          <ButterButton
            label={busy ? 'Joining…' : 'Join group'}
            variant="ink"
            disabled={busy || !joinCode.trim()}
            onPress={() => void onJoin()}
            style={styles.fullBtn}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  body: {
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.six,
  },
  section: {
    gap: Spacing.two,
  },
  field: {
    gap: Spacing.one,
  },
  fieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.two,
  },
  pasteButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.two,
  },
  pasteLabel: {
    fontFamily: Fonts.sansBold,
    fontSize: 14,
  },
  label: {
    fontFamily: Fonts.sans,
    fontSize: 14,
  },
  input: {
    fontFamily: Fonts.sans,
    fontSize: 16,
    borderWidth: 2,
    borderRadius: Radius.input,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 4,
  },
  fullBtn: {
    minHeight: 48,
    borderRadius: Radius.button,
  },
  linkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    borderRadius: Radius.chip,
  },
  groupCard: {
    borderWidth: 1,
    borderRadius: Radius.card,
    overflow: 'hidden',
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
    gap: Spacing.two,
  },
  groupTitle: {
    flex: 1,
    gap: 2,
  },
  groupBody: {
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
    gap: Spacing.three,
  },
  inviteBox: {
    borderRadius: Radius.chip,
    padding: Spacing.three,
    gap: Spacing.two,
    alignItems: 'center',
  },
  codeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 2,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  shareBtn: {
    alignSelf: 'stretch',
    minHeight: 44,
  },
  inviteCode: {
    fontFamily: Fonts.sansBold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: 3,
  },
  memberList: {
    gap: Spacing.one,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stacked: {
    marginLeft: -8,
  },
  more: {
    marginLeft: Spacing.one,
  },
  turnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    borderWidth: 2,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one + 2,
  },
  turnNum: {
    width: 16,
    textAlign: 'center',
  },
  turnName: {
    flex: 1,
  },
  tag: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 2,
  },
  tagText: {
    fontSize: 12,
    lineHeight: 16,
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
