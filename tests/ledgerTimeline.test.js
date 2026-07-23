const { buildLedgerTimeline } = require('../src/services/operationsLedgerService');

describe('operating ledger timeline', () => {
  test('merges durable board and card evidence into a newest-first bounded timeline', () => {
    const timeline = buildLedgerTimeline({
      findings: [{ _id: 'finding-1', title: 'Card is blocked', severity: 'high', findingType: 'blocked', lastObservedAt: '2026-07-20T10:00:00.000Z' }],
      recommendations: [{ _id: 'recommendation-1', title: 'Ask for unblocker', status: 'pending', riskLevel: 'medium', actionType: 'comment', ownerType: 'robert', createdAt: '2026-07-21T10:00:00.000Z' }],
      decisions: [{ _id: 'decision-1', title: 'Approve follow-up', status: 'open', riskLevel: 'medium', ownerType: 'robert', recommendedAnswer: 'yes', createdAt: '2026-07-22T10:00:00.000Z' }],
      actions: [{ _id: 'action-1', actionType: 'comment', status: 'succeeded', finishedAt: '2026-07-23T10:00:00.000Z' }],
      followUps: [{ _id: 'follow-up-1', reason: 'Confirm response', status: 'resolved', outcome: 'response_received', resolvedAt: '2026-07-24T10:00:00.000Z' }],
      workerResponses: [{ _id: 'response-1', responseType: 'completed', responseText: 'Private worker update', source: 'web_chat', receivedAt: '2026-07-25T10:00:00.000Z' }],
      auditEvents: [{ _id: 'audit-1', action: 'recommendation_approved', source: 'approval', riskLevel: 'medium', actor: 'robert', entityType: 'recommendation', createdAt: '2026-07-26T10:00:00.000Z' }]
    });

    expect(timeline).toHaveLength(7);
    expect(timeline.map((entry) => entry.type)).toEqual([
      'audit_event', 'worker_response', 'follow_up', 'trello_action', 'decision', 'recommendation', 'finding'
    ]);
    expect(timeline.find((entry) => entry.type === 'worker_response')).toEqual(expect.objectContaining({
      title: 'Worker response: completed',
      meta: ['web_chat']
    }));
    expect(JSON.stringify(timeline)).not.toContain('Private worker update');
  });

  test('caps timeline output to the requested safe limit', () => {
    const timeline = buildLedgerTimeline({
      auditEvents: Array.from({ length: 120 }, (_, index) => ({
        _id: `audit-${index}`,
        action: 'audit_recorded',
        createdAt: new Date(Date.UTC(2026, 6, 1, 0, index))
      }))
    });

    expect(timeline).toHaveLength(100);
    expect(timeline[0].id).toBe('audit_event:audit-119');
  });
});
