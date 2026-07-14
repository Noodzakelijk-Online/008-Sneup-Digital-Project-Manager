const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {
  getDesktopSettingsPath,
  normalizeStartupMode,
  readDesktopSettings,
  resolveStartupMode,
  saveDesktopStartupMode
} = require('../src/services/desktopRuntimeSettings');

describe('desktop runtime settings', () => {
  test('normalizes only explicit demo and live startup modes', () => {
    expect(normalizeStartupMode('demo')).toBe('demo');
    expect(normalizeStartupMode(' LIVE ')).toBe('live');
    expect(normalizeStartupMode('production')).toBeNull();
  });

  test('keeps an explicit environment mode ahead of the persisted local preference', () => {
    expect(resolveStartupMode({ settings: { startupMode: 'live' }, environment: { SNEUP_DEMO_MODE: 'true' } })).toBe('demo');
    expect(resolveStartupMode({ settings: { startupMode: 'demo' }, environment: { SNEUP_DEMO_MODE: 'false' } })).toBe('live');
    expect(resolveStartupMode({ settings: { startupMode: 'live' }, environment: {} })).toBe('live');
  });

  test('persists only the non-secret startup preference in user data', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sneup-desktop-settings-'));
    const settingsPath = getDesktopSettingsPath(directory);
    try {
      await expect(readDesktopSettings(settingsPath)).resolves.toEqual({});
      const saved = await saveDesktopStartupMode(settingsPath, 'live');
      await saveDesktopStartupMode(settingsPath, 'demo');
      const raw = await fs.readFile(settingsPath, 'utf8');
      const reloaded = await readDesktopSettings(settingsPath);

      expect(saved).toMatchObject({ version: 1, startupMode: 'live' });
      expect(reloaded).toEqual({ startupMode: 'demo' });
      expect(Object.keys(reloaded)).toEqual(['startupMode']);
      expect(raw).not.toMatch(/token|secret|password|credential/i);
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  });

  test('fails closed for an invalid startup mode', async () => {
    await expect(saveDesktopStartupMode(path.join(os.tmpdir(), 'sneup-invalid-settings.json'), 'invalid')).rejects.toMatchObject({ statusCode: 400 });
  });
});
