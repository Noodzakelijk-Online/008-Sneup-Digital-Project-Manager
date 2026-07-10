const safeExternalSourceUrl = (value) => {
  if (!value) return null;

  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch (error) {
    return null;
  }
};

module.exports = {
  safeExternalSourceUrl
};
