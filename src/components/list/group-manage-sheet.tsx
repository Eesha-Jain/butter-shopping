import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  createGroup,
  getGroup,
  joinGroup,
  leaveGroup,
  listGroupMembersWithProfiles,
  showSuccessToast,
  type ActiveListTarget,
  type GroupKind,
  type GroupMemberWithProfile,
} from '@/backend';
import { ThemedText } from '@/components/themed-text';
import { ButterButton } from '@/components/ui/butter-button';
import { ButterChip } from '@/components/ui/butter-chip';
import { Radius, Spacing, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type Tab = 'members' | 'create' | 'join';

type Props = {
  visible: boolean;
  activeTarget: ActiveListTarget | null;
  onClose: () => void;
  onGroupChanged: (groupId?: string) => Promise<void>;
};

function kindLabel(kind: GroupKind): string {
  if (kind === 'personal') return 'Personal';
  if (kind === 'household') return 'Household';
  return 'Party';
}

export function GroupManageSheet({ visible, activeTarget, onClose, onGroupChanged }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('members');
  const [members, setMembers] = useState<GroupMemberWithProfile[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createName, setCreateName] = useState('');
  const [createKind, setCreateKind] = useState<Extract<GroupKind, 'household' | 'event'>>('household');
  const [createdInvite, setCreatedInvite] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState('');

  const group = activeTarget?.group ?? null;
  const isShared = group != null && group.kind !== 'personal';

  const loadMembers = useCallback(async () => {
    if (!group) {
      setMembers([]);
      return;
    }
    setLoadingMembers(true);
    setError(null);
    try {
      setMembers(await listGroupMembersWithProfiles(group.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load members.');
      setMembers([]);
    } finally {
      setLoadingMembers(false);
    }
  }, [group]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      setTab('members');
      setError(null);
      setCreatedInvite(null);
      setCreateName('');
      setJoinCode('');
      void loadMembers();
    }, 0);
    return () => clearTimeout(timer);
  }, [visible, loadMembers]);

  const shareInvite = async (code: string) => {
    try {
      await Share.share({
        message: `Join my Butter grocery group with invite code: ${code}`,
      });
    } catch {
      showSuccessToast('Invite code', code);
    }
  };

  const onCreate = async () => {
    const name = createName.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const groupId = await createGroup({ name, kind: createKind });
      const created = await getGroup(groupId);
      setCreatedInvite(created.invite_code);
      showSuccessToast('Group created', created.invite_code ? 'Share the invite code.' : name);
      await onGroupChanged(groupId);
      if (created.invite_code) {
        setCreatedInvite(created.invite_code);
      }
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
      await onGroupChanged(groupId);
      setTab('members');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join with that code.');
    } finally {
      setBusy(false);
    }
  };

  const onLeave = async () => {
    if (!group || group.kind === 'personal' || busy) return;
    setBusy(true);
    setError(null);
    try {
      await leaveGroup(group.id);
      showSuccessToast('Left group', group.name);
      await onGroupChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not leave that group.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: theme.background,
              borderColor: theme.borderInk,
              paddingBottom: insets.bottom + Spacing.three,
            },
          ]}>
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: theme.border }]} />
          </View>
          <View style={styles.header}>
            <ThemedText type="smallBold" style={styles.title}>
              Groups
            </ThemedText>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
              <ThemedText type="smallBold" themeColor="textSecondary">
                Close
              </ThemedText>
            </Pressable>
          </View>

          <View style={styles.tabs}>
            <ButterChip label="Members" selected={tab === 'members'} onPress={() => setTab('members')} />
            <ButterChip label="Create" selected={tab === 'create'} onPress={() => setTab('create')} />
            <ButterChip label="Join" selected={tab === 'join'} onPress={() => setTab('join')} />
          </View>

          {error ? (
            <ThemedText type="small" style={{ color: theme.error }}>
              {error}
            </ThemedText>
          ) : null}

          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.body}
            showsVerticalScrollIndicator={false}>
            {tab === 'members' ? (
              <View style={styles.section}>
                {group ? (
                  <>
                    <ThemedText type="smallBold">{group.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {kindLabel(group.kind)}
                      {isShared && group.invite_code ? ` · invite ${group.invite_code}` : ''}
                    </ThemedText>
                    {isShared && group.invite_code ? (
                      <ButterButton
                        label="Share invite code"
                        variant="yellow"
                        onPress={() => void shareInvite(group.invite_code!)}
                        style={styles.fullBtn}
                      />
                    ) : null}
                  </>
                ) : (
                  <ThemedText type="small" themeColor="textSecondary">
                    No active group yet.
                  </ThemedText>
                )}

                {loadingMembers ? (
                  <ActivityIndicator color={theme.secondary} />
                ) : (
                  <View style={styles.memberList}>
                    {members.map((member) => (
                      <View
                        key={member.id}
                        style={[
                          styles.memberRow,
                          { backgroundColor: theme.backgroundElement, borderColor: theme.border },
                        ]}>
                        <ThemedText type="smallBold">
                          {member.display_name?.trim() || 'Member'}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {member.role}
                        </ThemedText>
                      </View>
                    ))}
                    {members.length === 0 && !loadingMembers ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        No members to show.
                      </ThemedText>
                    ) : null}
                  </View>
                )}

                {isShared ? (
                  <ButterButton
                    label={busy ? 'Leaving…' : 'Leave group'}
                    variant="ghost"
                    disabled={busy}
                    onPress={() => void onLeave()}
                    style={styles.fullBtn}
                  />
                ) : null}
              </View>
            ) : null}

            {tab === 'create' ? (
              <View style={styles.section}>
                <ThemedText type="small" themeColor="textSecondary">
                  Start a household or party. Friends join with an invite code.
                </ThemedText>
                <View style={styles.field}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Name
                  </ThemedText>
                  <TextInput
                    value={createName}
                    onChangeText={setCreateName}
                    placeholder="Roommates, Tailgate, …"
                    placeholderTextColor={theme.textSecondary}
                    editable={!busy}
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.backgroundElement,
                        borderColor: theme.borderInk,
                        color: theme.text,
                      },
                    ]}
                  />
                </View>
                <View style={styles.tabs}>
                  <ButterChip
                    label="Household"
                    selected={createKind === 'household'}
                    onPress={() => setCreateKind('household')}
                  />
                  <ButterChip
                    label="Party"
                    selected={createKind === 'event'}
                    onPress={() => setCreateKind('event')}
                  />
                </View>
                <ButterButton
                  label={busy ? 'Creating…' : 'Create group'}
                  variant="ink"
                  disabled={busy || !createName.trim()}
                  onPress={() => void onCreate()}
                  style={styles.fullBtn}
                />
                {createdInvite ? (
                  <View
                    style={[
                      styles.inviteCard,
                      { backgroundColor: theme.backgroundSelected, borderColor: theme.borderInk },
                    ]}>
                    <ThemedText type="smallBold">Invite code</ThemedText>
                    <ThemedText type="smallBold" style={styles.inviteCode}>
                      {createdInvite}
                    </ThemedText>
                    <ButterButton
                      label="Share code"
                      variant="yellow"
                      onPress={() => void shareInvite(createdInvite)}
                      style={styles.fullBtn}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}

            {tab === 'join' ? (
              <View style={styles.section}>
                <ThemedText type="small" themeColor="textSecondary">
                  Enter the invite code from a roommate or party host.
                </ThemedText>
                <View style={styles.field}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Invite code
                  </ThemedText>
                  <TextInput
                    value={joinCode}
                    onChangeText={setJoinCode}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    placeholder="ABCD1234"
                    placeholderTextColor={theme.textSecondary}
                    editable={!busy}
                    style={[
                      styles.input,
                      {
                        backgroundColor: theme.backgroundElement,
                        borderColor: theme.borderInk,
                        color: theme.text,
                      },
                    ]}
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
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    borderWidth: 2,
    borderBottomWidth: 0,
    paddingHorizontal: Spacing.three,
    gap: Spacing.two,
  },
  handleRow: {
    alignItems: 'center',
    paddingTop: Spacing.two,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: Type.section,
  },
  tabs: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  body: {
    gap: Spacing.three,
    paddingBottom: Spacing.four,
  },
  section: {
    gap: Spacing.two,
  },
  field: {
    gap: Spacing.one,
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
  },
  memberList: {
    gap: Spacing.two,
    marginTop: Spacing.one,
  },
  memberRow: {
    borderWidth: 1,
    borderRadius: Radius.chip,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inviteCard: {
    borderWidth: 2,
    borderRadius: Radius.card,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  inviteCode: {
    fontSize: 22,
    letterSpacing: 2,
  },
});
