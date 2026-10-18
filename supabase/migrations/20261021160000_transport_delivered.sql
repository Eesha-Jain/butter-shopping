-- Allow "delivered" as a grocery transport mode (onboarding multi-select).

alter table public.profiles
  drop constraint if exists profiles_transport_mode_check;

alter table public.profiles
  add constraint profiles_transport_mode_check
  check (
    transport_mode is null
    or transport_mode in ('walk', 'bike', 'drive', 'transit', 'rideshare', 'delivered')
  );

alter table public.profiles
  drop constraint if exists profiles_transport_modes_check;

alter table public.profiles
  add constraint profiles_transport_modes_check
  check (
    transport_modes is null
    or (
      cardinality(transport_modes) > 0
      and transport_modes <@ array['walk', 'bike', 'drive', 'transit', 'rideshare', 'delivered']::text[]
    )
  );
