const { createClient } = require('@supabase/supabase-js');

// Used ONLY to verify a user's email/password via signInWithPassword.
//
// Why this can't just be the service-role client from ./supabase.js:
// supabase-js keeps an in-memory session on whichever client calls
// signInWithPassword (persistSession:false only skips localStorage, not
// the in-memory copy). Every .from() query on that client afterwards
// then authenticates as THAT user's access token instead of the
// service_role key, because the Postgrest layer looks up
// auth.getSession() per request and only falls back to the service key
// when there's no active session. Since db/supabase.js is a
// module-level singleton shared by every request, one login would
// silently "poison" it for the whole server process — every other
// request's profile/order reads and writes would run as that random
// logged-in user instead of service_role, tripping RLS with
// "new row violates row-level security policy" and, worse, letting one
// user's session leak into another user's request.
//
// A brand-new client per login call has no shared state to poison and
// costs nothing extra (no network round trip to construct).
function createAuthClient() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_ANON_KEY must both be set. ' +
      'Get the anon/public key from Supabase: Project Settings -> API.'
    );
  }
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

module.exports = { createAuthClient };
