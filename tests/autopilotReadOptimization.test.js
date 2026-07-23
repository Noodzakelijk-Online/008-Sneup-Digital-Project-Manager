const workspaceId = '507f1f77bcf86cd799439011';

const queryResult = (items) => {
  const query = {
    select: jest.fn(),
    populate: jest.fn(),
    sort: jest.fn(),
    limit: jest.fn(),
    lean: jest.fn()
  };
  query.select.mockReturnValue(query);
  query.populate.mockReturnValue(query);
  query.sort.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.lean.mockResolvedValue(items);
  return query;
};

describe('mission-control read optimization', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('../src/models/Board');
    jest.dontMock('../src/models/Card');
    jest.dontMock('../src/models/Member');
    jest.dontMock('../src/models/Intervention');
    jest.dontMock('../src/models/Analytics');
    jest.dontMock('../src/models/List');
    jest.dontMock('../src/services/workGraphService');
    jest.dontMock('../src/services/forecastService');
  });

  test('builds the complete overview from projected plain-object reads', async () => {
    jest.resetModules();
    const boardQuery = queryResult([{ _id: 'board-1', trelloId: 'trello-board-1', name: 'Launch', url: 'https://trello.com/b/launch' }]);
    const cardQuery = queryResult([{
      _id: 'card-1',
      trelloId: 'trello-card-1',
      name: 'Ship launch checklist',
      boardId: { _id: 'board-1', name: 'Launch', url: 'https://trello.com/b/launch' },
      listId: { _id: 'list-1', name: 'Review' },
      members: [{ _id: 'member-1', username: 'nina', fullName: 'Nina Jacobs' }],
      due: new Date(Date.now() - 24 * 60 * 60 * 1000),
      dueComplete: false,
      closed: false,
      riskLevel: 'high',
      riskFactors: ['Client deadline'],
      labels: [{ name: 'blocked' }],
      checklists: [{ items: [{ complete: true }, { complete: true }] }],
      lastActivity: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    }]);
    const memberQuery = queryResult([{ _id: 'member-1', username: 'nina', fullName: 'Nina Jacobs', workloadLevel: 'normal', specialties: ['launch'] }]);
    const interventionQuery = queryResult([]);
    const analyticsAggregate = jest.fn().mockResolvedValue([]);
    const listQuery = queryResult([{ _id: 'list-1', boardId: 'board-1', name: 'Review', position: 1, averageTimeInList: 6 }]);

    jest.doMock('../src/models/Board', () => ({ find: jest.fn(() => boardQuery) }));
    jest.doMock('../src/models/Card', () => ({ find: jest.fn(() => cardQuery) }));
    jest.doMock('../src/models/Member', () => ({ find: jest.fn(() => memberQuery) }));
    jest.doMock('../src/models/Intervention', () => ({ find: jest.fn(() => interventionQuery) }));
    jest.doMock('../src/models/Analytics', () => ({ aggregate: analyticsAggregate }));
    jest.doMock('../src/models/List', () => ({ find: jest.fn(() => listQuery) }));
    jest.doMock('../src/services/workGraphService', () => ({ listDecisionCandidates: jest.fn().mockResolvedValue({ candidates: [] }) }));
    jest.doMock('../src/services/forecastService', () => ({ getForecast: jest.fn().mockResolvedValue({ memberCapacity: [] }) }));

    const autopilotService = require('../src/services/autopilotService');
    autopilotService.isDemoMode = jest.fn(() => false);

    const snapshot = await autopilotService.getMissionControl({ workspaceId });

    expect(snapshot).toMatchObject({
      mode: 'live',
      signals: expect.objectContaining({ boards: 1, activeCards: 1, overdueCards: 1, highRiskCards: 1 }),
      boardSummaries: [expect.objectContaining({ name: 'Launch', activeCards: 1 })],
      focus: [expect.objectContaining({ name: 'Ship launch checklist', boardName: 'Launch' })]
    });
    expect(snapshot.risks.some(risk => risk.type === 'overdue')).toBe(true);
    expect(snapshot.commandQueue.some(command => command.type === 'escalate_overdue')).toBe(true);
    expect(boardQuery.select).toHaveBeenCalledWith(expect.stringContaining('trelloId'));
    expect(cardQuery.select).toHaveBeenCalledWith(expect.stringContaining('labels.name'));
    expect(cardQuery.select).toHaveBeenCalledWith(expect.stringContaining('checklists.items.complete'));
    const cardProjection = cardQuery.select.mock.calls[0][0];
    expect(cardProjection).not.toMatch(/description|comments|attachments|history/);
    expect(boardQuery.lean).toHaveBeenCalledTimes(1);
    expect(cardQuery.lean).toHaveBeenCalledTimes(1);
    expect(memberQuery.lean).toHaveBeenCalledTimes(1);
    expect(interventionQuery.lean).toHaveBeenCalledTimes(1);
    const analyticsPipeline = analyticsAggregate.mock.calls[0][0];
    expect(analyticsPipeline[0].$match.boardId).toEqual({ $in: ['board-1'] });
    expect(String(analyticsPipeline[0].$match.workspaceId)).toBe(workspaceId);
    expect(analyticsPipeline[1]).toEqual({ $sort: { boardId: 1, date: -1 } });
    expect(analyticsPipeline[2]).toMatchObject({
      $group: { _id: '$boardId', velocity: { $first: '$velocity' } }
    });
    expect(listQuery.lean).toHaveBeenCalledTimes(1);
  });
});
