const jobObservabilityService = require('../src/services/jobObservabilityService');

const connectorRun = ({ id, at, providerStats }) => ({
  _id: id,
  jobName: 'connectors.work_signals_sync',
  jobType: 'sync',
  status: 'succeeded',
  startedAt: new Date(at),
  finishedAt: new Date(at),
  metadata: { providerStats }
});

describe('connector sync regression watch', () => {
  test('flags only aggregate new failures and pacing spikes against a sufficient clean baseline', () => {
    const dashboard = jobObservabilityService.buildDashboard([
      connectorRun({
        id: 'current',
        at: '2026-07-23T12:00:00.000Z',
        providerStats: {
          github: { accounts: 1, failures: 1, rateLimitWaitMs: 90000 },
          asana: { accounts: 1, failures: 0, rateLimitWaitMs: 2000 }
        }
      }),
      connectorRun({
        id: 'baseline-2',
        at: '2026-07-23T11:00:00.000Z',
        providerStats: {
          github: { accounts: 1, failures: 0, rateLimitWaitMs: 1000 },
          asana: { accounts: 1, failures: 0, rateLimitWaitMs: 2000 }
        }
      }),
      connectorRun({
        id: 'baseline-1',
        at: '2026-07-23T10:00:00.000Z',
        providerStats: {
          github: { accounts: 1, failures: 0, rateLimitWaitMs: 1000 },
          asana: { accounts: 1, failures: 0, rateLimitWaitMs: 2000 }
        }
      })
    ], new Date('2026-07-23T12:05:00.000Z'));

    const connectorHealth = dashboard.health.find(job => job.jobName === 'connectors.work_signals_sync');
    expect(connectorHealth.metadata.syncRegressionWatch).toEqual({
      historyRunCount: 2,
      observedProviderCount: 2,
      regressionProviderCount: 1,
      signalCount: 2,
      providers: [{
        provider: 'github',
        signalCount: 2,
        signals: ['new_failures_after_clean_baseline', 'pacing_spike'],
        baselineRunCount: 2
      }]
    });
    expect(dashboard.summary).toMatchObject({ syncRegressionProviders: 1, syncRegressionSignals: 2 });
    expect(JSON.stringify(connectorHealth.metadata.syncRegressionWatch)).not.toMatch(/account-|credential|payload/i);
  });

  test('requires two comparable prior provider samples before flagging a change', () => {
    const watch = jobObservabilityService.getConnectorSyncRegressionWatch([
      connectorRun({
        id: 'current',
        at: '2026-07-23T12:00:00.000Z',
        providerStats: { github: { accounts: 1, failures: 1, rateLimitWaitMs: 90000 } }
      }),
      connectorRun({
        id: 'baseline',
        at: '2026-07-23T11:00:00.000Z',
        providerStats: { github: { accounts: 1, failures: 0, rateLimitWaitMs: 1000 } }
      })
    ]);

    expect(watch).toMatchObject({ historyRunCount: 1, regressionProviderCount: 0, signalCount: 0, providers: [] });
  });
});
