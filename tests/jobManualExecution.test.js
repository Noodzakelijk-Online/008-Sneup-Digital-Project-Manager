const buildResponse = () => {
  const response = {
    status: jest.fn(),
    json: jest.fn()
  };
  response.status.mockReturnValue(response);
  return response;
};

const loadManualTriggerHandler = () => {
  jest.resetModules();
  const router = { get: jest.fn(), post: jest.fn() };
  const processDueDecisionQueueEscalations = jest.fn().mockResolvedValue([
    { _id: 'decision-1' },
    { _id: 'decision-2' }
  ]);
  const processEscalations = jest.fn().mockResolvedValue([
    { _id: 'intervention-1' }
  ]);
  const recordAudit = jest.fn().mockResolvedValue({ _id: 'audit-1' });
  const trackJob = jest.fn(async (_context, run) => run());

  jest.doMock('express', () => ({ Router: jest.fn(() => router) }));
  jest.doMock('../src/models/Board', () => ({}));
  jest.doMock('../src/services/analyticsService', () => ({}));
  jest.doMock('../src/services/connectorSyncService', () => ({}));
  jest.doMock('../src/services/interventionEngine', () => ({ processEscalations }));
  jest.doMock('../src/services/operationsLedgerService', () => ({
    processDueDecisionQueueEscalations,
    recordAudit
  }));
  jest.doMock('../src/services/jobObservabilityService', () => ({
    ensureKnownJob: jest.fn(() => ({ manualTriggerAllowed: true })),
    isJobPaused: jest.fn().mockResolvedValue(false),
    markManualRun: jest.fn().mockResolvedValue({}),
    trackJob
  }));
  jest.doMock('../src/services/performanceTracker', () => ({}));
  jest.doMock('../src/services/notificationService', () => ({}));
  jest.doMock('../src/services/trelloSync', () => ({}));
  jest.doMock('../src/services/workspaceScopeService', () => ({
    getDefaultWorkspaceObjectId: jest.fn(() => 'workspace-default'),
    getRequestWorkspaceObjectId: jest.fn(req => req.auth.workspaceId)
  }));
  jest.doMock('../src/utils/requestSecurity', () => ({
    clampInteger: jest.fn(value => value),
    requirePermission: jest.fn(() => jest.fn())
  }));

  require('../src/routes/jobs');
  const call = router.post.mock.calls.find(([path]) => path === '/:jobName/trigger');
  return {
    handler: call[2],
    processDueDecisionQueueEscalations,
    processEscalations,
    trackJob,
    recordAudit
  };
};

describe('manual escalation job execution', () => {
  afterEach(() => {
    jest.dontMock('express');
    jest.dontMock('../src/models/Board');
    jest.dontMock('../src/services/analyticsService');
    jest.dontMock('../src/services/connectorSyncService');
    jest.dontMock('../src/services/interventionEngine');
    jest.dontMock('../src/services/operationsLedgerService');
    jest.dontMock('../src/services/jobObservabilityService');
    jest.dontMock('../src/services/performanceTracker');
    jest.dontMock('../src/services/notificationService');
    jest.dontMock('../src/services/trelloSync');
    jest.dontMock('../src/services/workspaceScopeService');
    jest.dontMock('../src/utils/requestSecurity');
    jest.resetModules();
  });

  test('matches scheduled escalation processing and includes decision queue transitions', async () => {
    const {
      handler,
      processDueDecisionQueueEscalations,
      processEscalations,
      trackJob,
      recordAudit
    } = loadManualTriggerHandler();
    const response = buildResponse();

    await handler({
      params: { jobName: 'interventions.escalations' },
      auth: { workspaceId: 'workspace-1', displayName: 'Robert' }
    }, response);

    expect(processDueDecisionQueueEscalations).toHaveBeenCalledWith({ workspaceId: 'workspace-1' });
    expect(processEscalations).toHaveBeenCalledWith({ workspaceId: 'workspace-1' });
    expect(trackJob).toHaveBeenCalledWith(expect.objectContaining({
      jobName: 'interventions.escalations',
      workspaceId: 'workspace-1',
      triggerType: 'manual'
    }), expect.any(Function));
    expect(response.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      result: { processedCount: 3, successCount: 1, failureCount: 0 }
    }));
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'job_manual_triggered',
      entityId: 'interventions.escalations',
      source: 'api'
    }));
  });
});
