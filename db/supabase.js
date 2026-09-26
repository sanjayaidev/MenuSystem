const { createClient } = require('@supabase/supabase-js');

// SERVICE ROLE key — full access, bypasses RLS. Never expose this to
// the browser/frontend. It only ever lives here, on the server, as an
// environment variable set in Render's dashboard (not committed to git).
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

module.exports = supabase;
