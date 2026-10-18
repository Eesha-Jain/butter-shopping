-- Multi-select transport modes + find-or-create college for onboarding.

alter table public.profiles
  add column if not exists transport_modes text[];

alter table public.profiles
  drop constraint if exists profiles_transport_modes_check;

alter table public.profiles
  add constraint profiles_transport_modes_check
  check (
    transport_modes is null
    or (
      cardinality(transport_modes) > 0
      and transport_modes <@ array['walk', 'bike', 'drive', 'transit', 'rideshare']::text[]
    )
  );

comment on column public.profiles.transport_modes is
  'How the shopper gets groceries (multi-select). transport_mode stays as the primary/first mode.';

-- Backfill from the single-mode column when present.
update public.profiles
set transport_modes = array[transport_mode]
where transport_mode is not null
  and (transport_modes is null or cardinality(transport_modes) = 0);

/**
 * Find a college by name (case-insensitive) or insert a new row.
 * Authenticated clients cannot insert into colleges directly (admin write);
 * this SECURITY DEFINER helper is for onboarding / campus store flows.
 */
create or replace function public.ensure_college(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.';
  end if;
  if length(v_name) < 2 then
    raise exception 'College name is too short.';
  end if;

  select id into v_id
  from public.colleges
  where lower(name) = lower(v_name)
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.colleges (name)
  values (v_name)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.ensure_college(text) from public;
grant execute on function public.ensure_college(text) to authenticated;

comment on function public.ensure_college(text) is
  'Find or create a college by name for profile / campus onboarding.';
