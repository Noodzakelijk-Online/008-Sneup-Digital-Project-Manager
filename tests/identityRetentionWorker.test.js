describe('identity retention worker', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('processes each retainable workspace through job observability', async () => {
    const job = { cancel: jest.fn() };
    const scheduleJob = jest.fn(() => job);
    const workspaceInviteService = {
      listRetainableWorkspaceIds: jest.fn().mockResolvedValue(['workspace-a', 'workspace-b']),
      redactRetainedInvites: jest.fn(async ({ workspaceId }) => ({ processedCount: 1, successCount: 1, workspaceId }))
    };
    const jobObservabilityService = {
      trackJob: jest.fn(async (options, callback) => ({ options, result: await callback() }))
    };

    jest.doMock('node-schedule', () => ({ scheduleJob }));
    jest.doMock('../src/services/workspaceInviteService', () => workspaceInviteService);
    jest.doMock('../src/services/jobObservabilityService', () => jobObservabilityService);
    jest.doMock('../src/utils/logger', () => ({ info: jest.fn(), warn: jest.fn() }));

    const worker = require('../src/workers/identityRetentionWorker');
    worker.init();
    worker.init();
    const results = await worker.runScheduledRetention();
    worker.stop();

    expect(scheduleJob).toHaveBeenCalledTimes(1);
    expect(jobObservabilityService.trackJob).toHaveBeenCalledTimes(2);
    expect(jobObservabilityService.trackJob).toHaveBeenNthCalledWith(1, expect.objectContaining({
      jobName: 'identity.invitation_retention',
      workspaceId: 'workspace-a',
      triggerType: 'scheduled'
    }), expect.any(Function));
    expect(workspaceInviteService.redactRetainedInvites).toHaveBeenCalledWith({ workspaceId: 'workspace-a' });
    expect(workspaceInviteService.redactRetainedInvites).toHaveBeenCalledWith({ workspaceId: 'workspace-b' });
    expect(results).toHaveLength(2);
    expect(job.cancel).toHaveBeenCalledTimes(1);
  });
});
