const { getDemoOperationsLedger } = require('../src/services/demoWorkspaceService');

describe('demo operations ledger', () => {
  test('provides a bounded, read-only approval workflow without executable provider payloads', () => {
    const ledger = getDemoOperationsLedger(new Date('2026-07-23T10:00:00.000Z'));

    expect(ledger).toMatchObject({
      workspaceId: 'demo',
      demoMode: true,
      errors: [],
      decisions: [expect.objectContaining({
        ownerType: 'robert',
        recommendedAnswer: 'yes',
        riskLevel: 'critical'
      })],
      recommendations: [expect.objectContaining({
        requiresApproval: true,
        actionPayload: { draftOnly: true, executable: false }
      })],
      actions: []
    });
    expect(ledger.accountability.summary).toEqual(expect.objectContaining({ overdueFollowUps: 1 }));
    expect(ledger.findings).toHaveLength(1);
    expect(ledger.healthSnapshots).toHaveLength(1);
    expect(ledger.recommendations.every(item => item.actionPayload.executable !== true)).toBe(true);
  });
});
