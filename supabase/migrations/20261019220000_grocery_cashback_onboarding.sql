-- Pay-aware grocery cashback (bps) and one-time onboarding gate.
-- No card numbers — only an optional percent the shopper taps (100/200/300…).

alter table public.profiles
  add column if not exists grocery_cashback_bps int
    check (
      grocery_cashback_bps is null
      or (grocery_cashback_bps > 0 and grocery_cashback_bps <= 1000)
    );

alter table public.profiles
  add column if not exists onboarding_completed_at timestamptz;

comment on column public.profiles.grocery_cashback_bps is
  'Optional grocery cashback in basis points (e.g. 300 = 3%). Plan-only; never a PAN.';

comment on column public.profiles.onboarding_completed_at is
  'When the user finished or skipped the 3-screen onboarding. Null means show it once.';
