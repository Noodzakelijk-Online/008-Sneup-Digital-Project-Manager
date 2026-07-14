const {
  getDuplicateReleaseSecrets,
  validateReleaseSecurityEnvironment
} = require('../src/utils/securityConfiguration');

const strong = (suffix) => `sneup-${suffix}-unique-production-secret-value-2026`;

const productionEnvironment = () => ({
  NODE_ENV: 'production',
  SNEUP_DEMO_MODE: 'false',
  SNEUP_API_TOKEN_PEPPER: strong('api-pepper'),
  SNEUP_SESSION_TOKEN_PEPPER: strong('session-pepper'),
  SNEUP_INVITE_TOKEN_PEPPER: strong('invite-pepper'),
  CONNECTOR_ENCRYPTION_KEY: strong('connector-encryption'),
  CONNECTOR_STATE_SECRET: strong('connector-state')
});

describe('release security verification', () => {
  test('requires a live production environment without exposing configured values', () => {
    expect(() => validateReleaseSecurityEnvironment({ NODE_ENV: 'development' }))
      .toThrow(/NODE_ENV=production/);
    expect(() => validateReleaseSecurityEnvironment({ NODE_ENV: 'production', SNEUP_DEMO_MODE: 'true' }))
      .toThrow(/SNEUP_DEMO_MODE/);

    expect(validateReleaseSecurityEnvironment(productionEnvironment())).toEqual({
      environment: 'production',
      demoMode: false,
      checkedSecrets: [
        'SNEUP_API_TOKEN_PEPPER',
        'SNEUP_SESSION_TOKEN_PEPPER',
        'SNEUP_INVITE_TOKEN_PEPPER',
        'CONNECTOR_ENCRYPTION_KEY',
        'CONNECTOR_STATE_SECRET'
      ],
      secretValuesExposed: false
    });
  });

  test('rejects missing, placeholder, and reused release secrets with names only', () => {
    const missing = productionEnvironment();
    delete missing.CONNECTOR_STATE_SECRET;
    expect(() => validateReleaseSecurityEnvironment(missing))
      .toThrow(/CONNECTOR_STATE_SECRET/);

    const placeholder = productionEnvironment();
    placeholder.CONNECTOR_ENCRYPTION_KEY = 'replace_with_a_production_secret_value_that_is_long_enough';
    expect(() => validateReleaseSecurityEnvironment(placeholder))
      .toThrow(/CONNECTOR_ENCRYPTION_KEY/);

    const reused = productionEnvironment();
    reused.CONNECTOR_STATE_SECRET = reused.SNEUP_API_TOKEN_PEPPER;
    expect(getDuplicateReleaseSecrets(reused)).toEqual([
      ['SNEUP_API_TOKEN_PEPPER', 'CONNECTOR_STATE_SECRET']
    ]);
    expect(() => validateReleaseSecurityEnvironment(reused))
      .toThrow(/SNEUP_API_TOKEN_PEPPER = CONNECTOR_STATE_SECRET/);
  });
});
