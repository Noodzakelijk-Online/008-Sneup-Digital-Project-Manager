const {
  RecommendationEvaluationService,
  SCENARIOS
} = require('../src/services/recommendationEvaluationService');

describe('recommendation evaluation harness', () => {
  const service = new RecommendationEvaluationService();

  test('covers blocker, overload, stakeholder, delegation, and ambiguous recommendation scenarios', () => {
    const report = service.runSuite();

    expect(report).toMatchObject({ total: 5, passed: 5, failed: 0, score: 100 });
    expect(report.results.map((result) => result.category)).toEqual(expect.arrayContaining([
      'blocker', 'overload', 'stakeholder', 'delegation', 'ambiguity'
    ]));
  });

  test('rejects a provider-write suggestion that lacks approval, evidence, or an exact payload', () => {
    const scenario = SCENARIOS.find((item) => item.id === 'overdue_blocker_follow_up');
    const result = service.evaluate({
      ...scenario.candidate,
      requiresApproval: false,
      sourceEvidence: [],
      actionPayload: { cardTrelloId: 'card-launch' },
      autoExecute: true
    }, scenario);

    expect(result.passed).toBe(false);
    expect(result.checks.filter((check) => !check.passed).map((check) => check.id)).toEqual(expect.arrayContaining([
      'source_evidence', 'approval_required', 'exact_payload', 'no_autoExecute'
    ]));
  });

  test('rejects client-commitment proposals that weaken Robert ownership or risk posture', () => {
    const scenario = SCENARIOS.find((item) => item.id === 'client_commitment_escalation');
    const result = service.evaluate({
      ...scenario.candidate,
      ownerType: 'team',
      riskLevel: 'medium'
    }, scenario);

    expect(result.passed).toBe(false);
    expect(result.checks.filter((check) => !check.passed).map((check) => check.id)).toEqual(expect.arrayContaining([
      'risk_level', 'owner_type', 'sensitive_owner'
    ]));
  });
});
