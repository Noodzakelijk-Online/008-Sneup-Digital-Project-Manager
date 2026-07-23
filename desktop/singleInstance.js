const focusWindow = (window) => {
  if (!window || window.isDestroyed?.()) return;
  if (window.isMinimized?.()) window.restore();
  window.show?.();
  window.focus?.();
};

const acquireSingleInstanceLock = ({ app, getMainWindow }) => {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }

  app.on('second-instance', () => focusWindow(getMainWindow()));
  return true;
};

module.exports = {
  acquireSingleInstanceLock,
  focusWindow
};
