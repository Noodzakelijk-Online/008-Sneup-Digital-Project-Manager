const { getDemoOperationsLedger } = require('../src/services/demoWorkspaceService');
const operationsBriefService = require('../src/services/operationsBriefService');

describe('demo operations ledger', () => {
  test('provides a bounded, read-only approval workflow without executable provider payloads', () => {
    const ledger = getDemoOperationsLedger(new Date('2026-07-23T10:00:00.000Z'));

    expect(ledger).toMatchObject({
      workspaceId: 'demo',
      demoMode: true,
      errors: [],
      decisions: expect.arrayContaining([expect.objectContaining({
        ownerType: 'robert',
        recommendedAnswer: 'yes',
        riskLevel: 'critical'
      })]),
      recommendations: [expect.objectContaining({
        requiresApproval: true,
        actionPayload: { draftOnly: true, executable: false }
      })],
      actions: [expect.objectContaining({
        actionType: 'reassign',
        status: 'failed',
        reconciliation: expect.objectContaining({
          status: 'required',
          confirmedSteps: ['source_member_removed'],
          pendingSteps: ['target_member_added']
        })
      })]
    });
    expect(ledger.accountability.summary).toEqual(expect.objectContaining({ overdueFollowUps: 1 }));
    expect(ledger.workerResponses).toEqual([expect.objectContaining({
      responseType: 'acknowledged',
      source: 'web_chat'
    })]);
    expect(ledger.timeline).toEqual(expect.arrayContaining([expect.objectContaining({
      type: 'worker_response',
      title: 'Worker response: acknowledged'
    })]));
    expect(ledger.findings).toHaveLength(3);
    expect(ledger.healthSnapshots).toHaveLength(1);
    expect(ledger.reconciliationHealth.summary).toEqual(expect.objectContaining({ requiresOperator: 1, critical: 1 }));
    expect(ledger.recommendations.every(item => item.actionPayload.executable !== true)).toBe(true);
  });

  test('uses the same bounded work records in the demo brief and ledger destinations', () => {
    const ledger = getDemoOperationsLedger(new Date('2026-07-23T10:00:00.000Z'));
    const brief = operationsBriefService.getDemoDailyBrief();

    expect(brief.failedActions[0].id).toBe(String(ledger.actions[0]._id));
    expect(brief.dueFollowUps[0].id).toBe(String(ledger.followUps[0]._id));
    expect(brief.vaReady[0].id).toBe(String(ledger.findings.find(item => item.waitingOn === 'va')._id));
    expect(brief.teamQueue[0].id).toBe(String(ledger.decisions.find(item => item.ownerType === 'team')._id));
    expect(brief.externalWaits[0].id).toBe(String(ledger.findings.find(item => item.waitingOn === 'external')._id));
    expect(brief.boardHealth[0].id).toBe(String(ledger.healthSnapshots[0]._id));
  });
});
