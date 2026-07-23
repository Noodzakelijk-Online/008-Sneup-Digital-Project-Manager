const { acquireSingleInstanceLock, focusWindow } = require('../desktop/singleInstance');

describe('desktop single-instance guard', () => {
  test('quits before startup when another Sneup instance owns the lock', () => {
    const app = {
      requestSingleInstanceLock: jest.fn(() => false),
      quit: jest.fn(),
      on: jest.fn()
    };

    expect(acquireSingleInstanceLock({ app, getMainWindow: jest.fn() })).toBe(false);
    expect(app.quit).toHaveBeenCalledTimes(1);
    expect(app.on).not.toHaveBeenCalled();
  });

  test('focuses and restores the existing window on a repeat launch', () => {
    const window = {
      isDestroyed: jest.fn(() => false),
      isMinimized: jest.fn(() => true),
      restore: jest.fn(),
      show: jest.fn(),
      focus: jest.fn()
    };
    const handlers = {};
    const app = {
      requestSingleInstanceLock: jest.fn(() => true),
      quit: jest.fn(),
      on: jest.fn((event, handler) => { handlers[event] = handler; })
    };

    expect(acquireSingleInstanceLock({ app, getMainWindow: () => window })).toBe(true);
    handlers['second-instance']();

    expect(window.restore).toHaveBeenCalledTimes(1);
    expect(window.show).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
    expect(app.quit).not.toHaveBeenCalled();
  });

  test('ignores a destroyed or missing window while retaining the lock', () => {
    expect(() => focusWindow(null)).not.toThrow();
    expect(() => focusWindow({ isDestroyed: () => true })).not.toThrow();
  });
});
