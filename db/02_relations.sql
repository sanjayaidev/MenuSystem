-- Red House Catering — database, file 2 of 4: RELATIONS
-- Links between tables (foreign keys), indexes, uniqueness, the public order number,
-- and row-level security. Run after 01_tables.sql. Safe to re-run.

-- 1. Foreign keys (added only when missing) ---------------------------------------------------------
do $$
declare fk record;
begin
  for fk in
    select * from (values
      ('menu_items',            'menu_items_category_id_fkey',             'foreign key (category_id) references categories(id) on delete restrict'),
      ('profiles',              'profiles_id_fkey',                        'foreign key (id) references auth.users(id) on delete cascade'),
      ('orders',                'orders_user_id_fkey',                     'foreign key (user_id) references auth.users(id) on delete set null'),
      ('order_items',           'order_items_order_id_fkey',               'foreign key (order_id) references orders(id) on delete cascade'),
      ('order_items',           'order_items_menu_item_id_fkey',           'foreign key (menu_item_id) references menu_items(id) on delete set null'),
      ('cart_items',            'cart_items_user_id_fkey',                 'foreign key (user_id) references auth.users(id) on delete cascade'),
      ('cart_items',            'cart_items_menu_item_id_fkey',            'foreign key (menu_item_id) references menu_items(id) on delete cascade'),
      ('special_sections',      'special_sections_category_id_fkey',       'foreign key (category_id) references categories(id) on delete cascade'),
      ('special_section_items', 'special_section_items_category_id_fkey',  'foreign key (category_id) references categories(id) on delete cascade'),
      ('special_section_items', 'special_section_items_menu_item_id_fkey', 'foreign key (menu_item_id) references menu_items(id) on delete cascade')
    ) as t(tbl, name, def)
  loop
    if not exists (
      select 1 from pg_constraint
       where conname = fk.name and conrelid = ('public.' || fk.tbl)::regclass
    ) then
      execute format('alter table public.%I add constraint %I %s', fk.tbl, fk.name, fk.def);
    end if;
  end loop;
end $$;

-- 2. Indexes and uniqueness -------------------------------------------------------------------------
create index if not exists idx_menu_items_category on menu_items(category_id);
create index if not exists idx_order_items_order   on order_items(order_id);
create index if not exists idx_orders_user_id      on orders(user_id);
create index if not exists idx_cart_items_user     on cart_items(user_id);
create unique index if not exists idx_orders_token on orders(order_token);

-- No two dishes may share a display order number (dishes without a number are not affected).
create unique index if not exists menu_items_display_order_key on menu_items (display_order);

-- 3. Public order number: RH-YYMMDD-NNNN (for example RH-260928-0042) ----------------------------------
--   RH      fixed prefix (change it in order_number_for() below if needed)
--   YYMMDD  order date in India time (Asia/Kolkata)
--   NNNN    orders.id, zero-padded to at least 4 digits (never truncated)
-- Built by the database in a BEFORE INSERT trigger: no duplicates, and the app does not build it.
-- orders.id stays the primary key and order_token stays the secret lookup credential.
create or replace function order_number_for(p_id bigint, p_created timestamptz)
returns text
language sql
immutable
as $$
  select 'RH-'
      || to_char(p_created at time zone 'Asia/Kolkata', 'YYMMDD')
      || '-'
      || lpad(p_id::text, greatest(4, length(p_id::text)), '0');
$$;

create or replace function set_order_number()
returns trigger
language plpgsql
as $$
begin
  new.order_number := order_number_for(new.id, coalesce(new.created_at, now()));
  return new;
end;
$$;

drop trigger if exists trg_set_order_number on orders;
create trigger trg_set_order_number
  before insert on orders
  for each row execute function set_order_number();

-- Number any existing orders (does nothing on a new database), then require it.
update orders
   set order_number = order_number_for(id, created_at)
 where order_number is null;

alter table orders alter column order_number set not null;

-- text_pattern_ops: exact lookups (= 'RH-260928-0042') and month filters (LIKE 'RH-2609%') use the index.
create unique index if not exists idx_orders_order_number
  on orders (order_number text_pattern_ops);

-- 4. Row-level security -----------------------------------------------------------------------------
alter table categories            enable row level security;
alter table menu_items            enable row level security;
alter table profiles              enable row level security;
alter table orders                enable row level security;
alter table order_items           enable row level security;
alter table cart_items            enable row level security;
alter table site_settings         enable row level security;   -- no policies: the browser cannot read or write it directly
alter table special_sections      enable row level security;   -- no policies: server only
alter table special_section_items enable row level security;   -- no policies: server only

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

-- Safety net: a signed-in user may create their own profile row even if a request ever reaches
-- Postgres as `authenticated` instead of `service_role` ("new row violates row-level security policy
-- for table profiles"). If you see that error, first check SUPABASE_SERVICE_ROLE_KEY on the server really
-- is the service_role secret (Project Settings -> API), not the anon key (db/supabase.js checks this at startup).
drop policy if exists "Users insert own profile" on profiles;
create policy "Users insert own profile"
  on profiles for insert
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

-- Orders and profiles are written through the server with the Supabase service_role key,
-- so no public insert/delete policies are granted here.
