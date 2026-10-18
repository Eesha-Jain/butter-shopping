import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { useActiveList } from '@/auth/active-list';
import {
  createGroup,
  getGroup,
  joinGroup,
  leaveGroup,
  listGroupMembersWithProfiles,
  showSuccessToast,
  type Group,
  type GroupMemberWithProfile,
} from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { ButterButton } from '@/components/ui/butter-button';
import { ButterChip } from '@/components/ui/butter-chip';
import { Fonts, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Tab = 'groups' | 'create' | 'join';

async function shareInvite(group: Pick<Group, 'name' | 'invite_code'>) {
  if (!group.invite_code) return;
  try {
    await Share.share({
      message: `Join "${group.name}" on Butter with invite code: ${group.invite_code}`,
    });
  } catch {
    showSuccessToast('Invite code', group.invite_code);
  }
}

export default function GroupsScreen() {
  const theme = useTheme();
  const { targets, refreshTargets, selectGroupId } = useActiveList();
  const [tab, setTab] = useState<Tab>('groups');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [membersByGroup, setMembersByGroup] = useState<Record<string, GroupMemberWithProfile[]>>(
    {},
  );
  const [loadingMembersId, setLoadingMembersId] = useState<string | null>(null);

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

  const toggleGroup = async (group: Group) => {
    if (expandedId === group.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(group.id);
    if (membersByGroup[group.id]) return;
    setLoadingMembersId(group.id);
    try {
      const rows = await listGroupMembersWithProfiles(group.id);
      setMembersByGroup((prev) => ({ ...prev, [group.id]: rows }));
    } catch {
      setMembersByGroup((prev) => ({ ...prev, [group.id]: [] }));
    } finally {
      setLoadingMembersId(null);
    }
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
      backgroundColor: theme.backgroundElement,
      borderColor: theme.borderInk,
      color: theme.text,
    },
  ];

  const inviteBlock = (group: Group) => (
    <View style={[styles.inviteBox, { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText type="small" themeColor="textSecondary">
        Invite code
      </ThemedText>
      <ThemedText selectable style={styles.inviteCode}>
        {group.invite_code}
      </ThemedText>
      <Pressable
        onPress={() => void shareInvite(group)}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.linkBtn,
          { backgroundColor: theme.primary, opacity: pressed ? 0.85 : 1 },
        ]}>
        <SymbolView
          name={{ ios: 'link', android: 'link', web: 'link' }}
          size={18}
          tintColor={theme.primaryText}
        />
        <ThemedText type="smallBold" style={{ color: theme.primaryText }}>
          Share invite
        </ThemedText>
      </Pressable>
    </View>
  );

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
            const members = membersByGroup[group.id];
            return (
              <View
                key={group.id}
                style={[
                  styles.groupCard,
                  { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                ]}>
                <Pressable
                  onPress={() => void toggleGroup(group)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  style={styles.groupHeader}>
                  <View style={styles.groupTitle}>
                    <ThemedText type="smallBold">{group.name}</ThemedText>
                    {isPersonal ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        Just you
                      </ThemedText>
                    ) : null}
                  </View>
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

                    {loadingMembersId === group.id ? (
                      <ActivityIndicator color={theme.secondary} />
                    ) : members && members.length > 0 && !isPersonal ? (
                      <View style={styles.memberList}>
                        {members.map((member) => (
                          <View key={member.id} style={styles.memberRow}>
                            <ThemedText type="small">
                              {member.display_name?.trim() || 'Member'}
                            </ThemedText>
                            <ThemedText type="small" themeColor="textSecondary">
                              {member.role}
                            </ThemedText>
                          </View>
                        ))}
                      </View>
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
          <TextInput
            value={createName}
            onChangeText={(value) => {
              setCreateName(value);
              if (created) setCreated(null);
            }}
            placeholder="Group name (e.g. Roommates)"
            placeholderTextColor={theme.textSecondary}
            editable={!busy}
            returnKeyType="done"
            onSubmitEditing={() => void onCreate()}
            style={inputStyle}
          />
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
  input: {
    borderWidth: 2,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two + 2,
    fontSize: 16,
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
  inviteCode: {
    fontFamily: Fonts.sansBold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: 3,
  },
  memberList: {
    gap: Spacing.one,
  },
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
