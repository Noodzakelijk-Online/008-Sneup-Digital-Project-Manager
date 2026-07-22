const mongoose = require('mongoose');
const Learning = require('../src/models/Learning');
const operationsLedgerService = require('../src/services/operationsLedgerService');

const queryResult = (value) => ({
  select: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  lean: jest.fn().mockResolvedValue(value)
});

describe('recommendation learning feedback', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('upserts compact workspace-scoped feedback without action payloads or decision notes', async () => {
    const workspaceId = new mongoose.Types.ObjectId();
    const recommendationId = new mongoose.Types.ObjectId();
    const updateSpy = jest.spyOn(Learning, 'findOneAndUpdate').mockResolvedValue({ _id: new mongoose.Types.ObjectId() });

    await Learning.recordRecommendationFeedback({
      workspaceId,
      recommendationId,
      boardId: new mongoose.Types.ObjectId(),
      decision: 'approved',
      actionType: 'comment',
      riskLevel: 'medium',
      accepted: true,
      executed: false,
      outcome: 'unknown',
      notes: 'No raw operator decision notes are retained.'
    });

    const [query, update, options] = updateSpy.mock.calls[0];
    expect(query).toEqual(expect.objectContaining({
      workspaceId,
      type: 'feedback',
      category: 'recommendation',
      'feedback.recommendationId': recommendationId
    }));
    expect(update.$set.feedback).toEqual(expect.objectContaining({
      recommendationId,
      decision: 'approved',
      actionType: 'comment',
      riskLevel: 'medium',
      accepted: true,
      executed: false,
      outcome: 'unknown'
    }));
    expect(update.$set.feedback).not.toHaveProperty('actionPayload');
    expect(update.$set.feedback).not.toHaveProperty('notes');
    expect(options).toEqual({ new: true, upsert: true, setDefaultsOnInsert: true });
  });

  test('summarizes feedback for reporting without exposing stored note fields', async () => {
    const workspaceId = new mongoose.Types.ObjectId();
    jest.spyOn(operationsLedgerService, 'isDatabaseReady').mockReturnValue(true);
    jest.spyOn(Learning, 'find').mockReturnValue(queryResult([
      { boardId: new mongoose.Types.ObjectId(), feedback: { recommendationId: new mongoose.Types.ObjectId(), decision: 'approved', actionType: 'comment', riskLevel: 'medium', accepted: true, executed: false, outcome: 'unknown', feedbackDate: new Date(), notes: 'private' } },
      { boardId: new mongoose.Types.ObjectId(), feedback: { recommendationId: new mongoose.Types.ObjectId(), decision: 'rejected', actionType: 'reassign', riskLevel: 'high', accepted: false, executed: false, outcome: 'unknown', feedbackDate: new Date(), notes: 'private' } },
      { boardId: new mongoose.Types.ObjectId(), feedback: { recommendationId: new mongoose.Types.ObjectId(), decision: 'executed', actionType: 'follow_up', riskLevel: 'medium', accepted: true, executed: true, outcome: 'success', feedbackDate: new Date(), notes: 'private' } }
    ]));

    const summary = await operationsLedgerService.getRecommendationLearningSummary({ workspaceId });

    expect(summary).toEqual(expect.objectContaining({
      feedbackCount: 3,
      decidedCount: 3,
      approvalRate: 67,
      decisions: expect.objectContaining({ approved: 1, rejected: 1, executed: 1 }),
      outcomes: expect.objectContaining({ success: 1, unknown: 2 })
    }));
    expect(summary.records).toHaveLength(3);
    expect(JSON.stringify(summary.records)).not.toContain('private');
  });

  test('keeps learning write failures outside the approval and execution authority path', async () => {
    const recommendation = {
      _id: new mongoose.Types.ObjectId(),
      workspaceId: new mongoose.Types.ObjectId(),
      boardId: new mongoose.Types.ObjectId(),
      actionType: 'comment',
      riskLevel: 'medium',
      actionPayload: { cardTrelloId: 'card-1', commentText: 'Never retained here.' }
    };
    jest.spyOn(Learning, 'recordRecommendationFeedback').mockRejectedValue(new Error('Learning datastore unavailable'));

    await expect(operationsLedgerService.recordRecommendationLearningFeedback(recommendation, {
      decision: 'approved',
      accepted: true
    })).resolves.toBeNull();
  });
});
