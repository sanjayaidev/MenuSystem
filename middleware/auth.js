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

module.exports = { getAuthUser, requireAuth };