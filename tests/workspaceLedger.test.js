const operationsLedgerService = require('../src/services/operationsLedgerService');
const notificationService = require('../src/services/notificationService');
const CardFinding = require('../src/models/CardFinding');
const BoardHealthSnapshot = require('../src/models/BoardHealthSnapshot');

const workspaceId = '507f1f77bcf86cd799439011';

const queryResult = (items) => {
  const query = {
    sort: jest.fn(),
    populate: jest.fn(),
    limit: jest.fn()
  };
  query.sort.mockReturnValue(query);
  query.populate.mockReturnValue(query);
  query.limit.mockResolvedValue(items);
  return query;
};

describe('workspace operations ledger', () => {
  beforeEach(() => {
    jest.spyOn(operationsLedgerService, 'requireDatabase').mockImplementation(() => {});
    jest.spyOn(operationsLedgerService, 'listDecisionQueue').mockResolvedValue([{ id: 'decision-1' }]);
    jest.spyOn(operationsLedgerService, 'listRecommendations').mockResolvedValue([{ id: 'recommendation-1' }]);
    jest.spyOn(operationsLedgerService, 'listTrelloActions').mockResolvedValue([{ id: 'action-1' }]);
    jest.spyOn(operationsLedgerService, 'listAuditEvents').mockResolvedValue([{ id: 'audit-1' }]);
    jest.spyOn(operationsLedgerService, 'listFollowUps').mockResolvedValue([{ id: 'follow-up-1' }]);
    jest.spyOn(operationsLedgerService, 'getWorkerAccountability').mockResolvedValue({ summary: { members: 1 }, members: [] });
    jest.spyOn(operationsLedgerService, 'listInterventionOutcomes').mockResolvedValue([{ id: 'outcome-1' }]);
    jest.spyOn(operationsLedgerService, 'getTrelloActionReconciliationHealth').mockResolvedValue({ total: 0 });
    jest.spyOn(notificationService, 'listPolicies').mockResolvedValue([{ id: 'policy-1' }]);
    jest.spyOn(notificationService, 'listDeliveries').mockResolvedValue([{ id: 'delivery-1' }]);
    jest.spyOn(CardFinding, 'find').mockReturnValue(queryResult([{ id: 'finding-1' }]));
    jest.spyOn(BoardHealthSnapshot, 'find').mockReturnValue(queryResult([{ id: 'health-1' }]));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('returns all bounded workspace evidence in one partial-failure-tolerant read', async () => {
    const ledger = await operationsLedgerService.getWorkspaceLedger({
      workspaceId,
      limit: 40,
      healthLimit: 12,
      notificationLimit: 80
    });

    expect(ledger).toMatchObject({
      workspaceId: expect.anything(),
      decisions: [{ id: 'decision-1' }],
      recommendations: [{ id: 'recommendation-1' }],
      actions: [{ id: 'action-1' }],
      findings: [{ id: 'finding-1' }],
      healthSnapshots: [{ id: 'health-1' }],
      notificationPolicies: [{ id: 'policy-1' }],
      notificationDeliveries: [{ id: 'delivery-1' }],
      errors: []
    });
    expect(operationsLedgerService.listDecisionQueue).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: expect.anything(), status: 'open', limit: 40 }));
    expect(operationsLedgerService.listFollowUps).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: expect.anything(), dueOnly: true, limit: 40 }));
    expect(notificationService.listPolicies).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: expect.anything(), limit: 80 }));
  });

  test('keeps other evidence available when one section cannot be read', async () => {
    operationsLedgerService.listTrelloActions.mockRejectedValueOnce(Object.assign(new Error('Action history is unavailable'), { statusCode: 503 }));

    const ledger = await operationsLedgerService.getWorkspaceLedger({ workspaceId });

    expect(ledger.actions).toEqual([]);
    expect(ledger.recommendations).toEqual([{ id: 'recommendation-1' }]);
    expect(ledger.errors).toContainEqual({ section: 'actions', message: 'Action history is unavailable' });
  });
});
