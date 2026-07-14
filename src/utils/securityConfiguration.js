const MIN_PRODUCTION_SECRET_LENGTH = 32;

const TOKEN_SECRET_REQUIREMENTS = [
  'SNEUP_API_TOKEN_PEPPER',
  'SNEUP_SESSION_TOKEN_PEPPER',
  'SNEUP_INVITE_TOKEN_PEPPER'
];

const CONNECTOR_SECRET_REQUIREMENTS = [
  'CONNECTOR_ENCRYPTION_KEY',
  'CONNECTOR_STATE_SECRET'
];

const RELEASE_SECRET_REQUIREMENTS = [
  ...TOKEN_SECRET_REQUIREMENTS,
  ...CONNECTOR_SECRET_REQUIREMENTS
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

const getMissingReleaseSecrets = (environment = process.env) =>
  RELEASE_SECRET_REQUIREMENTS.filter((name) => !isProductionSecret(environment[name]));

const getDuplicateSecrets = (names, environment = process.env) => {
  const values = new Map();
  names.forEach((name) => {
    const value = String(environment[name] || '').trim();
    if (!isProductionSecret(value)) return;
    const names = values.get(value) || [];
    names.push(name);
    values.set(value, names);
  });

  return [...values.values()].filter((names) => names.length > 1);
};

const getDuplicateTokenSecrets = (environment = process.env) =>
  getDuplicateSecrets(TOKEN_SECRET_REQUIREMENTS, environment);

const getDuplicateReleaseSecrets = (environment = process.env) =>
  getDuplicateSecrets(RELEASE_SECRET_REQUIREMENTS, environment);

const productionSecretError = (names) => {
  const error = new Error(`Production requires independent 32+ character token peppers: ${names.join(', ')}`);
  error.code = 'SNEUP_INSECURE_TOKEN_SECRET_CONFIGURATION';
  return error;
};

const releaseSecurityError = (message, code) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const validateRuntimeSecurityConfiguration = (environment = process.env) => {
  const demoMode = String(environment.SNEUP_DEMO_MODE || '').toLowerCase() === 'true';
  if (!isProduction(environment) || demoMode) {
    return { enforced: false, missing: [] };
  }

  const missing = getMissingTokenSecrets(environment);
  if (missing.length > 0) throw productionSecretError(missing);

  const duplicates = getDuplicateTokenSecrets(environment);
  if (duplicates.length > 0) {
    throw productionSecretError(duplicates.flat());
  }
  return { enforced: true, missing: [] };
};

const validateReleaseSecurityEnvironment = (environment = process.env) => {
  if (!isProduction(environment)) {
    throw releaseSecurityError(
      'Release security verification requires NODE_ENV=production.',
      'SNEUP_RELEASE_NOT_PRODUCTION'
    );
  }
  if (String(environment.SNEUP_DEMO_MODE || '').toLowerCase() === 'true') {
    throw releaseSecurityError(
      'Release security verification requires SNEUP_DEMO_MODE to be disabled.',
      'SNEUP_RELEASE_DEMO_MODE'
    );
  }

  const missing = getMissingReleaseSecrets(environment);
  if (missing.length > 0) {
    throw releaseSecurityError(
      `Release requires independent, non-placeholder 32+ character secrets: ${missing.join(', ')}`,
      'SNEUP_RELEASE_SECRET_CONFIGURATION'
    );
  }

  const duplicates = getDuplicateReleaseSecrets(environment);
  if (duplicates.length > 0) {
    throw releaseSecurityError(
      `Release secrets must be distinct by purpose: ${duplicates.map((names) => names.join(' = ')).join('; ')}`,
      'SNEUP_RELEASE_SECRET_REUSE'
    );
  }

  return {
    environment: 'production',
    demoMode: false,
    checkedSecrets: [...RELEASE_SECRET_REQUIREMENTS],
    secretValuesExposed: false
  };
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
  CONNECTOR_SECRET_REQUIREMENTS,
  MIN_PRODUCTION_SECRET_LENGTH,
  RELEASE_SECRET_REQUIREMENTS,
  TOKEN_SECRET_REQUIREMENTS,
  getDuplicateReleaseSecrets,
  getDuplicateTokenSecrets,
  getMissingReleaseSecrets,
  getMissingTokenSecrets,
  getTokenPepper,
  isPlaceholder,
  isProduction,
  isProductionSecret,
  validateReleaseSecurityEnvironment,
  validateRuntimeSecurityConfiguration
};
