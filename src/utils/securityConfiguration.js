const MIN_PRODUCTION_SECRET_LENGTH = 32;

const TOKEN_SECRET_REQUIREMENTS = [
  'SNEUP_API_TOKEN_PEPPER',
  'SNEUP_SESSION_TOKEN_PEPPER',
  'SNEUP_INVITE_TOKEN_PEPPER'
];

const isProduction = (environment = process.env) =>
  String(environment.NODE_ENV || '').toLowerCase() === 'production';

const isPlaceholder = (value) => /^(replace_with|your_|change_me|example|default|development|test|dummy)/i.test(String(value || '').trim());

const isProductionSecret = (value) => {
  const secret = String(value || '').trim();
  return secret.length >= MIN_PRODUCTION_SECRET_LENGTH && !isPlaceholder(secret);
};

const getMissingTokenSecrets = (environment = process.env) =>
  TOKEN_SECRET_REQUIREMENTS.filter((name) => !isProductionSecret(environment[name]));

const productionSecretError = (names) => {
  const error = new Error(`Production requires independent 32+ character token peppers: ${names.join(', ')}`);
  error.code = 'SNEUP_INSECURE_TOKEN_SECRET_CONFIGURATION';
  return error;
};

const validateRuntimeSecurityConfiguration = (environment = process.env) => {
  const demoMode = String(environment.SNEUP_DEMO_MODE || '').toLowerCase() === 'true';
  if (!isProduction(environment) || demoMode) {
    return { enforced: false, missing: [] };
  }

  const missing = getMissingTokenSecrets(environment);
  if (missing.length > 0) throw productionSecretError(missing);
  return { enforced: true, missing: [] };
};

const getTokenPepper = (name, developmentFallback, environment = process.env) => {
  const configured = environment[name];
  const demoMode = String(environment.SNEUP_DEMO_MODE || '').toLowerCase() === 'true';
  if (isProduction(environment) && !demoMode && !isProductionSecret(configured)) {
    throw productionSecretError([name]);
  }
  return configured || developmentFallback;
};

module.exports = {
  MIN_PRODUCTION_SECRET_LENGTH,
  TOKEN_SECRET_REQUIREMENTS,
  getMissingTokenSecrets,
  getTokenPepper,
  isPlaceholder,
  isProduction,
  isProductionSecret,
  validateRuntimeSecurityConfiguration
};
