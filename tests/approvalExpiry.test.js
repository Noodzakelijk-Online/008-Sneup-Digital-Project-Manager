const mongoose = require('mongoose');
const operationsLedgerService = require('../src/services/operationsLedgerService');
const Recommendation = require('../src/models/Recommendation');
const Approval = require('../src/models/Approval');
const DecisionQueueItem = require('../src/models/DecisionQueueItem');
const policyRuleService = require('../src/services/policyRuleService');

describe('approval expiry safeguards', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SNEUP_APPROVAL_TTL_CRITICAL_HOURS;
  });

  test('uses bounded risk-aware approval lifetimes', () => {
    const now = new Date('2026-07-22T10:00:00.000Z');
    expect(operationsLedgerService.approvalExpiresAt('critical', now).toISOString())
      .toBe('2026-07-22T14:00:00.000Z');

    process.env.SNEUP_APPROVAL_TTL_CRITICAL_HOURS = '999';
    expect(operationsLedgerService.approvalTtlHours('critical')).toBe(168);
  });

  test('blocks expired approvals, returns the recommendation to review, and never calls Trello', async () => {
    const workspaceId = new mongoose.Types.ObjectId();
    const recommendationId = new mongoose.Types.ObjectId();
    const expiry = new Date('2026-07-22T09:00:00.000Z');
    const recommendation = {
      _id: recommendationId,
      workspaceId,
      boardId: new mongoose.Types.ObjectId(),
      cardId: new mongoose.Types.ObjectId(),
      title: 'Post the reviewed blocker update',
      recommendedAction: 'Post the reviewed blocker update.',
      actionType: 'comment',
      actionPayload: { cardTrelloId: 'card-1', commentText: 'Blocked by client feedback.' },
      status: 'approved',
      riskLevel: 'high',
      ownerType: 'robert',
      requiresApproval: true,
      approvalExpiresAt: expiry,
      sourceEvidence: []
    };
    const expiredRecommendation = {
      ...recommendation,
      status: 'pending',
      approvalExpiredAt: new Date(),
      approvalExpiryReason: 'Approval expired before execution; reapproval is required.',
      toObject() {
        return { ...this };
      }
    };
    const approval = {
      _id: new mongoose.Types.ObjectId(),
      approvedPayloadSnapshot: { ...recommendation.actionPayload },
      expiresAt: expiry,
      decidedBy: 'robert'
    };

    jest.spyOn(operationsLedgerService, 'isDatabaseReady').mockReturnValue(true);
    jest.spyOn(Recommendation, 'findOne').mockResolvedValue(recommendation);
    jest.spyOn(Recommendation, 'findOneAndUpdate').mockResolvedValue(expiredRecommendation);
    jest.spyOn(Approval, 'findOne').mockReturnValue({
      sort: jest.fn().mockResolvedValue(approval)
    });
    jest.spyOn(DecisionQueueItem, 'create').mockResolvedValue({});
    jest.spyOn(policyRuleService, 'resolveEffectivePolicy').mockResolvedValue({
      enabled: true,
      requiresApproval: true
    });
    const auditSpy = jest.spyOn(operationsLedgerService, 'recordAudit').mockResolvedValue({});
    const providerWriteSpy = jest.spyOn(operationsLedgerService, 'performTrelloAction').mockResolvedValue({});

    await expect(operationsLedgerService.executeApprovedRecommendation(recommendationId, {
      workspaceId,
      actor: 'operator'
    })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Approval expired before execution. Review the current payload and approve again.'
    });

    expect(Recommendation.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: recommendationId, status: 'approved', approvalExpiresAt: expiry }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'pending' }) }),
      { new: true }
    );
    expect(DecisionQueueItem.create).toHaveBeenCalledWith(expect.objectContaining({
      recommendationId,
      recommendedAnswer: 'review',
      reason: 'Approval expired before execution; reapproval is required.'
    }));
    expect(auditSpy).toHaveBeenCalledWith(expect.objectContaining({
      action: 'recommendation_approval_expired',
      approvalId: approval._id
    }));
    expect(providerWriteSpy).not.toHaveBeenCalled();
  });
});
