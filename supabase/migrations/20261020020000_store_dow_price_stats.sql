-- Day-of-week shelf price patterns from append-only prices history.
-- DOW uses America/Los_Angeles (campus / WA default). 0 = Sunday … 6 = Saturday.

create or replace view public.store_dow_price_stats
with (security_invoker = true)
as
with recent as (
  select
    sp.store_id,
    extract(dow from (p.created_at at time zone 'America/Los_Angeles'))::int as dow,
    p.price_cents,
    (p.created_at at time zone 'America/Los_Angeles')::date as local_date
  from public.prices p
  join public.store_products sp on sp.id = p.store_product_id
  where p.created_at >= now() - interval '56 days'
    and p.price_cents > 0
),
by_dow as (
  select
    store_id,
    dow,
    count(*)::int as obs_count,
    percentile_cont(0.5) within group (order by price_cents) as median_cents,
    (max(local_date) - min(local_date)) as date_span_days
  from recent
  group by store_id, dow
),
store_med as (
  select
    store_id,
    percentile_cont(0.5) within group (order by price_cents) as store_median_cents
  from recent
  group by store_id
)
select
  d.store_id,
  d.dow,
  d.obs_count,
  round(d.median_cents)::int as median_cents,
  round(s.store_median_cents)::int as store_median_cents,
  case
    when s.store_median_cents > 0
      then round((d.median_cents / s.store_median_cents)::numeric, 4)
    else null
  end as relative_index,
  greatest(1, ceil(greatest(d.date_span_days, 1)::numeric / 7.0))::int as weeks_span,
  (d.obs_count >= 5 and d.date_span_days >= 14) as is_confident
from by_dow d
join store_med s on s.store_id = d.store_id;

comment on view public.store_dow_price_stats is
  'Per-store weekday median shelf prices from the last 56 days of prices. relative_index < 1 means that weekday tends cheaper than the store median. is_confident requires ≥5 observations spanning ≥14 days.';

grant select on public.store_dow_price_stats to authenticated, anon;

/**
 * Picks a shopping date in the next 14 days using:
 * - shelf DOW patterns near the postal code (when confident)
 * - basket percent_off promotions (same rules as recommend_discount_date)
 * - profile preferred_days when signed in
 *
 * Returns jsonb: { shop_on, reason, stores: [...] }
 * reason: shelf_pattern | promotion | preferred | default
 */
create or replace function public.recommend_shop_day(
  p_near_postal_code text default '98195',
  p_from date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_postal text := coalesce(nullif(trim(p_near_postal_code), ''), '98195');
  v_from date := coalesce(p_from, current_date);
  v_preferred int[];
  v_offset int;
  v_day date;
  v_dow int;
  v_shelf numeric;
  v_promo numeric;
  v_pref_bonus numeric;
  v_score numeric;
  v_best_score numeric := -1;
  v_best_day date := v_from;
  v_best_reason text := 'default';
  v_reason text;
  v_stores jsonb;
begin
  if auth.uid() is not null then
    select preferred_days into v_preferred
    from public.profiles
    where id = auth.uid();
  end if;

  for v_offset in 0..13 loop
    v_day := v_from + v_offset;
    v_dow := extract(dow from v_day)::int;

    select coalesce(avg(greatest(0, 1 - s.relative_index)), 0)
      into v_shelf
    from public.store_dow_price_stats s
    join public.stores st on st.id = s.store_id
    where s.dow = v_dow
      and s.is_confident
      and s.relative_index is not null
      and (
        st.postal_code = v_postal
        or left(coalesce(st.postal_code, ''), 3) = left(v_postal, 3)
      );

    select coalesce(sum(pmo.discount_value), 0)
      into v_promo
    from public.promotions pmo
    where pmo.product_id is null
      and pmo.discount_type = 'percent_off'
      and public.promotion_applies_on(
        v_day, pmo.weekdays, pmo.month_days, pmo.month_ordinals, pmo.starts_at, pmo.ends_at
      )
      and (
        pmo.requires_group is null
        or (
          auth.uid() is not null
          and exists (
            select 1 from public.discount_eligibilities de
            where de.user_id = auth.uid() and de.group_code = pmo.requires_group
          )
        )
      )
      and exists (
        select 1
        from public.stores st
        where (st.id = pmo.store_id or st.chain_id = pmo.chain_id)
          and (
            st.postal_code = v_postal
            or left(coalesce(st.postal_code, ''), 3) = left(v_postal, 3)
            or st.region = 'WA'
          )
      );

    v_pref_bonus := 0;
    if v_preferred is not null and v_dow = any (v_preferred) then
      v_pref_bonus := 0.15;
    end if;

    -- Promo percent dominates when present; shelf index is 0–~0.3 typically.
    v_score := (v_promo / 100.0) * 2.0 + v_shelf + v_pref_bonus;

    if v_promo > 0 then
      v_reason := 'promotion';
    elsif v_shelf > 0.02 then
      v_reason := 'shelf_pattern';
    elsif v_pref_bonus > 0 then
      v_reason := 'preferred';
    else
      v_reason := 'default';
    end if;

    if v_score > v_best_score then
      v_best_score := v_score;
      v_best_day := v_day;
      v_best_reason := v_reason;
    end if;
  end loop;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'store_id', x.store_id,
        'name', x.name,
        'best_dow', x.dow,
        'relative_index', x.relative_index,
        'obs_count', x.obs_count
      )
      order by x.relative_index asc nulls last
    ),
    '[]'::jsonb
  )
  into v_stores
  from (
    select distinct on (st.id)
      st.id as store_id,
      st.name,
      s.dow,
      s.relative_index,
      s.obs_count
    from public.store_dow_price_stats s
    join public.stores st on st.id = s.store_id
    where s.is_confident
      and s.relative_index is not null
      and (
        st.postal_code = v_postal
        or left(coalesce(st.postal_code, ''), 3) = left(v_postal, 3)
      )
    order by st.id, s.relative_index asc nulls last
  ) x;

  return jsonb_build_object(
    'shop_on', v_best_day,
    'reason', v_best_reason,
    'score', round(v_best_score::numeric, 4),
    'stores', v_stores
  );
end;
$$;

comment on function public.recommend_shop_day(text, date) is
  'Suggests a shopping date in the next 14 days from shelf day-of-week patterns near a ZIP, basket promotions, and preferred_days. reason is shelf_pattern, promotion, preferred, or default.';

revoke all on function public.recommend_shop_day(text, date) from public;
grant execute on function public.recommend_shop_day(text, date) to authenticated, anon;
