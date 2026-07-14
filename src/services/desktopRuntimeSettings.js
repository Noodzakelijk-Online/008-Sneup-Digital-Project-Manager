const fs = require('fs/promises');
const path = require('path');

const SETTINGS_VERSION = 1;
const DEFAULT_STARTUP_MODE = 'demo';

const normalizeStartupMode = (value) => {
  const mode = String(value || '').trim().toLowerCase();
  return ['demo', 'live'].includes(mode) ? mode : null;
};

const startupModeFromEnvironment = (environment = process.env) => {
  const rawValue = environment.SNEUP_DEMO_MODE;
  if (rawValue === undefined || rawValue === null || rawValue === '') return null;
  const value = String(rawValue).trim().toLowerCase();
  if (value === 'true') return 'demo';
  if (value === 'false') return 'live';
  return null;
};

const resolveStartupMode = ({ settings = {}, environment = process.env } = {}) => (
  startupModeFromEnvironment(environment)
  || normalizeStartupMode(settings.startupMode)
  || DEFAULT_STARTUP_MODE
);

const getDesktopSettingsPath = (userDataPath) => path.join(userDataPath, 'desktop-settings.json');

const readDesktopSettings = async (settingsPath, options = {}) => {
  const fsApi = options.fsApi || fs;
  try {
    const raw = await fsApi.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const startupMode = normalizeStartupMode(parsed.startupMode);
    return startupMode ? { startupMode } : {};
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return {};
    throw error;
  }
};

const saveDesktopStartupMode = async (settingsPath, startupMode, options = {}) => {
  const fsApi = options.fsApi || fs;
  const normalizedMode = normalizeStartupMode(startupMode);
  if (!normalizedMode) {
    const error = new Error('Desktop startup mode must be demo or live');
    error.statusCode = 400;
    throw error;
  }

  await fsApi.mkdir(path.dirname(settingsPath), { recursive: true });
  const temporaryPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;
  const settings = {
    version: SETTINGS_VERSION,
    startupMode: normalizedMode,
    updatedAt: new Date().toISOString()
  };
  await fsApi.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
  await fsApi.rename(temporaryPath, settingsPath);
  return settings;
};

module.exports = {
  DEFAULT_STARTUP_MODE,
  getDesktopSettingsPath,
  normalizeStartupMode,
  readDesktopSettings,
  resolveStartupMode,
  saveDesktopStartupMode,
  startupModeFromEnvironment
};
