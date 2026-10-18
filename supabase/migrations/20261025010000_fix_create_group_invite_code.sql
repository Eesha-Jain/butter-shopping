-- pgcrypto lives in the "extensions" schema on Supabase, so gen_random_bytes()
-- is not resolvable with search_path = public. Use built-in gen_random_uuid().
create or replace function public.create_group(p_name text, p_kind text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before creating a group';
  end if;
  if p_kind not in ('household', 'event') then
    raise exception 'Create a household or an event. Personal groups are created at signup';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'A group needs a name';
  end if;

  insert into public.groups (name, kind, invite_code, created_by)
  values (btrim(p_name), p_kind, substr(replace(gen_random_uuid()::text, '-', ''), 1, 12), auth.uid())
  returning id into v_group_id;

  insert into public.group_members (group_id, user_id, role)
  values (v_group_id, auth.uid(), 'owner');

  insert into public.lists (group_id, name, is_default)
  values (v_group_id, 'Shopping list', true);

  return v_group_id;
end;
$$;
