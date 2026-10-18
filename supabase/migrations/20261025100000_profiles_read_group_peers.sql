-- Co-members of a group need display names / avatars for the roster UI.
-- Existing profiles_read_own stays; Postgres ORs multiple SELECT policies.

create policy profiles_read_group_peers on public.profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.group_members me
      join public.group_members peer on peer.group_id = me.group_id
      where me.user_id = (select auth.uid())
        and peer.user_id = profiles.id
    )
  );

comment on policy profiles_read_group_peers on public.profiles is
  'A member can read profiles of users who share any group with them (household / party roster).';
