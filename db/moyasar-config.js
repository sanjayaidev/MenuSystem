function keyMode(key, prefix) {
  if (key.startsWith(`${prefix}_test_`)) return 'test';
  if (key.startsWith(`${prefix}_live_`)) return 'live';
  return '';
}

function getMoyasarConfig() {
  const publishableKey = process.env.MOYASAR_PUBLISHABLE_KEY || '';
  const secretKey = process.env.MOYASAR_SECRET_KEY || '';
  const publishableMode = keyMode(publishableKey, 'pk');
  const secretMode = keyMode(secretKey, 'sk');
  return {
    publishableKey,
    publishableMode,
    secretMode,
    enabled: Boolean(publishableMode && secretMode && publishableMode === secretMode),
  };
}

module.exports = { getMoyasarConfig };
