const Card = require('../src/models/Card');
const interventionEngine = require('../src/services/interventionEngine');

describe('intervention detection', () => {
  afterEach(() => jest.restoreAllMocks());

  test('detects stuck work from the persisted list duration and list average', async () => {
    const card = {
      timeInCurrentList: 73,
      listId: { name: 'Review', averageTimeInList: 24 }
    };

    await expect(interventionEngine.isCardStuck(card)).resolves.toBe(true);
    expect(interventionEngine.generateStuckCardMessage(card)).toContain('Review');
    expect(interventionEngine.generateStuckCardMessage(card)).toContain('3 day(s)');
  });

  test('detects stale work from the persisted Trello activity timestamp', async () => {
    const staleCard = { lastActivity: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000) };
    const activeCard = { lastActivity: new Date(Date.now() - 24 * 60 * 60 * 1000) };

    await expect(interventionEngine.hasNoRecentActivity(staleCard)).resolves.toBe(true);
    await expect(interventionEngine.hasNoRecentActivity(activeCard)).resolves.toBe(false);
  });

  test('counts blocked dependents without loading their documents into memory', async () => {
    const countDocuments = jest.spyOn(Card, 'countDocuments').mockResolvedValue(2);
    const card = {
      boardId: 'board-1',
      workspaceId: 'workspace-1',
      name: 'Launch approval'
    };

    await expect(interventionEngine.getBlockingCount(card)).resolves.toBe(2);
    expect(countDocuments).toHaveBeenCalledWith(expect.objectContaining({
      boardId: 'board-1',
      workspaceId: 'workspace-1',
      closed: false,
      'labels.name': 'BLOCKED'
    }));
  });
});
