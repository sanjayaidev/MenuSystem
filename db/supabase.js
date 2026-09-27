const { createClient } = require('@supabase/supabase-js');

// SERVICE ROLE key — full access, bypasses RLS. Never expose this to
// the browser/frontend. It only ever lives here, on the server, as an
// environment variable set in Render's dashboard (not committed to git).
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Fail loudly at startup if the key is missing or is the wrong key.
// Supabase API keys are JWTs with a `role` claim — `service_role` is
// the only one that bypasses RLS. Pasting the anon/public key here by
// mistake (or leaving this unset) is the #1 cause of confusing
// "new row violates row-level security policy" errors on every write,
// since the server would then be hitting Postgres as anon/authenticated.
if (!process.env.SUPABASE_URL || !key) {
  throw new Error(
    'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set. ' +
    'Get the service_role secret from Supabase: Project Settings -> API.'
  );
}

try {
  const payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64').toString('utf8'));
  if (payload.role !== 'service_role') {
    throw new Error(
      `SUPABASE_SERVICE_ROLE_KEY looks like a "${payload.role}" key, not "service_role". ` +
      'This is almost always the anon/public key pasted in by mistake, and it will cause ' +
      'row-level-security errors on every insert/update to profiles/orders. ' +
      'Go to Supabase -> Project Settings -> API -> service_role (secret) and use that value instead.'
    );
  }
} catch (err) {
  if (err.message.includes('service_role')) throw err;
  throw new Error('SUPABASE_SERVICE_ROLE_KEY does not look like a valid Supabase JWT key.');
}

const supabase = createClient(process.env.SUPABASE_URL, key, {
  auth: { persistSession: false },
});

module.exports = supabase;
