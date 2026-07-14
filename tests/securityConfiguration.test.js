const {
  getTokenPepper,
  validateRuntimeSecurityConfiguration
} = require('../src/utils/securityConfiguration');
const {
  getDemoSecurityContext,
  getDemoWorkspace,
  isDemoMode
} = require('../src/services/demoWorkspaceService');
const { getInviteUrl, sendInviteEmail } = require('../src/services/workspaceInviteService');

const strong = (suffix) => `sneup-${suffix}-a-unique-production-secret-value-2026`;

describe('demo workspace boundary', () => {
  test('is explicitly read-only and does not inherit local privileges', () => {
    expect(isDemoMode({ SNEUP_DEMO_MODE: 'true' })).toBe(true);
    expect(isDemoMode({ SNEUP_DEMO_MODE: 'false' })).toBe(false);
    expect(getDemoWorkspace()).toMatchObject({
      id: 'demo',
      name: 'Demo workspace',
      demoMode: true
    });
    expect(getDemoSecurityContext()).toMatchObject({
      authenticated: true,
      workspaceId: 'demo',
      workspaceOverrideAllowed: false,
      demoMode: true
    });
    expect(getDemoSecurityContext().permissions).toEqual([]);
  });
});

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

describe('workspace invitation delivery boundary', () => {
  test('requires a clean non-local HTTPS public URL for production invitations while retaining local development links', () => {
    const token = 'sneup_invite_abcdefghijklmnopqrstuvwxyz';
    expect(() => getInviteUrl(token, { environment: { NODE_ENV: 'production' } }))
      .toThrow(/SNEUP_PUBLIC_URL.*HTTPS/i);
    expect(() => getInviteUrl(token, { environment: { NODE_ENV: 'production', SNEUP_PUBLIC_URL: 'http://sneup.example.com' } }))
      .toThrow(/non-local HTTPS/i);
    expect(() => getInviteUrl(token, { environment: { NODE_ENV: 'production', SNEUP_PUBLIC_URL: 'https://localhost:3000' } }))
      .toThrow(/non-local HTTPS/i);
    expect(() => getInviteUrl(token, { environment: { NODE_ENV: 'production', SNEUP_PUBLIC_URL: 'https://user:secret@sneup.example.com' } }))
      .toThrow(/credentials/i);
    expect(() => getInviteUrl(token, { environment: { NODE_ENV: 'production', SNEUP_PUBLIC_URL: 'https://sneup.example.com/?session=secret' } }))
      .toThrow(/query parameters/i);
    expect(getInviteUrl(token, { environment: { NODE_ENV: 'development', SNEUP_PUBLIC_URL: 'http://localhost:3216/sneup' } }))
      .toBe(`http://localhost:3216/sneup?invite=${token}`);
    expect(getInviteUrl(token, { environment: { NODE_ENV: 'production', SNEUP_PUBLIC_URL: 'https://sneup.example.com/onboarding' } }))
      .toBe(`https://sneup.example.com/onboarding?invite=${token}`);
  });

  test('sends invitations only to Resend with explicit redirect blocking and no credential in the URL', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 202 });
    await sendInviteEmail({
      invite: { email: 'invitee@example.com', displayName: 'Invitee' },
      inviteUrl: 'https://sneup.example.com/onboarding?invite=sneup_invite_token'
    }, {
      fetchFn,
      environment: {
        RESEND_API_KEY: 'resend_api_key',
        SNEUP_INVITE_FROM: 'team@sneup.example.com',
        SNEUP_INVITE_PRODUCT_NAME: 'Sneup'
      }
    });

    expect(fetchFn).toHaveBeenCalledWith('https://api.resend.com/emails', expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      headers: expect.objectContaining({ Authorization: 'Bearer resend_api_key' })
    }));
    const request = fetchFn.mock.calls[0][1];
    expect(request.body).toContain('invitee@example.com');
    expect(request.body).toContain('https://sneup.example.com/onboarding?invite=sneup_invite_token');
    expect(request.body).not.toContain('resend_api_key');
  });
});
