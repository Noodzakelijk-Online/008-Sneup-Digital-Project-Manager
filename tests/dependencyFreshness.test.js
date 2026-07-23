const workGraphService = require('../src/services/workGraphService');

describe('provider dependency freshness horizons', () => {
  const originalGlobalHorizon = process.env.SNEUP_DEPENDENCY_STALE_AFTER_DAYS;
  const originalGithubHorizon = process.env.SNEUP_DEPENDENCY_GITHUB_STALE_AFTER_DAYS;

  afterEach(() => {
    if (originalGlobalHorizon === undefined) delete process.env.SNEUP_DEPENDENCY_STALE_AFTER_DAYS;
    else process.env.SNEUP_DEPENDENCY_STALE_AFTER_DAYS = originalGlobalHorizon;
    if (originalGithubHorizon === undefined) delete process.env.SNEUP_DEPENDENCY_GITHUB_STALE_AFTER_DAYS;
    else process.env.SNEUP_DEPENDENCY_GITHUB_STALE_AFTER_DAYS = originalGithubHorizon;
  });

  test('uses an explicit provider horizon before the global fallback', () => {
    process.env.SNEUP_DEPENDENCY_STALE_AFTER_DAYS = '45';
    process.env.SNEUP_DEPENDENCY_GITHUB_STALE_AFTER_DAYS = '14';
    expect(workGraphService.dependencyStaleAfterDays({ sourceProvider: 'github' })).toBe(14);
    expect(workGraphService.dependencyStaleAfterDays({ sourceProvider: 'asana' })).toBe(45);
    expect(workGraphService.dependencyStaleAfterDays({ sourceProvider: 'github', staleAfterDays: 7 })).toBe(7);
  });

  test('clamps unsafe configured horizons while keeping the 30-day default', () => {
    expect(workGraphService.dependencyStaleAfterDays()).toBe(30);
    expect(workGraphService.dependencyStaleAfterDays({ staleAfterDays: 0 })).toBe(1);
    expect(workGraphService.dependencyStaleAfterDays({ staleAfterDays: 900 })).toBe(365);
    expect(workGraphService.dependencyStaleAfterMs({ staleAfterDays: 2 })).toBe(2 * 24 * 60 * 60 * 1000);
  });
});
