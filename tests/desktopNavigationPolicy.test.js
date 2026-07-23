const {
  createNavigationPolicy,
  isApprovedExternalUrl,
  isInternalNavigation,
  openApprovedExternalUrl
} = require('../desktop/navigationPolicy');

describe('desktop navigation policy', () => {
  test('permits only credential-free HTTP(S) external destinations', () => {
    expect(isApprovedExternalUrl('https://docs.example.test/guide')).toBe(true);
    expect(isApprovedExternalUrl('http://127.0.0.1:3000/status')).toBe(true);
    expect(isApprovedExternalUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isApprovedExternalUrl('javascript:alert(1)')).toBe(false);
    expect(isApprovedExternalUrl('data:text/html,test')).toBe(false);
    expect(isApprovedExternalUrl('https://token@example.test/')).toBe(false);
  });

  test('keeps same-origin Sneup routes in-app and blocks all other navigation', () => {
    expect(isInternalNavigation('http://127.0.0.1:3197/connectors?filter=ready', 'http://127.0.0.1:3197')).toBe(true);
    expect(isInternalNavigation('https://example.test/', 'http://127.0.0.1:3197')).toBe(false);
  });

  test('denies popup and top-level navigation while opening only approved external URLs', async () => {
    const shell = { openExternal: jest.fn().mockResolvedValue(undefined) };
    const policy = createNavigationPolicy({ shell, internalUrl: 'http://127.0.0.1:3197' });
    const event = { preventDefault: jest.fn() };

    expect(policy.handleWindowOpen({ url: 'https://docs.example.test/' })).toEqual({ action: 'deny' });
    await Promise.resolve();
    expect(shell.openExternal).toHaveBeenCalledWith('https://docs.example.test/');

    policy.handleNavigation(event, 'javascript:alert(1)');
    await Promise.resolve();
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(shell.openExternal).toHaveBeenCalledTimes(1);

    policy.handleNavigation(event, 'http://127.0.0.1:3197/workspaces');
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  test('fails closed when Electron cannot open an external URL', async () => {
    await expect(openApprovedExternalUrl({ openExternal: jest.fn().mockRejectedValue(new Error('blocked')) }, 'https://docs.example.test/')).resolves.toBe(false);
  });
});
