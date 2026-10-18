-- Merge existing duplicate open product rows, then forbid new ones.
with d as (
  select list_id, product_id,
         (array_agg(id order by created_at, id))[1] as keep_id,
         sum(quantity) as total
  from public.list_items
  where product_id is not null and done_at is null
  group by list_id, product_id
  having count(*) > 1
),
upd as (
  update public.list_items li
  set quantity = d.total
  from d
  where li.id = d.keep_id
  returning li.id
)
delete from public.list_items li
using d
where li.list_id = d.list_id
  and li.product_id = d.product_id
  and li.done_at is null
  and li.id <> d.keep_id;

create unique index if not exists list_items_one_open_product_per_list
  on public.list_items (list_id, product_id)
  where product_id is not null and done_at is null;
