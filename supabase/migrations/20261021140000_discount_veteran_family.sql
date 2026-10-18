-- Opt-in group for veteran family member discounts (onboarding chip).

insert into public.discount_groups (code, name)
values ('veteran_family', 'Veteran family member')
on conflict (code) do update
set name = excluded.name;
