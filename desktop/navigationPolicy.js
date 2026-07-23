const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:']);

const parseUrl = value => {
  try {
    return new URL(String(value || ''));
  } catch {
    return null;
  }
};

const isApprovedExternalUrl = value => {
  const parsed = parseUrl(value);
  return Boolean(
    parsed
    && ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)
    && parsed.hostname
    && !parsed.username
    && !parsed.password
  );
};

const isInternalNavigation = (value, internalUrl) => {
  const destination = parseUrl(value);
  const internal = parseUrl(internalUrl);
  return Boolean(destination && internal && destination.origin === internal.origin);
};

const openApprovedExternalUrl = async (shell, value) => {
  if (!isApprovedExternalUrl(value)) return false;
  try {
    await shell.openExternal(value);
    return true;
  } catch {
    return false;
  }
};

const createNavigationPolicy = ({ shell, internalUrl }) => ({
  handleWindowOpen: ({ url }) => {
    void openApprovedExternalUrl(shell, url);
    return { action: 'deny' };
  },
  handleNavigation: (event, url) => {
    if (isInternalNavigation(url, internalUrl)) return;
    event.preventDefault();
    void openApprovedExternalUrl(shell, url);
  }
});

module.exports = {
  createNavigationPolicy,
  isApprovedExternalUrl,
  isInternalNavigation,
  openApprovedExternalUrl
};
