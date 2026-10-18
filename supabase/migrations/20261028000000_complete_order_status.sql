alter table public.orders
  drop constraint orders_status_check;

alter table public.orders
  add constraint orders_status_check
  check (status in ('draft', 'ordered', 'complete', 'cancelled'));

update public.orders
set status = 'complete'
where status = 'ordered';

create or replace function public.finalize_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before placing an order';
  end if;

  update public.orders
  set status = 'ordered'
  where id = p_order_id
    and status = 'draft'
    and confirmed_by = auth.uid()
    and paid_by = auth.uid()
  returning id into v_id;

  if v_id is null then
    raise exception 'Confirm this order as its payer before placing it';
  end if;

  update public.list_items li
  set done_at = coalesce(li.done_at, now())
  from public.order_items oi
  where oi.order_id = v_id
    and oi.list_item_id = li.id
    and li.done_at is null;

  update public.orders
  set status = 'complete'
  where id = v_id
    and status = 'ordered';
end;
$$;

comment on function public.finalize_order(uuid) is
  'The confirming payer finalizes an order. The ordered transition freezes purchases and expense shares, linked list items are checked off, and the final order status is complete. Do not set orders.status from the client.';