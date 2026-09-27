-- Red House Catering: indexes, uniqueness and row-level security.
-- Run after 01_create_tables.sql.

-- Bring databases created with the older scripts up to the current schema.
alter table profiles add column if not exists is_admin boolean not null default false;
alter table orders add column if not exists order_token uuid not null default gen_random_uuid();
alter table menu_items add column if not exists calories int;
alter table menu_items add column if not exists rating numeric(2,1);

create index if not exists idx_menu_items_category on menu_items(category_id);
create index if not exists idx_order_items_order on order_items(order_id);
create index if not exists idx_orders_user_id on orders(user_id);
create index if not exists idx_cart_items_user on cart_items(user_id);
create unique index if not exists idx_orders_token on orders(order_token);

alter table categories enable row level security;
alter table menu_items enable row level security;
alter table profiles enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table cart_items enable row level security;

drop policy if exists "Public can read categories" on categories;
create policy "Public can read categories"
  on categories for select
  using (true);

drop policy if exists "Public can read available menu items" on menu_items;
create policy "Public can read available menu items"
  on menu_items for select
  using (true);

drop policy if exists "Users read own profile" on profiles;
create policy "Users read own profile"
  on profiles for select
  using (auth.uid() = id);

drop policy if exists "Users update own profile" on profiles;
create policy "Users update own profile"
  on profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "Users read own orders" on orders;
create policy "Users read own orders"
  on orders for select
  using (auth.uid() = user_id);

drop policy if exists "Users read own order items" on order_items;
create policy "Users read own order items"
  on order_items for select
  using (
    exists (
      select 1 from orders o
      where o.id = order_items.order_id
        and o.user_id = auth.uid()
    )
  );

drop policy if exists "Users manage own cart" on cart_items;
create policy "Users manage own cart"
  on cart_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Orders and profiles are written through the server using the Supabase
-- service_role key. No public insert/delete policies are granted here.