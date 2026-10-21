-- Order statuses are now only: confirmed ("Confirmed & preparing"), out_for_delivery, completed, cancelled.
-- Run this once in the Supabase SQL editor. Safe to run again.

-- new orders start as confirmed
alter table orders alter column status set default 'confirmed';

-- old in-progress orders (pending / preparing / ready) become "Confirmed & preparing"
update orders set status = 'confirmed' where status in ('pending', 'preparing', 'ready');
