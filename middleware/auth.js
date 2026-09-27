const supabase = require('../db/supabase');

async function getAuthUser(req) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) return null;

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

async function requireAuth(req, res, next) {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  req.authUser = user;
  next();
}

// Requires a valid Supabase session AND profiles.is_admin = true.
// Staff accounts are just normal Supabase Auth users with that flag
// set manually in the DB (see db/02_rls_and_constraints.sql).
async function requireAdmin(req, res, next) {
  const user = await getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required' });

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!profile || !profile.is_admin) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  req.authUser = user;
  next();
}

module.exports = { getAuthUser, requireAuth, requireAdmin };