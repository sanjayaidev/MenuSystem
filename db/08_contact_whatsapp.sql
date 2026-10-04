-- Red House Catering: contact settings now hold two WhatsApp numbers and a map link.
-- Optional: the server already falls back to these defaults when the keys are missing,
-- but run this once to store them (and replace the old demo phone/address).
-- Admin can change everything later from Admin -> Contact.

insert into site_settings (key, value)
values (
  'contact',
  '{"phone": "056 928 3982", "phone2": "00966 56 928 3982", "address": "", "mapUrl": "https://maps.app.goo.gl/SPNMnoHksw7VcNu66"}'::jsonb
)
on conflict (key) do update
  set value = excluded.value, updated_at = now();
