-- Moyasar payment association. Safe to run more than once.
alter table orders add column if not exists moyasar_payment_id text;
alter table orders add column if not exists moyasar_reference text;
create unique index if not exists idx_orders_moyasar_payment_id
  on orders (moyasar_payment_id)
  where moyasar_payment_id is not null;
create unique index if not exists idx_orders_moyasar_reference
  on orders (moyasar_reference)
  where moyasar_reference is not null;
