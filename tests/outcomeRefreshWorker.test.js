const mongoose = require('mongoose');
const operationsLedgerService = require('../src/services/operationsLedgerService');
const TrelloActionAttempt = require('../src/models/TrelloActionAttempt');
const Recommendation = require('../src/models/Recommendation');
const OutcomeRecord = require('../src/models/OutcomeRecord');
const interventionWorker = require('../src/workers/interventionWorker');

const queryResult = (value) => ({
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(value)
});

describe('scheduled intervention outcome refresh', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SNEUP_OUTCOME_RECHECK_DELAY_HOURS;
    delete process.env.SNEUP_OUTCOME_RECHECK_LIMIT;
  });

  test('rechecks only stale, non-terminal completed actions and never prepares a provider write', async () => {
    const workspaceId = new mongoose.Types.ObjectId();
    const eligibleRecommendationId = new mongoose.Types.ObjectId();
    const terminalRecommendationId = new mongoose.Types.ObjectId();
    const freshRecommendationId = new mongoose.Types.ObjectId();
    const eligibleAttemptId = new mongoose.Types.ObjectId();
    const terminalAttemptId = new mongoose.Types.ObjectId();
    const freshAttemptId = new mongoose.Types.ObjectId();
    const now = new Date('2026-07-22T12:00:00.000Z');
    const attempts = [
      { _id: eligibleAttemptId, recommendationId: eligibleRecommendationId, finishedAt: new Date('2026-07-20T12:00:00.000Z') },
      { _id: terminalAttemptId, recommendationId: terminalRecommendationId, finishedAt: new Date('2026-07-20T11:00:00.000Z') },
      { _id: freshAttemptId, recommendationId: freshRecommendationId, finishedAt: new Date('2026-07-20T10:00:00.000Z') }
    ];

    jest.spyOn(operationsLedgerService, 'isDatabaseReady').mockReturnValue(true);
    jest.spyOn(TrelloActionAttempt, 'find').mockReturnValue(queryResult(attempts));
    jest.spyOn(OutcomeRecord, 'find').mockReturnValue(queryResult([
      { actionAttemptId: terminalAttemptId, status: 'confirmed_improved', evaluatedAt: new Date('2026-07-20T12:00:00.000Z') },
      { actionAttemptId: freshAttemptId, status: 'awaiting_evidence', evaluatedAt: new Date('2026-07-22T11:00:00.000Z') }
    ]));
    jest.spyOn(Recommendation, 'find').mockReturnValue(queryResult([
      { _id: eligibleRecommendationId },
      { _id: terminalRecommendationId },
      { _id: freshRecommendationId }
    ]));
    const evaluationSpy = jest.spyOn(operationsLedgerService, 'evaluateRecommendationOutcome').mockResolvedValue({
      status: 'awaiting_evidence'
    });

    const result = await operationsLedgerService.refreshDueInterventionOutcomes({ workspaceId, now });

    expect(result).toEqual(expect.objectContaining({
      scannedCount: 3,
      eligibleCount: 3,
      evaluatedCount: 1,
      skippedTerminalCount: 1,
      skippedFreshCount: 1,
      failureCount: 0,
      recheckDelayHours: 24
    }));
    expect(evaluationSpy).toHaveBeenCalledTimes(1);
    expect(evaluationSpy).toHaveBeenCalledWith(eligibleRecommendationId, expect.objectContaining({
      workspaceId,
      evaluatedBy: 'sneup-outcome-worker',
      recordUnchangedAudit: false
    }));
  });

  test('reports the bounded recheck work through the intervention worker', async () => {
    const workspaceId = new mongoose.Types.ObjectId();
    jest.spyOn(operationsLedgerService, 'refreshDueInterventionOutcomes').mockResolvedValue({
      evaluatedCount: 2,
      failureCount: 1
    });

    await expect(interventionWorker.processOutcomes(workspaceId)).resolves.toEqual({
      processedCount: 2,
      successCount: 2,
      failureCount: 1
    });
    expect(operationsLedgerService.refreshDueInterventionOutcomes).toHaveBeenCalledWith({ workspaceId });
  });
});
