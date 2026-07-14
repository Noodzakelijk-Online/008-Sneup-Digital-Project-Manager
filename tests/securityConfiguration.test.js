const {
  getTokenPepper,
  validateRuntimeSecurityConfiguration
} = require('../src/utils/securityConfiguration');

const strong = (suffix) => `sneup-${suffix}-a-unique-production-secret-value-2026`;

describe('production token-secret boundary', () => {
  test('permits development and demo runtimes without production token peppers', () => {
    expect(validateRuntimeSecurityConfiguration({ NODE_ENV: 'development' })).toEqual({
      enforced: false,
      missing: []
    });
    expect(validateRuntimeSecurityConfiguration({ NODE_ENV: 'production', SNEUP_DEMO_MODE: 'true' })).toEqual({
      enforced: false,
      missing: []
    });
    expect(getTokenPepper('SNEUP_SESSION_TOKEN_PEPPER', 'demo-fallback', {
      NODE_ENV: 'production',
      SNEUP_DEMO_MODE: 'true'
    })).toBe('demo-fallback');
  });

  test('rejects absent and placeholder token peppers for a live production runtime', () => {
    expect(() => validateRuntimeSecurityConfiguration({ NODE_ENV: 'production' }))
      .toThrow(/SNEUP_API_TOKEN_PEPPER.*SNEUP_SESSION_TOKEN_PEPPER.*SNEUP_INVITE_TOKEN_PEPPER/);
    expect(() => validateRuntimeSecurityConfiguration({
      NODE_ENV: 'production',
      SNEUP_API_TOKEN_PEPPER: 'replace_with_32_plus_random_characters_for_database_api_token_hashing',
      SNEUP_SESSION_TOKEN_PEPPER: strong('session'),
      SNEUP_INVITE_TOKEN_PEPPER: strong('invite')
    })).toThrow(/SNEUP_API_TOKEN_PEPPER/);
  });

  test('requires each persisted token type to use its own configured production pepper', () => {
    const environment = {
      NODE_ENV: 'production',
      SNEUP_API_TOKEN_PEPPER: strong('api'),
      SNEUP_SESSION_TOKEN_PEPPER: strong('session'),
      SNEUP_INVITE_TOKEN_PEPPER: strong('invite')
    };

    expect(validateRuntimeSecurityConfiguration(environment)).toEqual({ enforced: true, missing: [] });
    expect(getTokenPepper('SNEUP_API_TOKEN_PEPPER', 'development-fallback', environment)).toBe(environment.SNEUP_API_TOKEN_PEPPER);
    expect(() => getTokenPepper('SNEUP_SESSION_TOKEN_PEPPER', 'development-fallback', {
      NODE_ENV: 'production',
      SNEUP_API_TOKEN_PEPPER: strong('api')
    })).toThrow(/SNEUP_SESSION_TOKEN_PEPPER/);
  });
});
